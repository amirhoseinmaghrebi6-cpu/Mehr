-- Phase 3.5 E1: every home has a time zone. Scenario times and dates are in the home's time zone,
-- never the phone's (a user in Istanbul runs a Tehran home on Tehran time). Additive.

-- An IANA time zone PostgreSQL knows, e.g. 'Asia/Tehran' (it handles daylight saving too).
create or replace function public.is_time_zone(value text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = value);
$$;
revoke all on function public.is_time_zone(text) from public, anon;
grant execute on function public.is_time_zone(text) to authenticated, service_role;

alter table public.properties add column if not exists time_zone text not null default 'Asia/Tehran';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_time_zone_check') then
    alter table public.properties add constraint properties_time_zone_check check (public.is_time_zone(time_zone));
  end if;
end;
$$;

-- Owners and admins of a home may change its time zone, like its other details.
grant update (time_zone) on public.properties to authenticated;
