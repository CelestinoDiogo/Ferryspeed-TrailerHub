-- Release 1.0 collections timestamp correctness.
-- Driver yard pickup (scheduled/ready -> on_delivery) must not write collected_at.
-- collected_at remains the final customer-collection timestamp only.
-- NOT APPLIED in this sprint. Create/report only.

begin;

create or replace function public.enforce_driver_delivery_booking_update_guard()
returns trigger
language plpgsql
as $$
declare
  is_driver_actor boolean := false;
  is_assigned_driver boolean := false;
begin
  if auth.uid() is null then
    return new;
  end if;

  select exists (
    select 1
    from public.app_user_roles aur
    where aur.user_id = auth.uid()
      and aur.is_active = true
      and aur.role_key = 'driver'
  )
  into is_driver_actor;

  if not is_driver_actor then
    return new;
  end if;

  select exists (
    select 1
    from public.drivers d
    where d.id = old.driver_id
      and d.user_id = auth.uid()
      and d.active = true
  )
  into is_assigned_driver;

  if not is_assigned_driver then
    raise exception 'Drivers can only update bookings assigned to their own driver record.';
  end if;

  -- Protect assignment and non-lifecycle fields.
  if new.id is distinct from old.id
    or new.trailer_id is distinct from old.trailer_id
    or new.driver_id is distinct from old.driver_id
    or new.delivery_date is distinct from old.delivery_date
    or new.delivery_time is distinct from old.delivery_time
    or new.customer is distinct from old.customer
    or new.consignee is distinct from old.consignee
    or new.delivery_location is distinct from old.delivery_location
    or new.booking_reference is distinct from old.booking_reference
    or new.escort_required is distinct from old.escort_required
    or new.notes is distinct from old.notes
    or new.created_at is distinct from old.created_at
    or new.waiting_collection_since is distinct from old.waiting_collection_since
    or new.collection_due_date is distinct from old.collection_due_date
    or new.demurrage_free_days is distinct from old.demurrage_free_days
    or new.demurrage_daily_rate is distinct from old.demurrage_daily_rate
    or new.demurrage_currency is distinct from old.demurrage_currency
    or new.demurrage_notes is distinct from old.demurrage_notes
    or new.temperature_required is distinct from old.temperature_required
  then
    raise exception 'Driver updates are restricted to lifecycle action fields only.';
  end if;

  -- Acknowledgement is write-once for drivers.
  if old.driver_acknowledged_at is not null and new.driver_acknowledged_at is distinct from old.driver_acknowledged_at then
    raise exception 'Driver acknowledgement timestamp cannot be changed once set.';
  end if;

  if old.driver_acknowledged_by is not null and new.driver_acknowledged_by is distinct from old.driver_acknowledged_by then
    raise exception 'Driver acknowledgement actor cannot be changed once set.';
  end if;

  if old.driver_acknowledged_at is null and new.driver_acknowledged_at is not null then
    if new.driver_acknowledged_by is distinct from auth.uid() then
      raise exception 'Driver acknowledgement must be attributed to the authenticated driver.';
    end if;
  end if;

  if new.driver_acknowledged_at is null and new.driver_acknowledged_by is not null then
    raise exception 'Driver acknowledgement actor requires an acknowledgement timestamp.';
  end if;

  -- Drivers cannot mutate collection/delivery fields without a valid status transition.
  if new.status is not distinct from old.status then
    if new.collected_at is distinct from old.collected_at
      or new.delivered_at is distinct from old.delivered_at
      or new.collected_temperature_c is distinct from old.collected_temperature_c
    then
      raise exception 'Driver lifecycle timestamp fields require a valid status transition.';
    end if;

    return new;
  end if;

  if old.driver_acknowledged_at is null then
    raise exception 'Driver must acknowledge the booking before lifecycle status transitions.';
  end if;

  if old.status in ('scheduled', 'ready') and new.status = 'on_delivery' then
    if new.collected_at is distinct from old.collected_at then
      raise exception 'Customer collection timestamp cannot be set when moving to on_delivery.';
    end if;

    if old.temperature_required and coalesce(new.collected_temperature_c, old.collected_temperature_c) is null then
      raise exception 'Temperature reading is required when the booking requires temperature control.';
    end if;

    return new;
  end if;

  if old.status = 'waiting_collection' and new.status = 'collected' then
    if coalesce(new.collected_at, old.collected_at) is null then
      raise exception 'Collected timestamp is required when moving to collected.';
    end if;

    if old.temperature_required and coalesce(new.collected_temperature_c, old.collected_temperature_c) is null then
      raise exception 'Temperature reading is required when the booking requires temperature control.';
    end if;

    return new;
  end if;

  if old.status = 'on_delivery' and new.status = 'delivered' then
    if coalesce(new.delivered_at, old.delivered_at) is null then
      raise exception 'Delivered timestamp is required when moving to delivered.';
    end if;

    return new;
  end if;

  raise exception 'Driver status transition is not allowed for this booking.';
end;
$$;

commit;
