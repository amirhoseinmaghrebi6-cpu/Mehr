import type { DemoCredentials } from "@/lib/auth/types";

export const DEMO_COOKIE_NAME = "m2smart_demo_session";
export const DEMO_SESSION_MAX_AGE = 60 * 60 * 4;
const encoder = new TextEncoder();

export type DemoSession = {
  userId: string;
  expiresAt: number;
};

export function isDemoAuthEnabled(): boolean {
  if (!getDemoCredentials()) return false;
  const explicitlyEnabled = process.env.M2SMART_DEMO_ENABLED;
  if (process.env.NODE_ENV === "production") {
    return explicitlyEnabled === "true" && Boolean(process.env.M2SMART_DEMO_PRODUCTION_SANDBOX && process.env.M2SMART_DEMO_SESSION_SECRET);
  }
  return explicitlyEnabled !== "false";
}

export function getDemoCredentials(): DemoCredentials | null {
  const username = process.env.M2SMART_DEMO_USERNAME;
  const password = process.env.M2SMART_DEMO_PASSWORD;
  return username && password ? { username, password } : null;
}

export function verifyDemoCredentials(username: string, password: string): boolean {
  if (!isDemoAuthEnabled()) return false;
  const credentials = getDemoCredentials();
  if (!credentials) return false;
  return constantTimeEqual(username.trim().toLowerCase(), credentials.username.trim().toLowerCase())
    && constantTimeEqual(password, credentials.password);
}

export async function createDemoSessionToken(): Promise<{ token: string; session: DemoSession }> {
  if (!isDemoAuthEnabled()) throw new Error("Demo access is disabled.");
  const session: DemoSession = {
    userId: `demo-${globalThis.crypto.randomUUID()}`,
    expiresAt: Math.floor(Date.now() / 1000) + DEMO_SESSION_MAX_AGE,
  };
  const payload = `${session.userId}.${session.expiresAt}`;
  const signature = await sign(payload);
  return { token: `${payload}.${signature}`, session };
}

export async function verifyDemoSessionToken(token: string | undefined): Promise<DemoSession | null> {
  if (!token || !isDemoAuthEnabled()) return null;
  const [userId, expiresText, signature, ...rest] = token.split(".");
  if (!userId?.startsWith("demo-") || !expiresText || !signature || rest.length > 0) return null;

  const expiresAt = Number(expiresText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expiresAt) || expiresAt <= now || expiresAt > now + DEMO_SESSION_MAX_AGE + 30) return null;

  const payload = `${userId}.${expiresAt}`;
  if (!await verifySignature(payload, signature)) return null;
  return { userId, expiresAt };
}

async function sign(payload: string): Promise<string> {
  const key = await getSigningKey();
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

async function verifySignature(payload: string, signature: string): Promise<boolean> {
  try {
    const key = await getSigningKey();
    return await globalThis.crypto.subtle.verify("HMAC", key, fromBase64Url(signature), encoder.encode(payload));
  } catch {
    return false;
  }
}

async function getSigningKey(): Promise<CryptoKey> {
  // An empty value (as in .env.example) counts as unset. Production never reaches the fallback:
  // isDemoAuthEnabled requires a non-empty secret there.
  const secret = process.env.M2SMART_DEMO_SESSION_SECRET || process.env.M2SMART_DEMO_PASSWORD;
  if (!secret) throw new Error("Demo session signing key is not configured.");
  return globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new DataView(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes.setUint8(index, binary.charCodeAt(index));
  return buffer;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}
