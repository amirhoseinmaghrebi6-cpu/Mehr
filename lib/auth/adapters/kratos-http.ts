/**
 * Server-side HTTP helpers for Kratos browser flows. The browser never talks to Kratos: Next.js
 * server code calls the Kratos public API, forwards only Kratos's own cookies (session + CSRF),
 * and relays the cookies Kratos sets back to the browser as HttpOnly cookies on the app origin.
 */
import { cookies } from "next/headers";

export const KRATOS_SESSION_COOKIE = "ory_kratos_session";
const REQUEST_TIMEOUT_MS = 5_000;

export function kratosPublicUrl(): string | null {
  const url = process.env.KRATOS_PUBLIC_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function apiInternalUrl(): string | null {
  const url = process.env.M2SMART_API_INTERNAL_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function isKratosCookie(name: string): boolean {
  return name === KRATOS_SESSION_COOKIE || name.startsWith("csrf_token_");
}

export class KratosUnavailableError extends Error {}

export type KratosMessage = { id: number; text: string; type: string };
export type KratosNode = { group: string; attributes: { name?: string; value?: unknown }; messages?: KratosMessage[] };
export type KratosFlow = { id: string; state?: string; ui: { messages?: KratosMessage[]; nodes: KratosNode[] } };
export type KratosResponse = { status: number; body: Record<string, unknown> | null };

async function forwardedCookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .filter((cookie) => isKratosCookie(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/** Copies Kratos's Set-Cookie headers onto the app response (server actions and route handlers). */
async function relaySetCookies(response: Response): Promise<void> {
  const setCookies = response.headers.getSetCookie();
  if (!setCookies.length) return;
  const jar = await cookies();
  for (const line of setCookies) {
    const [pair, ...attributes] = line.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!isKratosCookie(name)) continue;

    const options: { path: string; httpOnly: boolean; secure: boolean; sameSite: "lax" | "strict" | "none"; maxAge?: number; expires?: Date } = {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    };
    let expired = false;
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.split("=");
      const attributeValue = rest.join("=");
      switch (key.toLowerCase()) {
        case "path":
          options.path = attributeValue || "/";
          break;
        case "max-age":
          options.maxAge = Number(attributeValue);
          if (options.maxAge <= 0) expired = true;
          break;
        case "expires":
          options.expires = new Date(attributeValue);
          if (options.expires.getTime() <= Date.now()) expired = true;
          break;
        case "secure":
          options.secure = true;
          break;
        case "samesite":
          options.sameSite = attributeValue.toLowerCase() === "strict" ? "strict" : attributeValue.toLowerCase() === "none" ? "none" : "lax";
          break;
      }
    }
    try {
      if (expired || !value) jar.delete(name);
      else jar.set(name, value, options);
    } catch {
      // Server Components cannot set cookies; only actions and route handlers relay them.
    }
  }
}

/** Calls the Kratos public API as the current browser (its Kratos cookies only). */
export async function kratosRequest(path: string, init: { method?: string; body?: unknown; relayCookies?: boolean } = {}): Promise<KratosResponse> {
  const base = kratosPublicUrl();
  if (!base) throw new KratosUnavailableError("KRATOS_PUBLIC_URL is not set");

  const headers: Record<string, string> = { accept: "application/json" };
  const cookieHeader = await forwardedCookieHeader();
  if (cookieHeader) headers.cookie = cookieHeader;
  if (init.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new KratosUnavailableError(`Kratos did not answer: ${(error as Error).message}`);
  }
  if (init.relayCookies !== false) await relaySetCookies(response);
  if (response.status >= 500) throw new KratosUnavailableError(`Kratos returned ${response.status}`);

  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/** All messages on a flow: flow-level and per-field. */
export function flowMessages(body: Record<string, unknown> | null): KratosMessage[] {
  const ui = (body as KratosFlow | null)?.ui;
  if (!ui) return [];
  return [...(ui.messages ?? []), ...ui.nodes.flatMap((node) => node.messages ?? [])];
}

export function nodeValue(flow: KratosFlow, name: string): string | undefined {
  const value = flow.ui.nodes.find((node) => node.attributes.name === name)?.attributes.value;
  return typeof value === "string" ? value : undefined;
}
