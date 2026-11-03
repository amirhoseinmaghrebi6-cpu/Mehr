"use client";

/**
 * The operator's panel → Firmware: per board model, the active version and how many boards run
 * each version; uploading a new image; publishing it (it then reaches every board of the model),
 * pausing it, or deleting it. The server reads each image's version and model from the file itself
 * (docs/board-protocol.md, "Firmware updates").
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pause, Rocket, Trash2, Upload } from "lucide-react";
import type { AdminFirmwareResponse, FirmwareRelease } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import type { AdminSource, Toast } from "@/features/admin/admin-panel";
import { gatewayMessage } from "@/lib/gateway-messages";
import { formatDate, formatNumber } from "@/lib/i18n";
import { GatewayError, type GatewayErrorCode } from "@/services/home-gateway";

const codeOf = (error: unknown): GatewayErrorCode => (error instanceof GatewayError ? error.code : "network");

export function FirmwareSection({ source, onToast }: { source: AdminSource; onToast: (toast: Toast) => void }) {
  const { locale, calendar, m } = useI18n();
  const t = m.admin.firmware;
  const [data, setData] = useState<AdminFirmwareResponse | null>(null);
  const [error, setError] = useState<GatewayErrorCode | null>(null);
  const [modelCode, setModelCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // A new key empties the file field after an upload, so the same file can be chosen again.
  const [fileField, setFileField] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<{ release: FirmwareRelease; action: "publish" | "delete" } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await source.firmware();
      setData(next);
      setModelCode((current) => current || next.models[0]?.code || "");
      setError(null);
    } catch (caught) {
      setError(codeOf(caught));
    }
  }, [source]);
  useEffect(() => void load(), [load]);

  const modelName = (code: string) => data?.models.find((model) => model.code === code)?.name ?? code;
  const run = async (work: () => Promise<unknown>, done: string, messages: Partial<Record<GatewayErrorCode, string>> = {}) => {
    setBusy(true);
    try {
      await work();
      onToast({ message: done, tone: "ok" });
      setConfirming(null);
      await load();
      return true;
    } catch (caught) {
      const code = codeOf(caught);
      onToast({ message: messages[code] ?? gatewayMessage(code, locale), tone: "warn" });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !modelCode) return;
    const uploaded = await run(() => source.uploadFirmware(modelCode, file, notes.trim()), t.uploaded(modelName(modelCode)), { invalid_request: t.notFirmware, conflict: t.alreadyUploaded });
    if (uploaded) {
      setFile(null);
      setFileField((key) => key + 1);
      setNotes("");
    }
  };
  const date = (iso: string) => formatDate(new Date(iso), locale, calendar, Intl.DateTimeFormat().resolvedOptions().timeZone, { day: "numeric", month: "short", year: "numeric" });

  if (error && !data) return <section className="surface-panel admin-list-panel"><p className="admin-note" role="alert">{gatewayMessage(error, locale)}</p></section>;
  return (
    <>
      <section className="surface-panel admin-list-panel">
        <span className="panel-overline">{t.modelsTitle}</span>
        <p className="admin-note">{t.modelsNote}</p>
        <ul className="member-list">
          {data?.models.map((model) => (
            <li className="member-row firmware-model" key={model.code}>
              <span className="member-copy">
                <strong>{model.name}</strong>
                <small><bdi dir="ltr">{model.code}</bdi></small>
                <small>{model.boards.length ? model.boards.map((entry) => t.boardsOn(entry.version ?? t.unknownVersion, formatNumber(entry.count, locale))).join(" · ") : t.noBoards}</small>
              </span>
              <span className={`admin-status ${model.activeVersion ? "is-ok" : "is-off"}`}>{model.activeVersion ? t.active(model.activeVersion) : t.noActive}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface-panel admin-list-panel">
        <span className="panel-overline">{t.uploadTitle}</span>
        <p className="admin-note">{t.uploadNote}</p>
        <form className="firmware-upload" onSubmit={(event) => void upload(event)}>
          <label className="form-field"><span>{t.model}</span>
            <select value={modelCode} onChange={(event) => setModelCode(event.target.value)}>{data?.models.map((model) => <option key={model.code} value={model.code}>{model.name}</option>)}</select>
          </label>
          <label className="form-field"><span>{t.file}</span><input key={fileField} type="file" accept=".m2fw,application/octet-stream" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <label className="form-field"><span>{t.notes}</span><input value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder={t.notesPlaceholder} /></label>
          <button type="submit" className="button-primary" disabled={busy || !file || !modelCode}><Upload size={15} />{t.upload}</button>
        </form>
      </section>

      <section className="surface-panel admin-list-panel">
        <span className="panel-overline">{t.releasesTitle}</span>
        {data && !data.releases.length && <p className="admin-empty">{t.noReleases}</p>}
        <ul className="member-list">
          {data?.releases.map((release) => (
            <li className="member-row admin-user" key={release.id}>
              <span className="member-copy">
                <strong><bdi dir="ltr">{release.version}</bdi>{release.active && <span className="member-role-badge role-owner">{t.activeBadge}</span>}</strong>
                <small>{modelName(release.modelCode)} · {t.size(formatNumber(Math.round(release.sizeBytes / 1024), locale))} · {date(release.createdAt)}</small>
                {release.notes && <small>{release.notes}</small>}
              </span>
              {confirming?.release.id === release.id ? (
                <span className="member-confirm admin-confirm">
                  <small>{confirming.action === "publish" ? t.publishQuestion(release.version, modelName(release.modelCode)) : t.deleteQuestion(release.version)}</small>
                  <span>
                    <button type="button" className={confirming.action === "publish" ? "button-primary" : "button-danger"} disabled={busy} onClick={() => void (confirming.action === "publish"
                      ? run(() => source.setFirmwareActive(release.id, true), t.published(release.version))
                      : run(() => source.deleteFirmware(release.id), t.deleted(release.version)))}>
                      {confirming.action === "publish" ? <Rocket size={14} /> : <Trash2 size={14} />}{confirming.action === "publish" ? t.confirmPublish : t.confirmDelete}
                    </button>
                    <button type="button" className="button-subtle" onClick={() => setConfirming(null)}>{m.common.cancel}</button>
                  </span>
                </span>
              ) : (
                <span className="admin-actions">
                  {release.active
                    ? <button type="button" className="button-subtle" disabled={busy} onClick={() => void run(() => source.setFirmwareActive(release.id, false), t.paused(release.version))}><Pause size={14} />{t.pause}</button>
                    : <button type="button" className="button-subtle" onClick={() => setConfirming({ release, action: "publish" })}><Rocket size={14} />{t.publish}</button>}
                  <button type="button" className="icon-button member-remove" aria-label={`${t.delete}: ${release.version}`} title={t.delete} onClick={() => setConfirming({ release, action: "delete" })}><Trash2 size={15} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
