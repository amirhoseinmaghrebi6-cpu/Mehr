-- Command deadlines: 30 s for the network plus the hardware's own time (device type default, or
-- the board model's value). Set by the database on insert; clients cannot choose them. Runs as the
-- superuser in one transaction that is rolled back. Run with: pnpm db:test
-- expect-pass: 6
begin;

create function pg_temp.expect_between(q text, low numeric, high numeric, label text) returns void language plpgsql as $$
declare n numeric;
begin
  execute q into n;
  if n is null or n < low or n > high then raise exception 'FAIL %: got %, expected between % and %', label, n, low, high; end if;
  raise notice 'PASS %', label;
end $$;

insert into auth.users (id, email) values ('a4000000-0000-4000-8000-000000000001', 'p3-timing@test.local');
insert into public.properties (id, organization_id, name, created_by)
select 'a4000000-1111-4000-8000-000000000001', organization_id, 'Timing home', user_id
from public.organization_members where user_id = 'a4000000-0000-4000-8000-000000000001';
insert into public.property_members (property_id, user_id, role) values ('a4000000-1111-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'owner');
insert into public.hubs (id, property_id, name, hardware_id) values ('a4000000-2222-4000-8000-000000000001', 'a4000000-1111-4000-8000-000000000001', 'hub', 'p3-timing-hub');

insert into public.hardware_models (id, code, name) values
  ('c4000000-0000-4000-8000-000000000001', 'test-timing-rev-a', 'Timing test board');
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name, action_seconds) values
  ('c4000000-0000-4000-8000-000000000001', 'light', 'switch', 'Light', null),
  ('c4000000-0000-4000-8000-000000000001', 'door', 'garage_door', 'Parking door', null),
  ('c4000000-0000-4000-8000-000000000001', 'slow_door', 'garage_door', 'Slow parking door', 240);
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) values
  ('c4000000-0000-4000-8000-000000000001', 16, 'relay', 'light', 'relay'),
  ('c4000000-0000-4000-8000-000000000001', 17, 'relay', 'door', 'pulse'),
  ('c4000000-0000-4000-8000-000000000001', 18, 'relay', 'slow_door', 'pulse');
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, enum_values, writable) values
  ('c4000000-0000-4000-8000-000000000001', 'light', 'power', 'boolean', null, true),
  ('c4000000-0000-4000-8000-000000000001', 'door', 'door', 'enum', array['open', 'closed'], true),
  ('c4000000-0000-4000-8000-000000000001', 'slow_door', 'door', 'enum', array['open', 'closed'], true);
select public.provision_controller('a4000000-2222-4000-8000-000000000001', 'test-timing-rev-a', 'P3-TIMING-1', 'Timing board');

create temp table timing_ids as
select channel_key, id from public.devices where controller_id = (select id from public.controllers where hardware_uid = 'P3-TIMING-1');
grant select on timing_ids to public;

-- Inserted as the user, the way the API does it.
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key)
select 'a4000000-1111-4000-8000-000000000001', id, case channel_key when 'light' then 'power' else 'door' end,
  case channel_key when 'light' then 'true'::jsonb else '"closed"'::jsonb end, 'timing-' || channel_key
from timing_ids;
reset role;

do $$
begin
  perform pg_temp.expect_between($q$select extract(epoch from expires_at - created_at) from public.device_commands where idempotency_key = 'timing-light'$q$, 29, 31, 'a switch command gets 30 s (network only)');
  perform pg_temp.expect_between($q$select extract(epoch from expires_at - created_at) from public.device_commands where idempotency_key = 'timing-door'$q$, 149, 151, 'a parking door gets 30 s + its type''s 120 s');
  perform pg_temp.expect_between($q$select extract(epoch from expires_at - created_at) from public.device_commands where idempotency_key = 'timing-slow_door'$q$, 269, 271, 'a board model''s own time (240 s) wins over the type default');
  perform pg_temp.expect_between($q$select action_seconds from public.device_types where type = 'curtain'$q$, 90, 90, 'curtains default to 90 s');

  -- A client cannot pick its own deadline.
  begin
    perform set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    set local role authenticated;
    insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key, expires_at)
    values ('a4000000-1111-4000-8000-000000000001', (select id from timing_ids where channel_key = 'light'), 'power', 'false', 'timing-own-deadline', now() + interval '1 day');
    raise exception 'FAIL a client set its own deadline';
  exception when insufficient_privilege then
    raise notice 'PASS a client cannot set expires_at';
  end;
  reset role;

  -- Even the backend's value is replaced: the deadline always follows the hardware.
  insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key, expires_at)
  values ('a4000000-1111-4000-8000-000000000001', (select id from timing_ids where channel_key = 'light'), 'power', 'false', 'timing-backend', now() + interval '1 day');
  perform pg_temp.expect_between($q$select extract(epoch from expires_at - created_at) from public.device_commands where idempotency_key = 'timing-backend'$q$, 29, 31, 'the database always sets the deadline');
end $$;

rollback;
