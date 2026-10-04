/**
 * The web app's only way to read and change homes, rooms and devices. Two implementations share
 * this interface:
 * - createApiGateway (services/api-gateway.ts): real users, through the M2smart API (/api/v1).
 * - createDemoGateway (services/demo-gateway.ts): the demo account, with sample data kept in the
 *   browser; it answers like the API, including commands that take the hardware's time.
 */
import type {
  Command,
  CreateCommandRequest,
  CreatePropertyRequest,
  CreateRoomRequest,
  Device,
  DeviceType,
  Property,
  Room,
  UpdateDeviceRequest,
  UpdatePropertyRequest,
  UpdateRoomRequest,
  UpdateSettingsRequest,
  UserSettings,
} from "@m2smart/contracts";

export type GatewayErrorCode = "network" | "timeout" | "unauthenticated" | "forbidden" | "not_found" | "invalid_request" | "conflict" | "unavailable";

export class GatewayError extends Error {
  constructor(readonly code: GatewayErrorCode) {
    super(code);
  }
}

export interface HomeGateway {
  listProperties(): Promise<Property[]>;
  createProperty(input: CreatePropertyRequest): Promise<Property>;
  updateProperty(propertyId: string, input: UpdatePropertyRequest): Promise<Property>;
  deleteProperty(propertyId: string): Promise<void>;

  listRooms(propertyId: string): Promise<Room[]>;
  createRoom(propertyId: string, input: CreateRoomRequest): Promise<Room>;
  updateRoom(propertyId: string, roomId: string, input: UpdateRoomRequest): Promise<Room>;
  deleteRoom(propertyId: string, roomId: string): Promise<void>;

  listDevices(propertyId: string): Promise<Device[]>;
  updateDevice(propertyId: string, deviceId: string, input: UpdateDeviceRequest): Promise<Device>;

  /** Sends a command; retrying with the same idempotency key never creates a second one. */
  sendCommand(propertyId: string, input: CreateCommandRequest): Promise<Command>;
  getCommand(propertyId: string, commandId: string): Promise<Command>;

  /** The user's display preferences (language, calendar, temperature unit). */
  getSettings(): Promise<UserSettings>;
  updateSettings(input: UpdateSettingsRequest): Promise<UserSettings>;

  /**
   * Demo only. Real devices come from boards paired through the hub (Phase 4), never from a form,
   * so the API gateway has neither.
   */
  addDemoDevice?(propertyId: string, input: { type: DeviceType; name: string; roomId: string | null }): Promise<Device>;
  removeDemoDevice?(propertyId: string, deviceId: string): Promise<void>;
}
