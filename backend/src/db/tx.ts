/**
 * The only two ways API code touches app data.
 *
 * - withUserTx: acts as one signed-in user. Runs as the `authenticated` role with the user's id
 *   in request.jwt.claims, so every RLS policy (auth.uid()) applies exactly as the
 *   migrations expect.
 * - withSystemTx: backend-only work (e.g. device state ingest). Runs as `service_role`, which
 *   bypasses RLS; keep its use rare and easy to find.
 *
 * Both use transaction-scoped settings only (SET LOCAL / set_config(..., true)), so when the
 * connection returns to the pool it is plain m2_api again with no claims. This also stays
 * correct behind a transaction-mode pooler such as PgBouncer.
 */
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/** Who the work runs as. Filled from a verified session in Phase 2D. */
export type Principal = { userId: string };

/** The query surface handed to work functions; transaction control stays inside this module. */
export type TxClient = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function inTransaction<T>(pool: Pool, setup: (client: PoolClient) => Promise<void>, work: (tx: TxClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  // A connection that failed to begin or roll back is in an unknown state: destroy it instead of
  // returning it to the pool.
  let broken = true;
  try {
    await client.query("begin");
    try {
      await setup(client);
      const tx: TxClient = { query: (text, values) => client.query(text, values) };
      const result = await work(tx);
      await client.query("commit");
      broken = false;
      return result;
    } catch (error) {
      await client.query("rollback").then(
        () => (broken = false),
        () => undefined,
      );
      throw error;
    }
  } finally {
    client.release(broken);
  }
}

export function withUserTx<T>(pool: Pool, principal: Principal, work: (tx: TxClient) => Promise<T>): Promise<T> {
  if (!UUID.test(principal.userId)) throw new TypeError("withUserTx requires a principal with a UUID userId");
  const claims = JSON.stringify({ sub: principal.userId, role: "authenticated" });
  return inTransaction(
    pool,
    async (client) => {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    },
    work,
  );
}

export function withSystemTx<T>(pool: Pool, work: (tx: TxClient) => Promise<T>): Promise<T> {
  return inTransaction(
    pool,
    async (client) => {
      await client.query("set local role service_role");
      await client.query("select set_config('request.jwt.claims', '', true)");
    },
    work,
  );
}
