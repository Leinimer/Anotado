-- ANOTADO: vincula uma nota-resumo ao PDF de origem.
-- A nota continua sendo um registro independente; parent_pdf_id permite encontrar
-- o resumo pelo PDF e reconstruir a relação mesmo após sincronização ou reabertura.

begin;

alter table public.notes
  add column if not exists parent_pdf_id uuid;

create index if not exists idx_notes_parent_pdf_id
  on public.notes(user_id, parent_pdf_id)
  where parent_pdf_id is not null;

-- Um PDF pode possuir apenas uma nota-resumo por usuário.
create unique index if not exists idx_notes_one_pdf_summary_per_user
  on public.notes(user_id, parent_pdf_id)
  where parent_pdf_id is not null;

commit;
