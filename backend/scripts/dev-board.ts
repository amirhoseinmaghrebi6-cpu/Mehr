/**
 * Adds a simulated ESP32 board of a catalog model to a home, for local development. Real boards
 * join a home with their own pairing code (Phase 4, step 4E); this is the stand-in until then.
 *
 * Usage: pnpm dev:board <property-id> <model-code> [board name]
 *        pnpm dev:board                      (lists homes and models)
 *
 * The home gets its internal hub row (its cloud connection; there is no physical hub) if it has
 * none yet. The board's devices start with a neutral
 * reported state (off, closed, 0), as if the ESP32 had just reported. Refuses to run when
 * NODE_ENV=production.
 */
import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { connectAdmin, runTool, ToolError } from "../src/db/admin";

async function listChoices(client: Client): Promise<string> {
  const homes = await client.query<{ id: string; name: string }>("select id, name from public.properties order by created_at desc limit 20");
  // Models without a setup button cannot join a home any more (Phase 3.5); they are not offered.
  const models = await client.query<{ code: string; name: string }>(
    "select code, name from public.hardware_models as model where exists (select 1 from public.hardware_model_pins as pin where pin.model_id = model.id and pin.function = 'setup_button') order by code",
  );
  return [
    "Usage: pnpm dev:board <property-id> <model-code> [board name]",
    "",
    "Homes (latest 20):",
    ...homes.rows.map((home) => `  ${home.id}  ${home.name}`),
    "",
    "Models:",
    ...models.rows.map((model) => `  ${model.code}  ${model.name}`),
  ].join("\n");
}

async function addBoard(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new ToolError("dev:board never runs with NODE_ENV=production.");
  const [propertyId, modelCode, ...nameParts] = process.argv.slice(2);

  const client = await connectAdmin();
  try {
    if (!propertyId || !modelCode) {
      console.log(await listChoices(client));
      return;
    }

    await client.query("begin");
    await client.query("set local role service_role");

    const home = await client.query<{ name: string }>("select name from public.properties where id = $1", [propertyId]);
    if (!home.rows.length) throw new ToolError(`No home with id ${propertyId}. Run pnpm dev:board without arguments to list homes.`);
    const model = await client.query<{ name: string }>("select name from public.hardware_models where code = $1", [modelCode]);
    if (!model.rows.length) throw new ToolError(`No hardware model ${modelCode}. Run pnpm dev:board without arguments to list models.`);

    let hub = await client.query<{ id: string }>("select id from public.hubs where property_id = $1 order by created_at limit 1", [propertyId]);
    if (!hub.rows.length) {
      hub = await client.query<{ id: string }>(
        "insert into public.hubs (property_id, name, hardware_id, status) values ($1, 'Dev hub', $2, 'online') returning id",
        [propertyId, `dev-hub-${propertyId}`],
      );
    }

    const hardwareUid = `DEV-${randomBytes(4).toString("hex").toUpperCase()}`;
    const boardName = nameParts.join(" ").trim() || model.rows[0].name.slice(0, 60);
    const { rows } = await client.query<{ id: string }>("select public.provision_controller($1, $2, $3, $4) as id", [hub.rows[0].id, modelCode, hardwareUid, boardName]);
    const controllerId = rows[0].id;

    // Neutral first report for every capability: false, the first enum value, or the minimum (else 0).
    await client.query(
      `insert into public.device_states (property_id, device_id, capability, value)
       select capability.property_id, capability.device_id, capability.capability,
         case capability.value_type
           when 'boolean' then 'false'::jsonb
           when 'enum' then to_jsonb(capability.enum_values[1])
           else to_jsonb(coalesce(capability.min_value, 0))
         end
       from public.device_capabilities as capability
       join public.devices as device on device.id = capability.device_id
       where device.controller_id = $1
       on conflict (device_id, capability) do nothing`,
      [controllerId],
    );
    await client.query("update public.controllers set online = true, last_seen_at = now() where id = $1", [controllerId]);
    await client.query("update public.devices set online = true, last_seen_at = now() where controller_id = $1", [controllerId]);

    const devices = await client.query<{ name: string; device_type: string }>("select name, device_type from public.devices where controller_id = $1 order by channel_key", [controllerId]);
    await client.query("commit");
    console.log(`Added board ${hardwareUid} (${modelCode}) to "${home.rows[0].name}":`);
    for (const device of devices.rows) console.log(`  ${device.name} (${device.device_type})`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

runTool(addBoard);
