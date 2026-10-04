/**
 * Keeps each board's online state from its `status` messages: the board says online when it
 * connects, and the broker says offline for it when the connection drops (its last will). The
 * status is retained, so after an API restart the broker replays the current state of every board.
 *
 * The board id comes from the topic, and the broker lets a board publish only on its own topics,
 * so a board can never report for another one.
 */
import { boardStatus } from "@m2smart/contracts";
import type { Pool } from "pg";
import { withSystemTx } from "../db/tx";
import type { Broker } from "./broker";

type Log = { error: (object: object, message: string) => void };

/** Stores a board's online state; false if there is no such board. */
export async function storeBoardStatus(pool: Pool, boardId: string, online: boolean, firmware?: string): Promise<boolean> {
  return withSystemTx(pool, async (tx) => {
    const { rowCount } = await tx.query(
      `update public.controllers set online = $2, firmware_version = coalesce($3, firmware_version),
         last_seen_at = case when $2 then now() else last_seen_at end
       where id = $1`,
      [boardId, online, firmware ?? null],
    );
    if (!rowCount) return false;
    await tx.query("update public.devices set online = $2, last_seen_at = case when $2 then now() else last_seen_at end where controller_id = $1", [boardId, online]);
    return true;
  });
}

export function followBoardStatus(broker: Broker, pool: Pool, log: Log): void {
  broker.on("status", (boardId, payload) => {
    const status = boardStatus.safeParse(payload);
    if (!status.success) return;
    storeBoardStatus(pool, boardId, status.data.online, status.data.fw).catch((error: Error) =>
      log.error({ err: { message: error.message }, boardId }, "Could not store a board's status"),
    );
  });
}
