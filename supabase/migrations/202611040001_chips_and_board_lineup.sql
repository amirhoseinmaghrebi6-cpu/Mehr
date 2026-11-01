-- More chips, and the M2smart board lineup (docs/board-lineup.md).
--
-- Chips: besides the ESP32 (WROOM-32, and the ESP32-CAM module), the ESP32-C3 and ESP32-S3, each
-- with its own allowed pins. The pin check now goes through the model's chip (a trigger: a column
-- check cannot read the model).
--
-- A new pin function, 'digital_out', for plain outputs that are not relays: a buzzer, a status LED.
--
-- The setup key of a touch switch is its first touch key: that pin has function 'setup_button'
-- and names the channel it also switches (channel_key). Other boards' setup buttons name none.
--
-- The lineup is a proposal until the PCBs are final; a model no installed board uses can still
-- change in a later migration (frozen models: docs/hardware-catalog.md). Additive.

alter table public.hardware_models drop constraint if exists hardware_models_chip_check;
alter table public.hardware_models add constraint hardware_models_chip_check check (chip in ('esp32', 'esp32c3', 'esp32s3'));

alter table public.hardware_model_pins drop constraint if exists hardware_model_pins_function_check;
alter table public.hardware_model_pins add constraint hardware_model_pins_function_check check (
  function in ('relay', 'triac_gate', 'zero_cross', 'digital_in', 'pulse_in', 'i2c_sda', 'i2c_scl', 'uart_rx', 'uart_tx', 'adc', 'setup_button', 'digital_out')
);

-- Allowed pins per chip (boot straps, flash, USB and UART0 left out; docs/board-lineup.md).
create or replace function public.board_pin_allowed(p_chip text, gpio smallint, pin_function text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_chip
    when 'esp32' then public.esp32_pin_allowed(gpio, case when pin_function = 'digital_out' then 'relay' else pin_function end)
    when 'esp32c3' then case
      when pin_function in ('relay', 'triac_gate', 'i2c_sda', 'i2c_scl', 'uart_tx', 'digital_out', 'digital_in', 'zero_cross', 'pulse_in', 'uart_rx', 'setup_button') then gpio in (0, 1, 3, 4, 5, 6, 7, 10)
      when pin_function = 'adc' then gpio between 0 and 4
      else false end
    when 'esp32s3' then case
      when pin_function in ('relay', 'triac_gate', 'i2c_sda', 'i2c_scl', 'uart_tx', 'digital_out', 'digital_in', 'zero_cross', 'pulse_in', 'uart_rx', 'setup_button')
        then gpio in (1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47, 48)
      when pin_function = 'adc' then gpio between 1 and 10
      else false end
    else false
  end;
$$;
revoke all on function public.board_pin_allowed(text, smallint, text) from public, anon, authenticated;

-- The old check knew only the ESP32; the chip-aware one replaces it.
do $$
declare
  old_check text;
begin
  select conname into old_check from pg_constraint
  where conrelid = 'public.hardware_model_pins'::regclass and pg_get_constraintdef(oid) like '%esp32_pin_allowed%';
  if old_check is not null then
    execute format('alter table public.hardware_model_pins drop constraint %I', old_check);
  end if;
end $$;

create or replace function public.check_hardware_model_pin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.board_pin_allowed((select chip from public.hardware_models where id = new.model_id), new.gpio, new.function) then
    raise exception 'GPIO % cannot be % on this chip', new.gpio, new.function using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists hardware_model_pins_allowed on public.hardware_model_pins;
create trigger hardware_model_pins_allowed before insert or update on public.hardware_model_pins
for each row execute function public.check_hardware_model_pin();

-- The lineup, generated from docs/board-lineup.md with the capabilities of packages/contracts.

-- Touch switch, 1 key (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-t1-rev-a', 'Touch switch, 1 key', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t1-rev-a'), 'ch1', 'switch', 'Light 1' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t1-rev-a'), 'ch1', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t1-rev-a'), 4, 'relay', 'ch1', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t1-rev-a'), 0, 'setup_button', 'ch1', 'touch_key' on conflict do nothing;

