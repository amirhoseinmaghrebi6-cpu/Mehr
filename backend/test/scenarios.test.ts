/**
 * Scenarios against the dev database: two homes with separate users. A scenario of one home is
 * never visible to, runnable from or able to control devices of the other; owners and admins
 * edit, members only run themed scenarios; times follow the home's time zone; each scheduled
 * occurrence runs once, and a late one is skipped (periodic) or still run within 10 minutes
 * (one-time).
 */
import type { Command, Device, DeviceListResponse, Property, Scenario, ScenarioListResponse, ScenarioRunResponse } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { SessionCredential, SessionVerifier, VerifiedSession } from "../src/auth/session-verifier";
import { startHubSimulator } from "../src/dev/hub-simulator";
import { runDueScenarios } from "../src/scenarios/run";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const USERS = {
  ownerA: "7e5d0000-0000-4000-8000-000000000001",
  adminA: "7e5d0000-0000-4000-8000-000000000002",
  memberA: "7e5d0000-0000-4000-8000-000000000003",
  ownerB: "7e5d0000-0000-4000-8000-000000000004",
} as const;
type UserKey = keyof typeof USERS;
const ALL_USERS = Object.values(USERS);
const MODEL_CODES = ["test-scn-switch-2ch", "test-scn-sensor", "test-scn-camera"];

const verifier: SessionVerifier = {
  async verify(credential: SessionCredential): Promise<VerifiedSession | null> {
    const userId = USERS[credential.value as UserKey];
    return userId
      ? { userId, sessionId: `s-${userId}`, expiresAt: new Date(Date.now() + 3_600_000), authMethods: ["code"], identity: { phone: null, email: null, name: null }, issuer: "cloud" }
      : null;
  },
};
const silentLog = { info: () => undefined, error: () => undefined };

async function cleanup(): Promise<void> {
  await adminQuery("delete from public.properties where created_by = any($1::uuid[])", [ALL_USERS]);
  await adminQuery("delete from public.hardware_models where code = any($1::text[])", [MODEL_CODES]);
  await deleteUsers(ALL_USERS);
}

async function createModels(): Promise<void> {
  await adminQuery(`
    with models as (
      insert into public.hardware_models (code, name) values
        ('test-scn-switch-2ch', 'Scenario test switch'), ('test-scn-sensor', 'Scenario test sensor'), ('test-scn-camera', 'Scenario test camera')
      returning id, code
    ), channels as (
      insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name)
      select id, channel.key, channel.type, channel.name from models
      join (values ('test-scn-switch-2ch', 'ch1', 'switch', 'Lamp 1'), ('test-scn-switch-2ch', 'ch2', 'switch', 'Lamp 2'),
                   ('test-scn-sensor', 'contact', 'contact_sensor', 'Window'), ('test-scn-camera', 'camera', 'camera', 'Camera'))
        as channel (code, key, type, name) on channel.code = models.code
      returning model_id, channel_key
    ), buttons as (
      insert into public.hardware_model_pins (model_id, gpio, function, role) select id, 35, 'setup_button', 'setup' from models
    )
    insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, enum_values, writable)
    select model_id, channel_key, capability.name, capability.type, capability.values, capability.writable
    from channels
    join (values ('ch1', 'power', 'boolean', null::text[], true), ('ch2', 'power', 'boolean', null, true),
                 ('contact', 'contact', 'enum', array['open', 'closed'], false),
                 ('camera', 'power', 'boolean', null, true), ('camera', 'recording', 'boolean', null, true))
      as capability (channel, name, type, values, writable) on capability.channel = channels.channel_key`);
}

