"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Droplets, LoaderCircle, Pencil, Power, Video, X, QrCode } from "lucide-react";
import { capabilities, type CapabilityName, type CapabilityValue, type Device } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { capabilityLabel, deviceTypeInfo, formatNumber, typeLabel, valueLabel, shownCapabilities } from "@/lib/device-ui";
import type { Locale } from "@/lib/i18n";

type Props = {
  device: Device;
  name: string;
  roomName: string;
  valueOf: (capability: CapabilityName) => CapabilityValue | null;
  activity: "sending" | "working" | null;
  /** Seconds the hardware may take (a door or a shutter), for the "in progress" note. */
  slowHardware: boolean;
  canEdit: boolean;
  onCommand: (capability: CapabilityName, value: CapabilityValue) => void;
  onEdit: () => void;
  /** Opens pairing for the device's board, when it still waits for it (owners and admins). */
  onPair?: () => void;
  onClose: () => void;
};

export function DeviceSheet({ device, name, roomName, valueOf, activity, slowHardware, canEdit, onCommand, onEdit, onPair, onClose }: Props) {
  const { locale, m, rtl, temperatureUnit } = useI18n();
  const info = deviceTypeInfo[device.type];
  const Icon = info.icon;
  const writable = shownCapabilities(device).filter((state) => state.writable);
  const readOnly = shownCapabilities(device).filter((state) => !state.writable);

  return (
    <motion.div className="modal-backdrop device-sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section
        className="device-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-sheet-title"
        dir={rtl ? "rtl" : "ltr"}
        initial={{ opacity: 0, y: 15, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sheet-grab-handle" />
        <button type="button" className="dialog-close" onClick={onClose} aria-label={m.sheet.closeControls} autoFocus><X size={18} /></button>
        <div className="device-sheet-heading">
          <span className={`device-sheet-icon device-icon-${info.tone}`}><Icon size={20} strokeWidth={1.7} /></span>
          <span><span className="panel-overline">{roomName || typeLabel(device.type, locale)}</span><h2 id="device-sheet-title">{name}</h2></span>
          <span className={`sheet-connection${device.online ? "" : " is-disconnected"}`}><span />{device.pending ? m.devices.awaitingPairing : device.online ? m.common.online : m.common.offline}</span>
        </div>

        {writable.map((state) => {
          // A camera records only while it is on.
          const needsPower = device.type === "camera" && state.capability === "recording" && valueOf("power") !== true;
          return (
            <CapabilityControl
              key={state.capability}
              capability={state.capability}
              value={valueOf(state.capability)}
              locale={locale}
              disabled={!device.online || needsPower}
              note={needsPower ? m.sheet.cameraOffNote : undefined}
              onChange={(value) => onCommand(state.capability, value)}
            />
          );
        })}

        {readOnly.length > 0 && (
          <section className="capability-readings" aria-label={m.sheet.readings}>
            {readOnly.map((state) => (
              <div className="capability-reading" key={state.capability}>
                <span>{capabilityLabel(state.capability, locale)}</span>
                <strong>{valueLabel(state.capability, valueOf(state.capability), locale, temperatureUnit)}</strong>
              </div>
            ))}
          </section>
        )}

        {activity && (
          <p className="command-activity" role="status">
            <LoaderCircle size={14} className="device-busy-icon" />
            {activity === "sending" ? m.sheet.sending : slowHardware ? m.sheet.workingSlow : m.sheet.working}
          </p>
        )}

        {device.pending && (
          <div className="sheet-pending">
            <p>{m.sheet.awaitingPairingText}</p>
            {onPair && <button type="button" className="button-primary" onClick={onPair}><QrCode size={15} />{m.sheet.pairNow}</button>}
          </div>
        )}

        <div className="device-sheet-footer">
          <span className="status-pulse" />
          {device.pending ? m.devices.awaitingPairing : device.online ? m.sheet.secureConnection : m.sheet.connectionUnavailable}
          {canEdit && <button type="button" className="text-action device-edit-link" onClick={onEdit}><Pencil size={13} />{m.sheet.nameAndSpace}</button>}
        </div>
      </motion.section>
    </motion.div>
  );
}

function CapabilityControl({ capability, value, locale, disabled, note, onChange }: { capability: CapabilityName; value: CapabilityValue | null; locale: Locale; disabled: boolean; note?: string; onChange: (value: CapabilityValue) => void }) {
  const definition = capabilities[capability];
  const label = capabilityLabel(capability, locale);

  if (definition.valueType === "boolean") {
    const on = value === true;
    const Icon = capability === "recording" ? Video : capability === "pump" ? Droplets : Power;
    return (
      <section className="plug-control">
        <span className={`plug-status${on ? " is-on" : ""}`}><Icon size={23} /></span>
        <div><strong>{label}</strong><small>{note ?? valueLabel(capability, value, locale)}</small></div>
        <button type="button" className={`plug-toggle${on ? " selected" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label} disabled={disabled}><Icon size={18} /></button>
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

  return <RangeControl capability={capability} label={label} value={typeof value === "number" ? value : 0} min={"min" in definition ? definition.min ?? 0 : 0} max={"max" in definition ? definition.max ?? 100 : 100} disabled={disabled} onCommit={onChange} />;
}

function RangeControl({ capability, label, value, min, max, disabled, onCommit }: { capability: CapabilityName; label: string; value: number; min: number; max: number; disabled: boolean; onCommit: (value: number) => void }) {
  const { locale, m } = useI18n();
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const percent = capability === "brightness";
  return (
    <section className="range-control">
      <div className="range-heading"><span className="panel-overline">{label}</span><strong>{formatNumber(shown, locale)}<small>{percent ? m.devices.units.percent : ""}</small></strong></div>
      <input aria-label={label} type="range" dir="ltr" min={min} max={max} step={1} value={shown} disabled={disabled} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <div className="range-end-labels"><span>{percent ? m.sheet.rangeOff : formatNumber(min, locale)}</span><span>{percent ? m.sheet.rangeFull : formatNumber(max, locale)}</span></div>
    </section>
  );
}
