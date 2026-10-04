/**
 * Development-only stand-in for real ESP32 boards, until the firmware exists (Phases 6–7).
 * Enabled only with NODE_ENV=development and M2SMART_DEV_BOARD_SIMULATOR=true; it never runs in
 * production.
 *
 * Each simulated board is a real client of the broker and follows docs/board-protocol.md, so the
 * server side it talks to is exactly the path real boards will use: it logs in with its own
 * account, says it is online, reports its channels, receives commands, acknowledges them, waits
 * as long as the hardware would (a parking door takes tens of seconds), and reports the value.
 * Like a real board, it carries out one channel's commands one after another, refuses to record
 * on a camera that is off, and stops recording when the camera is switched off.
 *
 * Only simulated boards are played: those whose hardware id starts with "DEV-" (created by
 * pnpm db:seed and pnpm dev:board). Boards added while it runs are picked up within seconds.
 *
 * Until step 4D moves it to its own server job, it also runs due scenarios for those homes.
 */
import { randomBytes } from "node:crypto";
import { boardCommand, boardTopic, type BoardCommand, type CapabilityValue } from "@m2smart/contracts";
import mqtt, { type MqttClient } from "mqtt";
import type { Pool } from "pg";
import type { Broker } from "../broker/broker";
import { withSystemTx } from "../db/tx";
import { runDueScenarios } from "../scenarios/run";

type Log = { info: (object: object, message: string) => void; error: (object: object, message: string) => void };

/** How long the simulated hardware takes to finish a command, by device type. */
const HARDWARE_DELAY_MS: Record<string, number> = { garage_door: 25_000, curtain: 20_000, cooler: 1_000, fan: 1_000 };
const DEFAULT_HARDWARE_DELAY_MS = 300;
/** Simulated network delay between the broker and the board (each way), in ms. */
const NETWORK_DELAY_MS: [min: number, max: number] = [200, 1_200];

/** Hardware ids of simulated boards start with this. */
export const SIMULATED_BOARD_PREFIX = "DEV-";

export type BoardSimulatorOptions = {
  boardPrefix?: string;
  delays?: Record<string, number>;
  defaultDelayMs?: number;
  networkDelayMs?: [number, number];
  /** How often new or removed simulated boards are looked for. */
  rescanMs?: number;
  /** How often due scenarios are checked; 0 switches the scenario runner off. */
  scenarioPollMs?: number;
};

export type BoardSimulator = { stop: () => Promise<void> };

type Channel = { deviceType: string; capabilities: Set<string> };
type SimulatedBoard = { client: MqttClient; channels: Map<string, Channel>; values: Map<string, CapabilityValue>; queues: Map<string, Promise<void>> };

