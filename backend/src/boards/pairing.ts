/**
 * Pairing and removing boards (docs/board-protocol.md, "Pairing" and "Factory reset").
 *
 * A board joins a home only when all three hold:
 * - someone holds it: only a board in pairing mode makes a pairing code;
 * - it is genuine: it proves itself with its factory secret (the registry of manufactured boards
 *   holds the secret's hash);
 * - an owner or admin of the home uploads that code.
 *
 * The server stores only hashes of factory secrets and pairing codes. Removing a board (a factory
 * reset, or pairing it with another home) leaves nothing of it behind: its devices, their states,
 * commands, scenario actions and energy totals go with it, and so does its broker account.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { Broker } from "../broker/broker";
import { withSystemTx, type TxClient } from "../db/tx";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Whether `secret` is the factory secret of the manufactured board `hardwareUid`. */
async function isGenuine(tx: TxClient, hardwareUid: string, secret: string): Promise<boolean> {
  const { rows } = await tx.query<{ factory_secret_hash: string }>("select factory_secret_hash from public.manufactured_boards where hardware_uid = $1", [hardwareUid]);
  // An unknown board is compared against a dummy, so both cases take the same time.
  const expected = Buffer.from(rows[0]?.factory_secret_hash ?? "0".repeat(64), "hex");
  return timingSafeEqual(expected, Buffer.from(sha256(secret), "hex")) && rows.length === 1;
}

/** The board is in pairing mode and online: remember (only the hash of) its fresh pairing code. */
export async function announceBoard(pool: Pool, hardwareUid: string, secret: string, codeHash: string): Promise<boolean> {
  return withSystemTx(pool, async (tx) => {
    if (!(await isGenuine(tx, hardwareUid, secret))) return false;
    // Entering pairing mode again replaces the earlier code, used or not.
    await tx.query(
      `insert into public.board_pairings (hardware_uid, code_hash) values ($1, $2)
       on conflict (hardware_uid) do update set code_hash = excluded.code_hash, controller_id = null, expires_at = now() + interval '24 hours', created_at = now()`,
      [hardwareUid, codeHash],
    );
    return true;
  });
}

/** Deletes a board and everything that belongs to it, and its broker account. */
export async function removeBoard(pool: Pool, broker: Broker, boardId: string): Promise<boolean> {
  const removed = await withSystemTx(pool, async (tx) => {
    const { rows } = await tx.query<{ hardware_uid: string }>("delete from public.controllers where id = $1 returning hardware_uid", [boardId]);
    if (rows.length) await tx.query("delete from public.board_pairings where hardware_uid = $1 and controller_id is null", [rows[0].hardware_uid]);
    return rows.length > 0;
  });
  if (removed) await broker.removeBoard(boardId);
  return removed;
}

export type PairedBoard = { boardId: string; boardName: string };

/**
 * Adds the board whose pairing code is `code` to the home. The caller has checked that the user
 * is an owner or admin of that home. Null if the code is unknown, used or expired.
 */
export async function pairBoard(pool: Pool, broker: Broker, propertyId: string, hardwareUid: string, code: string): Promise<PairedBoard | null> {
  const paired = await withSystemTx(pool, async (tx) => {
    const { rows: pending } = await tx.query<{ model_code: string; model_name: string }>(
      `select model.code as model_code, model.name as model_name
       from public.board_pairings as pairing
       join public.manufactured_boards as board on board.hardware_uid = pairing.hardware_uid
       join public.hardware_models as model on model.id = board.model_id
       where pairing.hardware_uid = $1 and pairing.code_hash = $2 and pairing.controller_id is null and pairing.expires_at > now()
       for update of pairing`,
      [hardwareUid, sha256(code)],
    );
    if (!pending.length) return null;

    // A board is in one home at most: pairing it again removes it from where it was.
    const { rows: previous } = await tx.query<{ id: string }>("delete from public.controllers where hardware_uid = $1 returning id", [hardwareUid]);

    // The home's internal hub row stands for its cloud connection (there is no physical hub).
    let hub = await tx.query<{ id: string }>("select id from public.hubs where property_id = $1 order by created_at limit 1", [propertyId]);
    if (!hub.rows.length) {
      hub = await tx.query<{ id: string }>("insert into public.hubs (property_id, name, hardware_id, status) values ($1, 'Cloud', $2, 'online') returning id", [propertyId, `cloud-${propertyId}`]);
    }
    const boardName = pending[0].model_name.slice(0, 60);
    const { rows } = await tx.query<{ id: string }>("select public.provision_controller($1, $2, $3, $4) as id", [hub.rows[0].id, pending[0].model_code, hardwareUid, boardName]);
    await tx.query("update public.board_pairings set controller_id = $2 where hardware_uid = $1", [hardwareUid, rows[0].id]);
    return { boardId: rows[0].id, boardName, previous: previous.map((row) => row.id) };
  });
  if (!paired) return null;
  for (const boardId of paired.previous) await broker.removeBoard(boardId);
  return { boardId: paired.boardId, boardName: paired.boardName };
}

/**
 * The board asks for its broker account. "refused": not a genuine board or not its code;
 * "waiting": nobody uploaded the code yet; otherwise a fresh secret (any earlier one stops working).
 */
export async function issueCredentials(pool: Pool, broker: Broker, hardwareUid: string, secret: string, code: string): Promise<"refused" | "waiting" | { boardId: string; brokerSecret: string }> {
  const pairing = await withSystemTx(pool, async (tx) => {
    if (!(await isGenuine(tx, hardwareUid, secret))) return null;
    const { rows } = await tx.query<{ controller_id: string | null }>(
      "select controller_id from public.board_pairings where hardware_uid = $1 and code_hash = $2 and expires_at > now()",
      [hardwareUid, sha256(code)],
    );
    return rows[0] ?? null;
  });
  if (!pairing) return "refused";
  if (!pairing.controller_id) return "waiting";
  const brokerSecret = randomBytes(32).toString("base64url");
  await broker.setBoardSecret(pairing.controller_id, brokerSecret);
  return { boardId: pairing.controller_id, brokerSecret };
}

/** A board that is being factory-reset says goodbye: remove it completely. */
export function followBoardResets(broker: Broker, pool: Pool, log: { info: (object: object, message: string) => void; error: (object: object, message: string) => void }): void {
  broker.on("reset", (boardId) => {
    removeBoard(pool, broker, boardId).then(
      (removed) => removed && log.info({ boardId }, "Board removed after a factory reset"),
      (error: Error) => log.error({ err: { message: error.message }, boardId }, "Could not remove a reset board"),
    );
  });
}
