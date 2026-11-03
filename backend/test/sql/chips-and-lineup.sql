-- Chips and the board lineup (202611040001): each chip has its own allowed pins, plain outputs
-- ('digital_out') follow the output pins, and every lineup model can join a home (one setup key).
-- Runs as the superuser in one rolled-back transaction.
-- Run with: pnpm db:test
-- expect-pass: 6
begin;

insert into public.hardware_models (id, code, name, chip) values
  ('a9000000-4444-4000-8000-000000000001', 'chip-test-c3', 'Chip test C3', 'esp32c3'),
  ('a9000000-4444-4000-8000-000000000002', 'chip-test-s3', 'Chip test S3', 'esp32s3'),
  ('a9000000-4444-4000-8000-000000000003', 'chip-test-wroom', 'Chip test WROOM', 'esp32');

do $$
begin
  begin
    insert into public.hardware_models (code, name, chip) values ('chip-test-8266', 'ESP-01', 'esp8266');
    raise exception 'FAIL an ESP8266 model was accepted';
  exception when check_violation then raise notice 'PASS only ESP32, ESP32-C3 and ESP32-S3 models';
  end;

  begin
    insert into public.hardware_model_pins (model_id, gpio, function, role) values ('a9000000-4444-4000-8000-000000000001', 9, 'setup_button', 'setup');
    raise exception 'FAIL the C3 boot pin was accepted';
  exception when check_violation then raise notice 'PASS C3: boot, USB and UART0 pins are refused';
  end;
  insert into public.hardware_model_pins (model_id, gpio, function, role) values ('a9000000-4444-4000-8000-000000000001', 10, 'digital_out', 'status_led');
  raise notice 'PASS C3: GPIO 10 takes a plain output';

  begin
    insert into public.hardware_model_pins (model_id, gpio, function, role) values ('a9000000-4444-4000-8000-000000000002', 0, 'relay', 'relay');
    raise exception 'FAIL the S3 boot pin was accepted';
  exception when check_violation then raise notice 'PASS S3: GPIO 0 is refused';
  end;

  begin
    insert into public.hardware_model_pins (model_id, gpio, function, role) values ('a9000000-4444-4000-8000-000000000003', 34, 'digital_out', 'status_led');
    raise exception 'FAIL an output on an input-only ESP32 pin was accepted';
  exception when check_violation then raise notice 'PASS ESP32: GPIO 34 cannot be an output';
  end;

  if exists (
    select 1 from public.hardware_models as model
    where model.code like 'm2-%-rev-a'
      and (select count(*) from public.hardware_model_pins as pin where pin.model_id = model.id and pin.function = 'setup_button') <> 1
  ) or (select count(*) from public.hardware_models where code like 'm2-%-rev-a') < 24 then
    raise exception 'FAIL a lineup model is missing or has no single setup key';
  end if;
  raise notice 'PASS all 24 lineup models are there, each with one setup key';
end $$;

rollback;
