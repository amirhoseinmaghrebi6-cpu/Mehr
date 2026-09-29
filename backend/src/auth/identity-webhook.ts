/**
 * Identity sync from Kratos into the app database.
 *
 * Kratos owns identities; the app database keeps a mirror row in auth.users (same UUID) so the
 * existing on_auth_user_created trigger creates the user's profile, personal organization and
 * owner membership, and RLS (auth.uid()) works unchanged.
 *
 * Two paths call syncIdentity:
 * - POST /internal/kratos/identity: Kratos's after-registration webhook.
 * - GET /v1/me: recovers a missed webhook from the verified session.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import type { DatabaseError, Pool } from "pg";
import { z } from "zod";
import { withSystemTx } from "../db/tx";

export type IdentityRecord = { id: string; phone: string | null; email: string | null; name: string | null };
export type SyncResult = "created" | "updated" | "unchanged";

export class IdentityConflictError extends Error {}

/**
 * Creates or updates the auth.users mirror row. Idempotent: replaying the same identity changes
 * nothing, and the sign-up trigger (INSERT only) runs exactly once per user.
 */
export async function syncIdentity(pool: Pool, identity: IdentityRecord): Promise<SyncResult> {
  const metadata = identity.name ? { full_name: identity.name } : {};
  try {
    return await withSystemTx(pool, async (tx) => {
      const { rows } = await tx.query<{ inserted: boolean }>(
        `insert into auth.users as u (id, phone, email, raw_user_meta_data)
         values ($1, $2, $3, $4)
         on conflict (id) do update
           set phone = excluded.phone,
               email = excluded.email,
               raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || excluded.raw_user_meta_data,
               updated_at = now()
           where (u.phone, u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb))
             is distinct from (excluded.phone, excluded.email, coalesce(u.raw_user_meta_data, '{}'::jsonb) || excluded.raw_user_meta_data)
         returning (xmax = 0) as inserted`,
        [identity.id, identity.phone, identity.email, metadata],
      );
      if (!rows.length) return "unchanged";
      return rows[0].inserted ? "created" : "updated";
    });
  } catch (error) {
    if ((error as DatabaseError).code === "23505") {
      throw new IdentityConflictError("Phone or email already belongs to another user in the app database");
    }
    throw error;
  }
}

const webhookSchema = z.object({
  identity_id: z.uuid(),
  phone: z.string().min(1).max(32),
  email: z.string().max(254).nullish(),
  name: z.string().max(80).nullish(),
});

/** Loopback and private (RFC 1918 / unique-local) addresses: the compose network and the host. */
export function isInternalAddress(address: string): boolean {
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return false;
}

function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Kratos flow-interrupt response (webhook with `response.parse: true`): a 4xx with this body
 * aborts the flow before anything is saved and shows the message on the form.
 */
const PASSWORD_REGISTRATION_DENIED = {
  messages: [
    {
      instance_ptr: "#/",
      messages: [
        {
          id: 4100001,
          type: "error",
          text: "Sign up with the SMS code sent to your phone. You can add a password after signing in.",
        },
      ],
    },
  ],
};

export function registerIdentityWebhook(app: FastifyInstance, pool: Pool, secret: string): void {
  // Both routes accept calls only from the internal network with the shared secret.
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/internal/kratos/")) return;
    if (!isInternalAddress(request.ip)) {
      request.log.warn({ ip: request.ip }, "Kratos webhook refused: not from the internal network");
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!secretMatches(request.headers["x-webhook-secret"], secret)) {
      request.log.warn("Kratos webhook refused: bad or missing secret");
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  /**
   * Registration with a password is refused: it would create an account for a phone number
   * nobody proved they own. Users register with an SMS code and may add a password afterwards
   * (decision D1). Kratos calls this before saving the identity and aborts on the 400.
   */
  app.post("/internal/kratos/registration/password", async (request, reply) => {
    request.log.warn("Refused a password registration (SMS code registration required)");
    return reply.code(400).send(PASSWORD_REGISTRATION_DENIED);
  });

  app.post("/internal/kratos/identity", async (request, reply) => {
    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const { identity_id: id, phone, email, name } = parsed.data;
    try {
      const result = await syncIdentity(pool, { id, phone, email: email ?? null, name: name ?? null });
      request.log.info({ identityId: id, result }, "Identity synced from Kratos webhook");
      return reply.code(200).send({});
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        request.log.error({ identityId: id }, error.message);
        return reply.code(409).send({ error: "conflict" });
      }
      throw error;
    }
  });
}
