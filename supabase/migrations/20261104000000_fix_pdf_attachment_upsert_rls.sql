-- ANOTADO: permitir sobrescrita segura de anexos PDF no Supabase Storage.
-- Supabase Storage usa upsert=true para substituir o objeto existente.
-- Essa operação exige SELECT e UPDATE em storage.objects, além de INSERT
-- quando o objeto ainda não existe. As policies abaixo restringem o acesso
-- a anexos vinculados ao próprio user_id autenticado.
--
-- Execute no Supabase SQL Editor ou aplique via Supabase CLI.

begin;

-- A aplicação precisa ler a linha do anexo para confirmar o bucket/caminho e
-- precisa atualizar file_size/updated_at depois de sobrescrever o PDF.
alter table public.note_attachments enable row level security;

drop policy if exists anotado_note_attachments_owner_select
  on public.note_attachments;

create policy anotado_note_attachments_owner_select
  on public.note_attachments
  for select
  to authenticated
  using (user_id::text = (select auth.uid())::text);

drop policy if exists anotado_note_attachments_owner_update
  on public.note_attachments;

create policy anotado_note_attachments_owner_update
  on public.note_attachments
  for update
  to authenticated
  using (user_id::text = (select auth.uid())::text)
  with check (user_id::text = (select auth.uid())::text);

-- Mantém também criação e exclusão de metadados de anexos restritas ao proprietário
-- caso o projeto estivesse sem RLS habilitado nesta tabela.
drop policy if exists anotado_note_attachments_owner_insert
  on public.note_attachments;

create policy anotado_note_attachments_owner_insert
  on public.note_attachments
  for insert
  to authenticated
  with check (user_id::text = (select auth.uid())::text);

drop policy if exists anotado_note_attachments_owner_delete
  on public.note_attachments;

create policy anotado_note_attachments_owner_delete
  on public.note_attachments
  for delete
  to authenticated
  using (user_id::text = (select auth.uid())::text);

-- SELECT: exigido pelo upsert do Storage para consultar/retornar o objeto
-- que está sendo substituído. O vínculo ao registro impede leitura cruzada.
drop policy if exists anotado_attachment_objects_owner_select
  on storage.objects;

create policy anotado_attachment_objects_owner_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('note-attachments', 'attachments')
    and exists (
      select 1
      from public.note_attachments as attachment
      where attachment.storage_path = storage.objects.name
        and attachment.user_id::text = (select auth.uid())::text
    )
  );

-- UPDATE: exigido pelo upsert quando o objeto já existe.
drop policy if exists anotado_attachment_objects_owner_update
  on storage.objects;

create policy anotado_attachment_objects_owner_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id in ('note-attachments', 'attachments')
    and exists (
      select 1
      from public.note_attachments as attachment
      where attachment.storage_path = storage.objects.name
        and attachment.user_id::text = (select auth.uid())::text
    )
  )
  with check (
    bucket_id in ('note-attachments', 'attachments')
    and exists (
      select 1
      from public.note_attachments as attachment
      where attachment.storage_path = storage.objects.name
        and attachment.user_id::text = (select auth.uid())::text
    )
  );

-- INSERT: mantém os uploads de novos anexos restritos à pasta do usuário.
-- Também aceita um storage_path legado se houver um registro de anexo do
-- próprio usuário apontando exatamente para esse objeto.
drop policy if exists anotado_attachment_objects_owner_insert
  on storage.objects;

create policy anotado_attachment_objects_owner_insert
  on storage.objects
  for insert
  to authenticated
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
