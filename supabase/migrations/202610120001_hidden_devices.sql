-- A board has 1 to 20 inputs and outputs; the ones that are not wired to anything can be hidden,
-- so they do not clutter the home. A hidden device still exists and can be shown again. Additive.
alter table public.devices add column if not exists hidden boolean not null default false;
-- Owners and admins (the existing update policy) may hide and show devices.
grant update (hidden) on public.devices to authenticated;
