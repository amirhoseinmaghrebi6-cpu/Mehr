/**
 * The web app's only way to read and change homes, rooms and devices. Two implementations share
 * this interface:
 * - createApiGateway (services/api-gateway.ts): real users, through the M2smart API (/api/v1).
 * - createDemoGateway (services/demo-gateway.ts): the demo account, with sample data kept in the
 *   browser; it answers like the API, including commands that take the hardware's time.
 *
 * The interface covers homes, rooms, devices, commands, scenarios and settings.
 */
import type {
  Command,
  CreateCommandRequest,
  CreatePropertyRequest,
  CreateRoomRequest,
  Device,
  HardwareProduct,
  PairBoardResponse,
  Property,
  Room,
  Scenario,
  ScenarioRequest,
  ScenarioRunResponse,
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

  /** Scenarios of a home; times and dates are in the home's time zone. */
  listScenarios(propertyId: string): Promise<Scenario[]>;
  createScenario(propertyId: string, input: ScenarioRequest): Promise<Scenario>;
  /** Replaces the whole scenario (name, schedule, actions). */
  updateScenario(propertyId: string, scenarioId: string, input: ScenarioRequest): Promise<Scenario>;
  setScenarioEnabled(propertyId: string, scenarioId: string, enabled: boolean): Promise<Scenario>;
  deleteScenario(propertyId: string, scenarioId: string): Promise<void>;
  /** Runs a themed scenario now: one command per action. */
  runScenario(propertyId: string, scenarioId: string): Promise<ScenarioRunResponse>;

  /** The user's display preferences (language, calendar, temperature unit). */
  getSettings(): Promise<UserSettings>;
  updateSettings(input: UpdateSettingsRequest): Promise<UserSettings>;

  /** The products (board models) a home can add, by category. */
  listProducts(): Promise<HardwareProduct[]>;
  /** Adds a product to the home: its channels become devices that wait for pairing. */
  addBoard(propertyId: string, input: { modelCode: string; channels: Array<{ key: string; name: string; roomId: string | null }> }): Promise<PairBoardResponse>;
  /**
   * Pairs a waiting board with the real board whose pairing code this is (the text of the QR code
   * its setup page showed). The real board must be the same product.
   */
  pairBoard(propertyId: string, boardId: string, pairingCode: string): Promise<PairBoardResponse>;
  /** Removes a board with all its devices; the board must be paired again to be used. */
  removeBoard(propertyId: string, boardId: string): Promise<void>;

  /** Demo only: removes one of the demo's original sample devices (they have no board). */
  removeDemoDevice?(propertyId: string, deviceId: string): Promise<void>;
  /** Demo only: the sample QR code of a waiting board's product, to save and upload. */
  demoPairingSample?(boardId: string): { label: string; image: string } | null;
}