-- Touch switch, 2 keys (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-t2-rev-a', 'Touch switch, 2 keys', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t2-rev-a'), 'ch1', 'switch', 'Light 1' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t2-rev-a'), 'ch1', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t2-rev-a'), 'ch2', 'switch', 'Light 2' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t2-rev-a'), 'ch2', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t2-rev-a'), 4, 'relay', 'ch1', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t2-rev-a'), 5, 'relay', 'ch2', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t2-rev-a'), 0, 'setup_button', 'ch1', 'touch_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t2-rev-a'), 1, 'digital_in', 'ch2', 'touch_key' on conflict do nothing;

-- Touch switch, 3 keys (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-t3-rev-a', 'Touch switch, 3 keys', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 'ch1', 'switch', 'Light 1' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 'ch1', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 'ch2', 'switch', 'Light 2' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 'ch2', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 'ch3', 'switch', 'Light 3' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 'ch3', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 4, 'relay', 'ch1', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 5, 'relay', 'ch2', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 6, 'relay', 'ch3', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 0, 'setup_button', 'ch1', 'touch_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 1, 'digital_in', 'ch2', 'touch_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t3-rev-a'), 3, 'digital_in', 'ch3', 'touch_key' on conflict do nothing;

-- Touch switch, 4 keys (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-t4-rev-a', 'Touch switch, 4 keys', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 'ch1', 'switch', 'Light 1' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 'ch1', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 'ch2', 'switch', 'Light 2' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 'ch2', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 'ch3', 'switch', 'Light 3' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 'ch3', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 'ch4', 'switch', 'Light 4' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 'ch4', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 4, 'relay', 'ch1', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 5, 'relay', 'ch2', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 6, 'relay', 'ch3', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 7, 'relay', 'ch4', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 0, 'setup_button', 'ch1', 'touch_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 1, 'digital_in', 'ch2', 'touch_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 3, 'digital_in', 'ch3', 'touch_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-t4-rev-a'), 10, 'digital_in', 'ch4', 'touch_key' on conflict do nothing;

-- 8-relay panel board (esp32)
insert into public.hardware_models (code, name, chip) values ('m2-r8-rev-a', '8-relay panel board', 'esp32') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch1', 'switch', 'Switch 1' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch1', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch2', 'switch', 'Switch 2' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch2', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch3', 'switch', 'Switch 3' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch3', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch4', 'switch', 'Switch 4' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch4', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch5', 'switch', 'Switch 5' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch5', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch6', 'switch', 'Switch 6' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch6', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch7', 'switch', 'Switch 7' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch7', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch8', 'switch', 'Switch 8' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 'ch8', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 4, 'relay', 'ch1', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 13, 'relay', 'ch2', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 16, 'relay', 'ch3', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 17, 'relay', 'ch4', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 18, 'relay', 'ch5', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 19, 'relay', 'ch6', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 21, 'relay', 'ch7', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 22, 'relay', 'ch8', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 23, 'digital_in', 'ch1', 'wall_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 25, 'digital_in', 'ch2', 'wall_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 26, 'digital_in', 'ch3', 'wall_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 27, 'digital_in', 'ch4', 'wall_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 32, 'digital_in', 'ch5', 'wall_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 34, 'digital_in', 'ch6', 'wall_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 35, 'digital_in', 'ch7', 'wall_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 39, 'digital_in', 'ch8', 'wall_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 36, 'setup_button', null, 'setup' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-r8-rev-a'), 33, 'digital_out', null, 'status_led' on conflict do nothing;

-- Dimmer, 1 channel (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-d1-rev-a', 'Dimmer, 1 channel', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-d1-rev-a'), 'ch1', 'dimmer', 'Dimmer' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-d1-rev-a'), 'ch1', 'brightness', 'integer', 0, 100, 1, null, '%', true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-d1-rev-a'), 4, 'zero_cross', null, 'zero_cross' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-d1-rev-a'), 5, 'triac_gate', 'ch1', 'triac' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-d1-rev-a'), 0, 'setup_button', 'ch1', 'touch_key' on conflict do nothing;

