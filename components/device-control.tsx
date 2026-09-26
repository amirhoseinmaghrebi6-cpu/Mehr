"use client";

import { motion } from "framer-motion";
import { AirVent, Blinds, ChevronRight, Lightbulb, LockKeyhole, PlugZap, Power, Thermometer } from "lucide-react";
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
  locale: Locale;
  onToggle: (id: string) => void;
  onOpen: (device: Device) => void;
  showRoom?: boolean;
};

export function DeviceControl({ device, isOn, locale, onToggle, onOpen, showRoom = false }: Props) {
  const Icon = iconByKind[device.kind];
  const isRtl = locale === "fa";
  const powerLabel = isRtl ? (isOn ? "خاموش کردن" : "روشن کردن") : (isOn ? "Turn off" : "Turn on");
  const interactive = device.kind !== "air";

  return (
    <motion.article className={`device-control${isOn ? " is-on" : ""}${device.online ? "" : " is-offline"}`} layout>
      <button
        className="device-open"
        type="button"
        onClick={() => onOpen(device)}
        aria-label={`${device.name}, ${device.detail}`}
      >
        <span className={`device-icon device-icon-${device.kind}`}><Icon size={18} strokeWidth={1.8} /></span>
        <span className="device-copy">
          <span className="device-name">{device.kind === "light" && device.id === "lights" && isRtl ? "چراغ‌های آویز" : device.name}</span>
          <span className="device-detail">{showRoom ? `${device.room} · ${device.detail}` : device.detail}</span>
        </span>
        {device.online && <span className="device-online-dot" aria-label={isRtl ? "متصل" : "Online"} />}
        {!interactive && <ChevronRight className="device-chevron" size={16} aria-hidden="true" />}
      </button>
      {interactive && (
        <button
          type="button"
          className={`device-power${isOn ? " selected" : ""}`}
          onClick={() => onToggle(device.id)}
          aria-pressed={isOn}
          aria-label={`${powerLabel} ${device.name}`}
          disabled={!device.online}
        >
          <Power size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </motion.article>
  );
}