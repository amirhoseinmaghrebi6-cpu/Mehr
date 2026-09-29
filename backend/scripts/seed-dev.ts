/**
 * Local dev seed for self-hosted PostgreSQL: a dev user, the "tehran" home with rooms and one hub,
 * a set of SAMPLE board models in the hardware catalog, and one board of each installed in the
 * home, written with plain `pg`.
 *
 * The sample models (codes starting with "sample-") only exist for development. Their pin maps
 * follow the catalog's pin rules but are not real M2smart PCBs; real models are added by M2smart
 * with their actual pin maps (see docs/plans/phase-3.md).
 *
 * Idempotent: every row has a fixed id or natural key; models and boards are only created when
 * missing (a model in use is frozen), and reported device state is only inserted if missing.
 * Runs in one transaction.
 *
 * Usage: pnpm db:seed   (after pnpm db:migrate)
 *
 * Reads backend/.env.local: DATABASE_ADMIN_URL (required), SEED_DEV_USER_EMAIL (optional).
 * Refuses to run when NODE_ENV=production.
 */
import { capabilities, type CapabilityName, type CapabilityValue, type DeviceType, type PinFunction } from "@m2smart/contracts";
import type { Client } from "pg";
import { connectAdmin, runTool, ToolError } from "../src/db/admin";

// Fixed, non-secret identifiers so reruns converge on the same rows.
const DEV_USER_ID = "5eed0000-0000-4000-8000-000000000001";
const DEFAULT_DEV_USER_EMAIL = "dev@m2smart.local";
const PROPERTY_ID = "5eed0001-0000-4000-8000-000000000001";
const PROPERTY_SLUG = "tehran";
const HUB_ID = "5eed0002-0000-4000-8000-000000000001";
const HUB_HARDWARE_ID = "phase1-sim-hub-tehran-01";

/** Devices of the Phase 1 seed (no board); removed in favour of board devices. */
const LEGACY_DEVICE_IDS = Array.from({ length: 8 }, (_, index) => `5eed0003-0000-4000-8000-00000000000${index + 1}`);

const ROOMS = [
  { name: "Living room", photo: "living", sortOrder: 0 },
  { name: "Kitchen", photo: "kitchen", sortOrder: 1 },
  { name: "Primary suite", photo: "bedroom", sortOrder: 2 },
  { name: "Garden terrace", photo: "exterior", sortOrder: 3 },
] as const;
type RoomName = (typeof ROOMS)[number]["name"];

type SampleChannel = {
  key: string;
  type: DeviceType;
  name: string;
  room: RoomName;
  capabilities: Partial<Record<CapabilityName, CapabilityValue>>;
};
type SampleModel = {
  code: string;
  name: string;
  /** The board installed in the dev home. */
  board: { hardwareUid: string; name: string };
  channels: SampleChannel[];
  pins: Array<{ gpio: number; fn: PinFunction; channel: string | null; role: string }>;
  interlocks?: Array<{ group: string; gpios: number[] }>;
};

