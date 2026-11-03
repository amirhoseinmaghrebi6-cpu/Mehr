/**
 * Firmware updates over the air (docs/board-protocol.md, "Firmware updates").
 *
 * An image says itself what it is: the version from its ESP-IDF app description, and the board
 * model from a marker the firmware carries ("M2MODEL=<code>;", firmware/main/board.c). So an
 * operator cannot type a wrong version, or send a firmware built for another board.
 *
 * The active release of a model is offered to every board of that model whose reported version
 * differs: to the online ones when it becomes active, and to each one when it comes online.
 */
import { createHash, verify, type KeyObject } from "node:crypto";
import type { BoardUpdate } from "@m2smart/contracts";
import type { Pool } from "pg";
import type { Broker } from "../broker/broker";
import { withSystemTx } from "../db/tx";

/** ESP-IDF image: magic byte, then the app description at 0x20 (magic, then the version at +16). */
const IMAGE_MAGIC = 0xe9;
const APP_DESC_OFFSET = 0x20;
const APP_DESC_MAGIC = 0xabcd5432;
const MODEL_MARKER = "M2MODEL=";

export type FirmwareImage = { version: string; modelCode: string; sha256: string };

/** End of a file signed by firmware/sign.mjs: image, DER signature, its length (2 bytes LE), this. */
const SIGNED_TRAILER = Buffer.from("M2SIG1", "latin1");

/**
 * The image and its signature from a signed file, if our key (`publicKey`) signed it. Null for an
 * unsigned file, a damaged one, or one signed with another key: boards would refuse it anyway.
 */
export function openSigned(file: Buffer, publicKey: KeyObject): { image: Buffer; signature: Buffer } | null {
  const end = file.length - SIGNED_TRAILER.length;
  if (end < 2 || !file.subarray(end).equals(SIGNED_TRAILER)) return null;
  const length = file.readUInt16LE(end - 2);
  if (length < 8 || length > 80 || end - 2 - length < 1) return null;
  const image = file.subarray(0, end - 2 - length);
  const signature = file.subarray(end - 2 - length, end - 2);
  try {
    return verify("sha256", image, publicKey, signature) ? { image, signature } : null;
  } catch {
    return null;
  }
}

/** What the image is, or why it is not an M2smart firmware. */
export function readImage(image: Buffer): FirmwareImage | { error: "not_firmware" | "no_model" } {
  if (image.length < APP_DESC_OFFSET + 80 || image[0] !== IMAGE_MAGIC || image.readUInt32LE(APP_DESC_OFFSET) !== APP_DESC_MAGIC) return { error: "not_firmware" };
  const versionField = image.subarray(APP_DESC_OFFSET + 16, APP_DESC_OFFSET + 48);
  const version = versionField.subarray(0, versionField.indexOf(0) < 0 ? 32 : versionField.indexOf(0)).toString("latin1");
  if (!/^[0-9A-Za-z.+_-]{1,31}$/.test(version)) return { error: "not_firmware" };
  const marker = image.indexOf(MODEL_MARKER, 0, "latin1");
  const end = marker < 0 ? -1 : image.indexOf(";", marker, "latin1");
  const modelCode = marker < 0 || end < 0 ? "" : image.subarray(marker + MODEL_MARKER.length, end).toString("latin1");
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(modelCode)) return { error: "no_model" };
  return { version, modelCode, sha256: createHash("sha256").update(image).digest("hex") };
}

type Release = { id: string; version: string; sha256: string; size_bytes: number; signature: string };
const message = (release: Release): BoardUpdate => ({ version: release.version, path: `/api/v1/firmware/${release.id}.bin`, sha256: release.sha256, size: release.size_bytes, sig: release.signature });

/** Offers the model's active release to one board that just came online, if it runs another version. */
export async function offerUpdate(pool: Pool, broker: Broker, boardId: string, reportedVersion: string | undefined): Promise<boolean> {
  const { rows } = await withSystemTx(pool, (tx) =>
    tx.query<Release>(
      `select release.id, release.version, release.sha256, release.size_bytes, release.signature
       from public.controllers as board
       join public.firmware_releases as release on release.model_id = board.model_id and release.active
       where board.id = $1 and board.hardware_uid is not null`,
      [boardId],
    ),
  );
  const release = rows[0];
  if (!release || release.version === reportedVersion) return false;
  await broker.publish(boardId, "update", message(release));
  return true;
}

/** Offers a release that just became active to every online board of its model on another version. */
export async function rollOut(pool: Pool, broker: Broker, releaseId: string): Promise<number> {
  const { rows } = await withSystemTx(pool, (tx) =>
    tx.query<Release & { board_id: string }>(
      `select board.id as board_id, release.id, release.version, release.sha256, release.size_bytes, release.signature
       from public.firmware_releases as release
       join public.controllers as board on board.model_id = release.model_id
       where release.id = $1 and release.active and board.online and board.hardware_uid is not null
         and board.firmware_version is distinct from release.version`,
      [releaseId],
    ),
  );
  for (const row of rows) await broker.publish(row.board_id, "update", message(row));
  return rows.length;
}
