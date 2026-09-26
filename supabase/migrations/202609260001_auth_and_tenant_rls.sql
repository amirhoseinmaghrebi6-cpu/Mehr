create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  property_type text not null default 'house' check (property_type in ('house', 'villa', 'apartment', 'office', 'commercial', 'custom')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.property_members (
  property_id uuid not null references public.properties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'guest', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (property_id, user_id)
);

create index if not exists properties_organization_id_idx on public.properties (organization_id);
create index if not exists property_members_user_id_idx on public.property_members (user_id);

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_organization_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = any (allowed_roles)
  );
$$;

create or replace function public.is_property_member(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.property_members as membership
    where membership.property_id = target_property_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_property_role(target_property_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.property_members as membership
    where membership.property_id = target_property_id
      and membership.user_id = (select auth.uid())
      and membership.role = any (allowed_roles)
  );
$$;

revoke all on function public.is_organization_member(uuid) from public, anon;
revoke all on function public.has_organization_role(uuid, text[]) from public, anon;
revoke all on function public.is_property_member(uuid) from public, anon;
revoke all on function public.has_property_role(uuid, text[]) from public, anon;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, text[]) to authenticated;
grant execute on function public.is_property_member(uuid) to authenticated;
grant execute on function public.has_property_role(uuid, text[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.properties enable row level security;
alter table public.property_members enable row level security;

create policy "profiles_select_self" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles_insert_self" on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "organizations_select_members" on public.organizations
  for select to authenticated
  using (public.is_organization_member(id));

create policy "organization_members_select_self_or_admin" on public.organization_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_organization_role(organization_id, array['owner', 'admin']));

create policy "organization_members_insert_admin" on public.organization_members
  for insert to authenticated
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy "organization_members_delete_admin" on public.organization_members
  for delete to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']) and user_id <> (select auth.uid()));

create policy "properties_select_authorized_members" on public.properties
  for select to authenticated
  using (
    public.has_organization_role(organization_id, array['owner', 'admin'])
    or public.is_property_member(id)
  );

create policy "properties_insert_organization_admin" on public.properties
  for insert to authenticated
  with check (public.has_organization_role(organization_id, array['owner', 'admin']) and created_by = (select auth.uid()));

create policy "properties_update_organization_admin" on public.properties
  for update to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy "properties_delete_organization_admin" on public.properties
  for delete to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy "property_members_select_authorized" on public.property_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_property_role(property_id, array['owner', 'admin'])
    or exists (
      select 1 from public.properties as property
      where property.id = property_id
        and public.has_organization_role(property.organization_id, array['owner', 'admin'])
    )
  );

create policy "property_members_insert_admin" on public.property_members
  for insert to authenticated
  with check (
    public.has_property_role(property_id, array['owner', 'admin'])
    or exists (
      select 1 from public.properties as property
      where property.id = property_id
        and public.has_organization_role(property.organization_id, array['owner', 'admin'])
    )
  );

create policy "property_members_delete_admin" on public.property_members
  for delete to authenticated
  using (
    user_id <> (select auth.uid())
    and (
      public.has_property_role(property_id, array['owner', 'admin'])
      or exists (
        select 1 from public.properties as property
        where property.id = property_id
          and public.has_organization_role(property.organization_id, array['owner', 'admin'])
      )
    )
  );

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  account_name text;
begin
  account_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));

  insert into public.profiles (user_id, full_name)
  values (new.id, account_name);

  insert into public.organizations (name)
  values (account_name || '''s home')
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

grant select, insert, update on public.profiles to authenticated;
grant select on public.organizations to authenticated;
grant select, insert, delete on public.organization_members to authenticated;
grant select, insert, update, delete on public.properties to authenticated;
grant select, insert, delete on public.property_members to authenticated;
revoke all on public.profiles, public.organizations, public.organization_members, public.properties, public.property_members from anon;
