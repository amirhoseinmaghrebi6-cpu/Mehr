-- Phase 4A: the board registry and pending pairings are backend-only; a board has at most one
-- pairing code; scenario validity windows. Runs as the superuser in one rolled-back transaction.
-- Run with: pnpm db:test
-- expect-pass: 9
begin;

insert into auth.users (id, email) values
  ('a8000000-0000-4000-8000-000000000001', 'p4-a@test.local'),
  ('a8000000-0000-4000-8000-000000000002', 'p4-m@test.local'),
  ('a8000000-0000-4000-8000-000000000003', 'p4-b@test.local');
insert into public.properties (id, organization_id, name, created_by)
select 'a8000000-1111-4000-8000-00000000000a', organization_id, 'Phase 4 home A', user_id
from public.organization_members where user_id = 'a8000000-0000-4000-8000-000000000001';
insert into public.properties (id, organization_id, name, created_by)
select 'a8000000-1111-4000-8000-00000000000b', organization_id, 'Phase 4 home B', user_id
from public.organization_members where user_id = 'a8000000-0000-4000-8000-000000000003';
insert into public.property_members (property_id, user_id, role) values
  ('a8000000-1111-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000001', 'owner'),
  ('a8000000-1111-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000002', 'member'),
  ('a8000000-1111-4000-8000-00000000000b', 'a8000000-0000-4000-8000-000000000003', 'owner');
insert into public.hubs (id, property_id, name, hardware_id) values
  ('a8000000-2222-4000-8000-00000000000a', 'a8000000-1111-4000-8000-00000000000a', 'Cloud', 'p4-cloud-a');
insert into public.devices (id, property_id, hub_id, external_id, name, kind) values
  ('a8000000-3333-4000-8000-00000000000a', 'a8000000-1111-4000-8000-00000000000a', 'a8000000-2222-4000-8000-00000000000a', 'meter', 'Meter A', 'plug');
insert into public.hardware_models (id, code, name) values ('a8000000-4444-4000-8000-000000000001', 'p4-test-model', 'Phase 4 test model');
insert into public.manufactured_boards (hardware_uid, model_id, factory_secret_hash) values
  ('P4-TEST-0001', 'a8000000-4444-4000-8000-000000000001', repeat('a', 64)),
  ('P4-TEST-0002', 'a8000000-4444-4000-8000-000000000001', repeat('b', 64));
insert into public.board_pairings (hardware_uid, code_hash) values ('P4-TEST-0001', repeat('1', 64));

do $$
declare
  home_a uuid := 'a8000000-1111-4000-8000-00000000000a';
  meter_a uuid := 'a8000000-3333-4000-8000-00000000000a';
  owner_a uuid := 'a8000000-0000-4000-8000-000000000001';
  member_a uuid := 'a8000000-0000-4000-8000-000000000002';
  owner_b uuid := 'a8000000-0000-4000-8000-000000000003';
  scenario_id uuid;
  n bigint;
begin
  -- One pairing code per board: pairing mode again replaces it.
  begin
    insert into public.board_pairings (hardware_uid, code_hash) values ('P4-TEST-0001', repeat('2', 64));
    raise exception 'FAIL two pairing codes for one board';
  exception when unique_violation then raise notice 'PASS a board has at most one pairing code';
  end;
  begin
    insert into public.board_pairings (hardware_uid, code_hash) values ('P4-TEST-0002', repeat('1', 64));
    raise exception 'FAIL one pairing code for two boards';
  exception when unique_violation then raise notice 'PASS a pairing code belongs to one board';
  end;
  begin
    insert into public.board_pairings (hardware_uid, code_hash) values ('P4-UNKNOWN', repeat('3', 64));
    raise exception 'FAIL pairing for a board that was never made';
  exception when foreign_key_violation then raise notice 'PASS only manufactured boards can wait for pairing';
  end;
  if (select expires_at - created_at from public.board_pairings where hardware_uid = 'P4-TEST-0001') <> interval '24 hours' then
    raise exception 'FAIL pairing code lifetime';
  end if;
  raise notice 'PASS a pairing code is valid for 24 hours';

  -- Users (even the home's owner) never see the registry or the pairings.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform 1 from public.manufactured_boards;
    raise exception 'FAIL user read the board registry';
  exception when insufficient_privilege then raise notice 'PASS users cannot read the board registry';
  end;
  begin
    perform 1 from public.board_pairings;
    raise exception 'FAIL user read pending pairings';
  exception when insufficient_privilege then raise notice 'PASS users cannot read pending pairings';
  end;

  -- Validity windows: only the offered values; owners set them.
  insert into public.scenarios (property_id, name, kind, weekdays, local_time) values (home_a, 'Window', 'periodic', array[1]::smallint[], '08:00')
    returning id into scenario_id;
  if (select late_window_seconds from public.scenarios where id = scenario_id) <> 600 then raise exception 'FAIL default window'; end if;
  update public.scenarios set late_window_seconds = 10800 where id = scenario_id;
  begin
    update public.scenarios set late_window_seconds = 7200 where id = scenario_id;
    raise exception 'FAIL unknown validity window accepted';
  exception when check_violation then raise notice 'PASS validity windows are 0, 10 minutes (default), 1 hour or 3 hours';
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.scenarios set late_window_seconds = 0 where id = scenario_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL member changed a validity window'; end if;
  raise notice 'PASS a member cannot change a validity window';

  reset role;

  -- Nothing stays behind: pairings leave with the board.
  delete from public.manufactured_boards where hardware_uid = 'P4-TEST-0001';
  if (select count(*) from public.board_pairings where hardware_uid = 'P4-TEST-0001') <> 0 then
    raise exception 'FAIL rows left behind';
  end if;
  raise notice 'PASS pairings leave with the board';
end $$;

rollback;
