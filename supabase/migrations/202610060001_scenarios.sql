-- Phase 3.5 E2: scenarios. Additive; earlier migrations are unchanged.
--
-- Three kinds, one model:
-- - periodic: on chosen weekdays at a local time (e.g. Saturdays and Tuesdays at 15:00);
-- - one_time: once, on a local date at a local time (dates are Gregorian; the app converts from
--   Solar Hijri);
-- - themed: a named set of actions run by a tap ("Morning", "Party").
-- Times and dates are in the home's time zone (properties.time_zone), never the phone's.
--
-- Scenarios run on the home's hub (local-first; the dev hub simulator until Phase 4). Each action
-- becomes an ordinary device command (deadline, applied only when the ESP32 reports), linked to
-- the run it came from. Each scheduled occurrence runs at most once: a periodic one that is more
-- than 2 minutes late is skipped and recorded as missed (never run late); a one-time one gets 10
-- minutes.

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('periodic', 'one_time', 'themed')),
  enabled boolean not null default true,
  -- 0 = Sunday … 6 = Saturday (as extract(dow)); the same in every calendar.
  weekdays smallint[],
  local_time time(0),
  local_date date,
  -- Occurrences before this moment never run and are never reported missed (it moves when the
  -- schedule changes or the scenario is switched on).
  schedule_from timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  check (
    (kind = 'periodic' and weekdays is not null and cardinality(weekdays) between 1 and 7
      and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and local_time is not null and local_date is null)
    or (kind = 'one_time' and weekdays is null and local_time is not null and local_date is not null)
    or (kind = 'themed' and weekdays is null and local_time is null and local_date is null)
  )
);
create unique index if not exists scenarios_property_id_name_key on public.scenarios (property_id, lower(btrim(name)));
create index if not exists scenarios_scheduled_idx on public.scenarios (property_id) where enabled and kind <> 'themed';

drop trigger if exists scenarios_set_updated_at on public.scenarios;
create trigger scenarios_set_updated_at before update on public.scenarios
  for each row execute function public.set_updated_at();

create or replace function public.scenarios_reset_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind or new.weekdays is distinct from old.weekdays or new.local_time is distinct from old.local_time
    or new.local_date is distinct from old.local_date or (new.enabled and not old.enabled) then
    new.schedule_from := now();
  end if;
  return new;
end;
$$;
revoke all on function public.scenarios_reset_schedule() from public, anon, authenticated;
drop trigger if exists scenarios_reset_schedule on public.scenarios;
create trigger scenarios_reset_schedule before update on public.scenarios
  for each row execute function public.scenarios_reset_schedule();

-- What a scenario does: absolute target values for capabilities of devices of the same home.
create table if not exists public.scenario_actions (
  scenario_id uuid not null,
  property_id uuid not null,
  position smallint not null check (position between 0 and 49),
  device_id uuid not null,
  capability text not null,
  target_value jsonb not null check (jsonb_typeof(target_value) in ('boolean', 'number', 'string')),
  primary key (scenario_id, position),
  unique (scenario_id, device_id, capability),
  foreign key (scenario_id, property_id) references public.scenarios (id, property_id) on delete cascade,
  foreign key (device_id, property_id) references public.devices (id, property_id) on delete cascade,
  foreign key (device_id, capability) references public.device_capabilities (device_id, capability) on delete cascade
);
create index if not exists scenario_actions_device_id_idx on public.scenario_actions (device_id);

-- The same rules as validate_device_command: a writable capability and a valid absolute value.
create or replace function public.validate_scenario_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap public.device_capabilities%rowtype;
  numeric_target numeric;
