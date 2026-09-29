// Phase 2D-2 spike checks. Runs inside the isolated network:
//   MSYS_NO_PATHCONV=1 docker compose -f spike/kratos/compose.yaml exec -T sink node /spike/test.mjs
const K = "http://kratos:4433";
const SINK = "http://sink:4455";
const results = [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function check(item, label, ok, detail = "") {
  results.push({ item, label, ok });
  console.log(`${ok ? "PASS" : "FAIL"} [${item}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const json = { "content-type": "application/json", accept: "application/json" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function latestCode(phone, since) {
  for (let i = 0; i < 20; i++) {
    const messages = await (await fetch(`${SINK}/sms`)).json();
    const hit = messages.filter((m) => m.to === phone && m.at >= since).at(-1);
    if (hit) return { code: /(\d{6})/.exec(hit.text)?.[1], message: hit };
    await sleep(250);
  }
  return {};
}

// Minimal cookie jar, as the Next.js server would keep per browser request.
class Jar {
  cookies = new Map();
  store(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [name, ...value] = pair.split("=");
      const expired = attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired) this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value.join("="));
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const csrfOf = (flow) => flow.ui.nodes.find((n) => n.attributes.name === "csrf_token")?.attributes.value;

// ---------- API flows (native apps) ----------
const phone = "+989121234567";

// 1 + 2 + 3 + 4: passwordless registration by SMS code
let t0 = Date.now();
let flow = await (await fetch(`${K}/self-service/registration/api`)).json();
let r = await fetch(`${K}/self-service/registration?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "code", traits: { phone, name: "Sara Ahmadi" } }) });
let body = await r.json();
check(1, "registration by phone starts and asks for the SMS code", r.status === 400 && body.state === "sent_email", `state=${body.state}`);

let { code, message } = await latestCode(phone, t0);
check(2, "courier delivered the code to the HTTP SMS endpoint", Boolean(code) && message.to === phone, `template=${message?.template}`);

r = await fetch(`${K}/self-service/registration?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "code", code, traits: { phone, name: "Sara Ahmadi" } }) });
body = await r.json();
const identityId = body.identity?.id;
let sessionToken = body.session_token;
check(1, "correct code completes registration and signs the user in", r.status === 200 && Boolean(sessionToken), `status=${r.status}`);
check(3, "identity id is a UUID", UUID.test(identityId ?? ""), identityId);

await sleep(500);
const hooks = await (await fetch(`${SINK}/hooks`)).json();
const hook = hooks.find((h) => h.body.identity_id === identityId);
check(4, "registration webhook reached our API with identity id and phone", Boolean(hook) && hook.body.phone === phone, JSON.stringify(hook?.body));
check(4, "webhook carries the shared secret header", hook?.secret === "spike-webhook-secret");

// 6: session check and logout (API)
r = await fetch(`${K}/sessions/whoami`, { headers: { "x-session-token": sessionToken } });
body = await r.json();
check(6, "whoami returns the session for the token", r.status === 200 && body.identity?.id === identityId, `aal=${body.authenticator_assurance_level}`);
r = await fetch(`${K}/self-service/logout/api`, { method: "DELETE", headers: json, body: JSON.stringify({ session_token: sessionToken }) });
check(6, "API logout revokes the session", r.status === 204, `status=${r.status}`);
r = await fetch(`${K}/sessions/whoami`, { headers: { "x-session-token": sessionToken } });
check(6, "whoami rejects the revoked token", r.status === 401, `status=${r.status}`);

// 1: passwordless login by SMS code; wrong code rejected
t0 = Date.now();
flow = await (await fetch(`${K}/self-service/login/api`)).json();
r = await fetch(`${K}/self-service/login?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "code", identifier: phone }) });
body = await r.json();
({ code } = await latestCode(phone, t0));
check(1, "login by phone sends a new SMS code", r.status === 400 && Boolean(code), `state=${body.state}`);
r = await fetch(`${K}/self-service/login?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "code", identifier: phone, code: code === "000000" ? "111111" : "000000" }) });
check(1, "wrong code is rejected", r.status === 400);
r = await fetch(`${K}/self-service/login?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "code", identifier: phone, code }) });
body = await r.json();
sessionToken = body.session_token;
check(1, "correct code signs in the same identity", r.status === 200 && body.session?.identity?.id === identityId, `status=${r.status}`);

