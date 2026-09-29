-- Sign-up trigger (on_auth_user_created -> public.handle_new_auth_user). Every new auth user
-- must get a profile, a personal organization and an owner membership, with or without an
-- email address. Runs inside a transaction that is rolled back. Run with: pnpm db:test
-- expect-pass: 12
begin;

create function pg_temp.expect_signup(uid uuid, expected_name text, label text) returns void language plpgsql as $$
declare
  profile_name text;
  org_name text;
  owner_count int;
begin
  select full_name into profile_name from public.profiles where user_id = uid;
  if profile_name is distinct from expected_name then
    raise exception 'FAIL % profile: got %, expected %', label, profile_name, expected_name;
  end if;
  raise notice 'PASS % gets profile "%"', label, profile_name;

  select organization.name, count(*) over () into org_name, owner_count
  from public.organization_members as membership
  join public.organizations as organization on organization.id = membership.organization_id
  where membership.user_id = uid and membership.role = 'owner';
  if org_name is distinct from expected_name || '''s home' then
    raise exception 'FAIL % organization: got %, expected %''s home', label, org_name, expected_name;
  end if;
  raise notice 'PASS % gets organization "%"', label, org_name;

  if owner_count <> 1 then
    raise exception 'FAIL % owner memberships: got %, expected 1', label, owner_count;
  end if;
  raise notice 'PASS % is owner of exactly one organization', label;
end $$;

insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001', 'sara@test.local');
insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-0000-4000-8000-000000000002', 'ali@test.local', '{"full_name":"  Ali Rezaei  "}');
insert into auth.users (id, phone) values
  ('dddddddd-0000-4000-8000-000000000003', '+989121234567');
insert into auth.users (id) values
  ('dddddddd-0000-4000-8000-000000000004');

do $$
begin
  perform pg_temp.expect_signup('dddddddd-0000-4000-8000-000000000001', 'sara', 'email-only user');
  perform pg_temp.expect_signup('dddddddd-0000-4000-8000-000000000002', 'Ali Rezaei', 'user with full_name');
  perform pg_temp.expect_signup('dddddddd-0000-4000-8000-000000000003', '+989121234567', 'phone-only user');
  perform pg_temp.expect_signup('dddddddd-0000-4000-8000-000000000004', 'M2smart user', 'user with no email or phone');
end $$;

rollback;
