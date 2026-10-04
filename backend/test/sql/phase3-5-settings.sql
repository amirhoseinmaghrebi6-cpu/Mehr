-- User settings on profiles: defaults, allowed values, and that a user can change only their own
-- preferences (and never their user id). Runs as the superuser in one rolled-back transaction.
-- Run with: pnpm db:test
-- expect-pass: 6
begin;

insert into auth.users (id, email) values
  ('a5000000-0000-4000-8000-000000000001', 'p35-a@test.local'),
  ('a5000000-0000-4000-8000-000000000002', 'p35-b@test.local');

do $$
declare
  a uuid := 'a5000000-0000-4000-8000-000000000001';
  b uuid := 'a5000000-0000-4000-8000-000000000002';
  n bigint;
begin
  if (select count(*) from public.profiles where user_id = a and language = 'en' and calendar = 'solar_hijri' and temperature_unit = 'celsius') <> 1 then
    raise exception 'FAIL new profile defaults';
  end if;
  raise notice 'PASS new profiles default to English, Solar Hijri, Celsius';

  begin
    update public.profiles set calendar = 'lunar_hijri' where user_id = a;
    raise exception 'FAIL unknown calendar accepted';
  exception when check_violation then raise notice 'PASS unknown calendar rejected';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set language = 'fa', temperature_unit = 'fahrenheit' where user_id = a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL user A could not change own settings'; end if;
  raise notice 'PASS a user changes their own settings';

  update public.profiles set language = 'ar' where user_id = b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL user A changed user B''s settings'; end if;
  raise notice 'PASS a user cannot change another user''s settings';

  begin
    update public.profiles set user_id = b where user_id = a;
    raise exception 'FAIL user id changed';
  exception when insufficient_privilege then raise notice 'PASS a user cannot change their user id';
  end;
  reset role;

  if (select language from public.profiles where user_id = b) <> 'en' then raise exception 'FAIL user B changed'; end if;
  raise notice 'PASS user B is unchanged';
end $$;

rollback;
