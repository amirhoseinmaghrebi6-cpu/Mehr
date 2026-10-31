-- Pairing by setup code (docs/board-protocol.md, "Pairing"). The app now gives the code and the
-- board takes it, instead of the board making a code (shown as a QR code) for the user to upload:
-- - an owner or admin asks for a setup code for a board that waits in their home;
-- - the code reaches the board through its own setup page (a link from the app fills it in, or
--   it is typed);
-- - the board, proving itself with its factory secret, uses the code and joins that home.
--
-- A code lasts 10 minutes and works for one board. Only its SHA-256 is stored, and two waiting
-- codes are never the same (unique). The row goes with the board (cascade) and is deleted when it
-- expires (maintenance/cleanup.ts). The old pairing table is dropped: nothing in it outlives a day.

drop table if exists public.board_pairings;

create table if not exists public.board_setup_codes (
  -- The board that waits in a home for its real board.
  controller_id uuid primary key references public.controllers (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  -- The real board that used the code; it may ask again (its answer was lost) until the code
  -- expires, and gets a fresh broker secret.
  hardware_uid text references public.manufactured_boards (hardware_uid) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists board_setup_codes_expires_at_idx on public.board_setup_codes (expires_at);

alter table public.board_setup_codes enable row level security;
revoke all on public.board_setup_codes from public, anon, authenticated;
grant select, insert, update, delete on public.board_setup_codes to service_role;

-- The operator's account deletion no longer touches the dropped table; setup codes go with the
-- boards (cascade).
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

  delete from public.properties where id = any (homes);
  delete from public.organizations
  where id in (select organization_id from public.organization_members where user_id = p_user_id and role = 'owner');
  delete from auth.users where id = p_user_id;
end;
$$;
revoke all on function public.platform_delete_user(uuid) from public, anon, authenticated;
grant execute on function public.platform_delete_user(uuid) to service_role;
