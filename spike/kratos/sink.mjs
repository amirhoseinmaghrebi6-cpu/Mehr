// Stand-in for the SMS provider and the M2smart API webhook. Records what Kratos sends.
import { createServer } from "node:http";

const sms = [];
const hooks = [];

function readBody(request) {
  return new Promise((resolve) => {
    let data = "";
    request.on("data", (chunk) => (data += chunk));
    request.on("end", () => resolve(data));
  });
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  const url = new URL(request.url, "http://sink");
  if (request.method === "POST" && url.pathname === "/sms") {
    const body = JSON.parse(await readBody(request));
    sms.push({ ...body, at: Date.now() });
    console.log("SMS", JSON.stringify(body));
    return send(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/hooks/registration") {
    const body = JSON.parse(await readBody(request));
    hooks.push({ body, secret: request.headers["x-webhook-secret"] ?? null, at: Date.now() });
    console.log("HOOK", JSON.stringify(body));
    return send(response, 200, {});
  }
  if (url.pathname === "/sms") return send(response, 200, sms);
  if (url.pathname === "/hooks") return send(response, 200, hooks);
  if (url.pathname === "/health") return send(response, 200, { ok: true });
  send(response, 404, { error: "not found" });
}).listen(4455, () => console.log("sink listening on 4455"));
