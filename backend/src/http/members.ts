/**
 * Members of a home and invitations: /v1/properties/:propertyId/members|invitations and
 * /v1/me/invitations.
 *
 * Owners invite, re-role and remove admins and members; admins invite and remove members only
 * (canManageRole). Anyone but an owner may leave. People are invited by mobile number and see the
 * invitation once signed in with that number. Access rules and error handling: route-helpers.ts.
 */
import {
  can,
  canManageRole,
  createInvitationRequest,
  MAX_INVITATIONS_PER_HOME,
  updateMemberRequest,
  type HomeInvitation,
  type HomeMember,
  type InvitableRole,
  type MemberListResponse,
  type MyInvitationListResponse,
  type Property,
  type PropertyRole,
} from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SessionVerifier } from "../auth/session-verifier";
import type { TxClient } from "../db/tx";
import { PROPERTY_COLUMNS, toProperty, type PropertyRow } from "./homes";
import { createHandler, HttpError, notFound, parse, requireAction, requireUuid, roleIn } from "./route-helpers";

const forbidden = () => new HttpError(403, "forbidden");
const conflict = () => new HttpError(409, "conflict");

type MemberRow = { user_id: string; full_name: string; phone: string | null; role: PropertyRole };
type InvitationRow = { id: string; phone: string; role: InvitableRole; created_at: Date };

const toInvitation = (row: InvitationRow): HomeInvitation => ({ id: row.id, phone: row.phone, role: row.role, createdAt: row.created_at.toISOString() });

async function members(tx: TxClient, propertyId: string, userId: string): Promise<HomeMember[]> {
  const { rows } = await tx.query<MemberRow>("select user_id, full_name, phone, role from public.property_member_list($1)", [propertyId]);
  return rows.map((row) => ({ userId: row.user_id, name: row.full_name, phone: row.phone, role: row.role, you: row.user_id === userId }));
}

async function memberRole(tx: TxClient, propertyId: string, userId: string): Promise<PropertyRole> {
  const { rows } = await tx.query<{ role: PropertyRole }>("select role from public.property_members where property_id = $1 and user_id = $2", [propertyId, userId]);
  if (!rows.length) throw notFound();
  return rows[0].role;
}

