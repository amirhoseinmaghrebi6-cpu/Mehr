-- Phase 3B suite: home roles, homes, rooms, the hardware catalog, boards (controllers) and the
-- devices built from them. Two homes (A and B) with separate users; nothing of one home may be
-- visible to or changeable by the other. Runs as the superuser in one transaction that is
-- rolled back. Run with: pnpm db:test
-- expect-pass: 57
begin;

create function pg_temp.act(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create function pg_temp.expect_count(uid uuid, q text, expected bigint, label text) returns void language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.act(uid);
  execute q into n;
  execute 'reset role';
  if n is distinct from expected then raise exception 'FAIL %: got %, expected %', label, n, expected; end if;
  raise notice 'PASS %', label;
end $$;

create function pg_temp.expect_ok(uid uuid, q text, label text) returns void language plpgsql as $$
begin
  perform pg_temp.act(uid);
  execute q;
  execute 'reset role';
  raise notice 'PASS %', label;
end $$;

create function pg_temp.expect_error(uid uuid, q text, state text, label text) returns void language plpgsql as $$
begin
  begin
    perform pg_temp.act(uid);
    execute q;
  exception when others then
    if sqlstate = state then raise notice 'PASS % (% %)', label, sqlstate, sqlerrm; return; end if;
    raise exception 'FAIL %: expected %, got % %', label, state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL %: statement succeeded, expected %', label, state;
end $$;

-- Same checks as the backend (superuser, no RLS).
create function pg_temp.sys_count(q text, expected bigint, label text) returns void language plpgsql as $$
declare n bigint;
begin
  execute q into n;
  if n is distinct from expected then raise exception 'FAIL %: got %, expected %', label, n, expected; end if;
  raise notice 'PASS %', label;
end $$;

create function pg_temp.sys_error(q text, state text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate = state then raise notice 'PASS % (% %)', label, sqlstate, sqlerrm; return; end if;
    raise exception 'FAIL %: expected %, got % %', label, state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL %: statement succeeded, expected %', label, state;
end $$;

-- Users (the signup trigger gives each a personal organization).
insert into auth.users (id, email) values
  ('a3000000-0000-4000-8000-000000000001', 'p3-owner-a@test.local'),
  ('a3000000-0000-4000-8000-000000000002', 'p3-admin-a@test.local'),
  ('a3000000-0000-4000-8000-000000000003', 'p3-member-a@test.local'),
  ('b3000000-0000-4000-8000-000000000001', 'p3-owner-b@test.local');

-- Homes are created the way the API creates them: create_property() as the signed-in user.
create temp table p3 (key text primary key, id uuid);
grant all on p3 to public;
select pg_temp.act('a3000000-0000-4000-8000-000000000001');
insert into p3 select 'prop_a', public.create_property('Home A', 'villa', 'Tehran', 'exterior');
reset role;
select pg_temp.act('b3000000-0000-4000-8000-000000000001');
insert into p3 select 'prop_b', public.create_property('Home B');
reset role;

insert into public.property_members (property_id, user_id, role)
select id, 'a3000000-0000-4000-8000-000000000002'::uuid, 'admin' from p3 where key = 'prop_a'
union all
select id, 'a3000000-0000-4000-8000-000000000003'::uuid, 'member' from p3 where key = 'prop_a';

insert into public.hubs (id, property_id, name, hardware_id)
select 'a3000000-2222-4000-8000-000000000001'::uuid, id, 'hub A', 'p3-hub-a' from p3 where key = 'prop_a'
union all
select 'b3000000-2222-4000-8000-000000000001'::uuid, id, 'hub B', 'p3-hub-b' from p3 where key = 'prop_b';

insert into public.rooms (id, property_id, name)
select 'a3000000-5555-4000-8000-000000000001'::uuid, id, 'Living room' from p3 where key = 'prop_a'
union all
select 'b3000000-5555-4000-8000-000000000001'::uuid, id, 'Living room' from p3 where key = 'prop_b';

-- Catalog: a 2-channel switch and a cooler (pump + low/high interlocked).
insert into public.hardware_models (id, code, name) values
  ('c3000000-0000-4000-8000-000000000001', 'test-switch-2ch-rev-a', 'Test 2-channel switch'),
  ('c3000000-0000-4000-8000-000000000002', 'test-cooler-rev-a', 'Test cooler controller'),
  ('c3000000-0000-4000-8000-000000000003', 'test-unused-rev-a', 'Test model not used by any board');
insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) values
  ('c3000000-0000-4000-8000-000000000001', 'ch1', 'switch', 'Switch 1'),
  ('c3000000-0000-4000-8000-000000000001', 'ch2', 'switch', 'Switch 2'),
  ('c3000000-0000-4000-8000-000000000002', 'cooler', 'cooler', 'Cooler');
insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) values
  ('c3000000-0000-4000-8000-000000000001', 16, 'relay', 'ch1', 'relay'),
  ('c3000000-0000-4000-8000-000000000001', 17, 'relay', 'ch2', 'relay'),
  ('c3000000-0000-4000-8000-000000000001', 32, 'digital_in', 'ch1', 'wall_switch'),
  ('c3000000-0000-4000-8000-000000000001', 33, 'digital_in', 'ch2', 'wall_switch'),
  ('c3000000-0000-4000-8000-000000000002', 16, 'relay', 'cooler', 'pump'),
  ('c3000000-0000-4000-8000-000000000002', 17, 'relay', 'cooler', 'low'),
  ('c3000000-0000-4000-8000-000000000002', 18, 'relay', 'cooler', 'high'),
  ('c3000000-0000-4000-8000-000000000001', 35, 'setup_button', null, 'setup'),
  ('c3000000-0000-4000-8000-000000000002', 35, 'setup_button', null, 'setup');
insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, enum_values, writable) values
  ('c3000000-0000-4000-8000-000000000001', 'ch1', 'power', 'boolean', null, true),
  ('c3000000-0000-4000-8000-000000000001', 'ch2', 'power', 'boolean', null, true),
  ('c3000000-0000-4000-8000-000000000002', 'cooler', 'pump', 'boolean', null, true),
  ('c3000000-0000-4000-8000-000000000002', 'cooler', 'speed', 'enum', array['off', 'low', 'high'], true);
insert into public.hardware_model_interlocks (model_id, group_key, gpio) values
  ('c3000000-0000-4000-8000-000000000002', 'speed', 17),
  ('c3000000-0000-4000-8000-000000000002', 'speed', 18);

-- Boards are added by the backend (service_role).
set local role service_role;
insert into p3 select 'ctl_a', public.provision_controller('a3000000-2222-4000-8000-000000000001', 'test-switch-2ch-rev-a', 'P3-BOARD-A1', 'Board A1');
insert into p3 select 'ctl_b', public.provision_controller('b3000000-2222-4000-8000-000000000001', 'test-switch-2ch-rev-a', 'P3-BOARD-B1', 'Board B1');
insert into p3 select 'ctl_cooler', public.provision_controller('a3000000-2222-4000-8000-000000000001', 'test-cooler-rev-a', 'P3-COOLER-A1', 'Cooler A');
reset role;
insert into p3 select 'dev_a1', id from public.devices where external_id = 'P3-BOARD-A1:ch1';
insert into p3 select 'dev_b1', id from public.devices where external_id = 'P3-BOARD-B1:ch1';

do $$
declare
  owner_a uuid := 'a3000000-0000-4000-8000-000000000001';
  admin_a uuid := 'a3000000-0000-4000-8000-000000000002';
  member_a uuid := 'a3000000-0000-4000-8000-000000000003';
  owner_b uuid := 'b3000000-0000-4000-8000-000000000001';
  prop_a uuid := (select id from p3 where key = 'prop_a');
  prop_b uuid := (select id from p3 where key = 'prop_b');
  ctl_a uuid := (select id from p3 where key = 'ctl_a');
  ctl_b uuid := (select id from p3 where key = 'ctl_b');
  dev_a1 uuid := (select id from p3 where key = 'dev_a1');
  dev_b1 uuid := (select id from p3 where key = 'dev_b1');
  room_a uuid := 'a3000000-5555-4000-8000-000000000001';
  room_b uuid := 'b3000000-5555-4000-8000-000000000001';
  model_switch uuid := 'c3000000-0000-4000-8000-000000000001';
  t text;