begin
  select * into cap from public.device_capabilities where device_id = new.device_id and capability = new.capability;
  if not found then
    raise exception 'Unknown capability % for device %', new.capability, new.device_id using errcode = '23503';
  end if;
  if not cap.writable then
    raise exception 'Capability % is read-only', new.capability using errcode = '22023';
  end if;
  if cap.value_type = 'boolean' then
    if jsonb_typeof(new.target_value) <> 'boolean' then
      raise exception 'Capability % requires a boolean target', new.capability using errcode = '22023';
    end if;
  elsif cap.value_type = 'enum' then
    if jsonb_typeof(new.target_value) <> 'string' or not ((new.target_value #>> '{}') = any (cap.enum_values)) then
      raise exception 'Capability % requires one of %', new.capability, cap.enum_values using errcode = '22023';
    end if;
  else
    if jsonb_typeof(new.target_value) <> 'number' then
      raise exception 'Capability % requires a numeric target', new.capability using errcode = '22023';
    end if;
    numeric_target := (new.target_value #>> '{}')::numeric;
    if cap.value_type = 'integer' and numeric_target <> trunc(numeric_target) then
      raise exception 'Capability % requires an integer target', new.capability using errcode = '22023';
    end if;
    if (cap.min_value is not null and numeric_target < cap.min_value) or (cap.max_value is not null and numeric_target > cap.max_value) then
      raise exception 'Target for % is outside [%, %]', new.capability, cap.min_value, cap.max_value using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_scenario_action() from public, anon, authenticated;
drop trigger if exists scenario_actions_validate on public.scenario_actions;
create trigger scenario_actions_validate before insert or update on public.scenario_actions
  for each row execute function public.validate_scenario_action();

-- Each time a scenario ran, or a scheduled occurrence was missed.
create table if not exists public.scenario_runs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  scenario_id uuid not null,
  trigger text not null check (trigger in ('schedule', 'manual')),
  -- The occurrence a scheduled run belongs to (null for a tap).
  scheduled_for timestamptz,
  status text not null default 'started' check (status in ('started', 'missed')),
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  -- Each occurrence runs (or is missed) exactly once, even if the runner restarts.
  unique (scenario_id, scheduled_for),
  foreign key (scenario_id, property_id) references public.scenarios (id, property_id) on delete cascade,
  check ((trigger = 'schedule') = (scheduled_for is not null)),
  check (status = 'started' or trigger = 'schedule')
);
create index if not exists scenario_runs_scenario_id_created_at_idx on public.scenario_runs (scenario_id, created_at desc);

-- Commands remember the run they came from (device history: "from scenario X").
alter table public.device_commands add column if not exists scenario_run_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_commands_scenario_run_fkey') then
    alter table public.device_commands add constraint device_commands_scenario_run_fkey
      foreign key (scenario_run_id, property_id) references public.scenario_runs (id, property_id) on delete set null (scenario_run_id);
  end if;
end;
$$;
create index if not exists device_commands_scenario_run_id_idx on public.device_commands (scenario_run_id) where scenario_run_id is not null;
grant insert (scenario_run_id) on public.device_commands to authenticated;

-- The latest occurrence at or before p_now of every enabled scheduled scenario (in its home's
-- time zone), that is not before the scenario's schedule_from. The runner decides from the
-- lateness whether it runs or is missed.
create or replace function public.scenario_due_occurrences(p_now timestamptz)
returns table (scenario_id uuid, property_id uuid, kind text, scheduled_for timestamptz)
language sql
stable
set search_path = ''
as $$
  select scenario.id, scenario.property_id, scenario.kind, occurrence.at
  from public.scenarios as scenario
  join public.properties as property on property.id = scenario.property_id
  cross join lateral (
    select max((day + scenario.local_time) at time zone property.time_zone) as at
    from generate_series(-7, 0) as offset_days
    cross join lateral (select (p_now at time zone property.time_zone)::date + offset_days as day) as days
    where scenario.kind = 'periodic'
      and extract(dow from day)::smallint = any (scenario.weekdays)
      and ((day + scenario.local_time) at time zone property.time_zone) <= p_now
    union all
    select (scenario.local_date + scenario.local_time) at time zone property.time_zone
    where scenario.kind = 'one_time'
      and ((scenario.local_date + scenario.local_time) at time zone property.time_zone) <= p_now
  ) as occurrence
  where scenario.enabled and scenario.kind <> 'themed'
    and occurrence.at is not null and occurrence.at >= scenario.schedule_from;
$$;
revoke all on function public.scenario_due_occurrences(timestamptz) from public, anon, authenticated;
grant execute on function public.scenario_due_occurrences(timestamptz) to service_role;

-- The next occurrence after p_now of one scenario that has not run yet (for "next run" in the
-- app; null for a one-time scenario that is over).
create or replace function public.scenario_next_occurrence(p_scenario_id uuid, p_now timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select min(candidate.at)
  from public.scenarios as scenario
  join public.properties as property on property.id = scenario.property_id
  cross join lateral (
    select (day + scenario.local_time) at time zone property.time_zone as at
    from generate_series(0, 7) as offset_days
    cross join lateral (select (p_now at time zone property.time_zone)::date + offset_days as day) as days
    where scenario.kind = 'periodic' and extract(dow from day)::smallint = any (scenario.weekdays)
    union all
    select (scenario.local_date + scenario.local_time) at time zone property.time_zone
    where scenario.kind = 'one_time'
  ) as candidate
  where scenario.id = p_scenario_id and scenario.enabled and candidate.at > p_now
    and candidate.at >= scenario.schedule_from
    and not exists (select 1 from public.scenario_runs as run where run.scenario_id = scenario.id and run.scheduled_for = candidate.at);
$$;
revoke all on function public.scenario_next_occurrence(uuid, timestamptz) from public, anon;
grant execute on function public.scenario_next_occurrence(uuid, timestamptz) to authenticated, service_role;

-- RLS: every member sees a home's scenarios and runs; owners and admins edit them; any member may
-- run one by a tap (a manual run, as themselves).
alter table public.scenarios enable row level security;
alter table public.scenario_actions enable row level security;
alter table public.scenario_runs enable row level security;

create policy "scenarios_select_members" on public.scenarios for select to authenticated using (public.is_property_member(property_id));
create policy "scenarios_insert_admins" on public.scenarios for insert to authenticated with check (public.has_property_role(property_id, array['owner', 'admin']));
create policy "scenarios_update_admins" on public.scenarios for update to authenticated
  using (public.has_property_role(property_id, array['owner', 'admin'])) with check (public.has_property_role(property_id, array['owner', 'admin']));
create policy "scenarios_delete_admins" on public.scenarios for delete to authenticated using (public.has_property_role(property_id, array['owner', 'admin']));

create policy "scenario_actions_select_members" on public.scenario_actions for select to authenticated using (public.is_property_member(property_id));
create policy "scenario_actions_insert_admins" on public.scenario_actions for insert to authenticated with check (public.has_property_role(property_id, array['owner', 'admin']));
create policy "scenario_actions_delete_admins" on public.scenario_actions for delete to authenticated using (public.has_property_role(property_id, array['owner', 'admin']));

create policy "scenario_runs_select_members" on public.scenario_runs for select to authenticated using (public.is_property_member(property_id));
create policy "scenario_runs_insert_manual" on public.scenario_runs for insert to authenticated
  with check (public.has_property_role(property_id, array['owner', 'admin', 'member']) and trigger = 'manual' and requested_by = (select auth.uid()));

revoke all on public.scenarios, public.scenario_actions, public.scenario_runs from anon, authenticated;
grant select, delete on public.scenarios to authenticated;
grant insert (property_id, name, kind, enabled, weekdays, local_time, local_date) on public.scenarios to authenticated;
grant update (name, kind, enabled, weekdays, local_time, local_date) on public.scenarios to authenticated;
grant select, delete on public.scenario_actions to authenticated;
grant insert (scenario_id, property_id, position, device_id, capability, target_value) on public.scenario_actions to authenticated;
grant select on public.scenario_runs to authenticated;
grant insert (property_id, scenario_id, trigger) on public.scenario_runs to authenticated;
