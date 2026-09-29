/**
 * Applies infra/postgres/bootstrap.sql, then every supabase/migrations/*.sql in filename order.
 *
 * - Each migration runs in its own transaction as m2_migrator (the owner of app objects) and is
 *   recorded in m2_platform.schema_migrations with the SHA-256 of its contents.
 * - Already-applied files are skipped. If an applied file has changed, is missing, or a new file
 *   sorts before the last applied one, the runner refuses to continue.
 * - Hashes use LF line endings, so Windows (CRLF) and Linux checkouts hash the same.
 *
 * Usage: pnpm db:migrate
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { connectAdmin, REPO_ROOT, runTool, ToolError } from "./admin";

const BOOTSTRAP_FILE = join(REPO_ROOT, "infra/postgres/bootstrap.sql");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");
// Arbitrary constant key so two runners never migrate the same database at once.
const MIGRATION_LOCK_KEY = 4_022_609_290;

type Migration = { filename: string; sql: string; sha256: string };

function readSql(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const sql = readSql(join(MIGRATIONS_DIR, filename));
      return { filename, sql, sha256: createHash("sha256").update(sql).digest("hex") };
    });
}

async function inTransaction(client: Client, work: () => Promise<void>): Promise<void> {
  await client.query("begin");
  try {
    await work();
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function bootstrap(client: Client): Promise<void> {
  const sql = readSql(BOOTSTRAP_FILE);
  await inTransaction(client, async () => {
    // Local settings: visible to the bootstrap's DO blocks, gone after commit.
    await client.query("select set_config('m2.api_password', $1, true), set_config('m2.migrator_password', $2, true)", [
      process.env.M2_API_DB_PASSWORD ?? "",
      process.env.M2_MIGRATOR_DB_PASSWORD ?? "",
    ]);
    await client.query(sql);
  });
}

function planPending(migrations: Migration[], applied: Map<string, string>): Migration[] {
  const onDisk = new Set(migrations.map((migration) => migration.filename));
  for (const filename of applied.keys()) {
    if (!onDisk.has(filename)) throw new ToolError(`Applied migration ${filename} is missing from supabase/migrations.`);
  }

  for (const migration of migrations) {
    const appliedHash = applied.get(migration.filename);
    if (appliedHash && appliedHash !== migration.sha256) {
      throw new ToolError(
        `Applied migration ${migration.filename} has changed (recorded ${appliedHash.slice(0, 12)}…, now ${migration.sha256.slice(0, 12)}…). ` +
          "Never edit an applied migration; add a new one instead.",
      );
    }
  }

  const pending = migrations.filter((migration) => !applied.has(migration.filename));
  const lastApplied = [...applied.keys()].sort().at(-1);
  const outOfOrder = lastApplied ? pending.find((migration) => migration.filename < lastApplied) : undefined;
  if (outOfOrder) {
    throw new ToolError(`New migration ${outOfOrder.filename} sorts before already-applied ${lastApplied}. Rename it to run last.`);
  }
  return pending;
}

async function migrate(): Promise<void> {
  const client = await connectAdmin();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await bootstrap(client);
    console.log("Bootstrap applied.");

    const { rows } = await client.query<{ filename: string; sha256: string }>("select filename, sha256 from m2_platform.schema_migrations");
    const pending = planPending(loadMigrations(), new Map(rows.map((row) => [row.filename, row.sha256])));
    if (!pending.length) {
      console.log("No pending migrations.");
      return;
    }

    for (const migration of pending) {
      await inTransaction(client, async () => {
        await client.query("set local role m2_migrator");
        await client.query(migration.sql);
        await client.query("insert into m2_platform.schema_migrations (filename, sha256) values ($1, $2)", [migration.filename, migration.sha256]);
      });
      console.log(`Applied ${migration.filename}`);
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

runTool(migrate);
