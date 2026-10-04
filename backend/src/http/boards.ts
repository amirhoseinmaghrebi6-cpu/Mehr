/**
 * Pairing a board with a home (docs/board-protocol.md):
 *   POST /v1/boards/announce                    (the board: "I am in pairing mode and online")
 *   POST /v1/boards/credentials                 (the board: asks for its broker account)
 *   GET  /v1/hardware-products                  (the products a home can add)
 *   POST /v1/properties/:propertyId/boards      (owner, admin: adds a product that waits for pairing,
 *                                                or adds and pairs a board by its pairing code)
 *   POST /v1/properties/:propertyId/boards/:boardId/pair   (owner, admin: pairs a waiting board)
 *   DELETE /v1/properties/:propertyId/boards/:boardId   (owner, admin: removes the board)
 *
 * Removing a board from the app does what a factory reset does on the server: the board, all its
 * devices and everything about them are deleted, and its broker account is closed. The physical
 * board then has to be paired again to be used.
 *
 * The two board routes have no user session: the board proves itself with its factory secret.
 * A wrong secret, an unknown board and a wrong code all get the same answer.
 *
 * ponytail: no rate limit here; secrets and codes are 130+ random bits, so guessing is hopeless.
 * Add a per-address limit at the reverse proxy when the API is exposed to the internet.
 */
import {
  addBoardRequest,
  boardAnnounceRequest,
  boardCredentialsRequest,
  deviceTypeCategory,
  isDeviceType,
  pairBoardRequest,
  parsePairingCode,
  type BoardCredentialsResponse,
  type DeviceType,
  type HardwareProductListResponse,
  type PairBoardResponse,
} from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SessionVerifier } from "../auth/session-verifier";
import { addPendingBoard, announceBoard, issueCredentials, pairBoard, pairPendingBoard, removeBoard } from "../boards/pairing";
import { withSystemTx } from "../db/tx";
import type { Broker } from "../broker/broker";
import { listDevices } from "./devices";
import { createHandler, HttpError, invalidRequest, notFound, parse, requireAction, requireUuid } from "./route-helpers";

export function registerBoardRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier | undefined, getBroker: () => Broker | null): void {
  const refused = { error: "unauthenticated" } as const;
  const unavailable = { error: "internal_error" } as const;

  app.post("/v1/boards/announce", async (request, reply) => {
    const body = boardAnnounceRequest.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const known = await announceBoard(pool, body.data.hardwareUid, body.data.secret, body.data.codeHash);
    return known ? reply.code(204).send() : reply.code(401).send(refused);
  });

  app.post("/v1/boards/credentials", async (request, reply) => {
    const body = boardCredentialsRequest.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const broker = getBroker();
    if (!broker) return reply.code(503).send(unavailable);
    const result = await issueCredentials(pool, broker, body.data.hardwareUid, body.data.secret, body.data.code);
    if (result === "refused") return reply.code(401).send(refused);
    if (result === "waiting") return reply.code(202).send({ status: "waiting" } satisfies BoardCredentialsResponse);
    return reply.code(200).send({ status: "paired", ...result } satisfies BoardCredentialsResponse);
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
      if ("modelCode" in body) {
        const added = await addPendingBoard(pool, propertyId, body.modelCode, body.channels);
        if (added === "invalid") throw invalidRequest();
        if (!added) throw notFound();
        return { ...added, devices: await listDevices(tx, propertyId, added.boardId) };
      }
      const code = parsePairingCode(body.pairingCode);
      if (!code) throw invalidRequest();
      const broker = getBroker();
      if (!broker) throw new HttpError(503, "internal_error");
      // Unknown, used or expired code, or the board has not come online yet: all "not found".
      const paired = await pairBoard(pool, broker, propertyId, code.hardwareUid, code.code);
      if (!paired) throw notFound();
      return { ...paired, devices: await listDevices(tx, propertyId, paired.boardId) };
    }),
  );

  app.post<{ Params: { propertyId: string; boardId: string } }>("/v1/properties/:propertyId/boards/:boardId/pair", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<PairBoardResponse> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "board.pair");
      const boardId = requireUuid(request.params.boardId);
      const code = parsePairingCode(parse(pairBoardRequest, request.body).pairingCode);
      if (!code) throw invalidRequest();
      const broker = getBroker();
      if (!broker) throw new HttpError(503, "internal_error");
      const paired = await pairPendingBoard(pool, broker, propertyId, boardId, code.hardwareUid, code.code);
      // The real board is a different product than the one waiting in the home.
      if (paired === "mismatch") throw new HttpError(409, "conflict");
      if (!paired) throw notFound();
      return { ...paired, devices: await listDevices(tx, propertyId, paired.boardId) };
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