-- Dimmer, 2 channels (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-d2-rev-a', 'Dimmer, 2 channels', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 'ch1', 'dimmer', 'Dimmer 1' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 'ch1', 'brightness', 'integer', 0, 100, 1, null, '%', true on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 'ch2', 'dimmer', 'Dimmer 2' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 'ch2', 'brightness', 'integer', 0, 100, 1, null, '%', true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 4, 'zero_cross', null, 'zero_cross' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 5, 'triac_gate', 'ch1', 'triac' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 6, 'triac_gate', 'ch2', 'triac' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 0, 'setup_button', 'ch1', 'touch_key' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-d2-rev-a'), 1, 'digital_in', 'ch2', 'touch_key' on conflict do nothing;

-- Cooler board (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-cl-rev-a', 'Cooler board', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 'cooler', 'cooler', 'Cooler' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 'cooler', 'pump', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 'cooler', 'speed', 'enum', null, null, null, array['off', 'low', 'high'], null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 4, 'relay', 'cooler', 'pump' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 5, 'relay', 'cooler', 'low' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 6, 'relay', 'cooler', 'high' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 7, 'setup_button', null, 'setup' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 10, 'digital_out', null, 'status_led' on conflict do nothing;
insert into public.hardware_model_interlocks (model_id, group_key, gpio) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 'speed', 5 on conflict do nothing;
insert into public.hardware_model_interlocks (model_id, group_key, gpio) select (select id from public.hardware_models where code = 'm2-cl-rev-a'), 'speed', 6 on conflict do nothing;

-- Fan board (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-fn-rev-a', 'Fan board', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-fn-rev-a'), 'fan', 'fan', 'Fan' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-fn-rev-a'), 'fan', 'speed', 'enum', null, null, null, array['off', 'low', 'high'], null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-fn-rev-a'), 4, 'relay', 'fan', 'low' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-fn-rev-a'), 5, 'relay', 'fan', 'high' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-fn-rev-a'), 0, 'setup_button', 'fan', 'touch_key' on conflict do nothing;
insert into public.hardware_model_interlocks (model_id, group_key, gpio) select (select id from public.hardware_models where code = 'm2-fn-rev-a'), 'speed', 4 on conflict do nothing;
insert into public.hardware_model_interlocks (model_id, group_key, gpio) select (select id from public.hardware_models where code = 'm2-fn-rev-a'), 'speed', 5 on conflict do nothing;

-- Curtain board (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-cu-rev-a', 'Curtain board', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-cu-rev-a'), 'curtain', 'curtain', 'Curtain' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-cu-rev-a'), 'curtain', 'curtain', 'enum', null, null, null, array['open', 'closed'], null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cu-rev-a'), 4, 'relay', 'curtain', 'open' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cu-rev-a'), 5, 'relay', 'curtain', 'close' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cu-rev-a'), 0, 'setup_button', 'curtain', 'touch_open' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cu-rev-a'), 1, 'digital_in', 'curtain', 'touch_close' on conflict do nothing;
insert into public.hardware_model_interlocks (model_id, group_key, gpio) select (select id from public.hardware_models where code = 'm2-cu-rev-a'), 'motor', 4 on conflict do nothing;
insert into public.hardware_model_interlocks (model_id, group_key, gpio) select (select id from public.hardware_models where code = 'm2-cu-rev-a'), 'motor', 5 on conflict do nothing;

-- Parking door board (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-gd-rev-a', 'Parking door board', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-gd-rev-a'), 'door', 'garage_door', 'Parking door' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-gd-rev-a'), 'door', 'door', 'enum', null, null, null, array['open', 'closed'], null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-gd-rev-a'), 4, 'relay', 'door', 'pulse' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-gd-rev-a'), 5, 'digital_in', 'door', 'door_sensor' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-gd-rev-a'), 6, 'setup_button', null, 'setup' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-gd-rev-a'), 10, 'digital_out', null, 'status_led' on conflict do nothing;

