/**
 * Running scenarios. A run turns each action into an ordinary device command (applied only when
 * the ESP32 reports), linked to the run.
 *
 * - startManualRun: a tap, inside the caller's transaction, as the user (RLS: any member).
 * - runDueScenarios / startScenarioRunner: the scheduler. Scenarios run on the server, for every
 *   home (there is no hub, and boards hold no schedules).
 *
 * Late runs: every scheduled scenario has a validity window (late_window_seconds). If this server
 * was down at the scheduled time, the occurrence still runs while the window lasts and is recorded
 * as missed after it. The run's commands stay valid until the end of the window (the database sets
 * their deadline), so a board that was offline gets them the moment it is back. If no board
 * carried out anything by then, the run becomes missed (commands/expiry.ts).
 *
 * No history: only the latest run of a scenario is kept. That one row is also what makes an
 * occurrence run at most once, even if the server restarts or several API processes check at once.
 */
import { SCENARIO_MIN_GRACE_SECONDS, type ScenarioRun } from "@m2smart/contracts";
import type { Pool } from "pg";
import { withSystemTx, type TxClient } from "../db/tx";

type RunRow = { id: string; trigger: "schedule" | "manual"; status: "started" | "missed"; scheduled_for: Date | null; created_at: Date };
export const RUN_COLUMNS = "id, trigger, status, scheduled_for, created_at";

export function toRun(row: RunRow): ScenarioRun {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    scheduledFor: row.scheduled_for ? row.scheduled_for.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Inserts the commands of a started run; returns their ids in action order. Actions on a device
 * whose board is not paired yet are skipped: there is no hardware to command. They share one
 * created_at, so their idempotency keys end in the zero-padded position: commands are sent to a
 * board in (created_at, idempotency_key) order.
 */
async function createRunCommands(tx: TxClient, propertyId: string, scenarioId: string, runId: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key, scenario_run_id)
     select action.property_id, action.device_id, action.capability, action.target_value, 'scenario-' || $3::text || '-' || lpad(action.position::text, 2, '0'), $3::uuid
     from public.scenario_actions as action
     join public.devices as device on device.id = action.device_id
     left join public.controllers as board on board.id = device.controller_id
     where action.scenario_id = $1 and action.property_id = $2
       and (device.controller_id is null or board.hardware_uid is not null)
     order by action.position
     returning id`,
    [scenarioId, propertyId, runId],
  );
  return rows.map((row) => row.id);
}

/** Starts a run now (a tap). The caller checks that the scenario exists and may be run. */
export async function startManualRun(tx: TxClient, propertyId: string, scenarioId: string): Promise<{ run: ScenarioRun; commandIds: string[] }> {
  const { rows } = await tx.query<RunRow>(
    `insert into public.scenario_runs (property_id, scenario_id, trigger) values ($1, $2, 'manual') returning ${RUN_COLUMNS}`,
    [propertyId, scenarioId],
  );
  const commandIds = await createRunCommands(tx, propertyId, scenarioId, rows[0].id);
  return { run: toRun(rows[0]), commandIds };
}

export type DueOutcome = { scenarioId: string; scheduledFor: Date; status: "started" | "missed"; commandIds: string[] };

/**
 * Runs (or records as missed) every scheduled occurrence that is due at `now` and was not handled
 * before. `propertyIds` limits it to those homes (tests); by default it covers every home.
 */
export async function runDueScenarios(pool: Pool, options: { now?: Date; propertyIds?: string[] } = {}): Promise<DueOutcome[]> {
  const now = options.now ?? new Date();
  return withSystemTx(pool, async (tx) => {
    const { rows: due } = await tx.query<{ scenario_id: string; property_id: string; scheduled_for: Date; late_window_seconds: number }>(
      `select due.scenario_id, due.property_id, due.scheduled_for, scenario.late_window_seconds
       from public.scenario_due_occurrences($1) as due
       join public.scenarios as scenario on scenario.id = due.scenario_id
       where ($2::uuid[] is null or due.property_id = any($2::uuid[]))
         and not exists (select 1 from public.scenario_runs as run where run.scenario_id = due.scenario_id and run.scheduled_for = due.scheduled_for)`,
      [now, options.propertyIds ?? null],
    );
    const outcomes: DueOutcome[] = [];
    for (const occurrence of due) {
      const late = (now.getTime() - occurrence.scheduled_for.getTime()) / 1000;
      // The scheduler itself is always a few seconds behind, so "never late" still allows a minute.
      const status = late > Math.max(occurrence.late_window_seconds, SCENARIO_MIN_GRACE_SECONDS) ? "missed" : "started";
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.scenario_runs (property_id, scenario_id, trigger, scheduled_for, status)
         values ($1, $2, 'schedule', $3, $4)
         on conflict (scenario_id, scheduled_for) do nothing
         returning id`,
        [occurrence.property_id, occurrence.scenario_id, occurrence.scheduled_for, status],
      );
      if (!rows.length) continue;
      // Only the latest run of a scenario is kept.
      await tx.query("delete from public.scenario_runs where scenario_id = $1 and id <> $2", [occurrence.scenario_id, rows[0].id]);
      const commandIds = status === "started" ? await createRunCommands(tx, occurrence.property_id, occurrence.scenario_id, rows[0].id) : [];
      outcomes.push({ scenarioId: occurrence.scenario_id, scheduledFor: occurrence.scheduled_for, status, commandIds });
    }
    return outcomes;
  });
}

type Log = { info: (object: object, message: string) => void; error: (object: object, message: string) => void };

/** Checks for due scenarios every `intervalMs` until stopped. Errors are logged, never thrown. */
export function startScenarioRunner(pool: Pool, log: Log, intervalMs = 5_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDueScenarios(pool)
      .then((outcomes) => {
        for (const outcome of outcomes) {
          log.info({ scenarioId: outcome.scenarioId, scheduledFor: outcome.scheduledFor.toISOString(), status: outcome.status, commands: outcome.commandIds.length }, "Scenario run");
        }
      })
      .catch((error: Error) => log.error({ err: { message: error.message } }, "Scenario check failed"))
      .finally(() => (running = false));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
