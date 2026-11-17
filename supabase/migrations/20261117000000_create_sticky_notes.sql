-- ANOTADO: Criação da tabela de Notas Adesivas (public.sticky_notes)
-- Idempotente: seguro para executar no Supabase SQL Editor sem duplicar tabela, triggers ou políticas.

begin;

create table if not exists public.sticky_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  color text not null default 'yellow',
  position_x double precision not null default 80,
  position_y double precision not null default 80,
  width_px integer not null default 260,
  z_index bigint not null default 1,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- Garante colunas caso a tabela já exista parcialmente
alter table public.sticky_notes add column if not exists title text not null default '';
alter table public.sticky_notes add column if not exists content text not null default '';
alter table public.sticky_notes add column if not exists color text not null default 'yellow';
alter table public.sticky_notes add column if not exists position_x double precision not null default 80;
alter table public.sticky_notes add column if not exists position_y double precision not null default 80;
alter table public.sticky_notes add column if not exists width_px integer not null default 260;
alter table public.sticky_notes add column if not exists z_index bigint not null default 1;
alter table public.sticky_notes add column if not exists created_at timestamptz not null default timezone('utc'::text, now());
alter table public.sticky_notes add column if not exists updated_at timestamptz not null default timezone('utc'::text, now());

-- Índices para consultas rápidas por usuário e ordenação por z_index
create index if not exists idx_sticky_notes_user_id
  on public.sticky_notes(user_id);

create index if not exists idx_sticky_notes_user_z_index
  on public.sticky_notes(user_id, z_index, created_at);

-- Atualização automática de updated_at
create or replace function public.set_sticky_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_sticky_notes_updated_at on public.sticky_notes;
create trigger trg_sticky_notes_updated_at
  before update on public.sticky_notes
  for each row
  execute function public.set_sticky_notes_updated_at();

-- Segurança por linha (RLS)
alter table public.sticky_notes enable row level security;

drop policy if exists "Users can view their own sticky notes" on public.sticky_notes;
create policy "Users can view their own sticky notes"
  on public.sticky_notes
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own sticky notes" on public.sticky_notes;
create policy "Users can create their own sticky notes"
  on public.sticky_notes
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own sticky notes" on public.sticky_notes;
create policy "Users can update their own sticky notes"
  on public.sticky_notes
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own sticky notes" on public.sticky_notes;
create policy "Users can delete their own sticky notes"
  on public.sticky_notes
  for delete
  using (auth.uid() = user_id);

commit;
