/**
 * Homes (properties) and rooms: /v1/properties and /v1/properties/:propertyId/rooms.
 *
 * Every request runs as the signed-in user (withUserTx), so RLS applies underneath. Before that,
 * the user's role in the home is checked in code against the shared permission table
 * (packages/contracts/src/permissions.ts). A home the user does not belong to is reported as 404,
 * never 403, so its existence is not revealed; the same goes for rooms of other homes.
 */
import {
  can,
  createPropertyRequest,
  createRoomRequest,
  isPropertyRole,
  updatePropertyRequest,
  updateRoomRequest,
  type ApiErrorResponse,
  type PhotoPreset,
  type Property,
  type PropertyAction,
  type PropertyListResponse,
  type PropertyRole,
  type PropertyType,
  type Room,
  type RoomListResponse,
} from "@m2smart/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import type { z } from "zod";
import type { SessionVerifier } from "../auth/session-verifier";
import { withUserTx, type TxClient } from "../db/tx";
import { requireSession } from "./me";

/** Upper limits per user and per home, so one account cannot flood the database. */
export const MAX_HOMES_PER_USER = 50;
export const MAX_ROOMS_PER_HOME = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reply decided inside a handler (status + error body), thrown to leave the transaction. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly error: ApiErrorResponse["error"],
  ) {
    super(error);
  }
}

const notFound = () => new HttpError(404, "not_found");

/** Maps database errors that a valid request can still hit to API errors. */
function databaseError(error: unknown): HttpError | null {
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return new HttpError(409, "conflict");
  if (code === "23514" || code === "22P02" || code === "22023") return new HttpError(400, "invalid_request");
  if (code === "42501") return new HttpError(403, "forbidden");
  if (code === "23503") return notFound();
  return null;
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new HttpError(400, "invalid_request");
  return result.data;
}

/** The user's role in the home, or 404 if they are not a member (or the id is not a UUID). */
async function roleIn(tx: TxClient, propertyId: string): Promise<PropertyRole> {
  if (!UUID.test(propertyId)) throw notFound();
  const { rows } = await tx.query<{ role: string }>(
    "select role from public.property_members where property_id = $1 and user_id = auth.uid()",
    [propertyId],
  );
  const role = rows[0]?.role;
  if (!isPropertyRole(role)) throw notFound();
  return role;
}

async function requireAction(tx: TxClient, propertyId: string, action: PropertyAction): Promise<PropertyRole> {
  const role = await roleIn(tx, propertyId);
  if (!can(role, action)) throw new HttpError(403, "forbidden");
  return role;
}

type PropertyRow = { id: string; name: string; property_type: PropertyType; address: string; cover_photo: PhotoPreset };
const PROPERTY_COLUMNS = "property.id, property.name, property.property_type, property.address, property.cover_photo";
const toProperty = (row: PropertyRow, role: PropertyRole): Property => ({
  id: row.id,
  name: row.name,
  type: row.property_type,
  address: row.address,
  coverPhoto: row.cover_photo,
  role,
});

type RoomRow = { id: string; name: string; photo: PhotoPreset; sort_order: number };
const ROOM_COLUMNS = "id, name, photo, sort_order";
const toRoom = (row: RoomRow): Room => ({ id: row.id, name: row.name, photo: row.photo, sortOrder: row.sort_order });

