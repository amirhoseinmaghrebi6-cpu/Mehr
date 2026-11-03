-- The whole-home energy meter (decided 2026-11-03, replacing the 2026-10-04 "no energy" decision
-- for the home as a whole; per-device consumption stays out). One board in the electrical panel
-- with a current clamp on the incoming line: M2-EM (docs/board-lineup.md). A home with three
-- phases has one board per phase; the app adds them up. Additive.

insert into public.device_types (type) values ('energy_meter') on conflict (type) do nothing;

insert into public.hardware_models (code, name, chip) values ('m2-em-rev-a', 'Energy meter', 'esp32c3') on conflict (code) do nothing;
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name)
  select (select id from public.hardware_models where code = 'm2-em-rev-a'), 'meter', 'energy_meter', 'Home energy' on conflict do nothing;
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable)
  select (select id from public.hardware_models where code = 'm2-em-rev-a'), 'meter', capability, 'number', 0, null, null, null, unit, false
  from (values ('power_w', 'W'), ('energy_kwh', 'kWh'), ('voltage_v', 'V')) as capability (capability, unit)
  on conflict do nothing;
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role)
  select (select id from public.hardware_models where code = 'm2-em-rev-a'), gpio, function, channel_key, role
  from (values
    (4::smallint, 'uart_rx', 'meter', 'meter_chip'),
    (5::smallint, 'uart_tx', 'meter', 'meter_chip'),
    (6::smallint, 'setup_button', null, 'setup'),
    (10::smallint, 'digital_out', null, 'status_led')
  ) as pin (gpio, function, channel_key, role)
  on conflict do nothing;
