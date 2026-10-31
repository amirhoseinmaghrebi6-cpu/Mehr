/**
 * Plays a brand-new board in pairing mode, for local development: give it the setup code the app
 * shows for a waiting board. It adds a board of that product to the registry of manufactured
 * boards and uses the code through the API's real route (POST /v1/boards/claim), as the firmware
 * will (docs/board-protocol.md). The dev board simulator then connects the board.
 *
 * Usage: pnpm dev:pairing <setup code>       (e.g. K7M4-Q9X2-PD8W)
 *
 * Needs the API running (pnpm api:dev). Refuses to run when NODE_ENV=production.
 */
import { createHash, randomBytes } from "node:crypto";
import { normalizeSetupCode } from "@m2smart/contracts";
import { connectAdmin, runTool, ToolError } from "../src/db/admin";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function playBoard(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new ToolError("dev:pairing never runs with NODE_ENV=production.");
  const code = normalizeSetupCode(process.argv.slice(2).join(""));
  if (!code) throw new ToolError("Usage: pnpm dev:pairing <setup code>   (the code the app shows, e.g. K7M4-Q9X2-PD8W)");

  const hardwareUid = `DEV-${randomBytes(4).toString("hex").toUpperCase()}`;
  const secret = randomBytes(32).toString("base64url");
  const client = await connectAdmin();
  try {
    // The product the code waits for: the board played here is one of those.
    const { rows } = await client.query<{ model_id: string }>(
      `select board.model_id from public.board_setup_codes as setup join public.controllers as board on board.id = setup.controller_id
       where setup.code_hash = $1 and setup.expires_at > now()`,
      [sha256(code)],
    );
    if (!rows.length) throw new ToolError("No waiting board has this setup code (it may have expired: ask the app for a new one).");
    await client.query("insert into public.manufactured_boards (hardware_uid, model_id, factory_secret_hash) values ($1, $2, $3)", [hardwareUid, rows[0].model_id, sha256(secret)]);
  } finally {
    await client.end();
  }

  const api = (process.env.M2SMART_API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 4000}`).replace(/\/+$/, "");
  const response = await fetch(`${api}/v1/boards/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hardwareUid, secret, code }) });
  if (!response.ok) throw new ToolError(`The API refused the board (${response.status}): ${await response.text()}`);
  console.log(`Board ${hardwareUid} used the setup code and joined the home. The dev board simulator connects it within seconds.`);
}

runTool(playBoard);
