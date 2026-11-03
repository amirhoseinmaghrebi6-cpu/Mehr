/**
 * The operator's panel: /v1/admin/*, only for the phone numbers in the API's PLATFORM_ADMIN_PHONES
 * (everyone else gets 403). It shows counts, people and boards, never what is inside a home.
 */
import { z } from "zod";

/** GET /v1/admin/overview */
export interface AdminOverview {
  users: number;
  blockedUsers: number;
  homes: number;
  boards: number;
  boardsOnline: number;
  /** Commands sent in the last 24 hours (older ones are deleted). */
  commandsToday: number;
  services: {
    database: boolean;
    /** The API is connected to the boards' MQTT broker. */
    broker: boolean;
    /** SMS codes can be sent (key, sender and code pattern set). */
    sms: boolean;
    /** Kratos's admin API is configured, so users can be blocked and deleted. */
    accounts: boolean;
  };
}

export interface AdminUser {
  id: string;
  name: string;
  phone: string | null;
  createdAt: string;
  blocked: boolean;
  homesOwned: number;
  homesJoined: number;
  /** Another operator, or the caller: cannot be blocked or deleted here. */
  platformAdmin: boolean;
}

/** GET /v1/admin/users?search=&offset= (50 a page, newest first) */
export interface AdminUserListResponse {
  users: AdminUser[];
  total: number;
}

export interface AdminBoard {
  id: string;
  hardwareUid: string;
  model: string;
  firmwareVersion: string | null;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  ownerName: string;
  ownerPhone: string | null;
}

/** GET /v1/admin/boards?offset= (50 a page, online first) */
export interface AdminBoardListResponse {
  boards: AdminBoard[];
  total: number;
}

export const ADMIN_PAGE_SIZE = 50;

/** PATCH /v1/admin/users/:userId */
export const adminUpdateUserRequest = z.object({ blocked: z.boolean() }).strict();
export type AdminUpdateUserRequest = z.infer<typeof adminUpdateUserRequest>;

// --- Firmware (OTA, docs/board-protocol.md "Firmware updates") ---------------------------------

/** A firmware image the operator uploaded for one board model. */
export interface FirmwareRelease {
  id: string;
  modelCode: string;
  /** Read from the image itself (its app description), never typed. */
  version: string;
  sizeBytes: number;
  sha256: string;
  notes: string;
  /** The version boards of this model are brought to; one per model at most. */
  active: boolean;
  createdAt: string;
}

export interface FirmwareModel {
  code: string;
  name: string;
  activeVersion: string | null;
  /** Boards of this model by the firmware they reported (null: not reported yet). */
  boards: Array<{ version: string | null; count: number }>;
}

/** GET /v1/admin/firmware */
export interface AdminFirmwareResponse {
  models: FirmwareModel[];
  releases: FirmwareRelease[];
}

/** Largest image: the size of one firmware slot (firmware/partitions.csv). */
export const FIRMWARE_MAX_BYTES = 0x190000;

/**
 * POST /v1/admin/firmware: the signed file from firmware/sign.mjs (.m2fw: the image, at most
 * 1.6 MB, then its signature) as base64.
 */
export const uploadFirmwareRequest = z
  .object({
    modelCode: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    image: z.string().min(1).max(Math.ceil(((FIRMWARE_MAX_BYTES + 128) * 4) / 3) + 8),
    notes: z.string().trim().max(500).default(""),
  })
  .strict();
export type UploadFirmwareRequest = z.input<typeof uploadFirmwareRequest>;

/** PATCH /v1/admin/firmware/:id: make it the version for its model, or stop rolling it out. */
export const updateFirmwareRequest = z.object({ active: z.boolean() }).strict();
