/**
 * Firmware updates (docs/board-protocol.md, "Firmware updates"):
 *   GET    /v1/firmware/:id.bin            (a board downloads an active image; no session)
 *   GET    /v1/admin/firmware              (operators: models, versions in use, releases)
 *   POST   /v1/admin/firmware              (operators: upload an image)
 *   PATCH  /v1/admin/firmware/:id          (operators: make it the active version, or pause it)
 *   DELETE /v1/admin/firmware/:id          (operators: delete a release)
 *
 * Images are not secret (the code is in every board), so the download needs no account; only an
 * active release can be downloaded.
 */
import { FIRMWARE_MAX_BYTES, updateFirmwareRequest, uploadFirmwareRequest, type AdminFirmwareResponse, type ApiErrorResponse, type FirmwareRelease } from "@m2smart/contracts";
import type { KeyObject } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { VerifiedSession } from "../auth/session-verifier";
import type { Broker } from "../broker/broker";
import { withSystemTx } from "../db/tx";
import { openSigned, readImage, rollOut } from "../firmware/releases";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const send = (reply: FastifyReply, status: number, error: ApiErrorResponse["error"]) => reply.code(status).send({ error } satisfies ApiErrorResponse);

type ReleaseRow = { id: string; model_code: string; version: string; size_bytes: number; sha256: string; notes: string; active: boolean; created_at: Date };
const RELEASE_COLUMNS = "release.id, model.code as model_code, release.version, release.size_bytes, release.sha256, release.notes, release.active, release.created_at";
const toRelease = (row: ReleaseRow): FirmwareRelease => ({
  id: row.id, modelCode: row.model_code, version: row.version, sizeBytes: row.size_bytes, sha256: row.sha256, notes: row.notes, active: row.active, createdAt: row.created_at.toISOString(),
});

export function registerFirmwareDownload(app: FastifyInstance, pool: Pool): void {
  app.get<{ Params: { file: string } }>("/v1/firmware/:file", async (request, reply) => {
    const id = request.params.file.replace(/\.bin$/, "");
    if (!UUID.test(id) || !request.params.file.endsWith(".bin")) return send(reply, 404, "not_found");
    const { rows } = await withSystemTx(pool, (tx) => tx.query<{ image: Buffer; sha256: string }>("select image, sha256 from public.firmware_releases where id = $1 and active", [id]));
    if (!rows.length) return send(reply, 404, "not_found");
    return reply.header("content-type", "application/octet-stream").header("x-sha256", rows[0].sha256).send(rows[0].image);
  });
}

/** `operator` answers 401/403 itself and returns null for anyone who is not an operator. */
export function registerFirmwareAdmin(
  app: FastifyInstance,
  pool: Pool,
  operator: (request: FastifyRequest, reply: FastifyReply) => Promise<VerifiedSession | null>,
  broker: () => Broker | null,
  /** The public half of the firmware signing key; without it nothing can be uploaded. */
  signingKey: KeyObject | null,
): void {
  app.get("/v1/admin/firmware", async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    return withSystemTx(pool, async (tx): Promise<AdminFirmwareResponse> => {
      const { rows: models } = await tx.query<{ code: string; name: string; active_version: string | null; boards: Array<{ version: string | null; count: number }> }>(
        `select model.code, model.name,
           (select version from public.firmware_releases where model_id = model.id and active) as active_version,
           coalesce((select json_agg(json_build_object('version', firmware_version, 'count', n) order by n desc)
                     from (select firmware_version, count(*)::int as n from public.controllers
                           where model_id = model.id and hardware_uid is not null group by firmware_version) as versions), '[]') as boards
         from public.hardware_models as model
         where exists (select 1 from public.hardware_model_pins as pin where pin.model_id = model.id and pin.function = 'setup_button')
         order by model.name`,
      );
      const { rows: releases } = await tx.query<ReleaseRow>(
        `select ${RELEASE_COLUMNS} from public.firmware_releases as release join public.hardware_models as model on model.id = release.model_id order by release.created_at desc`,
      );
      return {
        models: models.map((model) => ({ code: model.code, name: model.name, activeVersion: model.active_version, boards: model.boards })),
        releases: releases.map(toRelease),
      };
    });
  });

  app.post("/v1/admin/firmware", { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    const body = uploadFirmwareRequest.safeParse(request.body ?? {});
    if (!body.success) return send(reply, 400, "invalid_request");
    if (!signingKey) {
      request.log.error("FIRMWARE_PUBLIC_KEY_FILE not set: firmware cannot be uploaded");
      return send(reply, 503, "internal_error");
    }
    // Only a file signed with our key: boards would refuse anything else, so it is refused here first.
    const signed = openSigned(Buffer.from(body.data.image, "base64"), signingKey);
    if (!signed || signed.image.length > FIRMWARE_MAX_BYTES) return send(reply, 400, "invalid_request");
    const image = signed.image;
    const read = readImage(image);
    // Not an M2smart firmware, or built for another board than the model chosen.
    if ("error" in read || read.modelCode !== body.data.modelCode) return send(reply, 400, "invalid_request");
    const { rows } = await withSystemTx(pool, (tx) =>
      tx.query<ReleaseRow>(
        `with model as (select id, code from public.hardware_models where code = $1),
         added as (
           insert into public.firmware_releases (model_id, version, sha256, size_bytes, image, notes, signature)
           select id, $2, $3, $4, $5, $6, $7 from model
           on conflict (model_id, version) do nothing
           returning *)
         select ${RELEASE_COLUMNS} from added as release join model on model.id = release.model_id`,
        [body.data.modelCode, read.version, read.sha256, image.length, image, body.data.notes, signed.signature.toString("base64")],
      ),
    );
    // No such model, or this version was uploaded before.
    if (!rows.length) return send(reply, 409, "conflict");
    request.log.info({ model: body.data.modelCode, version: read.version }, "Firmware uploaded");
    return reply.code(201).send(toRelease(rows[0]));
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/firmware/:id", async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    const body = updateFirmwareRequest.safeParse(request.body ?? {});
    if (!body.success || !UUID.test(request.params.id)) return send(reply, body.success ? 404 : 400, body.success ? "not_found" : "invalid_request");
    const changed = await withSystemTx(pool, async (tx) => {
      // The model's other releases stop being active first (one active version per model).
      if (body.data.active) {
        await tx.query(
          "update public.firmware_releases set active = false where active and model_id = (select model_id from public.firmware_releases where id = $1) and id <> $1",
          [request.params.id],
        );
      }
      return (await tx.query("update public.firmware_releases set active = $2 where id = $1", [request.params.id, body.data.active])).rowCount;
    });
    if (!changed) return send(reply, 404, "not_found");
    const client = broker();
    const offered = body.data.active && client ? await rollOut(pool, client, request.params.id) : 0;
    request.log.info({ releaseId: request.params.id, active: body.data.active, offered }, "Firmware release changed");
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/v1/admin/firmware/:id", async (request, reply) => {
    if (!(await operator(request, reply))) return reply;
    if (!UUID.test(request.params.id)) return send(reply, 404, "not_found");
    const { rowCount } = await withSystemTx(pool, (tx) => tx.query("delete from public.firmware_releases where id = $1", [request.params.id]));
    return rowCount ? reply.code(204).send() : send(reply, 404, "not_found");
  });
}
