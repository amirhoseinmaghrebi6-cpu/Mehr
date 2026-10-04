-- The user's colour palette, stored on the account like the other display preferences, so it
-- follows the user to every device. Additive. Keep the choices in sync with
-- packages/contracts/src/settings.ts and scripts/palettes.mjs.
alter table public.profiles add column if not exists palette text not null default 'sage';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_palette_check') then
    alter table public.profiles add constraint profiles_palette_check
      check (palette in ('sage', 'ocean', 'violet', 'rose', 'sand', 'graphite'));
  end if;
end;
$$;

grant update (palette) on public.profiles to authenticated;
