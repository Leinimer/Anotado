-- Permite ordenar manualmente os campos do quadro Stick.
begin;

alter table public.sticky_note_groups
  add column if not exists sort_order integer not null default 0;

with ordered_groups as (
  select id, row_number() over (
    partition by user_id
    order by created_at asc, id asc
  ) - 1 as position
  from public.sticky_note_groups
)
update public.sticky_note_groups groups
set sort_order = ordered_groups.position
from ordered_groups
where groups.id = ordered_groups.id;

create index if not exists idx_sticky_note_groups_user_sort
  on public.sticky_note_groups(user_id, sort_order, created_at);

create or replace function public.reorder_sticky_note_groups(p_group_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Autenticação necessária para ordenar os campos.';
  end if;

  if coalesce(cardinality(p_group_ids), 0) <> (
    select count(*) from public.sticky_note_groups where user_id = auth.uid()
  ) then
    raise exception 'A lista de campos está incompleta ou desatualizada.';
  end if;

  if exists (
    select 1
    from unnest(p_group_ids) as item(id)
    group by item.id
    having count(*) > 1
  ) then
    raise exception 'A lista contém campos duplicados.';
  end if;

  if exists (
    select id from public.sticky_note_groups where user_id = auth.uid()
    except
    select unnest(p_group_ids)
  ) then
    raise exception 'A lista contém campos inválidos.';
  end if;

  update public.sticky_note_groups as groups
  set sort_order = ordered.ordinality::integer - 1,
      updated_at = now()
  from unnest(p_group_ids) with ordinality as ordered(id, ordinality)
  where groups.id = ordered.id
    and groups.user_id = auth.uid();
end;
$$;

grant execute on function public.reorder_sticky_note_groups(uuid[]) to authenticated;

commit;
