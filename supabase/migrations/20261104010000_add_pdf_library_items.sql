-- ANOTADO: Adicionar suporte a PDFs independentes como itens da biblioteca na árvore lateral.
-- Permite que documentos PDF existam diretamente em pastas (folder_id) ou na raiz (folder_id IS NULL),
-- com ordenação própria (position) e flag explícita (is_library_item).
-- Documentos anexados a notas continuam usando note_id preenchido e is_library_item = FALSE.
--
-- Execute no Supabase SQL Editor ou aplique via Supabase CLI.

begin;

-- 1. Garante que note_id possa ser nulo para PDFs independentes da biblioteca
alter table public.note_attachments
  alter column note_id drop not null;

-- 2. Adiciona flag para distinguir itens da biblioteca de anexos internos de notas
alter table public.note_attachments
  add column if not exists is_library_item boolean not null default false;

-- 3. Adiciona pasta de destino para documentos independentes (com remoção segura de pasta)
alter table public.note_attachments
  add column if not exists folder_id uuid references public.folders(id) on delete set null;

-- 4. Adiciona posição ordinal para reordenação na árvore lateral
alter table public.note_attachments
  add column if not exists position integer not null default 0;

-- 5. Índices para performance de consulta na sidebar e sincronização por usuário
create index if not exists idx_note_attachments_library
  on public.note_attachments(user_id, is_library_item)
  where is_library_item = true;

create index if not exists idx_note_attachments_folder
  on public.note_attachments(user_id, folder_id);

commit;
