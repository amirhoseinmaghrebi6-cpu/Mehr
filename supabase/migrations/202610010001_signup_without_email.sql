-- Sign-up without an email address (phone-only users, e.g. SMS-code login).
--
-- handle_new_auth_user() from 202609260001 named the account after the email's local part.
-- With no email that name was null and the insert into organizations.name (not null) failed,
-- so the whole sign-up was rejected. The name now falls back to the phone number, then to a
-- neutral default. Only the function body changes; the on_auth_user_created trigger is kept.

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
  account_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    nullif(trim(new.phone), ''),
    'M2smart user'
  );

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
