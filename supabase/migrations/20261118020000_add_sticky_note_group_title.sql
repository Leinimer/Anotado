alter table public.sticky_note_groups
  add column if not exists title text not null default '';
