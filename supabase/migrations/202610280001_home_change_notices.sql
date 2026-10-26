-- Phase 5C: live updates. Any change to what a home's pages show (a device, its reported state, its
-- board going online or offline, a command's progress) sends a notice on channel 'home_changes'
-- with the home's id. The API listens and tells that home's open pages to refresh
-- (backend/src/realtime/home-events.ts). The notice carries no data: pages re-read through the
-- API, which applies the usual access rules. Additive.

create or replace function public.notify_home_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_notify('home_changes', coalesce(new.property_id, old.property_id)::text);
  return null;
end;
$$;
revoke all on function public.notify_home_change() from public, anon, authenticated;

drop trigger if exists devices_notify_change on public.devices;
create trigger devices_notify_change after insert or update or delete on public.devices
  for each row execute function public.notify_home_change();

drop trigger if exists device_states_notify_change on public.device_states;
create trigger device_states_notify_change after insert or update on public.device_states
  for each row execute function public.notify_home_change();

drop trigger if exists controllers_notify_change on public.controllers;
create trigger controllers_notify_change after update of online on public.controllers
  for each row when (old.online is distinct from new.online) execute function public.notify_home_change();

drop trigger if exists device_commands_notify_change on public.device_commands;
create trigger device_commands_notify_change after update of status on public.device_commands
  for each row when (old.status is distinct from new.status) execute function public.notify_home_change();
