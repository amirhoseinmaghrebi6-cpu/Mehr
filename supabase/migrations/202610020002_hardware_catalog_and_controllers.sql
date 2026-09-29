-- Phase 3B (2/2): hardware catalog, controllers (the ESP32 boards in a home) and devices built
-- from them. Additive; earlier migrations are unchanged.
--
-- Every device is one channel of an M2smart ESP32 board. The board model (catalog) fixes which
-- GPIO does what; that is decided in the PCB design, maintained only by M2smart, and never
-- visible to or editable by users. A board belongs to exactly one home, and composite foreign
-- keys make it impossible for a device to point at another home's board, room or hub.

-- Device types; keep in sync with deviceTypes in packages/contracts/src/catalog.ts
-- (backend/test/catalog-sync.test.ts checks this).
create table if not exists public.device_types (
  type text primary key check (type ~ '^[a-z][a-z0-9_]*$')
);
insert into public.device_types (type) values
  ('switch'), ('dimmer'), ('socket'), ('cooler'), ('fan'), ('curtain'), ('garage_door'), ('alarm'),
  ('motion_sensor'), ('presence_sensor'), ('contact_sensor'), ('leak_sensor'), ('smoke_sensor'),
  ('co_sensor'), ('air_quality_sensor'), ('humidity_sensor'), ('light_sensor'), ('energy_meter')
on conflict do nothing;

-- Which ESP32 (classic, e.g. WROOM-32) GPIO may carry which function.
-- - Never: 6–11 (SPI flash), 1 and 3 (UART0, boot log), 20/24/28–31 (do not exist).
-- - Not for anything, as boot straps: 0, 2, 5, 12, 15 (level at reset changes the boot mode or
--   they pulse at boot).
-- - Not for outputs: 14 (pulses at boot, could click a relay), 34–39 (input only).
-- - ADC only on ADC1 (32–39): ADC2 does not work while Wi-Fi is on.
-- Boards on other chips (ESP32-S3, -C3, ...) need their own list before they can be added.
create or replace function public.esp32_pin_allowed(gpio smallint, pin_function text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when pin_function in ('relay', 'triac_gate', 'i2c_sda', 'i2c_scl', 'uart_tx') then
      gpio in (4, 13, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33)
    when pin_function in ('digital_in', 'zero_cross', 'pulse_in', 'uart_rx') then
      gpio in (4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39)
    when pin_function = 'adc' then
      gpio between 32 and 39
    else false
  end;
$$;
revoke all on function public.esp32_pin_allowed(smallint, text) from public, anon, authenticated;

create table if not exists public.hardware_models (
  id uuid primary key default gen_random_uuid(),
  -- Model and revision, e.g. 'switch-2ch-rev-a'. A changed PCB is a new model, never an edit.
  code text not null unique check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(code) <= 64),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  chip text not null default 'esp32' check (chip = 'esp32'),
  created_at timestamptz not null default now()
);

-- The devices a board exposes; each board channel becomes one device in the home.
create table if not exists public.hardware_model_channels (
  model_id uuid not null references public.hardware_models (id) on delete cascade,
  channel_key text not null check (channel_key ~ '^[a-z][a-z0-9_]*$' and char_length(channel_key) <= 32),
  device_type text not null references public.device_types (type),
  default_name text not null check (char_length(btrim(default_name)) between 1 and 60),
  primary key (model_id, channel_key),
  unique (model_id, channel_key, device_type)
);

-- Pin map. One row per GPIO, so no GPIO can serve two purposes on a board. A pin without a
-- channel is shared by the board (e.g. one zero-cross input or one I2C bus for several channels).
create table if not exists public.hardware_model_pins (
  model_id uuid not null references public.hardware_models (id) on delete cascade,
  gpio smallint not null,
  function text not null check (function in ('relay', 'triac_gate', 'zero_cross', 'digital_in', 'pulse_in', 'i2c_sda', 'i2c_scl', 'uart_rx', 'uart_tx', 'adc')),
  channel_key text,
  -- What the pin does for its channel, e.g. 'relay', 'wall_switch', 'low', 'high', 'pump',
  -- 'open', 'close', 'door_sensor'.
  role text not null check (role ~ '^[a-z][a-z0-9_]*$' and char_length(role) <= 32),
  primary key (model_id, gpio),
  unique (model_id, gpio, function),
  foreign key (model_id, channel_key) references public.hardware_model_channels (model_id, channel_key) on delete cascade,
  check (public.esp32_pin_allowed(gpio, function))
);

