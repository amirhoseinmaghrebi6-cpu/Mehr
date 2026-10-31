-- Platform administration: the operator's panel (/admin), for the phone numbers listed in the
-- API's PLATFORM_ADMIN_PHONES. The API checks that list; these functions only run as service_role
-- (withSystemTx) and are never granted to users.
--
-- The panel sees counts, people (name, phone, how many homes) and boards (model, online), never
-- what is inside a home: no room, device or scenario names, no states, no commands.
--
-- Blocking: Kratos refuses the identity (state "inactive", set by the API) and the API refuses
-- its requests; blocked_at records it. Deleting a user removes their organizations and every home
-- in them (and any other home they created), then the user, which cascades to the rest. Additive.

alter table public.profiles add column if not exists blocked_at timestamptz;

create or replace function public.platform_overview()
returns table (users bigint, blocked_users bigint, homes bigint, boards bigint, boards_online bigint, commands_today bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from auth.users),
    (select count(*) from public.profiles where blocked_at is not null),
    (select count(*) from public.properties),
    (select count(*) from public.controllers),
    (select count(*) from public.controllers where online),
    (select count(*) from public.device_commands where created_at > now() - interval '24 hours');
$$;

create or replace function public.platform_users(p_search text, p_offset integer, p_limit integer)
returns table (id uuid, full_name text, phone text, created_at timestamptz, blocked_at timestamptz, homes_owned bigint, homes_joined bigint, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select person.id, coalesce(profile.full_name, ''), person.phone, person.created_at, profile.blocked_at,
    (select count(*) from public.property_members as member where member.user_id = person.id and member.role = 'owner'),
    (select count(*) from public.property_members as member where member.user_id = person.id and member.role <> 'owner'),
    count(*) over ()
  from auth.users as person
  left join public.profiles as profile on profile.user_id = person.id
  where coalesce(p_search, '') = ''
    or profile.full_name ilike '%' || p_search || '%'
    or person.phone like '%' || p_search || '%'
  order by person.created_at desc
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.platform_boards(p_offset integer, p_limit integer)
returns table (id uuid, hardware_uid text, model_name text, firmware_version text, online boolean, last_seen_at timestamptz, created_at timestamptz, owner_name text, owner_phone text, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select board.id, board.hardware_uid, model.name, board.firmware_version, board.online, board.last_seen_at, board.created_at,
    coalesce(profile.full_name, ''), person.phone, count(*) over ()
  from public.controllers as board
  join public.hardware_models as model on model.id = board.model_id
  left join public.property_members as owner on owner.property_id = board.property_id and owner.role = 'owner'
  left join auth.users as person on person.id = owner.user_id
  left join public.profiles as profile on profile.user_id = owner.user_id
  order by board.online desc, board.last_seen_at desc nulls last, board.created_at desc
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.platform_set_blocked(p_user_id uuid, p_blocked boolean)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set blocked_at = case when p_blocked then coalesce(blocked_at, now()) else null end
  where user_id = p_user_id
  returning true;
$$;

create or replace function public.platform_is_blocked(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where user_id = p_user_id and blocked_at is not null);
$$;

-- Returns the boards that were in the deleted homes, so the API can remove their broker accounts.
create or replace function public.platform_delete_user(p_user_id uuid)
returns table (board_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  homes uuid[];
begin
  select coalesce(array_agg(home.id), '{}') into homes
  from public.properties as home
  where home.created_by = p_user_id
    or home.organization_id in (select organization_id from public.organization_members where user_id = p_user_id and role = 'owner');

  return query select board.id from public.controllers as board where board.property_id = any (homes);

  delete from public.board_pairings
  where controller_id in (select board.id from public.controllers as board where board.property_id = any (homes));
  delete from public.properties where id = any (homes);
  delete from public.organizations
  where id in (select organization_id from public.organization_members where user_id = p_user_id and role = 'owner');
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.platform_overview(), public.platform_users(text, integer, integer), public.platform_boards(integer, integer),
  public.platform_set_blocked(uuid, boolean), public.platform_is_blocked(uuid), public.platform_delete_user(uuid) from public, anon, authenticated;
grant execute on function public.platform_overview(), public.platform_users(text, integer, integer), public.platform_boards(integer, integer),
  public.platform_set_blocked(uuid, boolean), public.platform_is_blocked(uuid), public.platform_delete_user(uuid) to service_role;
