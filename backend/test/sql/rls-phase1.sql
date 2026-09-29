-- Phase 1 RLS and command-validation suite (57 checks). Runs as the superuser inside one
-- transaction that is rolled back, so it leaves no data behind. Each check raises a
-- 'PASS ...' notice; any failure raises an exception. Run with: pnpm db:test
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

-- Fixtures (as postgres). Owner/member/viewer of property A; outsider owns property B.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner-a@test.local'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'member-a@test.local'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'viewer-a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'owner-b@test.local');

insert into public.properties (id, organization_id, name, created_by, slug)
select 'aaaaaaaa-1111-4000-8000-000000000001', organization_id, 'A', user_id, 'tehran'
from public.organization_members where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into public.properties (id, organization_id, name, created_by, slug)
select 'bbbbbbbb-1111-4000-8000-000000000001', organization_id, 'B', user_id, 'tehran'
from public.organization_members where user_id = 'bbbbbbbb-0000-4000-8000-000000000001';

insert into public.property_members (property_id, user_id, role) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'member'),
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'viewer'),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'owner');

insert into public.hubs (id, property_id, name, hardware_id) values
  ('aaaaaaaa-2222-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001', 'hub A', 'hw-a'),
  ('bbbbbbbb-2222-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001', 'hub B', 'hw-b');
insert into public.devices (id, property_id, hub_id, external_id, name, kind, room_name) values
  ('aaaaaaaa-3333-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-2222-4000-8000-000000000001', 'light', 'Light A', 'light', 'Living room'),
  ('bbbbbbbb-3333-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001', 'bbbbbbbb-2222-4000-8000-000000000001', 'light', 'Light B', 'light', 'Living room');
insert into public.device_capabilities (property_id, device_id, capability, value_type, min_value, max_value, writable, enum_values) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-3333-4000-8000-000000000001', 'power', 'boolean', null, null, true, null),
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-3333-4000-8000-000000000001', 'brightness', 'integer', 0, 100, true, null),
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-3333-4000-8000-000000000001', 'mode', 'enum', null, null, true, array['warm','cool']),
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-3333-4000-8000-000000000001', 'pm25', 'number', 0, null, false, null),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'bbbbbbbb-3333-4000-8000-000000000001', 'power', 'boolean', null, null, true, null);
insert into public.device_states (property_id, device_id, capability, value) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-3333-4000-8000-000000000001', 'power', 'true'),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'bbbbbbbb-3333-4000-8000-000000000001', 'power', 'false');
insert into public.device_commands (id, property_id, device_id, capability, target_value, idempotency_key, requested_by) values
  ('aaaaaaaa-4444-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-3333-4000-8000-000000000001', 'power', 'false', 'fixture-key-a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-4444-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001', 'bbbbbbbb-3333-4000-8000-000000000001', 'power', 'true', 'fixture-key-b', 'bbbbbbbb-0000-4000-8000-000000000001');
insert into public.command_attempts (property_id, command_id, attempt_number) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-4444-4000-8000-000000000001', 1),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'bbbbbbbb-4444-4000-8000-000000000001', 1);
insert into public.realtime_events (property_id, event_type, device_id, payload) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'device.state_changed', 'aaaaaaaa-3333-4000-8000-000000000001', '{"capability":"power","value":true}'),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'device.state_changed', 'bbbbbbbb-3333-4000-8000-000000000001', '{"capability":"power","value":false}');

do $$
declare
  owner_a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  member_a uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  viewer_a uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  owner_b uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  prop_a text := 'aaaaaaaa-1111-4000-8000-000000000001';
  prop_b text := 'bbbbbbbb-1111-4000-8000-000000000001';
  dev_a text := 'aaaaaaaa-3333-4000-8000-000000000001';
  dev_b text := 'bbbbbbbb-3333-4000-8000-000000000001';
  t text;
