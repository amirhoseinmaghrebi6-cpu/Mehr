/**
 * POST /internal/kratos/sms: Kratos's courier hands every SMS (login and sign-up codes) to this
 * route, which sends it through the SMS provider (src/sms/sms.ts) as an approved pattern.
 *
 * Only the one-time code travels on: the provider sends our own approved text around it. Like the
 * identity webhook, the route takes calls only from the internal network with the shared secret
 * (the onRequest hook in auth/identity-webhook.ts covers /internal/kratos/*). A failed send
 * answers 502, so the courier tries again.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SmsSender } from "../sms/sms";

const smsSchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/),
  text: z.string().max(1000).default(""),
  template: z.string().max(100).optional(),
  // Filled from the template's data (infra/dev/kratos/courier-sms.jsonnet); else read from the text.
  code: z.string().regex(/^\d{4,10}$/).nullish(),
});

export function registerSmsRoute(app: FastifyInstance, sms: SmsSender | null): void {
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
    try {
      await sms.sendCode(to, code, request.log);
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ err: error, template }, "SMS not sent");
      return reply.code(502).send({ error: "auth_unavailable" });
    }
  });
}
