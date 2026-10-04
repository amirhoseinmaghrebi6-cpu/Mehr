"use client";

import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  CloudSun,
  DoorOpen,
  Film,
  Hourglass,
  House,
  Leaf,
  LockKeyhole,
  Moon,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldHalf,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  Trash2,
  TriangleAlert,
  Utensils,
  Wifi,
  Zap,
} from "lucide-react";
import { calendars, defaultTimeZone, displayTemperature, languages, temperatureUnits, type CapabilityName, type CapabilityValue, type Device, type Property, type Room } from "@m2smart/contracts";
import { DeviceControl } from "@/components/device-control";
import { useI18n } from "@/components/i18n-provider";
import { deviceSummary, isActive, isAlert, photoUrl, primaryCapability, typeLabel } from "@/lib/device-ui";
import { formatDate, formatNumber, messages, type Messages } from "@/lib/i18n";

/** A home's time zone (homes saved by older demo sessions have none: Tehran). */
export const homeTimeZone = (property: Property) => property.timeZone ?? defaultTimeZone;
import type { HomeSnapshot } from "@/services/mock-home-service";

export type DashboardSection = "overview" | "rooms" | "devices" | "scenes" | "automations" | "energy" | "security" | "cameras" | "notifications" | "settings";

/** Sections that only have sample data so far; real users see "coming soon" there. */
const sampleOnlySections: ReadonlySet<DashboardSection> = new Set(["scenes", "automations", "energy", "security", "cameras"]);

type Props = {
  section: DashboardSection;
  property: Property;
  displayName: string;
  rooms: Room[];
  devices: Device[];
  loading: boolean;
  canEditRooms: boolean;
  nameOf: (name: string) => string;
  valueOf: (device: Device, capability: CapabilityName) => CapabilityValue | null;
  activityOf: (device: Device) => "sending" | "working" | null;
  /** Sample scenes, routines and energy, for the demo only. */
  demo: HomeSnapshot | null;
  activeScene: string | null;
  query: string;
  onOpenDevice: (device: Device) => void;
  onQuickAction: (device: Device) => void;
  onActivateScene: (id: string) => void;
  onNavigate: (section: DashboardSection) => void;
  onClearSearch: () => void;
  onAddRoom: () => void;
  onEditRoom: (room: Room) => void;
  onAddDevice: () => void;
  onRemoveDevice?: (device: Device) => void;
};

const sceneIcons = { sunrise: Sunrise, film: Film, utensils: Utensils, door: DoorOpen } as const;

function greeting(m: Messages): string {
  const hour = new Date().getHours();
  return hour < 12 ? m.dashboard.greetings.morning : hour < 18 ? m.dashboard.greetings.afternoon : m.dashboard.greetings.evening;
}