-- Door opener board (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-do-rev-a', 'Door opener board', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-do-rev-a'), 'door', 'door_opener', 'Front door' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-do-rev-a'), 'door', 'door_release', 'enum', null, null, null, array['open'], null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-do-rev-a'), 4, 'relay', 'door', 'strike' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-do-rev-a'), 5, 'setup_button', 'door', 'push_button' on conflict do nothing;

-- Smart socket (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-sk-rev-a', 'Smart socket', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-sk-rev-a'), 'socket', 'socket', 'Socket' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-sk-rev-a'), 'socket', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-sk-rev-a'), 4, 'relay', 'socket', 'relay' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-sk-rev-a'), 5, 'setup_button', 'socket', 'push_button' on conflict do nothing;

-- Water pump board (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-pm-rev-a', 'Water pump board', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-pm-rev-a'), 'pump', 'pump', 'Water pump' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-pm-rev-a'), 'pump', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-pm-rev-a'), 4, 'relay', 'pump', 'contactor' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-pm-rev-a'), 5, 'setup_button', null, 'setup' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-pm-rev-a'), 6, 'digital_in', 'pump', 'float_switch' on conflict do nothing;

-- Alarm panel (esp32)
insert into public.hardware_models (code, name, chip) values ('m2-al-rev-a', 'Alarm panel', 'esp32') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'alarm', 'alarm', 'Alarm' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'alarm', 'alarm_mode', 'enum', null, null, null, array['disarmed', 'armed_home', 'armed_away'], null, true on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'alarm', 'triggered', 'boolean', null, null, null, null, null, false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone1', 'contact_sensor', 'Zone 1' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone1', 'contact', 'enum', null, null, null, array['open', 'closed'], null, false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone2', 'contact_sensor', 'Zone 2' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone2', 'contact', 'enum', null, null, null, array['open', 'closed'], null, false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone3', 'contact_sensor', 'Zone 3' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone3', 'contact', 'enum', null, null, null, array['open', 'closed'], null, false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone4', 'contact_sensor', 'Zone 4' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone4', 'contact', 'enum', null, null, null, array['open', 'closed'], null, false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone5', 'motion_sensor', 'Zone 5' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone5', 'motion', 'boolean', null, null, null, null, null, false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone6', 'motion_sensor', 'Zone 6' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 'zone6', 'motion', 'boolean', null, null, null, null, null, false on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 4, 'relay', 'alarm', 'siren' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 34, 'digital_in', 'zone1', 'zone' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 35, 'digital_in', 'zone2', 'zone' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 36, 'digital_in', 'zone3', 'zone' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 39, 'digital_in', 'zone4', 'zone' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 32, 'digital_in', 'zone5', 'zone' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 33, 'digital_in', 'zone6', 'zone' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 25, 'digital_in', 'alarm', 'tamper' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 26, 'setup_button', null, 'setup' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-al-rev-a'), 27, 'digital_out', null, 'status_led' on conflict do nothing;

-- Camera (esp32)
insert into public.hardware_models (code, name, chip) values ('m2-cam-rev-a', 'Camera', 'esp32') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-cam-rev-a'), 'camera', 'camera', 'Camera' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-cam-rev-a'), 'camera', 'power', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-cam-rev-a'), 'camera', 'recording', 'boolean', null, null, null, null, null, true on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cam-rev-a'), 13, 'setup_button', null, 'setup' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-cam-rev-a'), 33, 'digital_out', null, 'status_led' on conflict do nothing;

-- Room sensor (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-rs-rev-a', 'Room sensor', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 'climate', 'humidity_sensor', 'Humidity and temperature' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 'climate', 'humidity', 'number', 0, 100, null, null, '%', false on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 'climate', 'temperature', 'number', null, null, null, null, '°C', false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 'light', 'light_sensor', 'Light' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 'light', 'illuminance_lux', 'number', 0, null, null, null, 'lx', false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 'motion', 'motion_sensor', 'Motion' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 'motion', 'motion', 'boolean', null, null, null, null, null, false on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 4, 'i2c_sda', null, 'i2c' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 5, 'i2c_scl', null, 'i2c' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 6, 'digital_in', 'motion', 'pir' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 7, 'setup_button', null, 'setup' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-rev-a'), 10, 'digital_out', null, 'status_led' on conflict do nothing;

