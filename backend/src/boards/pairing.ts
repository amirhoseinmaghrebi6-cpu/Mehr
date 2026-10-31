/**
 * Pairing and removing boards (docs/board-protocol.md, "Pairing" and "Factory reset").
 *
 * A board joins a home only when all three hold:
 * - an owner or admin of the home added the product and asked for a setup code for it;
 * - someone holds the board: only a board in pairing mode (its setup button) takes a code;
 * - it is genuine: it proves itself with its factory secret (the registry of manufactured boards
 *   holds the secret's hash), and it is the product that waits in the home.
 *
 * The server stores only hashes of factory secrets and setup codes. Removing a board (a factory
 * reset, or pairing it with another home) leaves nothing of it behind: its devices, their states,
 * commands and scenario actions go with it, and so does its broker account.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { formatSetupCode, normalizeSetupCode, SETUP_CODE_ALPHABET, SETUP_CODE_LENGTH, SETUP_CODE_MINUTES } from "@m2smart/contracts";
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

/** Deletes a board and everything that belongs to it, and its broker account. */
export async function removeBoard(pool: Pool, broker: Broker, boardId: string): Promise<boolean> {
  const removed = await withSystemTx(pool, async (tx) => {
    const { rowCount } = await tx.query("delete from public.controllers where id = $1", [boardId]);
    return Boolean(rowCount);
  });
  if (removed) await broker.removeBoard(boardId);
  return removed;
}

/** The home's internal hub row stands for its cloud connection (there is no physical hub). */
async function cloudHub(tx: TxClient, propertyId: string): Promise<string> {
  const hub = await tx.query<{ id: string }>("select id from public.hubs where property_id = $1 order by created_at limit 1", [propertyId]);
  if (hub.rows.length) return hub.rows[0].id;
  const created = await tx.query<{ id: string }>("insert into public.hubs (property_id, name, hardware_id, status) values ($1, 'Cloud', $2, 'online') returning id", [propertyId, `cloud-${propertyId}`]);
  return created.rows[0].id;
}

/**
 * Adds a product to the home as a board that waits for pairing, with the given names and rooms for
 * its channels. The caller has checked that the user is an owner or admin. Null if there is no
 * such product; "invalid" if a channel or a room does not belong.
 */
export async function addPendingBoard(
  pool: Pool,
  propertyId: string,
  modelCode: string,
  channels: Array<{ key: string; name: string; roomId: string | null }>,
): Promise<{ boardId: string; boardName: string } | "invalid" | null> {
  return withSystemTx(pool, async (tx) => {
    const { rows: models } = await tx.query<{ name: string }>(
      `select model.name from public.hardware_models as model
       where model.code = $1 and exists (select 1 from public.hardware_model_pins as pin where pin.model_id = model.id and pin.function = 'setup_button')`,
      [modelCode],
    );
    if (!models.length) return null;
    const boardName = models[0].name.slice(0, 60);
    const { rows } = await tx.query<{ id: string }>("select public.provision_controller($1, $2, null, $3) as id", [await cloudHub(tx, propertyId), modelCode, boardName]);
    for (const channel of channels) {
      const { rowCount } = await tx.query(
        `update public.devices set name = $3, room_id = $4
         where controller_id = $1 and channel_key = $2
           and ($4::uuid is null or exists (select 1 from public.rooms where id = $4 and property_id = $5))`,
        [rows[0].id, channel.key, channel.name, channel.roomId, propertyId],
      );
      // An unknown channel or a room of another home: nothing is added.
      if (!rowCount) throw new InvalidBoardInput();
    }
    return { boardId: rows[0].id, boardName };
  }).catch((error: unknown) => {
    if (error instanceof InvalidBoardInput) return "invalid" as const;
    throw error;
  });
}
class InvalidBoardInput extends Error {}

/**
 * A fresh setup code for a board that waits in the home (any earlier code for it stops working).
 * The caller has checked that the user is an owner or admin. Null if no such board waits there.
 */
export async function createSetupCode(pool: Pool, propertyId: string, boardId: string): Promise<{ code: string; expiresAt: Date } | null> {
  return withSystemTx(pool, async (tx) => {
    const { rows } = await tx.query("select 1 from public.controllers where id = $1 and property_id = $2 and hardware_uid is null", [boardId, propertyId]);
    if (!rows.length) return null;
    // Two waiting codes are never the same: a code already in use is drawn again (with 32^12 codes
    // this all but never happens), and the unique hash guards against a race.
    let code: string;
    do code = Array.from({ length: SETUP_CODE_LENGTH }, () => SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)]).join("");
    while ((await tx.query("select 1 from public.board_setup_codes where code_hash = $1", [sha256(code)])).rows.length);
    const { rows: saved } = await tx.query<{ expires_at: Date }>(
      `insert into public.board_setup_codes (controller_id, code_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3))
       on conflict (controller_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, hardware_uid = null, created_at = now()
       returning expires_at`,
      [boardId, sha256(code), SETUP_CODE_MINUTES],
    );
    return { code: formatSetupCode(code), expiresAt: saved[0].expires_at };
  });
}

/**
 * The board uses a setup code: with its factory secret, a code that waits for its product, it joins
 * that home (leaving any other) and gets a fresh broker secret. Using the same code again (its
 * answer was lost) gives a new secret and ends the earlier one. "refused": not genuine, or not a
 * waiting code (or another board's); "mismatch": the code waits for another product.
 */
export async function claimBoard(pool: Pool, broker: Broker, hardwareUid: string, secret: string, typedCode: string): Promise<"refused" | "mismatch" | { boardId: string; brokerSecret: string }> {
  const code = normalizeSetupCode(typedCode);
  const claimed = await withSystemTx(pool, async (tx) => {
    if (!(await isGenuine(tx, hardwareUid, secret)) || !code) return "refused" as const;
    const { rows } = await tx.query<{ controller_id: string; claimed_by: string | null; same_product: boolean }>(
      `select setup.controller_id, setup.hardware_uid as claimed_by, board.model_id = made.model_id as same_product
       from public.board_setup_codes as setup
       join public.controllers as board on board.id = setup.controller_id
       join public.manufactured_boards as made on made.hardware_uid = $2
       where setup.code_hash = $1 and setup.expires_at > now()
       for update of setup`,
      [sha256(code), hardwareUid],
    );
    const setup = rows[0];
    if (!setup || (setup.claimed_by && setup.claimed_by !== hardwareUid)) return "refused" as const;
    if (setup.claimed_by) return { boardId: setup.controller_id, previous: [] as string[] };
    if (!setup.same_product) return "mismatch" as const;

    // A board is in one home at most: pairing it again removes it from where it was.
    const { rows: previous } = await tx.query<{ id: string }>("delete from public.controllers where hardware_uid = $1 returning id", [hardwareUid]);
    await tx.query("update public.controllers set hardware_uid = $2 where id = $1", [setup.controller_id, hardwareUid]);
    await tx.query("update public.devices set external_id = $2 || ':' || channel_key where controller_id = $1", [setup.controller_id, hardwareUid]);
    await tx.query("update public.board_setup_codes set hardware_uid = $2 where controller_id = $1", [setup.controller_id, hardwareUid]);
    return { boardId: setup.controller_id, previous: previous.map((row) => row.id) };
  });
  if (typeof claimed === "string") return claimed;
  for (const boardId of claimed.previous) await broker.removeBoard(boardId);
  const brokerSecret = randomBytes(32).toString("base64url");
  await broker.setBoardSecret(claimed.boardId, brokerSecret);
  return { boardId: claimed.boardId, brokerSecret };
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
