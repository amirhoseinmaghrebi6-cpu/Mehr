-- Phase 5D: a home's activity, from what the database keeps anyway. Commands are deleted 24 hours
-- after they finish (maintenance/cleanup.ts), so this shows at most the last day and stores
-- nothing new. For each command: the device, what was asked, how it ended, and who asked (a
-- member's name) or which scenario ran it. Any member of the home may read it; others get nothing.
-- Additive.

create or replace function public.property_activity(p_property_id uuid)
returns table (
  id uuid,
  device_id uuid,
  device_name text,
  capability text,
  target_value jsonb,
  status text,
  created_at timestamptz,
  completed_at timestamptz,
  requested_by_name text,
  scenario_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select command.id, command.device_id, device.name, command.capability, command.target_value, command.status,
    command.created_at, command.completed_at,
    case when command.requested_by is null then null else coalesce(nullif(profile.full_name, ''), '') end,
    scenario.name
  from public.device_commands as command
  join public.devices as device on device.id = command.device_id
  left join public.profiles as profile on profile.user_id = command.requested_by
  left join public.scenario_runs as run on run.id = command.scenario_run_id
  left join public.scenarios as scenario on scenario.id = run.scenario_id
  where command.property_id = p_property_id
    and public.is_property_member(p_property_id)
    and command.created_at > now() - interval '24 hours'
  order by command.created_at desc
  limit 100;
$$;
revoke all on function public.property_activity(uuid) from public, anon;
grant execute on function public.property_activity(uuid) to authenticated;
