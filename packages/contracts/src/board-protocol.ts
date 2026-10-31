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

// --- Pairing by setup code (docs/board-protocol.md, "Pairing") ----------------------------------

/**
 * A setup code: 12 characters from an alphabet without look-alikes (no 0/O, 1/I), about 60 random
 * bits. The app shows it as XXXX-XXXX-XXXX; it is valid once and for SETUP_CODE_MINUTES.
 */
export const SETUP_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const SETUP_CODE_LENGTH = 12;
export const SETUP_CODE_MINUTES = 10;

/** What someone typed (any case, spaces or dashes) as a setup code, or null if it cannot be one. */
export function normalizeSetupCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[\s-]/g, "");
  return code.length === SETUP_CODE_LENGTH && [...code].every((char) => SETUP_CODE_ALPHABET.includes(char)) ? code : null;
}
export const formatSetupCode = (code: string) => code.replace(/(.{4})(?=.)/g, "$1-");

/** The board's own setup page while it is in pairing mode, with the code filled in. */
export const BOARD_SETUP_ADDRESS = "http://192.168.4.1";
export const boardSetupUrl = (code: string) => `${BOARD_SETUP_ADDRESS}/?code=${code}`;

/** POST /v1/properties/:propertyId/boards/:boardId/setup-code (owner, admin): a fresh code. */
export interface SetupCodeResponse {
  /** XXXX-XXXX-XXXX */
  code: string;
  expiresAt: string;
  /** Opens the board's setup page with the code filled in (the phone must be on the board's Wi-Fi). */
  setupUrl: string;
}

const hardwareUid = z.string().regex(/^[A-Za-z0-9:_-]{4,64}$/);
/** The random secret written to the board at production; it proves the board is genuine. */
const factorySecret = z.string().min(32).max(128);

/**
 * POST /v1/boards/claim: the board, in pairing mode and on the home's Wi-Fi, uses the setup code
 * it was given and gets its broker account. Asking again with the same code (the answer was lost)
 * gives a fresh secret and ends the earlier one.
 */
export const boardClaimRequest = z.strictObject({
  hardwareUid,
  secret: factorySecret,
  code: z.string().max(32),
});
export type BoardClaimRequest = z.infer<typeof boardClaimRequest>;
export type BoardClaimResponse = { boardId: string; brokerSecret: string };

/**
 * POST /v1/properties/:propertyId/boards: an owner or admin adds a product to the home; its
 * channels become devices with the given names and rooms, waiting for their real board.
 */
export const addBoardRequest = z.strictObject({
  modelCode: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  channels: z
    .array(z.strictObject({ key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(32), name: z.string().trim().min(1).max(60), roomId: z.uuid().nullable() }))
    .max(32)
    .default([]),
});
export type AddBoardRequest = z.input<typeof addBoardRequest>;
