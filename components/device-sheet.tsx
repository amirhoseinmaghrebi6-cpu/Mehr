"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AirVent,
  ArrowDown,
  ArrowUp,
  Blinds,
  Check,
  ChevronDown,
  Lightbulb,
  LockKeyhole,
  Minus,
  Plus,
  Power,
  PlugZap,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import type { Device, DeviceKind } from "@/services/mock-home-service";
import type { Locale } from "@/lib/i18n";

const iconByKind: Record<DeviceKind, typeof Lightbulb> = {
  light: Lightbulb,
  climate: Thermometer,
  curtain: Blinds,
  lock: LockKeyhole,
  air: AirVent,
  plug: PlugZap,
};

type Props = {
  device: Device;
  isOn: boolean;
  value: number;
  locale: Locale;
  onClose: () => void;
  onToggle: (id: string) => void;
  onValueChange: (id: string, value: number) => void;
};

export function DeviceSheet({ device, isOn, value, locale, onClose, onToggle, onValueChange }: Props) {
  const [draftValue, setDraftValue] = useState(value);
  const Icon = iconByKind[device.kind];
  const isRtl = locale === "fa";
  const names: Record<string, string> = {
    climate: isRtl ? "تهویه‌ی هوشمند" : "Climate control",
    lights: isRtl ? "چراغ‌های آویز" : "Pendant lights",
    curtains: isRtl ? "پرده‌های حریر" : "Sheer curtains",
    "entry-lock": isRtl ? "قفل ورودی اصلی" : "Front door lock",
    "air-quality": isRtl ? "کیفیت هوای پذیرایی" : "Living room air quality",
    coffee: isRtl ? "قهوه‌ساز" : "Coffee machine",
    "garden-lights": isRtl ? "چراغ‌های مسیر باغ" : "Garden path lights",
    window: isRtl ? "حسگر پنجره‌ی اتاق خواب" : "Bedroom window sensor",
  };
  const displayedName = names[device.id] ?? device.name;
  const commitValue = (nextValue: number) => {
    setDraftValue(nextValue);
    onValueChange(device.id, nextValue);
  };

  return (
    <motion.div
      className="modal-backdrop device-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
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
          <span className={`device-sheet-icon device-icon-${device.kind}`}><Icon size={20} strokeWidth={1.7} /></span>
          <span><span className="panel-overline">{device.room}</span><h2 id="device-sheet-title">{displayedName}</h2></span>
          <span className={`sheet-connection${device.online ? "" : " is-disconnected"}`}><span />{device.online ? (isRtl ? "متصل" : "Online") : (isRtl ? "آفلاین" : "Offline")}</span>
        </div>

        {device.kind === "climate" && (
          <section className="thermostat-control" aria-label={isRtl ? "کنترل دما" : "Temperature controls"}>
            <span className="panel-overline">{isRtl ? "تنظیم دمای مطلوب" : "TARGET TEMPERATURE"}</span>
            <div className="thermostat-readout"><span className="thermostat-ring"><Thermometer size={19} /></span><strong>{isRtl ? toPersian(draftValue) : draftValue}<small>°C</small></strong><span className="thermostat-mode"><Wind size={14} />{isRtl ? "خودکار" : "AUTO"}</span></div>
            <div className="thermostat-stepper"><button type="button" onClick={() => commitValue(Math.max(16, draftValue - 1))} aria-label={isRtl ? "یک درجه کمتر" : "Decrease temperature"}><Minus size={18} /></button><span>{isRtl ? "دمای مطلوب" : "Set point"}</span><button type="button" onClick={() => commitValue(Math.min(30, draftValue + 1))} aria-label={isRtl ? "یک درجه بیشتر" : "Increase temperature"}><Plus size={18} /></button></div>
          </section>
        )}

        {(device.kind === "light" || device.kind === "curtain") && (
          <section className="range-control">
            <div className="range-heading"><span className="panel-overline">{device.kind === "light" ? (isRtl ? "شدت روشنایی" : "BRIGHTNESS") : (isRtl ? "موقعیت پرده" : "CURTAIN POSITION")}</span><strong>{isRtl ? toPersian(draftValue) : draftValue}<small>%</small></strong></div>
            <div className="range-decoration" aria-hidden="true">{device.kind === "light" ? <><Lightbulb size={16} /><ArrowUp size={14} /></> : <><ArrowDown size={14} /><ChevronDown size={16} /></>}</div>
            <input
              aria-label={device.kind === "light" ? (isRtl ? "شدت روشنایی به درصد" : "Brightness percentage") : (isRtl ? "موقعیت پرده به درصد" : "Curtain position percentage")}
              type="range"
              dir="ltr"
              min="0"
              max="100"
              step={device.kind === "light" ? 1 : 5}
              value={draftValue}
              onChange={(event) => setDraftValue(Number(event.target.value))}
              onPointerUp={() => onValueChange(device.id, draftValue)}
              onKeyUp={() => onValueChange(device.id, draftValue)}
            />
            <div className="range-end-labels"><span>{device.kind === "light" ? (isRtl ? "خاموش" : "Off") : (isRtl ? "بسته" : "Closed")}</span><span>{device.kind === "light" ? (isRtl ? "روشن" : "Bright") : (isRtl ? "باز" : "Open")}</span></div>
          </section>
        )}

        {device.kind === "lock" && (
          <section className={`lock-control${isOn ? " is-secure" : " is-unlocked"}`}>
            <span className="lock-state-icon"><LockKeyhole size={24} /></span>
            <strong>{isRtl ? (isOn ? "در، قفل است" : "در باز است") : (isOn ? "The door is locked" : "The door is unlocked")}</strong>
            <small>{isRtl ? "با اطمینان و کنترل، وضعیت را تغییر دهید." : "Change the lock only when you’re ready."}</small>
            <button type="button" className="lock-action" onClick={() => onToggle(device.id)}><LockKeyhole size={15} />{isRtl ? (isOn ? "بازکردن قفل" : "قفل‌کردن در") : (isOn ? "Unlock door" : "Lock door")}</button>
          </section>
        )}

        {device.kind === "air" && (
          <section className="air-quality-control"><span className="air-quality-check"><Check size={17} /></span><span className="panel-overline">{isRtl ? "ذرات ریز · PM2.5" : "FINE PARTICLES · PM2.5"}</span><strong>{isRtl ? "۱۸" : "18"}<small> μg/m³</small></strong><span className="air-quality-meter"><i /></span><span className="air-quality-good">{isRtl ? "هوای پاک · بدون نیاز به اقدام" : "Clean air · Nothing to do"}</span></section>
        )}

        {device.kind === "plug" && (
          <section className="plug-control"><span className={`plug-status${isOn ? " is-on" : ""}`}><Power size={23} /></span><div><strong>{isRtl ? (isOn ? "دستگاه روشن است" : "دستگاه آماده است") : (isOn ? "Power is on" : "Ready when you are")}</strong><small>{isRtl ? device.detail : device.detail}</small></div><button type="button" className={`plug-toggle${isOn ? " selected" : ""}`} onClick={() => onToggle(device.id)} aria-pressed={isOn} aria-label={isRtl ? "تغییر وضعیت برق" : "Toggle power"}><Power size={18} /></button></section>
        )}

        <div className="device-sheet-footer"><span className="status-pulse" />{isRtl ? (device.online ? "اتصال امن خانه فعال است" : "اتصال خانه برقرار نیست") : (device.online ? "Secure home connection" : "Home connection unavailable")}<span>·</span>{isRtl ? "همین حالا" : "Just now"}</div>
      </motion.section>
    </motion.div>
  );
}

function toPersian(value: number): string {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(value);
}