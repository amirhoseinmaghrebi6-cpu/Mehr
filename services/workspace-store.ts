import {
  devices as starterDevices,
  getMockHomeSnapshot,
  properties as starterProperties,
  rooms as starterRooms,
  type Device,
  type HomeSnapshot,
  type Property,
  type Room,
} from "@/services/mock-home-service";

const STORAGE_KEY = "m2smart-workspace-v1";
const VERSION = 1;

function storageKey(userId: string): string {
  return `${STORAGE_KEY}-${userId}`;
}

export type HomeWorkspace = {
  version: typeof VERSION;
  properties: Property[];
  roomsByProperty: Record<string, Room[]>;
  devicesByProperty: Record<string, Device[]>;
};

export function createDefaultWorkspace(): HomeWorkspace {
  const copyRooms = () => starterRooms.map((room) => ({ ...room }));
  const copyDevices = () => starterDevices.map((device) => ({ ...device }));

  return {
    version: VERSION,
    properties: starterProperties.map((property) => ({ ...property })),
    roomsByProperty: Object.fromEntries(starterProperties.map((property) => [property.id, copyRooms()])),
    devicesByProperty: Object.fromEntries(starterProperties.map((property) => [property.id, copyDevices()])),
  };
}

export function loadWorkspace(userId: string): HomeWorkspace {
  if (typeof window === "undefined") return createDefaultWorkspace();

  try {
    const stored = window.localStorage.getItem(storageKey(userId));
    if (!stored) return createDefaultWorkspace();

    const workspace = JSON.parse(stored) as HomeWorkspace;
    if (
      workspace.version !== VERSION ||
      !Array.isArray(workspace.properties) ||
      workspace.properties.length === 0 ||
      !workspace.roomsByProperty ||
      !workspace.devicesByProperty
    ) {
      return createDefaultWorkspace();
    }

    return workspace;
  } catch {
    return createDefaultWorkspace();
  }
}

export function saveWorkspace(workspace: HomeWorkspace, userId: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(workspace));
  } catch {
    // Storage may be unavailable or full; keep the current in-memory workspace usable.
  }
}

export function getWorkspaceSnapshot(propertyId: string, workspace: HomeWorkspace): HomeSnapshot {
  const base = getMockHomeSnapshot(propertyId);
  const rooms = workspace.roomsByProperty[propertyId] ?? [];
  const storedDevices = workspace.devicesByProperty[propertyId] ?? [];
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const devices = storedDevices.map((device) => ({
    ...device,
    room: roomById.get(device.roomId)?.name ?? device.room,
  }));

  return {
    ...base,
    rooms: rooms.map((room) => ({
      ...room,
      activeDevices: devices.filter((device) => device.roomId === room.id && device.online).length,
    })),
    devices,
  };
}
