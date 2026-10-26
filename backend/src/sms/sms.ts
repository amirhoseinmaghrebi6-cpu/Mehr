/**
 * Text messages: one-time login codes (sent for Kratos, POST /internal/kratos/sms) and home
 * invitations.
 *
 * Production uses IPPanel's Edge API (Faraz SMS runs on IPPanel) with pre-approved patterns:
 * POST {url}/api/send, header "Authorization: <api key>", one recipient per call. Patterns:
 * - login code:  "... %code% ..."
 * - invitation:  "%name% ... «%home%» ..."
 * Without an API key, development logs each message instead (the browser tests read the code from
 * that log line); anywhere else there is no sender and codes cannot be sent.
 */
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config";

export type SmsSender = {
  sendCode(to: string, code: string, log: FastifyBaseLogger): Promise<void>;
  /** No-op when no invitation pattern is configured. */
  sendInvitation(to: string, inviter: string, home: string, log: FastifyBaseLogger): Promise<void>;
};

export class SmsError extends Error {}

const TIMEOUT_MS = 10_000;
/** IPPanel pattern variables are limited (40 characters by default); names are cut well before. */
const short = (value: string, max = 30) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export function createSmsSender(sms: Config["sms"], dev: boolean, fetchImpl: typeof fetch = fetch): SmsSender | null {
  if (!sms) {
    if (!dev) return null;
    // Development: the message (including its one-time code) is logged on purpose.
    return {
      async sendCode(to, code, log) {
        log.info({ sms: { to, template: "code", text: `M2smart login code: ${code}` } }, "DEV SMS (not sent)");
      },
      async sendInvitation(to, inviter, home, log) {
        log.info({ sms: { to, template: "invitation", text: `${inviter} invited you to ${home}` } }, "DEV SMS (not sent)");
      },
    };
  }

  const send = async (to: string, pattern: string, params: Record<string, string>, log: FastifyBaseLogger) => {
    let response: Response;
    try {
      response = await fetchImpl(`${sms.url}/api/send`, {
        method: "POST",
        headers: { Authorization: sms.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sending_type: "pattern", from_number: sms.sender, code: pattern, recipients: [to], params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new SmsError(`SMS provider unreachable: ${(error as Error).name}`);
    }
    const body = (await response.json().catch(() => null)) as { meta?: { status?: boolean; message?: string; message_code?: string } } | null;
    if (!response.ok || body?.meta?.status !== true) {
      // The provider's message says what is wrong (e.g. pattern not approved); it holds no secret.
      throw new SmsError(`SMS provider refused (${response.status} ${body?.meta?.message_code ?? ""} ${body?.meta?.message ?? ""})`.trim());
    }
    log.info({ to: `${to.slice(0, 6)}…${to.slice(-2)}`, pattern }, "SMS sent");
  };

  return {
    sendCode: (to, code, log) => send(to, sms.patterns.code, { code }, log),
    async sendInvitation(to, inviter, home, log) {
      if (!sms.patterns.invitation) return;
      await send(to, sms.patterns.invitation, { name: short(inviter), home: short(home) }, log);
    },
  };
}
