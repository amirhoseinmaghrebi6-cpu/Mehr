"use client";

/**
 * Security, Cameras and Activity for a home, real or demo, built from what the devices report now.
 * Nothing here needs a history: the security checklist and the alerts are the current states, and
 * the activity list is the last 24 hours of commands (the API keeps them that long anyway).
 */
import { useEffect, useState } from "react";
import { Camera, CircleCheck, Clock3, CloudFog, DoorOpen, Droplets, Flame, QrCode, ShieldAlert, ShieldCheck, Siren, Sparkles, TriangleAlert, User, WifiOff, type LucideIcon } from "lucide-react";
import type { ActivityEntry, CapabilityName, CapabilityValue, Device } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { valueLabel } from "@/lib/device-ui";
import { formatDate, formatNumber, formatTime } from "@/lib/i18n";

type ValueOf = (device: Device, capability: CapabilityName) => CapabilityValue | null;

export type HomeAlert = { device: Device; kind: "smoke" | "leak" | "co" | "alarm" | "offline" | "open" | "pairing"; tone: "danger" | "warn" | "info" };
const alertIcons: Record<HomeAlert["kind"], LucideIcon> = { smoke: Flame, leak: Droplets, co: CloudFog, alarm: Siren, offline: WifiOff, open: DoorOpen, pairing: QrCode };
const toneOrder = { danger: 0, warn: 1, info: 2 } as const;

/** What needs attention right now, most urgent first. */
export function homeAlerts(devices: Device[], valueOf: ValueOf): HomeAlert[] {
  const alerts: HomeAlert[] = [];
  for (const device of devices) {
    if (device.pending) {
      alerts.push({ device, kind: "pairing", tone: "info" });
      continue;
    }
    if (!device.online) {
      alerts.push({ device, kind: "offline", tone: "warn" });
      continue;
    }
    if (valueOf(device, "smoke") === true) alerts.push({ device, kind: "smoke", tone: "danger" });
    if (valueOf(device, "leak") === true) alerts.push({ device, kind: "leak", tone: "danger" });
    const co = valueOf(device, "co_ppm");
    if (typeof co === "number" && co >= 50) alerts.push({ device, kind: "co", tone: "danger" });
    if (valueOf(device, "triggered") === true) alerts.push({ device, kind: "alarm", tone: "danger" });
    if (valueOf(device, "contact") === "open" || (device.type === "garage_door" && valueOf(device, "door") === "open")) alerts.push({ device, kind: "open", tone: "info" });
  }
  return alerts.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);
}

type SectionProps = { devices: Device[]; valueOf: ValueOf; nameOf: (name: string) => string; onOpenDevice: (device: Device) => void };