export function registerMemberRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  const handle = createHandler(pool, verifier);
  type HomeParams = { Params: { propertyId: string } };

  app.get<HomeParams>("/v1/properties/:propertyId/members", (request, reply) =>
    handle(request, reply, 200, async (tx, session): Promise<MemberListResponse> => {
      const { propertyId } = request.params;
      const role = await requireAction(tx, propertyId, "property.view");
      const invitations = can(role, "member.manage")
        ? (await tx.query<InvitationRow>("select id, phone, role, created_at from public.property_invitations where property_id = $1 order by created_at", [propertyId])).rows.map(toInvitation)
        : [];
      return { members: await members(tx, propertyId, session.userId), invitations };
    }),
  );

  app.post<HomeParams>("/v1/properties/:propertyId/invitations", (request, reply) =>
    handle(request, reply, 201, async (tx, session): Promise<HomeInvitation> => {
      const { propertyId } = request.params;
      const actor = await requireAction(tx, propertyId, "member.manage");
      const body = parse(createInvitationRequest, request.body);
      if (!canManageRole(actor, body.role)) throw forbidden();
      if ((await members(tx, propertyId, session.userId)).some((member) => member.phone === body.phone)) throw conflict();
      const { rows: open } = await tx.query<{ count: string }>("select count(*) from public.property_invitations where property_id = $1", [propertyId]);
      if (Number(open[0].count) >= MAX_INVITATIONS_PER_HOME) throw conflict();
      // Already invited: 409 (unique per home and number).
      const { rows } = await tx.query<InvitationRow>(
        "insert into public.property_invitations (property_id, phone, role, invited_by) values ($1, $2, $3, auth.uid()) returning id, phone, role, created_at",
        [propertyId, body.phone, body.role],
      );
      return toInvitation(rows[0]);
    }),
  );

  app.delete<{ Params: { propertyId: string; invitationId: string } }>("/v1/properties/:propertyId/invitations/:invitationId", (request, reply) =>
    handle(request, reply, 204, async (tx) => {
      const { propertyId, invitationId } = request.params;
      const actor = await requireAction(tx, propertyId, "member.manage");
      requireUuid(invitationId);
      const { rows } = await tx.query<{ role: InvitableRole }>("select role from public.property_invitations where id = $1 and property_id = $2", [invitationId, propertyId]);
      if (!rows.length) throw notFound();
      if (!canManageRole(actor, rows[0].role)) throw forbidden();
      await tx.query("delete from public.property_invitations where id = $1", [invitationId]);
    }),
  );

  app.patch<{ Params: { propertyId: string; userId: string } }>("/v1/properties/:propertyId/members/:userId", (request, reply) =>
    handle(request, reply, 200, async (tx, session): Promise<HomeMember> => {
      const { propertyId, userId } = request.params;
      const actor = await requireAction(tx, propertyId, "member.manage");
      requireUuid(userId);
      const body = parse(updateMemberRequest, request.body);
      const current = await memberRole(tx, propertyId, userId);
      if (userId === session.userId || actor !== "owner" || !canManageRole(actor, current)) throw forbidden();
      await tx.query("update public.property_members set role = $3 where property_id = $1 and user_id = $2", [propertyId, userId, body.role]);
      const updated = (await members(tx, propertyId, session.userId)).find((member) => member.userId === userId);
      if (!updated) throw notFound();
      return updated;
    }),
  );

  // Removes someone, or (their own id) leaves the home.
  app.delete<{ Params: { propertyId: string; userId: string } }>("/v1/properties/:propertyId/members/:userId", (request, reply) =>
    handle(request, reply, 204, async (tx, session) => {
      const { propertyId, userId } = request.params;
      const actor = await roleIn(tx, propertyId);
      requireUuid(userId);
      if (userId === session.userId) {
        // An owner cannot leave: a home always has its owner (they delete it instead).
        if (actor === "owner") throw conflict();
      } else if (!can(actor, "member.manage") || !canManageRole(actor, await memberRole(tx, propertyId, userId))) {
        throw forbidden();
      }
      const { rowCount } = await tx.query("delete from public.property_members where property_id = $1 and user_id = $2", [propertyId, userId]);
      if (!rowCount) throw notFound();
    }),
  );

  // --- The signed-in user's invitations ------------------------------------------------------

  app.get("/v1/me/invitations", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<MyInvitationListResponse> => {
      const { rows } = await tx.query<{ id: string; property_name: string; invited_by_name: string; role: InvitableRole; created_at: Date }>(
        "select id, property_name, invited_by_name, role, created_at from public.my_property_invitations()",
      );
      return {
        invitations: rows.map((row) => ({ id: row.id, propertyName: row.property_name, invitedBy: row.invited_by_name, role: row.role, createdAt: row.created_at.toISOString() })),
      };
    }),
  );

  app.post<{ Params: { invitationId: string } }>("/v1/me/invitations/:invitationId/accept", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<Property> => {
      const { rows: accepted } = await tx.query<{ property_id: string | null }>("select public.accept_property_invitation($1) as property_id", [
        requireUuid(request.params.invitationId),
      ]);
      const propertyId = accepted[0].property_id;
      if (!propertyId) throw notFound();
      const { rows } = await tx.query<PropertyRow & { role: PropertyRole }>(
        `select ${PROPERTY_COLUMNS}, membership.role
         from public.properties as property
         join public.property_members as membership on membership.property_id = property.id and membership.user_id = auth.uid()
         where property.id = $1`,
        [propertyId],
      );
      return toProperty(rows[0], rows[0].role);
    }),
  );

  app.delete<{ Params: { invitationId: string } }>("/v1/me/invitations/:invitationId", (request, reply) =>
    handle(request, reply, 204, async (tx) => {
      const { rowCount } = await tx.query("delete from public.property_invitations where id = $1 and phone = public.current_user_phone()", [
        requireUuid(request.params.invitationId),
      ]);
      if (!rowCount) throw notFound();
    }),
  );
}
