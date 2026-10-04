/**
 * Pairing and factory reset against the dev database and broker: a board joins a home only with
 * its factory secret, a fresh pairing code, and an owner or admin uploading that code; a code
 * works once and for 24 hours; pairing with another home, a reset, or removing the board in the
 * app leaves nothing of the board behind in the old home. Unused channels can be hidden. A product
 * can also be added first, named, and paired later with a real board of the same product.
 */
import { boardTopic, formatPairingCode, type Device, type HardwareProductListResponse, type PairBoardResponse, type Property, type Scenario, type ScenarioRunResponse } from "@m2smart/contracts";
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
const UID = "TEST-PAIR-0001";
const FACTORY_SECRET = "factory-secret-of-test-pair-0001-abcdefghijklmnop";
const CODE_1 = "AAAAAAAAAAAAAAAAAAAAAAAAA2";
const CODE_2 = "BBBBBBBBBBBBBBBBBBBBBBBBB3";
const CODE_3 = "CCCCCCCCCCCCCCCCCCCCCCCCC4";

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
  await adminQuery("delete from public.manufactured_boards where hardware_uid = $1", [UID]);
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
  let boardInA: PairBoardResponse;

  const call = async (user: UserKey | null, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) => {
    const response = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };
  /** What the board itself does. */
  const announce = (code: string, secret = FACTORY_SECRET, uid = UID) => call(null, "POST", "/v1/boards/announce", { hardwareUid: uid, secret, codeHash: sha256(code) });
  const credentials = (code: string, secret = FACTORY_SECRET) => call(null, "POST", "/v1/boards/credentials", { hardwareUid: UID, secret, code });
  /** What the owner does with the QR code they saved. */
  const pair = (user: UserKey | null, home: Property, code: string, uid = UID) => call(user, "POST", `/v1/properties/${home.id}/boards`, { pairingCode: formatPairingCode(uid, code) });
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
      registry as (insert into public.manufactured_boards (hardware_uid, model_id, factory_secret_hash) select '${UID}', id, '${sha256(FACTORY_SECRET)}' from model)
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
    for (const board of await adminQuery<{ id: string }>("select id from public.controllers where hardware_uid = $1", [UID])) await broker?.removeBoard(board.id).catch(() => undefined);
    await broker?.close();
    await app?.close();
    await pool?.end();
    await cleanup();
  });

  describe("the board announces itself", () => {
    it("only a genuine board is accepted", async () => {
      expect((await announce(CODE_1, "not-the-factory-secret-of-this-board-xxxxxxxx")).status).toBe(401);
      expect((await announce(CODE_1, FACTORY_SECRET, "TEST-PAIR-9999")).status).toBe(401);
      expect((await call(null, "POST", "/v1/boards/announce", { hardwareUid: UID, secret: FACTORY_SECRET, codeHash: CODE_1 })).status).toBe(400);
      expect(await count("public.board_pairings where hardware_uid = $1", [UID])).toBe(0);
      expect((await announce(CODE_1)).status).toBe(204);
    });

    it("stores only the hash of the pairing code", async () => {
      const [row] = await adminQuery<{ code_hash: string }>("select code_hash from public.board_pairings where hardware_uid = $1", [UID]);
      expect(row.code_hash).toBe(sha256(CODE_1));
      expect(row.code_hash).not.toContain(CODE_1);
    });

    it("gets no account before someone uploads its code", async () => {
      expect(await credentials(CODE_1)).toEqual({ status: 202, body: { status: "waiting" } });
      expect((await credentials(CODE_2)).status).toBe(401);
      expect((await credentials(CODE_1, "not-the-factory-secret-of-this-board-xxxxxxxx")).status).toBe(401);
    });
  });

  describe("an owner or admin uploads the code", () => {
    it("is refused for members, strangers and signed-out visitors", async () => {
      expect((await pair("memberA", homeA, CODE_1)).status).toBe(403);
      expect((await pair("ownerB", homeA, CODE_1)).status).toBe(404); // not their home
      expect((await pair(null, homeA, CODE_1)).status).toBe(401);
      expect(await devicesOf("ownerA", homeA)).toEqual([]);
    });

    it("is refused for a wrong code, another board's id, or text that is not a pairing code", async () => {
      expect((await pair("ownerA", homeA, CODE_2)).status).toBe(404);
      expect((await pair("ownerA", homeA, CODE_1, "TEST-PAIR-9999")).status).toBe(404);
      expect((await call("ownerA", "POST", `/v1/properties/${homeA.id}/boards`, { pairingCode: "https://example.com/qr" })).status).toBe(400);
    });

    it("adds the board and all its channels to the home", async () => {
      const paired = await pair("adminA", homeA, CODE_1);
      expect(paired.status).toBe(201);
      boardInA = paired.body;
      expect(boardInA.devices.map((device) => [device.name, device.type, device.online])).toEqual([["Lamp 1", "switch", false], ["Lamp 2", "switch", false]]);
      expect((await devicesOf("memberA", homeA)).map((device) => device.id).sort()).toEqual(boardInA.devices.map((device) => device.id).sort());
      expect(await devicesOf("ownerB", homeB)).toEqual([]);
    });

    it("a pairing code works only once", async () => {
      expect((await pair("ownerA", homeA, CODE_1)).status).toBe(404);
      expect((await pair("ownerB", homeB, CODE_1)).status).toBe(404);
    });

    it("lets the owner name the channels and put them in rooms", async () => {
      const room = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "Hall" })).body;
      const renamed = await call("ownerA", "PATCH", `/v1/properties/${homeA.id}/devices/${boardInA.devices[0].id}`, { name: "Hall light", roomId: room.id });
      expect(renamed.body).toMatchObject({ name: "Hall light", roomId: room.id });
    });
  });

  describe("the board gets its broker account", () => {
    it("with its factory secret and the same code, and comes online", async () => {
      const first = await credentials(CODE_1);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ status: "paired", boardId: boardInA.boardId, brokerSecret: expect.any(String) });

      const client = await mqtt.connectAsync(brokerConfig.url, { username: first.body.boardId, password: first.body.brokerSecret, clientId: first.body.boardId, reconnectPeriod: 0 });
      await client.publishAsync(boardTopic(first.body.boardId, "status"), '{"online":true,"fw":"1.0.0"}', { qos: 1, retain: true });
      expect(await until(async () => (await devicesOf("ownerA", homeA)).every((device) => device.online))).toBe(true);
      await client.endAsync();
    });

    it("asking again (the answer was lost) gives a new secret and ends the old one", async () => {
      const first = (await credentials(CODE_1)).body;
      const second = (await credentials(CODE_1)).body;
      expect(second.brokerSecret).not.toBe(first.brokerSecret);
      await expect(mqtt.connectAsync(brokerConfig.url, { username: first.boardId, password: first.brokerSecret, reconnectPeriod: 0 })).rejects.toThrow();
      await (await mqtt.connectAsync(brokerConfig.url, { username: second.boardId, password: second.brokerSecret, reconnectPeriod: 0 })).endAsync();
    });
  });

  describe("pairing the board with another home", () => {
    let oldSecret: string;
    let scenario: Scenario;

    beforeAll(async () => {
      oldSecret = (await credentials(CODE_1)).body.brokerSecret;
      // Home A has used the board: a state, a command and a scenario action.
      await reportDeviceState(pool, boardInA.devices[0].id, "power", true);
      await call("ownerA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: boardInA.devices[0].id, capability: "power", targetValue: false, idempotencyKey: `pair-test-${Date.now()}` });
      scenario = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/scenarios`, { kind: "themed", name: "Lamps", actions: [{ deviceId: boardInA.devices[0].id, capability: "power", targetValue: true }] })).body;
    });

    it("needs a fresh code: pairing mode again replaces the old one", async () => {
      expect((await announce(CODE_2)).status).toBe(204);
      expect((await credentials(CODE_1)).status).toBe(401);
      expect((await pair("ownerB", homeB, CODE_1)).status).toBe(404);
    });

    it("moves the board and leaves nothing of it in the old home", async () => {
      const paired = await pair("ownerB", homeB, CODE_2);
      expect(paired.status).toBe(201);
      expect((await devicesOf("ownerB", homeB)).map((device) => device.name)).toEqual(["Lamp 1", "Lamp 2"]); // default names again
      expect(await devicesOf("ownerA", homeA)).toEqual([]);

      const old = boardInA.devices.map((device) => device.id);
      expect(await count("public.controllers where id = $1", [boardInA.boardId])).toBe(0);
      expect(await count("public.device_states where device_id = any($1::uuid[])", [old])).toBe(0);
      expect(await count("public.device_commands where device_id = any($1::uuid[])", [old])).toBe(0);
      expect(await count("public.scenario_actions where scenario_id = $1", [scenario.id])).toBe(0);
      expect(await count("public.realtime_events where device_id = any($1::uuid[])", [old])).toBe(0);
      // The old home's broker secret is dead.
      await expect(mqtt.connectAsync(brokerConfig.url, { username: boardInA.boardId, password: oldSecret, reconnectPeriod: 0 })).rejects.toThrow();
    });
  });

  describe("a pairing code expires", () => {
    it("after 24 hours it is refused and deleted", async () => {
      await announce(CODE_3);
      await adminQuery("update public.board_pairings set expires_at = now() - interval '1 minute' where hardware_uid = $1", [UID]);
      expect((await pair("ownerA", homeA, CODE_3)).status).toBe(404);
      expect((await credentials(CODE_3)).status).toBe(401);
      await cleanUp(pool);
      expect(await count("public.board_pairings where hardware_uid = $1", [UID])).toBe(0);
    });
  });

  describe("factory reset", () => {
    it("removes the board and everything about it from the server", async () => {
      const [board] = await adminQuery<{ id: string }>("select id from public.controllers where hardware_uid = $1", [UID]);
      const devices = (await devicesOf("ownerB", homeB)).map((device) => device.id);
      await reportDeviceState(pool, devices[0], "power", true);
      // The board is paired with home B and online; then its button is held for more than 20 s.
      await announce(CODE_3);
      await adminQuery("update public.board_pairings set controller_id = $2 where hardware_uid = $1", [UID, board.id]);
      const { brokerSecret } = (await credentials(CODE_3)).body;
      const client = await mqtt.connectAsync(brokerConfig.url, { username: board.id, password: brokerSecret, clientId: board.id, reconnectPeriod: 0 });
      await client.publishAsync(boardTopic(board.id, "reset"), "{}", { qos: 1 });

      expect(await until(async () => (await count("public.controllers where id = $1", [board.id])) === 0)).toBe(true);
      expect(await devicesOf("ownerB", homeB)).toEqual([]);
      expect(await count("public.device_states where device_id = any($1::uuid[])", [devices])).toBe(0);
      expect(await count("public.board_pairings where hardware_uid = $1", [UID])).toBe(0);
      // Only the registry row stays: the board can be paired again, with a new code.
      expect(await count("public.manufactured_boards where hardware_uid = $1", [UID])).toBe(1);
      await client.endAsync(true).catch(() => undefined);
      await expect(mqtt.connectAsync(brokerConfig.url, { username: board.id, password: brokerSecret, reconnectPeriod: 0 })).rejects.toThrow();
    });

    it("one board cannot reset another", async () => {
      await announce(CODE_1);
      const paired = (await pair("ownerA", homeA, CODE_1)).body as PairBoardResponse;
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
      paired = { boardId: board.id, boardName: board.name, devices: await devicesOf("ownerA", homeA) };
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
      expect((await devicesOf("memberA", homeA)).map((device) => device.hidden)).toEqual([false, true]);
      expect((await call("ownerA", "PATCH", url, { hidden: false })).body).toMatchObject({ hidden: false });
    });

    it("only an owner or admin of the board's home can remove it", async () => {
      const url = `/v1/properties/${homeA.id}/boards/${paired.boardId}`;
      expect((await call("memberA", "DELETE", url)).status).toBe(403);
      expect((await call("ownerB", "DELETE", url)).status).toBe(404);
      expect((await call("ownerB", "DELETE", `/v1/properties/${homeB.id}/boards/${paired.boardId}`)).status).toBe(404);
      expect((await call(null, "DELETE", url)).status).toBe(401);
      expect(await devicesOf("ownerA", homeA)).toHaveLength(2);
    });

    it("removing it deletes the board, its devices and its broker account, like a factory reset", async () => {
      const { brokerSecret } = (await credentials(CODE_1)).body;
      await reportDeviceState(pool, paired.devices[0].id, "power", true);
      const ids = paired.devices.map((device) => device.id);

      expect((await call("adminA", "DELETE", `/v1/properties/${homeA.id}/boards/${paired.boardId}`)).status).toBe(204);
      expect(await devicesOf("ownerA", homeA)).toEqual([]);
      expect(await count("public.controllers where id = $1", [paired.boardId])).toBe(0);
      expect(await count("public.device_states where device_id = any($1::uuid[])", [ids])).toBe(0);
      expect(await count("public.board_pairings where hardware_uid = $1", [UID])).toBe(0);
      await expect(mqtt.connectAsync(brokerConfig.url, { username: paired.boardId, password: brokerSecret, reconnectPeriod: 0 })).rejects.toThrow();
      expect((await call("adminA", "DELETE", `/v1/properties/${homeA.id}/boards/${paired.boardId}`)).status).toBe(404);
      // The physical board can be paired again, with a new code.
      expect((await announce(CODE_2)).status).toBe(204);
      expect((await pair("ownerA", homeA, CODE_2)).status).toBe(201);
    });
  });

  describe("adding a product first, pairing it later", () => {
    const boards = (home: Property) => `/v1/properties/${home.id}/boards`;
    let hall: { id: string };
    let waiting: PairBoardResponse;
    let waitingDimmer: PairBoardResponse;

    beforeAll(async () => {
      hall = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/rooms`, { name: "Waiting hall" })).body;
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
      // A room of another home is refused, and nothing is added.
      const before = (await devicesOf("ownerA", homeA)).length;
      expect((await call("ownerB", "POST", boards(homeB), body)).status).toBe(400);
      expect((await devicesOf("ownerB", homeB)).length).toBe(0);
      expect((await devicesOf("ownerA", homeA)).length).toBe(before);
    });

    it("the product's channels join the home, named and placed, waiting for pairing", async () => {
      const added = await call("adminA", "POST", boards(homeA), { modelCode: MODEL, channels: [{ key: "ch1", name: "Ceiling", roomId: hall.id }, { key: "ch2", name: "Wall", roomId: null }] });
      expect(added.status).toBe(201);
      waiting = added.body;
      expect(waiting.devices.map((device) => [device.name, device.roomId, device.pending, device.online])).toEqual([["Ceiling", hall.id, true, false], ["Wall", null, true, false]]);
      waitingDimmer = (await call("ownerA", "POST", boards(homeA), { modelCode: OTHER_MODEL })).body;
      expect(waitingDimmer.devices.map((device) => [device.name, device.pending])).toEqual([["Dimmer", true]]);
    });

    it("a waiting device cannot be commanded, and scenarios skip it until it is paired", async () => {
      const ceiling = waiting.devices[0];
      const command = await call("ownerA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: ceiling.id, capability: "power", targetValue: true, idempotencyKey: `waiting-${Date.now()}` });
      expect([command.status, command.body]).toEqual([409, { error: "conflict" }]);
      const scenario = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/scenarios`, { kind: "themed", name: "Prepared", actions: [{ deviceId: ceiling.id, capability: "power", targetValue: true }] })).body as Scenario;
      expect(scenario.actions).toHaveLength(1);
      const run = (await call("ownerA", "POST", `/v1/properties/${homeA.id}/scenarios/${scenario.id}/run`)).body as ScenarioRunResponse;
      expect(run.commandIds).toEqual([]);
    });

    it("pairs only with a real board of the same product", async () => {
      expect((await announce(CODE_3)).status).toBe(204);
      const pairWith = (user: UserKey, home: Property, boardId: string, code = CODE_3) => call(user, "POST", `${boards(home)}/${boardId}/pair`, { pairingCode: formatPairingCode(UID, code) });
      expect((await pairWith("ownerA", homeA, waitingDimmer.boardId)).status).toBe(409); // the real board is the switch
      expect((await pairWith("memberA", homeA, waiting.boardId)).status).toBe(403);
      expect((await pairWith("ownerB", homeB, waiting.boardId)).status).toBe(404); // not waiting in home B
      expect((await pairWith("ownerA", homeA, waiting.boardId, CODE_1)).status).toBe(404); // not the board's current code
      expect((await devicesOf("ownerA", homeA)).filter((device) => device.boardId === waiting.boardId).every((device) => device.pending)).toBe(true);

      const paired = await pairWith("ownerA", homeA, waiting.boardId);
      expect(paired.status).toBe(200);
      // The names and rooms chosen before stay; the devices are real now.
      expect((paired.body as PairBoardResponse).devices.map((device) => [device.name, device.roomId, device.pending])).toEqual([["Ceiling", hall.id, false], ["Wall", null, false]]);
      // The board is in one home at most: where it was before (an earlier test), it is gone.
      expect(await count("public.controllers where hardware_uid = $1", [UID])).toBe(1);
      expect((await pairWith("ownerA", homeA, waiting.boardId)).status).toBe(404); // the code is used, the board no longer waits
    });

    it("the real board then gets its account under the waiting board's id, and commands and scenarios work", async () => {
      const account = (await credentials(CODE_3)).body;
      expect(account).toMatchObject({ status: "paired", boardId: waiting.boardId });
      const command = await call("ownerA", "POST", `/v1/properties/${homeA.id}/commands`, { deviceId: waiting.devices[0].id, capability: "power", targetValue: true, idempotencyKey: `paired-${Date.now()}` });
      expect(command.status).toBe(201);
      const prepared = ((await call("ownerA", "GET", `/v1/properties/${homeA.id}/scenarios`)).body.scenarios as Scenario[]).find((scenario) => scenario.name === "Prepared")!;
      expect(((await call("ownerA", "POST", `/v1/properties/${homeA.id}/scenarios/${prepared.id}/run`)).body as ScenarioRunResponse).commandIds).toHaveLength(1);
    });

    it("a board that never gets paired can simply be removed", async () => {
      expect((await call("ownerA", "DELETE", `${boards(homeA)}/${waitingDimmer.boardId}`)).status).toBe(204);
      expect((await devicesOf("ownerA", homeA)).some((device) => device.boardId === waitingDimmer.boardId)).toBe(false);
    });
  });
});