export function SecuritySection({ devices, valueOf, nameOf, onOpenDevice }: SectionProps) {
  const { locale, m } = useI18n();
  const t = m.safety;
  const live = devices.filter((device) => !device.pending);
  const names = (list: Device[]) => list.map((device) => nameOf(device.name)).join(m.meta.dir === "rtl" ? "، " : ", ");
  const alarms = live.filter((device) => device.type === "alarm");
  const openings = live.filter((device) => device.type === "contact_sensor" || device.type === "garage_door");
  const hazards = live.filter((device) => device.type === "smoke_sensor" || device.type === "leak_sensor" || device.type === "co_sensor");
  const cameras = live.filter((device) => device.type === "camera");
  const alertsBy = new Map(homeAlerts(live, valueOf).map((alert) => [alert.device.id, alert]));

  type Row = { key: string; icon: LucideIcon; title: string; detail: string; ok: boolean; open?: Device };
  const rows: Row[] = [];
  if (alarms.length) {
    const unarmed = alarms.filter((device) => valueOf(device, "alarm_mode") === "disarmed" || valueOf(device, "triggered") === true);
    rows.push({ key: "alarm", icon: Siren, title: t.rows.alarm, detail: alarms.map((device) => `${nameOf(device.name)}: ${valueLabel("alarm_mode", valueOf(device, "alarm_mode"), locale)}`).join(" · "), ok: unarmed.length === 0, open: unarmed[0] ?? alarms[0] });
  }
  if (openings.length) {
    const open = openings.filter((device) => alertsBy.get(device.id)?.kind === "open");
    rows.push({ key: "openings", icon: DoorOpen, title: t.rows.openings, detail: open.length ? t.openNow(names(open)) : t.allClosed, ok: open.length === 0, open: open[0] });
  }
  if (hazards.length) {
    const alarmed = hazards.filter((device) => alertsBy.get(device.id)?.tone === "danger");
    rows.push({ key: "hazards", icon: Flame, title: t.rows.hazards, detail: alarmed.length ? t.hazardNow(names(alarmed)) : t.noHazards, ok: alarmed.length === 0, open: alarmed[0] });
  }
  if (cameras.length) {
    const on = cameras.filter((device) => valueOf(device, "power") === true);
    rows.push({ key: "cameras", icon: Camera, title: t.rows.cameras, detail: t.camerasOn(formatNumber(on.length, locale), formatNumber(cameras.length, locale)), ok: on.length === cameras.length, open: cameras.find((device) => valueOf(device, "power") !== true) });
  }
  const offline = live.filter((device) => !device.online);
  if (live.length) rows.push({ key: "boards", icon: WifiOff, title: t.rows.boards, detail: offline.length ? t.offlineNow(names(offline)) : t.allOnline, ok: offline.length === 0, open: offline[0] });

  if (!alarms.length && !openings.length && !hazards.length && !cameras.length) {
    return <div className="quiet-panel"><span className="quiet-icon"><ShieldCheck size={24} strokeWidth={1.6} /></span><h2>{t.noSecurityTitle}</h2><p>{t.noSecurityText}</p></div>;
  }
  const attention = rows.filter((row) => !row.ok).length;
  return (
    <section className="security-layout">
      <div className={`security-banner${attention ? " needs-attention" : ""}`}>
        <div className="security-banner-icon">{attention ? <ShieldAlert size={26} /> : <ShieldCheck size={26} />}</div>
        <div><span className="panel-overline">{t.overline}</span><h2>{attention ? t.attentionTitle(formatNumber(attention, locale)) : t.secureTitle}</h2><p>{attention ? t.attentionText : t.secureText}</p></div>
        <span className="security-banner-badge"><span className={`status-pulse${attention ? " is-pending" : ""}`} />{attention ? t.attentionBadge : t.secureBadge}</span>
      </div>
      <div className="surface-panel security-checklist">
        <div className="section-heading"><div><h2>{t.checklist}<span className="check-count">{formatNumber(rows.length - attention, locale)} / {formatNumber(rows.length, locale)}</span></h2><p>{t.checklistNote}</p></div></div>
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <button type="button" key={row.key} className={`security-row${row.ok ? "" : " is-attention"}`} onClick={() => row.open && onOpenDevice(row.open)} disabled={!row.open}>
              <span className="security-device-icon"><Icon size={18} /></span>
              <span className="security-device-copy"><strong>{row.title}</strong><small>{row.detail}</small></span>
              {row.ok ? <CircleCheck className="security-check-icon" size={19} /> : <TriangleAlert className="security-check-icon is-attention" size={19} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function CameraSection({ devices, valueOf, nameOf, onOpenDevice, demo, roomName }: SectionProps & { demo: boolean; roomName: (device: Device) => string }) {
  const { locale, m } = useI18n();
  const t = m.safety;
  const cameras = devices.filter((device) => device.type === "camera");
  if (!cameras.length) return <div className="quiet-panel"><span className="quiet-icon"><Camera size={24} strokeWidth={1.6} /></span><h2>{t.noCamerasTitle}</h2><p>{t.noCamerasText}</p></div>;
  const on = cameras.filter((device) => device.online && valueOf(device, "power") === true);
  const images = ["camera-image-entry", "camera-image-garden"];
  return (
    <section className="camera-grid">
      {cameras.map((device, index) => {
        const isOn = device.online && valueOf(device, "power") === true;
        const recording = isOn && valueOf(device, "recording") === true;
        return (
          <button type="button" key={device.id} className={`camera-tile${isOn ? "" : " is-off"}`} onClick={() => onOpenDevice(device)}>
            {demo && isOn ? <div className={`camera-image ${images[index % images.length]}`} /> : <div className="camera-image camera-image-blank" />}
            <div className="camera-scrim" />
            <span className="camera-top">
              {recording ? <span className="camera-recording"><span />REC</span> : <span />}
              <span className="camera-live-label"><span />{!device.online ? m.devices.offline : isOn ? (demo ? t.live : m.devices.on) : m.devices.off}</span>
            </span>
            {!demo && isOn && <span className="camera-video-later">{t.videoLater}</span>}
            <div className="camera-bottom"><span><Camera size={15} />{nameOf(device.name)}</span><small>{roomName(device)}</small></div>
          </button>
        );
      })}
      <div className="camera-status-card">
        <span className="camera-health-icon"><CircleCheck size={18} /></span>
        <strong>{t.camerasOn(formatNumber(on.length, locale), formatNumber(cameras.length, locale))}</strong>
        <p>{t.cameraNote}</p>
      </div>
    </section>
  );
}

export function ActivitySection({ devices, valueOf, nameOf, onOpenDevice, loadActivity, timeZone }: SectionProps & { loadActivity: () => Promise<ActivityEntry[]>; timeZone: string }) {
  const { locale, m, calendar } = useI18n();
  const t = m.safety;
  const alerts = homeAlerts(devices, valueOf);
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  // Re-read whenever the devices change: a command that finished changes them too.
  useEffect(() => {
    let active = true;
    loadActivity().then(
      (list) => active && setEntries(list),
      () => active && setEntries((current) => current ?? []),
    );
    return () => {
      active = false;
    };
  }, [loadActivity, devices]);

  const when = (iso: string) => {
    const date = new Date(iso);
    const today = formatDate(new Date(), locale, calendar, timeZone, { day: "numeric", month: "short" });
    const day = formatDate(date, locale, calendar, timeZone, { day: "numeric", month: "short" });
    return day === today ? formatTime(date, locale, timeZone) : `${day} · ${formatTime(date, locale, timeZone)}`;
  };

  return (
    <section className="activity-layout">
      <div className="surface-panel activity-panel">
        <div className="panel-intro"><span className="panel-overline">{t.alertsOverline}</span><h2>{alerts.length ? t.alertsTitle(formatNumber(alerts.length, locale)) : t.noAlertsTitle}</h2><p>{alerts.length ? t.alertsText : t.noAlertsText}</p></div>
        {alerts.length > 0 && (
          <ul className="activity-list">
            {alerts.map((alert) => {
              const Icon = alertIcons[alert.kind];
              return (
                <li key={`${alert.device.id}-${alert.kind}`}>
                  <button type="button" className={`activity-row tone-${alert.tone}`} onClick={() => onOpenDevice(alert.device)}>
                    <span className="activity-icon"><Icon size={16} /></span>
                    <span className="activity-copy"><strong>{t.alerts[alert.kind](nameOf(alert.device.name))}</strong></span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="surface-panel activity-panel">
        <div className="panel-intro"><span className="panel-overline">{t.commandsOverline}</span><h2>{t.commandsTitle}</h2><p>{t.commandsNote}</p></div>
        {entries === null ? null : entries.length === 0 ? (
          <p className="activity-empty"><Clock3 size={14} />{t.noCommands}</p>
        ) : (
          <ul className="activity-list">
            {entries.map((entry) => {
              const who = entry.scenario ? t.byScenario(nameOf(entry.scenario)) : entry.requestedBy ? nameOf(entry.requestedBy) || t.someone : t.someone;
              const failed = entry.status === "failed" || entry.status === "timed_out" || entry.status === "rejected";
              return (
                <li key={entry.id} className={`activity-row${failed ? " tone-warn" : ""}`}>
                  <span className="activity-icon">{entry.scenario ? <Sparkles size={16} /> : <User size={16} />}</span>
                  <span className="activity-copy">
                    <strong>{nameOf(entry.deviceName)}: {valueLabel(entry.capability, entry.targetValue, locale)}</strong>
                    <small>{who}{failed ? ` · ${t.didNotHappen}` : entry.status === "applied" ? "" : ` · ${t.inProgress}`}</small>
                  </span>
                  <time className="activity-time" dateTime={entry.createdAt}>{when(entry.createdAt)}</time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
