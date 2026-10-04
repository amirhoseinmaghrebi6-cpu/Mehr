"use client";

/**
 * Scenarios of a home: the list (run a themed one, switch a scheduled one on or off), the
 * overview's quick list, and the editor. Every time and date is the home's (its time zone), shown
 * in the user's calendar and digits; times are always 24-hour.
 */
import { useState, type FormEvent } from "react";
import { CalendarClock, Check, ChevronRight, Pencil, Play, Plus, Repeat, Sparkles, Trash2, X, type LucideIcon } from "lucide-react";
import {
  capabilities,
  DEFAULT_SCENARIO_LATE_WINDOW,
  scenarioLateWindows,
  type CapabilityDefinition,
  type CapabilityName,
  type CapabilityValue,
  type Device,
  type Property,
  type Scenario,
  type ScenarioKind,
  type ScenarioLateWindow,
  type ScenarioRequest,
  type Weekday,
} from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { capabilityLabel, valueLabel } from "@/lib/device-ui";
import { formatDate, formatNumber, formatTime, timeZoneCity, type Locale, type Messages } from "@/lib/i18n";
import { gatewayMessage } from "@/lib/gateway-messages";
import { fromCalendarDate, localParts, monthLength, toCalendarDate, zonedToInstant } from "@/lib/scenario-time";
import { GatewayError } from "@/services/home-gateway";

const kindIcons: Record<ScenarioKind, LucideIcon> = { themed: Sparkles, periodic: Repeat, one_time: CalendarClock };
const scenarioKinds: ScenarioKind[] = ["themed", "periodic", "one_time"];

/** "15:00" in the user's digits. */
const clock = (time: string, locale: Locale) => time.split(":").map((part) => formatNumber(Number(part), locale).padStart(2, formatNumber(0, locale))).join(":");

/** When it runs: "Tap to run", "Sat, Tue · 15:00", "20 Mordad 1407 · 08:00". */
export function scheduleSummary(scenario: Scenario, timeZone: string, locale: Locale, calendar: "solar_hijri" | "gregorian", m: Messages): string {
  const t = m.scenarios;
  if (scenario.kind === "themed" || !scenario.time) return t.tapToRun;
  if (scenario.kind === "periodic") {
    const days = scenario.weekdays ?? [];
    const names = days.length === 7 ? t.everyDay : t.weekOrder.filter((day) => days.includes(day as Weekday)).map((day) => t.weekdaysShort[day]).join(m.meta.dir === "rtl" ? "، " : ", ");
    return t.at(names, clock(scenario.time, locale));
  }
  const at = zonedToInstant(scenario.date!, scenario.time, timeZone);
  return t.at(formatDate(at, locale, calendar, timeZone, { day: "numeric", month: "long", year: "numeric" }), clock(scenario.time, locale));
}

/** Its state: off, next run, or what happened last. */
function statusLine(scenario: Scenario, timeZone: string, locale: Locale, calendar: "solar_hijri" | "gregorian", m: Messages): string | null {
  const t = m.scenarios;
  const when = (iso: string) => `${formatDate(new Date(iso), locale, calendar, timeZone, { weekday: "short", day: "numeric", month: "short" })} · ${formatTime(new Date(iso), locale, timeZone)}`;
  if (scenario.kind !== "themed" && !scenario.enabled) return t.off;
  if (scenario.nextRunAt) return t.nextRun(when(scenario.nextRunAt));
  if (scenario.lastRun) {
    const at = scenario.lastRun.scheduledFor ?? scenario.lastRun.createdAt;
    return scenario.lastRun.status === "missed" ? t.missed(when(at)) : t.ran(when(at));
  }
  return scenario.kind === "one_time" ? t.over : null;
}

type ListProps = {
  property: Property;
  timeZone: string;
  scenarios: Scenario[] | null;
  canEdit: boolean;
  demo: boolean;
  running: string | null;
  nameOf: (name: string) => string;
  onRun: (scenario: Scenario) => void;
  onEdit: (scenario: Scenario | "new") => void;
  onToggle: (scenario: Scenario, enabled: boolean) => void;
};

