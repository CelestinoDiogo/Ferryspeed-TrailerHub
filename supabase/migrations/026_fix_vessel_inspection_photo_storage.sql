begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vessel-inspection-photos',
  'vessel-inspection-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated can read vessel inspection photos" on storage.objects;
drop policy if exists "Authenticated can upload vessel inspection photos" on storage.objects;
drop policy if exists "Authenticated can update vessel inspection photos" on storage.objects;
drop policy if exists "Authenticated can delete vessel inspection photos" on storage.objects;

create policy "Authenticated can read vessel inspection photos"
on storage.objects
for select
to authenticated
using (bucket_id = 'vessel-inspection-photos');

create policy "Authenticated can upload vessel inspection photos"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'vessel-inspection-photos');

create policy "Authenticated can update vessel inspection photos"
on storage.objects
for update
to authenticated
using (bucket_id = 'vessel-inspection-photos')
with check (bucket_id = 'vessel-inspection-photos');

create policy "Authenticated can delete vessel inspection photos"
on storage.objects
for delete
to authenticated
using (bucket_id = 'vessel-inspection-photos');

commit;
