/**
 * POST /internal/dev/sms — development stand-in for the SMS provider.
 *
 * Kratos's courier sends every SMS (login and registration codes) here in local development,
 * and this route only logs it so the developer can read the code from the API log. It is
 * registered only when config.devRoutes is true (NODE_ENV=development set explicitly) and never
 * exists in production, where Kratos talks to a real Iranian SMS provider instead.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const smsSchema = z.object({
  to: z.string().min(1).max(32),
  text: z.string().min(1).max(1000),
  template: z.string().max(100).optional(),
});

export function registerDevSmsRoute(app: FastifyInstance): void {
  app.post("/internal/dev/sms", async (request, reply) => {
    const parsed = smsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_sms" });

    const { to, text, template } = parsed.data;
    // Dev only: the message (including its one-time code) is logged on purpose.
    request.log.info({ sms: { to, template, text } }, "DEV SMS (not sent)");
    return reply.code(204).send();
  });
}
