-- The boards' broker accounts move into the database (docs/audit/2026-11-security.md, B3).
--
-- Mosquitto's dynamic security plugin kept every account and role in one JSON file and rewrote
-- all of it on each change: one pairing took 0.2 s with 1 000 boards and 2 s with 5 000, and the
-- broker's CPU was full. Now the broker asks PostgreSQL (the mosquitto-go-auth plugin) through two
-- functions, and a pairing is one row, whatever the number of boards.
--
-- - broker.board_accounts: one row per paired board (its broker secret's PBKDF2 hash). It belongs
--   to the board: removing the board, its home or its owner removes the account too, so nothing is
--   left behind (docs/audit, "no stale data").
-- - broker.service_accounts: the API's own login (a superuser on the broker). backend/src/db/migrate.ts
--   writes it from MQTT_API_USERNAME/MQTT_API_PASSWORD, and the API again when it starts.
-- - m2_broker, the broker's database login, may only call broker.account_password() and
--   broker.board_topics(); it reads no table.

create schema if not exists broker;

create table if not exists broker.board_accounts (
  board_id uuid primary key references public.controllers (id) on delete cascade,
  password_hash text not null check (password_hash ~ '^PBKDF2\$sha256\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
  updated_at timestamptz not null default now()
);

create table if not exists broker.service_accounts (
  username text primary key check (char_length(username) between 1 and 64),
  password_hash text not null check (password_hash ~ '^PBKDF2\$sha256\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
  updated_at timestamptz not null default now()
);

alter table broker.board_accounts enable row level security;
alter table broker.service_accounts enable row level security;
revoke all on broker.board_accounts, broker.service_accounts from public, anon, authenticated;
grant select, insert, update, delete on broker.board_accounts, broker.service_accounts to service_role;
grant usage on schema broker to service_role;

/** The password hash for a login: a board (its id) or a service account. Nothing for anyone else. */
create or replace function broker.account_password(p_username text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select account.password_hash from broker.board_accounts as account
  where p_username ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and account.board_id = p_username::uuid
  union all
  select service.password_hash from broker.service_accounts as service where service.username = p_username
  limit 1;
$$;

/**
 * The topics a board may use (mosquitto-go-auth's ACL query; p_access is 1 read, 2 write,
 * 4 subscribe): it publishes its own ack, state, status and reset, and reads and subscribes to its
 * own cmd and update. Nothing once its account is gone, so a removed board can do nothing even
 * before its connection is cut.
 */
create or replace function broker.board_topics(p_username text, p_access integer)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select 'm2/v1/boards/' || p_username || '/' || topic.kind
  from (values ('ack', 2), ('state', 2), ('status', 2), ('reset', 2), ('cmd', 5), ('update', 5)) as topic (kind, access)
  where (topic.access & p_access) <> 0
    and exists (
      select 1 from broker.board_accounts as account
      where p_username ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and account.board_id = p_username::uuid
    );
$$;

/** Whether a login is a service account (a superuser on the broker: the API). */
create or replace function broker.is_service_account(p_username text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from broker.service_accounts where username = p_username;
$$;

revoke all on function broker.account_password(text), broker.board_topics(text, integer), broker.is_service_account(text) from public, anon, authenticated;
grant usage on schema broker to m2_broker;
grant execute on function broker.account_password(text), broker.board_topics(text, integer), broker.is_service_account(text) to m2_broker;
