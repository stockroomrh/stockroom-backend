create policy project_media_public_read on storage.objects for select using (bucket_id = 'project-media');
create policy project_media_owner_write on storage.objects for insert with check (bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy project_media_owner_update on storage.objects for update using (bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy project_media_owner_delete on storage.objects for delete using (bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text);
