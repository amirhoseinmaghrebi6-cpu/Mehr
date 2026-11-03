import type { ApiErrorResponse, Calendar, Language, MeResponse, OrganizationRole, Palette, TemperatureUnit } from "@m2smart/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { IdentityConflictError, syncIdentity } from "../auth/identity-webhook";
import { credentialFromRequest, type SessionVerifier, type VerifiedSession } from "../auth/session-verifier";
import { withUserTx } from "../db/tx";

/** Resolves the signed-in user or replies 401/503. Returns null when a reply was sent. */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  verifier: SessionVerifier,
): Promise<VerifiedSession | null> {
  const credential = credentialFromRequest(request);
  if (!credential) {
    await reply.code(401).send({ error: "unauthenticated" } satisfies ApiErrorResponse);
    return null;
  }
  let session: VerifiedSession | null;
  try {
    session = await verifier.verify(credential);
  } catch (error) {
    request.log.error({ err: { message: (error as Error).message } }, "Session check failed: auth service unavailable");
    await reply.code(503).send({ error: "auth_unavailable" } satisfies ApiErrorResponse);
    return null;
  }
  if (!session) {
    await reply.code(401).send({ error: "unauthenticated" } satisfies ApiErrorResponse);
    return null;
  }
  return session;
}

export function registerMeRoute(app: FastifyInstance, pool: Pool, verifier: SessionVerifier, platformAdmins: string[] = []): void {
  // The identity each user was last synced with: the app asks /v1/me on every page, and the mirror
  // row only needs writing when something changed (or after a restart).
  const synced = new Map<string, string>();
  app.get("/v1/me", async (request, reply) => {
    const session = await requireSession(request, reply, verifier);
    if (!session) return reply;

    // Recovers a missed registration webhook; a no-op when the mirror row is already current.
    const identity = JSON.stringify(session.identity);
    try {
      if (synced.get(session.userId) !== identity) {
        await syncIdentity(pool, { id: session.userId, ...session.identity });
        if (synced.size >= 50_000) synced.clear();
        synced.set(session.userId, identity);
      }
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        request.log.error({ userId: session.userId }, error.message);
        return reply.code(409).send({ error: "conflict" } satisfies ApiErrorResponse);
      }
      throw error;
    }

    // Everything below runs as the user, so RLS decides what is visible.
    const body = await withUserTx(pool, { userId: session.userId }, async (tx): Promise<MeResponse> => {
      const profile = await tx.query<{ full_name: string; language: Language; calendar: Calendar; temperature_unit: TemperatureUnit; palette: Palette }>(
        "select full_name, language, calendar, temperature_unit, palette from public.profiles where user_id = (select auth.uid())",
      );
      const preferences = profile.rows[0];
      const organizations = await tx.query<{ id: string; name: string; role: OrganizationRole }>(
        `select organization.id, organization.name, membership.role
         from public.organization_members as membership
         join public.organizations as organization on organization.id = membership.organization_id
         where membership.user_id = (select auth.uid())
         order by membership.created_at, organization.name`,
      );
      return {
        user: {
          id: session.userId,
          displayName: profile.rows[0]?.full_name || session.identity.name || session.identity.phone || "M2smart user",
          phone: session.identity.phone,
          email: session.identity.email,
          platformAdmin: session.identity.phone !== null && platformAdmins.includes(session.identity.phone),
        },
        organizations: organizations.rows,
        settings: {
          language: preferences?.language ?? "en",
          calendar: preferences?.calendar ?? "solar_hijri",
          temperatureUnit: preferences?.temperature_unit ?? "celsius",
          palette: preferences?.palette ?? "sage",
        },
        session: { authMethods: session.authMethods, aal: session.aal ?? "aal1", expiresAt: session.expiresAt.toISOString() },
      };
    });

    return reply.send(body);
  });
}
