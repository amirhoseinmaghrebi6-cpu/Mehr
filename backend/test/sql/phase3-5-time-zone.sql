-- Home time zones: a real IANA zone or nothing, default Tehran. Runs as the superuser in one
-- rolled-back transaction. Run with: pnpm db:test
-- expect-pass: 3
begin;

insert into auth.users (id, email) values ('a6000000-0000-4000-8000-000000000001', 'p35-tz@test.local');
insert into public.properties (id, organization_id, name, created_by)
select 'a6000000-1111-4000-8000-000000000001', organization_id, 'TZ home', user_id
from public.organization_members where user_id = 'a6000000-0000-4000-8000-000000000001';

do $$
begin
  if (select time_zone from public.properties where id = 'a6000000-1111-4000-8000-000000000001') <> 'Asia/Tehran' then
    raise exception 'FAIL default time zone';
  end if;
  raise notice 'PASS homes default to Asia/Tehran';

  update public.properties set time_zone = 'Europe/Istanbul' where id = 'a6000000-1111-4000-8000-000000000001';
  raise notice 'PASS a real IANA zone is accepted';

  begin
    update public.properties set time_zone = 'Mars/Olympus' where id = 'a6000000-1111-4000-8000-000000000001';
    raise exception 'FAIL unknown time zone accepted';
  exception when check_violation then raise notice 'PASS an unknown time zone is rejected';
  end;
end $$;

rollback;
