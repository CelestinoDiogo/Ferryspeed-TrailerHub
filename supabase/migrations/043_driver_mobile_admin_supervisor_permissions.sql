-- Ferryspeed TrailerHub - Migration 043
-- Ensure administrator/supervisor RBAC rows exist for Driver Mobile module.

begin;

insert into public.app_permission_modules (module_key, label)
values ('driver_mobile', 'Driver Mobile')
on conflict (module_key) do update
set label = excluded.label,
    updated_at = now();

insert into public.app_role_permissions (role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports)
values ('administrator', 'driver_mobile', true, true, true, true, true)
on conflict (role_key, module_key) do update
set can_view = excluded.can_view,
    can_create = excluded.can_create,
    can_edit = excluded.can_edit,
    can_delete = excluded.can_delete,
    can_reports = excluded.can_reports,
    updated_at = now();

insert into public.app_role_permissions (role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports)
values ('supervisor', 'driver_mobile', true, false, false, false, false)
on conflict (role_key, module_key) do update
set can_view = excluded.can_view,
    can_create = excluded.can_create,
    can_edit = excluded.can_edit,
    can_delete = excluded.can_delete,
    can_reports = excluded.can_reports,
    updated_at = now();

commit;
