/**
 * Removes board accounts from the dev broker that no board in the database owns: what an
 * interrupted bench/broker-scale.ts leaves behind.
 *
 *   pnpm --filter @m2smart/api exec tsx bench/broker-cleanup.ts
 *
 * Development only. Accounts of real boards (ids in public.controllers) are kept.
 */
import { Client } from "pg";
import mqtt from "mqtt";
import { connectBroker } from "../src/broker/broker";
import { loadConfig } from "../src/config";
import { loadBackendEnv } from "../src/env";

const CONTROL = "$CONTROL/dynamic-security/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function main() {
  loadBackendEnv();
  const config = loadConfig();
  if (!config.broker || !config.devRoutes) throw new Error("Development only.");
  // The broker's list of client names.
  const lister = await mqtt.connectAsync(config.broker.url, { username: config.broker.username, password: config.broker.password });
  await lister.subscribeAsync(`${CONTROL}/response`);
  const names = await new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No answer from the broker")), 30_000);
    lister.on("message", (_topic, message) => {
      const response = (JSON.parse(message.toString()) as { responses: Array<{ command: string; data?: { clients?: string[] } }> }).responses[0];
      if (response?.command === "listClients") {
        clearTimeout(timer);
        resolve(response.data?.clients ?? []);
      }
    });
    void lister.publishAsync(CONTROL, JSON.stringify({ commands: [{ command: "listClients", verbose: false, count: -1, offset: 0 }] }));
  });
  await lister.endAsync();

  const db = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await db.connect();
  const owned = new Set((await db.query<{ id: string }>("select id::text from public.controllers")).rows.map((row) => row.id));
  await db.end();
  const orphans = names.filter((name) => UUID.test(name) && !owned.has(name));
  console.log(`${names.length} accounts on the broker, ${orphans.length} without a board: removing them`);

  const broker = await connectBroker(config.broker, { info: () => undefined, error: () => undefined });
  const queue = [...orphans];
  let done = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let id = queue.pop(); id; id = queue.pop()) {
      await broker.removeBoard(id).catch(() => undefined);
      if (++done % 500 === 0) console.log(`${done} removed`);
    }
  }));
  await broker.close();
  console.log(`Done: ${done} removed`);
}

void main().then(() => process.exit(0), (error: Error) => {
  console.error(error.message);
  process.exit(1);
});
