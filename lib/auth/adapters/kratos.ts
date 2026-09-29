/**
 * Kratos adapter: self-hosted Ory Kratos (Phase 2E). Users sign in with a mobile number and an
 * SMS code; a password is optional and can only be added after signing in (decision D1).
 * Registration with a password is refused by Kratos itself (see infra/dev/kratos/kratos.yml).
 *
 * User data comes only from the M2smart API (`GET /v1/me`), never from Kratos directly.
 */
import type { MeResponse } from "@m2smart/contracts";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { AuthErrorCode, Failure, LoginResult, Principal, RecoveryResult, RegistrationResult } from "@/lib/auth/types";
import { normalizePhone } from "@/lib/auth/phone";
import {
  apiInternalUrl,
  flowMessages,
  KRATOS_SESSION_COOKIE,
  kratosPublicUrl,
  kratosRequest,
  KratosUnavailableError,
  nodeValue,
  type KratosFlow,
  type KratosResponse,
} from "@/lib/auth/adapters/kratos-http";

const fail = (error: AuthErrorCode): Failure => ({ ok: false, error });

/** Maps a failed Kratos flow submission to the screen's error code. */
function failureFrom(response: KratosResponse, stage: "send" | "verify" | "password" | "settings"): Failure {
  if (response.status === 404 || response.status === 410) return fail("flow-expired");
  if (response.status === 403) return fail(stage === "settings" ? "reauth-required" : "flow-expired");

  const ids = flowMessages(response.body).map((message) => message.id);
  const texts = flowMessages(response.body).map((message) => message.text.toLowerCase());
  if (ids.includes(4000035)) return fail("no-account");
  if (ids.includes(4000006)) return fail("credentials");
  if (ids.includes(4000007)) return fail("phone-taken");
  if (ids.includes(4010008)) return fail("code-invalid");
  if (texts.some((text) => text.includes("too often"))) return fail("code-attempts");
  if (ids.includes(4000001) && stage === "send") return fail("phone-invalid");
  if (stage === "settings") return fail("update-failed");
  if (stage === "password") return fail("credentials");
  return fail(stage === "verify" ? "code-invalid" : "signup-failed");
}

async function createFlow(kind: "login" | "registration" | "settings"): Promise<KratosFlow | null> {
  const response = await kratosRequest(`/self-service/${kind}/browser`);
  return response.status === 200 ? (response.body as unknown as KratosFlow) : null;
}

async function loadFlow(kind: "login" | "registration", flowId: string): Promise<KratosFlow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(flowId)) return null;
  const response = await kratosRequest(`/self-service/${kind}/flows?id=${flowId}`);
  return response.status === 200 ? (response.body as unknown as KratosFlow) : null;
}

async function submit(kind: "login" | "registration" | "settings", flow: KratosFlow, body: Record<string, unknown>): Promise<KratosResponse> {
  return kratosRequest(`/self-service/${kind}?flow=${flow.id}`, {
    method: "POST",
    body: { ...body, csrf_token: nodeValue(flow, "csrf_token") },
  });
}

