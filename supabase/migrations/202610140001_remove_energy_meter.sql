-- The product shows no energy consumption (decided 2026-10-04), so the "energy meter" device type
-- leaves the catalog. Nothing uses it: the delete fails, by its foreign keys, if a board model or a
-- device ever did.
delete from public.device_types where type = 'energy_meter';
