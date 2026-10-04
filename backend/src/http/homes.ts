/**
 * Homes (properties) and rooms: /v1/properties and /v1/properties/:propertyId/rooms.
 *
 * Access rules and error handling: see route-helpers.ts.
 */
import {
  createPropertyRequest,
  createRoomRequest,
  updatePropertyRequest,
  updateRoomRequest,
  type PhotoPreset,
  type Property,
  type PropertyListResponse,
  type PropertyRole,
  type PropertyType,
  type Room,
  type RoomListResponse,
} from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SessionVerifier } from "../auth/session-verifier";
import { createHandler, HttpError, notFound, parse, requireAction, requireUuid } from "./route-helpers";

/** Upper limits per user and per home, so one account cannot flood the database. */
export const MAX_HOMES_PER_USER = 50;
export const MAX_ROOMS_PER_HOME = 200;

type PropertyRow = { id: string; name: string; property_type: PropertyType; address: string; cover_photo: PhotoPreset; time_zone: string };
const PROPERTY_COLUMNS = "property.id, property.name, property.property_type, property.address, property.cover_photo, property.time_zone";
const toProperty = (row: PropertyRow, role: PropertyRole): Property => ({
  id: row.id,
  name: row.name,
  type: row.property_type,
  address: row.address,
  coverPhoto: row.cover_photo,
  timeZone: row.time_zone,
  role,
});

type RoomRow = { id: string; name: string; photo: PhotoPreset; sort_order: number };
const ROOM_COLUMNS = "id, name, photo, sort_order";
const toRoom = (row: RoomRow): Room => ({ id: row.id, name: row.name, photo: row.photo, sortOrder: row.sort_order });

export function registerHomeRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  const handle = createHandler(pool, verifier);

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
      const { rows } = await tx.query<PropertyRow>(
        `update public.properties as property set time_zone = $2 where property.id = $1 returning ${PROPERTY_COLUMNS}`,
        [created.rows[0].id, body.timeZone],
      );
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
           cover_photo = coalesce($5, property.cover_photo),
           time_zone = coalesce($6, property.time_zone)
         where property.id = $1
         returning ${PROPERTY_COLUMNS}`,
        [request.params.propertyId, body.name ?? null, body.type ?? null, body.address ?? null, body.coverPhoto ?? null, body.timeZone ?? null],
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
      requireUuid(roomId);
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
      requireUuid(roomId);
      // Devices in the room stay in the home, without a room.
      const { rowCount } = await tx.query("delete from public.rooms where id = $1 and property_id = $2", [roomId, propertyId]);
      if (!rowCount) throw notFound();
    }),
  );
}