export const kratosAdapter = {
  isConfigured(): boolean {
    return kratosPublicUrl() !== null && apiInternalUrl() !== null;
  },

  /** The signed-in user, from the M2smart API (which verifies the session with Kratos). */
  async getCurrentPrincipal(): Promise<Principal | null> {
    const session = (await cookies()).get(KRATOS_SESSION_COOKIE)?.value;
    const api = apiInternalUrl();
    if (!session || !api) return null;

    let response: Response;
    try {
      response = await fetch(`${api}/v1/me`, {
        headers: { cookie: `${KRATOS_SESSION_COOKIE}=${session}`, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new KratosUnavailableError(`M2smart API did not answer: ${(error as Error).message}`);
    }
    if (response.status === 401) return null;
    if (!response.ok) throw new KratosUnavailableError(`M2smart API /v1/me returned ${response.status}`);

    const me = (await response.json()) as MeResponse;
    return {
      userId: me.user.id,
      sessionId: null,
      displayName: me.user.displayName,
      authMethod: me.session.authMethods.includes("password") ? "password" : "sms_code",
      issuer: "cloud",
    };
  },

  async sendLoginCode(phoneInput: string): Promise<LoginResult> {
    const phone = normalizePhone(phoneInput);
    if (!phone) return fail("phone-invalid");
    const flow = await createFlow("login");
    if (!flow) return fail("unavailable");
    const response = await submit("login", flow, { method: "code", identifier: phone });
    if (response.status === 400 && (response.body as { state?: string } | null)?.state === "sent_email") {
      return { ok: true, status: "code_sent", flowId: flow.id, phone };
    }
    return failureFrom(response, "send");
  },

  async verifyLoginCode(flowId: string, code: string): Promise<LoginResult> {
    const flow = await loadFlow("login", flowId);
    if (!flow) return fail("flow-expired");
    const identifier = nodeValue(flow, "identifier");
    const response = await submit("login", flow, { method: "code", identifier, code });
    return response.status === 200 ? { ok: true, status: "signed_in" } : failureFrom(response, "verify");
  },

  async signInWithPassword(phoneInput: string, password: string): Promise<LoginResult> {
    const phone = normalizePhone(phoneInput);
    if (!phone) return fail("credentials");
    const flow = await createFlow("login");
    if (!flow) return fail("unavailable");
    const response = await submit("login", flow, { method: "password", identifier: phone, password });
    return response.status === 200 ? { ok: true, status: "signed_in" } : failureFrom(response, "password");
  },

  async sendRegistrationCode(fullName: string, phoneInput: string): Promise<RegistrationResult> {
    const phone = normalizePhone(phoneInput);
    if (!phone) return fail("phone-invalid");
    const flow = await createFlow("registration");
    if (!flow) return fail("unavailable");
    const response = await submit("registration", flow, { method: "code", traits: { phone, name: fullName } });
    if (response.status === 400 && (response.body as { state?: string } | null)?.state === "sent_email") {
      return { ok: true, status: "code_sent", flowId: flow.id, phone };
    }
    return failureFrom(response, "send");
  },

  async verifyRegistrationCode(flowId: string, code: string): Promise<RegistrationResult> {
    const flow = await loadFlow("registration", flowId);
    if (!flow) return fail("flow-expired");
    // The traits entered in step one live on the flow, not in the browser.
    const traits = { phone: nodeValue(flow, "traits.phone"), name: nodeValue(flow, "traits.name") };
    const response = await submit("registration", flow, { method: "code", code, traits });
    return response.status === 200 ? { ok: true, status: "signed_in" } : failureFrom(response, "verify");
  },

  /** Adds or replaces the password of the signed-in user (needs a recent sign-in). */
  async setPassword(password: string): Promise<RecoveryResult> {
    const flow = await createFlow("settings");
    if (!flow) return fail("reauth-required");
    const response = await submit("settings", flow, { method: "password", password });
    return response.status === 200 ? { ok: true } : failureFrom(response, "settings");
  },

  async signOut(): Promise<void> {
    const start = await kratosRequest("/self-service/logout/browser");
    const token = (start.body as { logout_token?: string } | null)?.logout_token;
    if (start.status === 200 && token) await kratosRequest(`/self-service/logout?token=${encodeURIComponent(token)}`);
    // Whatever Kratos answered, the browser forgets the session.
    try {
      (await cookies()).delete(KRATOS_SESSION_COOKIE);
    } catch {
      // Not in an action context.
    }
  },

  /** Middleware variant: asks Kratos whether the request's session cookie is valid. */
  async hasRequestSession(request: NextRequest): Promise<boolean> {
    const session = request.cookies.get(KRATOS_SESSION_COOKIE)?.value;
    const base = kratosPublicUrl();
    if (!session || !base) return false;
    try {
      const response = await fetch(`${base}/sessions/whoami`, {
        headers: { cookie: `${KRATOS_SESSION_COOKIE}=${session}`, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status === 401 || response.status === 403) return false;
      // Kratos unreachable: routing lets the request through; the app layout verifies via the API.
      return true;
    } catch {
      return true;
    }
  },
};

export { KratosUnavailableError };