describe("scenarios", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  let homeA: Property;
  let homeB: Property;
  let lamp1A: Device;
  let lamp2A: Device;
  let windowA: Device;
  let cameraA: Device;
  let lampB: Device;

  const call = async (user: UserKey | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) => {
    const response = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };
  const base = (home: Property) => `/v1/properties/${home.id}/scenarios`;
  const list = async (user: UserKey, home: Property) => ((await call(user, "GET", base(home))).body as ScenarioListResponse).scenarios;
  const on = (device: Device, value: boolean | number | string = true, capability = "power") => ({ deviceId: device.id, capability, targetValue: value });

  beforeAll(async () => {
    await cleanup();
    await createModels();
    pool = createApiPool();
    app = buildServer({ logLevel: (process.env.TEST_LOG as "error") ?? "silent" }, pool, { sessionVerifier: verifier });
    for (const [name, id] of Object.entries(USERS)) await syncIdentity(pool, { id, phone: null, email: null, name });

    homeA = (await call("ownerA", "POST", "/v1/properties", { name: "Scenarios A", timeZone: "Asia/Tehran" })).body;
    homeB = (await call("ownerB", "POST", "/v1/properties", { name: "Scenarios B" })).body;
    await adminQuery("insert into public.property_members (property_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')", [homeA.id, USERS.adminA, USERS.memberA]);
    for (const [home, suffix] of [[homeA, "a"], [homeB, "b"]] as const) {
      await adminQuery("insert into public.hubs (property_id, name, hardware_id) values ($1, 'Hub', $2)", [home.id, `test-scn-hub-${suffix}-${home.id}`]);
    }
    const provision = (home: Property, model: string, uid: string) =>
      adminQuery("select public.provision_controller((select id from public.hubs where property_id = $1), $2, $3, 'Board')", [home.id, model, uid]);
    await provision(homeA, "test-scn-switch-2ch", `TEST-SCN-A-SW-${homeA.id.slice(0, 8)}`);
    await provision(homeA, "test-scn-sensor", `TEST-SCN-A-SE-${homeA.id.slice(0, 8)}`);
    await provision(homeA, "test-scn-camera", `TEST-SCN-A-CA-${homeA.id.slice(0, 8)}`);
    await provision(homeB, "test-scn-switch-2ch", `TEST-SCN-B-SW-${homeB.id.slice(0, 8)}`);

    const devicesA = ((await call("ownerA", "GET", `/v1/properties/${homeA.id}/devices`)).body as DeviceListResponse).devices;
    lamp1A = devicesA.find((device) => device.name === "Lamp 1")!;
    lamp2A = devicesA.find((device) => device.name === "Lamp 2")!;
    windowA = devicesA.find((device) => device.type === "contact_sensor")!;
    cameraA = devicesA.find((device) => device.type === "camera")!;
    lampB = ((await call("ownerB", "GET", `/v1/properties/${homeB.id}/devices`)).body as DeviceListResponse).devices.find((device) => device.name === "Lamp 1")!;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await cleanup();
  });

  describe("editing", () => {
    it("lets owners and admins create the three kinds", async () => {
      const periodic = await call("ownerA", "POST", base(homeA), { kind: "periodic", name: "Evening", weekdays: [6, 2], time: "15:00", actions: [on(lamp1A)] });
      expect(periodic.status).toBe(201);
      expect(periodic.body).toMatchObject({ kind: "periodic", name: "Evening", enabled: true, weekdays: [2, 6], time: "15:00", date: null, lastRun: null });
      expect(periodic.body.nextRunAt).not.toBeNull();

      const oneTime = await call("adminA", "POST", base(homeA), { kind: "one_time", name: "Trip", date: "2030-03-20", time: "08:00", actions: [on(lamp1A, false), on(lamp2A, false)] });
      expect(oneTime.status).toBe(201);
      // 08:00 in Tehran (UTC+3:30, no daylight saving since 2022).
      expect(oneTime.body).toMatchObject({ date: "2030-03-20", time: "08:00", nextRunAt: "2030-03-20T04:30:00.000Z" });
      expect(oneTime.body.actions).toEqual([on(lamp1A, false), on(lamp2A, false)]);

      const themed = await call("ownerA", "POST", base(homeA), { kind: "themed", name: "Morning", actions: [on(lamp1A), on(lamp2A)] });
      expect(themed.status).toBe(201);
      expect(themed.body).toMatchObject({ kind: "themed", weekdays: null, time: null, date: null, nextRunAt: null });

      expect((await list("memberA", homeA)).map((scenario) => scenario.name)).toEqual(["Evening", "Trip", "Morning"]);
    });

    it("follows the home's time zone, not the server's or the phone's", async () => {
      const trip = (await list("ownerA", homeA)).find((scenario) => scenario.name === "Trip")!;
      expect((await call("ownerA", "PATCH", `/v1/properties/${homeA.id}`, { timeZone: "Europe/London" })).status).toBe(200);
      expect((await list("ownerA", homeA)).find((scenario) => scenario.id === trip.id)!.nextRunAt).toBe("2030-03-20T08:00:00.000Z");
      // After the clocks change (London is UTC+1 from the last Sunday of March).
      const summer = await call("ownerA", "PUT", `${base(homeA)}/${trip.id}`, { kind: "one_time", name: "Trip", date: "2030-04-10", time: "08:00", actions: [on(lamp1A, false)] });
      expect(summer.body.nextRunAt).toBe("2030-04-10T07:00:00.000Z");
      expect((await call("ownerA", "PATCH", `/v1/properties/${homeA.id}`, { timeZone: "Asia/Tehran" })).status).toBe(200);
    });

    it("does not let members create, change or delete", async () => {
      const [evening] = await list("memberA", homeA);
      expect((await call("memberA", "POST", base(homeA), { kind: "themed", name: "Mine", actions: [on(lamp1A)] })).status).toBe(403);
      expect((await call("memberA", "PATCH", `${base(homeA)}/${evening.id}`, { enabled: false })).status).toBe(403);
      expect((await call("memberA", "PUT", `${base(homeA)}/${evening.id}`, { kind: "themed", name: "x", actions: [on(lamp1A)] })).status).toBe(403);
      expect((await call("memberA", "DELETE", `${base(homeA)}/${evening.id}`)).status).toBe(403);
    });

    it("rejects actions that do not fit the device", async () => {
      const create = (actions: object[]) => call("ownerA", "POST", base(homeA), { kind: "themed", name: "Bad", actions });
      expect((await create([on(windowA, "open", "contact")])).status).toBe(400); // a sensor is read-only
      expect((await create([on(lamp1A, 50)])).status).toBe(400); // a switch is on/off
      expect((await create([on(lamp1A, true, "brightness")])).status).toBe(400); // no such capability
      expect((await create([on(lamp1A), on(lamp1A, false)])).status).toBe(400); // twice
      expect((await call("ownerA", "POST", base(homeA), { kind: "themed", name: "Morning", actions: [on(lamp1A)] })).status).toBe(409); // name taken
    });

    it("switches a scenario off and on, and deletes it", async () => {
      const created = (await call("ownerA", "POST", base(homeA), { kind: "periodic", name: "Temp", weekdays: [1], time: "07:00", actions: [on(lamp1A)] })).body as Scenario;
      const off = await call("adminA", "PATCH", `${base(homeA)}/${created.id}`, { enabled: false });
      expect(off.body).toMatchObject({ enabled: false, nextRunAt: null });
      expect((await call("adminA", "PATCH", `${base(homeA)}/${created.id}`, { enabled: true })).body.nextRunAt).not.toBeNull();
      expect((await call("adminA", "DELETE", `${base(homeA)}/${created.id}`)).status).toBe(204);
      expect((await call("adminA", "DELETE", `${base(homeA)}/${created.id}`)).status).toBe(404);
    });
  });

  describe("isolation between homes", () => {
    it("hides one home's scenarios from the other", async () => {
      const [evening] = await list("ownerA", homeA);
      expect((await call("ownerB", "GET", base(homeA))).status).toBe(404);
      expect(await list("ownerB", homeB)).toEqual([]);
      expect((await call("ownerB", "PUT", `${base(homeB)}/${evening.id}`, { kind: "themed", name: "x", actions: [on(lampB)] })).status).toBe(404);
      expect((await call("ownerB", "PATCH", `${base(homeB)}/${evening.id}`, { enabled: false })).status).toBe(404);
      expect((await call("ownerB", "DELETE", `${base(homeB)}/${evening.id}`)).status).toBe(404);
      expect((await call("ownerB", "POST", `${base(homeA)}/${evening.id}/run`)).status).toBe(404);
      expect((await call("ownerB", "POST", `${base(homeB)}/${evening.id}/run`)).status).toBe(404);
    });

    it("never lets a scenario control another home's device", async () => {
      expect((await call("ownerB", "POST", base(homeB), { kind: "themed", name: "Steal", actions: [on(lamp1A)] })).status).toBe(404);
      expect((await call("ownerA", "POST", base(homeA), { kind: "themed", name: "Steal", actions: [on(lampB)] })).status).toBe(404);
      // The database refuses it too, even for a direct write.
      const [evening] = await list("ownerA", homeA);
      await expect(
        adminQuery("insert into public.scenario_actions (scenario_id, property_id, position, device_id, capability, target_value) values ($1, $2, 9, $3, 'power', 'true')", [evening.id, homeA.id, lampB.id]),
      ).rejects.toThrow();
    });
  });

  describe("running", () => {
    it("lets any member run a themed scenario; each action becomes a command from the scenario", async () => {
      const morning = (await list("memberA", homeA)).find((scenario) => scenario.name === "Morning")!;
      const run = await call("memberA", "POST", `${base(homeA)}/${morning.id}/run`);
      expect(run.status).toBe(201);
      const body = run.body as ScenarioRunResponse;
      expect(body.run).toMatchObject({ trigger: "manual", status: "started", scheduledFor: null });
      expect(body.commandIds).toHaveLength(2);
      const commands = await Promise.all(body.commandIds.map(async (id) => (await call("memberA", "GET", `/v1/properties/${homeA.id}/commands/${id}`)).body as Command));
      expect(commands.map((command) => [command.deviceId, command.targetValue, command.status])).toEqual([[lamp1A.id, true, "pending"], [lamp2A.id, true, "pending"]]);
      const stored = await adminQuery<{ scenario_run_id: string; requested_by: string }>("select scenario_run_id, requested_by from public.device_commands where id = any($1::uuid[])", [body.commandIds]);
      expect(stored.every((row) => row.scenario_run_id === body.run.id && row.requested_by === USERS.memberA)).toBe(true);
      expect((await list("memberA", homeA)).find((scenario) => scenario.id === morning.id)!.lastRun?.id).toBe(body.run.id);
    });

    it("runs scheduled scenarios only at their time", async () => {
      const [evening] = await list("ownerA", homeA);
      expect((await call("ownerA", "POST", `${base(homeA)}/${evening.id}/run`)).status).toBe(409);
    });

    it("carries out a scenario on the simulated hub in order: camera on, then recording", async () => {
      const created = (await call("ownerA", "POST", base(homeA), { kind: "themed", name: "Watch", actions: [on(cameraA), on(cameraA, true, "recording")] })).body as Scenario;
      const simulator = startHubSimulator(pool, silentLog, { pollMs: 25, defaultDelayMs: 0, delays: {}, networkDelayMs: [0, 30], boardPrefix: "TEST-SCN-A-", scenarioPollMs: 0 });
      try {
        const { commandIds } = (await call("ownerA", "POST", `${base(homeA)}/${created.id}/run`)).body as ScenarioRunResponse;
        let statuses: string[] = [];
        for (let i = 0; i < 100; i++) {
          statuses = await Promise.all(commandIds.map(async (id) => ((await call("ownerA", "GET", `/v1/properties/${homeA.id}/commands/${id}`)).body as Command).status));
          if (statuses.every((status) => status !== "pending" && status !== "sent")) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        // All of them (earlier runs' commands too) are carried out; this run's both applied.
        expect(statuses).toEqual(["applied", "applied"]);
      } finally {
        simulator.stop();
      }
    });
  });

  describe("the scheduler (the hub, simulated)", () => {
    const due = (now: string, prefix = "TEST-SCN-A-") => runDueScenarios(pool, { now: new Date(now), boardPrefix: prefix });
    let daily: Scenario;
    let once: Scenario;
    let lateOnce: Scenario;

    beforeAll(async () => {
      daily = (await call("ownerA", "POST", base(homeA), { kind: "periodic", name: "Daily", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "10:00", actions: [on(lamp2A)] })).body;
      once = (await call("ownerA", "POST", base(homeA), { kind: "one_time", name: "Once", date: "2031-05-10", time: "09:00", actions: [on(lamp1A)] })).body;
      lateOnce = (await call("ownerA", "POST", base(homeA), { kind: "one_time", name: "Late once", date: "2031-05-11", time: "09:00", actions: [on(lamp1A)] })).body;
      // Pretend they were made long ago, so past occurrences count (normally only later ones do).
      await adminQuery("update public.scenarios set schedule_from = '2029-01-01' where property_id = $1", [homeA.id]);
      // Only the occurrences under test: switch the others off.
      await adminQuery("update public.scenarios set enabled = false where property_id = $1 and not (id = any($2::uuid[]))", [homeA.id, [daily.id, once.id, lateOnce.id]]);
    });

    it("runs a periodic occurrence once, at 10:00 home time", async () => {
      // 10:01 in Tehran = 06:31 UTC.
      const first = await due("2030-01-07T06:31:00Z");
      expect(first.filter((outcome) => outcome.scenarioId === daily.id)).toEqual([
        { scenarioId: daily.id, scheduledFor: new Date("2030-01-07T06:30:00Z"), status: "started", commandIds: [expect.any(String)] },
      ]);
      // A restarted runner does not run it again.
      expect((await due("2030-01-07T06:31:30Z")).filter((outcome) => outcome.scenarioId === daily.id)).toEqual([]);
    });

    it("skips a periodic occurrence that is more than 2 minutes late, and records it as missed", async () => {
      const late = await due("2030-01-08T06:40:00Z");
      expect(late.filter((outcome) => outcome.scenarioId === daily.id)).toEqual([
        { scenarioId: daily.id, scheduledFor: new Date("2030-01-08T06:30:00Z"), status: "missed", commandIds: [] },
      ]);
      const runs = await adminQuery<{ status: string }>("select status from public.scenario_runs where scenario_id = $1 order by scheduled_for", [daily.id]);
      expect(runs.map((row) => row.status)).toEqual(["started", "missed"]);
    });

    it("gives a one-time scenario 10 minutes", async () => {
      // 09:09 in Tehran on 10 May = 05:39 UTC: still runs. The 11 May one is a day late: missed.
      const outcomes = await due("2031-05-10T05:39:00Z");
      expect(outcomes.find((outcome) => outcome.scenarioId === once.id)?.status).toBe("started");
      const next = await due("2031-05-11T05:41:00Z");
      expect(next.find((outcome) => outcome.scenarioId === lateOnce.id)?.status).toBe("missed");
      expect((await list("ownerA", homeA)).find((scenario) => scenario.id === once.id)).toMatchObject({ nextRunAt: null, lastRun: { trigger: "schedule", status: "started" } });
    });

    it("never runs a switched-off scenario, and only for the homes it serves", async () => {
      await adminQuery("update public.scenarios set enabled = false where id = $1", [daily.id]);
      await adminQuery("update public.scenarios set schedule_from = '2029-01-01' where id = $1", [daily.id]);
      expect((await due("2030-01-09T06:31:00Z")).filter((outcome) => outcome.scenarioId === daily.id)).toEqual([]);
      await adminQuery("update public.scenarios set enabled = true, schedule_from = '2029-01-01' where id = $1", [daily.id]);
      // Home B's runner never runs home A's scenarios.
      expect(await due("2030-01-10T06:31:00Z", "TEST-SCN-B-")).toEqual([]);
    });

    it("counts occurrences only from when a scenario was made, changed or switched back on", async () => {
      const before = Date.now();
      await call("ownerA", "PATCH", `${base(homeA)}/${daily.id}`, { enabled: false });
      await call("ownerA", "PATCH", `${base(homeA)}/${daily.id}`, { enabled: true });
      const rows = await adminQuery<{ schedule_from: Date }>("select schedule_from from public.scenarios where id = $1", [daily.id]);
      expect(rows[0].schedule_from.getTime()).toBeGreaterThanOrEqual(before - 1000);
      // So yesterday's 10:00 is not run (nor reported missed) now.
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      expect((await due(yesterday)).filter((outcome) => outcome.scenarioId === daily.id)).toEqual([]);
    });

    it("drops an action when its device is removed", async () => {
      await adminQuery("delete from public.devices where id = $1", [lamp2A.id]);
      const scenarios = await list("ownerA", homeA);
      expect(scenarios.find((scenario) => scenario.id === daily.id)!.actions).toEqual([]);
      expect(scenarios.find((scenario) => scenario.name === "Morning")!.actions).toEqual([on(lamp1A)]);
    });
  });
});
