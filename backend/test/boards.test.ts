/**
 * Pairing and factory reset against the dev database and broker. An owner or admin adds a product
 * (its devices wait in the home) and asks for a setup code; the real board, with its factory
 * secret and that code, joins the home and gets its broker account. A code is one board's, lasts
 * 10 minutes, needs the same product, and a board gets 5 wrong tries an hour. Pairing with another
 * home, a reset, or removing the board in the app leaves nothing of it behind in the old home.
 * Unused channels can be hidden.
 */
import { boardTopic, normalizeSetupCode, type Device, type HardwareProductListResponse, type PairBoardResponse, type Property, type Scenario, type ScenarioRunResponse, type SetupCodeResponse } from "@m2smart/contracts";
import mqtt from "mqtt";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { SessionCredential, SessionVerifier, VerifiedSession } from "../src/auth/session-verifier";
import { followBoardResets, sha256 } from "../src/boards/pairing";
import { followBoardStatus } from "../src/broker/board-status";
import { connectBroker, type Broker } from "../src/broker/broker";
import { loadConfig } from "../src/config";
import { reportDeviceState } from "../src/devices/reports";
import { loadBackendEnv } from "../src/env";
import { cleanUp } from "../src/maintenance/cleanup";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const USERS = {
  ownerA: "7e5f0000-0000-4000-8000-000000000001",
  adminA: "7e5f0000-0000-4000-8000-000000000002",
  memberA: "7e5f0000-0000-4000-8000-000000000003",
  ownerB: "7e5f0000-0000-4000-8000-000000000004",
} as const;
type UserKey = keyof typeof USERS;
const ALL_USERS = Object.values(USERS);
const MODEL = "test-pair-switch-2ch";
const OTHER_MODEL = "test-pair-dimmer";
/** Three genuine boards of MODEL: the one paired around, a second one, and one for wrong tries. */
const UID = "TEST-PAIR-0001";
const UID_2 = "TEST-PAIR-0002";
const UID_3 = "TEST-PAIR-0003";
const SECRET = (uid: string) => `factory-secret-of-${uid.toLowerCase()}-abcdefghijklmnop`;

const verifier: SessionVerifier = {
  async verify(credential: SessionCredential): Promise<VerifiedSession | null> {
    const userId = USERS[credential.value as UserKey];
    return userId
      ? { userId, sessionId: `s-${userId}`, expiresAt: new Date(Date.now() + 3_600_000), authMethods: ["code"], identity: { phone: null, email: null, name: null }, issuer: "cloud" }
      : null;
  },
};
const silentLog = { info: () => undefined, error: () => undefined };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup(): Promise<void> {
  await adminQuery("delete from public.properties where created_by = any($1::uuid[])", [ALL_USERS]);
  await adminQuery("delete from public.manufactured_boards where hardware_uid = any($1::text[])", [[UID, UID_2, UID_3]]);
  await adminQuery("delete from public.hardware_models where code = any($1::text[])", [[MODEL, OTHER_MODEL]]);
  await deleteUsers(ALL_USERS);
}

