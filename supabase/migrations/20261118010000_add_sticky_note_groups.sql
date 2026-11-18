-- Agrupamentos visuais de Sticks.
begin;

create table if not exists public.sticky_note_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  color text not null default 'yellow'
    check (color in ('yellow','green','blue','pink','lilac','orange','red','gray')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sticky_notes
  add column if not exists group_id uuid
  references public.sticky_note_groups(id) on delete set null;

create index if not exists idx_sticky_notes_group_id on public.sticky_notes(group_id);
create index if not exists idx_sticky_note_groups_user on public.sticky_note_groups(user_id);

alter table public.sticky_note_groups enable row level security;
drop policy if exists "Users manage their sticky note groups" on public.sticky_note_groups;
create policy "Users manage their sticky note groups"
on public.sticky_note_groups for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.sticky_note_groups to authenticated;

create or replace function public.validate_sticky_note_group_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.group_id is not null and not exists (
    select 1 from public.sticky_note_groups g
    where g.id = new.group_id and g.user_id = new.user_id
  ) then
    raise exception 'O grupo selecionado não pertence ao usuário desta nota.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_sticky_note_group_owner on public.sticky_notes;
create trigger trg_validate_sticky_note_group_owner
before insert or update of group_id, user_id on public.sticky_notes
for each row execute function public.validate_sticky_note_group_owner();

commit;
