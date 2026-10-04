-- Phase 3.5 D: the user's display preferences, stored on the account so they follow the user to
-- every device and browser. Additive; earlier migrations are unchanged.
--
-- Values are always stored in one unit (°C, Gregorian dates); these settings only change how the
-- app shows them. Keep the choices in sync with packages/contracts/src/settings.ts.
alter table public.profiles add column if not exists language text not null default 'en';
alter table public.profiles add column if not exists calendar text not null default 'solar_hijri';
alter table public.profiles add column if not exists temperature_unit text not null default 'celsius';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_settings_check') then
    alter table public.profiles add constraint profiles_settings_check check (
      language in ('fa', 'en', 'ar')
      and calendar in ('solar_hijri', 'gregorian')
      and temperature_unit in ('celsius', 'fahrenheit')
    );
  end if;
end;
$$;

-- The existing profiles policies already limit reads and writes to the user's own row. Narrow the
-- column rights: a user may change their name and preferences, never their user id.
revoke update on public.profiles from authenticated;
grant update (full_name, language, calendar, temperature_unit) on public.profiles to authenticated;