begin
  -- Roles: only owner, admin and member exist.
  perform pg_temp.sys_error(format('insert into public.property_members (property_id, user_id, role) values (%L, %L, %L)', prop_b, member_a, 'viewer'), '23514', 'viewer role rejected');
  perform pg_temp.sys_error(format('insert into public.property_members (property_id, user_id, role) values (%L, %L, %L)', prop_b, member_a, 'guest'), '23514', 'guest role rejected');

  -- Homes.
  perform pg_temp.sys_count(format('select count(*) from public.property_members where property_id = %L and user_id = %L and role = %L', prop_a, owner_a, 'owner'), 1, 'create_property makes the caller the owner');
  perform pg_temp.sys_count(format('select count(*) from public.properties where id = %L and address = %L and cover_photo = %L and property_type = %L', prop_a, 'Tehran', 'exterior', 'villa'), 1, 'create_property stores the home details');
  perform pg_temp.expect_error(null, 'select public.create_property(''X'')', '42501', 'anon cannot create a home');
  perform pg_temp.expect_error(owner_b, format('select public.create_property(%L, %L, %L, %L, %L)', 'Intruder', 'house', '', 'living', (select organization_id from public.properties where id = prop_a)), '42501', 'user B cannot create a home in A''s organization');
  perform pg_temp.expect_count(owner_b, format('select count(*) from public.properties where id = %L', prop_a), 0, 'user B cannot see home A');
  perform pg_temp.expect_count(admin_a, format('with u as (update public.properties set name = %L where id = %L returning 1) select count(*) from u', 'Home A2', prop_a), 1, 'admin A renames home A');
  perform pg_temp.expect_count(member_a, format('with u as (update public.properties set name = %L where id = %L returning 1) select count(*) from u', 'Nope', prop_a), 0, 'member A cannot rename home A');
  perform pg_temp.expect_count(owner_b, format('with u as (update public.properties set name = %L where id = %L returning 1) select count(*) from u', 'Nope', prop_a), 0, 'user B cannot rename home A');
  perform pg_temp.expect_error(owner_a, format('update public.properties set organization_id = organization_id where id = %L', prop_a), '42501', 'owner cannot change a home''s organization');
  perform pg_temp.expect_error(owner_a, format('update public.properties set cover_photo = %L where id = %L', 'https://example.com/x.jpg', prop_a), '23514', 'cover photo must be a built-in preset');

  -- Rooms.
  perform pg_temp.expect_ok(admin_a, format('insert into public.rooms (property_id, name, photo) values (%L, %L, %L)', prop_a, 'Kitchen', 'kitchen'), 'admin A adds a room');
  perform pg_temp.expect_error(member_a, format('insert into public.rooms (property_id, name) values (%L, %L)', prop_a, 'Attic'), '42501', 'member A cannot add a room');
  perform pg_temp.expect_error(owner_b, format('insert into public.rooms (property_id, name) values (%L, %L)', prop_a, 'Spy'), '42501', 'user B cannot add a room to home A');
  perform pg_temp.expect_count(member_a, 'select count(*) from public.rooms', 2, 'member A sees exactly home A''s rooms');
  perform pg_temp.expect_count(owner_b, format('select count(*) from public.rooms where property_id = %L', prop_a), 0, 'user B sees no room of home A');
  perform pg_temp.expect_error(admin_a, format('insert into public.rooms (property_id, name) values (%L, %L)', prop_a, '  KITCHEN '), '23505', 'room names are unique per home (case-insensitive)');
  perform pg_temp.expect_ok(owner_b, format('insert into public.rooms (property_id, name) values (%L, %L)', prop_b, 'Kitchen'), 'the same room name is fine in another home');
  perform pg_temp.expect_count(member_a, format('with d as (delete from public.rooms where id = %L returning 1) select count(*) from d', room_a), 0, 'member A cannot delete a room');
  perform pg_temp.expect_error(null, 'select count(*) from public.rooms', '42501', 'anon cannot read rooms');

  -- Boards and devices built from the catalog.
  perform pg_temp.sys_count(format('select count(*) from public.devices where controller_id = %L and device_type = %L and model_id = %L', ctl_a, 'switch', model_switch), 2, 'a 2-channel board becomes two switch devices');
  perform pg_temp.sys_count(format('select count(*) from public.device_capabilities c join public.devices d on d.id = c.device_id where d.controller_id = %L and c.capability = %L', ctl_a, 'power'), 2, 'each switch gets the power capability from the catalog');
  perform pg_temp.sys_count('select count(*) from public.hardware_model_interlocks where model_id = ''c3000000-0000-4000-8000-000000000002''', 2, 'cooler low/high relays are interlocked');
  perform pg_temp.expect_count(member_a, 'select count(*) from public.devices where controller_id is not null', 3, 'member A sees home A''s board devices only');
  perform pg_temp.expect_count(member_a, 'select count(*) from public.controllers', 2, 'member A sees home A''s boards only');
  perform pg_temp.expect_count(owner_b, format('select count(*) from public.controllers where property_id = %L', prop_a), 0, 'user B sees no board of home A');
  perform pg_temp.expect_count(member_a, 'select count(*) from public.hardware_models where code like ''test-%''', 3, 'users can read model names');
  foreach t in array array['hardware_model_pins', 'hardware_model_capabilities', 'hardware_model_interlocks'] loop
    perform pg_temp.expect_error(owner_a, format('select count(*) from public.%I', t), '42501', 'users cannot read ' || t);
  end loop;

  -- Device edits: owners and admins may rename and move within their home; nothing else.
  perform pg_temp.expect_count(admin_a, format('with u as (update public.devices set name = %L where id = %L returning 1) select count(*) from u', 'Hall light', dev_a1), 1, 'admin A renames a device');
  perform pg_temp.expect_count(admin_a, format('with u as (update public.devices set room_id = %L where id = %L returning 1) select count(*) from u', room_a, dev_a1), 1, 'admin A moves a device to a room of home A');
  perform pg_temp.expect_error(admin_a, format('update public.devices set room_id = %L where id = %L', room_b, dev_a1), '23503', 'a device cannot move into another home''s room');
  perform pg_temp.expect_count(member_a, format('with u as (update public.devices set name = %L where id = %L returning 1) select count(*) from u', 'Nope', dev_a1), 0, 'member A cannot rename a device');
  perform pg_temp.expect_count(owner_b, format('with u as (update public.devices set name = %L where id = %L returning 1) select count(*) from u', 'Nope', dev_a1), 0, 'user B cannot rename home A''s device');
  perform pg_temp.expect_error(owner_a, format('update public.devices set device_type = %L where id = %L', 'dimmer', dev_a1), '42501', 'owner cannot change a device''s type');
  perform pg_temp.expect_error(owner_a, format('update public.devices set controller_id = %L where id = %L', ctl_b, dev_a1), '42501', 'owner cannot move a device to another board');
  perform pg_temp.expect_error(owner_a, 'select public.provision_controller(''a3000000-2222-4000-8000-000000000001'', ''test-switch-2ch-rev-a'', ''P3-EVIL-1'', ''x'')', '42501', 'users cannot add boards');

  -- Commands on board devices use the capabilities copied from the catalog.
  perform pg_temp.expect_ok(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a1, 'power', 'true', 'p3-member-key-1'), 'member A switches a board device');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_b, dev_b1, 'power', 'true', 'p3-cross-key-1'), '42501', 'member A cannot switch home B''s device');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a1, 'power', '1', 'p3-type-key-1'), '22023', 'a switch accepts only true/false');

  -- Integrity the backend cannot break either.
  perform pg_temp.sys_error(format('insert into public.devices (property_id, hub_id, external_id, name, device_type, controller_id, model_id, channel_key) values (%L, %L, %L, %L, %L, %L, %L, %L)',
    prop_a, 'a3000000-2222-4000-8000-000000000001', 'x1', 'x', 'cooler', ctl_b, 'c3000000-0000-4000-8000-000000000002', 'cooler'), '23503', 'a device cannot use another home''s board');
  perform pg_temp.sys_error(format('insert into public.devices (property_id, hub_id, external_id, name, device_type, controller_id, model_id, channel_key) values (%L, %L, %L, %L, %L, %L, %L, %L)',
    prop_a, 'a3000000-2222-4000-8000-000000000001', 'x2', 'x', 'switch', ctl_a, model_switch, 'ch1'), '23505', 'one board channel is one device');
  perform pg_temp.sys_error(format('update public.devices set device_type = %L where id = %L', 'dimmer', dev_a1), '23503', 'a device''s type must match its board channel');
  perform pg_temp.sys_error(format('update public.controllers set property_id = %L where id = %L', prop_b, ctl_a), '42501', 'a board never changes home');
  perform pg_temp.sys_error('select public.provision_controller(''b3000000-2222-4000-8000-000000000001'', ''test-switch-2ch-rev-a'', ''P3-BOARD-A1'', ''Clone'')', '23505', 'a hardware id is unique across all homes');

  -- Pin rules.
  perform pg_temp.sys_error('insert into public.hardware_model_pins (model_id, gpio, function, role) values (''c3000000-0000-4000-8000-000000000003'', 12, ''relay'', ''x'')', '23514', 'boot-strap GPIO 12 rejected for a relay');
  perform pg_temp.sys_error('insert into public.hardware_model_pins (model_id, gpio, function, role) values (''c3000000-0000-4000-8000-000000000003'', 34, ''relay'', ''x'')', '23514', 'input-only GPIO 34 rejected for a relay');
  perform pg_temp.sys_error('insert into public.hardware_model_pins (model_id, gpio, function, role) values (''c3000000-0000-4000-8000-000000000003'', 6, ''digital_in'', ''x'')', '23514', 'flash GPIO 6 rejected');
  perform pg_temp.sys_error('insert into public.hardware_model_pins (model_id, gpio, function, role) values (''c3000000-0000-4000-8000-000000000003'', 25, ''adc'', ''x'')', '23514', 'ADC2 GPIO 25 rejected for analog input');
  perform pg_temp.sys_error('insert into public.hardware_model_pins (model_id, gpio, function, role) values (''c3000000-0000-4000-8000-000000000002'', 16, ''digital_in'', ''x'')', '42501', 'a model in use is frozen');
  perform pg_temp.sys_error('delete from public.hardware_models where id = ''c3000000-0000-4000-8000-000000000001''', '42501', 'a model in use cannot be deleted');

  -- Setup button: exactly one per model, never on a boot-strapping pin, required to pair.
  perform pg_temp.sys_error('insert into public.hardware_model_pins (model_id, gpio, function, role) values (''c3000000-0000-4000-8000-000000000003'', 0, ''setup_button'', ''setup'')', '23514', 'a setup button cannot use boot pin GPIO 0');
  insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) values ('c3000000-0000-4000-8000-000000000003', 'ch1', 'switch', 'No button');
  perform pg_temp.sys_error('select public.provision_controller(''a3000000-2222-4000-8000-000000000001'', ''test-unused-rev-a'', ''P3-NO-BUTTON'', ''x'')', '23514', 'a model without a setup button cannot join a home');
  insert into public.hardware_model_pins (model_id, gpio, function, role) values ('c3000000-0000-4000-8000-000000000003', 34, 'setup_button', 'setup');
  perform pg_temp.sys_error('insert into public.hardware_model_pins (model_id, gpio, function, role) values (''c3000000-0000-4000-8000-000000000003'', 35, ''setup_button'', ''setup2'')', '23505', 'a model has only one setup button');

  -- Deleting a room keeps its devices, just without a room.
  delete from public.rooms where id = room_a;
  perform pg_temp.sys_count(format('select count(*) from public.devices where id = %L and room_id is null and property_id = %L', dev_a1, prop_a), 1, 'deleting a room only clears room_id');
end $$;

rollback;
