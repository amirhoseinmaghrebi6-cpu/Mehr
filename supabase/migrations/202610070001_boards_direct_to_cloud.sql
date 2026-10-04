-- Phase 4A: boards connect straight to the cloud (no hub). Additive; earlier migrations are
-- unchanged. See docs/plans/phase-4.md and docs/board-protocol.md.
--
-- The server keeps only the current state, never history, so nothing here grows with time:
-- - manufactured_boards: one fixed row per board ever made (not user data);
-- - board_pairings: at most one row per board, deleted when used or after 24 hours;
-- - device_energy_daily: one row per metered device per day, deleted after a year.
--
-- The existing hubs table stays: each home keeps one internal row that stands for its cloud
-- connection, so no existing table or foreign key changes.

-- The registry of manufactured boards: how the server knows a board is genuine. Written at
-- production (and by the dev tools); backend only.
create table if not exists public.manufactured_boards (
  -- The board's factory identity; the same value as controllers.hardware_uid once it is in a home.
  hardware_uid text primary key check (hardware_uid ~ '^[A-Za-z0-9:_-]{4,64}$'),
  model_id uuid not null references public.hardware_models (id) on delete restrict,
  -- SHA-256 (hex) of the board's random factory secret; the secret itself is only on the board.
  factory_secret_hash text not null check (factory_secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists manufactured_boards_model_id_idx on public.manufactured_boards (model_id);

-- A board in pairing mode that is online and waiting for an owner or admin to upload its pairing
-- code. One row per board: entering pairing mode again replaces the code.
create table if not exists public.board_pairings (
  hardware_uid text primary key references public.manufactured_boards (hardware_uid) on delete cascade,
  -- SHA-256 (hex) of the one-time pairing code the board shows as a QR code.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);
create index if not exists board_pairings_expires_at_idx on public.board_pairings (expires_at);

-- How late a scheduled scenario may still run (power or internet was out at its time): never,
-- 10 minutes, 1 hour or 3 hours. After that the occurrence is missed.
alter table public.scenarios add column if not exists late_window_seconds integer not null default 600
  check (late_window_seconds in (0, 600, 3600, 10800));
grant insert (late_window_seconds), update (late_window_seconds) on public.scenarios to authenticated;

-- Energy used per metered device per day (the day of the home's time zone). The only history the
-- server keeps, for at most one year; only the backend writes it.
create table if not exists public.device_energy_daily (
  device_id uuid not null,
  property_id uuid not null,
  day date not null,
  energy_kwh numeric(12, 3) not null check (energy_kwh >= 0),
  -- The meter's reading at the last report of that day, to add the next report's difference.
  last_reading_kwh numeric(14, 3) not null check (last_reading_kwh >= 0),
  primary key (device_id, day),
  foreign key (device_id, property_id) references public.devices (id, property_id) on delete cascade
);
create index if not exists device_energy_daily_day_idx on public.device_energy_daily (day);

alter table public.manufactured_boards enable row level security;
alter table public.board_pairings enable row level security;
alter table public.device_energy_daily enable row level security;

create policy "device_energy_daily_select_members" on public.device_energy_daily for select to authenticated
  using (public.is_property_member(property_id));

-- No policies on the registry and the pairings: users never read or write them.
revoke all on public.manufactured_boards, public.board_pairings, public.device_energy_daily from anon, authenticated;
grant select on public.device_energy_daily to authenticated;
