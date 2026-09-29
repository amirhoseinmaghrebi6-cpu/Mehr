/**
 * HomeGateway for the demo account: the sample homes live in this browser (localStorage), and
 * commands go through the same stages as real ones (pending → sent → acknowledged → applied), with
 * the hardware's time (a parking door takes seconds, not milliseconds). Nothing reaches the API.
 */
import { capabilities, capabilityValueError, type Command, type CommandStatus, type Device, type Property, type Room } from "@m2smart/contracts";
import { GatewayError, type HomeGateway } from "@/services/home-gateway";
import { createDemoData, demoDevice, type DemoData } from "@/services/demo-home";

const STORAGE_PREFIX = "m2smart-demo-home-v2-";
/** Same deadline rule as the database: 30 s for the network + the hardware's own time. */
const ACTION_SECONDS: Record<string, number> = { garage_door: 120, curtain: 90, cooler: 10, fan: 10 };
/** Shorter than real hardware, so the demo stays pleasant, but clearly not instant. */
const DEMO_HARDWARE_MS: Record<string, number> = { garage_door: 8_000, curtain: 6_000, cooler: 1_200, fan: 1_200, alarm: 1_000 };

const clone = <T>(value: T): T => structuredClone(value);
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDemoGateway(userId: string): HomeGateway {
  const key = `${STORAGE_PREFIX}${userId}`;
  let data: DemoData = load();
  const commands = new Map<string, Command & { propertyId: string; idempotencyKey: string }>();

  function load(): DemoData {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) return JSON.parse(stored) as DemoData;
    } catch {
      // Storage unavailable or corrupt: start from the sample homes.
    }
    return createDemoData();
  }
  function save(): void {
    try {
      window.localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Storage may be full or blocked; the demo keeps working in memory.
    }
  }
  function home(propertyId: string) {
    const property = data.properties.find((item) => item.id === propertyId);
    if (!property) throw new GatewayError("not_found");
    return property;
  }
  const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

  async function runCommand(command: Command & { propertyId: string }, deviceType: string): Promise<void> {
    const step = (status: CommandStatus, extra: Partial<Command> = {}) => Object.assign(command, { status, ...extra });
    await later(300 + Math.random() * 600);
    step("sent");
    await later(200 + Math.random() * 400);
    step("sent", { acknowledgedAt: new Date().toISOString() });
    await later(DEMO_HARDWARE_MS[deviceType] ?? 250);
    const device = (data.devices[command.propertyId] ?? []).find((item) => item.id === command.deviceId);
    const state = device?.capabilities.find((entry) => entry.capability === command.capability);
    if (!device || !state || Date.now() > Date.parse(command.expiresAt)) {
      step("timed_out", { completedAt: new Date().toISOString(), errorCode: "timeout" });
      return;
    }
    state.value = command.targetValue;
    state.reportedAt = new Date().toISOString();
    save();
    step("applied", { completedAt: new Date().toISOString() });
  }

  return {
    async listProperties() {
      return clone(data.properties);
    },
    async createProperty(input) {
      const property: Property = { id: newId("home"), name: input.name.trim(), type: input.type ?? "house", address: input.address?.trim() ?? "", coverPhoto: input.coverPhoto ?? "living", role: "owner" };
      data.properties.push(property);
      data.rooms[property.id] = [];
      data.devices[property.id] = [];
      save();
      return clone(property);
    },
    async updateProperty(propertyId, input) {
      const property = home(propertyId);
      Object.assign(property, Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)));
      save();
      return clone(property);
    },
    async deleteProperty(propertyId) {
      home(propertyId);
      data = { properties: data.properties.filter((item) => item.id !== propertyId), rooms: { ...data.rooms }, devices: { ...data.devices } };
      delete data.rooms[propertyId];
      delete data.devices[propertyId];
      save();
    },

    async listRooms(propertyId) {
      home(propertyId);
      return clone(data.rooms[propertyId] ?? []);
    },
    async createRoom(propertyId, input) {
      home(propertyId);
      const rooms = (data.rooms[propertyId] ??= []);
      if (rooms.some((room) => room.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new GatewayError("conflict");
      const room: Room = { id: newId("room"), name: input.name.trim(), photo: input.photo ?? "living", sortOrder: rooms.length };
      rooms.push(room);
      save();
      return clone(room);
    },
    async updateRoom(propertyId, roomId, input) {
      const rooms = data.rooms[propertyId] ?? [];
      const room = rooms.find((item) => item.id === roomId);
      if (!room) throw new GatewayError("not_found");
      if (input.name && rooms.some((item) => item.id !== roomId && item.name.trim().toLowerCase() === input.name!.trim().toLowerCase())) throw new GatewayError("conflict");
      Object.assign(room, Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)));
      save();
      return clone(room);
    },
    async deleteRoom(propertyId, roomId) {
      data.rooms[propertyId] = (data.rooms[propertyId] ?? []).filter((room) => room.id !== roomId);
      for (const device of data.devices[propertyId] ?? []) if (device.roomId === roomId) device.roomId = null;
      save();
    },

    async listDevices(propertyId) {
      home(propertyId);
      return clone(data.devices[propertyId] ?? []);
    },
    async updateDevice(propertyId, deviceId, input) {
      const device = (data.devices[propertyId] ?? []).find((item) => item.id === deviceId);
      if (!device) throw new GatewayError("not_found");
      if (input.name !== undefined) device.name = input.name.trim();
      if (input.roomId !== undefined) device.roomId = input.roomId;
      save();
      return clone(device);
    },

    async sendCommand(propertyId, input) {
      home(propertyId);
      const existing = [...commands.values()].find((command) => command.propertyId === propertyId && command.idempotencyKey === input.idempotencyKey);
      if (existing) return clone(existing);
      const device = (data.devices[propertyId] ?? []).find((item) => item.id === input.deviceId);
      if (!device) throw new GatewayError("not_found");
      const state = device.capabilities.find((entry) => entry.capability === input.capability);
      if (!state || !state.writable || capabilityValueError(capabilities[input.capability], input.targetValue) !== null) throw new GatewayError("invalid_request");
      const now = Date.now();
      const command = {
        id: newId("command"),
        propertyId,
        idempotencyKey: input.idempotencyKey,
        deviceId: input.deviceId,
        capability: input.capability,
        targetValue: input.targetValue,
        status: "pending" as CommandStatus,
        acknowledgedAt: null,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + (30 + (ACTION_SECONDS[device.type] ?? 0)) * 1000).toISOString(),
        completedAt: null,
        errorCode: null,
      };
      commands.set(command.id, command);
      void runCommand(command, device.type);
      return clone(command);
    },
    async getCommand(propertyId, commandId) {
      const command = commands.get(commandId);
      if (!command || command.propertyId !== propertyId) throw new GatewayError("not_found");
      return clone(command);
    },

    async addDemoDevice(propertyId, input) {
      home(propertyId);
      const device = demoDevice(newId("device"), input.type, input.name.trim(), input.roomId);
      (data.devices[propertyId] ??= []).push(device);
      save();
      return clone(device) as Device;
    },
    async removeDemoDevice(propertyId, deviceId) {
      data.devices[propertyId] = (data.devices[propertyId] ?? []).filter((device) => device.id !== deviceId);
      save();
    },
  };
}