// Each channel lists its capabilities with the initial reported value.
const SAMPLE_MODELS: SampleModel[] = [
  {
    code: "sample-dimmer-1ch-rev-a",
    name: "Sample TRIAC dimmer, 1 channel",
    board: { hardwareUid: "DEV-TEHRAN-DIMMER-01", name: "Living room dimmer" },
    channels: [{ key: "light", type: "dimmer", name: "Pendant lights", room: "Living room", capabilities: { brightness: 68 } }],
    pins: [
      { gpio: 25, fn: "triac_gate", channel: "light", role: "gate" },
      { gpio: 34, fn: "zero_cross", channel: null, role: "zero_cross" },
      { gpio: 32, fn: "digital_in", channel: "light", role: "wall_switch" },
    ],
  },
  {
    code: "sample-switch-2ch-rev-a",
    name: "Sample relay switch, 2 channels",
    board: { hardwareUid: "DEV-TEHRAN-SWITCH-01", name: "Terrace and kitchen switch" },
    channels: [
      { key: "ch1", type: "switch", name: "Path lighting", room: "Garden terrace", capabilities: { power: false } },
      { key: "ch2", type: "switch", name: "Kitchen lights", room: "Kitchen", capabilities: { power: true } },
    ],
    pins: [
      { gpio: 16, fn: "relay", channel: "ch1", role: "relay" },
      { gpio: 17, fn: "relay", channel: "ch2", role: "relay" },
      { gpio: 32, fn: "digital_in", channel: "ch1", role: "wall_switch" },
      { gpio: 33, fn: "digital_in", channel: "ch2", role: "wall_switch" },
    ],
  },
  {
    code: "sample-socket-rev-a",
    name: "Sample smart socket with energy metering",
    board: { hardwareUid: "DEV-TEHRAN-SOCKET-01", name: "Kitchen socket" },
    channels: [{ key: "socket", type: "socket", name: "Coffee machine", room: "Kitchen", capabilities: { power: false, power_w: 0, energy_kwh: 3.2 } }],
    pins: [
      { gpio: 16, fn: "relay", channel: "socket", role: "relay" },
      { gpio: 35, fn: "pulse_in", channel: "socket", role: "energy_cf" },
    ],
  },
  {
    code: "sample-cooler-rev-a",
    name: "Sample evaporative cooler controller",
    board: { hardwareUid: "DEV-TEHRAN-COOLER-01", name: "Bedroom cooler" },
    channels: [{ key: "cooler", type: "cooler", name: "Evaporative cooler", room: "Primary suite", capabilities: { pump: false, speed: "off" } }],
    pins: [
      { gpio: 16, fn: "relay", channel: "cooler", role: "pump" },
      { gpio: 17, fn: "relay", channel: "cooler", role: "low" },
      { gpio: 18, fn: "relay", channel: "cooler", role: "high" },
    ],
    interlocks: [{ group: "speed", gpios: [17, 18] }],
  },
  {
    code: "sample-curtain-rev-a",
    name: "Sample curtain motor controller",
    board: { hardwareUid: "DEV-TEHRAN-CURTAIN-01", name: "Living room curtain" },
    channels: [{ key: "curtain", type: "curtain", name: "Sheer curtains", room: "Living room", capabilities: { curtain: "open" } }],
    pins: [
      { gpio: 16, fn: "relay", channel: "curtain", role: "open" },
      { gpio: 17, fn: "relay", channel: "curtain", role: "close" },
    ],
    interlocks: [{ group: "motion", gpios: [16, 17] }],
  },
  {
    code: "sample-contact-rev-a",
    name: "Sample door/window contact sensor",
    board: { hardwareUid: "DEV-TEHRAN-CONTACT-01", name: "Bedroom window sensor" },
    channels: [{ key: "contact", type: "contact_sensor", name: "Bedroom window", room: "Primary suite", capabilities: { contact: "closed" } }],
    pins: [{ gpio: 32, fn: "digital_in", channel: "contact", role: "reed" }],
  },
  {
    code: "sample-air-rev-a",
    name: "Sample air quality and humidity sensor (I2C)",
    board: { hardwareUid: "DEV-TEHRAN-AIR-01", name: "Living room air sensor" },
    channels: [
      { key: "air", type: "air_quality_sensor", name: "Air quality", room: "Living room", capabilities: { co2_ppm: 620, voc_index: 90 } },
      { key: "climate", type: "humidity_sensor", name: "Humidity", room: "Living room", capabilities: { humidity: 41, temperature: 22.5 } },
    ],
    pins: [
      { gpio: 21, fn: "i2c_sda", channel: null, role: "sda" },
      { gpio: 22, fn: "i2c_scl", channel: null, role: "scl" },
    ],
  },
];

async function ensureDevUser(client: Client, email: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
  if (rows.length && rows[0].id !== DEV_USER_ID) {
    throw new ToolError(`${email} already belongs to auth user ${rows[0].id}, not the dev user. Set SEED_DEV_USER_EMAIL to another address.`);
  }
  // The on_auth_user_created trigger creates the profile, organization and owner membership.
  await client.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict (id) do nothing",
    [DEV_USER_ID, email, { full_name: "M2smart Dev" }],
  );
}

async function resolveOrganizationId(client: Client): Promise<string> {
  const existing = await client.query<{ organization_id: string }>("select organization_id from public.properties where id = $1", [PROPERTY_ID]);
  const memberships = await client.query<{ organization_id: string }>(
    "select organization_id from public.organization_members where user_id = $1 and role = 'owner' order by created_at",
    [DEV_USER_ID],
  );
  const owned = memberships.rows.map((row) => row.organization_id);

  if (existing.rows.length) {
    const organizationId = existing.rows[0].organization_id;
    if (!owned.includes(organizationId)) {
      throw new ToolError(`Property ${PROPERTY_ID} already belongs to an organization the dev user does not own. Refusing to move it.`);
    }
    return organizationId;
  }
  if (!owned.length) {
    throw new ToolError("Dev user owns no organization. The on_auth_user_created trigger should have created one; run pnpm db:migrate.");
  }
  return owned[0];
}

