/**
 * Runs every backend/test/sql/*.sql file against the migrated database.
 *
 * Each file runs in its own rolled-back transaction, reports each check as a 'PASS ...' notice
 * and raises an exception on failure. A file passes only if it finishes without error and the
 * number of PASS notices equals its `-- expect-pass: N` header, so skipped checks are caught too.
 *
 * Usage: pnpm db:test   (after pnpm db:migrate)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connectAdmin, runTool, ToolError } from "../src/db/admin";

const SQL_DIR = join(__dirname, "sql");

async function runSqlTests(): Promise<void> {
  const client = await connectAdmin();
  const failures: string[] = [];
  let notices: string[] = [];
  client.on("notice", (notice) => notices.push(notice.message ?? ""));

  try {
    for (const file of readdirSync(SQL_DIR).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(SQL_DIR, file), "utf8");
      const expected = Number(/^-- expect-pass: (\d+)$/m.exec(sql)?.[1]);
      if (!Number.isInteger(expected)) throw new ToolError(`${file} has no "-- expect-pass: N" header.`);

      notices = [];
      let error: unknown;
      try {
        await client.query(sql);
      } catch (caught) {
        error = caught;
        await client.query("rollback").catch(() => undefined);
      }

      const passes = notices.filter((message) => message.startsWith("PASS "));
      for (const message of passes) console.log(`  ✓ ${message.slice(5)}`);

      if (error) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        console.log(`✗ ${file}: ${passes.length} passed, then failed`);
      } else if (passes.length !== expected) {
        failures.push(`${file}: ${passes.length} checks passed, expected ${expected}`);
        console.log(`✗ ${file}: ${passes.length}/${expected} checks`);
      } else {
        console.log(`✓ ${file}: ${passes.length}/${expected} checks passed\n`);
      }
    }
  } finally {
    await client.end();
  }

  if (failures.length) throw new ToolError(`SQL tests failed:\n  ${failures.join("\n  ")}`);
  console.log("All SQL tests passed.");
}

runTool(runSqlTests);
