-- Firmware updates over the air (docs/board-protocol.md, "Firmware updates"). The operator uploads
-- an image for a board model in the admin panel and makes it active; the server offers it to every
-- board of that model whose reported version differs, now and whenever one comes online.
--
-- The image itself is kept here (at most one firmware slot, 1.6 MB), so backups carry it and the
-- server needs no other storage. The version and model are read from the image when it is uploaded.
-- Backend-only, like the board registry. Additive.

create table if not exists public.firmware_releases (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.hardware_models (id) on delete cascade,
  version text not null check (version ~ '^[0-9A-Za-z.+_-]{1,31}$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes between 1 and 1638400),
  image bytea not null,
  notes text not null default '' check (char_length(notes) <= 500),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (model_id, version)
);
-- One active version per model at most.
create unique index if not exists firmware_releases_one_active_idx on public.firmware_releases (model_id) where active;

alter table public.firmware_releases enable row level security;
revoke all on public.firmware_releases from public, anon, authenticated;
grant select, insert, update, delete on public.firmware_releases to service_role;