export function DashboardView(props: Props) {
  const { section, property, devices, rooms, query, nameOf, demo, onClearSearch } = props;
  const { locale, m, rtl } = useI18n();
  const title = section === "overview" ? m.dashboard.commandCenter : m.nav[section];
  const roomName = (device: Device) => nameOf(rooms.find((room) => room.id === device.roomId)?.name ?? "");
  const search = query.trim().toLocaleLowerCase();
  const filteredDevices = search
    ? devices.filter((device) => `${nameOf(device.name)} ${device.name} ${roomName(device)} ${typeLabel(device.type, locale)}`.toLocaleLowerCase().includes(search))
    : devices;
  const online = devices.filter((device) => device.online).length;

  if (search && filteredDevices.length === 0) {
    return (
      <div className="empty-state search-empty" role="status">
        <span className="empty-icon"><Wifi size={23} /></span>
        <h2>{m.dashboard.noResults}</h2>
        <p>{m.dashboard.noResultsFor(query)}</p>
        <button className="text-action" onClick={onClearSearch} type="button">{m.dashboard.clearSearch}</button>
      </div>
    );
  }

  const status = devices.length === 0 ? m.dashboard.readyForBoard : m.dashboard.devicesOnline(formatNumber(online, locale), formatNumber(devices.length, locale));

  return (
    <motion.div className="page-content" key={`${section}-${property.id}-${locale}`} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }} dir={rtl ? "rtl" : "ltr"}>
      <header className="page-heading">
        <div>
          <div className="eyebrow"><span className={`status-pulse${online > 0 ? "" : " is-pending"}`} />{nameOf(property.name)} <span className="eyebrow-divider">/</span> {status}</div>
          <h1>{title}</h1>
          <p>{section === "overview" ? m.dashboard.subtitle : m.dashboard.sectionCopy[section]}</p>
        </div>
        <div className="heading-tools">
          {section === "rooms" && props.canEditRooms && <button type="button" className="workspace-quick-add" onClick={props.onAddRoom}><Plus size={15} />{m.dashboard.addSpace}</button>}
          {section === "devices" && <button type="button" className="workspace-quick-add" onClick={props.onAddDevice}><Plus size={15} />{m.dashboard.addDevice}</button>}
        </div>
      </header>

      {props.loading ? (
        <div className="quiet-panel" role="status"><span className="quiet-icon"><Hourglass size={24} strokeWidth={1.6} /></span><h2>{m.dashboard.loadingHome}</h2></div>
      ) : search ? (
        <DeviceCollection {...props} devices={filteredDevices} roomName={roomName} title={m.dashboard.searchResults} />
      ) : section === "overview" ? (
        <Overview {...props} />
      ) : !demo && sampleOnlySections.has(section) ? (
        <ComingSoon section={section} />
      ) : (
        <SectionContent {...props} roomName={roomName} />
      )}
    </motion.div>
  );
}

