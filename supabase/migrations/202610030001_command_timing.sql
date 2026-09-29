-- Phase 3: command deadlines that fit real hardware and real networks. Additive; earlier
-- migrations are unchanged.
--
-- Until now every command expired 30 seconds after it was created. That is too short for
-- hardware that moves (a parking door or a roller shutter can take a minute or more) once the
-- path over the internet (API → hub → ESP32 and the report back, with reconnects and retries on
-- a slow or interrupted connection) is added.
--
-- A command's deadline is now: 30 seconds for the network + the time the hardware needs to finish.
-- The hardware time comes from the board model's channel (set by M2smart from the real motor),
-- else from the device type's default. The database sets it on every insert, so no client can
-- shorten or stretch it.

-- Default time a device type needs to finish a command, in seconds.
alter table public.device_types add column if not exists action_seconds integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_types_action_seconds_check') then
    alter table public.device_types add constraint device_types_action_seconds_check check (action_seconds between 0 and 600);
  end if;
end;
$$;
update public.device_types set action_seconds = 120 where type = 'garage_door';
update public.device_types set action_seconds = 90 where type = 'curtain';
update public.device_types set action_seconds = 10 where type in ('cooler', 'fan');

-- A board model's own value, from its real hardware (e.g. a slower door motor). Part of the model
-- like its pins: frozen once boards use it.
alter table public.hardware_model_channels add column if not exists action_seconds integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hardware_model_channels_action_seconds_check') then
    alter table public.hardware_model_channels add constraint hardware_model_channels_action_seconds_check
      check (action_seconds is null or action_seconds between 0 and 600);
  end if;
end;
$$;

-- Seconds a command for this device may take in total: network allowance + hardware time.
create or replace function public.command_timeout_seconds(p_device_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select 30 + coalesce(channel.action_seconds, device_type.action_seconds, 0)
  from public.devices as device
  left join public.hardware_model_channels as channel
    on channel.model_id = device.model_id and channel.channel_key = device.channel_key
  left join public.device_types as device_type on device_type.type = device.device_type
  where device.id = p_device_id;
$$;
revoke all on function public.command_timeout_seconds(uuid) from public, anon, authenticated;

create or replace function public.set_command_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.expires_at := now() + make_interval(secs => coalesce(public.command_timeout_seconds(new.device_id), 30));
  return new;
end;
$$;
revoke all on function public.set_command_expiry() from public, anon, authenticated;

drop trigger if exists device_commands_set_expiry on public.device_commands;
create trigger device_commands_set_expiry before insert on public.device_commands
  for each row execute function public.set_command_expiry();