export function ScenarioList({ timeZone, scenarios, canEdit, demo, running, nameOf, onRun, onEdit, onToggle }: ListProps) {
  const { locale, m, calendar } = useI18n();
  const t = m.scenarios;
  if (!scenarios) return null;
  if (!scenarios.length) {
    return (
      <div className="workspace-empty scenario-empty">
        <Sparkles size={21} />
        <strong>{t.empty}<small>{canEdit ? t.emptyText : t.emptyMember}</small></strong>
        {canEdit && <button type="button" className="workspace-quick-add" onClick={() => onEdit("new")}><Plus size={15} />{t.newScenario}</button>}
      </div>
    );
  }
  return (
    <section className="collection-section">
      <div className="scenario-grid">
        {scenarios.map((scenario) => {
          const Icon = kindIcons[scenario.kind];
          const name = nameOf(scenario.name);
          const status = statusLine(scenario, timeZone, locale, calendar, m);
          return (
            <article className={`scenario-card${scenario.kind !== "themed" && !scenario.enabled ? " is-off" : ""}`} key={scenario.id}>
              <div className="scenario-card-top">
                <span className={`scenario-icon scenario-icon-${scenario.kind}`}><Icon size={19} /></span>
                <span className="scenario-kind">{t.kinds[scenario.kind]}</span>
                {canEdit && <button type="button" className="scenario-edit" onClick={() => onEdit(scenario)} aria-label={t.edit(name)}><Pencil size={14} /></button>}
              </div>
              <strong className="scenario-name">{name}</strong>
              <span className="scenario-schedule">{scheduleSummary(scenario, timeZone, locale, calendar, m)}</span>
              <span className="scenario-meta">
                {t.actionCount(scenario.actions.length, formatNumber(scenario.actions.length, locale))}
                {status && <><span aria-hidden="true"> · </span><span className={scenario.lastRun?.status === "missed" && !scenario.nextRunAt ? "scenario-missed" : ""}>{status}</span></>}
              </span>
              <div className="scenario-card-foot">
                {scenario.kind === "themed" ? (
                  <button type="button" className="scenario-run" onClick={() => onRun(scenario)} disabled={running === scenario.id || !scenario.actions.length} aria-label={t.runName(name)}><Play size={14} />{t.run}</button>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    className="scenario-switch"
                    aria-checked={scenario.enabled}
                    aria-label={t.onSchedule(name)}
                    disabled={!canEdit}
                    onClick={() => onToggle(scenario, !scenario.enabled)}
                  ><span /></button>
                )}
              </div>
            </article>
          );
        })}
        {canEdit && <button type="button" className="scenario-card scenario-new" onClick={() => onEdit("new")}><span className="scenario-icon"><Plus size={19} /></span><strong className="scenario-name">{t.newScenario}</strong><span className="scenario-schedule">{t.kindHints.themed}</span></button>}
      </div>
      <p className="form-note scenario-zone-note">{t.editorDescription(timeZoneCity(timeZone, locale))}</p>
      {demo && <p className="form-note">{t.demoNote}</p>}
    </section>
  );
}

/** The overview's panel: themed scenarios to run with one tap. */
export function ScenarioQuickList({ scenarios, running, nameOf, onRun, onOpen, title, detail, action, arrow }: { scenarios: Scenario[] | null; running: string | null; nameOf: (name: string) => string; onRun: (scenario: Scenario) => void; onOpen: () => void; title: string; detail: string; action: string; arrow: React.ReactNode }) {
  const { locale, m } = useI18n();
  const themed = (scenarios ?? []).filter((scenario) => scenario.kind === "themed").slice(0, 4);
  return (
    <section className="surface-panel scenes-panel">
      <div className="section-heading">
        <div><h2>{title}</h2><p>{detail}</p></div>
        <button type="button" className="text-action" onClick={onOpen}>{action}<span>{arrow}</span></button>
      </div>
      <div className="scene-list">
        {themed.length ? themed.map((scenario) => (
          <button className="scene-row" key={scenario.id} type="button" onClick={() => onRun(scenario)} disabled={running === scenario.id || !scenario.actions.length} aria-label={m.scenarios.runName(nameOf(scenario.name))}>
            <span className="scene-icon scenario-icon-themed"><Sparkles size={17} strokeWidth={1.8} /></span>
            <span className="scene-copy"><strong>{nameOf(scenario.name)}</strong><small>{m.scenarios.actionCount(scenario.actions.length, formatNumber(scenario.actions.length, locale))}</small></span>
            <span className="scene-trigger">{running === scenario.id ? <Check size={17} /> : <Play size={15} />}</span>
          </button>
        )) : (
          <button className="scene-row" type="button" onClick={onOpen}>
            <span className="scene-icon scenario-icon-themed"><Sparkles size={17} strokeWidth={1.8} /></span>
            <span className="scene-copy"><strong>{m.scenarios.empty}</strong><small>{m.scenarios.kindHints.themed}</small></span>
            <span className="scene-trigger"><ChevronRight size={17} /></span>
          </button>
        )}
      </div>
    </section>
  );
}

