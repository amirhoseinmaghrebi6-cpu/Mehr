/**
 * The few Kratos admin API calls the operator's panel needs (http/admin.ts): block or unblock an
 * identity, and delete one. Blocking sets the identity's state to "inactive", so Kratos refuses
 * its sign-ins and sessions, and ends the sessions it has now.
 *
 * The admin API is never reachable from outside: KRATOS_ADMIN_URL points at the compose network
 * in production and at 127.0.0.1 in development.
 */
const REQUEST_TIMEOUT_MS = 5_000;

export class IdentityAdminError extends Error {}

export interface IdentityAdmin {
  setBlocked(identityId: string, blocked: boolean): Promise<void>;
  /** Deletes the identity with its sessions; an identity that is already gone is fine. */
  delete(identityId: string): Promise<void>;
}

export function createKratosAdmin(baseUrl: string, fetchImpl: typeof fetch = fetch): IdentityAdmin {
  const call = async (method: string, path: string, body?: unknown): Promise<number> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new IdentityAdminError(`Kratos admin API did not answer: ${(error as Error).message}`);
    }
    return response.status;
  };
  const expect = (status: number, ok: number[], what: string) => {
    if (!ok.includes(status)) throw new IdentityAdminError(`Kratos admin API: ${what} answered ${status}`);
  };
  const identity = (id: string) => `/admin/identities/${encodeURIComponent(id)}`;

  return {
    async setBlocked(id, blocked) {
      expect(await call("PATCH", identity(id), [{ op: "replace", path: "/state", value: blocked ? "inactive" : "active" }]), [200], "changing the state");
      // 404: the identity has no sessions.
      if (blocked) expect(await call("DELETE", `${identity(id)}/sessions`, undefined), [204, 404], "ending the sessions");
    },
    async delete(id) {
      expect(await call("DELETE", identity(id)), [204, 404], "deleting the identity");
    },
  };
}
