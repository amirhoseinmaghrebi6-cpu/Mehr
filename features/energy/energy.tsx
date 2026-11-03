"use client";

/**
 * The whole home's energy use, from its energy meters (one per phase): power and voltage now (the
 * meters' states), and the use by hour or day from the server (energy_hourly for 7 days,
 * energy_daily for 12 months) as a bar chart. Days and months follow the user's calendar; hours
 * and days are the home's time zone.
 */
import { useEffect, useMemo, useState } from "react";
import { Gauge, Plus, Zap } from "lucide-react";
import type { CapabilityName, Device, EnergyResponse } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { formatDate, formatNumber, type Locale } from "@/lib/i18n";

export type LoadEnergy = () => Promise<EnergyResponse>;
type Range = "day" | "week" | "month" | "year";
const ranges: Range[] = ["day", "week", "month", "year"];
const REFRESH_MS = 5 * 60_000;

export const meters = (devices: Device[]) => devices.filter((device) => device.type === "energy_meter" && !device.pending);

const meterValues = (list: Device[], capability: CapabilityName) =>
  list.flatMap((device) => device.capabilities.filter((state) => state.capability === capability && typeof state.value === "number").map((state) => state.value as number));

/** The meters' power together, e.g. "840 W" or "1.84 kW"; null without a reading. */
export function powerNow(list: Device[], locale: Locale, units: { watt: string; kilowatt: string }): string | null {
  const values = meterValues(list, "power_w");
  if (!values.length) return null;
  const watts = values.reduce((sum, value) => sum + value, 0);
  return watts < 1000 ? `${formatNumber(watts, locale)}${units.watt}` : `${formatNumber(watts / 1000, locale, 2)}${units.kilowatt}`;
}

/** The energy use, read again every few minutes while shown. Null until it arrives. */
export function useEnergy(load: LoadEnergy, enabled: boolean): EnergyResponse | null {
  const [energy, setEnergy] = useState<EnergyResponse | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const read = () => load().then((value) => active && setEnergy(value), () => active && setEnergy((current) => current ?? { hours: [], days: [] }));
    read();
    const timer = window.setInterval(read, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [load, enabled]);
  return energy;
}

