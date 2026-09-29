/**
 * Devices, commands, command expiry and the dev hub simulator against the dev database.
 * Two homes with separate users; a device or command of one home must never be visible to or
 * controllable from the other, and a command is only "applied" once the (simulated) ESP32 reports.
 */
import type { Command, Device, DeviceListResponse, Property, Room } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { SessionCredential, SessionVerifier, VerifiedSession } from "../src/auth/session-verifier";
import { expireCommands } from "../src/commands/expiry";
import { claimPendingCommands, confirmCommand, reportDeviceState, startHubSimulator } from "../src/dev/hub-simulator";
import { MAX_OPEN_COMMANDS_PER_DEVICE } from "../src/http/devices";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const USERS = {
  ownerA: "7e5c0000-0000-4000-8000-000000000001",
  adminA: "7e5c0000-0000-4000-8000-000000000002",
  memberA: "7e5c0000-0000-4000-8000-000000000003",
  ownerB: "7e5c0000-0000-4000-8000-000000000004",
} as const;
type UserKey = keyof typeof USERS;
const ALL_USERS = Object.values(USERS);
const MODEL_CODES = ["test-api-switch-2ch", "test-api-sensor", "test-api-cooler"];

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
        ('test-api-switch-2ch', 'API test switch'), ('test-api-sensor', 'API test sensor'), ('test-api-cooler', 'API test cooler')
      returning id, code
    ), channels as (
      insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name)
      select id, channel.key, channel.type, channel.name from models
      join (values ('test-api-switch-2ch', 'ch1', 'switch', 'Lamp 1'), ('test-api-switch-2ch', 'ch2', 'switch', 'Lamp 2'),
                   ('test-api-sensor', 'contact', 'contact_sensor', 'Window'), ('test-api-cooler', 'cooler', 'cooler', 'Cooler'))
        as channel (code, key, type, name) on channel.code = models.code
      returning model_id, channel_key
    )
    insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, enum_values, writable)
    select model_id, channel_key, capability.name, capability.type, capability.values, capability.writable
    from channels
    join (values ('ch1', 'power', 'boolean', null::text[], true), ('ch2', 'power', 'boolean', null, true),
                 ('contact', 'contact', 'enum', array['open', 'closed'], false),
                 ('cooler', 'pump', 'boolean', null, true), ('cooler', 'speed', 'enum', array['off', 'low', 'high'], true))
      as capability (channel, name, type, values, writable) on capability.channel = channels.channel_key`);
}

describe("devices and commands", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  let homeA: Property;
  let homeB: Property;
  let kitchenA: Room;
  let roomB: Room;
  let lampA: Device;
  let windowA: Device;
  let coolerA: Device;
  let lampB: Device;

  const call = async (user: UserKey | null, method: "GET" | "POST" | "PATCH", url: string, payload?: object) => {
    const response = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };
  const devicesOf = async (user: UserKey, home: Property) => ((await call(user, "GET", `/v1/properties/${home.id}/devices`)).body as DeviceListResponse).devices;
  let keySeq = 0;
  const key = () => `test-key-${Date.now()}-${keySeq++}`;
  const command = (user: UserKey, home: Property, body: object) => call(user, "POST", `/v1/properties/${home.id}/commands`, { idempotencyKey: key(), ...body });

  beforeAll(async () => {
    await cleanup();
    await createModels();
    pool = createApiPool();
    app = buildServer({ logLevel: "silent", devRoutes: true }, pool, { sessionVerifier: verifier });
    for (const [name, id] of Object.entries(USERS)) await syncIdentity(pool, { id, phone: null, email: null, name });

    homeA = (await call("ownerA", "POST", "/v1/properties", { name: "Devices A" })).body;
    homeB = (await call("ownerB", "POST", "/v1/properties", { name: "Devices B" })).body;
    kitchenA = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "Kitchen" })).body;
    roomB = (await call("ownerB", "POST", `/v1/properties/${homeB.id}/rooms`, { name: "Hall" })).body;
    await adminQuery("insert into public.property_members (property_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')", [homeA.id, USERS.adminA, USERS.memberA]);

    for (const [home, suffix] of [[homeA, "a"], [homeB, "b"]] as const) {
      await adminQuery("insert into public.hubs (property_id, name, hardware_id) values ($1, 'Hub', $2)", [home.id, `test-api-hub-${suffix}-${home.id}`]);
    }
    const provision = (home: Property, model: string, uid: string) =>
      adminQuery("select public.provision_controller((select id from public.hubs where property_id = $1), $2, $3, 'Board')", [home.id, model, uid]);
    await provision(homeA, "test-api-switch-2ch", `TEST-API-A-SW-${homeA.id.slice(0, 8)}`);
    await provision(homeA, "test-api-sensor", `TEST-API-A-SE-${homeA.id.slice(0, 8)}`);
    await provision(homeA, "test-api-cooler", `TEST-API-A-CO-${homeA.id.slice(0, 8)}`);
    await provision(homeB, "test-api-switch-2ch", `TEST-API-B-SW-${homeB.id.slice(0, 8)}`);

    const devicesA = await devicesOf("ownerA", homeA);
    lampA = devicesA.find((device) => device.name === "Lamp 1")!;
    windowA = devicesA.find((device) => device.type === "contact_sensor")!;
    coolerA = devicesA.find((device) => device.type === "cooler")!;
    lampB = (await devicesOf("ownerB", homeB)).find((device) => device.name === "Lamp 1")!;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await cleanup();
  });

  describe("GET devices", () => {
    it("lists a home's board devices with their capabilities, for every member", async () => {
      const devices = await devicesOf("memberA", homeA);
      expect(devices.map((device) => device.name).sort()).toEqual(["Cooler", "Lamp 1", "Lamp 2", "Window"]);
      expect(lampA).toMatchObject({ type: "switch", roomId: null, capabilities: [{ capability: "power", writable: true, value: null, reportedAt: null }] });
      expect(coolerA.capabilities.map((capability) => capability.capability)).toEqual(["pump", "speed"]);
      expect(windowA.capabilities).toEqual([{ capability: "contact", writable: false, value: null, reportedAt: null }]);
    });

    it("never shows another home's devices", async () => {
      expect((await call("ownerB", "GET", `/v1/properties/${homeA.id}/devices`)).status).toBe(404);
      expect((await devicesOf("ownerB", homeB)).map((device) => device.id)).not.toContain(lampA.id);
    });
  });

  describe("PATCH devices", () => {
    it("lets admins rename a device and move it between rooms of the home", async () => {
      const renamed = await call("adminA", "PATCH", `/v1/properties/${homeA.id}/devices/${lampA.id}`, { name: "Kitchen lamp", roomId: kitchenA.id });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ id: lampA.id, name: "Kitchen lamp", roomId: kitchenA.id, type: "switch" });
      const cleared = await call("ownerA", "PATCH", `/v1/properties/${homeA.id}/devices/${lampA.id}`, { roomId: null });
      expect(cleared.body).toMatchObject({ name: "Kitchen lamp", roomId: null });
    });

    it("refuses members, other homes' rooms and hardware fields", async () => {
      expect((await call("memberA", "PATCH", `/v1/properties/${homeA.id}/devices/${lampA.id}`, { name: "Nope" })).status).toBe(403);
      expect((await call("ownerA", "PATCH", `/v1/properties/${homeA.id}/devices/${lampA.id}`, { roomId: roomB.id })).status).toBe(404);
      expect((await call("ownerA", "PATCH", `/v1/properties/${homeA.id}/devices/${lampA.id}`, { controllerId: lampB.id })).status).toBe(400);
      expect((await call("ownerA", "PATCH", `/v1/properties/${homeA.id}/devices/${lampB.id}`, { name: "Hijack" })).status).toBe(404);
      expect((await call("ownerB", "PATCH", `/v1/properties/${homeA.id}/devices/${lampA.id}`, { name: "Hijack" })).status).toBe(404);
      const [row] = await adminQuery<{ name: string }>("select name from public.devices where id = $1", [lampB.id]);
      expect(row.name).toBe("Lamp 1");
    });
  });

  describe("POST commands", () => {
    it("lets members send a command, which starts pending", async () => {
      const created = await command("memberA", homeA, { deviceId: lampA.id, capability: "power", targetValue: true });
      expect(created.status).toBe(201);
      expect(created.body as Command).toMatchObject({ deviceId: lampA.id, capability: "power", targetValue: true, status: "pending", completedAt: null });
      const fetched = await call("memberA", "GET", `/v1/properties/${homeA.id}/commands/${created.body.id}`);
      expect(fetched.body).toEqual(created.body);
    });

    it("validates the value against the device's capability", async () => {
      expect((await command("ownerA", homeA, { deviceId: lampA.id, capability: "power", targetValue: 1 })).status).toBe(400);
      expect((await command("ownerA", homeA, { deviceId: coolerA.id, capability: "speed", targetValue: "turbo" })).status).toBe(400);
      expect((await command("ownerA", homeA, { deviceId: coolerA.id, capability: "speed", targetValue: "high" })).status).toBe(201);
      expect((await command("ownerA", homeA, { deviceId: windowA.id, capability: "contact", targetValue: "open" })).status).toBe(400);
      expect((await command("ownerA", homeA, { deviceId: lampA.id, capability: "brightness", targetValue: 50 })).status).toBe(400);
    });

    it("never reaches another home's device or command", async () => {
      expect((await command("ownerA", homeA, { deviceId: lampB.id, capability: "power", targetValue: true })).status).toBe(404);
      expect((await command("ownerB", homeA, { deviceId: lampA.id, capability: "power", targetValue: true })).status).toBe(404);
      const commandB = (await command("ownerB", homeB, { deviceId: lampB.id, capability: "power", targetValue: true })).body as Command;
      expect((await call("ownerA", "GET", `/v1/properties/${homeA.id}/commands/${commandB.id}`)).status).toBe(404);
      expect((await call("ownerA", "GET", `/v1/properties/${homeB.id}/commands/${commandB.id}`)).status).toBe(404);
    });

    it("returns the original command when a request is retried with the same key", async () => {
      const idempotencyKey = key();
      const first = await call("memberA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: lampA.id, capability: "power", targetValue: false, idempotencyKey });
      const retry = await call("memberA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: lampA.id, capability: "power", targetValue: false, idempotencyKey });
      expect([first.status, retry.status]).toEqual([201, 200]);
      expect(retry.body.id).toBe(first.body.id);
      const reused = await call("memberA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: lampA.id, capability: "power", targetValue: true, idempotencyKey });
      expect(reused.status).toBe(409);
    });

    it(`allows at most ${MAX_OPEN_COMMANDS_PER_DEVICE} open commands per device`, async () => {
      const lamp2 = (await devicesOf("ownerA", homeA)).find((device) => device.name === "Lamp 2")!;
      for (let i = 0; i < MAX_OPEN_COMMANDS_PER_DEVICE; i++) {
        expect((await command("ownerA", homeA, { deviceId: lamp2.id, capability: "power", targetValue: i % 2 === 0 })).status).toBe(201);
      }
      const over = await command("ownerA", homeA, { deviceId: lamp2.id, capability: "power", targetValue: true });
      expect([over.status, over.body]).toEqual([409, { error: "conflict" }]);
      await adminQuery("update public.device_commands set expires_at = now() - interval '1 second' where device_id = $1 and status in ('pending', 'sent')", [lamp2.id]);
      await expireCommands(pool);
    });
  });

  describe("command lifecycle", () => {
    it("reports an unconfirmed command as timed out once it expires, then stores it", async () => {
      const created = (await command("ownerA", homeA, { deviceId: lampA.id, capability: "power", targetValue: true })).body as Command;
      await adminQuery("update public.device_commands set expires_at = now() - interval '1 second' where id = $1", [created.id]);
      const shown = (await call("ownerA", "GET", `/v1/properties/${homeA.id}/commands/${created.id}`)).body as Command;
      expect(shown).toMatchObject({ status: "timed_out", errorCode: "timeout" });

      await expireCommands(pool);
      const [row] = await adminQuery<{ status: string; completed_at: Date | null }>("select status, completed_at from public.device_commands where id = $1", [created.id]);
      expect(row.status).toBe("timed_out");
      expect(row.completed_at).not.toBeNull();
      const events = await adminQuery("select 1 from public.realtime_events where command_id = $1 and event_type = 'command.status_changed'", [created.id]);
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it("leaves boards that are not simulated alone", async () => {
      const created = (await command("memberA", homeA, { deviceId: lampA.id, capability: "power", targetValue: true })).body as Command;
      expect((await claimPendingCommands(pool)).map((entry) => entry.id)).not.toContain(created.id);
      await adminQuery("update public.device_commands set expires_at = now() - interval '1 second' where id = $1", [created.id]);
      await expireCommands(pool);
    });

    it("applies a command only when the (simulated) ESP32 reports the value", async () => {
      await adminQuery("update public.device_commands set expires_at = now() - interval '1 second' where status in ('pending', 'sent')");
      await expireCommands(pool);

      const created = (await command("memberA", homeA, { deviceId: coolerA.id, capability: "speed", targetValue: "low" })).body as Command;
      const claimed = await claimPendingCommands(pool, "TEST-API-");
      expect(claimed.map((entry) => entry.id)).toContain(created.id);
      expect(((await call("memberA", "GET", `/v1/properties/${homeA.id}/commands/${created.id}`)).body as Command).status).toBe("sent");
      const speedBefore = (await devicesOf("memberA", homeA)).find((device) => device.id === coolerA.id)!.capabilities.find((c) => c.capability === "speed")!;
      expect(speedBefore.value).toBeNull();

      expect(await confirmCommand(pool, claimed.find((entry) => entry.id === created.id)!)).toBe(true);
      const applied = (await call("memberA", "GET", `/v1/properties/${homeA.id}/commands/${created.id}`)).body as Command;
      expect(applied).toMatchObject({ status: "applied", errorCode: null });
      const cooler = (await devicesOf("memberA", homeA)).find((device) => device.id === coolerA.id)!;
      expect(cooler.online).toBe(true);
      expect(cooler.capabilities.find((c) => c.capability === "speed")).toMatchObject({ value: "low", reportedAt: expect.any(String) });
    });

    it("never applies a command that expired before the ESP32 answered", async () => {
      const created = (await command("memberA", homeA, { deviceId: coolerA.id, capability: "pump", targetValue: true })).body as Command;
      const claimed = (await claimPendingCommands(pool, "TEST-API-")).find((entry) => entry.id === created.id)!;
      await adminQuery("update public.device_commands set expires_at = now() - interval '1 second' where id = $1", [created.id]);
      expect(await confirmCommand(pool, claimed)).toBe(false);
      const pump = (await devicesOf("memberA", homeA)).find((device) => device.id === coolerA.id)!.capabilities.find((c) => c.capability === "pump")!;
      expect(pump.value).toBeNull();
    });

    it("runs end to end with the simulator loop", async () => {
      const simulator = startHubSimulator(pool, silentLog, { pollMs: 25, defaultDelayMs: 0, delays: {}, boardPrefix: "TEST-API-" });
      try {
        const created = (await command("memberA", homeA, { deviceId: lampA.id, capability: "power", targetValue: true })).body as Command;
        let status = created.status;
        for (let i = 0; i < 80 && status !== "applied"; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          status = ((await call("memberA", "GET", `/v1/properties/${homeA.id}/commands/${created.id}`)).body as Command).status;
        }
        expect(status).toBe("applied");
        const lamp = (await devicesOf("memberA", homeA)).find((device) => device.id === lampA.id)!;
        expect(lamp.capabilities[0].value).toBe(true);
      } finally {
        simulator.stop();
      }
    });
  });

  describe("reports without a command (wall switch, sensor)", () => {
    it("stores valid reports, including read-only sensor values", async () => {
      expect(await reportDeviceState(pool, windowA.id, "contact", "open")).toBe("stored");
      expect(await reportDeviceState(pool, lampA.id, "power", false)).toBe("stored");
      const devices = await devicesOf("memberA", homeA);
      expect(devices.find((device) => device.id === windowA.id)!.capabilities[0].value).toBe("open");
      expect(devices.find((device) => device.id === lampA.id)!.capabilities[0].value).toBe(false);
    });

    it("rejects values that do not fit and capabilities the device lacks", async () => {
      expect(await reportDeviceState(pool, windowA.id, "contact", "ajar")).toBe("invalid");
      expect(await reportDeviceState(pool, lampA.id, "brightness", 40)).toBe("unknown");
    });

    it("is reachable as a dev-only internal route", async () => {
      const report = (payload: object) => app.inject({ method: "POST", url: "/internal/dev/report", payload });
      expect((await report({ deviceId: windowA.id, capability: "contact", value: "closed" })).statusCode).toBe(204);
      expect((await report({ deviceId: windowA.id, capability: "contact", value: 3 })).statusCode).toBe(400);
      expect((await report({ deviceId: "7e5c0000-0000-4000-8000-0000000000ff", capability: "power", value: true })).statusCode).toBe(404);
      const production = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier });
      expect((await production.inject({ method: "POST", url: "/internal/dev/report", payload: { deviceId: windowA.id, capability: "contact", value: "open" } })).statusCode).toBe(404);
      await production.close();
    });
  });
});
