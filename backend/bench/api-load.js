/**
 * API load test (k6), against the dev API directly (no nginx), with the accounts that
 * bench/api-users.ts made. Run inside k6's Docker image:
 *
 *   docker run --rm -v "<backend/bench>:/bench" -v "<temp>:/data" -e USERS=/data/m2smart-bench-users.json \
 *     grafana/k6 run /bench/api-load.js
 *
 * Each virtual user is one person with the app open: it reads their homes, devices and account
 * as the app does on every page, and now and then switches a light (a command the dev board
 * simulator carries out). Users ramp from 0 to PEAK (default 300) and back; the thresholds are what the app needs
 * to feel instant.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const API = __ENV.API ?? "http://host.docker.internal:4000";
const users = JSON.parse(open(__ENV.USERS));
const commands = new Counter("commands_sent");
/** Users at the peak (PEAK=1000 for a capacity run). */
const PEAK = Number(__ENV.PEAK ?? 300);

export const options = {
  scenarios: {
    app: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: Math.round(PEAK / 2) },
        { duration: "1m", target: PEAK },
        { duration: "1m", target: PEAK },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:read}": ["p(95)<300"],
    "http_req_duration{kind:command}": ["p(95)<500"],
  },
};

export default function () {
  const user = users[(__VU - 1) % users.length];
  const headers = { authorization: `Bearer ${user.token}`, "content-type": "application/json" };
  const read = (path) => http.get(`${API}/v1${path}`, { headers, tags: { kind: "read" } });
  check(read("/me"), { "me 200": (r) => r.status === 200 });
  check(read("/properties"), { "homes 200": (r) => r.status === 200 });
  check(read(`/properties/${user.propertyId}/devices`), { "devices 200": (r) => r.status === 200 });
  if (Math.random() < 0.1) {
    const deviceId = user.deviceIds[Math.floor(Math.random() * user.deviceIds.length)];
    const body = JSON.stringify({ deviceId, capability: "power", targetValue: Math.random() < 0.5, idempotencyKey: `${__VU}-${__ITER}-${Date.now()}` });
    const response = http.post(`${API}/v1/properties/${user.propertyId}/commands`, body, { headers, tags: { kind: "command" }, responseCallback: http.expectedStatuses(200, 201, 409) });
    // 409: this device already has its maximum of open commands (a fast clicker); not an error.
    check(response, { "command accepted": (r) => r.status === 201 || r.status === 200 || r.status === 409 });
    commands.add(1);
  }
  sleep(1 + Math.random() * 2);
}
