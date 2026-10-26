-- Phase 5A: home members. Owners and admins invite people by mobile number; the invited person
-- sees the invitation after signing in and accepts or declines it. Additive.
--
-- Who may do what (same rules as canManageRole in packages/contracts/src/permissions.ts):
-- - an owner invites, re-roles and removes admins and members;
-- - an admin invites and removes members only;
-- - anyone but an owner may leave a home.
-- An invitation has no expiry: it stays until it is accepted, declined or cancelled, and is
-- deleted then. Nothing is kept about past invitations.

create table if not exists public.property_invitations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  -- E.164, as Kratos stores it (auth.users.phone).
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role text not null check (role in ('admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (property_id, phone)
);
create index if not exists property_invitations_phone_idx on public.property_invitations (phone);

-- The signed-in user's own phone number (auth.users is not readable by users).
create or replace function public.current_user_phone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select phone from auth.users where id = (select auth.uid());
$$;
revoke all on function public.current_user_phone() from public, anon;
grant execute on function public.current_user_phone() to authenticated, service_role;

alter table public.property_invitations enable row level security;

create policy "property_invitations_select" on public.property_invitations
  for select to authenticated
  using (public.has_property_role(property_id, array['owner', 'admin']) or phone = public.current_user_phone());

create policy "property_invitations_insert" on public.property_invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and (public.has_property_role(property_id, array['owner']) or (role = 'member' and public.has_property_role(property_id, array['admin'])))
  );

-- The home's managers cancel it; the invited person declines it.
create policy "property_invitations_delete" on public.property_invitations
  for delete to authenticated
  using (
    public.has_property_role(property_id, array['owner'])
    or (role = 'member' and public.has_property_role(property_id, array['admin']))
    or phone = public.current_user_phone()
  );

revoke all on public.property_invitations from anon, authenticated;
grant select, delete on public.property_invitations to authenticated;
grant insert (property_id, phone, role, invited_by) on public.property_invitations to authenticated;

-- Members: owners change admins and members between the two roles; anyone but an owner may
-- leave. Removing someone else stays under the Phase 1 policy (owners and admins); the API also
-- keeps an admin to members only.
create policy "property_members_update_owner" on public.property_members
  for update to authenticated
  using (public.has_property_role(property_id, array['owner']) and user_id <> (select auth.uid()) and role in ('admin', 'member'))
  with check (role in ('admin', 'member'));
grant update (role) on public.property_members to authenticated;

create policy "property_members_delete_self" on public.property_members
  for delete to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner');

-- The members of a home with their names and numbers. Owners and admins see everyone; a member
-- sees only themself. Not a member: nothing.
create or replace function public.property_member_list(p_property_id uuid)
returns table (user_id uuid, full_name text, phone text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.user_id, coalesce(profile.full_name, ''), account.phone, membership.role, membership.created_at
  from public.property_members as membership
  join auth.users as account on account.id = membership.user_id
  left join public.profiles as profile on profile.user_id = membership.user_id
  where membership.property_id = p_property_id
    and (
      public.has_property_role(p_property_id, array['owner', 'admin'])
      or membership.user_id = (select auth.uid())
    )
  order by case membership.role when 'owner' then 0 when 'admin' then 1 else 2 end, membership.created_at;
$$;
revoke all on function public.property_member_list(uuid) from public, anon;
grant execute on function public.property_member_list(uuid) to authenticated;

-- Invitations to the signed-in user, with the home's name and who invited them (neither is
-- otherwise visible to someone who is not a member yet).
create or replace function public.my_property_invitations()
returns table (id uuid, property_name text, invited_by_name text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select invitation.id, property.name, coalesce(nullif(profile.full_name, ''), ''), invitation.role, invitation.created_at
  from public.property_invitations as invitation
  join public.properties as property on property.id = invitation.property_id
  left join public.profiles as profile on profile.user_id = invitation.invited_by
  where invitation.phone = public.current_user_phone()
  order by invitation.created_at;
$$;
revoke all on function public.my_property_invitations() from public, anon;
grant execute on function public.my_property_invitations() to authenticated;

-- Accepting: the caller's number must be the invited one. Joins the home with the invited role
-- and deletes the invitation. Returns the home's id, or null if there is no such invitation.
create or replace function public.accept_property_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_role text;
begin
  delete from public.property_invitations
  where id = p_invitation_id and phone = public.current_user_phone()
  returning property_id, role into v_property_id, v_role;
  if v_property_id is null then
    return null;
  end if;
  insert into public.property_members (property_id, user_id, role)
  values (v_property_id, (select auth.uid()), v_role)
  on conflict (property_id, user_id) do nothing;
  return v_property_id;
end;
$$;
revoke all on function public.accept_property_invitation(uuid) from public, anon;
grant execute on function public.accept_property_invitation(uuid) to authenticated;
