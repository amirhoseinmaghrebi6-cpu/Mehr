/**
 * How the boards' broker scales with the number of board accounts (docs/audit/2026-11-security.md,
 * B3), on the dev stack:
 *
 *   pnpm --filter @m2smart/api exec tsx bench/broker-scale.ts [max boards] [connect]
 *
 * It adds bench boards in steps (default up to 50 000; accounts written in bulk), and at each step
 * times 30 pairings one after another through the API's broker code, which is what a user waiting
 * in the app feels. Then it connects `connect` of them at once (default 2 000) and has each send one
 * report. Everything it made is removed at the end, also after a failure: the bench home, and with
 * it the boards and their accounts. Development only.
 */
import { randomBytes } from "node:crypto";
import { boardTopic } from "@m2smart/contracts";
import mqtt from "mqtt";
import { Client, Pool } from "pg";
import { brokerPasswordHash } from "../src/broker/accounts";
import { connectBroker } from "../src/broker/broker";
import { loadConfig } from "../src/config";
import { loadBackendEnv } from "../src/env";

const MAX = Number(process.argv[2] ?? 50_000);
const CONNECT = Number(process.argv[3] ?? 2_000);
const STEPS = [1_000, 10_000, 50_000, 100_000].filter((step) => step <= MAX);
const BENCH_USER = "7e5f0000-0000-4000-8000-0000000000be";
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function main() {
  loadBackendEnv();
  const config = loadConfig();
  if (!config.broker || !config.devRoutes) throw new Error("Needs the dev stack: MQTT_URL in backend/.env.local and NODE_ENV=development.");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 4 });
  const removeBench = () => admin.query("delete from public.properties where created_by = $1", [BENCH_USER]).then(() => admin.query("delete from auth.users where id = $1", [BENCH_USER]));
  await removeBench();
  await admin.query("insert into auth.users (id, email) values ($1, 'broker-bench@test.local')", [BENCH_USER]);
  const [{ hub }] = (await admin.query<{ hub: string }>(
    `with home as (insert into public.properties (organization_id, name, created_by)
       select organization_id, 'Broker bench', $1 from public.organization_members where user_id = $1 returning id),
     member as (insert into public.property_members (property_id, user_id, role) select id, $1, 'owner' from home)
     insert into public.hubs (property_id, name, hardware_id) select id, 'Cloud', 'bench-' || id from home returning id as hub`,
    [BENCH_USER],
  )).rows;
  const broker = await connectBroker(config.broker, { info: () => undefined, error: () => undefined }, pool);
  const secrets = new Map<string, string>();
  try {
    console.log("Board accounts | one pairing alone: median / p95 / max (ms)");
    let made = 0;
    for (const step of STEPS) {
      // Boards and accounts in bulk, straight into the database.
      const { rows } = await admin.query<{ id: string }>(
        "select public.provision_controller($1, 'm2-t1-rev-a', 'BENCH-' || n, 'Bench') as id from generate_series($2::int, $3::int) as n",
        [hub, made, step - 31],
      );
      made = step - 30;
      for (let start = 0; start < rows.length; start += 1_000) {
        const batch = rows.slice(start, start + 1_000).map((row) => {
          const secret = randomBytes(32).toString("base64url");
          secrets.set(row.id, secret);
          return [row.id, brokerPasswordHash(secret)];
        });
        await admin.query(
          `insert into broker.board_accounts (board_id, password_hash) select * from unnest($1::uuid[], $2::text[])`,
          [batch.map((entry) => entry[0]), batch.map((entry) => entry[1])],
        );
      }
      // 30 pairings one after another, as the API does them.
      const fresh = (await admin.query<{ id: string }>(
        "select public.provision_controller($1, 'm2-t1-rev-a', 'BENCH-' || n, 'Bench') as id from generate_series($2::int, $3::int) as n",
        [hub, made, step - 1],
      )).rows;
      made = step;
      const alone: number[] = [];
      for (const { id } of fresh) {
        const secret = randomBytes(32).toString("base64url");
        const started = performance.now();
        await broker.setBoardSecret(id, secret);
        alone.push(performance.now() - started);
        secrets.set(id, secret);
      }
      alone.sort((a, b) => a - b);
      console.log(`${step} | ${percentile(alone, 50).toFixed(0)} / ${percentile(alone, 95).toFixed(0)} / ${alone[alone.length - 1].toFixed(0)}`);
    }

    // Many boards coming back at once (power returns to a district): connect, then one report each.
    const sample = [...secrets].slice(0, CONNECT);
    const connectStarted = Date.now();
    const clients = await Promise.all(sample.map(([id, secret]) => mqtt.connectAsync(config.broker!.url, { username: id, password: secret, clientId: id, reconnectPeriod: 0, connectTimeout: 120_000 }).catch(() => null)));
    const connected = clients.filter((client) => client !== null);
    const connectSeconds = (Date.now() - connectStarted) / 1000;
    const publishStarted = Date.now();
    await Promise.all(connected.map((client, index) => client.publishAsync(boardTopic(sample[index][0], "status"), JSON.stringify({ online: true, fw: "bench" }), { qos: 1 }).catch(() => undefined)));
    const publishSeconds = (Date.now() - publishStarted) / 1000;
    console.log(`Connect ${sample.length} boards at once: ${connected.length} connected in ${connectSeconds.toFixed(1)} s; one report each in ${publishSeconds.toFixed(1)} s`);
    await Promise.all(connected.map((client) => client.endAsync(true).catch(() => undefined)));
  } finally {
    const started = Date.now();
    await removeBench();
    console.log(`Removed the bench home, ${secrets.size} boards and their accounts in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    await broker.close();
    await pool.end();
    await admin.end();
  }
}

void main().then(() => process.exit(0), (error: Error) => {
  console.error(error.message);
  process.exit(1);
});