export function registerHomeRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  /**
   * Runs `work` as the signed-in user in one transaction and sends its result. HttpErrors and
   * known database errors become their status codes; anything else is a 500.
   */
  async function handle<T>(request: Parameters<typeof requireSession>[0], reply: FastifyReply, status: number, work: (tx: TxClient) => Promise<T>) {
    const session = await requireSession(request, reply, verifier);
    if (!session) return reply;
    try {
      const body = await withUserTx(pool, { userId: session.userId }, work);
      return status === 204 ? reply.code(204).send() : reply.code(status).send(body);
    } catch (caught) {
      const error = caught instanceof HttpError ? caught : databaseError(caught);
      if (!error) throw caught;
      return reply.code(error.statusCode).send({ error: error.error } satisfies ApiErrorResponse);
    }
  }

  // --- Homes ---------------------------------------------------------------------------------

  app.get("/v1/properties", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<PropertyListResponse> => {
      const { rows } = await tx.query<PropertyRow & { role: PropertyRole }>(
        `select ${PROPERTY_COLUMNS}, membership.role
         from public.property_members as membership
         join public.properties as property on property.id = membership.property_id
         where membership.user_id = auth.uid()
         order by property.created_at, property.name`,
      );
      return { properties: rows.map((row) => toProperty(row, row.role)) };
    }),
  );

  app.post("/v1/properties", (request, reply) =>
    handle(request, reply, 201, async (tx): Promise<Property> => {
      const body = parse(createPropertyRequest, request.body);
      const { rows: owned } = await tx.query<{ count: string }>(
        "select count(*) from public.property_members where user_id = auth.uid() and role = 'owner'",
      );
      if (Number(owned[0].count) >= MAX_HOMES_PER_USER) throw new HttpError(409, "conflict");

      const created = await tx.query<{ id: string }>("select public.create_property($1, $2, $3, $4) as id", [
        body.name, body.type, body.address, body.coverPhoto,
      ]);
      const { rows } = await tx.query<PropertyRow>(`select ${PROPERTY_COLUMNS} from public.properties as property where property.id = $1`, [created.rows[0].id]);
      return toProperty(rows[0], "owner");
    }),
  );

  app.patch<{ Params: { propertyId: string } }>("/v1/properties/:propertyId", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<Property> => {
      const role = await requireAction(tx, request.params.propertyId, "property.edit");
      const body = parse(updatePropertyRequest, request.body);
      const { rows } = await tx.query<PropertyRow>(
        `update public.properties as property set
           name = coalesce($2, property.name),
           property_type = coalesce($3, property.property_type),
           address = coalesce($4, property.address),
           cover_photo = coalesce($5, property.cover_photo)
         where property.id = $1
         returning ${PROPERTY_COLUMNS}`,
        [request.params.propertyId, body.name ?? null, body.type ?? null, body.address ?? null, body.coverPhoto ?? null],
      );
      if (!rows.length) throw notFound();
      return toProperty(rows[0], role);
    }),
  );

  app.delete<{ Params: { propertyId: string } }>("/v1/properties/:propertyId", (request, reply) =>
    handle(request, reply, 204, async (tx) => {
      await requireAction(tx, request.params.propertyId, "property.delete");
      const { rowCount } = await tx.query("delete from public.properties where id = $1", [request.params.propertyId]);
      if (!rowCount) throw notFound();
    }),
  );

  // --- Rooms ---------------------------------------------------------------------------------

  app.get<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/rooms", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<RoomListResponse> => {
      await requireAction(tx, request.params.propertyId, "property.view");
      const { rows } = await tx.query<RoomRow>(
        `select ${ROOM_COLUMNS} from public.rooms where property_id = $1 order by sort_order, name`,
        [request.params.propertyId],
      );
      return { rooms: rows.map(toRoom) };
    }),
  );

  app.post<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/rooms", (request, reply) =>
    handle(request, reply, 201, async (tx): Promise<Room> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "room.edit");
      const body = parse(createRoomRequest, request.body);
      const { rows: existing } = await tx.query<{ count: string; next: number }>(
        "select count(*), coalesce(max(sort_order) + 1, 0) as next from public.rooms where property_id = $1",
        [propertyId],
      );
      if (Number(existing[0].count) >= MAX_ROOMS_PER_HOME) throw new HttpError(409, "conflict");

      const { rows } = await tx.query<RoomRow>(
        `insert into public.rooms (property_id, name, photo, sort_order) values ($1, $2, $3, $4) returning ${ROOM_COLUMNS}`,
        [propertyId, body.name, body.photo, Math.min(existing[0].next, 10_000)],
      );
      return toRoom(rows[0]);
    }),
  );

  app.patch<{ Params: { propertyId: string; roomId: string } }>("/v1/properties/:propertyId/rooms/:roomId", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<Room> => {
      const { propertyId, roomId } = request.params;
      await requireAction(tx, propertyId, "room.edit");
      if (!UUID.test(roomId)) throw notFound();
      const body = parse(updateRoomRequest, request.body);
      const { rows } = await tx.query<RoomRow>(
        `update public.rooms set
           name = coalesce($3, name),
           photo = coalesce($4, photo),
           sort_order = coalesce($5, sort_order)
         where id = $2 and property_id = $1
         returning ${ROOM_COLUMNS}`,
        [propertyId, roomId, body.name ?? null, body.photo ?? null, body.sortOrder ?? null],
      );
      if (!rows.length) throw notFound();
      return toRoom(rows[0]);
    }),
  );

  app.delete<{ Params: { propertyId: string; roomId: string } }>("/v1/properties/:propertyId/rooms/:roomId", (request, reply) =>
    handle(request, reply, 204, async (tx) => {
      const { propertyId, roomId } = request.params;
      await requireAction(tx, propertyId, "room.edit");
      if (!UUID.test(roomId)) throw notFound();
      // Devices in the room stay in the home, without a room.
      const { rowCount } = await tx.query("delete from public.rooms where id = $1 and property_id = $2", [roomId, propertyId]);
      if (!rowCount) throw notFound();
    }),
  );
}
