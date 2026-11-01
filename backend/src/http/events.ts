/**
 * GET /v1/properties/:propertyId/events: live updates for an open page (Server-Sent Events).
 *
 * After the usual session and membership checks the response stays open and carries one line,
 * `data: changed`, whenever something in that home changes; the page then re-reads what it shows
 * through the normal routes. Nothing else travels here. A comment every 25 s keeps proxies from
 * closing an idle stream, and each stream ends after 10 minutes, so the browser reconnects and the
 * session and membership are checked again (someone removed from a home stops hearing about it).
 */
import { can, type ApiErrorResponse } from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SessionVerifier } from "../auth/session-verifier";
import { withUserTx } from "../db/tx";
import type { HomeEvents } from "../realtime/home-events";
import { requireSession } from "./me";
import { HttpError, roleIn } from "./route-helpers";

const HEARTBEAT_MS = 25_000;
export const MAX_STREAM_MS = 10 * 60_000;
/** Open streams per user (a few tabs and phones); more would only hold connections open for nothing. */
export const MAX_STREAMS_PER_USER = 20;

export function registerEventRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier, events: HomeEvents | null, maxStreamMs = MAX_STREAM_MS): void {
  const open = new Map<string, number>();
  app.get<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/events", async (request, reply) => {
    const session = await requireSession(request, reply, verifier);
    if (!session) return reply;
    const { propertyId } = request.params;
    try {
      await withUserTx(pool, { userId: session.userId }, async (tx) => {
        if (!can(await roleIn(tx, propertyId), "property.view")) throw new HttpError(403, "forbidden");
      });
    } catch (caught) {
      if (!(caught instanceof HttpError)) throw caught;
      return reply.code(caught.statusCode).send({ error: caught.error } satisfies ApiErrorResponse);
    }
    if (!events) return reply.code(503).send({ error: "internal_error" } satisfies ApiErrorResponse);
    const streams = open.get(session.userId) ?? 0;
    if (streams >= MAX_STREAMS_PER_USER) return reply.code(429).send({ error: "rate_limited" } satisfies ApiErrorResponse);
    open.set(session.userId, streams + 1);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tells nginx (production) not to buffer the stream.
      "x-accel-buffering": "no",
    });
    raw.write("retry: 3000\n\n");

    const unsubscribe = events.subscribe(propertyId, () => raw.write("data: changed\n\n"));
    const heartbeat = setInterval(() => raw.write(": ping\n\n"), HEARTBEAT_MS);
    const limit = setTimeout(() => raw.end(), maxStreamMs);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      const left = (open.get(session.userId) ?? 1) - 1;
      if (left > 0) open.set(session.userId, left);
      else open.delete(session.userId);
      unsubscribe();
      clearInterval(heartbeat);
      clearTimeout(limit);
    };
    request.raw.on("close", close);
    raw.on("close", close);
  });
}
