-- Phase 3B (1/2): home roles, rooms, home details and home creation. Additive; earlier
-- migrations are unchanged.
--
-- Tenant boundary as before: every row carries property_id and composite foreign keys keep
-- child rows inside their home. Writes by users go through RLS; the API checks the same rules
-- in code first (packages/contracts/src/permissions.ts).

-- Home roles are owner, admin and member only. Refuse (rather than silently change) any
-- existing guest or viewer membership.
do $$
begin
  if exists (select 1 from public.property_members where role not in ('owner', 'admin', 'member')) then
    raise exception 'property_members has guest/viewer rows; reassign or remove them before this migration';
  end if;
end;
$$;

alter table public.property_members drop constraint if exists property_members_role_check;
alter table public.property_members
  add constraint property_members_role_check check (role in ('owner', 'admin', 'member'));

-- Built-in photos (public/images); keep in sync with photoPresets in packages/contracts.
create or replace function public.is_photo_preset(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value in ('living', 'exterior', 'kitchen', 'bedroom');
$$;
revoke all on function public.is_photo_preset(text) from public, anon;
grant execute on function public.is_photo_preset(text) to authenticated, service_role;

-- Home details.
alter table public.properties add column if not exists address text not null default '';
alter table public.properties add column if not exists cover_photo text not null default 'living';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_details_check') then
    alter table public.properties add constraint properties_details_check check (
      char_length(btrim(name)) between 1 and 80
      and char_length(address) <= 200
      and public.is_photo_preset(cover_photo)
    );
  end if;
end;
$$;

-- Rooms.
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  photo text not null default 'living' check (public.is_photo_preset(photo)),
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id)
);
create unique index if not exists rooms_property_id_name_key on public.rooms (property_id, lower(btrim(name)));

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at before update on public.rooms
  for each row execute function public.set_updated_at();

-- Devices point at a room of their own home. Deleting the room only clears room_id.
alter table public.devices add column if not exists room_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'devices_room_same_property_fkey') then
    alter table public.devices add constraint devices_room_same_property_fkey
      foreign key (room_id, property_id) references public.rooms (id, property_id) on delete set null (room_id);
  end if;
end;
$$;
create index if not exists devices_room_id_idx on public.devices (room_id) where room_id is not null;

-- Backfill: every distinct room_name becomes a room of its home. room_name stays for now.
insert into public.rooms (property_id, name)
select distinct on (device.property_id, lower(btrim(device.room_name))) device.property_id, btrim(device.room_name)
from public.devices as device
where device.room_name is not null and btrim(device.room_name) <> ''
order by device.property_id, lower(btrim(device.room_name)), device.room_name
on conflict do nothing;

update public.devices as device
set room_id = room.id
from public.rooms as room
where device.room_id is null
  and room.property_id = device.property_id
  and lower(btrim(room.name)) = lower(btrim(device.room_name));

-- RLS: members read rooms; owners and admins write them.
alter table public.rooms enable row level security;

create policy "rooms_select_property_members" on public.rooms
  for select to authenticated
  using (public.is_property_member(property_id));

create policy "rooms_insert_property_admins" on public.rooms
  for insert to authenticated
  with check (public.has_property_role(property_id, array['owner', 'admin']));

create policy "rooms_update_property_admins" on public.rooms
  for update to authenticated
  using (public.has_property_role(property_id, array['owner', 'admin']))
  with check (public.has_property_role(property_id, array['owner', 'admin']));

create policy "rooms_delete_property_admins" on public.rooms
  for delete to authenticated
  using (public.has_property_role(property_id, array['owner', 'admin']));

revoke all on public.rooms from anon, authenticated;
grant select, delete on public.rooms to authenticated;
grant insert (property_id, name, photo, sort_order) on public.rooms to authenticated;
grant update (name, photo, sort_order) on public.rooms to authenticated;

-- Owners and admins may rename a device or move it to a room; nothing else about a device is
-- user-writable (hardware, type, status stay backend-only).
create policy "devices_update_property_admins" on public.devices
  for update to authenticated
  using (public.has_property_role(property_id, array['owner', 'admin']))
  with check (public.has_property_role(property_id, array['owner', 'admin']));
grant update (name, room_id) on public.devices to authenticated;

-- A home's own owners and admins may edit it, and its owners may delete it (in addition to the
-- organization owners and admins allowed by the Phase 1 policies).
create policy "properties_update_property_admins" on public.properties
  for update to authenticated
  using (public.has_property_role(id, array['owner', 'admin']))
  with check (public.has_property_role(id, array['owner', 'admin']));

create policy "properties_delete_property_owners" on public.properties
  for delete to authenticated
  using (public.has_property_role(id, array['owner']));

-- Until now every column of a home was updatable; narrow that so a home's organization, creator
-- and id can never be changed by a client.
revoke update on public.properties from authenticated;
grant update (name, property_type, address, cover_photo) on public.properties to authenticated;

-- Creates a home and makes the caller its owner in one step, so a home never exists without an
-- owner. Runs with the caller's rights (security invoker): the existing RLS policies decide
-- whether the caller may create a home in that organization. Without an organization, the
-- caller's own (first owned) organization is used.
create or replace function public.create_property(
  p_name text,
  p_property_type text default 'house',
  p_address text default '',
  p_cover_photo text default 'living',
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  organization uuid := p_organization_id;
  new_id uuid;
begin
  if caller is null then
    raise exception 'create_property requires a signed-in user' using errcode = '42501';
  end if;

  if organization is null then
    select membership.organization_id into organization
    from public.organization_members as membership
    where membership.user_id = caller and membership.role = 'owner'
    order by membership.created_at
    limit 1;
    if organization is null then
      raise exception 'caller owns no organization' using errcode = '42501';
    end if;
  end if;

  insert into public.properties (organization_id, name, property_type, address, cover_photo, created_by)
  values (organization, btrim(p_name), p_property_type, btrim(coalesce(p_address, '')), p_cover_photo, caller)
  returning id into new_id;

  insert into public.property_members (property_id, user_id, role) values (new_id, caller, 'owner');
  return new_id;
end;
$$;
revoke all on function public.create_property(text, text, text, text, uuid) from public, anon;
grant execute on function public.create_property(text, text, text, text, uuid) to authenticated;
