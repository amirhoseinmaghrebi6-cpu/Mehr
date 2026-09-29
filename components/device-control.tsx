"use client";

import { motion } from "framer-motion";
import { ChevronRight, LoaderCircle, Power, TriangleAlert } from "lucide-react";
import type { Device } from "@m2smart/contracts";
import type { Locale } from "@/lib/i18n";
import { deviceTypeInfo } from "@/lib/device-ui";

type Props = {
  device: Device;
  name: string;
  /** Status line, e.g. "Open" or "68%". */
  summary: string;
  roomName?: string;
  active: boolean;
  alert: boolean;
  /** A command on its way: "sending" to the hub, or "working" while the hardware carries it out. */
  activity: "sending" | "working" | null;
  locale: Locale;
  onOpen: (device: Device) => void;
  /** The one-tap action; absent for devices that only report (sensors). */
  onQuickAction?: (device: Device) => void;
};

export function DeviceControl({ device, name, summary, roomName, active, alert, activity, locale, onOpen, onQuickAction }: Props) {
  const info = deviceTypeInfo[device.type];
  const Icon = info.icon;
  const isRtl = locale === "fa";
  const activityText = activity === "working" ? (isRtl ? "در حال انجام…" : "In progress…") : activity === "sending" ? (isRtl ? "در حال ارسال…" : "Sending…") : "";
  const detail = [roomName, activityText || summary].filter(Boolean).join(" · ");

  return (
    <motion.article className={`device-control${active ? " is-on" : ""}${device.online ? "" : " is-offline"}${alert ? " is-alert" : ""}${activity ? " is-busy" : ""}`} layout>
      <button className="device-open" type="button" onClick={() => onOpen(device)} aria-label={`${name}, ${detail}`}>
        <span className={`device-icon device-icon-${info.tone}`}>{alert ? <TriangleAlert size={18} strokeWidth={1.8} /> : <Icon size={18} strokeWidth={1.8} />}</span>
        <span className="device-copy">
          <span className="device-name">{name}</span>
          <span className="device-detail">{detail}</span>
        </span>
        {activity ? <LoaderCircle className="device-busy-icon" size={14} aria-hidden="true" /> : device.online && <span className="device-online-dot" aria-label={isRtl ? "متصل" : "Online"} />}
        {!onQuickAction && <ChevronRight className="device-chevron" size={16} aria-hidden="true" />}
      </button>
      {onQuickAction && (
        <button
          type="button"
          className={`device-power${active ? " selected" : ""}`}
          onClick={() => onQuickAction(device)}
          aria-pressed={active}
          aria-label={`${isRtl ? (active ? "خاموش / بستن" : "روشن / باز کردن") : active ? "Turn off or close" : "Turn on or open"} ${name}`}
          disabled={!device.online || activity === "sending"}
        >
          <Power size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </motion.article>
  );
}