type Action = { deviceId: string; capability: CapabilityName; targetValue: CapabilityValue };

const writable = (device: Device) => device.capabilities.filter((state) => state.writable).map((state) => state.capability);

function defaultValue(capability: CapabilityName): CapabilityValue {
  const definition = capabilities[capability];
  if (definition.valueType === "boolean") return true;
  if (definition.valueType === "enum") return definition.values[0];
  return "max" in definition && definition.max !== undefined ? definition.max : 0;
}

export function ScenarioEditorDialog({
  scenario,
  property,
  timeZone,
  devices,
  nameOf,
  onClose,
  onSave,
  onDelete,
}: {
  scenario: Scenario | null;
  property: Property;
  timeZone: string;
  devices: Device[];
  nameOf: (name: string) => string;
  onClose: () => void;
  onSave: (input: ScenarioRequest) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { locale, m, rtl, calendar, temperatureUnit } = useI18n();
  const t = m.scenarios;
  const controllable = devices.filter((device) => writable(device).length > 0);
  const today = localParts(new Date(), timeZone);
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const initialDate = scenario?.date ?? `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;

  const [name, setName] = useState(scenario ? nameOf(scenario.name) : "");
  const [kind, setKind] = useState<ScenarioKind>(scenario?.kind ?? "themed");
  const [days, setDays] = useState<Weekday[]>(scenario?.weekdays ?? [today.weekday as Weekday]);
  const [time, setTime] = useState(scenario?.time ?? "08:00");
  const [lateWindow, setLateWindow] = useState<ScenarioLateWindow>(scenario?.lateWindowSeconds ?? DEFAULT_SCENARIO_LATE_WINDOW);
  const [date, setDate] = useState(toCalendarDate(initialDate, calendar));
  const [actions, setActions] = useState<Action[]>(
    scenario?.actions.length ? scenario.actions : controllable[0] ? [{ deviceId: controllable[0].id, capability: writable(controllable[0])[0], targetValue: defaultValue(writable(controllable[0])[0]) }] : [],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(gatewayMessage(caught instanceof GatewayError ? caught.code : "network", locale));
    } finally {
      setBusy(false);
    }
  };

  const [hour, minute] = time.split(":");
  const setClock = (nextHour: string, nextMinute: string) => setTime(`${nextHour}:${nextMinute}`);
  const daysInMonth = monthLength(date.year, date.month, calendar);
  const setDatePart = (part: "year" | "month" | "day", value: number) =>
    setDate((current) => {
      const next = { ...current, [part]: value };
      return { ...next, day: Math.min(next.day, monthLength(next.year, next.month, calendar)) };
    });
  const thisYear = toCalendarDate(`${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`, calendar).year;
  const years = Array.from(new Set([date.year, ...Array.from({ length: 6 }, (_, index) => thisYear + index)])).sort((a, b) => a - b);
  const number = (value: number, width = 1) => formatNumber(value, locale).padStart(width, formatNumber(0, locale));

  const updateAction = (index: number, change: Partial<Action>) =>
    setActions((current) =>
      current.map((action, at) => {
        if (at !== index) return action;
        const next = { ...action, ...change };
        if (change.deviceId) {
          const device = devices.find((item) => item.id === change.deviceId);
          const capability = device && writable(device).includes(next.capability) ? next.capability : device ? writable(device)[0] : next.capability;
          return { ...next, capability, targetValue: capability === action.capability ? next.targetValue : defaultValue(capability) };
        }
        if (change.capability) return { ...next, targetValue: defaultValue(change.capability) };
        return next;
      }),
    );
  const used = (action: Action) => actions.filter((item) => item.deviceId === action.deviceId && item.capability === action.capability).length > 1;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!actions.length) return setError(t.needAction);
    if (actions.some(used)) return setError(t.duplicateAction);
    const base = { name: name.trim(), enabled: scenario?.enabled ?? true, actions };
    let input: ScenarioRequest;
    if (kind === "periodic") {
      if (!days.length) return setError(t.pickDay);
      input = { ...base, kind, weekdays: days, time, lateWindowSeconds: lateWindow };
    } else if (kind === "one_time") {
      const gregorian = fromCalendarDate(date, calendar);
      if (zonedToInstant(gregorian, time, timeZone) <= new Date()) return setError(t.pastDate);
      input = { ...base, kind, date: gregorian, time, lateWindowSeconds: lateWindow };
    } else {
      input = { ...base, kind };
    }
    void run(() => onSave(input));
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="scenario-dialog-title" dir={rtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={m.common.close}><X size={17} /></button>
        {confirmDelete && scenario ? (
          <>
            <span className="workspace-dialog-icon delete-dialog-icon"><Trash2 size={19} /></span>
            <h2 id="scenario-dialog-title">{t.removeQuestion(nameOf(scenario.name))}</h2>
            <p className="workspace-dialog-description">{t.removeText}</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="workspace-form-actions">
              <button type="button" className="button-subtle" onClick={() => setConfirmDelete(false)}>{t.keep}</button>
              <button type="button" className="button-danger" disabled={busy} onClick={() => void run(onDelete)}><Trash2 size={15} />{t.remove}</button>
            </div>
          </>
        ) : (
          <>
            <span className="workspace-dialog-icon"><Sparkles size={19} /></span><span className="panel-overline">{t.overline}</span>
            <h2 id="scenario-dialog-title">{scenario ? t.editorEdit : t.editorNew}</h2>
            <p className="workspace-dialog-description">{t.editorDescription(`${timeZoneCity(timeZone, locale)} · ${nameOf(property.name)}`)}</p>
            <form className="workspace-form" onSubmit={submit}>
              <label className="form-field"><span>{t.name}</span><input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={t.namePlaceholder} /></label>

              <div className="form-field">
                <span>{t.kind}</span>
                <div className="segmented-control" role="radiogroup" aria-label={t.kind}>
                  {scenarioKinds.map((option) => <button key={option} type="button" role="radio" aria-checked={kind === option} className={kind === option ? "selected" : ""} onClick={() => setKind(option)}>{t.kinds[option]}</button>)}
                </div>
                <small className="form-note">{t.kindHints[kind]}</small>
              </div>

              {kind === "periodic" && (
                <div className="form-field">
                  <span>{t.days}</span>
                  <div className="weekday-picker">
                    {t.weekOrder.map((day) => {
                      const selected = days.includes(day as Weekday);
                      return <button key={day} type="button" aria-pressed={selected} className={selected ? "selected" : ""} title={t.weekdays[day]} onClick={() => setDays((current) => (selected ? current.filter((item) => item !== day) : [...current, day as Weekday]))}>{t.weekdaysShort[day]}</button>;
                    })}
                  </div>
                </div>
              )}

              {kind === "one_time" && (
                <div className="form-field">
                  <span>{t.date}</span>
                  <div className="date-picker">
                    <select aria-label={t.day} value={date.day} onChange={(event) => setDatePart("day", Number(event.target.value))}>{Array.from({ length: daysInMonth }, (_, index) => <option key={index + 1} value={index + 1}>{number(index + 1)}</option>)}</select>
                    <select aria-label={t.month} value={date.month} onChange={(event) => setDatePart("month", Number(event.target.value))}>{t.months[calendar].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select>
                    <select aria-label={t.year} value={date.year} onChange={(event) => setDatePart("year", Number(event.target.value))}>{years.map((year) => <option key={year} value={year}>{formatNumber(year, locale).replace(/[,٬]/g, "")}</option>)}</select>
                  </div>
                </div>
              )}

              {kind !== "themed" && (
                <div className="form-field">
                  <span>{t.time} · {t.homeTime(timeZoneCity(timeZone, locale))}</span>
                  <div className="time-picker" dir="ltr">
                    <select aria-label={t.hour} value={hour} onChange={(event) => setClock(event.target.value, minute)}>{Array.from({ length: 24 }, (_, index) => <option key={index} value={String(index).padStart(2, "0")}>{number(index, 2)}</option>)}</select>
                    <span>:</span>
                    <select aria-label={t.minute} value={minute} onChange={(event) => setClock(hour, event.target.value)}>{Array.from({ length: 60 }, (_, index) => <option key={index} value={String(index).padStart(2, "0")}>{number(index, 2)}</option>)}</select>
                  </div>
                </div>
              )}

              {kind !== "themed" && (
                <label className="form-field">
                  <span>{t.lateWindow}</span>
                  <select value={lateWindow} onChange={(event) => setLateWindow(Number(event.target.value) as ScenarioLateWindow)}>
                    {scenarioLateWindows.map((seconds) => <option key={seconds} value={seconds}>{t.lateWindows[seconds]}</option>)}
                  </select>
                  <small className="form-note">{t.lateWindowNote}</small>
                </label>
              )}

              <div className="form-field">
                <span>{t.actions}</span>
                {controllable.length === 0 ? <p className="form-note">{t.noDevices}</p> : (
                  <div className="action-list">
                    {actions.map((action, index) => {
                      const device = devices.find((item) => item.id === action.deviceId);
                      const definition: CapabilityDefinition = capabilities[action.capability];
                      return (
                        <div className={`action-row${used(action) ? " is-duplicate" : ""}`} key={index}>
                          <select aria-label={t.device} value={action.deviceId} onChange={(event) => updateAction(index, { deviceId: event.target.value })}>
                            {!device && <option value={action.deviceId}>—</option>}
                            {controllable.map((item) => <option key={item.id} value={item.id}>{nameOf(item.name)}</option>)}
                          </select>
                          {device && writable(device).length > 1 && (
                            <select aria-label={t.setting} value={action.capability} onChange={(event) => updateAction(index, { capability: event.target.value as CapabilityName })}>
                              {writable(device).map((capability) => <option key={capability} value={capability}>{capabilityLabel(capability, locale)}</option>)}
                            </select>
                          )}
                          {definition.valueType === "boolean" ? (
                            <select aria-label={t.value} value={String(action.targetValue)} onChange={(event) => updateAction(index, { targetValue: event.target.value === "true" })}>
                              {[true, false].map((value) => <option key={String(value)} value={String(value)}>{valueLabel(action.capability, value, locale, temperatureUnit)}</option>)}
                            </select>
                          ) : definition.valueType === "enum" ? (
                            <select aria-label={t.value} value={String(action.targetValue)} onChange={(event) => updateAction(index, { targetValue: event.target.value })}>
                              {definition.values.map((value) => <option key={value} value={value}>{valueLabel(action.capability, value, locale, temperatureUnit)}</option>)}
                            </select>
                          ) : (
                            <input aria-label={t.value} type="number" inputMode="numeric" min={definition.min} max={definition.max} step={definition.step ?? 1} value={Number(action.targetValue)} onChange={(event) => updateAction(index, { targetValue: Number(event.target.value) })} />
                          )}
                          <button type="button" className="action-remove" onClick={() => setActions((current) => current.filter((_, at) => at !== index))} aria-label={t.removeAction}><X size={14} /></button>
                        </div>
                      );
                    })}
                    <button type="button" className="workspace-add-button" onClick={() => setActions((current) => [...current, { deviceId: controllable[0].id, capability: writable(controllable[0])[0], targetValue: defaultValue(writable(controllable[0])[0]) }])}><Plus size={15} />{t.addAction}</button>
                  </div>
                )}
              </div>

              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="workspace-form-actions">
                {scenario && <button type="button" className="button-subtle scenario-delete" onClick={() => { setError(""); setConfirmDelete(true); }}><Trash2 size={15} />{t.remove}</button>}
                <button type="button" className="button-subtle" onClick={onClose}>{m.common.cancel}</button>
                <button type="submit" className="button-primary" disabled={busy || controllable.length === 0}><Check size={15} />{t.save}</button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
