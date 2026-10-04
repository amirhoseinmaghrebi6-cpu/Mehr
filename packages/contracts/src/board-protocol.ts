/**
 * The protocol between an ESP32 board and the cloud (version 1). There is no hub: every board
 * connects straight to our MQTT broker. The firmware, the API and the simulated board follow this
 * file; docs/board-protocol.md explains it in words.
 *
 * - The board's MQTT username is its board id (controllers.id); it may use only its own topics.
 * - Every message is small JSON, QoS 1. Only `status` is retained.
 * - A board has no clock of its own, so a command carries the seconds it is still valid for (ttl),
 *   never a time of day.
 */
import { z } from "zod";
import { capabilities, type CapabilityName } from "./catalog.js";

export const BOARD_PROTOCOL_VERSION = 1;
const ROOT = `m2/v${BOARD_PROTOCOL_VERSION}/boards`;

export const boardMessageKinds = ["cmd", "ack", "state", "status", "reset"] as const;
export type BoardMessageKind = (typeof boardMessageKinds)[number];

/** `m2/v1/boards/{boardId}/{kind}` */
export const boardTopic = (boardId: string, kind: BoardMessageKind) => `${ROOT}/${boardId}/${kind}`;

/** The server's subscription for one kind of message from every board. */
export const allBoardsTopic = (kind: Exclude<BoardMessageKind, "cmd">) => `${ROOT}/+/${kind}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The board id and message kind of a topic, or null if it is not a board topic. */
export function parseBoardTopic(topic: string): { boardId: string; kind: BoardMessageKind } | null {
  const [m2, version, boards, boardId, kind, ...rest] = topic.split("/");
  if (`${m2}/${version}/${boards}` !== ROOT || rest.length || !UUID.test(boardId ?? "")) return null;
  return (boardMessageKinds as readonly string[]).includes(kind) ? { boardId, kind: kind as BoardMessageKind } : null;
}

const channel = z.string().regex(/^[a-z][a-z0-9_]*$/).max(32);
const capability = z.enum(Object.keys(capabilities) as [CapabilityName, ...CapabilityName[]]);
const value = z.union([z.boolean(), z.number().finite(), z.string().max(64)]);

/** server → board: carry out one command. */
export const boardCommand = z.strictObject({
  /** The command's id; the board repeats it in its ack and its report. */
  id: z.uuid(),
  /** The board channel (one of its 1–20 inputs and outputs), e.g. "ch1". */
  ch: channel,
  cap: capability,
  /** The absolute target value, never a difference. */
  val: value,
  /** Seconds the command is still valid for; the board drops it if it cannot start in time. */
  ttl: z.int().min(1).max(86_400),
});
export type BoardCommand = z.infer<typeof boardCommand>;

/** board → server: the command arrived and the hardware started, or the board refuses it. */
export const boardAck = z.strictObject({
  id: z.uuid(),
  /** Set when the board refuses the command, e.g. "camera_off"; absent when it started. */
  err: z.string().regex(/^[a-z][a-z0-9_]*$/).max(32).optional(),
});
export type BoardAck = z.infer<typeof boardAck>;

/**
 * board → server: values the board measured or reached. Sent after a command (with its id), after
 * a wall-switch press or a sensor change, and as a full snapshot of every channel on connect.
 */
export const boardState = z.strictObject({
  /** The command these values complete, if any. Only this makes a command "applied". */
  id: z.uuid().optional(),
  values: z.array(z.strictObject({ ch: channel, cap: capability, val: value })).min(1).max(128),
});
export type BoardState = z.infer<typeof boardState>;

/** board → server, retained: online after connecting; the broker sends offline when the connection drops. */
export const boardStatus = z.strictObject({
  online: z.boolean(),
  /** Firmware version, sent with online. */
  fw: z.string().max(32).optional(),
});
export type BoardStatus = z.infer<typeof boardStatus>;

/** board → server, best effort just before a factory reset erases the board. */
export const boardReset = z.strictObject({});

/**
 * The pairing code a board in pairing mode shows on its setup page, as a QR code and as text:
 * `M2P1:{hardwareUid}:{code}`. The code is 26 random characters (130 bits), fresh every time the
 * board enters pairing mode, valid once and for 24 hours. The server stores only its SHA-256.
 */
const PAIRING = /^M2P1:([A-Za-z0-9:_-]{4,64}):([A-Z2-7]{26})$/;
export const formatPairingCode = (hardwareUid: string, code: string) => `M2P1:${hardwareUid}:${code}`;
export function parsePairingCode(text: string): { hardwareUid: string; code: string } | null {
  const match = PAIRING.exec(text.trim());
  return match ? { hardwareUid: match[1], code: match[2] } : null;
}
