/**
 * Test accounts for the API load test (bench/api-load.js), on the dev stack only:
 *
 *   pnpm --filter @m2smart/api exec tsx bench/api-users.ts create [count]   (default 40)
 *   pnpm --filter @m2smart/api exec tsx bench/api-users.ts remove
 *
 * Each account gets a real Kratos session token (password sign-in through Kratos's API flow; the
 * identity is made with Kratos's admin API, which skips the SMS sign-up), a home made through the
 * API, and one paired two-gang switch whose hardware id starts with "DEV-", so the dev board
 * simulator answers its commands like a real board. The tokens and ids go to a file in the system
 * temp folder, which bench/api-load.js reads. Numbers are +98912990xxxx; "remove" deletes them all.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { loadBackendEnv } from "../src/env";

export const USERS_FILE = join(tmpdir(), "m2smart-bench-users.json");
const PREFIX = "+98912990";
const API = "http://127.0.0.1:4000";
const KRATOS = "http://127.0.0.1:4433";
const KRATOS_ADMIN = "http://127.0.0.1:4434";

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`${what}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return (await response.json()) as T;
}

async function admin(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  return client;
}

async function create(count: number) {
  const password = `Bench-${randomBytes(9).toString("base64url")}`;
  const db = await admin();
  const users = [];
  try {
    for (let i = 0; i < count; i++) {
      const phone = `${PREFIX}${String(i).padStart(4, "0")}`;
      await json(
        await fetch(`${KRATOS_ADMIN}/admin/identities`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schema_id: "m2smart", traits: { phone, name: `Bench ${i}` }, credentials: { password: { config: { password } } } }),
        }),
        "create identity",
      );
      const flow = await json<{ id: string }>(await fetch(`${KRATOS}/self-service/login/api`), "login flow");
      const login = await json<{ session_token: string }>(
        await fetch(`${KRATOS}/self-service/login?flow=${flow.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "password", identifier: phone, password }) }),
        "sign in",
      );
      const auth = { authorization: `Bearer ${login.session_token}`, "content-type": "application/json" };
      await json(await fetch(`${API}/v1/me`, { headers: auth }), "me");
      const home = await json<{ id: string }>(await fetch(`${API}/v1/properties`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Bench home ${i}` }) }), "home");
      // A paired board the simulator plays (DEV- hardware id).
      const hub = await db.query<{ id: string }>("insert into public.hubs (property_id, name, hardware_id, status) values ($1, 'Cloud', $2, 'online') returning id", [home.id, `cloud-${home.id}`]);
      await db.query("select public.provision_controller($1, 'm2-t2-rev-a', $2, 'Bench board')", [hub.rows[0].id, `DEV-BENCH-${i}-${randomBytes(3).toString("hex")}`]);
      const devices = await db.query<{ id: string }>("select id from public.devices where property_id = $1 order by channel_key", [home.id]);
      users.push({ token: login.session_token, propertyId: home.id, deviceIds: devices.rows.map((row) => row.id) });
      if ((i + 1) % 10 === 0) console.log(`${i + 1} accounts`);
    }
  } finally {
    await db.end();
  }
  writeFileSync(USERS_FILE, JSON.stringify(users));
  console.log(`${users.length} accounts ready: ${USERS_FILE}`);
}

async function remove() {
  const identities = await json<Array<{ id: string; traits: { phone?: string } }>>(await fetch(`${KRATOS_ADMIN}/admin/identities?page_size=1000`), "list");
  const bench = identities.filter((identity) => identity.traits.phone?.startsWith(PREFIX));
  const db = await admin();
  try {
    const ids = bench.map((identity) => identity.id);
    await db.query("delete from public.properties where created_by = any($1::uuid[])", [ids]);
    await db.query("delete from public.organizations where id in (select organization_id from public.organization_members where user_id = any($1::uuid[]))", [ids]);
    await db.query("delete from auth.users where id = any($1::uuid[])", [ids]);
  } finally {
    await db.end();
  }
  for (const identity of bench) await fetch(`${KRATOS_ADMIN}/admin/identities/${identity.id}`, { method: "DELETE" });
  console.log(`Removed ${bench.length} bench accounts`);
}

loadBackendEnv();
if (process.env.NODE_ENV !== "development") throw new Error("Development only.");
const [command, count] = process.argv.slice(2);
void (command === "remove" ? remove() : create(Number(count ?? 40))).then(() => process.exit(0), (error: Error) => {
  console.error(error.message);
  process.exit(1);
});
