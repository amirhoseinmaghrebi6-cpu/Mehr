-- Kratos database and role in the dev PostgreSQL cluster (Phase 2D-3).
--
-- Kratos keeps its identities, sessions and flows in its own database and runs its own
-- migrations (`kratos migrate sql`). It never touches the app database, and the app never
-- touches this one. Runs as the superuser from the kratos-db-init compose service; idempotent.
--
-- Not part of bootstrap.sql: CREATE DATABASE cannot run inside a transaction, and Kratos needs
-- its database at `pnpm infra:up`, before `pnpm db:migrate` runs.
--
-- Usage: psql -v kratos_password=... -f kratos-db.sql

\set ON_ERROR_STOP on

select format('create role kratos login nosuperuser nocreatedb nocreaterole nobypassrls')
where not exists (select from pg_roles where rolname = 'kratos')
\gexec

alter role kratos password :'kratos_password';

select format('create database kratos owner kratos')
where not exists (select from pg_database where datname = 'kratos')
\gexec

-- Only the kratos role may connect to its database.
revoke all on database kratos from public;
