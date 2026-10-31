/**
 * The operator's panel: /v1/admin/*, for the numbers in PLATFORM_ADMIN_PHONES only (403 for
 * everyone else). Counts, people and boards, never what is inside a home; an operator can block,
 * unblock and delete a user, but never another operator or themself.
 *
 * Reads and changes go through the platform_* database functions as service_role
 * (supabase/migrations/202611010001_platform_admin.sql): the panel spans every home, which no
 * user's RLS allows.
 */
import { ADMIN_PAGE_SIZE, adminUpdateUserRequest, type AdminBoardListResponse, type AdminOverview, type AdminUserListResponse, type ApiErrorResponse } from "@m2smart/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { IdentityAdminError, type IdentityAdmin } from "../auth/kratos-admin";
import type { SessionVerifier, VerifiedSession } from "../auth/session-verifier";
import type { Broker } from "../broker/broker";
import { withSystemTx } from "../db/tx";
import { requireSession } from "./me";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminServices = {
  /** The operators' numbers, E.164. */
  admins: string[];
  identityAdmin: IdentityAdmin | null;
  broker: () => Broker | null;
  smsReady: boolean;
};

/** Blocked users are signed out everywhere: every session check answers "no session". */
export function refuseBlocked(inner: SessionVerifier, pool: Pool): SessionVerifier {
  return {
    async verify(credential) {
      const session = await inner.verify(credential);
      if (!session) return null;
      const { rows } = await withSystemTx(pool, (tx) => tx.query<{ blocked: boolean }>("select public.platform_is_blocked($1) as blocked", [session.userId]));
      return rows[0]?.blocked ? null : session;
    },
  };
}

export const isPlatformAdmin = (session: VerifiedSession, admins: string[]) => session.identity.phone !== null && admins.includes(session.identity.phone);

const page = (value: unknown) => Math.max(0, Number.parseInt(String(value ?? "0"), 10) || 0);
const send = (reply: FastifyReply, status: number, error: ApiErrorResponse["error"]) => reply.code(status).send({ error } satisfies ApiErrorResponse);

