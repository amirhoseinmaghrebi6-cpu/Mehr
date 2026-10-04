-- Scenarios: RLS between two homes, roles (owners/admins edit, members only run), actions only on
-- the home's own writable capabilities, one run per occurrence, and occurrences in the home's time
-- zone. Runs as the superuser in one rolled-back transaction. Run with: pnpm db:test
-- expect-pass: 16
begin;

insert into auth.users (id, email) values
  ('a7000000-0000-4000-8000-000000000001', 'p35-scn-a@test.local'),
  ('a7000000-0000-4000-8000-000000000002', 'p35-scn-m@test.local'),
  ('a7000000-0000-4000-8000-000000000003', 'p35-scn-b@test.local');
insert into public.properties (id, organization_id, name, created_by, time_zone)
select 'a7000000-1111-4000-8000-00000000000a', organization_id, 'Scenario home A', user_id, 'Asia/Tehran'
from public.organization_members where user_id = 'a7000000-0000-4000-8000-000000000001';
insert into public.properties (id, organization_id, name, created_by)
select 'a7000000-1111-4000-8000-00000000000b', organization_id, 'Scenario home B', user_id
from public.organization_members where user_id = 'a7000000-0000-4000-8000-000000000003';
insert into public.property_members (property_id, user_id, role) values
  ('a7000000-1111-4000-8000-00000000000a', 'a7000000-0000-4000-8000-000000000001', 'owner'),
  ('a7000000-1111-4000-8000-00000000000a', 'a7000000-0000-4000-8000-000000000002', 'member'),
  ('a7000000-1111-4000-8000-00000000000b', 'a7000000-0000-4000-8000-000000000003', 'owner');
insert into public.hubs (id, property_id, name, hardware_id) values
  ('a7000000-2222-4000-8000-00000000000a', 'a7000000-1111-4000-8000-00000000000a', 'Hub A', 'p35-scn-hub-a'),
  ('a7000000-2222-4000-8000-00000000000b', 'a7000000-1111-4000-8000-00000000000b', 'Hub B', 'p35-scn-hub-b');
insert into public.devices (id, property_id, hub_id, external_id, name, kind) values
  ('a7000000-3333-4000-8000-00000000000a', 'a7000000-1111-4000-8000-00000000000a', 'a7000000-2222-4000-8000-00000000000a', 'lamp', 'Lamp A', 'light'),
  ('a7000000-3333-4000-8000-00000000000b', 'a7000000-1111-4000-8000-00000000000b', 'a7000000-2222-4000-8000-00000000000b', 'lamp', 'Lamp B', 'light');
insert into public.device_capabilities (property_id, device_id, capability, value_type, writable) values
  ('a7000000-1111-4000-8000-00000000000a', 'a7000000-3333-4000-8000-00000000000a', 'power', 'boolean', true),
  ('a7000000-1111-4000-8000-00000000000a', 'a7000000-3333-4000-8000-00000000000a', 'temperature', 'number', false),
  ('a7000000-1111-4000-8000-00000000000b', 'a7000000-3333-4000-8000-00000000000b', 'power', 'boolean', true);

do $$
declare
  home_a uuid := 'a7000000-1111-4000-8000-00000000000a';
  home_b uuid := 'a7000000-1111-4000-8000-00000000000b';
  lamp_a uuid := 'a7000000-3333-4000-8000-00000000000a';
  lamp_b uuid := 'a7000000-3333-4000-8000-00000000000b';
  owner_a uuid := 'a7000000-0000-4000-8000-000000000001';
  member_a uuid := 'a7000000-0000-4000-8000-000000000002';
  owner_b uuid := 'a7000000-0000-4000-8000-000000000003';
  scenario_a uuid;
  themed_a uuid;
  run_id uuid;
  n bigint;