-- Capability template per channel; copied into device_capabilities when a board is added to a home.
create table if not exists public.hardware_model_capabilities (
  model_id uuid not null,
  channel_key text not null,
  capability text not null check (capability ~ '^[a-z][a-z0-9_]*$'),
  value_type text not null check (value_type in ('boolean', 'integer', 'number', 'enum')),
  min_value numeric,
  max_value numeric,
  step numeric check (step is null or step > 0),
  enum_values text[],
  unit text,
  writable boolean not null,
  primary key (model_id, channel_key, capability),
  foreign key (model_id, channel_key) references public.hardware_model_channels (model_id, channel_key) on delete cascade,
  check (min_value is null or max_value is null or min_value <= max_value),
  check ((value_type = 'enum') = (enum_values is not null and cardinality(enum_values) > 0)),
  check (value_type in ('integer', 'number') or (min_value is null and max_value is null and step is null))
);

-- Relays of one group must never be on at the same time (cooler low/high, curtain open/close).
-- Stored as data so the firmware, the hub and the dev simulator enforce the same rule.
create table if not exists public.hardware_model_interlocks (
  model_id uuid not null,
  group_key text not null check (group_key ~ '^[a-z][a-z0-9_]*$'),
  gpio smallint not null,
  function text not null default 'relay' check (function = 'relay'),
  primary key (model_id, group_key, gpio),
  foreign key (model_id, gpio, function) references public.hardware_model_pins (model_id, gpio, function) on delete cascade
);

-- The ESP32 boards installed in homes.
create table if not exists public.controllers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  hub_id uuid not null,
  model_id uuid not null references public.hardware_models (id) on delete restrict,
  -- Factory identity of the board (e.g. from its QR code); unique across all homes.
  hardware_uid text not null unique check (hardware_uid ~ '^[A-Za-z0-9:_-]{4,64}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  firmware_version text,
  online boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (id, hub_id),
  unique (id, model_id),
  foreign key (hub_id, property_id) references public.hubs (id, property_id) on delete cascade
);
create index if not exists controllers_property_id_idx on public.controllers (property_id);
create index if not exists controllers_hub_id_idx on public.controllers (hub_id);

drop trigger if exists controllers_set_updated_at on public.controllers;
create trigger controllers_set_updated_at before update on public.controllers
  for each row execute function public.set_updated_at();

-- A board never changes home, model or identity; to move it, remove it and add it again.
create or replace function public.protect_controller_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.property_id <> old.property_id or new.model_id <> old.model_id or new.hardware_uid <> old.hardware_uid then
    raise exception 'A controller''s home, model and hardware id cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_controller_identity() from public, anon, authenticated;
drop trigger if exists controllers_protect_identity on public.controllers;
create trigger controllers_protect_identity before update on public.controllers
  for each row execute function public.protect_controller_identity();

-- A model in use by any board is frozen: changing its pins or channels would silently change
-- what real hardware does. A new PCB revision is a new model.
create or replace function public.protect_hardware_model_in_use()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected uuid[];
begin
  affected := case tg_op
    when 'INSERT' then array[new.model_id]
    when 'DELETE' then array[old.model_id]
    else array[old.model_id, new.model_id]
  end;
  if exists (select 1 from public.controllers where model_id = any (affected)) then
    raise exception 'Hardware model is in use by installed boards and cannot change; add a new model revision instead'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.protect_hardware_model_in_use() from public, anon, authenticated;

drop trigger if exists hardware_model_channels_protect on public.hardware_model_channels;
create trigger hardware_model_channels_protect before insert or update or delete on public.hardware_model_channels
  for each row execute function public.protect_hardware_model_in_use();
drop trigger if exists hardware_model_pins_protect on public.hardware_model_pins;
create trigger hardware_model_pins_protect before insert or update or delete on public.hardware_model_pins
  for each row execute function public.protect_hardware_model_in_use();
drop trigger if exists hardware_model_capabilities_protect on public.hardware_model_capabilities;
create trigger hardware_model_capabilities_protect before insert or update or delete on public.hardware_model_capabilities
  for each row execute function public.protect_hardware_model_in_use();
drop trigger if exists hardware_model_interlocks_protect on public.hardware_model_interlocks;
create trigger hardware_model_interlocks_protect before insert or update or delete on public.hardware_model_interlocks
  for each row execute function public.protect_hardware_model_in_use();