// 7: optional password — set it in settings, then log in with it
flow = await (await fetch(`${K}/self-service/settings/api`, { headers: { "x-session-token": sessionToken } })).json();
r = await fetch(`${K}/self-service/settings?flow=${flow.id}`, { method: "POST", headers: { ...json, "x-session-token": sessionToken }, body: JSON.stringify({ method: "password", password: "Tehran-Villa-2026-strong" }) });
body = await r.json();
check(7, "signed-in user can add an optional password", r.status === 200 && body.state === "success", `status=${r.status} state=${body.state}`);
flow = await (await fetch(`${K}/self-service/login/api`)).json();
r = await fetch(`${K}/self-service/login?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "password", identifier: phone, password: "Tehran-Villa-2026-strong" }) });
body = await r.json();
check(7, "login with phone + password works", r.status === 200 && body.session?.identity?.id === identityId, `status=${r.status}`);
r = await fetch(`${K}/self-service/login?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "password", identifier: phone, password: "wrong-password-123" }) });
check(7, "wrong password is rejected", r.status === 400 || r.status === 410, `status=${r.status}`);

// 7: a user who never sets a password still works (code-only)
const phone2 = "+989351112233";
t0 = Date.now();
flow = await (await fetch(`${K}/self-service/registration/api`)).json();
await fetch(`${K}/self-service/registration?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "code", traits: { phone: phone2 } }) });
({ code } = await latestCode(phone2, t0));
r = await fetch(`${K}/self-service/registration?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "code", code, traits: { phone: phone2 } }) });
check(7, "registration needs no password and no name (phone only)", r.status === 200);

// ---------- 5: browser flows as the Next.js server would drive them ----------
const jar = new Jar();
r = await fetch(`${K}/self-service/login/browser`, { headers: { accept: "application/json" } });
jar.store(r);
flow = await r.json();
const csrf = csrfOf(flow);
check(5, "browser login flow returns a CSRF token and sets the CSRF cookie", Boolean(csrf) && jar.cookies.size > 0, `cookies=${[...jar.cookies.keys()].join(",")}`);

r = await fetch(`${K}/self-service/login?flow=${flow.id}`, { method: "POST", headers: json, body: JSON.stringify({ method: "code", identifier: phone, csrf_token: csrf }) });
body = await r.json();
check(5, "submitting without the CSRF cookie is refused", r.status === 403 || body.error?.id === "security_csrf_violation", `status=${r.status} ${body.error?.id ?? ""}`);

t0 = Date.now();
r = await fetch(`${K}/self-service/login?flow=${flow.id}`, { method: "POST", headers: { ...json, cookie: jar.header() }, body: JSON.stringify({ method: "code", identifier: phone, csrf_token: csrf }) });
jar.store(r);
({ code } = await latestCode(phone, t0));
r = await fetch(`${K}/self-service/login?flow=${flow.id}`, { method: "POST", headers: { ...json, cookie: jar.header() }, body: JSON.stringify({ method: "code", identifier: phone, code, csrf_token: csrf }) });
jar.store(r);
body = await r.json();
const sessionCookie = r.headers.getSetCookie().find((c) => c.startsWith("ory_kratos_session="));
check(5, "browser code login sets an HttpOnly session cookie", r.status === 200 && /httponly/i.test(sessionCookie ?? ""), sessionCookie?.split(";").slice(1).map((s) => s.trim()).join("; "));

r = await fetch(`${K}/sessions/whoami`, { headers: { cookie: jar.header() } });
body = await r.json();
check(6, "whoami works with the forwarded browser cookie", r.status === 200 && body.identity?.id === identityId);

r = await fetch(`${K}/self-service/logout/browser`, { headers: { accept: "application/json", cookie: jar.header() } });
body = await r.json();
r = await fetch(`${K}/self-service/logout?token=${body.logout_token}`, { headers: { accept: "application/json", cookie: jar.header() }, redirect: "manual" });
jar.store(r);
const after = await fetch(`${K}/sessions/whoami`, { headers: { cookie: jar.header() } });
check(6, "browser logout ends the session", (r.status === 204 || r.status === 303) && after.status === 401, `logout=${r.status} whoami=${after.status}`);

// ---------- summary ----------
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const item of [1, 2, 3, 4, 5, 6, 7]) {
  const own = results.filter((x) => x.item === item);
  console.log(`item ${item}: ${own.every((x) => x.ok) ? "OK" : "FAILED"} (${own.filter((x) => x.ok).length}/${own.length})`);
}
process.exit(failed.length ? 1 : 0);