begin
  -- The owner creates scenarios of their home.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.scenarios (property_id, name, kind, weekdays, local_time) values (home_a, 'Evening', 'periodic', array[2, 6]::smallint[], '15:00')
    returning id into scenario_a;
  insert into public.scenarios (property_id, name, kind) values (home_a, 'Morning', 'themed') returning id into themed_a;
  insert into public.scenario_actions (scenario_id, property_id, position, device_id, capability, target_value) values (scenario_a, home_a, 0, lamp_a, 'power', 'true');
  insert into public.scenario_actions (scenario_id, property_id, position, device_id, capability, target_value) values (themed_a, home_a, 0, lamp_a, 'power', 'true');
  raise notice 'PASS an owner creates scenarios and actions';

  begin
    insert into public.scenarios (property_id, name, kind) values (home_b, 'Intruder', 'themed');
    raise exception 'FAIL owner A created a scenario in home B';
  exception when insufficient_privilege then raise notice 'PASS an owner cannot create a scenario in another home';
  end;

  begin
    insert into public.scenario_actions (scenario_id, property_id, position, device_id, capability, target_value) values (scenario_a, home_a, 1, lamp_b, 'power', 'true');
    raise exception 'FAIL action on home B''s device';
  exception when foreign_key_violation then raise notice 'PASS an action cannot target another home''s device';
  end;

  begin
    insert into public.scenario_actions (scenario_id, property_id, position, device_id, capability, target_value) values (scenario_a, home_a, 1, lamp_a, 'temperature', '20');
    raise exception 'FAIL action on a read-only capability';
  exception when invalid_parameter_value then raise notice 'PASS an action cannot write a read-only capability';
  end;

  begin
    insert into public.scenario_actions (scenario_id, property_id, position, device_id, capability, target_value) values (themed_a, home_a, 1, lamp_a, 'power', '"on"');
    raise exception 'FAIL action with a wrong value type';
  exception when invalid_parameter_value or unique_violation then raise notice 'PASS an action value must fit the capability';
  end;

  begin
    insert into public.scenarios (property_id, name, kind, local_time) values (home_a, 'Broken', 'themed', '08:00');
    raise exception 'FAIL themed scenario with a time';
  exception when check_violation then raise notice 'PASS each kind has exactly its own schedule fields';
  end;

  begin
    update public.scenarios set schedule_from = '2000-01-01' where id = scenario_a;
    raise exception 'FAIL schedule_from changed by a user';
  exception when insufficient_privilege then raise notice 'PASS users cannot move a scenario''s schedule start';
  end;
  reset role;

  -- A member sees and runs, but does not edit.
  perform set_config('request.jwt.claims', json_build_object('sub', member_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.scenarios where property_id = home_a) <> 2 then raise exception 'FAIL member cannot see scenarios'; end if;
  raise notice 'PASS a member sees the home''s scenarios';

  update public.scenarios set name = 'Renamed' where id = scenario_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL member renamed a scenario'; end if;
  delete from public.scenarios where id = scenario_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL member deleted a scenario'; end if;
  raise notice 'PASS a member cannot change or delete scenarios';

  insert into public.scenario_runs (property_id, scenario_id, trigger) values (home_a, themed_a, 'manual') returning id into run_id;
  insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key, scenario_run_id)
  values (home_a, lamp_a, 'power', 'true', 'p35-scn-' || run_id, run_id);
  raise notice 'PASS a member runs a scenario; its commands are linked to the run';

  begin
    insert into public.scenario_runs (property_id, scenario_id, trigger) values (home_a, scenario_a, 'schedule');
    raise exception 'FAIL user recorded a scheduled run';
  exception when insufficient_privilege or check_violation then raise notice 'PASS only the hub records scheduled runs';
  end;
  reset role;

  -- Owner B sees nothing of home A.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.scenarios where property_id = home_a) + (select count(*) from public.scenario_actions where property_id = home_a)
     + (select count(*) from public.scenario_runs where property_id = home_a) <> 0 then
    raise exception 'FAIL owner B sees home A''s scenarios';
  end if;
  raise notice 'PASS another home sees no scenarios, actions or runs';

  begin
    insert into public.scenario_runs (property_id, scenario_id, trigger) values (home_a, themed_a, 'manual');
    raise exception 'FAIL owner B ran home A''s scenario';
  exception when insufficient_privilege then raise notice 'PASS another home cannot run a scenario';
  end;
  reset role;

  -- The hub's view: occurrences in the home's time zone, each recorded once.
  update public.scenarios set schedule_from = '2029-01-01' where id = scenario_a;
  -- Saturday 2030-01-05 15:01 in Tehran = 11:31 UTC; the occurrence is 15:00 Tehran = 11:30 UTC.
  if (select scheduled_for from public.scenario_due_occurrences('2030-01-05 11:31:00+00') where scenario_id = scenario_a) <> '2030-01-05 11:30:00+00' then
    raise exception 'FAIL occurrence not at 15:00 Tehran time';
  end if;
  raise notice 'PASS occurrences are at the local time of the home''s time zone';

  insert into public.scenario_runs (property_id, scenario_id, trigger, scheduled_for) values (home_a, scenario_a, 'schedule', '2030-01-05 11:30:00+00');
  begin
    insert into public.scenario_runs (property_id, scenario_id, trigger, scheduled_for, status) values (home_a, scenario_a, 'schedule', '2030-01-05 11:30:00+00', 'missed');
    raise exception 'FAIL occurrence recorded twice';
  exception when unique_violation then raise notice 'PASS each occurrence is recorded once';
  end;

  -- Next run after Saturday 15:01 is Tuesday 2030-01-08 15:00 Tehran (11:30 UTC).
  if public.scenario_next_occurrence(scenario_a, '2030-01-05 11:31:00+00') <> '2030-01-08 11:30:00+00' then
    raise exception 'FAIL next occurrence %', public.scenario_next_occurrence(scenario_a, '2030-01-05 11:31:00+00');
  end if;
  raise notice 'PASS the next run is the next chosen weekday';
end $$;

rollback;
