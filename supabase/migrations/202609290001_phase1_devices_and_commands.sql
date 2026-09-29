-- Phase 1 device foundation: hubs, devices, capabilities, reported state, commands,
-- command attempts, and realtime events. Additive only; earlier migrations are unchanged.
--
-- Tenant boundary: every table carries property_id, and composite foreign keys force each
-- child row to share its parent's property_id, so a row can never point across properties.
--
-- Write boundary: authenticated clients may only read, plus insert pending commands.
-- Hubs, devices, capabilities, reported state, command progress, attempts, and events are
-- written by the backend using the service role, which bypasses RLS.

-- Properties: stable per-organization slug used by routes (e.g. /homes/tehran).
alter table public.properties add column if not exists slug text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_slug_format') then
    alter table public.properties
      add constraint properties_slug_format check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
end;
$$;

create unique index if not exists properties_organization_id_slug_key
  on public.properties (organization_id, slug)
  where slug is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create table if not exists public.hubs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  name text not null,
  -- Non-secret hardware identifier; broker credentials never live in this table.
  hardware_id text not null unique,
  status text not null default 'offline' check (status in ('provisioning', 'online', 'offline')),
  firmware_version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id)
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  hub_id uuid not null,
  -- Hub-local address of the device (e.g. ESP32 node id).
  external_id text not null,
  name text not null,
  kind text not null check (kind in ('light', 'climate', 'curtain', 'lock', 'air', 'plug', 'switch', 'sensor')),
  -- Temporary denormalized placeholder until rooms get their own table.
  room_name text,
  online boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (hub_id, external_id),
  foreign key (hub_id, property_id) references public.hubs (id, property_id) on delete cascade
);

create table if not exists public.device_capabilities (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  device_id uuid not null,
  capability text not null check (capability ~ '^[a-z][a-z0-9_]*$'),
  value_type text not null check (value_type in ('boolean', 'integer', 'number', 'enum')),
  min_value numeric,
  max_value numeric,
  step numeric check (step is null or step > 0),
  enum_values text[],
  unit text,
  writable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, capability),
  foreign key (device_id, property_id) references public.devices (id, property_id) on delete cascade,
  check (min_value is null or max_value is null or min_value <= max_value),
  check ((value_type = 'enum') = (enum_values is not null and cardinality(enum_values) > 0)),
  check (value_type in ('integer', 'number') or (min_value is null and max_value is null and step is null))
);

-- Last device-reported value per capability. Only the backend writes this table.
create table if not exists public.device_states (
  property_id uuid not null,
  device_id uuid not null,
  capability text not null,
  value jsonb not null check (jsonb_typeof(value) in ('boolean', 'number', 'string')),
  reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (device_id, capability),
  foreign key (device_id, property_id) references public.devices (id, property_id) on delete cascade,
  foreign key (device_id, capability) references public.device_capabilities (device_id, capability) on delete cascade
);

create table if not exists public.device_commands (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  device_id uuid not null,
  capability text not null,
  -- Absolute desired value (e.g. brightness 40), never a relative delta.
  target_value jsonb not null check (jsonb_typeof(target_value) in ('boolean', 'number', 'string')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'applied', 'rejected', 'failed', 'timed_out')),
  -- Hub acknowledgement means "received", not "applied"; applied requires confirmed device state.
  acknowledged_at timestamptz,
  sent_at timestamptz,
  applied_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 seconds',
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, idempotency_key),
  foreign key (device_id, property_id) references public.devices (id, property_id) on delete cascade,
  foreign key (device_id, capability) references public.device_capabilities (device_id, capability) on delete cascade,
  check ((status = 'applied') = (applied_at is not null)),
  check ((status in ('applied', 'rejected', 'failed', 'timed_out')) = (completed_at is not null))
);

create table if not exists public.command_attempts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  command_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  outcome text not null default 'sent' check (outcome in ('sent', 'acknowledged', 'applied', 'rejected', 'failed', 'timed_out')),
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (command_id, attempt_number),
  foreign key (command_id, property_id) references public.device_commands (id, property_id) on delete cascade
);

-- Append-only feed that Supabase Realtime delivers to property members. Payloads are hints
-- to refresh authoritative state, never proof of authorization.
create table if not exists public.realtime_events (
  id bigint generated always as identity primary key,
  property_id uuid not null references public.properties (id) on delete cascade,
  event_type text not null check (event_type in ('device.state_changed', 'device.connectivity_changed', 'command.status_changed', 'hub.status_changed')),
  device_id uuid,
  command_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (device_id, property_id) references public.devices (id, property_id) on delete cascade,
  foreign key (command_id, property_id) references public.device_commands (id, property_id) on delete cascade
);

