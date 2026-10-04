-- Phase 4E: pairing. Once an owner or admin has uploaded a board's pairing code, the pending
-- pairing points at the board it became in that home; the board then fetches its broker secret
-- with the same code. The row still expires after 24 hours and goes with the board. Additive.
alter table public.board_pairings add column if not exists controller_id uuid references public.controllers (id) on delete cascade;
