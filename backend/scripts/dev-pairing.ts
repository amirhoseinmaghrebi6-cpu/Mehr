/**
 * Plays a brand-new board in pairing mode, for local development: the board is added to the
 * registry of manufactured boards, "announces" itself, and its pairing code is printed. Paste
 * that code (or upload it as a QR image) under "Add a device" in the app; the dev board simulator
 * then connects the board, as the real firmware will (docs/board-protocol.md).
 *
 * Usage: pnpm dev:pairing <model-code>
 *        pnpm dev:pairing                    (lists models)
 *
 * Refuses to run when NODE_ENV=production.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { formatPairingCode } from "@m2smart/contracts";
import { connectAdmin, runTool, ToolError } from "../src/db/admin";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function startPairing(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new ToolError("dev:pairing never runs with NODE_ENV=production.");
  const [modelCode] = process.argv.slice(2);
  const client = await connectAdmin();
  try {
    if (!modelCode) {
      const models = await client.query<{ code: string; name: string }>(
        "select code, name from public.hardware_models as model where exists (select 1 from public.hardware_model_pins as pin where pin.model_id = model.id and pin.function = 'setup_button') order by code",
      );
      console.log(["Usage: pnpm dev:pairing <model-code>", "", "Models:", ...models.rows.map((model) => `  ${model.code}  ${model.name}`)].join("\n"));
      return;
    }
    const model = await client.query<{ id: string }>("select id from public.hardware_models where code = $1", [modelCode]);
    if (!model.rows.length) throw new ToolError(`No hardware model ${modelCode}. Run pnpm dev:pairing without arguments to list models.`);

    const hardwareUid = `DEV-${randomBytes(4).toString("hex").toUpperCase()}`;
    const code = Array.from({ length: 26 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    await client.query("begin");
    await client.query("insert into public.manufactured_boards (hardware_uid, model_id, factory_secret_hash) values ($1, $2, $3)", [
      hardwareUid, model.rows[0].id, sha256(randomBytes(32).toString("base64url")),
    ]);
    await client.query("insert into public.board_pairings (hardware_uid, code_hash) values ($1, $2)", [hardwareUid, sha256(code)]);
    await client.query("commit");
    console.log(`Board ${hardwareUid} (${modelCode}) is in pairing mode. Its pairing code, valid once and for 24 hours:\n\n${formatPairingCode(hardwareUid, code)}\n`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

runTool(startPairing);