create index if not exists hubs_property_id_idx on public.hubs (property_id);
create index if not exists devices_property_id_idx on public.devices (property_id);
create index if not exists device_capabilities_property_id_idx on public.device_capabilities (property_id);
create index if not exists device_states_property_id_idx on public.device_states (property_id);
create index if not exists device_commands_property_id_created_at_idx on public.device_commands (property_id, created_at desc);
create index if not exists device_commands_device_id_idx on public.device_commands (device_id, capability);
create index if not exists device_commands_open_idx on public.device_commands (expires_at) where status in ('pending', 'sent');
create index if not exists command_attempts_property_id_idx on public.command_attempts (property_id);
create index if not exists realtime_events_property_id_id_idx on public.realtime_events (property_id, id desc);

drop trigger if exists hubs_set_updated_at on public.hubs;
create trigger hubs_set_updated_at before update on public.hubs
  for each row execute function public.set_updated_at();
drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at before update on public.devices
  for each row execute function public.set_updated_at();
drop trigger if exists device_capabilities_set_updated_at on public.device_capabilities;
create trigger device_capabilities_set_updated_at before update on public.device_capabilities
  for each row execute function public.set_updated_at();
drop trigger if exists device_states_set_updated_at on public.device_states;
create trigger device_states_set_updated_at before update on public.device_states
  for each row execute function public.set_updated_at();
drop trigger if exists device_commands_set_updated_at on public.device_commands;
create trigger device_commands_set_updated_at before update on public.device_commands
  for each row execute function public.set_updated_at();

-- Rejects commands whose target is not a valid absolute value for a writable capability.
create or replace function public.validate_device_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap public.device_capabilities%rowtype;
  numeric_target numeric;
begin
  select * into cap
  from public.device_capabilities
  where device_id = new.device_id and capability = new.capability;

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
    if (cap.min_value is not null and numeric_target < cap.min_value)
      or (cap.max_value is not null and numeric_target > cap.max_value) then
      raise exception 'Target for % is outside [%, %]', new.capability, cap.min_value, cap.max_value using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_device_command() from public, anon, authenticated;

drop trigger if exists device_commands_validate on public.device_commands;
create trigger device_commands_validate before insert or update of device_id, capability, target_value on public.device_commands
  for each row execute function public.validate_device_command();

alter table public.hubs enable row level security;
alter table public.devices enable row level security;
alter table public.device_capabilities enable row level security;
alter table public.device_states enable row level security;
alter table public.device_commands enable row level security;
alter table public.command_attempts enable row level security;
alter table public.realtime_events enable row level security;

create policy "hubs_select_property_members" on public.hubs
  for select to authenticated
  using (public.is_property_member(property_id));

create policy "devices_select_property_members" on public.devices
  for select to authenticated
  using (public.is_property_member(property_id));

create policy "device_capabilities_select_property_members" on public.device_capabilities
  for select to authenticated
  using (public.is_property_member(property_id));

create policy "device_states_select_property_members" on public.device_states
  for select to authenticated
  using (public.is_property_member(property_id));

create policy "device_commands_select_property_members" on public.device_commands
  for select to authenticated
  using (public.is_property_member(property_id));

-- Guests and viewers cannot issue commands in Phase 1. Column grants below keep status,
-- requester, and progress fields at their server-controlled defaults.
create policy "device_commands_insert_operators" on public.device_commands
  for insert to authenticated
  with check (
    public.has_property_role(property_id, array['owner', 'admin', 'member'])
    and requested_by = (select auth.uid())
    and status = 'pending'
  );

-- Delivery diagnostics are limited to property administrators.
create policy "command_attempts_select_property_admins" on public.command_attempts
  for select to authenticated
  using (public.has_property_role(property_id, array['owner', 'admin']));

create policy "realtime_events_select_property_members" on public.realtime_events
  for select to authenticated
  using (public.is_property_member(property_id));

-- Supabase grants ALL on new public tables to anon and authenticated by default; replace
-- that with the minimum each role needs.
revoke all on public.hubs, public.devices, public.device_capabilities, public.device_states,
  public.device_commands, public.command_attempts, public.realtime_events from anon, authenticated;

grant select on public.hubs, public.devices, public.device_capabilities, public.device_states,
  public.device_commands, public.command_attempts, public.realtime_events to authenticated;
grant insert (property_id, device_id, capability, target_value, idempotency_key) on public.device_commands to authenticated;

grant all on public.hubs, public.devices, public.device_capabilities, public.device_states,
  public.device_commands, public.command_attempts, public.realtime_events to service_role;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'realtime_events'
  ) then
    alter publication supabase_realtime add table public.realtime_events;
  end if;
end;
$$;
