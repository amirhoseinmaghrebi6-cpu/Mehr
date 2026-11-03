/**
 * The API's connection to the MQTT broker the ESP32 boards connect to (there is no hub; see
 * docs/board-protocol.md).
 *
 * The API is the only client besides the boards. Every board logs in with its board id as the
 * username and the broker secret it got at pairing. The accounts live in the database
 * (broker/accounts.ts), where the broker checks them (mosquitto-go-auth): a board may use only its
 * own topics, and a board without an account can neither log in nor publish. The API logs in with
 * a service account, a superuser on the broker.
 */
import { randomUUID } from "node:crypto";
import { allBoardsTopic, boardTopic, parseBoardTopic, type BoardMessageKind, type ServerMessageKind } from "@m2smart/contracts";
import mqtt, { type MqttClient } from "mqtt";
import type { Pool } from "pg";
import { RecentCounter } from "../http/recent";
import { deleteBoardAccount, saveBoardAccount, saveServiceAccount } from "./accounts";

type Log = { info: (object: object, message: string) => void; error: (object: object, message: string) => void };

/**
 * Messages a board may send a second. A real board sends a few (a key press, a report); anyone who
 * pulled the secret out of their own board could otherwise flood the database through it.
 */
const BOARD_MESSAGES_PER_SECOND = 20;

/** Messages boards send; `cmd` and `update` only go the other way. */
export type InboundKind = Exclude<BoardMessageKind, ServerMessageKind>;
const INBOUND: InboundKind[] = ["ack", "state", "status", "reset"];

export type BrokerOptions = { url: string; username: string; password: string };

export type Broker = {
  /** Calls `handler` for every message of that kind from any board; the payload is unparsed JSON. */
  on(kind: InboundKind, handler: (boardId: string, payload: unknown) => void): void;
  /** Sends a message to one board. */
  publish(boardId: string, kind: BoardMessageKind, payload: object | null, options?: { retain?: boolean }): Promise<void>;
  /** Gives the board a (new) broker secret; any earlier one stops working and its connection is closed. */
  setBoardSecret(boardId: string, secret: string): Promise<void>;
  /** Removes the board's account, closes its connection and clears its retained status. */
  removeBoard(boardId: string): Promise<void>;
  close(): Promise<void>;
};

export async function connectBroker(options: BrokerOptions, log: Log, pool: Pool): Promise<Broker> {
  // The API's own login, from its configuration, before it logs in with it.
  await saveServiceAccount(pool, options.username, options.password);
  const client: MqttClient = await mqtt.connectAsync(options.url, {
    username: options.username,
    password: options.password,
    clientId: `m2-api-${randomUUID()}`,
    // Subscriptions are made again on every connect (below), so no session is kept.
    clean: true,
    reconnectPeriod: 2_000,
  });
  const handlers = new Map<InboundKind, Array<(boardId: string, payload: unknown) => void>>();
  const perBoard = new RecentCounter(1000, 200_000);

  client.on("error", (error) => log.error({ err: { message: error.message } }, "MQTT broker connection error"));
  client.on("message", (topic, message) => {
    const parsed = parseBoardTopic(topic);
    if (!parsed || parsed.kind === "cmd" || parsed.kind === "update") return;
    if (perBoard.count(parsed.boardId) >= BOARD_MESSAGES_PER_SECOND) return;
    perBoard.add(parsed.boardId);
    let payload: unknown;
    try {
      // An empty retained message is how a board's status is cleared.
      if (!message.length) return;
      payload = JSON.parse(message.toString());
    } catch {
      return; // Not JSON: ignored, like any message that does not fit the protocol.
    }
    for (const handler of handlers.get(parsed.kind) ?? []) handler(parsed.boardId, payload);
  });

  const subscribeAll = () => client.subscribeAsync(INBOUND.map((kind) => allBoardsTopic(kind)), { qos: 1 });
  await subscribeAll();
  // After a reconnect the broker has forgotten the subscriptions (clean session).
  client.on("connect", () => {
    void subscribeAll().catch((error: Error) => log.error({ err: { message: error.message } }, "MQTT subscribe failed"));
  });
  log.info({ url: options.url }, "Connected to the MQTT broker");

  /**
   * Cuts the board's live connection: a client that logs in with the same client id takes the
   * session over (MQTT), and the broker drops the board. The board then has to log in again, which
   * its old secret, or no account, no longer allows. The API's account may use any client id.
   */
  const disconnect = async (boardId: string) => {
    const takeover = await mqtt.connectAsync(options.url, { username: options.username, password: options.password, clientId: boardId, clean: true, reconnectPeriod: 0, connectTimeout: 5_000 });
    await takeover.endAsync();
  };

  return {
    on(kind, handler) {
      handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
    },
    async publish(boardId, kind, payload, publishOptions = {}) {
      await client.publishAsync(boardTopic(boardId, kind), payload === null ? "" : JSON.stringify(payload), { qos: 1, retain: publishOptions.retain ?? false });
    },
    async setBoardSecret(boardId, secret) {
      await saveBoardAccount(pool, boardId, secret);
      // A connection that still uses the old secret goes.
      await disconnect(boardId);
    },
    async removeBoard(boardId) {
      // Usually gone already: the account belongs to the board's row (on delete cascade).
      await deleteBoardAccount(pool, boardId);
      await disconnect(boardId);
      await client.publishAsync(boardTopic(boardId, "status"), "", { qos: 1, retain: true });
    },
    async close() {
      await client.endAsync();
    },
  };
}
