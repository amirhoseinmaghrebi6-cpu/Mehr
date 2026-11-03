-- The home's energy use, from its energy meters' running totals (backend/src/devices/reports.ts).
-- The only history the server keeps, and it never grows with time: hourly use for the last 7 days,
-- daily use (the day of the home's time zone) for the last 12 months; the cleanup job deletes the
-- rest. Only the backend writes; members read their home's rows. Additive.

create table if not exists public.energy_hourly (
  device_id uuid not null,
  property_id uuid not null,
  hour timestamptz not null,
  energy_kwh numeric(12, 3) not null check (energy_kwh >= 0),
  primary key (device_id, hour),
  foreign key (device_id, property_id) references public.devices (id, property_id) on delete cascade
);
create index if not exists energy_hourly_property_hour_idx on public.energy_hourly (property_id, hour);
create index if not exists energy_hourly_hour_idx on public.energy_hourly (hour);

create table if not exists public.energy_daily (
  device_id uuid not null,
  property_id uuid not null,
  day date not null,
  energy_kwh numeric(12, 3) not null check (energy_kwh >= 0),
  -- The meter's total at its last report, to count the next report's difference.
  last_reading_kwh numeric(14, 3) not null check (last_reading_kwh >= 0),
  primary key (device_id, day),
  foreign key (device_id, property_id) references public.devices (id, property_id) on delete cascade
);
create index if not exists energy_daily_property_day_idx on public.energy_daily (property_id, day);
create index if not exists energy_daily_day_idx on public.energy_daily (day);

alter table public.energy_hourly enable row level security;
alter table public.energy_daily enable row level security;

drop policy if exists "energy_hourly_select_members" on public.energy_hourly;
create policy "energy_hourly_select_members" on public.energy_hourly for select to authenticated
  using (public.is_property_member(property_id));
drop policy if exists "energy_daily_select_members" on public.energy_daily;
create policy "energy_daily_select_members" on public.energy_daily for select to authenticated
  using (public.is_property_member(property_id));

revoke all on public.energy_hourly, public.energy_daily from anon, authenticated;
grant select on public.energy_hourly, public.energy_daily to authenticated;
grant select, insert, update, delete on public.energy_hourly, public.energy_daily to service_role;