/** Adds a sample model to the catalog if it is missing. An existing model is left as it is. */
async function ensureModel(client: Client, model: SampleModel): Promise<void> {
  const existing = await client.query("select 1 from public.hardware_models where code = $1", [model.code]);
  if (existing.rows.length) return;

  const { rows } = await client.query<{ id: string }>("insert into public.hardware_models (code, name) values ($1, $2) returning id", [model.code, model.name]);
  const modelId = rows[0].id;
  for (const channel of model.channels) {
    await client.query(
      "insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) values ($1, $2, $3, $4)",
      [modelId, channel.key, channel.type, channel.name],
    );
    for (const name of Object.keys(channel.capabilities) as CapabilityName[]) {
      const definition = capabilities[name];
      await client.query(
        `insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, min_value, max_value, step, enum_values, unit, writable)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          modelId, channel.key, name, definition.valueType,
          "min" in definition ? definition.min ?? null : null,
          "max" in definition ? definition.max ?? null : null,
          "step" in definition ? definition.step ?? null : null,
          "values" in definition ? [...definition.values] : null,
          "unit" in definition ? definition.unit ?? null : null,
          definition.writable,
        ],
      );
    }
  }
  for (const pin of model.pins) {
    await client.query(
      "insert into public.hardware_model_pins (model_id, gpio, function, channel_key, role) values ($1, $2, $3, $4, $5)",
      [modelId, pin.gpio, pin.fn, pin.channel, pin.role],
    );
  }
  for (const interlock of model.interlocks ?? []) {
    for (const gpio of interlock.gpios) {
      await client.query("insert into public.hardware_model_interlocks (model_id, group_key, gpio) values ($1, $2, $3)", [modelId, interlock.group, gpio]);
    }
  }
}

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new ToolError("The dev seed never runs with NODE_ENV=production.");

  const client = await connectAdmin();
  const email = (process.env.SEED_DEV_USER_EMAIL ?? DEFAULT_DEV_USER_EMAIL).trim().toLowerCase();
  let deviceCount = 0;

  try {
    await client.query("begin");
    await ensureDevUser(client, email);

    // App rows are written the way the backend writes them: as service_role.
    await client.query("set local role service_role");
    const organizationId = await resolveOrganizationId(client);

    const slugOwner = await client.query<{ id: string }>(
      "select id from public.properties where organization_id = $1 and slug = $2 and id <> $3",
      [organizationId, PROPERTY_SLUG, PROPERTY_ID],
    );
    if (slugOwner.rows.length) throw new ToolError(`Slug "${PROPERTY_SLUG}" is already used by property ${slugOwner.rows[0].id} in this organization.`);

    await client.query(
      `insert into public.properties (id, organization_id, name, property_type, slug, address, cover_photo, created_by)
       values ($1, $2, 'Tehran Villa', 'villa', $3, 'Niavaran, Tehran', 'living', $4)
       on conflict (id) do update set name = excluded.name, property_type = excluded.property_type, slug = excluded.slug`,
      [PROPERTY_ID, organizationId, PROPERTY_SLUG, DEV_USER_ID],
    );
    await client.query(
      `insert into public.property_members (property_id, user_id, role) values ($1, $2, 'owner')
       on conflict (property_id, user_id) do update set role = excluded.role`,
      [PROPERTY_ID, DEV_USER_ID],
    );
    await client.query(
      `insert into public.hubs (id, property_id, name, hardware_id) values ($1, $2, 'Tehran hub', $3)
       on conflict (id) do update set name = excluded.name, hardware_id = excluded.hardware_id`,
      [HUB_ID, PROPERTY_ID, HUB_HARDWARE_ID],
    );

    // Phase 1 seed devices had no board; their states and commands go with them.
    await client.query("delete from public.devices where id = any($1::uuid[]) and controller_id is null", [LEGACY_DEVICE_IDS]);

    const roomIds = new Map<string, string>();
    for (const room of ROOMS) {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.rooms (property_id, name, photo, sort_order) values ($1, $2, $3, $4)
         on conflict (property_id, lower(btrim(name))) do update set photo = excluded.photo, sort_order = excluded.sort_order
         returning id`,
        [PROPERTY_ID, room.name, room.photo, room.sortOrder],
      );
      roomIds.set(room.name, rows[0].id);
    }

    for (const model of SAMPLE_MODELS) {
      await ensureModel(client, model);

      const board = await client.query("select 1 from public.controllers where hardware_uid = $1", [model.board.hardwareUid]);
      if (!board.rows.length) {
        await client.query("select public.provision_controller($1, $2, $3, $4)", [HUB_ID, model.code, model.board.hardwareUid, model.board.name]);
      }

      for (const channel of model.channels) {
        const externalId = `${model.board.hardwareUid}:${channel.key}`;
        const { rows } = await client.query<{ id: string }>(
          "update public.devices set room_id = coalesce(room_id, $2) where hub_id = $3 and external_id = $1 returning id",
          [externalId, roomIds.get(channel.room), HUB_ID],
        );
        if (!rows.length) throw new ToolError(`Board device ${externalId} is missing; the model may differ from this seed.`);
        // Initial state only: never overwrite values a device has since reported.
        for (const [capability, value] of Object.entries(channel.capabilities)) {
          await client.query(
            `insert into public.device_states (property_id, device_id, capability, value) values ($1, $2, $3, $4)
             on conflict (device_id, capability) do nothing`,
            [PROPERTY_ID, rows[0].id, capability, JSON.stringify(value)],
          );
        }
        deviceCount++;
      }
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  console.log(
    `Dev seed complete for ${email} (${DEV_USER_ID}): home "${PROPERTY_SLUG}" (${PROPERTY_ID}), hub ${HUB_ID}, ` +
      `${ROOMS.length} rooms, ${SAMPLE_MODELS.length} sample boards, ${deviceCount} devices.`,
  );
}

runTool(seed);
