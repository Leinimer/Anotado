-- Permite ao dono sobrescrever/restaurar objetos órfãos do Storage mesmo
-- quando a linha em public.note_attachments ainda não existe.
-- A proteção continua limitada ao prefixo da pasta do usuário autenticado.
begin;

drop policy if exists anotado_attachment_objects_owner_select
  on storage.objects;

create policy anotado_attachment_objects_owner_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('note-attachments', 'attachments')
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1
        from public.note_attachments as attachment
        where attachment.storage_path = storage.objects.name
          and attachment.user_id::text = (select auth.uid())::text
      )
    )
  );

drop policy if exists anotado_attachment_objects_owner_update
  on storage.objects;

create policy anotado_attachment_objects_owner_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id in ('note-attachments', 'attachments')
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1
        from public.note_attachments as attachment
        where attachment.storage_path = storage.objects.name
          and attachment.user_id::text = (select auth.uid())::text
      )
    )
  )
  with check (
    bucket_id in ('note-attachments', 'attachments')
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1
        from public.note_attachments as attachment
        where attachment.storage_path = storage.objects.name
          and attachment.user_id::text = (select auth.uid())::text
      )
    )
  );

commit;
