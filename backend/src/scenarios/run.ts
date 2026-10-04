/**
 * Running scenarios. A run turns each action into an ordinary device command (with its deadline,
 * applied only when the ESP32 reports), linked to the run so device history shows where it came
 * from.
 *
 * - startRun: one run, inside the caller's transaction. A tap runs as the user (RLS: any member of
 *   the home); a scheduled run runs as the hub (system).
 * - runDueScenarios: the scheduler. Until step 4D makes it a server job for every home, the dev
 *   board simulator calls it for homes with simulated boards. Each occurrence
 *   runs at most once (unique per scenario and occurrence, so a restart never runs it twice); a
 *   periodic one more than 2 minutes late is skipped and recorded as missed, a one-time one gets
 *   10 minutes.
 */
import { scenarioGraceSeconds, type ScenarioRun } from "@m2smart/contracts";
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
 * Inserts the commands of a started run; returns their ids in action order. They share one
 * created_at, so their idempotency keys end in the zero-padded position: the hub carries out a
 * device's commands in (created_at, idempotency_key) order.
 */
async function createRunCommands(tx: TxClient, propertyId: string, scenarioId: string, runId: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key, scenario_run_id)
     select action.property_id, action.device_id, action.capability, action.target_value, 'scenario-' || $3::text || '-' || lpad(action.position::text, 2, '0'), $3::uuid
     from public.scenario_actions as action
     where action.scenario_id = $1 and action.property_id = $2
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
 * Runs (or records as missed) every scheduled occurrence that is due at `now`, for homes with at
 * least one board whose hardware id starts with `boardPrefix` (the homes this runner stands in
 * for). Returns what it did; occurrences handled before are skipped.
 */
export async function runDueScenarios(pool: Pool, options: { now?: Date; boardPrefix: string }): Promise<DueOutcome[]> {
  const now = options.now ?? new Date();
  return withSystemTx(pool, async (tx) => {
    const { rows: due } = await tx.query<{ scenario_id: string; property_id: string; kind: "periodic" | "one_time"; scheduled_for: Date }>(
      `select due.scenario_id, due.property_id, due.kind, due.scheduled_for
       from public.scenario_due_occurrences($1) as due
       where exists (select 1 from public.controllers as board where board.property_id = due.property_id and starts_with(board.hardware_uid, $2))
         and not exists (select 1 from public.scenario_runs as run where run.scenario_id = due.scenario_id and run.scheduled_for = due.scheduled_for)`,
      [now, options.boardPrefix],
    );
    const outcomes: DueOutcome[] = [];
    for (const occurrence of due) {
      const late = (now.getTime() - occurrence.scheduled_for.getTime()) / 1000;
      const status = late > scenarioGraceSeconds[occurrence.kind] ? "missed" : "started";
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.scenario_runs (property_id, scenario_id, trigger, scheduled_for, status)
         values ($1, $2, 'schedule', $3, $4)
         on conflict (scenario_id, scheduled_for) do nothing
         returning id`,
        [occurrence.property_id, occurrence.scenario_id, occurrence.scheduled_for, status],
      );
      if (!rows.length) continue;
      const commandIds = status === "started" ? await createRunCommands(tx, occurrence.property_id, occurrence.scenario_id, rows[0].id) : [];
      outcomes.push({ scenarioId: occurrence.scenario_id, scheduledFor: occurrence.scheduled_for, status, commandIds });
    }
    return outcomes;
  });
}
