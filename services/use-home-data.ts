"use client";

/**
 * A home's data for the app shell: homes, rooms and devices from the gateway, and the commands on
 * their way to the devices.
 *
 * A control shows a command's target right away, marked as sending, and keeps following the
 * command until the ESP32 reports it (applied) or it fails. It waits as long as the command itself
 * allows (its expiresAt: seconds for a light, minutes for a parking door) plus a margin for a slow
 * connection, and tolerates failed status requests in between. Only then does the control fall
 * back to the last reported value. The device list is refreshed every 15 seconds while the page is
 * visible, which picks up wall-switch presses and sensor changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CapabilityName, CapabilityValue, Command, CommandStatus, Device, Property, Room } from "@m2smart/contracts";
import { isFinalStatus } from "@/services/api-gateway";
import { GatewayError, type GatewayErrorCode, type HomeGateway } from "@/services/home-gateway";

const POLL_MS = 1_000;
const REFRESH_MS = 15_000;
/** Extra wait past a command's deadline before giving up on hearing its result. */
const DEADLINE_MARGIN_MS = 10_000;

export type PendingCommand = {
  deviceId: string;
  capability: CapabilityName;
  target: CapabilityValue;
  commandId: string | null;
  status: CommandStatus;
  acknowledged: boolean;
  expiresAt: number;
};

export type CommandOutcome = { device: Device; capability: CapabilityName; target: CapabilityValue; status: CommandStatus | "not_sent"; error?: GatewayErrorCode };

const keyOf = (deviceId: string, capability: CapabilityName) => `${deviceId}:${capability}`;
const codeOf = (error: unknown): GatewayErrorCode => (error instanceof GatewayError ? error.code : "network");

export function useHomeData(gateway: HomeGateway, requestedPropertyId: string | null, onOutcome: (outcome: CommandOutcome) => void) {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [loadError, setLoadError] = useState<GatewayErrorCode | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [pending, setPending] = useState<Record<string, PendingCommand>>({});
  const pendingRef = useRef(pending);
  const devicesRef = useRef(devices);
  const outcomeRef = useRef(onOutcome);
  pendingRef.current = pending;
  devicesRef.current = devices;
  outcomeRef.current = onOutcome;

  const property = properties?.find((item) => item.id === requestedPropertyId) ?? properties?.[0] ?? null;
  const propertyId = property?.id ?? null;

  const loadProperties = useCallback(async () => {
    try {
      setProperties(await gateway.listProperties());
      setLoadError(null);
    } catch (error) {
      setLoadError(codeOf(error));
    }
  }, [gateway]);

  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);

  const refreshDevices = useCallback(async () => {
    if (!propertyId) return;
    try {
      setDevices(await gateway.listDevices(propertyId));
    } catch {
      // Keep showing the last known state; the next refresh tries again.
    }
  }, [gateway, propertyId]);

  // Load the selected home's rooms and devices.
  useEffect(() => {
    if (!propertyId) {
      setRooms([]);
      setDevices([]);
      return;
    }
    let current = true;
    setHomeLoading(true);
    setPending({});
    Promise.all([gateway.listRooms(propertyId), gateway.listDevices(propertyId)])
      .then(([nextRooms, nextDevices]) => {
        if (!current) return;
        setRooms(nextRooms);
        setDevices(nextDevices);
      })
      .catch(() => {
        if (current) setLoadError("unavailable");
      })
      .finally(() => {
        if (current) setHomeLoading(false);
      });
    return () => {
      current = false;
    };
  }, [gateway, propertyId]);

  // Periodic refresh while visible (reports that arrive without a command).
  useEffect(() => {
    if (!propertyId) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refreshDevices();
    };
    const timer = window.setInterval(refreshIfVisible, REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [propertyId, refreshDevices]);

  const finish = useCallback((key: string, entry: PendingCommand, status: CommandStatus) => {
    setPending((current) => {
      if (current[key]?.commandId !== entry.commandId) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (status === "applied") {
      const reportedAt = new Date().toISOString();
      setDevices((current) =>
        current.map((device) =>
          device.id !== entry.deviceId
            ? device
            : { ...device, capabilities: device.capabilities.map((state) => (state.capability === entry.capability ? { ...state, value: entry.target, reportedAt } : state)) },
        ),
      );
    }
    const device = devicesRef.current.find((item) => item.id === entry.deviceId);
    if (device) outcomeRef.current({ device, capability: entry.capability, target: entry.target, status });
  }, []);

  // Follow every command on its way until it is final or past its deadline.
  useEffect(() => {
    if (!propertyId) return;
    const timer = window.setInterval(() => {
      for (const [key, entry] of Object.entries(pendingRef.current)) {
        if (!entry.commandId) continue;
        if (Date.now() > entry.expiresAt + DEADLINE_MARGIN_MS) {
          finish(key, entry, "timed_out");
          continue;
        }
        gateway.getCommand(propertyId, entry.commandId).then(
          (command: Command) => {
            if (isFinalStatus(command.status)) finish(key, entry, command.status);
            else
              setPending((current) =>
                current[key]?.commandId === command.id ? { ...current, [key]: { ...current[key], status: command.status, acknowledged: Boolean(command.acknowledgedAt) } } : current,
              );
          },
          () => undefined, // A lost status request is retried on the next tick.
        );
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [gateway, propertyId, finish]);

  const sendCommand = useCallback(
    async (device: Device, capability: CapabilityName, target: CapabilityValue) => {
      if (!propertyId) return;
      const key = keyOf(device.id, capability);
      const placeholder: PendingCommand = { deviceId: device.id, capability, target, commandId: null, status: "pending", acknowledged: false, expiresAt: Date.now() + 60_000 };
      setPending((current) => ({ ...current, [key]: placeholder }));
      try {
        const command = await gateway.sendCommand(propertyId, { deviceId: device.id, capability, targetValue: target, idempotencyKey: crypto.randomUUID() });
        setPending((current) =>
          current[key] === placeholder
            ? { ...current, [key]: { ...placeholder, commandId: command.id, status: command.status, expiresAt: Date.parse(command.expiresAt) } }
            : current,
        );
      } catch (error) {
        setPending((current) => {
          if (current[key] !== placeholder) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
        outcomeRef.current({ device, capability, target, status: "not_sent", error: codeOf(error) });
      }
    },
    [gateway, propertyId],
  );

  /** What a control shows: the target of a command on its way, else the reported value. */
  const valueOf = useCallback(
    (device: Device, capability: CapabilityName): CapabilityValue | null =>
      pending[keyOf(device.id, capability)]?.target ?? device.capabilities.find((state) => state.capability === capability)?.value ?? null,
    [pending],
  );

  /** "sending" until the hub has it, "working" while the hardware carries it out (e.g. a door moving). */
  const activityOf = useCallback(
    (device: Device): "sending" | "working" | null => {
      const entries = Object.values(pending).filter((entry) => entry.deviceId === device.id);
      if (!entries.length) return null;
      return entries.some((entry) => entry.status === "sent" && entry.acknowledged) ? "working" : "sending";
    },
    [pending],
  );

  return {
    properties,
    property,
    propertyId,
    loadError,
    homeLoading,
    rooms,
    devices,
    pending,
    valueOf,
    activityOf,
    sendCommand,
    refreshDevices,
    reloadProperties: loadProperties,
    setProperties,
    setRooms,
    setDevices,
  };
}
