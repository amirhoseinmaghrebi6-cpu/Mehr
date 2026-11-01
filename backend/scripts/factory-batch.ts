/**
 * Factory provisioning: makes a batch of boards of one model ready for production (docs/factory.md).
 * Each board gets a hardware id and a random factory secret; the registry of manufactured boards
 * keeps only the secret's SHA-256. The secrets themselves go once, to the output folder: one
 * factory-partition file per board (<id>.csv, for ESP-IDF's nvs_partition_gen) and a manifest.
 * Flash them, then delete the folder.
 *
 * Usage: factory-batch <model-code> <count> [output folder]
 *   development: pnpm factory:batch m2-t2-rev-a 10
 *   production:  see docs/factory.md (runs in the API image, like the migrations)
 *
 * Reads DATABASE_ADMIN_URL. Runs in production too: that is what it is for.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connectAdmin, runTool, ToolError } from "../src/db/admin";

const MAX_BATCH = 1000;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function makeBatch(): Promise<void> {
  const [modelCode, countText, folderArg] = process.argv.slice(2);
  const count = Number(countText);
  if (!modelCode || !Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    throw new ToolError(`Usage: factory-batch <model-code> <count 1-${MAX_BATCH}> [output folder]`);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const folder = resolve(folderArg ?? join("factory", `${modelCode}-${stamp}-${randomBytes(2).toString("hex")}`));
  if (existsSync(join(folder, "manifest.csv"))) throw new ToolError(`${folder} already holds a batch; choose another folder.`);

  const client = await connectAdmin();
  const boards: Array<{ uid: string; secret: string }> = [];
  try {
    const { rows } = await client.query<{ id: string }>(
      `select model.id from public.hardware_models as model
       where model.code = $1 and exists (select 1 from public.hardware_model_pins as pin where pin.model_id = model.id and pin.function = 'setup_button')`,
      [modelCode],
    );
    if (!rows.length) throw new ToolError(`No model ${modelCode} with a setup key in the catalog.`);
    // e.g. M2-T2-REV-A-1F3A9C07: the model, then 8 random hex digits (the last 4 name its setup network).
    const prefix = modelCode.toUpperCase();
    await client.query("begin");
    for (let i = 0; i < count; i++) {
      const board = { uid: `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`, secret: randomBytes(32).toString("base64url") };
      const inserted = await client.query("insert into public.manufactured_boards (hardware_uid, model_id, factory_secret_hash) values ($1, $2, $3) on conflict do nothing", [board.uid, rows[0].id, sha256(board.secret)]);
      // A clash of 32 random bits is rare; draw again.
      if (!inserted.rowCount) {
        i--;
        continue;
      }
      boards.push(board);
    }
    // Written before the commit: if the files cannot be written, nothing is registered.
    mkdirSync(folder, { recursive: true });
    for (const board of boards) {
      writeFileSync(join(folder, `${board.uid}.csv`), `key,type,encoding,value\nm2factory,namespace,,\nuid,data,string,${board.uid}\nsecret,data,string,${board.secret}\n`, { mode: 0o600 });
    }
    writeFileSync(join(folder, "manifest.csv"), `hardware_uid,model\n${boards.map((board) => `${board.uid},${modelCode}`).join("\n")}\n`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  console.log(`Registered ${boards.length} boards of ${modelCode}. Their factory partitions: ${folder}`);
  console.log("They hold the boards' secrets: flash them (docs/factory.md), then delete the folder.");
}

runTool(makeBatch);
