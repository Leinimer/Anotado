alter table public.sticky_notes
  add column if not exists height_px integer null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sticky_notes_height_px_range_check'
      and conrelid = 'public.sticky_notes'::regclass
  ) then
    alter table public.sticky_notes
      add constraint sticky_notes_height_px_range_check
      check (height_px is null or height_px between 140 and 1000);
  end if;
end
$$;
