/**
 * The signed-in user's display preferences: GET and PATCH /v1/me/settings. Only ever the caller's
 * own row (RLS on profiles allows nothing else).
 */
import { defaultSettings, updateSettingsRequest, type ApiErrorResponse, type Calendar, type Language, type Palette, type TemperatureUnit, type UserSettings } from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { IdentityConflictError, syncIdentity } from "../auth/identity-webhook";
import type { SessionVerifier } from "../auth/session-verifier";
import { withUserTx } from "../db/tx";
import { requireSession } from "./me";

type SettingsRow = { language: Language; calendar: Calendar; temperature_unit: TemperatureUnit; palette: Palette };
const toSettings = (row: SettingsRow | undefined): UserSettings =>
  row ? { language: row.language, calendar: row.calendar, temperatureUnit: row.temperature_unit, palette: row.palette } : defaultSettings;

export function registerSettingsRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  async function signedIn(request: Parameters<typeof requireSession>[0], reply: Parameters<typeof requireSession>[1]) {
    const session = await requireSession(request, reply, verifier);
    if (!session) return null;
    // The profile row exists even if the registration webhook was missed.
    try {
      await syncIdentity(pool, { id: session.userId, ...session.identity });
    } catch (error) {
      if (!(error instanceof IdentityConflictError)) throw error;
      await reply.code(409).send({ error: "conflict" } satisfies ApiErrorResponse);
      return null;
    }
    return session;
  }

  app.get("/v1/me/settings", async (request, reply) => {
    const session = await signedIn(request, reply);
    if (!session) return reply;
    const settings = await withUserTx(pool, { userId: session.userId }, async (tx) => {
      const { rows } = await tx.query<SettingsRow>("select language, calendar, temperature_unit, palette from public.profiles where user_id = auth.uid()");
      return toSettings(rows[0]);
    });
    return reply.send(settings);
  });

  app.patch("/v1/me/settings", async (request, reply) => {
    const session = await signedIn(request, reply);
    if (!session) return reply;
    const parsed = updateSettingsRequest.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" } satisfies ApiErrorResponse);
    const body = parsed.data;
    const settings = await withUserTx(pool, { userId: session.userId }, async (tx) => {
      const { rows } = await tx.query<SettingsRow>(
        `update public.profiles set
           language = coalesce($1, language),
           calendar = coalesce($2, calendar),
           temperature_unit = coalesce($3, temperature_unit),
           palette = coalesce($4, palette)
         where user_id = auth.uid()
         returning language, calendar, temperature_unit, palette`,
        [body.language ?? null, body.calendar ?? null, body.temperatureUnit ?? null, body.palette ?? null],
      );
      return toSettings(rows[0]);
    });
    return reply.send(settings);
  });
}
