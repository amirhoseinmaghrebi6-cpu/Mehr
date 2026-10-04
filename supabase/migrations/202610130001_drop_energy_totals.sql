-- The product owner decided (2026-10-04) that the app shows no energy consumption at all, so the
-- daily totals introduced in 202610070001 are not kept: nothing that is never shown is stored.
-- Meters may still report their readings; like every state, only the last value exists.
drop table if exists public.device_energy_daily;
