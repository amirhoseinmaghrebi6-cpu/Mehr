/**
 * A board under the test's control: a real broker client that follows docs/board-protocol.md
 * step by step, so a test decides exactly when the board acknowledges and what it reports.
 */
import { boardTopic, type BoardCommand } from "@m2smart/contracts";
import mqtt from "mqtt";
import type { Broker } from "../src/broker/broker";

export type TestBoard = {
  /** The next command the board received (waits up to 5 s). */
  nextCommand(): Promise<BoardCommand>;
  /** Commands received and not yet taken with nextCommand. */
  waiting(): number;
  ack(id: string, err?: string): Promise<void>;
  report(values: Array<{ ch: string; cap: string; val: boolean | number | string }>, id?: string): Promise<void>;
  /** Publishes on another board's topic (the broker must refuse it). */
  publishAs(otherBoardId: string, kind: "ack" | "state" | "status", payload: object): Promise<void>;
  /** Says goodbye: offline, then disconnects. */
  end(): Promise<void>;
};

export async function connectTestBoard(broker: Broker, brokerUrl: string, boardId: string): Promise<TestBoard> {
  const secret = `test-secret-${boardId}`;
  await broker.setBoardSecret(boardId, secret);
  const client = await mqtt.connectAsync(brokerUrl, {
    username: boardId,
    password: secret,
    clientId: boardId,
    reconnectPeriod: 0,
    will: { topic: boardTopic(boardId, "status"), payload: Buffer.from('{"online":false}'), qos: 1, retain: true },
  });
  const received: BoardCommand[] = [];
  client.on("message", (_topic, message) => received.push(JSON.parse(message.toString()) as BoardCommand));
  await client.subscribeAsync(boardTopic(boardId, "cmd"), { qos: 1 });
  const send = (id: string, kind: "ack" | "state" | "status", payload: object, retain = false) => client.publishAsync(boardTopic(id, kind), JSON.stringify(payload), { qos: 1, retain });
  await send(boardId, "status", { online: true, fw: "test" }, true);
  return {
    async nextCommand() {
      for (let i = 0; i < 100 && !received.length; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      const command = received.shift();
      if (!command) throw new Error("The board received no command");
      return command;
    },
    waiting: () => received.length,
    async ack(id, err) {
      await send(boardId, "ack", err ? { id, err } : { id });
    },
    async report(values, id) {
      await send(boardId, "state", id ? { id, values } : { values });
    },
    async publishAs(otherBoardId, kind, payload) {
      await send(otherBoardId, kind, payload);
    },
    async end() {
      await send(boardId, "status", { online: false }, true);
      await client.endAsync();
    },
  };
}