-- Devices built from a board channel. Devices from Phase 1 (no board) keep working unchanged.
alter table public.devices alter column kind drop not null;
alter table public.devices add column if not exists device_type text references public.device_types (type);
alter table public.devices add column if not exists controller_id uuid;
alter table public.devices add column if not exists model_id uuid;
alter table public.devices add column if not exists channel_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'devices_controller_same_property_fkey') then
    -- The board is in the device's home.
    alter table public.devices add constraint devices_controller_same_property_fkey
      foreign key (controller_id, property_id) references public.controllers (id, property_id) on delete cascade;
    -- The device goes through the board's hub (a board moved to another hub of the same home
    -- takes its devices along).
    alter table public.devices add constraint devices_controller_same_hub_fkey
      foreign key (controller_id, hub_id) references public.controllers (id, hub_id) on update cascade on delete cascade;
    -- The device's model is the board's model ...
    alter table public.devices add constraint devices_controller_model_fkey
      foreign key (controller_id, model_id) references public.controllers (id, model_id) on delete cascade;
    -- ... and its channel and type come from that model.
    alter table public.devices add constraint devices_model_channel_fkey
      foreign key (model_id, channel_key, device_type) references public.hardware_model_channels (model_id, channel_key, device_type);
    -- One device per board channel.
    alter table public.devices add constraint devices_controller_channel_key unique (controller_id, channel_key);
    alter table public.devices add constraint devices_board_link_check check (
      (controller_id is null and model_id is null and channel_key is null)
      or (controller_id is not null and model_id is not null and channel_key is not null and device_type is not null)
    );
    alter table public.devices add constraint devices_kind_or_type_check check (kind is not null or device_type is not null);
  end if;
end;
$$;
create index if not exists devices_controller_id_idx on public.devices (controller_id) where controller_id is not null;

-- Adds a board to a home: creates the controller and one device per model channel with the
-- model's capabilities. Backend only (service_role); Phase 4 pairing and the dev tools use it.
create or replace function public.provision_controller(p_hub_id uuid, p_model_code text, p_hardware_uid text, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_model_id uuid;
  v_controller_id uuid;
begin
  select hub.property_id into v_property_id from public.hubs as hub where hub.id = p_hub_id;
  if v_property_id is null then
    raise exception 'Unknown hub %', p_hub_id using errcode = '23503';
  end if;
  select model.id into v_model_id from public.hardware_models as model where model.code = p_model_code;
  if v_model_id is null then
    raise exception 'Unknown hardware model %', p_model_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.hardware_model_channels where model_id = v_model_id) then
    raise exception 'Hardware model % has no channels', p_model_code using errcode = '23514';
  end if;

  insert into public.controllers (property_id, hub_id, model_id, hardware_uid, name)
  values (v_property_id, p_hub_id, v_model_id, p_hardware_uid, btrim(p_name))
  returning id into v_controller_id;

  insert into public.devices (property_id, hub_id, external_id, name, device_type, controller_id, model_id, channel_key)
  select v_property_id, p_hub_id, p_hardware_uid || ':' || channel.channel_key, channel.default_name,
    channel.device_type, v_controller_id, v_model_id, channel.channel_key
  from public.hardware_model_channels as channel
  where channel.model_id = v_model_id;

  insert into public.device_capabilities (property_id, device_id, capability, value_type, min_value, max_value, step, enum_values, unit, writable)
  select v_property_id, device.id, template.capability, template.value_type, template.min_value, template.max_value,
    template.step, template.enum_values, template.unit, template.writable
  from public.devices as device
  join public.hardware_model_capabilities as template
    on template.model_id = device.model_id and template.channel_key = device.channel_key
  where device.controller_id = v_controller_id;

  return v_controller_id;
end;
$$;
revoke all on function public.provision_controller(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_controller(uuid, text, text, text) to service_role;

-- RLS. Users may read device types, model names and channels, and the boards of their own
-- homes. Pin maps, capability templates and interlocks are backend-only.
alter table public.device_types enable row level security;
alter table public.hardware_models enable row level security;
alter table public.hardware_model_channels enable row level security;
alter table public.hardware_model_pins enable row level security;
alter table public.hardware_model_capabilities enable row level security;
alter table public.hardware_model_interlocks enable row level security;
alter table public.controllers enable row level security;

create policy "device_types_select_authenticated" on public.device_types
  for select to authenticated using (true);
create policy "hardware_models_select_authenticated" on public.hardware_models
  for select to authenticated using (true);
create policy "hardware_model_channels_select_authenticated" on public.hardware_model_channels
  for select to authenticated using (true);
create policy "controllers_select_property_members" on public.controllers
  for select to authenticated using (public.is_property_member(property_id));

revoke all on public.device_types, public.hardware_models, public.hardware_model_channels, public.hardware_model_pins,
  public.hardware_model_capabilities, public.hardware_model_interlocks, public.controllers from anon, authenticated;
grant select on public.device_types, public.hardware_models, public.hardware_model_channels, public.controllers to authenticated;
