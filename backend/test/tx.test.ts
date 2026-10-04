import type { DatabaseError, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeDatabaseRole } from "../src/db/pool";
import { withSystemTx, withUserTx } from "../src/db/tx";
import { adminQuery, createApiPool, createTenants, DEVICE_A, DEVICE_B, dropTenants, PROPERTY_A, PROPERTY_B, USER_A } from "./fixtures";

const userA = { userId: USER_A };
const TABLES = ["hubs", "devices", "device_capabilities", "device_states"] as const;

function sqlState(error: unknown): string | undefined {
  return (error as DatabaseError).code;
}

describe("database access as m2_api", () => {
  let pool: Pool;

  beforeAll(async () => {
    await createTenants();
    pool = createApiPool();
  });

  afterAll(async () => {
    await pool?.end();
    await dropTenants();
  });

  it("connects as m2_api, which passes the startup role check", async () => {
    await expect(assertSafeDatabaseRole(pool)).resolves.toBe("m2_api");
  });

  it("cannot read app tables outside withUserTx / withSystemTx", async () => {
    for (const table of TABLES) {
      await expect(pool.query(`select count(*) from public.${table}`)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("cannot switch to a role it was not granted", async () => {
    await expect(pool.query("set role m2_migrator")).rejects.toMatchObject({ code: "42501" });
  });

  describe("withUserTx as user A", () => {
    it("sees none of property B's rows", async () => {
      for (const table of TABLES) {
        const { rows } = await withUserTx(pool, userA, (tx) =>
          tx.query<{ n: number }>(`select count(*)::int as n from public.${table} where property_id = $1`, [PROPERTY_B]),
        );
        expect(rows[0].n, `${table} rows of property B`).toBe(0);
      }
    });

    it("sees property A's rows", async () => {
      const { rows } = await withUserTx(pool, userA, (tx) =>
        tx.query<{ property_id: string }>("select property_id from public.devices where id = any($1::uuid[])", [[DEVICE_A, DEVICE_B]]),
      );
      expect(rows.map((row) => row.property_id)).toEqual([PROPERTY_A]);
    });

    it("runs with the user's id in auth.uid()", async () => {
      const { rows } = await withUserTx(pool, userA, (tx) => tx.query<{ uid: string; role: string }>("select auth.uid() as uid, current_user as role"));
      expect(rows[0]).toEqual({ uid: USER_A, role: "authenticated" });
    });

    it("cannot update, insert or delete device_states, even on its own property", async () => {
      const writes = [
        ["update public.device_states set value = 'true' where device_id = $1", [DEVICE_A]],
        ["insert into public.device_states (property_id, device_id, capability, value) values ($1, $2, 'power', 'true')", [PROPERTY_A, DEVICE_A]],
        ["delete from public.device_states where device_id = $1", [DEVICE_A]],
      ] as const;
      for (const [sql, values] of writes) {
        const error = await withUserTx(pool, userA, (tx) => tx.query(sql, [...values])).catch((caught: unknown) => caught);
        expect(sqlState(error), sql).toBe("42501");
      }
    });

    it("rolls back everything when the work throws", async () => {
      const key = `rollback-test-${Date.now()}`;
      await expect(
        withUserTx(pool, userA, async (tx) => {
          await tx.query(
            "insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key) values ($1, $2, 'power', 'true', $3)",
            [PROPERTY_A, DEVICE_A, key],
          );
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const { rows } = await withSystemTx(pool, (tx) =>
        tx.query<{ n: number }>("select count(*)::int as n from public.device_commands where idempotency_key = $1", [key]),
      );
      expect(rows[0].n).toBe(0);
    });

    it("rejects a principal without a UUID user id", () => {
      expect(() => withUserTx(pool, { userId: "' or 1=1 --" }, async () => undefined)).toThrow(TypeError);
    });
  });

  describe("withSystemTx", () => {
    it("runs as service_role and sees every property", async () => {
      const { rows } = await withSystemTx(pool, (tx) =>
        tx.query<{ role: string; n: number }>(
          "select current_user as role, (select count(*)::int from public.devices where property_id = any($1::uuid[])) as n",
          [[PROPERTY_A, PROPERTY_B]],
        ),
      );
      expect(rows[0]).toEqual({ role: "service_role", n: 2 });
    });

    it("has no user identity", async () => {
      const { rows } = await withSystemTx(pool, (tx) => tx.query<{ uid: string | null }>("select auth.uid() as uid"));
      expect(rows[0].uid).toBeNull();
    });
  });

  it("returns connections to the pool as plain m2_api with no claims", async () => {
    const single = createApiPool(1);
    try {
      await withUserTx(single, userA, (tx) => tx.query("select 1"));
      await withSystemTx(single, (tx) => tx.query("select 1"));
      await withUserTx(single, userA, async () => {
        throw new Error("fail");
      }).catch(() => undefined);

      const { rows } = await single.query<{ role: string; claims: string | null }>(
        "select current_user as role, nullif(current_setting('request.jwt.claims', true), '') as claims",
      );
      expect(rows[0]).toEqual({ role: "m2_api", claims: null });
    } finally {
      await single.end();
    }
  });

  it("survives the database closing a connection in the middle of a transaction", async () => {
    // E.g. PostgreSQL restarting: the connection dies while it is checked out. That must fail this
    // one transaction, not crash the API.
    const attempt = withSystemTx(pool, async (tx) => {
      const { rows } = await tx.query<{ pid: number }>("select pg_backend_pid() as pid");
      await adminQuery("select pg_terminate_backend($1)", [rows[0].pid]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.query("select 1");
    });
    await expect(attempt).rejects.toThrow();
    const { rows } = await withSystemTx(pool, (tx) => tx.query<{ ok: number }>("select 1 as ok"));
    expect(rows[0].ok).toBe(1);
  });
});
