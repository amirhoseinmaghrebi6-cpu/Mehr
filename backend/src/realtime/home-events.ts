/**
 * Live updates for open pages. The database sends a notice on channel 'home_changes' with a home's
 * id whenever something its pages show changes (supabase/migrations/202610280001); this module
 * listens on one dedicated connection and calls the subscribers of that home. A burst of notices
 * (a scenario switching ten devices) reaches each subscriber once, after a short pause.
 *
 * A lost connection is reopened after a few seconds; subscribers are told to refresh then, since
 * notices sent in between are gone.
 */
import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";

const CHANNEL = "home_changes";
const COALESCE_MS = 150;
const RECONNECT_MS = 3_000;

export type HomeEvents = {
  /** Calls `onChange` after changes to that home until the returned function is called. */
  subscribe(propertyId: string, onChange: () => void): () => void;
  stop(): Promise<void>;
};

export function startHomeEvents(pool: Pool, log: FastifyBaseLogger): HomeEvents {
  const subscribers = new Map<string, Set<() => void>>();
  const due = new Map<string, NodeJS.Timeout>();
  let client: PoolClient | null = null;
  let stopped = false;
  let retry: NodeJS.Timeout | null = null;

  const tell = (propertyId: string) => {
    if (!subscribers.has(propertyId) || due.has(propertyId)) return;
    due.set(
      propertyId,
      setTimeout(() => {
        due.delete(propertyId);
        for (const onChange of subscribers.get(propertyId) ?? []) onChange();
      }, COALESCE_MS),
    );
  };

  const connect = async () => {
    try {
      const next = await pool.connect();
      next.on("notification", (message) => {
        if (message.channel === CHANNEL && message.payload) tell(message.payload);
      });
      next.on("error", (error) => {
        log.warn({ err: { message: error.message } }, "Live updates: database connection lost; reconnecting");
        next.release(true);
        client = null;
        if (!stopped) retry = setTimeout(() => void connect(), RECONNECT_MS);
      });
      await next.query(`listen ${CHANNEL}`);
      client = next;
      // Anything that changed while not listening: every open page refreshes once.
      for (const propertyId of subscribers.keys()) tell(propertyId);
    } catch (error) {
      log.warn({ err: { message: (error as Error).message } }, "Live updates: cannot listen yet; retrying");
      if (!stopped) retry = setTimeout(() => void connect(), RECONNECT_MS);
    }
  };
  void connect();

  return {
    subscribe(propertyId, onChange) {
      const set = subscribers.get(propertyId) ?? new Set();
      set.add(onChange);
      subscribers.set(propertyId, set);
      return () => {
        set.delete(onChange);
        if (!set.size) subscribers.delete(propertyId);
      };
    },
    async stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      for (const timer of due.values()) clearTimeout(timer);
      if (client) {
        await client.query(`unlisten ${CHANNEL}`).catch(() => undefined);
        client.release();
        client = null;
      }
    },
  };
}
