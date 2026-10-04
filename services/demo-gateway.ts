/**
 * HomeGateway for the demo account: the sample homes live in this browser (localStorage), and
 * commands go through the same stages as real ones (pending → sent → acknowledged → applied), with
 * the hardware's time (a parking door takes seconds, not milliseconds). Nothing reaches the API.
 */
import {
  capabilities,
  capabilityValueError,
  DEFAULT_SCENARIO_LATE_WINDOW,
  defaultSettings,
  defaultTimeZone,
  deviceTypeCategory,
  isDeviceType,
  parsePairingCode,
  type Command,
  type CommandStatus,
  type Property,
  type Room,
  type Scenario,
  type ScenarioRequest,
  type UserSettings,
} from "@m2smart/contracts";
import { GatewayError, type HomeGateway } from "@/services/home-gateway";
import { nextRun } from "@/lib/scenario-time";
import { createDemoData, createDemoScenarios, demoBoards, demoDevice, type DemoData } from "@/services/demo-home";

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
      if (stored) {
        const saved = JSON.parse(stored) as DemoData;
        // Device types that no longer exist (e.g. the energy meter) leave demo data saved earlier.
        for (const id of Object.keys(saved.devices)) saved.devices[id] = saved.devices[id].filter((device) => isDeviceType(device.type));
        return saved;
      }
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

  // Scenarios follow the same rules as the API. Scheduled ones show their next run but do not run
  // in the demo: scenarios run on the server, and the demo never reaches it.
  function scenariosOf(propertyId: string): Scenario[] {
    home(propertyId);
    data.scenarios ??= createDemoScenarios();
    return (data.scenarios[propertyId] ??= []);
  }
  function withNextRun(propertyId: string, scenario: Scenario): Scenario {
    const at = nextRun(scenario, home(propertyId).timeZone ?? defaultTimeZone);
    return clone({ ...scenario, nextRunAt: at ? at.toISOString() : null });
  }
  function scenarioFrom(propertyId: string, input: ScenarioRequest, id: string, lastRun: Scenario["lastRun"]): Scenario {
    const name = input.name.trim();
    if (!name || name.length > 60 || !input.actions.length) throw new GatewayError("invalid_request");
    if (scenariosOf(propertyId).some((item) => item.id !== id && item.name.trim().toLowerCase() === name.toLowerCase())) throw new GatewayError("conflict");
    for (const action of input.actions) {
      const device = (data.devices[propertyId] ?? []).find((item) => item.id === action.deviceId);
      if (!device) throw new GatewayError("not_found");
      const state = device.capabilities.find((entry) => entry.capability === action.capability);
      if (!state?.writable || capabilityValueError(capabilities[action.capability], action.targetValue) !== null) throw new GatewayError("invalid_request");
    }
    return {
      id,
      name,
      kind: input.kind,
      enabled: input.enabled ?? true,
      weekdays: input.kind === "periodic" ? ([...input.weekdays].sort((a, b) => a - b) as Scenario["weekdays"]) : null,
      time: input.kind === "themed" ? null : input.time,
      date: input.kind === "one_time" ? input.date : null,
      lateWindowSeconds: input.kind === "themed" ? null : (input.lateWindowSeconds ?? DEFAULT_SCENARIO_LATE_WINDOW),
      actions: input.actions.map((action) => ({ ...action })),
      nextRunAt: null,
      lastRun,
    };
  }
  function findScenario(propertyId: string, scenarioId: string): Scenario {
    const scenario = scenariosOf(propertyId).find((item) => item.id === scenarioId);
    if (!scenario) throw new GatewayError("not_found");
    return scenario;
  }

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
    if (device.type === "camera" && command.capability === "power" && command.targetValue === false) {
      const recording = device.capabilities.find((entry) => entry.capability === "recording");
      if (recording) recording.value = false;
    }
    save();
    step("applied", { completedAt: new Date().toISOString() });
  }

  return {
    async listProperties() {
      return clone(data.properties);
    },
    async createProperty(input) {
      const property: Property = { id: newId("home"), name: input.name.trim(), type: input.type ?? "house", address: input.address?.trim() ?? "", coverPhoto: input.coverPhoto ?? "living", timeZone: input.timeZone ?? "Asia/Tehran", role: "owner" };
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
      data = { properties: data.properties.filter((item) => item.id !== propertyId), rooms: { ...data.rooms }, devices: { ...data.devices }, scenarios: { ...data.scenarios } };
      delete data.rooms[propertyId];
      delete data.devices[propertyId];
      if (data.scenarios) delete data.scenarios[propertyId];
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
      if (input.hidden !== undefined) device.hidden = input.hidden;
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
      // Like the API: a board that is not paired yet has no hardware to command.
      if (device.pending) throw new GatewayError("conflict");
      // Like the API: a camera records only while it is on.
      if (device.type === "camera" && input.capability === "recording" && input.targetValue === true && device.capabilities.find((entry) => entry.capability === "power")?.value !== true) {
        throw new GatewayError("conflict");
      }
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

    async listScenarios(propertyId) {
      return scenariosOf(propertyId).map((scenario) => withNextRun(propertyId, scenario));
    },
    async createScenario(propertyId, input) {
      const scenario = scenarioFrom(propertyId, input, newId("scenario"), null);
      scenariosOf(propertyId).push(scenario);
      save();
      return withNextRun(propertyId, scenario);
    },
    async updateScenario(propertyId, scenarioId, input) {
      const scenarios = scenariosOf(propertyId);
      const index = scenarios.findIndex((item) => item.id === scenarioId);
      if (index < 0) throw new GatewayError("not_found");
      scenarios[index] = scenarioFrom(propertyId, input, scenarioId, scenarios[index].lastRun);
      save();
      return withNextRun(propertyId, scenarios[index]);
    },
    async setScenarioEnabled(propertyId, scenarioId, enabled) {
      const scenario = findScenario(propertyId, scenarioId);
      scenario.enabled = enabled;
      save();
      return withNextRun(propertyId, scenario);
    },
    async deleteScenario(propertyId, scenarioId) {
      findScenario(propertyId, scenarioId);
      data.scenarios![propertyId] = scenariosOf(propertyId).filter((item) => item.id !== scenarioId);
      save();
    },
    async runScenario(propertyId, scenarioId) {
      const scenario = findScenario(propertyId, scenarioId);
      if (scenario.kind !== "themed") throw new GatewayError("conflict");
      const commandIds: string[] = [];
      for (const action of scenario.actions) {
        try {
          commandIds.push((await this.sendCommand(propertyId, { ...action, idempotencyKey: crypto.randomUUID() })).id);
        } catch {
          // Like the hub: an action that cannot be carried out does not stop the others.
        }
      }
      scenario.lastRun = { id: newId("run"), trigger: "manual", status: "started", scheduledFor: null, createdAt: new Date().toISOString() };
      save();
      return { run: clone(scenario.lastRun), commandIds };
    },

    // The demo has no account: its preferences stay in this browser.
    async getSettings() {
      try {
        const stored = window.localStorage.getItem(`${key}-settings`);
        if (stored) return { ...defaultSettings, ...(JSON.parse(stored) as Partial<UserSettings>) };
      } catch {
        // Storage unavailable: defaults.
      }
      return { ...defaultSettings };
    },
    async updateSettings(input) {
      const next = { ...(await this.getSettings()), ...input };
      try {
        window.localStorage.setItem(`${key}-settings`, JSON.stringify(next));
      } catch {
        // The preferences still apply in this tab (cookies).
      }
      return next;
    },

    // Adding and pairing in the demo: the same three steps as a real home, with sample products.
    async listProducts() {
      return Object.entries(demoBoards).map(([code, board]) => ({
        code,
        name: board.name,
        category: deviceTypeCategory[board.channels[0][0]],
        channels: board.channels.map(([deviceType, defaultName], index) => ({ key: `ch${index + 1}`, deviceType, defaultName })),
      }));
    },
    async addBoard(propertyId, input) {
      home(propertyId);
      const board = demoBoards[input.modelCode];
      if (!board) throw new GatewayError("not_found");
      const boardId = newId("board");
      const devices = board.channels.map(([type, name, values], index) => {
        const chosen = input.channels.find((channel) => channel.key === `ch${index + 1}`);
        return { ...demoDevice(newId("device"), type, chosen?.name.trim() || name, chosen?.roomId ?? null, values), boardId, boardName: board.name, online: false, pending: true };
      });
      (data.devices[propertyId] ??= []).push(...devices);
      (data.waitingBoards ??= {})[boardId] = input.modelCode;
      save();
      return { boardId, boardName: board.name, devices: clone(devices) };
    },
    async pairBoard(propertyId, boardId, pairingCode) {
      home(propertyId);
      const product = data.waitingBoards?.[boardId];
      const parsed = parsePairingCode(pairingCode);
      if (!product || !parsed || !demoBoards[parsed.hardwareUid]) throw new GatewayError("not_found");
      // Like the API: the real board must be the product that was picked.
      if (parsed.hardwareUid !== product) throw new GatewayError("conflict");
      await later(700);
      const now = new Date().toISOString();
      const devices = (data.devices[propertyId] ?? []).filter((device) => device.boardId === boardId);
      for (const device of devices) Object.assign(device, { pending: false, online: true, lastSeenAt: now });
      delete data.waitingBoards![boardId];
      save();
      return { boardId, boardName: demoBoards[product].name, devices: clone(devices) };
    },
    demoPairingSample(boardId) {
      const product = data.waitingBoards?.[boardId];
      return product ? { label: demoBoards[product].name, image: demoBoards[product].image } : null;
    },
    async removeBoard(propertyId, boardId) {
      const devices = data.devices[propertyId] ?? [];
      const removed = new Set(devices.filter((device) => device.boardId === boardId).map((device) => device.id));
      if (!removed.size) throw new GatewayError("not_found");
      data.devices[propertyId] = devices.filter((device) => !removed.has(device.id));
      if (data.waitingBoards) delete data.waitingBoards[boardId];
      // Like the database: actions on the board's devices go with it.
      for (const scenario of scenariosOf(propertyId)) scenario.actions = scenario.actions.filter((action) => !removed.has(action.deviceId));
      save();
    },

    async removeDemoDevice(propertyId, deviceId) {
      data.devices[propertyId] = (data.devices[propertyId] ?? []).filter((device) => device.id !== deviceId);
      // Like the database: actions on a removed device go with it.
      for (const scenario of scenariosOf(propertyId)) scenario.actions = scenario.actions.filter((action) => action.deviceId !== deviceId);
      save();
    },
  };
}
