-- A door opener: a push button, not a switch. One press sends "open"; the board pulses the door
-- strike's relay and reports success once the door is released. It has no lasting state, so there
-- is nothing to switch back. Additive. Keep in sync with packages/contracts/src/catalog.ts.
insert into public.device_types (type, action_seconds) values ('door_opener', 5)
on conflict (type) do nothing;
