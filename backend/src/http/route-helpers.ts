/**
 * Shared plumbing for the /v1 routes of homes, rooms, devices and commands.
 *
 * Every request runs as the signed-in user (withUserTx), so RLS applies underneath. Before that,
 * the user's role in the home is checked in code against the shared permission table
 * (packages/contracts/src/permissions.ts). A home the user does not belong to is reported as 404,
 * never 403, so its existence is not revealed; the same goes for anything inside it.
 */
import { can, isPropertyRole, type ApiErrorResponse, type PropertyAction, type PropertyRole } from "@m2smart/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { z } from "zod";
import type { SessionVerifier, VerifiedSession } from "../auth/session-verifier";
import { withUserTx, type TxClient } from "../db/tx";
import { requireSession } from "./me";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reply decided inside a handler (status + error body), thrown to leave the transaction. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly error: ApiErrorResponse["error"],
  ) {
    super(error);
  }
}

export const notFound = () => new HttpError(404, "not_found");
export const invalidRequest = () => new HttpError(400, "invalid_request");

/** Maps database errors that a valid request can still hit to API errors. */
function databaseError(error: unknown): HttpError | null {
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return new HttpError(409, "conflict");
  if (code === "23514" || code === "22P02" || code === "22023") return invalidRequest();
  if (code === "42501") return new HttpError(403, "forbidden");
  if (code === "23503") return notFound();
  return null;
}

export function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw invalidRequest();
  return result.data;
}

/** Throws 404 unless `value` is a UUID (path ids are never passed to SQL otherwise). */
export function requireUuid(value: string): string {
  if (!UUID.test(value)) throw notFound();
  return value;
}

/** The user's role in the home, or 404 if they are not a member (or the id is not a UUID). */
export async function roleIn(tx: TxClient, propertyId: string): Promise<PropertyRole> {
  requireUuid(propertyId);
  const { rows } = await tx.query<{ role: string }>(
    "select role from public.property_members where property_id = $1 and user_id = auth.uid()",
    [propertyId],
  );
  const role = rows[0]?.role;
  if (!isPropertyRole(role)) throw notFound();
  return role;
}

export async function requireAction(tx: TxClient, propertyId: string, action: PropertyAction): Promise<PropertyRole> {
  const role = await roleIn(tx, propertyId);
  if (!can(role, action)) throw new HttpError(403, "forbidden");
  return role;
}

/** What a route handler returns: the body, optionally with a status other than the default. */
export type Outcome<T> = T | { status: number; body: T };
export const withStatus = <T>(status: number, body: T) => ({ status, body }) as const;

/**
 * Returns `handle(request, reply, status, work)`: checks the session, runs `work` as the user in
 * one transaction and sends its result. HttpErrors and known database errors become their status
 * codes; anything else goes to the global error handler (500 without details).
 */
export function createHandler(pool: Pool, verifier: SessionVerifier) {
  return async function handle<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    status: number,
    work: (tx: TxClient, session: VerifiedSession) => Promise<Outcome<T>>,
  ) {
    const session = await requireSession(request, reply, verifier);
    if (!session) return reply;
    try {
      const outcome = await withUserTx(pool, { userId: session.userId }, (tx) => work(tx, session));
      const { status: code, body } =
        outcome && typeof outcome === "object" && "status" in outcome && "body" in outcome ? (outcome as { status: number; body: T }) : { status, body: outcome as T };
      return code === 204 ? reply.code(204).send() : reply.code(code).send(body);
    } catch (caught) {
      const error = caught instanceof HttpError ? caught : databaseError(caught);
      if (!error) throw caught;
      return reply.code(error.statusCode).send({ error: error.error } satisfies ApiErrorResponse);
    }
  };
}
