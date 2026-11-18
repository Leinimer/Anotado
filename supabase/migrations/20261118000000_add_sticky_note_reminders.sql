-- Lembretes dos Sticks: um agendamento por Stick e várias ocorrências (uma por antecedência).
begin;

create table if not exists public.sticky_note_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sticky_note_id uuid not null unique references public.sticky_notes(id) on delete cascade,
  target_date date not null,
  target_time time without time zone not null default '09:00',
  time_zone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sticky_note_reminder_alerts (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.sticky_note_reminders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sticky_note_id uuid not null references public.sticky_notes(id) on delete cascade,
  target_date date not null,
  target_time time without time zone not null,
  time_zone text not null default 'America/Sao_Paulo',
  offset_days smallint not null check (offset_days in (0, 1, 2, 3, 5, 7, 14, 30)),
  scheduled_at timestamptz not null,
  triggered_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_sticky_note_reminders_user
  on public.sticky_note_reminders(user_id);
create index if not exists idx_sticky_note_reminder_alerts_due
  on public.sticky_note_reminder_alerts(user_id, scheduled_at)
  where triggered_at is null;
create index if not exists idx_sticky_note_reminder_alerts_history
  on public.sticky_note_reminder_alerts(user_id, triggered_at desc)
  where triggered_at is not null;
create index if not exists idx_sticky_note_reminder_alerts_note
  on public.sticky_note_reminder_alerts(sticky_note_id, scheduled_at);

create or replace function public.set_sticky_note_reminders_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sticky_note_reminders_updated_at on public.sticky_note_reminders;
create trigger trg_sticky_note_reminders_updated_at
before update on public.sticky_note_reminders
for each row execute function public.set_sticky_note_reminders_updated_at();

alter table public.sticky_note_reminders enable row level security;
alter table public.sticky_note_reminder_alerts enable row level security;

drop policy if exists "Users manage their sticky note reminders" on public.sticky_note_reminders;
create policy "Users manage their sticky note reminders"
on public.sticky_note_reminders
for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.sticky_notes sn
    where sn.id = sticky_note_id and sn.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.sticky_notes sn
    where sn.id = sticky_note_id and sn.user_id = (select auth.uid())
  )
);

drop policy if exists "Users manage their sticky note reminder alerts" on public.sticky_note_reminder_alerts;
create policy "Users manage their sticky note reminder alerts"
on public.sticky_note_reminder_alerts
for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.sticky_note_reminders r
    where r.id = reminder_id and r.user_id = (select auth.uid())
      and r.sticky_note_id = sticky_note_id
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.sticky_note_reminders r
    where r.id = reminder_id and r.user_id = (select auth.uid())
      and r.sticky_note_id = sticky_note_id
  )
);

grant select, insert, update, delete on public.sticky_note_reminders to authenticated;
grant select, insert, update, delete on public.sticky_note_reminder_alerts to authenticated;

commit;
