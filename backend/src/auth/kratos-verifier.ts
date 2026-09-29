/**
 * SessionVerifier backed by Ory Kratos: asks the Kratos public API `/sessions/whoami`.
 * Uses plain fetch (no Ory SDK) and never calls the Kratos admin API.
 */
import { z } from "zod";
import { SESSION_COOKIE_NAME, type SessionVerifier, type VerifiedSession } from "./session-verifier";

const WHOAMI_TIMEOUT_MS = 3_000;

const whoamiSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
  expires_at: z.string().min(1),
  authentication_methods: z.array(z.object({ method: z.string() })).optional(),
  identity: z.object({
    id: z.uuid(),
    traits: z.object({
      phone: z.string().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
    }),
  }),
});

export class AuthUnavailableError extends Error {}

export function createKratosVerifier(publicUrl: string, fetchImpl: typeof fetch = fetch): SessionVerifier {
  const whoamiUrl = `${publicUrl.replace(/\/+$/, "")}/sessions/whoami`;

  return {
    async verify(credential): Promise<VerifiedSession | null> {
      const headers: Record<string, string> = { accept: "application/json" };
      if (credential.kind === "token") headers["x-session-token"] = credential.value;
      else headers.cookie = `${SESSION_COOKIE_NAME}=${credential.value}`;

      let response: Response;
      try {
        response = await fetchImpl(whoamiUrl, { headers, signal: AbortSignal.timeout(WHOAMI_TIMEOUT_MS) });
      } catch (error) {
        throw new AuthUnavailableError(`Kratos did not answer: ${(error as Error).message}`);
      }

      // 401: no/invalid/expired session. 403: session needs a higher assurance level.
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new AuthUnavailableError(`Kratos whoami returned ${response.status}`);

      const parsed = whoamiSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new AuthUnavailableError("Kratos whoami returned an unexpected body");

      const session = parsed.data;
      const expiresAt = new Date(session.expires_at);
      if (!session.active || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;

      return {
        userId: session.identity.id,
        sessionId: session.id,
        expiresAt,
        authMethods: session.authentication_methods?.map((entry) => entry.method) ?? [],
        identity: {
          phone: session.identity.traits.phone ?? null,
          email: session.identity.traits.email ?? null,
          name: session.identity.traits.name ?? null,
        },
        issuer: "cloud",
      };
    },
  };
}