/** "YYYY-MM-DD" and the hour (0–23) of an instant in a time zone. */
function localParts(date: Date, timeZone: string): { day: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** The last `count` days of the home, oldest first. */
function lastDays(count: number, timeZone: string, now: Date): string[] {
  const days: string[] = [];
  for (let back = 0; days.length < count; back++) {
    const day = localParts(new Date(now.getTime() - back * 86_400_000), timeZone).day;
    if (days[0] !== day) days.unshift(day);
  }
  return days;
}

const noon = (day: string) => new Date(`${day}T12:00:00Z`);

type Bar = { key: string; label: string; title: string; kwh: number };

export function useEnergyTotals(energy: EnergyResponse | null, timeZone: string) {
  const { locale, calendar } = useI18n();
  return useMemo(() => {
    const now = new Date();
    const today = localParts(now, timeZone).day;
    const monthOf = (day: string) => formatDate(noon(day), locale, calendar, "UTC", { year: "numeric", month: "numeric" });
    const days = energy?.days ?? [];
    const sum = (list: { kwh: number }[]) => list.reduce((total, entry) => total + entry.kwh, 0);
    return {
      today: sum(days.filter((entry) => entry.start === today)),
      month: sum(days.filter((entry) => monthOf(entry.start) === monthOf(today))),
    };
  }, [energy, timeZone, locale, calendar]);
}

function useBars(energy: EnergyResponse, range: Range, timeZone: string): Bar[] {
  const { locale, calendar, m } = useI18n();
  return useMemo(() => {
    const kwh = (value: number) => m.energy.kwh(formatNumber(value, locale, value < 10 ? 2 : 1));
    const now = new Date();
    const byDay = new Map(energy.days.map((entry) => [entry.start, entry.kwh]));
    const dayLabel = (day: string, options: Intl.DateTimeFormatOptions) => formatDate(noon(day), locale, calendar, "UTC", options);
    if (range === "day") {
      const today = localParts(now, timeZone).day;
      const perHour = Array<number>(24).fill(0);
      for (const entry of energy.hours) {
        const at = localParts(new Date(entry.start), timeZone);
        if (at.day === today) perHour[at.hour] += entry.kwh;
      }
      return perHour.map((value, hour) => ({
        key: String(hour),
        label: hour % 6 === 0 ? formatNumber(hour, locale) : "",
        title: `${m.energy.hours(formatNumber(hour, locale), formatNumber(hour + 1, locale))} · ${kwh(value)}`,
        kwh: value,
      }));
    }
    if (range === "week" || range === "month") {
      const days = lastDays(range === "week" ? 7 : 30, timeZone, now);
      return days.map((day, index) => {
        const value = byDay.get(day) ?? 0;
        const label = range === "week" ? dayLabel(day, { weekday: "short" }) : index % 5 === 4 || index === 0 ? dayLabel(day, { day: "numeric" }) : "";
        return { key: day, label, title: `${dayLabel(day, { weekday: "long", day: "numeric", month: "long" })} · ${kwh(value)}`, kwh: value };
      });
    }
    // Year: the last 12 months of the user's calendar, the current one included.
    const months: { key: string; label: string; title: string; kwh: number }[] = [];
    for (const day of lastDays(366, timeZone, now).reverse()) {
      const key = dayLabel(day, { year: "numeric", month: "numeric" });
      let month = months.find((entry) => entry.key === key);
      if (!month) {
        if (months.length === 12) break;
        month = { key, label: dayLabel(day, { month: "short" }), title: dayLabel(day, { month: "long", year: "numeric" }), kwh: 0 };
        months.push(month);
      }
      month.kwh += byDay.get(day) ?? 0;
    }
    return months.reverse().map((month) => ({ ...month, title: `${month.title} · ${kwh(month.kwh)}` }));
  }, [energy, range, timeZone, locale, calendar, m]);
}

/** A rounded top for the scale: 1, 2 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * power >= value) ?? 10) * power;
}

function EnergyChart({ bars, label }: { bars: Bar[]; label: string }) {
  const { locale, m } = useI18n();
  const [hovered, setHovered] = useState<number | null>(null);
  const top = niceMax(Math.max(...bars.map((bar) => bar.kwh)));
  const total = bars.reduce((sum, bar) => sum + bar.kwh, 0);
  const shown = hovered === null ? null : bars[hovered];
  return (
    <figure className="energy-chart">
      <figcaption className="energy-readout" aria-live="polite">{shown ? shown.title : m.energy.total(formatNumber(total, locale, total < 10 ? 2 : 1))}</figcaption>
      <div className="energy-plot">
        <div className="energy-grid" aria-hidden="true">
          {[top, top / 2, 0].map((value) => <span key={value}><small>{formatNumber(value, locale, value < 1 && value > 0 ? 1 : 0)}</small></span>)}
        </div>
        <div className="energy-bars" role="img" aria-label={label} onMouseLeave={() => setHovered(null)}>
          {bars.map((bar, index) => (
            <button
              type="button"
              key={bar.key}
              className={`energy-bar${hovered === index ? " is-hovered" : ""}`}
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              aria-label={bar.title}
            >
              <span style={{ height: `${(bar.kwh / top) * 100}%` }} />
            </button>
          ))}
        </div>
        <div className="energy-labels" aria-hidden="true">{bars.map((bar) => <span key={bar.key}>{bar.label}</span>)}</div>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>{bars.map((bar) => <tr key={bar.key}><td>{bar.title}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export function EnergySection({ devices, load, timeZone, onAddDevice }: { devices: Device[]; load: LoadEnergy; timeZone: string; onAddDevice: () => void }) {
  const { locale, m } = useI18n();
  const t = m.energy;
  const list = meters(devices);
  const energy = useEnergy(load, list.length > 0);
  const totals = useEnergyTotals(energy, timeZone);
  const [range, setRange] = useState<Range>("day");
  const bars = useBars(energy ?? { hours: [], days: [] }, range, timeZone);

  if (!list.length) {
    return (
      <div className="quiet-panel">
        <span className="quiet-icon"><Zap size={24} strokeWidth={1.6} /></span>
        <h2>{t.noMeterTitle}</h2>
        <p>{t.noMeterText}</p>
        <button type="button" className="workspace-quick-add" onClick={onAddDevice}><Plus size={14} />{t.addMeter}</button>
      </div>
    );
  }

  const voltages = meterValues(list, "voltage_v");
  const kwh = (value: number) => t.kwh(formatNumber(value, locale, value < 10 ? 2 : 1));
  const stats: Array<[string, string]> = [
    [t.now, powerNow(list, locale, m.devices.units) ?? m.common.none],
    [t.voltage, voltages.length ? `${formatNumber(Math.min(...voltages), locale)}${m.devices.units.volt}` : m.common.none],
    [t.today, energy ? kwh(totals.today) : "…"],
    [t.thisMonth, energy ? kwh(totals.month) : "…"],
  ];
  return (
    <section className="energy-layout">
      <div className="energy-stats">
        {stats.map(([label, value]) => <div key={label} className="surface-panel energy-stat"><span className="metric-label">{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className="surface-panel energy-panel">
        <div className="energy-panel-head">
          <div className="panel-intro"><span className="panel-overline">{list.length > 1 ? t.phases(formatNumber(list.length, locale)) : t.overline}</span><h2>{t.chartTitle}</h2></div>
          <div className="segmented-control energy-ranges" role="radiogroup" aria-label={t.chartTitle}>
            {ranges.map((option) => <button key={option} type="button" role="radio" aria-checked={range === option} className={range === option ? "selected" : ""} onClick={() => setRange(option)}>{t.ranges[option]}</button>)}
          </div>
        </div>
        {energy ? <EnergyChart bars={bars} label={`${t.chartTitle} · ${t.ranges[range]}`} /> : <p className="energy-loading"><Gauge size={16} />{t.loading}</p>}
        <p className="energy-note">{t.note}</p>
      </div>
    </section>
  );
}
