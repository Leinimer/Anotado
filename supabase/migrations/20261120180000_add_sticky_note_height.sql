-- ANOTADO: Adiciona persistência de altura manual (height_px) aos Sticks (public.sticky_notes).
-- Idempotente e não destrutiva: Sticks existentes mantêm height_px = null (altura automática)
-- até serem redimensionados manualmente pela borda inferior ou pela quina inferior direita.

begin;

alter table public.sticky_notes
  add column if not exists height_px integer null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sticky_notes_height_px_range'
      and conrelid = 'public.sticky_notes'::regclass
  ) then
    alter table public.sticky_notes
      add constraint sticky_notes_height_px_range
      check (height_px is null or (height_px >= 120 and height_px <= 1600));
  end if;
end
$$;

commit;
