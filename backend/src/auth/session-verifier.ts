/**
 * Turns the credential a client forwards (Kratos session cookie or session token) into the
 * signed-in user, or null. Provider-specific checks live in implementations such as
 * kratos-verifier.ts; everything else in the API depends only on this interface.
 *
 * The API never sees passwords or one-time codes: those go straight to Kratos. It only ever
 * receives the resulting session credential.
 */
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

/** Kratos's default session cookie name. Only this cookie is forwarded, never the whole header. */
export const SESSION_COOKIE_NAME = "ory_kratos_session";

export type SessionCredential = { kind: "cookie"; value: string } | { kind: "token"; value: string };

export type VerifiedSession = {
  userId: string;
  sessionId: string;
  expiresAt: Date;
  /** Methods used to authenticate this session, e.g. ["code"] or ["password"]. */
  authMethods: string[];
  identity: { phone: string | null; email: string | null; name: string | null };
  issuer: "cloud";
};

export interface SessionVerifier {
  /**
   * Resolves to the session, or null when the credential is missing, invalid, expired or revoked.
   * Rejects when the auth service cannot answer (callers respond 503, not 401).
   */
  verify(credential: SessionCredential): Promise<VerifiedSession | null>;
}

/**
 * Reads the credential from a request: `Authorization: Bearer <token>` or `X-Session-Token`
 * (native apps), otherwise the Kratos session cookie (browser, forwarded by the web server).
 */
export function credentialFromRequest(request: FastifyRequest): SessionCredential | null {
  const authorization = request.headers.authorization;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return { kind: "token", value: token };
  }
  const headerToken = request.headers["x-session-token"];
  if (typeof headerToken === "string" && headerToken.trim()) return { kind: "token", value: headerToken.trim() };

  const cookie = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
  return cookie ? { kind: "cookie", value: cookie } : null;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      const raw = part.slice(separator + 1).trim();
      // Cookies set through Next.js are percent-encoded (e.g. "=" as %3D); Kratos's own values
      // never contain "%", so decoding restores the original either way.
      let value = raw;
      try {
        value = decodeURIComponent(raw);
      } catch {
        value = raw;
      }
      return value || null;
    }
  }
  return null;
}

type CacheEntry = { session: VerifiedSession | null; until: number };

export type CacheOptions = {
  /** How long a valid session is trusted without asking the provider again. */
  ttlMs?: number;
  /** How long an invalid credential is remembered (shorter: the user may sign in next). */
  negativeTtlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

/**
 * Wraps a verifier with a small in-memory cache keyed by a SHA-256 hash of the credential, so
 * the raw cookie or token is never kept as a key. Trade-off: a session revoked in Kratos stays
 * accepted by this API process for up to `ttlMs` (default 30 seconds).
 */
export function withSessionCache(inner: SessionVerifier, options: CacheOptions = {}): SessionVerifier {
  const ttlMs = options.ttlMs ?? 30_000;
  const negativeTtlMs = options.negativeTtlMs ?? 5_000;
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();

  return {
    async verify(credential) {
      const key = createHash("sha256").update(`${credential.kind}:${credential.value}`).digest("hex");
      const hit = cache.get(key);
      if (hit && hit.until > now()) return hit.session;

      const session = await inner.verify(credential);
      const until = session ? Math.min(now() + ttlMs, session.expiresAt.getTime()) : now() + negativeTtlMs;
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
      cache.set(key, { session, until });
      return session;
    },
  };
}
