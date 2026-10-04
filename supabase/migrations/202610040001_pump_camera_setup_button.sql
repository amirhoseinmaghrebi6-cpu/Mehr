-- Phase 3.5 B: pump and camera device types, and the setup button every board has.
-- Additive; earlier migrations are unchanged.
--
-- Setup button (docs/plans/phase-3-5.md, section A): every M2smart board has one push button on a
-- GPIO. Held 10–15 s it starts pairing, held over 20 s it factory-resets the board. It is part of
-- the PCB design, so the catalog records it as a pin with function 'setup_button': exactly one per
-- model, and a model without one can no longer be added to a home.

insert into public.device_types (type, action_seconds) values
  ('pump', 0),
  -- A camera needs a few seconds to start before it reports that it is on.
  ('camera', 10)
on conflict (type) do nothing;

alter table public.hardware_model_pins drop constraint if exists hardware_model_pins_function_check;
alter table public.hardware_model_pins add constraint hardware_model_pins_function_check check (
  function in ('relay', 'triac_gate', 'zero_cross', 'digital_in', 'pulse_in', 'i2c_sda', 'i2c_scl', 'uart_rx', 'uart_tx', 'adc', 'setup_button')
);

-- The setup button is an input; it may not sit on a boot-strapping pin either (GPIO 0, the BOOT
-- button of dev kits, would start the flasher when held during power-up).
create or replace function public.esp32_pin_allowed(gpio smallint, pin_function text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when pin_function in ('relay', 'triac_gate', 'i2c_sda', 'i2c_scl', 'uart_tx') then
      gpio in (4, 13, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33)
    when pin_function in ('digital_in', 'zero_cross', 'pulse_in', 'uart_rx', 'setup_button') then
      gpio in (4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39)
    when pin_function = 'adc' then
      gpio between 32 and 39
    else false
  end;
$$;
revoke all on function public.esp32_pin_allowed(smallint, text) from public, anon, authenticated;

-- At most one setup button per model ...
create unique index if not exists hardware_model_pins_one_setup_button
  on public.hardware_model_pins (model_id) where function = 'setup_button';

-- ... and at least one before a board of the model can join a home.
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
  if not exists (select 1 from public.hardware_model_pins where model_id = v_model_id and function = 'setup_button') then
    raise exception 'Hardware model % has no setup button; it cannot be paired or reset', p_model_code using errcode = '23514';
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