function Overview(props: Props) {
  const { property, displayName, devices, rooms, demo, activeScene, nameOf, onNavigate, onActivateScene } = props;
  const { locale, m, rtl, calendar, temperatureUnit } = useI18n();
  const d = m.dashboard;
  const arrow = rtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />;
  const featured = [...devices].sort((a, b) => Number(primaryCapability(b) !== null) - Number(primaryCapability(a) !== null)).slice(0, 5);
  const numbers = (capability: CapabilityName) => devices.flatMap((device) => device.capabilities.filter((state) => state.capability === capability && typeof state.value === "number").map((state) => state.value as number));
  const temperatures = numbers("temperature");
  const humidity = numbers("humidity");
  const powerNow = numbers("power_w");
  const alerts = devices.filter(isAlert);
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

  return (
    <>
      <section className="welcome-banner" aria-label={d.homeStatus}>
        <div className="welcome-photo" style={{ backgroundImage: `url("${photoUrl(property.coverPhoto, "large")}")` }} />
        <div className="welcome-wash" />
        <div className="welcome-content">
          <span className="welcome-kicker"><span className="welcome-live-dot" />{d.rightNow} · {formatDate(new Date(), locale, calendar, homeTimeZone(property))}</span>
          <h2>{greeting(m)}{rtl ? "،" : ","}<br />{displayName.split(/\s+/)[0]}.</h2>
          <p>{alerts.length ? d.needsAttention : d.homeStatusDetail}</p>
          {nameOf(property.address) && <div className="welcome-weather"><CloudSun size={16} />{nameOf(property.address)}</div>}
        </div>
        <div className="welcome-status">
          <span className="welcome-status-check">{alerts.length ? <TriangleAlert size={15} /> : <Check size={15} strokeWidth={2.4} />}</span>
          <span><strong>{alerts.length ? d.needsLook : d.homeStatus}</strong><small>{d.asOfNow}</small></span>
        </div>
      </section>

      <section className="metric-strip" aria-label={d.atAGlance}>
        <article className="metric-item">
          <span className="metric-symbol climate-symbol"><Thermometer size={17} /></span>
          <div className="metric-content"><span className="metric-label">{d.indoorComfort}</span>
            {temperatures.length ? <strong>{formatNumber(displayTemperature(average(temperatures), temperatureUnit), locale, 1)}° <small>{temperatureUnit === "fahrenheit" ? d.fahrenheit : d.celsius}</small></strong> : <strong className="metric-empty">{m.common.none}</strong>}
            <span className="metric-foot"><span className="metric-dot" />{humidity.length ? d.humidity(formatNumber(average(humidity), locale)) : d.noClimateSensor}</span></div>
        </article>
        <article className="metric-item">
          <span className="metric-symbol energy-symbol"><Zap size={17} /></span>
          <div className="metric-content"><span className="metric-label">{d.powerNow}</span>
            {powerNow.length ? <strong>{formatNumber(powerNow.reduce((sum, value) => sum + value, 0), locale)} <small>{d.watts}</small></strong> : <strong className="metric-empty">{m.common.none}</strong>}
            <span className="metric-foot">{powerNow.length ? d.fromMetered(formatNumber(powerNow.length, locale)) : d.noMeter}</span></div>
        </article>
        <article className="metric-item">
          <span className="metric-symbol security-symbol">{alerts.length ? <TriangleAlert size={17} /> : <ShieldCheck size={17} />}</span>
          <div className="metric-content"><span className="metric-label">{d.safety}</span><strong className="security-value">{alerts.length ? d.alerts(formatNumber(alerts.length, locale)) : d.allClear}</strong><span className="metric-foot"><span className="metric-dot" />{alerts.length ? alerts.map((device) => nameOf(device.name)).join(rtl ? "، " : ", ") : d.fromLatest}</span></div>
        </article>
      </section>

      <section className="content-section rooms-section">
        <SectionHeading title={d.spaces} detail={d.spacesDetail} action={d.allSpaces} onAction={() => onNavigate("rooms")} arrow={arrow} />
        {rooms.length ? <div className="room-grid">{rooms.slice(0, 4).map((room) => <RoomTile key={room.id} room={room} {...props} onClick={() => onNavigate("rooms")} />)}</div> : <EmptyRooms {...props} />}
      </section>

      <div className="overview-lower-grid">
        {demo ? (
          <section className="surface-panel scenes-panel">
            <SectionHeading title={d.scenesTitle} detail={d.scenesSubtitle} action={d.viewAll} onAction={() => onNavigate("scenes")} arrow={arrow} />
            <div className="scene-list">
              {demo.scenes.map((scene) => {
                const Icon = sceneIcons[scene.icon as keyof typeof sceneIcons];
                const selected = activeScene === scene.id;
                const [name, detail] = m.demo.scenes[scene.id] ?? [scene.name, scene.detail];
                return (
                  <button className={`scene-row${selected ? " scene-selected" : ""}`} key={scene.id} type="button" onClick={() => onActivateScene(scene.id)} aria-pressed={selected}>
                    <span className={`scene-icon scene-icon-${scene.id}`}><Icon size={17} strokeWidth={1.8} /></span>
                    <span className="scene-copy"><strong>{name}</strong><small>{detail}</small></span>
                    <span className="scene-trigger">{selected ? <CircleCheck size={19} /> : <ChevronRight size={17} />}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="surface-panel scenes-panel coming-soon-panel">
            <span className="quiet-icon"><Sunrise size={22} strokeWidth={1.6} /></span>
            <h3>{d.scenesSoonTitle}</h3>
            <p>{d.scenesSoonText}</p>
          </section>
        )}

        <section className="surface-panel devices-panel">
          <SectionHeading title={d.devicesTitle} detail={d.devicesSubtitle} action={d.allDevices} onAction={() => onNavigate("devices")} arrow={arrow} />
          <div className="device-list">
            {featured.length ? featured.map((device) => <DeviceCard key={device.id} device={device} {...props} />) : <NoDevices {...props} />}
          </div>
        </section>
      </div>
    </>
  );
}

function DeviceCard({ device, nameOf, valueOf, activityOf, onOpenDevice, onQuickAction, showRoom, roomName }: Props & { device: Device; showRoom?: boolean; roomName?: (device: Device) => string }) {
  const { locale, temperatureUnit } = useI18n();
  const primary = primaryCapability(device);
  const value = (capability: CapabilityName) => valueOf(device, capability);
  const primaryValue = primary ? value(primary) : device.capabilities[0] ? value(device.capabilities[0].capability) : null;
  return (
    <DeviceControl
      device={device}
      name={nameOf(device.name)}
      summary={deviceSummary(device, value, locale, temperatureUnit)}
      roomName={showRoom ? roomName?.(device) : undefined}
      active={isActive(device.type, primaryValue)}
      alert={isAlert(device)}
      activity={activityOf(device)}
      onOpen={onOpenDevice}
      onQuickAction={primary ? onQuickAction : undefined}
    />
  );
}

function NoDevices({ onAddDevice }: Props) {
  const { m } = useI18n();
  return (
    <div className="workspace-empty"><Building2 size={21} /><strong>{m.dashboard.noDevicesTitle}<small>{m.dashboard.noDevicesText}</small></strong><button type="button" className="workspace-quick-add" onClick={onAddDevice}><Plus size={15} />{m.dashboard.howToAdd}</button></div>
  );
}

function EmptyRooms({ canEditRooms, onAddRoom }: Props) {
  const { m } = useI18n();
  return (
    <div className="workspace-empty"><Building2 size={21} /><strong>{m.dashboard.noRoomsTitle}<small>{m.dashboard.noRoomsText}</small></strong>{canEditRooms && <button type="button" className="workspace-quick-add" onClick={onAddRoom}><Plus size={15} />{m.dashboard.addSpace}</button>}</div>
  );
}

function SectionHeading({ title, detail, action, onAction, arrow }: { title: string; detail: string; action: string; onAction: () => void; arrow: React.ReactNode }) {
  return (
    <div className="section-heading">
      <div><h2>{title}</h2><p>{detail}</p></div>
      <button type="button" className="text-action" onClick={onAction}>{action}<span>{arrow}</span></button>
    </div>
  );
}

function RoomTile({ room, devices, nameOf, valueOf, canEditRooms, onEditRoom, onClick }: Props & { room: Room; onClick: () => void }) {
  const { locale, m, temperatureUnit } = useI18n();
  const inRoom = devices.filter((device) => device.roomId === room.id);
  const active = inRoom.filter((device) => {
    const primary = primaryCapability(device);
    return primary !== null && isActive(device.type, valueOf(device, primary));
  }).length;
  const temperature = inRoom.flatMap((device) => device.capabilities).find((state) => state.capability === "temperature" && typeof state.value === "number")?.value as number | undefined;
  const name = nameOf(room.name);
  return (
    <div className="room-card-wrap">
      <motion.button className="room-tile" type="button" onClick={onClick} whileHover={{ y: -3 }} transition={{ duration: 0.18 }}>
        <span className="room-image" style={{ backgroundImage: `url("${photoUrl(room.photo)}")` }} />
        <span className="room-overlay" />
        <span className="room-topline"><span><span className="room-live-dot" />{active ? m.dashboard.roomInUse : m.dashboard.roomQuiet}</span>{temperature !== undefined && <span className="room-temp"><Thermometer size={13} />{formatNumber(displayTemperature(temperature, temperatureUnit), locale)}°</span>}</span>
        <span className="room-bottomline"><span><strong>{name}</strong><small>{m.dashboard.roomDevices(formatNumber(inRoom.length, locale), formatNumber(active, locale))}</small></span><span className="room-arrow"><ChevronRight size={17} /></span></span>
      </motion.button>
      {canEditRooms && <button type="button" className="room-edit-button" onClick={() => onEditRoom(room)} aria-label={m.dashboard.editRoom(name)}><Pencil size={14} /></button>}
    </div>
  );
}

function DeviceCollection(props: Props & { roomName: (device: Device) => string; title: string }) {
  const { devices, title, nameOf, onNavigate, onRemoveDevice } = props;
  const { m, rtl } = useI18n();
  return (
    <section className="collection-section">
      <SectionHeading title={title} detail={m.dashboard.statesNote} action={m.dashboard.browseRooms} onAction={() => onNavigate("rooms")} arrow={rtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />} />
      {devices.length === 0 ? <NoDevices {...props} /> : (
        <div className="collection-device-grid">
          {devices.map((device) => (
            <div className="device-management-row" key={device.id}>
              <DeviceCard device={device} {...props} showRoom />
              {onRemoveDevice && <button type="button" className="device-remove-button" onClick={() => onRemoveDevice(device)} aria-label={m.shell.removeDevice.label(nameOf(device.name))}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionContent(props: Props & { roomName: (device: Device) => string }) {
  const { section, rooms, demo, activeScene, onActivateScene, onNavigate } = props;
  const { m } = useI18n();

  if (section === "rooms") {
    return (
      <section className="collection-section">
        {rooms.length ? <div className="room-grid collection-room-grid">{rooms.map((room) => <RoomTile key={room.id} room={room} {...props} onClick={() => onNavigate("devices")} />)}</div> : <EmptyRooms {...props} />}
      </section>
    );
  }
  if (section === "devices") return <DeviceCollection {...props} title={m.dashboard.everyDevice} />;
  if (section === "notifications") return <div className="quiet-panel"><span className="quiet-icon"><CircleCheck size={26} strokeWidth={1.6} /></span><h2>{m.dashboard.notificationsTitle}</h2><p>{m.dashboard.notificationsCopy}</p><span className="quiet-meta"><Clock3 size={14} />{m.dashboard.allCaughtUp}</span></div>;
  if (section === "settings") return <SettingsSection demo={Boolean(demo)} property={props.property} />;
  if (!demo) return <ComingSoon section={section} />;

  if (section === "scenes") {
    return <section className="collection-section"><div className="scene-card-grid">{demo.scenes.map((scene) => {
      const Icon = sceneIcons[scene.icon as keyof typeof sceneIcons];
      const selected = activeScene === scene.id;
      const [name, detail] = m.demo.scenes[scene.id] ?? [scene.name, scene.detail];
      return <button className={`large-scene-card${selected ? " scene-selected" : ""}`} type="button" onClick={() => onActivateScene(scene.id)} key={scene.id} aria-pressed={selected}><span className={`large-scene-icon scene-icon-${scene.id}`}><Icon size={22} /></span><strong>{name}</strong><span>{detail}</span><span className="large-scene-action">{selected ? <CircleCheck size={20} /> : <ChevronRight size={19} />}</span></button>;
    })}</div></section>;
  }
  if (section === "automations") return <AutomationSection snapshot={demo} />;
  if (section === "energy") return <EnergySection snapshot={demo} />;
  if (section === "security") return <SecuritySection onNavigate={onNavigate} />;
  if (section === "cameras") return <CameraSection />;
  return null;
}

function ComingSoon({ section }: { section: DashboardSection }) {
  const { m } = useI18n();
  const icons = { scenes: Sunrise, automations: Sunset, energy: Zap, security: ShieldCheck, cameras: Camera } as Partial<Record<DashboardSection, typeof Sunrise>>;
  const Icon = icons[section] ?? Clock3;
  return (
    <div className="quiet-panel coming-soon" role="status">
      <span className="quiet-icon"><Icon size={24} strokeWidth={1.6} /></span>
      <h2>{m.dashboard.comingSoonTitle}</h2>
      <p>{m.dashboard.comingSoonText}</p>
    </div>
  );
}

function AutomationSection({ snapshot }: { snapshot: HomeSnapshot }) {
  const { locale, m } = useI18n();
  const demo = m.demo;
  const icons = [Sunset, House, Moon];
  return <section className="automation-layout"><div className="surface-panel automation-list"><div className="panel-intro"><span className="panel-overline">{demo.automationsOverline}</span><h2>{demo.automationsTitle}</h2><p>{demo.automationsSubtitle}</p></div>{demo.automations.map(([name, detail, destination], index) => { const Icon = icons[index]; return <div className="automation-row" key={name}><span className="automation-icon"><Icon size={18} /></span><span className="automation-copy"><strong>{name}</strong><small>{detail}</small><span className="automation-destination">{destination}</span></span><span className="automation-enabled"><span />{demo.automationOn}</span></div>; })}<button className="add-automation" type="button"><Plus size={16} />{demo.createRoutine}</button></div><aside className="automation-aside"><span className="automation-aside-icon"><Sun size={21} /></span><h3>{demo.automationAsideTitle}</h3><p>{demo.automationAsideText}</p><div className="automation-aside-foot"><span className="status-pulse" />{demo.activeRoutines(formatNumber(snapshot.automations.length, locale))}</div></aside></section>;
}

function EnergySection({ snapshot }: { snapshot: HomeSnapshot }) {
  const { locale, m } = useI18n();
  const demo = m.demo;
  const energy = snapshot.energy;
  return <section className="energy-layout"><div className="surface-panel energy-main"><div className="energy-headline"><div><span className="panel-overline">{demo.energyOverline}</span><h2>{demo.energyTitle[0]}<br /><span>{demo.energyTitle[1]}</span></h2></div><span className="energy-badge"><Leaf size={15} />{demo.energyBadge}</span></div><div className="energy-total"><strong>{formatNumber(energy.todayKwh, locale, 1)}</strong><span>kWh</span><small>{demo.energyVsYesterday}<ArrowDownRight size={15} /></small></div><EnergyChart points={energy.points} label={demo.energyChart} /><div className="energy-axis">{demo.energyAxis.map((label) => <span key={label}>{label}</span>)}</div><div className="energy-footnote"><span><span className="energy-legend-dot" />{demo.homeConsumption}</span><span>{demo.updatedNow}</span></div></div><aside className="energy-aside"><div className="energy-aside-block"><span className="metric-symbol energy-symbol"><Zap size={17} /></span><span className="metric-label">{demo.rightNow}</span><strong>{formatNumber(energy.currentWatts, locale)}<small> W</small></strong><span className="metric-foot positive"><span className="metric-dot" />{demo.belowAverage}</span></div><div className="energy-aside-block"><span className="metric-symbol climate-symbol"><Sun size={17} /></span><span className="metric-label">{demo.solar}</span><strong>{formatNumber(1.8, locale, 1)}<small> kWh</small></strong><span className="metric-foot">{demo.solarShare}</span></div><div className="energy-note"><Check size={15} />{demo.routineSaved}</div></aside></section>;
}

function EnergyChart({ points, label }: { points: number[]; label: string }) {
  const line = points.map((point, index) => `${index ? "L" : "M"} ${index * (480 / (points.length - 1))} ${152 - point * 2.35}`).join(" ");
  return <svg className="energy-chart" viewBox="0 0 480 170" role="img" aria-label={label} preserveAspectRatio="none"><defs><linearGradient id="energy-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs><path className="chart-grid-line" d="M0 32 H480 M0 76 H480 M0 120 H480 M0 164 H480" /><path d={`${line} L480 170 L0 170 Z`} fill="url(#energy-gradient)" /><path className="energy-chart-line" d={line} /><circle cx="480" cy={152 - points.at(-1)! * 2.35} r="4.5" className="chart-current-dot" /></svg>;
}

function SecuritySection({ onNavigate }: { onNavigate: Props["onNavigate"] }) {
  const { m } = useI18n();
  const demo = m.demo;
  const icons = [LockKeyhole, House, ShieldHalf, Camera];
  return <section className="security-layout"><div className="security-banner"><div className="security-banner-icon"><ShieldCheck size={26} /></div><div><span className="panel-overline">{demo.securityOverline}</span><h2>{demo.securityTitle}</h2><p>{demo.securityText}</p></div><span className="security-banner-badge"><span className="status-pulse" />{demo.allSecure}</span></div><div className="surface-panel security-checklist"><div className="section-heading"><div><h2>{demo.securityChecklist}<span className="check-count">4 / 4</span></h2><p>{demo.lastChecked}</p></div></div>{demo.securityRows.map(([name, detail], index) => { const Icon = icons[index]; return <button type="button" key={name} className="security-row" onClick={() => index === 3 && onNavigate("cameras")}><span className="security-device-icon"><Icon size={18} /></span><span className="security-device-copy"><strong>{name}</strong><small>{detail}</small></span><CircleCheck className="security-check-icon" size={19} /></button>; })}</div><div className="security-footnote"><span className="status-pulse" />{demo.monitored}<span>·</span>{demo.alertsOn}</div></section>;
}

function CameraSection() {
  const { m } = useI18n();
  const demo = m.demo;
  const tile = (index: number, className: string, imageClass: string) => (
    <article className={`camera-tile ${className}`}><div className={`camera-image ${imageClass}`} /><div className="camera-scrim" /><span className="camera-top"><span className="camera-recording"><span />REC</span><span className="camera-live-label"><span />{demo.cameraLive}</span></span><div className="camera-bottom"><span><Camera size={15} />{demo.cameras[index][0]}</span><small>{demo.cameras[index][1]}</small></div></article>
  );
  return <section className="camera-grid">{tile(0, "camera-entry", "camera-image-entry")}{tile(1, "camera-garden", "camera-image-garden")}<div className="camera-status-card"><span className="camera-health-icon"><CircleCheck size={18} /></span><strong>{demo.allInView}</strong><p>{demo.camerasOnline}</p><span><span className="status-pulse" />{demo.camerasCount}</span></div></section>;
}

function SettingsSection({ demo, property }: { demo: boolean; property: Property }) {
  const { locale, m, calendar, temperatureUnit, setPreferences } = useI18n();
  const t = m.settings;
  const choice = <T extends string>(label: string, options: readonly T[], value: T, name: (option: T) => string, onPick: (option: T) => void) => (
    <section className="segmented-section">
      <span className="panel-overline">{label}</span>
      <div className="segmented-control" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={value === option} className={value === option ? "selected" : ""} onClick={() => value !== option && onPick(option)}>{name(option)}</button>
        ))}
      </div>
    </section>
  );
  return (
    <section className="settings-layout">
      <div className="surface-panel settings-preferences">
        <div className="panel-intro"><span className="panel-overline">{m.nav.settings}</span><h2>{t.title}</h2><p>{demo ? t.demoSubtitle : t.subtitle}</p></div>
        {choice(t.language, languages, locale, (option) => messages[option].meta.languageName, (language) => setPreferences({ language }))}
        {choice(t.calendar, calendars, calendar, (option) => t.calendars[option], (next) => setPreferences({ calendar: next }))}
        {choice(t.temperature, temperatureUnits, temperatureUnit, (option) => t.temperatureUnits[option], (next) => setPreferences({ temperatureUnit: next }))}
        <p className="settings-preview">{t.today(formatDate(new Date(), locale, calendar, homeTimeZone(property)))}</p>
        <p className="form-note">{t.timeNote}</p>
        <p className="form-note">{t.moreSoon}</p>
      </div>
      <aside className="settings-aside"><span className="m2-mark small-mark">M2</span><span className="panel-overline">M2SMART HOME</span><strong>{m.dashboard.settingsAside}</strong><small>{m.dashboard.version}</small></aside>
    </section>
  );
}