-- Room sensor with air quality (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-rs-air-rev-a', 'Room sensor with air quality', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'climate', 'humidity_sensor', 'Humidity and temperature' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'climate', 'humidity', 'number', 0, 100, null, null, '%', false on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'climate', 'temperature', 'number', null, null, null, null, '°C', false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'light', 'light_sensor', 'Light' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'light', 'illuminance_lux', 'number', 0, null, null, null, 'lx', false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'motion', 'motion_sensor', 'Motion' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'motion', 'motion', 'boolean', null, null, null, null, null, false on conflict do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'air', 'air_quality_sensor', 'Air quality' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 'air', 'co2_ppm', 'number', 0, null, null, null, 'ppm', false on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 4, 'i2c_sda', null, 'i2c' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 5, 'i2c_scl', null, 'i2c' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 6, 'digital_in', 'motion', 'pir' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 7, 'setup_button', null, 'setup' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-rs-air-rev-a'), 10, 'digital_out', null, 'status_led' on conflict do nothing;

-- Presence sensor (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-pr-rev-a', 'Presence sensor', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-pr-rev-a'), 'presence', 'presence_sensor', 'Presence' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-pr-rev-a'), 'presence', 'presence', 'boolean', null, null, null, null, null, false on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-pr-rev-a'), 6, 'uart_rx', 'presence', 'radar' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-pr-rev-a'), 7, 'uart_tx', 'presence', 'radar' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-pr-rev-a'), 4, 'digital_in', 'presence', 'radar_out' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-pr-rev-a'), 5, 'setup_button', null, 'setup' on conflict do nothing;

-- Door and window sensor (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-ct-rev-a', 'Door and window sensor', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-ct-rev-a'), 'contact', 'contact_sensor', 'Door' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-ct-rev-a'), 'contact', 'contact', 'enum', null, null, null, array['open', 'closed'], null, false on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-ct-rev-a'), 4, 'digital_in', 'contact', 'reed' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-ct-rev-a'), 5, 'setup_button', null, 'setup' on conflict do nothing;

-- Leak sensor (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-lk-rev-a', 'Leak sensor', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-lk-rev-a'), 'leak', 'leak_sensor', 'Water leak' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-lk-rev-a'), 'leak', 'leak', 'boolean', null, null, null, null, null, false on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-lk-rev-a'), 4, 'digital_in', 'leak', 'probe' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-lk-rev-a'), 5, 'digital_out', 'leak', 'buzzer' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-lk-rev-a'), 6, 'setup_button', null, 'setup' on conflict do nothing;

-- Smoke sensor (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-sm-rev-a', 'Smoke sensor', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-sm-rev-a'), 'smoke', 'smoke_sensor', 'Smoke' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-sm-rev-a'), 'smoke', 'smoke', 'boolean', null, null, null, null, null, false on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-sm-rev-a'), 4, 'digital_in', 'smoke', 'detector_contact' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-sm-rev-a'), 5, 'setup_button', null, 'setup' on conflict do nothing;

-- Carbon monoxide sensor (esp32c3)
insert into public.hardware_models (code, name, chip) values ('m2-co-rev-a', 'Carbon monoxide sensor', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select (select id from public.hardware_models where code = 'm2-co-rev-a'), 'co', 'co_sensor', 'Carbon monoxide' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable) select (select id from public.hardware_models where code = 'm2-co-rev-a'), 'co', 'co_ppm', 'number', 0, null, null, null, 'ppm', false on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-co-rev-a'), 4, 'uart_rx', 'co', 'sensor' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-co-rev-a'), 5, 'uart_tx', 'co', 'sensor' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-co-rev-a'), 6, 'digital_out', 'co', 'buzzer' on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) select (select id from public.hardware_models where code = 'm2-co-rev-a'), 7, 'setup_button', null, 'setup' on conflict do nothing;
