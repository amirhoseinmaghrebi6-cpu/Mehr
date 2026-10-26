-- Phase 5A: invitations and member changes are guarded by RLS too, not only by the API. Runs as
-- the superuser in one rolled-back transaction, switching to each user.
-- Run with: pnpm db:test
-- expect-pass: 8
begin;

insert into auth.users (id, email, phone) values
  ('a9000000-0000-4000-8000-000000000001', 'p5-owner@test.local', '+989129000001'),
  ('a9000000-0000-4000-8000-000000000002', 'p5-admin@test.local', '+989129000002'),
  ('a9000000-0000-4000-8000-000000000003', 'p5-member@test.local', '+989129000003'),
  ('a9000000-0000-4000-8000-000000000004', 'p5-invited@test.local', '+989129000004'),
  ('a9000000-0000-4000-8000-000000000005', 'p5-other@test.local', '+989129000005');
insert into public.properties (id, organization_id, name, created_by)
select 'a9000000-1111-4000-8000-00000000000a', organization_id, 'Phase 5 home', user_id
from public.organization_members where user_id = 'a9000000-0000-4000-8000-000000000001';
insert into public.property_members (property_id, user_id, role) values
  ('a9000000-1111-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000001', 'owner'),
  ('a9000000-1111-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000002', 'admin'),
  ('a9000000-1111-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000003', 'member');

do $$
declare
  home uuid := 'a9000000-1111-4000-8000-00000000000a';
  owner_id uuid := 'a9000000-0000-4000-8000-000000000001';
  admin_id uuid := 'a9000000-0000-4000-8000-000000000002';
  member_id uuid := 'a9000000-0000-4000-8000-000000000003';
  invited_id uuid := 'a9000000-0000-4000-8000-000000000004';
  other_id uuid := 'a9000000-0000-4000-8000-000000000005';
  invitation uuid;
  joined uuid;
  n bigint;
begin
  -- An admin may invite members, not admins.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.property_invitations (property_id, phone, role, invited_by) values (home, '+989129000009', 'admin', admin_id);
    raise exception 'FAIL an admin invited an admin';
  exception when insufficient_privilege then raise notice 'PASS an admin cannot invite an admin';
  end;
  insert into public.property_invitations (property_id, phone, role, invited_by) values (home, '+989129000004', 'member', admin_id) returning id into invitation;
  raise notice 'PASS an admin invites a member';
  -- An admin cannot change roles.
  update public.property_members set role = 'admin' where property_id = home and user_id = member_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL an admin changed a role'; end if;
  raise notice 'PASS only the owner changes roles';
  reset role;

  -- A member cannot invite and sees no invitations.
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.property_invitations (property_id, phone, role, invited_by) values (home, '+989129000008', 'member', member_id);
    raise exception 'FAIL a member invited someone';
  exception when insufficient_privilege then raise notice 'PASS a member cannot invite';
  end;
  if exists (select 1 from public.property_invitations) then raise exception 'FAIL a member sees invitations'; end if;
  raise notice 'PASS a member sees no invitations';
  reset role;

  -- Someone else cannot see or accept an invitation to another number.
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.property_invitations) or exists (select 1 from public.my_property_invitations()) then raise exception 'FAIL another number sees the invitation'; end if;
  if public.accept_property_invitation(invitation) is not null then raise exception 'FAIL another number accepted the invitation'; end if;
  raise notice 'PASS an invitation is only for its own number';
  reset role;

  -- The invited number accepts: joins with the role, the invitation is gone.
  perform set_config('request.jwt.claims', json_build_object('sub', invited_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  joined := public.accept_property_invitation(invitation);
  reset role;
  if joined is distinct from home
    or (select role from public.property_members where property_id = home and user_id = invited_id) is distinct from 'member'
    or exists (select 1 from public.property_invitations where id = invitation) then
    raise exception 'FAIL accepting';
  end if;
  raise notice 'PASS accepting joins the home and deletes the invitation';

  -- The owner cannot leave (delete their own membership).
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.property_members where property_id = home and user_id = owner_id;
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'FAIL the owner left their home'; end if;
  raise notice 'PASS the owner cannot leave';
end;
$$;

rollback;