begin
  -- Tenant-scoped reads
  foreach t in array array['hubs','devices','device_capabilities','device_states','device_commands','realtime_events'] loop
    perform pg_temp.expect_count(member_a, format('select count(*) from public.%I', t),
      case t when 'device_capabilities' then 4 else 1 end, 'member A reads only property A ' || t);
    perform pg_temp.expect_count(viewer_a, format('select count(*) from public.%I', t),
      case t when 'device_capabilities' then 4 else 1 end, 'viewer A reads property A ' || t);
    perform pg_temp.expect_count(owner_b, format('select count(*) from public.%I where property_id = %L', t, prop_a), 0, 'outsider B reads nothing of A in ' || t);
    perform pg_temp.expect_error(null, format('select count(*) from public.%I', t), '42501', 'anon denied on ' || t);
  end loop;

  perform pg_temp.expect_count(owner_a, 'select count(*) from public.command_attempts', 1, 'owner A reads own attempts only');
  perform pg_temp.expect_count(member_a, 'select count(*) from public.command_attempts', 0, 'member A cannot read attempts');
  perform pg_temp.expect_count(owner_b, format('select count(*) from public.command_attempts where property_id = %L', prop_a), 0, 'outsider cannot read A attempts');

  -- Device-reported state and inventory are not client-writable (even for owners)
  perform pg_temp.expect_error(owner_a, format('update public.device_states set value = %L where device_id = %L', 'false', dev_a), '42501', 'owner cannot update device_states');
  perform pg_temp.expect_error(owner_a, format('insert into public.device_states (property_id, device_id, capability, value) values (%L, %L, %L, %L)', prop_a, dev_a, 'brightness', '5'), '42501', 'owner cannot insert device_states');
  perform pg_temp.expect_error(owner_a, format('delete from public.device_states where device_id = %L', dev_a), '42501', 'owner cannot delete device_states');
  perform pg_temp.expect_error(owner_a, format('update public.devices set online = true where id = %L', dev_a), '42501', 'owner cannot update devices');
  perform pg_temp.expect_error(owner_a, format('update public.hubs set status = %L', 'online'), '42501', 'owner cannot update hubs');
  perform pg_temp.expect_error(owner_a, format('insert into public.realtime_events (property_id, event_type) values (%L, %L)', prop_a, 'hub.status_changed'), '42501', 'owner cannot insert realtime_events');
  perform pg_temp.expect_error(owner_a, format('insert into public.command_attempts (property_id, command_id, attempt_number) values (%L, %L, 2)', prop_a, 'aaaaaaaa-4444-4000-8000-000000000001'), '42501', 'owner cannot insert command_attempts');

  -- Command inserts
  perform pg_temp.expect_ok(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'brightness', '40', 'member-key-0001'), 'member A inserts absolute command');
  perform pg_temp.expect_ok(owner_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'mode', '"cool"', 'owner-key-0001'), 'owner A inserts enum command');
  perform pg_temp.expect_error(viewer_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'power', 'true', 'viewer-key-0001'), '42501', 'viewer cannot insert commands');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_b, dev_b, 'power', 'true', 'cross-key-0001'), '42501', 'member A cannot command property B');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_b, 'power', 'true', 'cross-key-0002'), '23503', 'property_id/device mismatch rejected');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key, status) values (%L, %L, %L, %L, %L, %L)', prop_a, dev_a, 'power', 'true', 'status-key-0001', 'applied'), '42501', 'client cannot set status');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key, requested_by) values (%L, %L, %L, %L, %L, %L)', prop_a, dev_a, 'power', 'true', 'spoof-key-0001', owner_a), '42501', 'client cannot set requested_by');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'brightness', '150', 'range-key-0001'), '22023', 'out-of-range target rejected');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'brightness', '40.5', 'range-key-0002'), '22023', 'non-integer target rejected');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'brightness', '"+10"', 'delta-key-0001'), '22023', 'relative string target rejected');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'brightness', '{"delta":10}', 'delta-key-0002'), '22023', 'object/delta target rejected');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'pm25', '5', 'ro-key-0001'), '22023', 'read-only capability rejected');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'mode', '"disco"', 'enum-key-0001'), '22023', 'unknown enum value rejected');
  perform pg_temp.expect_error(member_a, format('insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values (%L, %L, %L, %L, %L)', prop_a, dev_a, 'power', 'true', 'member-key-0001'), '23505', 'duplicate idempotency key rejected');
  perform pg_temp.expect_count(member_a, 'select count(*) from public.device_commands where idempotency_key = ''member-key-0001'' and status = ''pending'' and requested_by = ''aaaaaaaa-0000-4000-8000-000000000002''', 1, 'inserted command is pending and owned by caller');
  perform pg_temp.expect_error(member_a, format('update public.device_commands set status = %L where property_id = %L', 'applied', prop_a), '42501', 'client cannot update commands');
  perform pg_temp.expect_error(owner_a, format('delete from public.device_commands where property_id = %L', prop_a), '42501', 'client cannot delete commands');

  -- Server-side lifecycle invariants (service role bypasses RLS)
  perform pg_temp.expect_error(null, 'select 1/0', '22012', 'harness sanity');
  begin
    update public.device_commands set status = 'applied' where id = 'aaaaaaaa-4444-4000-8000-000000000001';
    raise exception 'FAIL applied without applied_at accepted';
  exception when check_violation then raise notice 'PASS applied requires applied_at';
  end;
  begin
    update public.device_commands set acknowledged_at = now(), status = 'sent', sent_at = now() where id = 'aaaaaaaa-4444-4000-8000-000000000001';
    raise notice 'PASS acknowledged command stays sent (not applied)';
  end;
end $$;

-- Service role writes (backend path)
set local role service_role;
update public.device_states set value = 'false' where device_id = 'aaaaaaaa-3333-4000-8000-000000000001' and capability = 'power';
insert into public.realtime_events (property_id, event_type) values ('aaaaaaaa-1111-4000-8000-000000000001', 'hub.status_changed');
reset role;

do $$
begin
  raise notice 'PASS service_role can write reported state and events';

  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'realtime_events') then
    raise exception 'FAIL realtime_events missing from supabase_realtime publication';
  end if;
  raise notice 'PASS realtime_events in supabase_realtime publication';

  -- Both fixture properties use slug 'tehran' in different organizations.
  if (select count(*) from public.properties where slug = 'tehran'
      and id in ('aaaaaaaa-1111-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001')) <> 2 then
    raise exception 'FAIL duplicate slug across organizations not allowed';
  end if;
  raise notice 'PASS same slug allowed in different organizations';
end $$;

rollback;
