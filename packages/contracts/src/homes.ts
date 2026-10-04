/**
 * Requests and responses for homes (properties), rooms, devices and commands. Request bodies are
 * zod schemas: the API validates every request with them, and the web app can reuse them for
 * form checks. Response shapes are plain types.
 */
import { z } from "zod";
import { defaultTimeZone, isTimeZone } from "./calendar.js";
import { capabilities, photoPresets, type CapabilityName, type CapabilityValue, type DeviceType, type PhotoPreset } from "./catalog.js";
import type { PropertyRole } from "./permissions.js";

export const propertyTypes = ["house", "villa", "apartment", "office", "commercial", "custom"] as const;
export type PropertyType = (typeof propertyTypes)[number];

const name = (max: number) => z.string().trim().min(1).max(max);
const photo = z.enum(photoPresets);
/** An IANA time zone, e.g. "Asia/Tehran": scenario times and dates follow it. */
const timeZone = z.string().max(64).refine(isTimeZone, "unknown time zone");

// --- Homes -----------------------------------------------------------------------------------

export const createPropertyRequest = z.strictObject({
  name: name(80),
  type: z.enum(propertyTypes).default("house"),
  address: z.string().trim().max(200).default(""),
  coverPhoto: photo.default("living"),
  timeZone: timeZone.default(defaultTimeZone),
});
export type CreatePropertyRequest = z.input<typeof createPropertyRequest>;

export const updatePropertyRequest = z
  .strictObject({
    name: name(80),
    type: z.enum(propertyTypes),
    address: z.string().trim().max(200),
    coverPhoto: photo,
    timeZone,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "nothing to update");
export type UpdatePropertyRequest = z.input<typeof updatePropertyRequest>;

export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  address: string;
  coverPhoto: PhotoPreset;
  /** The home's IANA time zone; scenario times and dates are in it, never the phone's. */
  timeZone: string;
  /** The signed-in user's role in this home. */
  role: PropertyRole;
}

/** GET /v1/properties */
export interface PropertyListResponse {
  properties: Property[];
}

// --- Rooms -----------------------------------------------------------------------------------

export const createRoomRequest = z.strictObject({
  name: name(60),
  photo: photo.default("living"),
});
export type CreateRoomRequest = z.input<typeof createRoomRequest>;

export const updateRoomRequest = z
  .strictObject({
    name: name(60),
    photo,
    sortOrder: z.int().min(0).max(10_000),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "nothing to update");
export type UpdateRoomRequest = z.input<typeof updateRoomRequest>;

export interface Room {
  id: string;
  name: string;
  photo: PhotoPreset;
  sortOrder: number;
}

/** GET /v1/properties/:propertyId/rooms */
export interface RoomListResponse {
  rooms: Room[];
}

// --- Devices ---------------------------------------------------------------------------------

export interface CapabilityState {
  capability: CapabilityName;
  writable: boolean;
  /** Last value the ESP32 reported, or null before the first report. */
  value: CapabilityValue | null;
  reportedAt: string | null;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  roomId: string | null;
  online: boolean;
  lastSeenAt: string | null;
  capabilities: CapabilityState[];
  /** The board this device is a channel of. Removing the board removes all its devices. */
  boardId: string | null;
  boardName: string | null;
  /** Hidden by an owner or admin: an input or output that is not wired to anything. */
  hidden: boolean;
}

/** GET /v1/properties/:propertyId/devices */
export interface DeviceListResponse {
  devices: Device[];
}

/** The answer to POST /v1/properties/:propertyId/boards: the new board and its devices, to name and place. */
export interface PairBoardResponse {
  boardId: string;
  boardName: string;
  devices: Device[];
}

/** PATCH /v1/properties/:propertyId/devices/:deviceId. Pin assignments are never editable. */
export const updateDeviceRequest = z
  .strictObject({
    name: name(60),
    roomId: z.uuid().nullable(),
    hidden: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "nothing to update");
export type UpdateDeviceRequest = z.input<typeof updateDeviceRequest>;

// --- Commands --------------------------------------------------------------------------------

export const commandStatuses = ["pending", "sent", "applied", "rejected", "failed", "timed_out"] as const;
export type CommandStatus = (typeof commandStatuses)[number];

/** Statuses after which a command never changes again. */
export const finalCommandStatuses: readonly CommandStatus[] = ["applied", "rejected", "failed", "timed_out"];

/**
 * POST /v1/properties/:propertyId/commands. `targetValue` is absolute; whether it fits the
 * capability is checked against the device (capabilityValueError) and again by the database.
 * Sending the same `idempotencyKey` again returns the original command instead of a new one.
 */
export const createCommandRequest = z.strictObject({
  deviceId: z.uuid(),
  capability: z.enum(Object.keys(capabilities) as [CapabilityName, ...CapabilityName[]]),
  targetValue: z.union([z.boolean(), z.number().finite(), z.string().max(64)]),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
});
export type CreateCommandRequest = z.input<typeof createCommandRequest>;

export interface Command {
  id: string;
  deviceId: string;
  capability: CapabilityName;
  targetValue: CapabilityValue;
  /**
   * pending: waiting for the hub; sent: the hub has it; applied: the ESP32 reported the value.
   * rejected/failed/timed_out: it did not happen.
   */
  status: CommandStatus;
  /** When the ESP32 started carrying it out (e.g. a door motor started), before it finished. */
  acknowledgedAt: string | null;
  createdAt: string;
  /**
   * The deadline for the ESP32's report: 30 s for the network plus the hardware's own time (a
   * parking door gets minutes, a light seconds). Set by the database; clients wait until then.
   */
  expiresAt: string;
  completedAt: string | null;
  errorCode: string | null;
}