describe("pairing and factory reset", () => {
  loadBackendEnv();
  const brokerConfig = loadConfig().broker!;
  let pool: Pool;
  let broker: Broker;
  let app: ReturnType<typeof buildServer>;
  let homeA: Property;
  let homeB: Property;

  const call = async (user: UserKey | null, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) => {
    const response = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };
  const boards = (home: Property) => `/v1/properties/${home.id}/boards`;
  /** The owner or admin adds a product; its devices wait for the real board. */
  const addWaiting = async (user: UserKey, home: Property, modelCode = MODEL, channels: object[] = []) => (await call(user, "POST", boards(home), { modelCode, channels })).body as PairBoardResponse;
  const setupCode = (user: UserKey | null, home: Property, boardId: string) => call(user, "POST", `${boards(home)}/${boardId}/setup-code`);
  /** What the real board does with the code it was given. */
  const claim = (code: string, uid = UID, secret = SECRET(uid)) => call(null, "POST", "/v1/boards/claim", { hardwareUid: uid, secret, code });
  /** Adds a product, gets a code and lets the board use it: the board is then in that home. */
  const pairInto = async (user: UserKey, home: Property, uid = UID) => {
    const waiting = await addWaiting(user, home);
    const { code } = (await setupCode(user, home, waiting.boardId)).body as SetupCodeResponse;
    const account = (await claim(code, uid)).body as { boardId: string; brokerSecret: string };
    return { ...waiting, ...account, code };
  };
  const devicesOf = async (user: UserKey, home: Property) => ((await call(user, "GET", `/v1/properties/${home.id}/devices`)).body as { devices: Device[] }).devices;
  const count = async (sql: string, values: unknown[]) => Number((await adminQuery<{ n: string }>(`select count(*) as n from ${sql}`, values))[0].n);
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 60; i++) {
      if (await check()) return true;
      await wait(100);
    }
    return false;
  };

  beforeAll(async () => {
    await cleanup();
    await adminQuery(`
      with model as (insert into public.hardware_models (code, name) values ('${MODEL}', 'Pairing test switch') returning id),
      channels as (insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select id, key, 'switch', name from model, (values ('ch1', 'Lamp 1'), ('ch2', 'Lamp 2')) as channel (key, name) returning model_id, channel_key),
      button as (insert into public.hardware_model_pins (model_id, gpio, function, role) select id, 35, 'setup_button', 'setup' from model),
      registry as (insert into public.manufactured_boards (hardware_uid, model_id, factory_secret_hash) select uid, id, hash from model, (values ('${UID}', '${sha256(SECRET(UID))}'), ('${UID_2}', '${sha256(SECRET(UID_2))}'), ('${UID_3}', '${sha256(SECRET(UID_3))}')) as board (uid, hash))
      insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, writable) select model_id, channel_key, 'power', 'boolean', true from channels`);
    await adminQuery(`
      with model as (insert into public.hardware_models (code, name) values ('${OTHER_MODEL}', 'Pairing test dimmer') returning id),
      channel as (insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select id, 'light', 'dimmer', 'Dimmer' from model returning model_id),
      button as (insert into public.hardware_model_pins (model_id, gpio, function, role) select id, 35, 'setup_button', 'setup' from model)
      insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, unit, writable) select model_id, 'light', 'brightness', 'integer', 0, 100, 1, '%', true from channel`);
    pool = createApiPool();
    broker = await connectBroker(brokerConfig, silentLog);
    followBoardStatus(broker, pool, silentLog);
    followBoardResets(broker, pool, silentLog);
    app = buildServer({ logLevel: "silent" }, pool, { sessionVerifier: verifier, broker: () => broker });
    for (const [name, id] of Object.entries(USERS)) await syncIdentity(pool, { id, phone: null, email: null, name });
    homeA = (await call("ownerA", "POST", "/v1/properties", { name: "Pairing A" })).body;
    homeB = (await call("ownerB", "POST", "/v1/properties", { name: "Pairing B" })).body;
    await adminQuery("insert into public.property_members (property_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')", [homeA.id, USERS.adminA, USERS.memberA]);
  });

  afterAll(async () => {
    for (const board of await adminQuery<{ id: string }>("select id from public.controllers where hardware_uid = any($1::text[])", [[UID, UID_2, UID_3]])) await broker?.removeBoard(board.id).catch(() => undefined);
    await broker?.close();
    await app?.close();
    await pool?.end();
    await cleanup();
  });

  describe("adding a product, then pairing it with a setup code", () => {
    let hall: { id: string };
    let waiting: PairBoardResponse;
    let waitingDimmer: PairBoardResponse;
    let code: string;

    beforeAll(async () => {
      hall = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "Hall" })).body;
    });

    it("lists the products a home can add, with their channels and category", async () => {
      const { products } = (await call("memberA", "GET", "/v1/hardware-products")).body as HardwareProductListResponse;
      expect(products.find((product) => product.code === MODEL)).toEqual({
        code: MODEL,
        name: "Pairing test switch",
        category: "lighting",
        channels: [{ key: "ch1", deviceType: "switch", defaultName: "Lamp 1" }, { key: "ch2", deviceType: "switch", defaultName: "Lamp 2" }],
      });
      expect((await call(null, "GET", "/v1/hardware-products")).status).toBe(401);
    });

    it("only an owner or admin adds a product, and only what the product really has", async () => {
      const body = { modelCode: MODEL, channels: [{ key: "ch1", name: "Ceiling", roomId: hall.id }] };
      expect((await call("memberA", "POST", boards(homeA), body)).status).toBe(403);
      expect((await call("ownerB", "POST", boards(homeA), body)).status).toBe(404);
      expect((await call("ownerA", "POST", boards(homeA), { modelCode: "no-such-product" })).status).toBe(404);
      expect((await call("ownerA", "POST", boards(homeA), { modelCode: MODEL, channels: [{ key: "ch9", name: "Ghost", roomId: null }] })).status).toBe(400);
      // The old way (a pairing code from the board) is gone.
      expect((await call("ownerA", "POST", boards(homeA), { pairingCode: "M2P1:TEST-PAIR-0001:AAAAAAAAAAAAAAAAAAAAAAAAAA" })).status).toBe(400);
      // A room of another home is refused, and nothing is added.
      expect((await call("ownerB", "POST", boards(homeB), body)).status).toBe(400);
      expect(await devicesOf("ownerB", homeB)).toEqual([]);
      expect(await devicesOf("ownerA", homeA)).toEqual([]);
    });

    it("the product's channels join the home, named and placed, waiting for their board", async () => {
      waiting = await addWaiting("adminA", homeA, MODEL, [{ key: "ch1", name: "Ceiling", roomId: hall.id }, { key: "ch2", name: "Wall", roomId: null }]);
      expect(waiting.devices.map((device) => [device.name, device.roomId, device.pending, device.online])).toEqual([["Ceiling", hall.id, true, false], ["Wall", null, true, false]]);
      waitingDimmer = await addWaiting("ownerA", homeA, OTHER_MODEL);
      expect(waitingDimmer.devices.map((device) => [device.name, device.pending])).toEqual([["Dimmer", true]]);
    });

    it("a waiting device cannot be commanded, and scenarios skip it until it is paired", async () => {
      const ceiling = waiting.devices[0];
      const command = await call("ownerA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: ceiling.id, capability: "power", targetValue: true, idempotencyKey: `waiting-${Date.now()}` });
      expect([command.status, command.body]).toEqual([409, { error: "conflict" }]);
      const scenario = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/scenarios`, { kind: "themed", name: "Prepared", actions: [{ deviceId: ceiling.id, capability: "power", targetValue: true }] })).body as Scenario;
      const run = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/scenarios/${scenario.id}/run`)).body as ScenarioRunResponse;
      expect(run.commandIds).toEqual([]);
    });

    it("only an owner or admin of the home gets a setup code, and only for a board that waits there", async () => {
      expect((await setupCode("memberA", homeA, waiting.boardId)).status).toBe(403);
      expect((await setupCode("ownerB", homeA, waiting.boardId)).status).toBe(404);
      expect((await setupCode("ownerB", homeB, waiting.boardId)).status).toBe(404);
      expect((await setupCode(null, homeA, waiting.boardId)).status).toBe(401);
      expect((await setupCode("ownerA", homeA, "7e5f0002-0000-4000-8000-000000000000")).status).toBe(404);
    });

    it("a setup code is 12 characters, lasts 10 minutes, and only its hash is stored", async () => {
      const first = await setupCode("ownerA", homeA, waiting.boardId);
      expect(first.status).toBe(201);
      const body = first.body as SetupCodeResponse;
      expect(body.code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      expect(body.setupUrl).toBe(`http://192.168.4.1/?code=${normalizeSetupCode(body.code)}`);
      const minutes = (new Date(body.expiresAt).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(9);
      expect(minutes).toBeLessThanOrEqual(10);
      const [row] = await adminQuery<{ code_hash: string }>("select code_hash from public.board_setup_codes where controller_id = $1", [waiting.boardId]);
      expect(row.code_hash).toBe(sha256(normalizeSetupCode(body.code)!));
      // Asking again gives a new code; the earlier one stops working.
      code = ((await setupCode("adminA", homeA, waiting.boardId)).body as SetupCodeResponse).code;
      expect(code).not.toBe(body.code);
      expect((await claim(body.code, UID_2)).status).toBe(401);
    });

    it("only a genuine board uses a code, and only the right one", async () => {
      expect((await claim(code, UID, "not-the-factory-secret-of-this-board-xxxxxxxx")).status).toBe(401);
      expect((await claim(code, "TEST-PAIR-9999", SECRET("TEST-PAIR-9999"))).status).toBe(401);
      expect((await claim("ZZZZ-ZZZZ-ZZZZ")).status).toBe(401);
      expect((await call(null, "POST", "/v1/boards/claim", { hardwareUid: UID })).status).toBe(400);
      expect((await devicesOf("ownerA", homeA)).every((device) => device.pending)).toBe(true);
    });

    it("the board must be the product that waits", async () => {
      const dimmerCode = ((await setupCode("ownerA", homeA, waitingDimmer.boardId)).body as SetupCodeResponse).code;
      expect(await claim(dimmerCode)).toEqual({ status: 409, body: { error: "conflict" } });
    });

    it("with the right code the board joins: the names and rooms stay, it gets its account and comes online", async () => {
      // Typed by hand: any case, with or without dashes.
      const account = await claim(code.toLowerCase().replace(/-/g, " "));
      expect(account.status).toBe(200);
      expect(account.body).toEqual({ boardId: waiting.boardId, brokerSecret: expect.any(String) });
      expect((await devicesOf("memberA", homeA)).filter((device) => device.boardId === waiting.boardId).map((device) => [device.name, device.roomId, device.pending])).toEqual([["Ceiling", hall.id, false], ["Wall", null, false]]);

      const client = await mqtt.connectAsync(brokerConfig.url, { username: waiting.boardId, password: account.body.brokerSecret, clientId: waiting.boardId, reconnectPeriod: 0 });
      await client.publishAsync(boardTopic(waiting.boardId, "status"), '{"online":true,"fw":"1.0.0"}', { qos: 1, retain: true });
      expect(await until(async () => (await devicesOf("ownerA", homeA)).filter((device) => device.boardId === waiting.boardId).every((device) => device.online))).toBe(true);
      await client.endAsync();
    });

    it("asking again (the answer was lost) gives a new secret and ends the old one; no other board may use the code", async () => {
      const first = (await claim(code)).body;
      const second = (await claim(code)).body;
      expect(second.boardId).toBe(waiting.boardId);
      expect(second.brokerSecret).not.toBe(first.brokerSecret);
      await expect(mqtt.connectAsync(brokerConfig.url, { username: first.boardId, password: first.brokerSecret, reconnectPeriod: 0 })).rejects.toThrow();
      await (await mqtt.connectAsync(brokerConfig.url, { username: second.boardId, password: second.brokerSecret, reconnectPeriod: 0 })).endAsync();
      expect((await claim(code, UID_2)).status).toBe(401);
      // The board no longer waits: no new code for it.
      expect((await setupCode("ownerA", homeA, waiting.boardId)).status).toBe(404);
    });

    it("commands and the scenario prepared earlier now work", async () => {
      const command = await call("ownerA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: waiting.devices[0].id, capability: "power", targetValue: true, idempotencyKey: `paired-${Date.now()}` });
      expect(command.status).toBe(201);
      const prepared = ((await call("ownerA", "GET", `/v1/properties/${homeA.id}/scenarios`)).body.scenarios as Scenario[]).find((scenario) => scenario.name === "Prepared")!;
      expect(((await call("ownerA", "POST", `/v1/properties/${homeA.id}/scenarios/${prepared.id}/run`)).body as ScenarioRunResponse).commandIds).toHaveLength(1);
    });

    it("a board that never gets paired can simply be removed, with its code", async () => {
      expect((await call("ownerA", "DELETE", `${boards(homeA)}/${waitingDimmer.boardId}`)).status).toBe(204);
      expect((await devicesOf("ownerA", homeA)).some((device) => device.boardId === waitingDimmer.boardId)).toBe(false);
      expect(await count("public.board_setup_codes where controller_id = $1", [waitingDimmer.boardId])).toBe(0);
    });
  });

  describe("guessing codes", () => {
    it("a board gets 5 wrong tries an hour; then even the right code waits", async () => {
      const waiting = await addWaiting("ownerB", homeB);
      const { code } = (await setupCode("ownerB", homeB, waiting.boardId)).body as SetupCodeResponse;
      for (let i = 0; i < 5; i++) expect((await claim(`ZZZZ-ZZZZ-ZZZ${i + 2}`, UID_3)).status).toBe(401);
      expect((await claim(code, UID_3)).status).toBe(429);
      expect((await devicesOf("ownerB", homeB)).every((device) => device.pending)).toBe(true);
      // Another board is not affected.
      expect((await claim(code, UID_2)).status).toBe(200);
      await call("ownerB", "DELETE", `${boards(homeB)}/${waiting.boardId}`);
    });
  });

  describe("a setup code expires", () => {
    it("after 10 minutes it is refused and deleted", async () => {
      const waiting = await addWaiting("ownerA", homeA);
      const { code } = (await setupCode("ownerA", homeA, waiting.boardId)).body as SetupCodeResponse;
      await adminQuery("update public.board_setup_codes set expires_at = now() - interval '1 minute' where controller_id = $1", [waiting.boardId]);
      expect((await claim(code, UID_2)).status).toBe(401);
      await cleanUp(pool);
      expect(await count("public.board_setup_codes where controller_id = $1", [waiting.boardId])).toBe(0);
      await call("ownerA", "DELETE", `${boards(homeA)}/${waiting.boardId}`);
    });
  });

  describe("pairing the board with another home", () => {
    let boardInA: { boardId: string; devices: Device[] };
    let scenario: Scenario;

    beforeAll(async () => {
      const [board] = await adminQuery<{ id: string }>("select id from public.controllers where hardware_uid = $1", [UID]);
      boardInA = { boardId: board.id, devices: (await devicesOf("ownerA", homeA)).filter((device) => device.boardId === board.id) };
      // Home A has used the board: a state, a command and a scenario action.
      await reportDeviceState(pool, boardInA.devices[0].id, "power", true);
      await call("ownerA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: boardInA.devices[0].id, capability: "power", targetValue: false, idempotencyKey: `pair-test-${Date.now()}` });
      scenario = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/scenarios`, { kind: "themed", name: "Lamps", actions: [{ deviceId: boardInA.devices[0].id, capability: "power", targetValue: true }] })).body;
    });

    it("moves the board and leaves nothing of it in the old home", async () => {
      const moved = await pairInto("ownerB", homeB);
      expect(moved.brokerSecret).toEqual(expect.any(String));
      expect((await devicesOf("ownerB", homeB)).filter((device) => device.boardId === moved.boardId).map((device) => device.name)).toEqual(["Lamp 1", "Lamp 2"]);
      expect((await devicesOf("ownerA", homeA)).some((device) => device.boardId === boardInA.boardId)).toBe(false);

      const old = boardInA.devices.map((device) => device.id);
      expect(await count("public.controllers where id = $1", [boardInA.boardId])).toBe(0);
      expect(await count("public.device_states where device_id = any($1::uuid[])", [old])).toBe(0);
      expect(await count("public.device_commands where device_id = any($1::uuid[])", [old])).toBe(0);
      expect(await count("public.scenario_actions where scenario_id = $1", [scenario.id])).toBe(0);
      expect(await count("public.realtime_events where device_id = any($1::uuid[])", [old])).toBe(0);
      expect(await count("public.controllers where hardware_uid = $1", [UID])).toBe(1);
    });
  });

  describe("factory reset", () => {
    it("removes the board and everything about it from the server", async () => {
      const [board] = await adminQuery<{ id: string }>("select id from public.controllers where hardware_uid = $1", [UID]);
      const devices = (await devicesOf("ownerB", homeB)).filter((device) => device.boardId === board.id).map((device) => device.id);
      await reportDeviceState(pool, devices[0], "power", true);
      const brokerSecret = "secret-of-the-board-in-home-b";
      await broker.setBoardSecret(board.id, brokerSecret);
      const client = await mqtt.connectAsync(brokerConfig.url, { username: board.id, password: brokerSecret, clientId: board.id, reconnectPeriod: 0 });
      // Its button is held for more than 20 s.
      await client.publishAsync(boardTopic(board.id, "reset"), "{}", { qos: 1 });

      expect(await until(async () => (await count("public.controllers where id = $1", [board.id])) === 0)).toBe(true);
      expect((await devicesOf("ownerB", homeB)).some((device) => device.boardId === board.id)).toBe(false);
      expect(await count("public.device_states where device_id = any($1::uuid[])", [devices])).toBe(0);
      expect(await count("public.board_setup_codes where controller_id = $1", [board.id])).toBe(0);
      // Only the registry row stays: the board can be paired again, with a new code.
      expect(await count("public.manufactured_boards where hardware_uid = $1", [UID])).toBe(1);
      await client.endAsync(true).catch(() => undefined);
      await expect(mqtt.connectAsync(brokerConfig.url, { username: board.id, password: brokerSecret, reconnectPeriod: 0 })).rejects.toThrow();
    });

    it("one board cannot reset another", async () => {
      const paired = await pairInto("ownerA", homeA);
      const stranger = "7e5f0001-0000-4000-8000-0000000000aa";
      await broker.setBoardSecret(stranger, "secret-of-a-stranger-board");
      const client = await mqtt.connectAsync(brokerConfig.url, { username: stranger, password: "secret-of-a-stranger-board", reconnectPeriod: 0 });
      await client.publishAsync(boardTopic(paired.boardId, "reset"), "{}", { qos: 1 });
      await wait(500);
      expect(await count("public.controllers where id = $1", [paired.boardId])).toBe(1);
      await client.endAsync();
      await broker.removeBoard(stranger);
    });
  });

  describe("hiding channels and removing the board in the app", () => {
    let paired: PairBoardResponse;

    beforeAll(async () => {
      // "one board cannot reset another" left the board paired with home A.
      const [board] = await adminQuery<{ id: string; name: string }>("select id, name from public.controllers where hardware_uid = $1", [UID]);
      paired = { boardId: board.id, boardName: board.name, devices: (await devicesOf("ownerA", homeA)).filter((device) => device.boardId === board.id) };
    });

    it("every device names its board", async () => {
      expect(paired.devices).toHaveLength(2);
      expect(paired.devices.every((device) => device.boardId === paired.boardId && device.boardName === "Pairing test switch" && device.hidden === false)).toBe(true);
    });

    it("an owner or admin hides a channel that is not wired, and shows it again", async () => {
      const url = `/v1/properties/${homeA.id}/devices/${paired.devices[1].id}`;
      expect((await call("memberA", "PATCH", url, { hidden: true })).status).toBe(403);
      expect((await call("ownerB", "PATCH", url, { hidden: true })).status).toBe(404);
      expect((await call("adminA", "PATCH", url, { hidden: true })).body).toMatchObject({ hidden: true, name: "Lamp 2" });
      expect((await devicesOf("memberA", homeA)).filter((device) => device.boardId === paired.boardId).map((device) => device.hidden)).toEqual([false, true]);
      expect((await call("ownerA", "PATCH", url, { hidden: false })).body).toMatchObject({ hidden: false });
    });

    it("only an owner or admin of the board's home can remove it", async () => {
      const url = `${boards(homeA)}/${paired.boardId}`;
      expect((await call("memberA", "DELETE", url)).status).toBe(403);
      expect((await call("ownerB", "DELETE", url)).status).toBe(404);
      expect((await call("ownerB", "DELETE", `${boards(homeB)}/${paired.boardId}`)).status).toBe(404);
      expect((await call(null, "DELETE", url)).status).toBe(401);
    });

    it("removing it deletes the board, its devices and its broker account, like a factory reset", async () => {
      const brokerSecret = "secret-before-removing";
      await broker.setBoardSecret(paired.boardId, brokerSecret);
      await reportDeviceState(pool, paired.devices[0].id, "power", true);
      const ids = paired.devices.map((device) => device.id);

      expect((await call("adminA", "DELETE", `${boards(homeA)}/${paired.boardId}`)).status).toBe(204);
      expect((await devicesOf("ownerA", homeA)).some((device) => device.boardId === paired.boardId)).toBe(false);
      expect(await count("public.controllers where id = $1", [paired.boardId])).toBe(0);
      expect(await count("public.device_states where device_id = any($1::uuid[])", [ids])).toBe(0);
      await expect(mqtt.connectAsync(brokerConfig.url, { username: paired.boardId, password: brokerSecret, reconnectPeriod: 0 })).rejects.toThrow();
      expect((await call("adminA", "DELETE", `${boards(homeA)}/${paired.boardId}`)).status).toBe(404);
      // The physical board can be paired again, with a new code.
      expect((await pairInto("ownerA", homeA)).brokerSecret).toEqual(expect.any(String));
    });
  });
});
