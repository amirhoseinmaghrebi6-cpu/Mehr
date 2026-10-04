/**
 * Scenarios of a home:
 *   GET    /v1/properties/:propertyId/scenarios
 *   POST   /v1/properties/:propertyId/scenarios                       (owner, admin)
 *   PUT    /v1/properties/:propertyId/scenarios/:scenarioId           (owner, admin; the whole scenario)
 *   PATCH  /v1/properties/:propertyId/scenarios/:scenarioId           (owner, admin; on/off)
 *   DELETE /v1/properties/:propertyId/scenarios/:scenarioId           (owner, admin)
 *   POST   /v1/properties/:propertyId/scenarios/:scenarioId/run       (any member; themed only)
 *
 * Times and dates are in the home's time zone. Every action must be a writable capability of a
 * board device of the same home, with a value that fits it (checked here, and again by the
 * database). Scheduled runs happen on the hub (scenarios/run.ts).
 *
 * Access rules and error handling: see route-helpers.ts.
 */
import {
  capabilityValueError,
  scenarioRequest,
  updateScenarioRequest,
  type CapabilityName,
  type CapabilityValue,
  type Scenario,
  type ScenarioKind,
  type ScenarioListResponse,
  type ScenarioRunResponse,
  type Weekday,
} from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { z } from "zod";
import type { SessionVerifier } from "../auth/session-verifier";
import type { TxClient } from "../db/tx";
import { RUN_COLUMNS, startManualRun, toRun } from "../scenarios/run";
import { definitionFromRow } from "./devices";
import { createHandler, HttpError, invalidRequest, notFound, parse, requireAction, requireUuid } from "./route-helpers";

type ScenarioRow = {
  id: string;
  name: string;
  kind: ScenarioKind;
  enabled: boolean;
  weekdays: number[] | null;
  local_time: string | null;
  local_date: string | null;
  next_run_at: Date | null;
  actions: Array<{ deviceId: string; capability: CapabilityName; targetValue: CapabilityValue }>;
  last_run: { id: string; trigger: "schedule" | "manual"; status: "started" | "missed"; scheduled_for: string | null; created_at: string } | null;
};

const SCENARIO_SELECT = `
  select scenario.id, scenario.name, scenario.kind, scenario.enabled, scenario.weekdays,
    to_char(scenario.local_time, 'HH24:MI') as local_time, to_char(scenario.local_date, 'YYYY-MM-DD') as local_date,
    public.scenario_next_occurrence(scenario.id, now()) as next_run_at,
    coalesce((
      select json_agg(json_build_object('deviceId', action.device_id, 'capability', action.capability, 'targetValue', action.target_value) order by action.position)
      from public.scenario_actions as action where action.scenario_id = scenario.id
    ), '[]') as actions,
    (select row_to_json(run) from (
      select ${RUN_COLUMNS} from public.scenario_runs where scenario_id = scenario.id order by created_at desc limit 1
    ) as run) as last_run
  from public.scenarios as scenario
  where scenario.property_id = $1`;

function toScenario(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled,
    weekdays: row.weekdays ? ([...row.weekdays].sort((a, b) => a - b) as Weekday[]) : null,
    time: row.local_time,
    date: row.local_date,
    actions: row.actions,
    nextRunAt: row.next_run_at ? row.next_run_at.toISOString() : null,
    lastRun: row.last_run
      ? toRun({ ...row.last_run, scheduled_for: row.last_run.scheduled_for ? new Date(row.last_run.scheduled_for) : null, created_at: new Date(row.last_run.created_at) })
      : null,
  };
}

async function loadScenario(tx: TxClient, propertyId: string, scenarioId: string): Promise<Scenario> {
  const { rows } = await tx.query<ScenarioRow>(`${SCENARIO_SELECT} and scenario.id = $2`, [propertyId, scenarioId]);
  if (!rows.length) throw notFound();
  return toScenario(rows[0]);
}

type ScenarioBody = z.output<typeof scenarioRequest>;

/** Every action must target a writable capability of a board device of this home, with a fitting value. */
async function checkActions(tx: TxClient, propertyId: string, actions: ScenarioBody["actions"]): Promise<void> {
  const { rows } = await tx.query<{ device_id: string; capability: string; value_type: "boolean" | "integer" | "number" | "enum"; min_value: string | null; max_value: string | null; enum_values: string[] | null; writable: boolean }>(
    `select capability.device_id, capability.capability, capability.value_type, capability.min_value, capability.max_value, capability.enum_values, capability.writable
     from public.device_capabilities as capability
     join public.devices as device on device.id = capability.device_id
     where device.property_id = $1 and device.device_type is not null and device.id = any($2::uuid[])`,
    [propertyId, actions.map((action) => action.deviceId)],
  );
  for (const action of actions) {
    const devices = rows.filter((row) => row.device_id === action.deviceId);
    // A device of another home is simply not found.
    if (!devices.length) throw notFound();
    const capability = devices.find((row) => row.capability === action.capability);
    if (!capability) throw invalidRequest();
    const definition = definitionFromRow(capability);
    if (!definition.writable || capabilityValueError(definition, action.targetValue) !== null) throw invalidRequest();
  }
}

