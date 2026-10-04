/**
 * The boards' MQTT broker against the dev stack: every board has its own account and can use only
 * its own topics, in its own home or any other; the API learns from the broker when a board comes
 * online or drops off. Needs MQTT_URL, MQTT_USERNAME and MQTT_PASSWORD in backend/.env.local.
 */
import { boardTopic } from "@m2smart/contracts";
import mqtt, { type MqttClient } from "mqtt";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { followBoardStatus } from "../src/broker/board-status";
import { connectBroker, type Broker } from "../src/broker/broker";
import { loadConfig } from "../src/config";
import { loadBackendEnv } from "../src/env";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const USERS = ["7e5e0000-0000-4000-8000-000000000001", "7e5e0000-0000-4000-8000-000000000002"];
const MODEL = "test-broker-switch";
const silentLog = { info: () => undefined, error: () => undefined };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup(): Promise<void> {
  await adminQuery("delete from public.properties where created_by = any($1::uuid[])", [USERS]);
  await adminQuery("delete from public.hardware_models where code = $1", [MODEL]);
  await deleteUsers(USERS);
}

describe("boards on the MQTT broker", () => {
  loadBackendEnv();
  const config = loadConfig().broker!;
  let pool: Pool;
  let broker: Broker;
  let boardA: string;
  let boardB: string;
  const clients: MqttClient[] = [];

  /** Connects like a board would: username and client id are the board id, with a last will. */
  const connectBoard = async (boardId: string, secret: string) => {
    const client = await mqtt.connectAsync(config.url, {
      username: boardId,
      password: secret,
      clientId: boardId,
      reconnectPeriod: 0,
      will: { topic: boardTopic(boardId, "status"), payload: Buffer.from('{"online":false}'), qos: 1, retain: true },
    });
    clients.push(client);
    return client;
  };
  const online = async (boardId: string) => (await adminQuery<{ online: boolean }>("select online from public.controllers where id = $1", [boardId]))[0].online;
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 40; i++) {
      if (await check()) return true;
      await wait(100);
    }
    return false;
  };

  beforeAll(async () => {
    await cleanup();
    await adminQuery(`
      with model as (insert into public.hardware_models (code, name) values ('${MODEL}', 'Broker test switch') returning id),
      channel as (insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select id, 'ch1', 'switch', 'Lamp' from model returning model_id),
      button as (insert into public.hardware_model_pins (model_id, gpio, function, role) select id, 35, 'setup_button', 'setup' from model)
      insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, writable) select model_id, 'ch1', 'power', 'boolean', true from channel`);
    const boards: string[] = [];
    for (const [index, user] of USERS.entries()) {
      await adminQuery("insert into auth.users (id, email) values ($1, $2)", [user, `broker-test-${index}@test.local`]);
      const [home] = await adminQuery<{ id: string }>(
        "insert into public.properties (organization_id, name, created_by) select organization_id, $2, $1 from public.organization_members where user_id = $1 returning id",
        [user, `Broker home ${index}`],
      );
      const [hub] = await adminQuery<{ id: string }>("insert into public.hubs (property_id, name, hardware_id) values ($1, 'Cloud', $2) returning id", [home.id, `test-broker-${home.id}`]);
      const [board] = await adminQuery<{ id: string }>("select public.provision_controller($1, $2, $3, 'Board') as id", [hub.id, MODEL, `TEST-BROKER-${index}-${home.id.slice(0, 8)}`]);
      boards.push(board.id);
    }
    [boardA, boardB] = boards;
    pool = createApiPool();
    broker = await connectBroker(config, silentLog);
    followBoardStatus(broker, pool, silentLog);
    await broker.setBoardSecret(boardA, "secret-of-board-a");
    await broker.setBoardSecret(boardB, "secret-of-board-b");
  });

  afterAll(async () => {
    for (const client of clients) await client.endAsync(true).catch(() => undefined);
    await broker?.removeBoard(boardA).catch(() => undefined);
    await broker?.removeBoard(boardB).catch(() => undefined);
    await broker?.close();
    await pool?.end();
    await cleanup();
  });

  it("refuses a client without an account, and a board with the wrong secret", async () => {
    await expect(mqtt.connectAsync(config.url, { reconnectPeriod: 0 })).rejects.toThrow();
    await expect(mqtt.connectAsync(config.url, { username: boardA, password: "wrong", reconnectPeriod: 0 })).rejects.toThrow();
  });

  it("marks a board and its devices online when it connects and says so", async () => {
    const board = await connectBoard(boardA, "secret-of-board-a");
    await board.publishAsync(boardTopic(boardA, "status"), '{"online":true,"fw":"1.2.3"}', { qos: 1, retain: true });
    expect(await until(() => online(boardA))).toBe(true);
    const [row] = await adminQuery<{ firmware_version: string; devices_online: boolean }>(
      "select firmware_version, (select bool_and(online) from public.devices where controller_id = $1) as devices_online from public.controllers where id = $1",
      [boardA],
    );
    expect(row).toEqual({ firmware_version: "1.2.3", devices_online: true });
  });

  it("delivers a command only to the board it is for", async () => {
    const boardAClient = clients[0];
    const received: string[] = [];
    boardAClient.on("message", (topic) => received.push(topic));
    await boardAClient.subscribeAsync(boardTopic(boardA, "cmd"), { qos: 1 });
    // Board A also tries to listen to board B and to everything.
    await boardAClient.subscribeAsync([boardTopic(boardB, "cmd"), "m2/v1/boards/#", "#"], { qos: 1 }).catch(() => undefined);
    await broker.publish(boardB, "cmd", { id: "7e5e0001-0000-4000-8000-000000000001", ch: "ch1", cap: "power", val: true, ttl: 30 });
    await broker.publish(boardA, "cmd", { id: "7e5e0001-0000-4000-8000-000000000002", ch: "ch1", cap: "power", val: true, ttl: 30 });
    await until(async () => received.length > 0);
    await wait(300);
    expect(received).toEqual([boardTopic(boardA, "cmd")]);
  });

  it("ignores a board that reports for another board", async () => {
    const boardAClient = clients[0];
    await boardAClient.publishAsync(boardTopic(boardB, "status"), '{"online":true}', { qos: 1, retain: true });
    // And cannot send commands either.
    await boardAClient.publishAsync(boardTopic(boardB, "cmd"), '{"id":"7e5e0001-0000-4000-8000-000000000003","ch":"ch1","cap":"power","val":true,"ttl":30}', { qos: 1 });
    await wait(500);
    expect(await online(boardB)).toBe(false);
  });

  it("marks the board offline when its connection drops", async () => {
    // The connection dies without a goodbye: the broker publishes the board's last will.
    clients[0].stream.destroy();
    expect(await until(async () => !(await online(boardA)))).toBe(true);
    expect((await adminQuery<{ online: boolean }>("select bool_or(online) as online from public.devices where controller_id = $1", [boardA]))[0].online).toBe(false);
  });

  it("closes a board's connection when its secret is replaced, and the old secret stops working", async () => {
    const board = await connectBoard(boardB, "secret-of-board-b");
    const closed = new Promise<void>((resolve) => board.once("close", () => resolve()));
    await broker.setBoardSecret(boardB, "new-secret-of-board-b");
    await closed;
    await expect(mqtt.connectAsync(config.url, { username: boardB, password: "secret-of-board-b", reconnectPeriod: 0 })).rejects.toThrow();
    await (await connectBoard(boardB, "new-secret-of-board-b")).endAsync();
  });

  it("removes a board's account", async () => {
    await broker.removeBoard(boardB);
    await expect(mqtt.connectAsync(config.url, { username: boardB, password: "new-secret-of-board-b", reconnectPeriod: 0 })).rejects.toThrow();
  });
});
