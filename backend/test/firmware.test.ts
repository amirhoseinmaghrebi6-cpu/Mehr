/**
 * Firmware updates against the dev database: only operators upload and publish; an image says its
 * own version and model, so a wrong file or another board's firmware is refused; the active
 * release is offered to the model's online boards on another version, and to a board when it comes
 * online; boards download it without an account, and only while it is active.
 */
import type { AdminFirmwareResponse, FirmwareRelease } from "@m2smart/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncIdentity } from "../src/auth/identity-webhook";
import type { SessionCredential, SessionVerifier } from "../src/auth/session-verifier";
import type { Broker } from "../src/broker/broker";
import { offerUpdate, readImage } from "../src/firmware/releases";
import { buildServer } from "../src/server";
import { adminQuery, createApiPool, deleteUsers } from "./fixtures";

const OPERATOR = ["7e600000-0000-4000-8000-000000000001", "+989120000301"] as const;
const OWNER = ["7e600000-0000-4000-8000-000000000002", "+989120000302"] as const;
const MODEL = "test-fw-model";
const OTHER_MODEL = "test-fw-other";

/** A minimal ESP-IDF image: magic byte, the app description (magic, version) and our model marker. */
function image(version: string, model = MODEL, size = 4096): Buffer {
  const buffer = Buffer.alloc(size, 0xff);
  buffer[0] = 0xe9;
  buffer.writeUInt32LE(0xabcd5432, 0x20);
  buffer.fill(0, 0x30, 0x50);
  buffer.write(version, 0x30, "latin1");
  buffer.write(`M2MODEL=${model};`, 0x400, "latin1");
  return buffer;
}

const verifier: SessionVerifier = {
  async verify(credential: SessionCredential) {
    const user = credential.value === "operator" ? OPERATOR : credential.value === "owner" ? OWNER : null;
    if (!user) return null;
    return { userId: user[0], sessionId: `s-${user[0]}`, expiresAt: new Date(Date.now() + 3_600_000), authMethods: ["code"], identity: { phone: user[1], email: null, name: null }, issuer: "cloud" };
  },
};
const published: Array<[string, unknown]> = [];
const broker = { publish: async (boardId: string, kind: string, payload: unknown) => void (kind === "update" && published.push([boardId, payload])) } as unknown as Broker;

async function cleanup(): Promise<void> {
  await adminQuery("delete from public.properties where created_by = any($1::uuid[])", [[OPERATOR[0], OWNER[0]]]);
  await adminQuery("delete from public.hardware_models where code = any($1::text[])", [[MODEL, OTHER_MODEL]]);
  await deleteUsers([OPERATOR[0], OWNER[0]]);
}

