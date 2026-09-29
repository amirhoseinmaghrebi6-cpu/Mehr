"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { LoaderCircle, Pencil, Power, X } from "lucide-react";
import { capabilities, type CapabilityName, type CapabilityValue, type Device } from "@m2smart/contracts";
import type { Locale } from "@/lib/i18n";
import { capabilityLabels, deviceTypeInfo, formatNumber, text, valueLabel } from "@/lib/device-ui";

type Props = {
  device: Device;
  name: string;
  roomName: string;
  locale: Locale;
  valueOf: (capability: CapabilityName) => CapabilityValue | null;
  activity: "sending" | "working" | null;
  /** Seconds the hardware may take (a door or a shutter), for the "in progress" note. */
  slowHardware: boolean;
  canEdit: boolean;
  onCommand: (capability: CapabilityName, value: CapabilityValue) => void;
  onEdit: () => void;
  onClose: () => void;
};

export function DeviceSheet({ device, name, roomName, locale, valueOf, activity, slowHardware, canEdit, onCommand, onEdit, onClose }: Props) {
  const isRtl = locale === "fa";
  const info = deviceTypeInfo[device.type];
  const Icon = info.icon;
  const writable = device.capabilities.filter((state) => state.writable);
  const readOnly = device.capabilities.filter((state) => !state.writable);

  return (
    <motion.div className="modal-backdrop device-sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section
        className="device-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-sheet-title"
        dir={isRtl ? "rtl" : "ltr"}
        initial={{ opacity: 0, y: 15, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sheet-grab-handle" />
        <button type="button" className="dialog-close" onClick={onClose} aria-label={isRtl ? "بستن پنل" : "Close controls"} autoFocus><X size={18} /></button>
        <div className="device-sheet-heading">
          <span className={`device-sheet-icon device-icon-${info.tone}`}><Icon size={20} strokeWidth={1.7} /></span>
          <span><span className="panel-overline">{roomName || text(info, locale)}</span><h2 id="device-sheet-title">{name}</h2></span>
          <span className={`sheet-connection${device.online ? "" : " is-disconnected"}`}><span />{device.online ? (isRtl ? "متصل" : "Online") : (isRtl ? "آفلاین" : "Offline")}</span>
        </div>

        {writable.map((state) => (
          <CapabilityControl key={state.capability} capability={state.capability} value={valueOf(state.capability)} locale={locale} disabled={!device.online} onChange={(value) => onCommand(state.capability, value)} />
        ))}

        {readOnly.length > 0 && (
          <section className="capability-readings" aria-label={isRtl ? "گزارش‌های دستگاه" : "Readings"}>
            {readOnly.map((state) => (
              <div className="capability-reading" key={state.capability}>
                <span>{text(capabilityLabels[state.capability], locale)}</span>
                <strong>{valueLabel(state.capability, valueOf(state.capability), locale)}</strong>
              </div>
            ))}
          </section>
        )}

        {activity && (
          <p className="command-activity" role="status">
            <LoaderCircle size={14} className="device-busy-icon" />
            {activity === "sending"
              ? isRtl ? "فرمان در راه خانه است…" : "Sending the command to your home…"
              : slowHardware
                ? isRtl ? "دستگاه در حال انجام فرمان است؛ این کار ممکن است چند دقیقه طول بکشد. به‌محض گزارش دستگاه، تأیید می‌شود." : "The device is on it. This can take a few minutes; it is confirmed as soon as the device reports."
                : isRtl ? "دستگاه فرمان را گرفت و در حال انجام است…" : "The device has it and is carrying it out…"}
          </p>
        )}

        <div className="device-sheet-footer">
          <span className="status-pulse" />
          {device.online ? (isRtl ? "اتصال امن خانه فعال است" : "Secure home connection") : isRtl ? "اتصال خانه برقرار نیست" : "Home connection unavailable"}
          {canEdit && <button type="button" className="text-action device-edit-link" onClick={onEdit}><Pencil size={13} />{isRtl ? "نام و فضا" : "Name & space"}</button>}
        </div>
      </motion.section>
    </motion.div>
  );
}

function CapabilityControl({ capability, value, locale, disabled, onChange }: { capability: CapabilityName; value: CapabilityValue | null; locale: Locale; disabled: boolean; onChange: (value: CapabilityValue) => void }) {
  const definition = capabilities[capability];
  const label = text(capabilityLabels[capability], locale);

  if (definition.valueType === "boolean") {
    const on = value === true;
    return (
      <section className="plug-control">
        <span className={`plug-status${on ? " is-on" : ""}`}><Power size={23} /></span>
        <div><strong>{label}</strong><small>{valueLabel(capability, value, locale)}</small></div>
        <button type="button" className={`plug-toggle${on ? " selected" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label} disabled={disabled}><Power size={18} /></button>
      </section>
    );
  }

  if (definition.valueType === "enum") {
    return (
      <section className="segmented-section">
        <span className="panel-overline">{label}</span>
        <div className="segmented-control" role="radiogroup" aria-label={label}>
          {definition.values.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={value === option} className={value === option ? "selected" : ""} disabled={disabled} onClick={() => value !== option && onChange(option)}>
              {valueLabel(capability, option, locale)}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return <RangeControl capability={capability} label={label} value={typeof value === "number" ? value : 0} min={"min" in definition ? definition.min ?? 0 : 0} max={"max" in definition ? definition.max ?? 100 : 100} locale={locale} disabled={disabled} onCommit={onChange} />;
}

function RangeControl({ capability, label, value, min, max, locale, disabled, onCommit }: { capability: CapabilityName; label: string; value: number; min: number; max: number; locale: Locale; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <section className="range-control">
      <div className="range-heading"><span className="panel-overline">{label}</span><strong>{formatNumber(shown, locale)}<small>{capability === "brightness" ? "%" : ""}</small></strong></div>
      <input aria-label={label} type="range" dir="ltr" min={min} max={max} step={1} value={shown} disabled={disabled} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <div className="range-end-labels"><span>{capability === "brightness" ? (locale === "fa" ? "خاموش" : "Off") : formatNumber(min, locale)}</span><span>{capability === "brightness" ? (locale === "fa" ? "حداکثر" : "Full") : formatNumber(max, locale)}</span></div>
    </section>
  );
}
