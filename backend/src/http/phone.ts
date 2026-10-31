/**
 * Changing the signed-in user's mobile number:
 * - POST /v1/me/phone {phone}: sends a 6-digit code to the new number (the approved login-code
 *   SMS pattern);
 * - POST /v1/me/phone/verify {code}: with the right code, moves sign-in (code and password) to the
 *   new number in Kratos and updates the app's copy.
 *
 * Both need a sign-in in the last PHONE_CHANGE_RECENT_SIGN_IN_MINUTES (403 reauth_required): a
 * session left open on someone else's phone must not be enough to take the account over. A code
 * lasts 10 minutes and allows 5 tries; a user gets at most 5 codes an hour.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { changePhoneRequest, confirmPhoneRequest, normalizePhone, PHONE_CHANGE_RECENT_SIGN_IN_MINUTES, type ApiErrorResponse, type PhoneChangeResponse } from "@m2smart/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { syncIdentity } from "../auth/identity-webhook";
import { IdentityAdminError, type IdentityAdmin } from "../auth/kratos-admin";
import type { SessionVerifier } from "../auth/session-verifier";
import { withSystemTx } from "../db/tx";
import type { SmsSender } from "../sms/sms";
import { requireSession } from "./me";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
const CODES_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

type Pending = { phone: string; codeHash: Buffer; expiresAt: number; tries: number };
const hash = (code: string) => createHash("sha256").update(code).digest();
const send = (reply: FastifyReply, status: number, error: ApiErrorResponse["error"]) => reply.code(status).send({ error } satisfies ApiErrorResponse);

export function registerPhoneRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier, identityAdmin: IdentityAdmin | null, sms: SmsSender | null): void {
  // ponytail: in memory, so a restart forgets pending codes (the user asks for a new one) and it
  // holds for one API process only; move it to the database if the API ever runs more than one copy.
  const pending = new Map<string, Pending>();
  const sentAt = new Map<string, number[]>();

  /** The session, if it may change the number now; otherwise replies and returns null. */
  const recentSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await requireSession(request, reply, verifier);
    if (!session) return null;
    if (!identityAdmin || !sms) {
      await send(reply, 503, "auth_unavailable");
      return null;
    }
    const signedInAt = session.authenticatedAt?.getTime() ?? 0;
    if (Date.now() - signedInAt > PHONE_CHANGE_RECENT_SIGN_IN_MINUTES * 60_000) {
      await send(reply, 403, "reauth_required");
      return null;
    }
    return session;
  };
  const takenByOther = async (phone: string, userId: string) => {
    const { rows } = await withSystemTx(pool, (tx) => tx.query("select 1 from auth.users where phone = $1 and id <> $2", [phone, userId]));
    return rows.length > 0;
  };

  app.post("/v1/me/phone", async (request, reply) => {
    const session = await recentSession(request, reply);
    if (!session) return reply;
    const body = changePhoneRequest.safeParse(request.body ?? {});
    const phone = body.success ? normalizePhone(body.data.phone) : null;
    if (!phone || phone === session.identity.phone) return send(reply, 400, "invalid_request");
    if (await takenByOther(phone, session.userId)) return send(reply, 409, "conflict");

    const now = Date.now();
    const recent = (sentAt.get(session.userId) ?? []).filter((time) => now - time < HOUR_MS);
    if (recent.length >= CODES_PER_HOUR) return send(reply, 429, "rate_limited");

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await sms!.sendCode(phone, code, request.log);
    } catch (error) {
      request.log.error({ err: { message: (error as Error).message } }, "Phone change code not sent");
      return send(reply, 503, "auth_unavailable");
    }
    sentAt.set(session.userId, [...recent, now]);
    pending.set(session.userId, { phone, codeHash: hash(code), expiresAt: now + CODE_TTL_MS, tries: 0 });
    return reply.code(202).send({ phone } satisfies PhoneChangeResponse);
  });

  app.post("/v1/me/phone/verify", async (request, reply) => {
    const session = await recentSession(request, reply);
    if (!session) return reply;
    const body = confirmPhoneRequest.safeParse(request.body ?? {});
    if (!body.success) return send(reply, 400, "invalid_request");
    const change = pending.get(session.userId);
    if (!change || change.expiresAt < Date.now() || change.tries >= MAX_TRIES) {
      pending.delete(session.userId);
      return send(reply, 404, "not_found");
    }
    change.tries += 1;
    if (!timingSafeEqual(change.codeHash, hash(body.data.code))) return send(reply, 400, "invalid_request");

    pending.delete(session.userId);
    if (await takenByOther(change.phone, session.userId)) return send(reply, 409, "conflict");
    try {
      if (!(await identityAdmin!.setPhone(session.userId, change.phone))) return send(reply, 409, "conflict");
    } catch (error) {
      if (!(error instanceof IdentityAdminError)) throw error;
      request.log.error({ err: { message: error.message } }, "Could not change the phone number in Kratos");
      return send(reply, 503, "auth_unavailable");
    }
    await syncIdentity(pool, { id: session.userId, phone: change.phone, email: session.identity.email, name: session.identity.name });
    request.log.info({ userId: session.userId }, "Phone number changed");
    return reply.code(200).send({ phone: change.phone } satisfies PhoneChangeResponse);
  });
}
