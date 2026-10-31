/**
 * Pairing a board with a home (docs/board-protocol.md, "Pairing"):
 *   GET  /v1/hardware-products                                   (the products a home can add)
 *   POST /v1/properties/:propertyId/boards                       (owner, admin: adds a product; its
 *                                                                 devices wait for their real board)
 *   POST /v1/properties/:propertyId/boards/:boardId/setup-code   (owner, admin: a setup code for it)
 *   POST /v1/boards/claim                                        (the board: uses the code, gets its
 *                                                                 broker account)
 *   DELETE /v1/properties/:propertyId/boards/:boardId            (owner, admin: removes the board)
 *
 * Removing a board from the app does what a factory reset does on the server: the board, all its
 * devices and everything about them are deleted, and its broker account is closed. The physical
 * board then has to be paired again to be used.
 *
 * The claim route has no user session: the board proves itself with its factory secret. A wrong
 * secret, an unknown board and a wrong code all get the same answer, and a board gets
 * CLAIM_TRIES_PER_HOUR wrong answers an hour; then 429 until the hour has passed.
 */
import {
  addBoardRequest,
  boardClaimRequest,
  boardSetupUrl,
  deviceTypeCategory,
  isDeviceType,
  normalizeSetupCode,
  type BoardClaimResponse,
  type DeviceType,
  type HardwareProductListResponse,
  type PairBoardResponse,
  type SetupCodeResponse,
} from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SessionVerifier } from "../auth/session-verifier";
import { addPendingBoard, claimBoard, createSetupCode, removeBoard } from "../boards/pairing";
import { withSystemTx } from "../db/tx";
import type { Broker } from "../broker/broker";
import { listDevices } from "./devices";
import { createHandler, HttpError, invalidRequest, notFound, parse, requireAction, requireUuid } from "./route-helpers";

const CLAIM_TRIES_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export function registerBoardRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier | undefined, getBroker: () => Broker | null): void {
  const refused = { error: "unauthenticated" } as const;
  const unavailable = { error: "internal_error" } as const;

  // ponytail: wrong tries are counted in memory, per API process and forgotten on a restart;
  // move them to the database if the API ever runs more than one copy.
  const wrongTries = new Map<string, number[]>();
  app.post("/v1/boards/claim", async (request, reply) => {
    const body = boardClaimRequest.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const { hardwareUid, secret, code } = body.data;
    const now = Date.now();
    const recent = (wrongTries.get(hardwareUid) ?? []).filter((time) => now - time < HOUR_MS);
    if (recent.length >= CLAIM_TRIES_PER_HOUR) return reply.code(429).send({ error: "rate_limited" });
    const broker = getBroker();
    if (!broker) return reply.code(503).send(unavailable);
    const result = await claimBoard(pool, broker, hardwareUid, secret, code);
    if (result === "refused") {
      wrongTries.set(hardwareUid, [...recent, now]);
      return reply.code(401).send(refused);
    }
    // The code waits for another product: the user picked the wrong one in the app.
    if (result === "mismatch") return reply.code(409).send({ error: "conflict" });
    return reply.code(200).send(result satisfies BoardClaimResponse);
  });

  if (!verifier) return;
  const handle = createHandler(pool, verifier);
  app.get("/v1/hardware-products", (request, reply) =>
    handle(request, reply, 200, async (): Promise<HardwareProductListResponse> => {
      // The catalog is the same for everyone; pins stay backend-only, so it is read as the system.
      const { rows } = await withSystemTx(pool, (system) =>
        system.query<{ code: string; name: string; channels: Array<{ key: string; deviceType: string; defaultName: string }> }>(
          `select model.code, model.name,
             json_agg(json_build_object('key', channel.channel_key, 'deviceType', channel.device_type, 'defaultName', channel.default_name) order by channel.channel_key) as channels
           from public.hardware_models as model
           join public.hardware_model_channels as channel on channel.model_id = model.id
           where exists (select 1 from public.hardware_model_pins as pin where pin.model_id = model.id and pin.function = 'setup_button')
           group by model.id
           order by model.name, model.code`,
        ),
      );
      const products = rows
        .filter((row) => row.channels.every((channel) => isDeviceType(channel.deviceType)))
        .map((row) => ({ ...row, channels: row.channels as Array<{ key: string; deviceType: DeviceType; defaultName: string }> }))
        .map((row) => ({ ...row, category: deviceTypeCategory[row.channels[0].deviceType] }));
      return { products };
    }),
  );

  app.post<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/boards", (request, reply) =>
    handle(request, reply, 201, async (tx): Promise<PairBoardResponse> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "board.pair");
      const body = parse(addBoardRequest, request.body);
      const added = await addPendingBoard(pool, propertyId, body.modelCode, body.channels);
      if (added === "invalid") throw invalidRequest();
      if (!added) throw notFound();
      return { ...added, devices: await listDevices(tx, propertyId, added.boardId) };
    }),
  );

  app.post<{ Params: { propertyId: string; boardId: string } }>("/v1/properties/:propertyId/boards/:boardId/setup-code", (request, reply) =>
    handle(request, reply, 201, async (tx): Promise<SetupCodeResponse> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "board.pair");
      // Only a board that waits in this home for its real board.
      const setup = await createSetupCode(pool, propertyId, requireUuid(request.params.boardId));
      if (!setup) throw notFound();
      return { code: setup.code, expiresAt: setup.expiresAt.toISOString(), setupUrl: boardSetupUrl(normalizeSetupCode(setup.code)!) };
    }),
  );

  app.delete<{ Params: { propertyId: string; boardId: string } }>("/v1/properties/:propertyId/boards/:boardId", (request, reply) =>
    handle(request, reply, 204, async (tx) => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "board.remove");
      const boardId = requireUuid(request.params.boardId);
      // Members can read their home's boards; a board of another home is simply not found.
      const { rows } = await tx.query("select 1 from public.controllers where id = $1 and property_id = $2", [boardId, propertyId]);
      if (!rows.length) throw notFound();
      const broker = getBroker();
      if (!broker) throw new HttpError(503, "internal_error");
      await removeBoard(pool, broker, boardId);
      return null;
    }),
  );
}
