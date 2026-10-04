/**
 * The API's connection to the MQTT broker the ESP32 boards connect to (there is no hub; see
 * docs/board-protocol.md).
 *
 * The API is the only client besides the boards. It also manages the boards' broker accounts
 * through Mosquitto's dynamic security plugin: every board logs in with its board id as the
 * username and has its own role that names exactly its own topics (Mosquitto 2.0 has no
 * per-username patterns for publishing). The broker keeps the accounts; the database stores no
 * broker secret.
 */
import { randomUUID } from "node:crypto";
import { allBoardsTopic, boardTopic, parseBoardTopic, type BoardMessageKind } from "@m2smart/contracts";
import mqtt, { type MqttClient } from "mqtt";

type Log = { info: (object: object, message: string) => void; error: (object: object, message: string) => void };

const CONTROL = "$CONTROL/dynamic-security/v1";
const boardRole = (boardId: string) => `m2-board-${boardId}`;
const API_ROLE = "m2-api-bridge";
const CONTROL_TIMEOUT_MS = 5_000;

/** Messages boards send; `cmd` only goes the other way. */
export type InboundKind = Exclude<BoardMessageKind, "cmd">;
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

type ControlCommand = { command: string } & Record<string, unknown>;

export async function connectBroker(options: BrokerOptions, log: Log): Promise<Broker> {
  const client: MqttClient = await mqtt.connectAsync(options.url, {
    username: options.username,
    password: options.password,
    clientId: `m2-api-${randomUUID()}`,
    // Subscriptions are made again on every connect (below), so no session is kept.
    clean: true,
    reconnectPeriod: 2_000,
  });
  const handlers = new Map<InboundKind, Array<(boardId: string, payload: unknown) => void>>();
  const waiting = new Map<string, { resolve: () => void; reject: (error: Error) => void; ignore: RegExp | null }>();

  client.on("error", (error) => log.error({ err: { message: error.message } }, "MQTT broker connection error"));
  client.on("message", (topic, message) => {
    if (topic === `${CONTROL}/response`) return onControlResponse(message.toString());
    const parsed = parseBoardTopic(topic);
    if (!parsed || parsed.kind === "cmd") return;
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

  function onControlResponse(text: string): void {
    let responses: Array<{ command?: string; error?: string; correlationData?: string }> = [];
    try {
      responses = (JSON.parse(text) as { responses?: typeof responses }).responses ?? [];
    } catch {
      return;
    }
    for (const response of responses) {
      const entry = response.correlationData ? waiting.get(response.correlationData) : undefined;
      if (!entry) continue;
      waiting.delete(response.correlationData!);
      if (response.error && !entry.ignore?.test(response.error)) entry.reject(new Error(`Broker refused ${response.command}: ${response.error}`));
      else entry.resolve();
    }
  }

  /** Runs one dynamic-security command; errors matching `ignore` (e.g. "already exists") count as success. */
  function control(command: ControlCommand, ignore: RegExp | null = null): Promise<void> {
    const correlationData = randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(correlationData);
        reject(new Error(`Broker did not answer ${command.command}`));
      }, CONTROL_TIMEOUT_MS);
      waiting.set(correlationData, {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (error) => (clearTimeout(timer), reject(error)),
        ignore,
      });
      client.publish(CONTROL, JSON.stringify({ commands: [{ ...command, correlationData }] }), { qos: 1 }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        waiting.delete(correlationData);
        reject(error);
      });
    });
  }

  const subscribeAll = () => client.subscribeAsync(INBOUND.map((kind) => allBoardsTopic(kind)), { qos: 1 });

  await client.subscribeAsync(`${CONTROL}/response`, { qos: 1 });
  const exists = /already exists|already in/i;
  // The API reads every board's messages and sends commands.
  await control({ command: "createRole", rolename: API_ROLE }, exists);
  await control({
    command: "modifyRole",
    rolename: API_ROLE,
    acls: [
      { acltype: "publishClientSend", topic: "m2/v1/boards/#", allow: true },
      { acltype: "subscribePattern", topic: "m2/v1/boards/#", allow: true },
    ],
  });
  // The first time, the broker closes the connection of a client whose roles change (ours), so the
  // answer may never arrive: then the reconnect is the sign that it worked.
  await Promise.race([
    control({ command: "addClientRole", username: options.username, rolename: API_ROLE }, exists).catch(() => undefined),
    new Promise<void>((resolve) => client.once("connect", () => resolve())),
  ]);
  await client.subscribeAsync(`${CONTROL}/response`, { qos: 1 });
  await subscribeAll();
  // After a reconnect the broker has forgotten the subscriptions (clean session).
  client.on("connect", () => {
    void client.subscribeAsync(`${CONTROL}/response`, { qos: 1 }).then(subscribeAll).catch((error: Error) => log.error({ err: { message: error.message } }, "MQTT subscribe failed"));
  });
  log.info({ url: options.url }, "Connected to the MQTT broker");

  const notFound = /not found/i;
  return {
    on(kind, handler) {
      handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
    },
    async publish(boardId, kind, payload, publishOptions = {}) {
      await client.publishAsync(boardTopic(boardId, kind), payload === null ? "" : JSON.stringify(payload), { qos: 1, retain: publishOptions.retain ?? false });
    },
    async setBoardSecret(boardId, secret) {
      // Deleting first closes a connection that still uses the old secret.
      await control({ command: "deleteClient", username: boardId }, notFound);
      await control({ command: "deleteRole", rolename: boardRole(boardId) }, notFound);
      // The board may send on its own four topics and receive only its own commands.
      await control({
        command: "createRole",
        rolename: boardRole(boardId),
        acls: [
          ...INBOUND.map((kind) => ({ acltype: "publishClientSend", topic: boardTopic(boardId, kind), allow: true })),
          { acltype: "subscribeLiteral", topic: boardTopic(boardId, "cmd"), allow: true },
        ],
      });
      await control({ command: "createClient", username: boardId, password: secret, roles: [{ rolename: boardRole(boardId) }] });
    },
    async removeBoard(boardId) {
      await control({ command: "deleteClient", username: boardId }, notFound);
      await control({ command: "deleteRole", rolename: boardRole(boardId) }, notFound);
      await client.publishAsync(boardTopic(boardId, "status"), "", { qos: 1, retain: true });
    },
    async close() {
      for (const entry of waiting.values()) entry.reject(new Error("Broker connection closed"));
      waiting.clear();
      await client.endAsync();
    },
  };
}