export function startBoardSimulator(pool: Pool, broker: Broker, brokerUrl: string, log: Log, options: BoardSimulatorOptions = {}): BoardSimulator {
  const boardPrefix = options.boardPrefix ?? SIMULATED_BOARD_PREFIX;
  const [networkMin, networkMax] = options.networkDelayMs ?? NETWORK_DELAY_MS;
  const networkDelay = () => networkMin + Math.random() * (networkMax - networkMin);
  const delays = options.delays ?? HARDWARE_DELAY_MS;
  const defaultDelay = options.defaultDelayMs ?? DEFAULT_HARDWARE_DELAY_MS;
  const boards = new Map<string, SimulatedBoard>();
  let stopped = false;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const failed = (what: string, boardId?: string) => (error: Error) => {
    if (!stopped) log.error({ err: { message: error.message }, boardId }, what);
  };

  /** Logs the board in with a fresh secret, as if it had just been paired, and brings it online. */
  async function connectBoard(boardId: string): Promise<void> {
    const { rows } = await withSystemTx(pool, (tx) =>
      tx.query<{ channel_key: string; device_type: string; capability: string; value: CapabilityValue | null }>(
        `select device.channel_key, device.device_type, capability.capability, state.value
         from public.devices as device
         join public.device_capabilities as capability on capability.device_id = device.id
         left join public.device_states as state on state.device_id = device.id and state.capability = capability.capability
         where device.controller_id = $1`,
        [boardId],
      ),
    );
    const channels = new Map<string, Channel>();
    const values = new Map<string, CapabilityValue>();
    for (const row of rows) {
      const channel = channels.get(row.channel_key) ?? { deviceType: row.device_type, capabilities: new Set<string>() };
      channel.capabilities.add(row.capability);
      channels.set(row.channel_key, channel);
      if (row.value !== null) values.set(`${row.channel_key}:${row.capability}`, row.value);
    }

    const secret = randomBytes(24).toString("base64url");
    await broker.setBoardSecret(boardId, secret);
    const client = await mqtt.connectAsync(brokerUrl, {
      username: boardId,
      password: secret,
      clientId: boardId,
      keepalive: 30,
      reconnectPeriod: 2_000,
      will: { topic: boardTopic(boardId, "status"), payload: Buffer.from(JSON.stringify({ online: false })), qos: 1, retain: true },
    });
    const board: SimulatedBoard = { client, channels, values, queues: new Map() };
    boards.set(boardId, board);
    client.on("error", failed("Board simulator: connection error", boardId));
    client.on("message", (_topic, message) => onCommand(boardId, board, message.toString()));
    const announce = async () => {
      await client.subscribeAsync(boardTopic(boardId, "cmd"), { qos: 1 });
      await client.publishAsync(boardTopic(boardId, "status"), JSON.stringify({ online: true, fw: "simulated" }), { qos: 1, retain: true });
      const snapshot = [...board.values].map(([key, val]) => ({ ch: key.split(":")[0], cap: key.split(":")[1], val }));
      if (snapshot.length) await client.publishAsync(boardTopic(boardId, "state"), JSON.stringify({ values: snapshot }), { qos: 1 });
    };
    client.on("connect", () => void announce().catch(failed("Board simulator: could not announce", boardId)));
    await announce();
  }

  function onCommand(boardId: string, board: SimulatedBoard, text: string): void {
    let command: BoardCommand;
    try {
      const parsed = boardCommand.safeParse(JSON.parse(text));
      if (!parsed.success) return;
      command = parsed.data;
    } catch {
      return;
    }
    const received = Date.now();
    const send = (kind: "ack" | "state", payload: object) => board.client.publishAsync(boardTopic(boardId, kind), JSON.stringify(payload), { qos: 1 });
    const carryOut = async () => {
      // The message reaches the board ...
      await wait(networkDelay());
      if (stopped || Date.now() - received > command.ttl * 1000) return;
      const channel = board.channels.get(command.ch);
      if (!channel?.capabilities.has(command.cap)) return void (await send("ack", { id: command.id, err: "unknown_target" }));
      if (channel.deviceType === "camera" && command.cap === "recording" && command.val === true && board.values.get(`${command.ch}:power`) !== true) {
        return void (await send("ack", { id: command.id, err: "camera_off" }));
      }
      await send("ack", { id: command.id });
      // ... the hardware takes its time, then the report travels back.
      await wait((delays[channel.deviceType] ?? defaultDelay) + networkDelay());
      if (stopped) return;
      const values = [{ ch: command.ch, cap: command.cap, val: command.val }];
      if (channel.deviceType === "camera" && command.cap === "power" && command.val === false) values.push({ ch: command.ch, cap: "recording", val: false });
      for (const entry of values) board.values.set(`${entry.ch}:${entry.cap}`, entry.val);
      await send("state", { id: command.id, values });
    };
    const queued = (board.queues.get(command.ch) ?? Promise.resolve()).then(carryOut).catch(failed("Board simulator: command failed", boardId));
    board.queues.set(command.ch, queued);
  }

  let scanning = false;
  const scan = async () => {
    if (scanning || stopped) return;
    scanning = true;
    try {
      const { rows } = await withSystemTx(pool, (tx) => tx.query<{ id: string }>("select id from public.controllers where starts_with(hardware_uid, $1)", [boardPrefix]));
      const current = new Set(rows.map((row) => row.id));
      for (const id of current) if (!boards.has(id) && !stopped) await connectBoard(id).catch(failed("Board simulator: could not connect a board", id));
      // A board that left its home (removed, or the home was deleted) goes away here too.
      for (const [id, board] of boards) {
        if (current.has(id)) continue;
        boards.delete(id);
        await board.client.endAsync(true).catch(() => undefined);
        await broker.removeBoard(id).catch(failed("Board simulator: could not remove a board", id));
      }
    } catch (error) {
      failed("Board simulator: scan failed")(error as Error);
    } finally {
      scanning = false;
    }
  };
  void scan();
  const scanTimer = setInterval(() => void scan(), options.rescanMs ?? 3_000);
  scanTimer.unref();

  const scenarioPollMs = options.scenarioPollMs ?? 5_000;
  let checkingScenarios = false;
  const checkScenarios = async () => {
    if (checkingScenarios || stopped) return;
    checkingScenarios = true;
    try {
      for (const outcome of await runDueScenarios(pool, { boardPrefix })) {
        log.info({ scenarioId: outcome.scenarioId, scheduledFor: outcome.scheduledFor.toISOString(), status: outcome.status, commands: outcome.commandIds.length }, "Board simulator: scenario");
      }
    } catch (error) {
      failed("Board simulator: scenario check failed")(error as Error);
    } finally {
      checkingScenarios = false;
    }
  };
  const scenarioTimer = scenarioPollMs > 0 ? setInterval(() => void checkScenarios(), scenarioPollMs) : null;
  scenarioTimer?.unref();
  log.info({ boardPrefix, scenarioPollMs }, "Board simulator started: simulated ESP32 boards connect to the broker");

  return {
    async stop() {
      stopped = true;
      clearInterval(scanTimer);
      if (scenarioTimer) clearInterval(scenarioTimer);
      for (const [boardId, board] of boards) {
        // A clean goodbye does not trigger the last will, so say offline first.
        await board.client.publishAsync(boardTopic(boardId, "status"), JSON.stringify({ online: false }), { qos: 1, retain: true }).catch(() => undefined);
        await board.client.endAsync().catch(() => undefined);
      }
      boards.clear();
    },
  };
}
