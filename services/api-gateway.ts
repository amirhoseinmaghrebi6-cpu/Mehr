/**
 * HomeGateway over the M2smart API, same-origin through the web app (/api/v1/* is proxied to the
 * API; the session cookie goes along automatically).
 *
 * Built for a slow or interrupted connection: every request has a timeout, and sending a command
 * is retried a few times with the same idempotency key, so a command that did arrive is never
 * created twice while one that got lost is still delivered.
 */
import type { ApiErrorResponse, Command, CommandStatus, Device, PairBoardResponse, Property, Room, Scenario, ScenarioRunResponse, UserSettings } from "@m2smart/contracts";
import { GatewayError, type GatewayErrorCode, type HomeGateway } from "@/services/home-gateway";

const BASE = "/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const COMMAND_ATTEMPTS = 3;

const errorCodes: Record<ApiErrorResponse["error"], GatewayErrorCode> = {
  unauthenticated: "unauthenticated",
  auth_unavailable: "unavailable",
  forbidden: "forbidden",
  not_found: "not_found",
  invalid_request: "invalid_request",
  conflict: "conflict",
  internal_error: "unavailable",
};

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      signal: controller.signal,
      // No content-type without a body: the API rejects an empty JSON body.
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new GatewayError((error as Error).name === "AbortError" ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload as T;
  if (response.status >= 500 && !(payload as ApiErrorResponse | null)?.error) throw new GatewayError("unavailable");
  throw new GatewayError(errorCodes[(payload as ApiErrorResponse | null)?.error ?? "internal_error"] ?? "unavailable");
}

const retryable = (error: unknown) => error instanceof GatewayError && ["network", "timeout", "unavailable"].includes(error.code);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createApiGateway(): HomeGateway {
  return {
    listProperties: async () => (await request<{ properties: Property[] }>("GET", "/properties")).properties,
    createProperty: (input) => request<Property>("POST", "/properties", input),
    updateProperty: (id, input) => request<Property>("PATCH", `/properties/${id}`, input),
    deleteProperty: (id) => request<void>("DELETE", `/properties/${id}`),

    listRooms: async (id) => (await request<{ rooms: Room[] }>("GET", `/properties/${id}/rooms`)).rooms,
    createRoom: (id, input) => request<Room>("POST", `/properties/${id}/rooms`, input),
    updateRoom: (id, roomId, input) => request<Room>("PATCH", `/properties/${id}/rooms/${roomId}`, input),
    deleteRoom: (id, roomId) => request<void>("DELETE", `/properties/${id}/rooms/${roomId}`),

    listDevices: async (id) => (await request<{ devices: Device[] }>("GET", `/properties/${id}/devices`)).devices,
    updateDevice: (id, deviceId, input) => request<Device>("PATCH", `/properties/${id}/devices/${deviceId}`, input),

    async sendCommand(id, input) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await request<Command>("POST", `/properties/${id}/commands`, input);
        } catch (error) {
          if (!retryable(error) || attempt >= COMMAND_ATTEMPTS) throw error;
          await wait(1_000 * attempt);
        }
      }
    },
    getCommand: (id, commandId) => request<Command>("GET", `/properties/${id}/commands/${commandId}`),

    listScenarios: async (id) => (await request<{ scenarios: Scenario[] }>("GET", `/properties/${id}/scenarios`)).scenarios,
    createScenario: (id, input) => request<Scenario>("POST", `/properties/${id}/scenarios`, input),
    updateScenario: (id, scenarioId, input) => request<Scenario>("PUT", `/properties/${id}/scenarios/${scenarioId}`, input),
    setScenarioEnabled: (id, scenarioId, enabled) => request<Scenario>("PATCH", `/properties/${id}/scenarios/${scenarioId}`, { enabled }),
    deleteScenario: (id, scenarioId) => request<void>("DELETE", `/properties/${id}/scenarios/${scenarioId}`),
    // Not retried: a lost reply could otherwise run the scenario twice.
    runScenario: (id, scenarioId) => request<ScenarioRunResponse>("POST", `/properties/${id}/scenarios/${scenarioId}/run`),

    // Not retried: a pairing code works once.
    pairBoard: (id, pairingCode) => request<PairBoardResponse>("POST", `/properties/${id}/boards`, { pairingCode }),

    getSettings: () => request<UserSettings>("GET", "/me/settings"),
    updateSettings: (input) => request<UserSettings>("PATCH", "/me/settings", input),
  };
}

export const isFinalStatus = (status: CommandStatus) => status === "applied" || status === "rejected" || status === "failed" || status === "timed_out";
