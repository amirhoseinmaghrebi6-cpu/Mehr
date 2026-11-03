/**
 * Broker logins in the database (supabase/migrations/202611070001_broker_accounts.sql): the broker
 * (mosquitto-go-auth) checks them there. Passwords are stored as PBKDF2 hashes in go-auth's format,
 * "PBKDF2$sha256$<iterations>$<base64 salt>$<base64 key>". Board secrets are 32 random bytes, so
 * a few iterations are plenty; the API's own password is a long random one too.
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { withSystemTx } from "../db/tx";

const ITERATIONS = 1_000;

export function brokerPasswordHash(password: string): string {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  return `PBKDF2$sha256$${ITERATIONS}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** The API's own login on the broker (a superuser there). Idempotent; a changed password replaces the hash. */
export async function saveServiceAccount(pool: Pool, username: string, password: string): Promise<void> {
  await withSystemTx(pool, (tx) =>
    tx.query(
      `insert into broker.service_accounts (username, password_hash) values ($1, $2)
       on conflict (username) do update set password_hash = excluded.password_hash, updated_at = now()`,
      [username, brokerPasswordHash(password)],
    ),
  );
}

export async function saveBoardAccount(pool: Pool, boardId: string, secret: string): Promise<void> {
  await withSystemTx(pool, (tx) =>
    tx.query(
      `insert into broker.board_accounts (board_id, password_hash) values ($1, $2)
       on conflict (board_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
      [boardId, brokerPasswordHash(secret)],
    ),
  );
}

export async function deleteBoardAccount(pool: Pool, boardId: string): Promise<void> {
  await withSystemTx(pool, (tx) => tx.query("delete from broker.board_accounts where board_id = $1", [boardId]));
}