describe("firmware updates", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;
  let boards: Record<"oldOnline" | "currentOnline" | "oldOffline", string>;
  let release: FirmwareRelease;
  const call = async (user: "operator" | "owner" | null, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) => {
    const response = await app.inject({ method, url, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.headers["content-type"]?.includes("json") ? response.json() : response.rawPayload, headers: response.headers };
  };
  const upload = (version: string, model = MODEL, user: "operator" | "owner" = "operator", file = image(version, model)) =>
    call(user, "POST", "/v1/admin/firmware", { modelCode: model, image: file.toString("base64"), notes: `Version ${version}` });

  beforeAll(async () => {
    await cleanup();
    for (const code of [MODEL, OTHER_MODEL]) {
      await adminQuery(`
        with model as (insert into public.hardware_models (code, name) values ($1, $2) returning id),
        channel as (insert into public.hardware_model_channels (model_id, channel_key, device_type, default_name) select id, 'ch1', 'switch', 'Light' from model returning model_id),
        pin as (insert into public.hardware_model_pins (model_id, gpio, function, role) select id, 35, 'setup_button', 'setup' from model)
        insert into public.hardware_model_capabilities (model_id, channel_key, capability, value_type, writable) select model_id, 'ch1', 'power', 'boolean', true from channel`, [code, `Firmware test ${code}`]);
    }
    pool = createApiPool();
    app = buildServer({ logLevel: "silent", platformAdmins: [OPERATOR[1]] }, pool, { sessionVerifier: verifier, broker: () => broker });
    await syncIdentity(pool, { id: OPERATOR[0], phone: OPERATOR[1], email: null, name: "Operator" });
    await syncIdentity(pool, { id: OWNER[0], phone: OWNER[1], email: null, name: "Owner" });
    const home = (await call("owner", "POST", "/v1/properties", { name: "Firmware home" })).body as { id: string };
    await adminQuery("insert into public.hubs (property_id, name, hardware_id) values ($1, 'Cloud', $2)", [home.id, `fw-test-${home.id}`]);
    const add = async (uid: string, online: boolean, fw: string) => {
      const [{ id }] = await adminQuery<{ id: string }>("select public.provision_controller((select id from public.hubs where property_id = $1), $2, $3, 'Board') as id", [home.id, MODEL, uid]);
      await adminQuery("update public.controllers set online = $2, firmware_version = $3 where id = $1", [id, online, fw]);
      return id;
    };
    boards = { oldOnline: await add(`FW-OLD-ON-${home.id.slice(0, 6)}`, true, "1.0.0"), currentOnline: await add(`FW-NEW-ON-${home.id.slice(0, 6)}`, true, "1.2.0"), oldOffline: await add(`FW-OLD-OFF-${home.id.slice(0, 6)}`, false, "1.0.0") };
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await cleanup();
  });

  it("reads the version and the model from the image itself", () => {
    expect(readImage(image("1.2.0"))).toEqual({ version: "1.2.0", modelCode: MODEL, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(readImage(Buffer.from("not a firmware at all, just text".repeat(10)))).toEqual({ error: "not_firmware" });
    const noMarker = image("1.2.0");
    noMarker.fill(0xff, 0x400, 0x440);
    expect(readImage(noMarker)).toEqual({ error: "no_model" });
  });

  it("only operators upload, and only a firmware of the chosen model", async () => {
    expect((await upload("1.2.0", MODEL, "owner")).status).toBe(403);
    expect((await call(null, "GET", "/v1/admin/firmware")).status).toBe(401);
    expect((await upload("1.2.0", OTHER_MODEL, "operator", image("1.2.0", MODEL))).status).toBe(400); // built for another board
    expect((await upload("x", MODEL, "operator", Buffer.from("garbage".repeat(100)))).status).toBe(400);
    const uploaded = await upload("1.2.0");
    expect(uploaded.status).toBe(201);
    release = uploaded.body as FirmwareRelease;
    expect(release).toMatchObject({ modelCode: MODEL, version: "1.2.0", sizeBytes: 4096, notes: "Version 1.2.0", active: false });
    expect((await upload("1.2.0")).status).toBe(409); // the same version again
  });

  it("an inactive release is not downloadable and offered to nobody", async () => {
    expect((await call(null, "GET", `/v1/firmware/${release.id}.bin`)).status).toBe(404);
    expect(await offerUpdate(pool, broker, boards.oldOnline, "1.0.0")).toBe(false);
    expect(published).toEqual([]);
  });

  it("making it active offers it to the model's online boards on another version", async () => {
    expect((await call("owner", "PATCH", `/v1/admin/firmware/${release.id}`, { active: true })).status).toBe(403);
    expect((await call("operator", "PATCH", `/v1/admin/firmware/${release.id}`, { active: true })).status).toBe(204);
    expect(published).toEqual([[boards.oldOnline, { version: "1.2.0", path: `/api/v1/firmware/${release.id}.bin`, sha256: release.sha256, size: 4096 }]]);
  });

  it("a board downloads it without an account", async () => {
    const download = await call(null, "GET", `/v1/firmware/${release.id}.bin`);
    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body as Buffer, image("1.2.0"))).toBe(0);
    expect(download.headers["x-sha256"]).toBe(release.sha256);
    expect((await call(null, "GET", "/v1/firmware/nope.bin")).status).toBe(404);
  });

  it("a board coming online on an older version is offered it; one on the version is not", async () => {
    published.length = 0;
    expect(await offerUpdate(pool, broker, boards.oldOffline, "1.0.0")).toBe(true);
    expect(await offerUpdate(pool, broker, boards.currentOnline, "1.2.0")).toBe(false);
    expect(published.map(([board]) => board)).toEqual([boards.oldOffline]);
  });

  it("the panel shows each model's active version and its boards by version", async () => {
    const list = (await call("operator", "GET", "/v1/admin/firmware")).body as AdminFirmwareResponse;
    expect(list.models.find((model) => model.code === MODEL)).toEqual({ code: MODEL, name: `Firmware test ${MODEL}`, activeVersion: "1.2.0", boards: [{ version: "1.0.0", count: 2 }, { version: "1.2.0", count: 1 }] });
    expect(list.releases.find((entry) => entry.id === release.id)?.active).toBe(true);
    expect(JSON.stringify(list)).not.toContain("image");
  });

  it("one active version per model: activating another deactivates the first; pausing stops downloads", async () => {
    const next = (await upload("1.3.0")).body as FirmwareRelease;
    await call("operator", "PATCH", `/v1/admin/firmware/${next.id}`, { active: true });
    const list = (await call("operator", "GET", "/v1/admin/firmware")).body as AdminFirmwareResponse;
    expect(list.releases.filter((entry) => entry.modelCode === MODEL && entry.active).map((entry) => entry.version)).toEqual(["1.3.0"]);
    await call("operator", "PATCH", `/v1/admin/firmware/${next.id}`, { active: false });
    expect((await call(null, "GET", `/v1/firmware/${next.id}.bin`)).status).toBe(404);
    expect((await call("operator", "DELETE", `/v1/admin/firmware/${next.id}`)).status).toBe(204);
    expect((await call("operator", "DELETE", `/v1/admin/firmware/${next.id}`)).status).toBe(404);
  });
});
