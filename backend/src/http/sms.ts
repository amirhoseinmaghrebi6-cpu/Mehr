/**
 * POST /internal/kratos/sms: Kratos's courier hands every SMS (login and sign-up codes) to this
 * route, which sends it through the SMS provider (src/sms/sms.ts) as an approved pattern.
 *
 * Only the one-time code travels on: the provider sends our own approved text around it. Like the
 * identity webhook, the route takes calls only from the internal network with the shared secret
 * (the onRequest hook in auth/identity-webhook.ts covers /internal/kratos/*). A failed send
 * answers 502, so the courier tries again.
 *
 * Each SMS costs money and anyone can ask for a code, so a phone number gets at most
 * CODES_PER_HOUR codes an hour; more are dropped (answered 204, so the courier does not retry).
 * Codes to a blocked account are dropped too: Kratos would refuse its sign-in anyway.
 * nginx also limits the sign-in pages per address (infra/prod/nginx/nginx.conf).
 */
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withSystemTx } from "../db/tx";
import { z } from "zod";
import type { SmsSender } from "../sms/sms";

const CODES_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const smsSchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/),
  text: z.string().max(1000).default(""),
  template: z.string().max(100).optional(),
  // Filled from the template's data (infra/dev/kratos/courier-sms.jsonnet); else read from the text.
  code: z.string().regex(/^\d{4,10}$/).nullish(),
});

export function registerSmsRoute(app: FastifyInstance, pool: Pool, sms: SmsSender | null): void {
  // ponytail: in memory, so a restart forgets it and it holds for one API process only; move it to
  // the database if the API ever runs more than one copy.
  const sentAt = new Map<string, number[]>();
  app.post("/internal/kratos/sms", async (request, reply) => {
    const parsed = smsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { to, text, template } = parsed.data;
    const code = parsed.data.code ?? /\b(\d{6})\b/.exec(text)?.[1];
    if (!code) {
      request.log.error({ template }, "SMS without a code: only code messages can be sent");
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (!sms) {
      request.log.error("No SMS provider configured (SMS_API_KEY): the code was not sent");
      return reply.code(503).send({ error: "auth_unavailable" });
    }
    const { rows: blocked } = await withSystemTx(pool, (tx) =>
      tx.query("select 1 from auth.users as person join public.profiles as profile on profile.user_id = person.id where person.phone = $1 and profile.blocked_at is not null", [to]),
    );
    if (blocked.length) {
      request.log.warn({ template }, "SMS dropped: the account is blocked");
      return reply.code(204).send();
    }
    const now = Date.now();
    const recent = (sentAt.get(to) ?? []).filter((time) => now - time < HOUR_MS);
    if (recent.length >= CODES_PER_HOUR) {
      request.log.warn({ template }, "SMS dropped: this number had too many codes in the last hour");
      return reply.code(204).send();
    }
    try {
      await sms.sendCode(to, code, request.log);
      sentAt.set(to, [...recent, now]);
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ err: error, template }, "SMS not sent");
      return reply.code(502).send({ error: "auth_unavailable" });
    }
  });
}
