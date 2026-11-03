/**
 * How the boards' broker scales with the number of board accounts (docs/audit/2026-11-security.md,
 * B3). Mosquitto's dynamic security plugin keeps every account and role in one JSON file and
 * writes all of it after each change, so pairing should slow down as boards add up. This measures
 * it on the dev broker:
 *
 *   pnpm --filter @m2smart/api exec tsx bench/broker-scale.ts [max boards] [connect]
 *
 * It adds bench accounts in steps (default up to 20 000), and at each step times 30 pairings one
 * after another (what a user waiting in the app feels) and reads the file's size. Then it connects
 * `connect` of them at once (default 2 000) and has each send one report. It removes every bench
 * account at the end, also after a failure. Development only: never against a production broker.
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { boardTopic } from "@m2smart/contracts";
import mqtt from "mqtt";
import { connectBroker, type Broker } from "../src/broker/broker";
import { loadConfig } from "../src/config";
import { loadBackendEnv } from "../src/env";

const MAX = Number(process.argv[2] ?? 20_000);
const CONNECT = Number(process.argv[3] ?? 2_000);
const STEPS = [1_000, 5_000, 10_000, 20_000, 50_000].filter((step) => step <= MAX);
const PARALLEL = 16;
const log = { info: () => undefined, error: (object: object, message: string) => console.error(message, object) };

const fileSize = () => {
  try {
    return Number(execFileSync("docker", ["exec", "m2smart-dev-mosquitto-1", "stat", "-c", "%s", "/mosquitto/data/dynamic-security.json"]).toString().trim());
  } catch {
    return NaN;
  }
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function main() {
  loadBackendEnv();
  const config = loadConfig();
  if (!config.broker || !config.devRoutes) throw new Error("Needs the dev stack: MQTT_URL in backend/.env.local and NODE_ENV=development.");
  const broker: Broker = await connectBroker(config.broker, log);
  const boards: Array<{ id: string; secret: string }> = [];
  const add = async (count: number) => {
    const queue = Array.from({ length: count }, () => ({ id: randomUUID(), secret: randomBytes(32).toString("base64url") }));
    const started = Date.now();
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      for (let board = queue.pop(); board; board = queue.pop()) {
        await broker.setBoardSecret(board.id, board.secret);
        boards.push(board);
      }
    }));
    return (Date.now() - started) / count;
  };

  try {
    console.log(`Board accounts | bulk add (ms per board, ${PARALLEL} at once) | one pairing alone: median / p95 / max (ms) | dynamic-security.json`);
    for (const step of STEPS) {
      const bulk = await add(step - boards.length - 30);
      const alone: number[] = [];
      for (let i = 0; i < 30; i++) {
        const board = { id: randomUUID(), secret: randomBytes(32).toString("base64url") };
        const started = performance.now();
        await broker.setBoardSecret(board.id, board.secret);
        alone.push(performance.now() - started);
        boards.push(board);
      }
      alone.sort((a, b) => a - b);
      console.log(`${step} | ${bulk.toFixed(1)} | ${percentile(alone, 50).toFixed(0)} / ${percentile(alone, 95).toFixed(0)} / ${alone[alone.length - 1].toFixed(0)} | ${mb(fileSize())}`);
    }

    // Many boards coming back at once (power returns to a district): connect, then one report each.
    const url = config.broker.url;
    const sample = boards.slice(0, Math.min(CONNECT, boards.length));
    const connectStarted = Date.now();
    const clients = await Promise.all(sample.map((board) => mqtt.connectAsync(url, { username: board.id, password: board.secret, clientId: board.id, reconnectPeriod: 0, connectTimeout: 60_000 }).catch(() => null)));
    const connected = clients.filter((client) => client !== null);
    const connectSeconds = (Date.now() - connectStarted) / 1000;
    const publishStarted = Date.now();
    await Promise.all(connected.map((client, index) => client.publishAsync(boardTopic(sample[index].id, "status"), JSON.stringify({ online: true, fw: "bench" }), { qos: 1 }).catch(() => undefined)));
    const publishSeconds = (Date.now() - publishStarted) / 1000;
    console.log(`Connect ${sample.length} boards at once: ${connected.length} connected in ${connectSeconds.toFixed(1)} s; one report each in ${publishSeconds.toFixed(1)} s`);
    await Promise.all(connected.map((client) => client.endAsync(true).catch(() => undefined)));
  } finally {
    const started = Date.now();
    const queue = [...boards];
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      for (let board = queue.pop(); board; board = queue.pop()) await broker.removeBoard(board.id).catch(() => undefined);
    }));
    console.log(`Removed ${boards.length} bench accounts in ${((Date.now() - started) / 1000).toFixed(0)} s; file now ${mb(fileSize())}`);
    await broker.close();
  }
}

void main().then(() => process.exit(0), (error: Error) => {
  console.error(error.message);
  process.exit(1);
});
