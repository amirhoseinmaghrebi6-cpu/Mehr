/**
 * Makes an ESP32 DevKit a real test board, for local development: adds the DevKit model to the
 * hardware catalog (once), registers a new board in the registry of manufactured boards with a
 * random hardware id and factory secret, and writes the factory partition for the firmware
 * (firmware/provision/<id>.csv; firmware/README.md shows how to turn it into a .bin and flash it).
 * Production boards get theirs the same way at the factory, against the production registry.
 *
 * The DevKit model ("devkit-2ch-rev-a", firmware/main/board.c): relays on GPIO 16 and 17 (LEDs),
 * keys on GPIO 32 (also the setup key) and 33.
 *
 * Usage: pnpm dev:devkit          Refuses to run when NODE_ENV=production.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectAdmin, REPO_ROOT, runTool, ToolError } from "../src/db/admin";

const MODEL = { code: "devkit-2ch-rev-a", name: "DevKit test board, 2 channels" };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function makeDevkit(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new ToolError("dev:devkit never runs with NODE_ENV=production.");
  const client = await connectAdmin();
  // Not "DEV-": that prefix is for boards the simulator plays; this one is real hardware.
  const hardwareUid = `KIT-${randomBytes(4).toString("hex").toUpperCase()}`;
  const secret = randomBytes(32).toString("base64url");
  try {
    await client.query("begin");
    let { rows } = await client.query<{ id: string }>("select id from public.hardware_models where code = $1", [MODEL.code]);
    if (!rows.length) {
      ({ rows } = await client.query<{ id: string }>("insert into public.hardware_models (code, name) values ($1, $2) returning id", [MODEL.code, MODEL.name]));
      const model = rows[0].id;
      for (const [key, name] of [["ch1", "Light 1"], ["ch2", "Light 2"]]) {
        await client.query("insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) values ($1, $2, 'switch', $3)", [model, key, name]);
        await client.query("insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, writable) values ($1, $2, 'power', 'boolean', true)", [model, key]);
      }
      // GPIO 32 is key 1 and the setup key at once; the catalog lists it once, as the setup key.
      for (const [gpio, fn, channel, role] of [[16, "relay", "ch1", "relay"], [17, "relay", "ch2", "relay"], [33, "digital_in", "ch2", "wall_switch"], [32, "setup_button", null, "setup"]] as const) {
        await client.query("insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) values ($1, $2, $3, $4, $5)", [model, gpio, fn, channel, role]);
      }
      console.log(`Added the model ${MODEL.code} to the hardware catalog.`);
    }
    await client.query("insert into public.manufactured_boards (hardware_uid, model_id, factory_secret_hash) values ($1, $2, $3)", [hardwareUid, rows[0].id, sha256(secret)]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  const folder = join(REPO_ROOT, "firmware", "provision");
  mkdirSync(folder, { recursive: true });
  const csv = join(folder, `${hardwareUid}.csv`);
  writeFileSync(csv, `key,type,encoding,value\nm2factory,namespace,,\nuid,data,string,${hardwareUid}\nsecret,data,string,${secret}\n`);
  console.log(`Registered board ${hardwareUid}. Its factory partition: firmware/provision/${hardwareUid}.csv (secret: keep it off git).`);
  console.log("Next: firmware/README.md, \"Provision and flash a DevKit\".");
}

runTool(makeDevkit);