/** Replaces the actions of a scenario with `actions`, in order. */
async function storeActions(tx: TxClient, propertyId: string, scenarioId: string, actions: ScenarioBody["actions"]): Promise<void> {
  await tx.query("delete from public.scenario_actions where scenario_id = $1 and property_id = $2", [scenarioId, propertyId]);
  await tx.query(
    `insert into public.scenario_actions (scenario_id, property_id, position, device_id, capability, target_value)
     select $1, $2, entry.position - 1, (entry.action ->> 'deviceId')::uuid, entry.action ->> 'capability', entry.action -> 'targetValue'
     from jsonb_array_elements($3::jsonb) with ordinality as entry (action, position)`,
    [scenarioId, propertyId, JSON.stringify(actions)],
  );
}

/** The schedule columns of a request: weekdays, time and date by kind. */
function schedule(body: ScenarioBody): [weekdays: number[] | null, time: string | null, date: string | null] {
  if (body.kind === "periodic") return [body.weekdays, body.time, null];
  if (body.kind === "one_time") return [null, body.time, body.date];
  return [null, null, null];
}

export function registerScenarioRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  const handle = createHandler(pool, verifier);
  type Params = { propertyId: string; scenarioId: string };

  app.get<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/scenarios", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<ScenarioListResponse> => {
      await requireAction(tx, request.params.propertyId, "property.view");
      const { rows } = await tx.query<ScenarioRow>(`${SCENARIO_SELECT} order by scenario.created_at, scenario.id`, [request.params.propertyId]);
      return { scenarios: rows.map(toScenario) };
    }),
  );

  app.post<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/scenarios", (request, reply) =>
    handle(request, reply, 201, async (tx): Promise<Scenario> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "scenario.edit");
      const body = parse(scenarioRequest, request.body);
      await checkActions(tx, propertyId, body.actions);
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.scenarios (property_id, name, kind, enabled, weekdays, local_time, local_date)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [propertyId, body.name, body.kind, body.enabled, ...schedule(body)],
      );
      await storeActions(tx, propertyId, rows[0].id, body.actions);
      return loadScenario(tx, propertyId, rows[0].id);
    }),
  );

  app.put<{ Params: Params }>("/v1/properties/:propertyId/scenarios/:scenarioId", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<Scenario> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "scenario.edit");
      const scenarioId = requireUuid(request.params.scenarioId);
      const body = parse(scenarioRequest, request.body);
      await checkActions(tx, propertyId, body.actions);
      const { rowCount } = await tx.query(
        `update public.scenarios set name = $3, kind = $4, enabled = $5, weekdays = $6, local_time = $7, local_date = $8
         where id = $2 and property_id = $1`,
        [propertyId, scenarioId, body.name, body.kind, body.enabled, ...schedule(body)],
      );
      if (!rowCount) throw notFound();
      await storeActions(tx, propertyId, scenarioId, body.actions);
      return loadScenario(tx, propertyId, scenarioId);
    }),
  );

  app.patch<{ Params: Params }>("/v1/properties/:propertyId/scenarios/:scenarioId", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<Scenario> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "scenario.edit");
      const scenarioId = requireUuid(request.params.scenarioId);
      const body = parse(updateScenarioRequest, request.body);
      const { rowCount } = await tx.query("update public.scenarios set enabled = $3 where id = $2 and property_id = $1", [propertyId, scenarioId, body.enabled]);
      if (!rowCount) throw notFound();
      return loadScenario(tx, propertyId, scenarioId);
    }),
  );

  app.delete<{ Params: Params }>("/v1/properties/:propertyId/scenarios/:scenarioId", (request, reply) =>
    handle(request, reply, 204, async (tx) => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "scenario.edit");
      const { rowCount } = await tx.query("delete from public.scenarios where id = $2 and property_id = $1", [propertyId, requireUuid(request.params.scenarioId)]);
      if (!rowCount) throw notFound();
      return null;
    }),
  );

  app.post<{ Params: Params }>("/v1/properties/:propertyId/scenarios/:scenarioId/run", (request, reply) =>
    handle(request, reply, 201, async (tx): Promise<ScenarioRunResponse> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "scenario.run");
      const scenarioId = requireUuid(request.params.scenarioId);
      const { rows } = await tx.query<{ kind: ScenarioKind }>("select kind from public.scenarios where id = $1 and property_id = $2", [scenarioId, propertyId]);
      if (!rows.length) throw notFound();
      // Scheduled scenarios run at their time, on the hub.
      if (rows[0].kind !== "themed") throw new HttpError(409, "conflict");
      return startManualRun(tx, propertyId, scenarioId);
    }),
  );
}
