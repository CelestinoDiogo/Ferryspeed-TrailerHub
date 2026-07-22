begin;

create or replace function public.sync_waiting_queue_on_export_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.trailer_id is null then
    return new;
  end if;

  if new.status not in ('allocated', 'delivered_empty', 'waiting_loading', 'collected_loaded') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.trailer_id is not distinct from new.trailer_id
     and old.status is not distinct from new.status then
    return new;
  end if;

  update public.compound_waiting_list
  set
    status = 'cancelled',
    notes = case
      when notes is null or trim(notes) = '' then 'Automatically removed after export allocation creation.'
      else notes || E'\nAutomatically removed after export allocation creation.'
    end,
    updated_at = now()
  where trailer_id = new.trailer_id
    and status = 'waiting';

  return new;
end;
$$;

drop trigger if exists export_allocation_waiting_sync_trigger
on public.export_allocations;

create trigger export_allocation_waiting_sync_trigger
after insert or update of trailer_id, status
on public.export_allocations
for each row
execute function public.sync_waiting_queue_on_export_allocation();

grant execute
on function public.sync_waiting_queue_on_export_allocation()
to authenticated, service_role;

commit;
