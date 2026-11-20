-- ANOTADO: Layouts independentes por dispositivo (desktop, tablet, mobile) para o quadro de Sticks
-- Idempotente e 100% compatível com os registros existentes em public.sticky_notes e public.sticky_note_groups.

begin;

create table if not exists public.sticky_board_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  board_id text not null default 'default',
  layout_type text not null check (layout_type in ('desktop', 'tablet', 'mobile')),
  layout_data jsonb not null default '{"version":1,"notes":{},"groups":{}}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint sticky_board_layouts_user_board_type_unique unique (user_id, board_id, layout_type)
);

-- Índices para leitura rápida por usuário, quadro e modalidade de dispositivo
create index if not exists idx_sticky_board_layouts_lookup
  on public.sticky_board_layouts(user_id, board_id, layout_type);

-- Atualização automática de updated_at
create or replace function public.set_sticky_board_layouts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_sticky_board_layouts_updated_at on public.sticky_board_layouts;
create trigger trg_sticky_board_layouts_updated_at
  before update on public.sticky_board_layouts
  for each row
  execute function public.set_sticky_board_layouts_updated_at();

-- Segurança por linha (RLS): acesso estritamente isolado ao proprietário autenticado
alter table public.sticky_board_layouts enable row level security;

drop policy if exists "Users can view their own sticky board layouts" on public.sticky_board_layouts;
create policy "Users can view their own sticky board layouts"
  on public.sticky_board_layouts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own sticky board layouts" on public.sticky_board_layouts;
create policy "Users can insert their own sticky board layouts"
  on public.sticky_board_layouts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own sticky board layouts" on public.sticky_board_layouts;
create policy "Users can update their own sticky board layouts"
  on public.sticky_board_layouts
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own sticky board layouts" on public.sticky_board_layouts;
create policy "Users can delete their own sticky board layouts"
  on public.sticky_board_layouts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.sticky_board_layouts to authenticated;

commit;
