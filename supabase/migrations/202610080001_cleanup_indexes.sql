-- Phase 4C: indexes for the cleanup job (backend/src/maintenance/cleanup.ts), which deletes
-- finished commands after 24 hours and events after 1 hour. Additive.
create index if not exists device_commands_completed_at_idx on public.device_commands (completed_at) where completed_at is not null;
create index if not exists realtime_events_created_at_idx on public.realtime_events (created_at);