export function registerAdminRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier, services: AdminServices): void {
  const operator = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await requireSession(request, reply, verifier);
    if (!session) return null;
    if (!isPlatformAdmin(session, services.admins)) {
      await send(reply, 403, "forbidden");
      return null;
    }
    return session;
  };
  /** The user an operator may act on: exists, and is not an operator. Replies and returns null otherwise. */
  const target = async (reply: FastifyReply, userId: string): Promise<IdentityAdmin | null> => {
    const refuse = async (status: number, error: ApiErrorResponse["error"]) => {
      await send(reply, status, error);
      return null;
    };
    if (!UUID.test(userId)) return refuse(404, "not_found");
    const { rows } = await withSystemTx(pool, (tx) => tx.query<{ phone: string | null }>("select phone from auth.users where id = $1", [userId]));
    if (!rows.length) return refuse(404, "not_found");
    if (rows[0].phone && services.admins.includes(rows[0].phone)) return refuse(409, "conflict");
    if (!services.identityAdmin) return refuse(503, "auth_unavailable");
    return services.identityAdmin;
  };

  app.get("/v1/admin/overview", async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    const { rows } = await withSystemTx(pool, (tx) =>
      tx.query<{ users: string; blocked_users: string; homes: string; boards: string; boards_online: string; commands_today: string }>("select * from public.platform_overview()"),
    );
    const counts = rows[0];
    return {
      users: Number(counts.users),
      blockedUsers: Number(counts.blocked_users),
      homes: Number(counts.homes),
      boards: Number(counts.boards),
      boardsOnline: Number(counts.boards_online),
      commandsToday: Number(counts.commands_today),
      services: { database: true, broker: services.broker() !== null, sms: services.smsReady, accounts: services.identityAdmin !== null },
    } satisfies AdminOverview;
  });

  app.get<{ Querystring: { search?: string; offset?: string } }>("/v1/admin/users", async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    const search = String(request.query.search ?? "").trim().slice(0, 60);
    const { rows } = await withSystemTx(pool, (tx) =>
      tx.query<{ id: string; full_name: string; phone: string | null; created_at: Date; blocked_at: Date | null; homes_owned: string; homes_joined: string; total: string }>(
        "select * from public.platform_users($1, $2, $3)",
        [search, page(request.query.offset), ADMIN_PAGE_SIZE],
      ),
    );
    return {
      users: rows.map((row) => ({
        id: row.id,
        name: row.full_name,
        phone: row.phone,
        createdAt: row.created_at.toISOString(),
        blocked: row.blocked_at !== null,
        homesOwned: Number(row.homes_owned),
        homesJoined: Number(row.homes_joined),
        platformAdmin: row.phone !== null && services.admins.includes(row.phone),
      })),
      total: Number(rows[0]?.total ?? 0),
    } satisfies AdminUserListResponse;
  });

  app.get<{ Querystring: { offset?: string } }>("/v1/admin/boards", async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    const { rows } = await withSystemTx(pool, (tx) =>
      tx.query<{ id: string; hardware_uid: string; model_name: string; firmware_version: string | null; online: boolean; last_seen_at: Date | null; created_at: Date; owner_name: string; owner_phone: string | null; total: string }>(
        "select * from public.platform_boards($1, $2)",
        [page(request.query.offset), ADMIN_PAGE_SIZE],
      ),
    );
    return {
      boards: rows.map((row) => ({
        id: row.id,
        hardwareUid: row.hardware_uid,
        model: row.model_name,
        firmwareVersion: row.firmware_version,
        online: row.online,
        lastSeenAt: row.last_seen_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        ownerName: row.owner_name,
        ownerPhone: row.owner_phone,
      })),
      total: Number(rows[0]?.total ?? 0),
    } satisfies AdminBoardListResponse;
  });

  app.patch<{ Params: { userId: string } }>("/v1/admin/users/:userId", async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    const body = adminUpdateUserRequest.safeParse(request.body ?? {});
    if (!body.success) return send(reply, 400, "invalid_request");
    const identityAdmin = await target(reply, request.params.userId);
    if (!identityAdmin) return reply;
    try {
      // Kratos first: if it fails, nothing has changed.
      await identityAdmin.setBlocked(request.params.userId, body.data.blocked);
    } catch (error) {
      if (!(error instanceof IdentityAdminError)) throw error;
      request.log.error({ err: { message: error.message } }, "Could not change the account in Kratos");
      return send(reply, 503, "auth_unavailable");
    }
    await withSystemTx(pool, (tx) => tx.query("select public.platform_set_blocked($1, $2)", [request.params.userId, body.data.blocked]));
    request.log.info({ userId: request.params.userId, blocked: body.data.blocked }, "Operator changed an account");
    return reply.code(204).send();
  });

  app.delete<{ Params: { userId: string } }>("/v1/admin/users/:userId", async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    const identityAdmin = await target(reply, request.params.userId);
    if (!identityAdmin) return reply;
    try {
      // Kratos first: the person can no longer sign in, even if the rest fails and is retried.
      await identityAdmin.delete(request.params.userId);
    } catch (error) {
      if (!(error instanceof IdentityAdminError)) throw error;
      request.log.error({ err: { message: error.message } }, "Could not delete the account in Kratos");
      return send(reply, 503, "auth_unavailable");
    }
    const { rows } = await withSystemTx(pool, (tx) => tx.query<{ board_id: string }>("select board_id from public.platform_delete_user($1)", [request.params.userId]));
    // The boards of the deleted homes lose their broker accounts, as when a board is removed.
    const broker = services.broker();
    for (const { board_id } of rows) {
      if (broker) await broker.removeBoard(board_id);
      else request.log.warn({ boardId: board_id }, "No broker connection: the board's MQTT account was not removed");
    }
    request.log.info({ userId: request.params.userId, boards: rows.length }, "Operator deleted an account");
    return reply.code(204).send();
  });
}
