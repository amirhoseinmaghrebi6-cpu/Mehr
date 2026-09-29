-- M2smart platform bootstrap for self-hosted PostgreSQL.
--
-- Provides the platform pieces that supabase/migrations/*.sql expect (the anon/authenticated/
-- service_role roles, the auth schema, auth.users, auth.uid(), Supabase-equivalent grants),
-- plus M2smart's own login roles and migration bookkeeping.
--
-- Run as a superuser before the app migrations; backend/src/db/migrate.ts does this on every
-- run. Idempotent: every object is guarded, so objects Supabase already provides are left alone.
-- This is platform setup, not an app migration, and is not recorded in schema_migrations.
--
-- Optional login passwords are passed in by the runner as the session settings
-- m2.api_password and m2.migrator_password; when unset, the role has no password.

-- Request roles, as on Supabase. NOINHERIT: a session gets their rights only via SET ROLE.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  -- Backend-only role; bypasses RLS exactly like Supabase's service_role.
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;

  -- Owns every app object; runs the migrations.
  if not exists (select from pg_roles where rolname = 'm2_migrator') then
    create role m2_migrator login nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;

  -- The API's only database login. NOINHERIT and no BYPASSRLS: it has no table rights of its
  -- own and must SET ROLE authenticated (RLS applies) or service_role (explicit system work).
  if not exists (select from pg_roles where rolname = 'm2_api') then
    create role m2_api login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end;
$$;

grant authenticated, service_role to m2_api;

do $$
declare
  api_password text := nullif(current_setting('m2.api_password', true), '');
  migrator_password text := nullif(current_setting('m2.migrator_password', true), '');
begin
  if api_password is not null then
    execute format('alter role m2_api password %L', api_password);
  end if;
  if migrator_password is not null then
    execute format('alter role m2_migrator password %L', migrator_password);
  end if;
end;
$$;

-- m2_migrator creates tables in public and the supabase_realtime publication.
grant create on schema public to m2_migrator;
do $$
begin
  execute format('grant create on database %I to m2_migrator', current_database());
end;
$$;

-- Auth schema and the subset of Supabase's auth.users the app relies on (same column names).
create schema if not exists auth authorization m2_migrator;

do $$
begin
  if to_regclass('auth.users') is null then
    create table auth.users (
      id uuid primary key,
      email text unique,
      phone text unique,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table auth.users owner to m2_migrator;
  end if;

  -- Same claim settings Supabase's auth.uid() reads.
  if to_regprocedure('auth.uid()') is null then
    create function auth.uid() returns uuid
    language sql
    stable
    as $fn$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
    $fn$;
    alter function auth.uid() owner to m2_migrator;
  end if;
end;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- The API mirrors Kratos identities into auth.users (withSystemTx): read, create, update only.
-- No DELETE: removing a user is a separate, deliberate operation.
grant select, insert, update on auth.users to service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase default privileges: new public objects are fully granted to the request roles.
-- The migrations then revoke and re-grant the minimum each role needs.
alter default privileges for role m2_migrator in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role m2_migrator in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role m2_migrator in schema public grant all on functions to anon, authenticated, service_role;

-- Migration bookkeeping.
create schema if not exists m2_platform authorization m2_migrator;
create table if not exists m2_platform.schema_migrations (
  filename text primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
alter table m2_platform.schema_migrations owner to m2_migrator;
revoke all on schema m2_platform from public;
