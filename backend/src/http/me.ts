import type { ApiErrorResponse, Calendar, Language, MeResponse, OrganizationRole, TemperatureUnit } from "@m2smart/contracts";
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

export function registerMeRoute(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  app.get("/v1/me", async (request, reply) => {
    const session = await requireSession(request, reply, verifier);
    if (!session) return reply;

    // Recovers a missed registration webhook; a no-op when the mirror row is already current.
    try {
      await syncIdentity(pool, { id: session.userId, ...session.identity });
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        request.log.error({ userId: session.userId }, error.message);
        return reply.code(409).send({ error: "conflict" } satisfies ApiErrorResponse);
      }
      throw error;
    }

    // Everything below runs as the user, so RLS decides what is visible.
    const body = await withUserTx(pool, { userId: session.userId }, async (tx): Promise<MeResponse> => {
      const profile = await tx.query<{ full_name: string; language: Language; calendar: Calendar; temperature_unit: TemperatureUnit }>(
        "select full_name, language, calendar, temperature_unit from public.profiles where user_id = auth.uid()",
      );
      const preferences = profile.rows[0];
      const organizations = await tx.query<{ id: string; name: string; role: OrganizationRole }>(
        `select organization.id, organization.name, membership.role
         from public.organization_members as membership
         join public.organizations as organization on organization.id = membership.organization_id
         where membership.user_id = auth.uid()
         order by membership.created_at, organization.name`,
      );
      return {
        user: {
          id: session.userId,
          displayName: profile.rows[0]?.full_name || session.identity.name || session.identity.phone || "M2smart user",
          phone: session.identity.phone,
          email: session.identity.email,
        },
        organizations: organizations.rows,
        settings: {
          language: preferences?.language ?? "en",
          calendar: preferences?.calendar ?? "solar_hijri",
          temperatureUnit: preferences?.temperature_unit ?? "celsius",
        },
        session: { authMethods: session.authMethods, expiresAt: session.expiresAt.toISOString() },
      };
    });

    return reply.send(body);
  });
}
