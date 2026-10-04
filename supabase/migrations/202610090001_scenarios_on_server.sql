-- Phase 4D: scenarios run on the server, and a scheduled scenario may still run late while it is
-- valid (scenarios.late_window_seconds: the power or internet was out at its time). Additive.
--
-- A scheduled run's commands stay valid until the end of that window, so a board that was offline
-- at the scheduled time gets them the moment it is back, and never after the window. Commands
-- sent by hand keep their short deadline (30 s for the network + the hardware's own time).
create or replace function public.set_command_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timeout interval := make_interval(secs => coalesce(public.command_timeout_seconds(new.device_id), 30));
  v_window_end timestamptz;
begin
  new.expires_at := now() + v_timeout;
  if new.scenario_run_id is not null then
    select run.scheduled_for + make_interval(secs => scenario.late_window_seconds) + v_timeout into v_window_end
    from public.scenario_runs as run
    join public.scenarios as scenario on scenario.id = run.scenario_id
    where run.id = new.scenario_run_id and run.scheduled_for is not null;
    if v_window_end > new.expires_at then
      new.expires_at := v_window_end;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.set_command_expiry() from public, anon, authenticated;
