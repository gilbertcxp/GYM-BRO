-- =====================================================================
-- GYM BRO — Almacenamiento privado (fotos de progreso y avatares)
-- Los archivos se guardan como  <user_id>/<uuid>.<ext>  en buckets PRIVADOS.
-- El cliente solo accede mediante URLs firmadas de corta duración.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('progress-photos', 'progress-photos', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('avatars', 'avatars', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;

-- Fotos de progreso
create policy "progress_photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "progress_photos_select" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.progress_photos p
               where p.storage_path = objects.name
                 and p.visible_to_partner
                 and public.can_view(p.user_id, 'photos'))));

create policy "progress_photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Avatares (visibles para el compañero vinculado)
create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_select" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and exists (
    select 1 from public.profiles pr
    where pr.id::text = (storage.foldername(objects.name))[1] and public.can_view(pr.id, 'profile')));

create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
