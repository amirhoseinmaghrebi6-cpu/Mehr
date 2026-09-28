"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowLeft,
  BedDouble,
  Building2,
  Camera,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  CloudSun,
  DoorOpen,
  Film,
  House,
  Leaf,
  LockKeyhole,
  Moon,
  Plus,
  Pencil,
  ShieldCheck,
  ShieldHalf,
  Sunrise,
  Sun,
  Sunset,
  Thermometer,
  Trash2,
  Utensils,
  Wifi,
  X,
  Wind,
  Zap,
} from "lucide-react";
import { DeviceControl } from "@/components/device-control";
import { translate, type Locale } from "@/lib/i18n";
import type { Automation, Device, HomeSnapshot, Room } from "@/services/mock-home-service";

export type DashboardSection = "overview" | "rooms" | "devices" | "scenes" | "automations" | "energy" | "security" | "cameras" | "notifications" | "settings";

type Props = {
  snapshot: HomeSnapshot;
  locale: Locale;
  section: DashboardSection;
  propertyName: string;
  propertyImage: string;
  propertyOnline: boolean;
  displayName: string;
  deviceStates: Record<string, boolean>;
  deviceValues: Record<string, number>;
  activeScene: string | null;
  query: string;
  onToggleDevice: (id: string) => void;
  onOpenDevice: (device: Device) => void;
  onActivateScene: (id: string) => void;
  onNavigate: (section: DashboardSection) => void;
  onClearSearch: () => void;
  onAddRoom: () => void;
  onEditRoom: (room: Room) => void;
  onAddDevice: () => void;
  onRemoveDevice: (device: Device) => void;
  onCreateAutomation: (automation: Automation) => void;
  onToggleAutomation: (id: string) => void;
};

const sectionCopy = {
  overview: { en: "A thoughtful look at how your home is feeling.", fa: "نگاهی هوشمند به حال‌وهوای خانه‌ی شما." },
  rooms: { en: "Spaces that move with the rhythm of your day.", fa: "فضاهایی هماهنگ با جریان روز شما." },
  devices: { en: "Every little thing, exactly where you need it.", fa: "تمام دستگاه‌ها، دقیقاً همان‌جایی که نیاز دارید." },
  scenes: { en: "The right feeling, already thought through.", fa: "حال‌وهوای دلخواه شما، از پیش آماده است." },
  automations: { en: "Thoughtful routines that take care of the details.", fa: "روال‌های هوشمندی که به جزئیات توجه می‌کنند." },
  energy: { en: "A clearer picture of the energy your home uses.", fa: "تصویری روشن‌تر از انرژی مصرفی خانه." },
  security: { en: "Your home is protected. Everything is in good order.", fa: "خانه محافظت می‌شود و همه‌چیز مرتب است." },
  cameras: { en: "A little reassurance, wherever you are.", fa: "با خیالی آسوده، هرجا که هستید." },
  notifications: { en: "A calm record of what matters at home.", fa: "مروری آرام بر اتفاق‌های مهم خانه." },
  settings: { en: "Make your home feel a little more like yours.", fa: "خانه را کمی بیشتر شبیه خودتان کنید." },
} satisfies Record<DashboardSection, Record<Locale, string>>;

const sceneIcons = { sunrise: Sunrise, film: Film, utensils: Utensils, door: DoorOpen } as const;

export function DashboardView({
  snapshot,
  locale,
  section,
  propertyName,
  propertyImage,
  propertyOnline,
  displayName,
  deviceStates,
  deviceValues,
  activeScene,
  query,
  onToggleDevice,
  onOpenDevice,
  onActivateScene,
  onNavigate,
  onClearSearch,
  onAddRoom,
  onEditRoom,
  onAddDevice,
  onRemoveDevice,
  onCreateAutomation,
  onToggleAutomation,
}: Props) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const isRtl = locale === "fa";
  const title = section === "overview" ? t("commandCenter") : t(section);
  const filteredDevices = snapshot.devices.filter((device) => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return true;
    return `${device.name} ${device.room} ${device.detail}`.toLocaleLowerCase().includes(search);
  });

  if (query.trim() && filteredDevices.length === 0) {
    return (
      <div className="empty-state search-empty" role="status">
        <span className="empty-icon"><Wifi size={23} /></span>
        <h2>{t("noResults")}</h2>
        <p>{isRtl ? `برای «${query}» چیزی پیدا نکردیم.` : `We couldn’t find anything for “${query}”.`}</p>
        <button className="text-action" onClick={onClearSearch} type="button">{isRtl ? "پاک‌کردن جست‌وجو" : "Clear search"}</button>
      </div>
    );
  }

  return (
    <motion.div
      className="page-content"
      key={`${section}-${propertyName}-${locale}`}
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <header className="page-heading">
        <div>
          <div className="eyebrow"><span className={`status-pulse${propertyOnline ? "" : " is-pending"}`} />{propertyName} <span className="eyebrow-divider">/</span> {propertyOnline ? t("homeConnected") : isRtl ? "آماده‌ی راه‌اندازی" : "Setup needed"}</div>
          <h1>{title}</h1>
          <p>{section === "overview" ? t("subtitle") : sectionCopy[section][locale]}</p>
        </div>
        <div className="heading-tools">
          {section === "rooms" && <button type="button" className="workspace-quick-add" onClick={onAddRoom}><Plus size={15} />{isRtl ? "افزودن فضا" : "Add space"}</button>}
          {section === "devices" && <button type="button" className="workspace-quick-add" onClick={onAddDevice}><Plus size={15} />{isRtl ? "افزودن دستگاه" : "Add device"}</button>}
          <div className="heading-weather" aria-label={isRtl ? "هوای تهران، آفتابی، ۲۴ درجه" : "Tehran weather, sunny, 24 degrees"}>
            <span className="weather-icon"><Sun size={23} strokeWidth={1.6} /></span>
            <span><strong>{isRtl ? "۲۴°" : "24°"}</strong><small>{t("outside")}</small></span>
          </div>
        </div>
      </header>

      {query.trim() ? (
        <DeviceCollection
          devices={filteredDevices}
          states={deviceStates}
          values={deviceValues}
          locale={locale}
          onToggle={onToggleDevice}
          onOpen={onOpenDevice}
          onNavigate={onNavigate}
          onRemoveDevice={onRemoveDevice}
          title={isRtl ? "نتایج جست‌وجو" : "Search results"}
        />
      ) : section === "overview" ? (
        <Overview
          snapshot={snapshot}
          locale={locale}
          propertyImage={propertyImage}
          displayName={displayName}
          deviceStates={deviceStates}
          deviceValues={deviceValues}
          activeScene={activeScene}
          onToggleDevice={onToggleDevice}
          onOpenDevice={onOpenDevice}
          onActivateScene={onActivateScene}
          onNavigate={onNavigate}
          onEditRoom={onEditRoom}
        />
      ) : (
        <SectionContent
          section={section}
          snapshot={snapshot}
          locale={locale}
          deviceStates={deviceStates}
          deviceValues={deviceValues}
          activeScene={activeScene}
          onToggleDevice={onToggleDevice}
          onOpenDevice={onOpenDevice}
          onActivateScene={onActivateScene}
          onNavigate={onNavigate}
          onAddRoom={onAddRoom}
          onEditRoom={onEditRoom}
          onAddDevice={onAddDevice}
          onRemoveDevice={onRemoveDevice}
          onCreateAutomation={onCreateAutomation}
          onToggleAutomation={onToggleAutomation}
        />
      )}
    </motion.div>
  );
}

function Overview({ snapshot, locale, propertyImage, displayName, deviceStates, deviceValues, activeScene, onToggleDevice, onOpenDevice, onActivateScene, onNavigate, onEditRoom }: Omit<Props, "section" | "propertyName" | "propertyOnline" | "query" | "onClearSearch" | "onAddRoom" | "onAddDevice" | "onRemoveDevice" | "onCreateAutomation" | "onToggleAutomation">) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const isRtl = locale === "fa";
  const arrow = isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />;
  const featuredRooms = snapshot.rooms;
  const featuredDevices = snapshot.devices.filter((device) => ["climate", "lights", "curtains", "air-quality"].includes(device.id));

  return (
    <>
      <section className="welcome-banner" aria-label={t("homeStatus")}>
        <div className="welcome-photo" style={{ backgroundImage: `url("${propertyImage}")` }} />
        <div className="welcome-wash" />
        <div className="welcome-content">
          <span className="welcome-kicker"><span className="welcome-live-dot" />{t("currently")}</span>
          <h2>{t("greeting")},<br />{displayName.split(/\s+/)[0]}.</h2>
          <p>{t("homeStatusDetail")}</p>
          <div className="welcome-weather"><CloudSun size={16} />{isRtl ? "۲۴° بیرون · حس خوب داخل خانه" : "24° outside · feeling good inside"}</div>
        </div>
        <div className="welcome-status">
          <span className="welcome-status-check"><Check size={15} strokeWidth={2.4} /></span>
          <span><strong>{t("homeStatus")}</strong><small>{isRtl ? "تا این لحظه" : "As of just now"}</small></span>
        </div>
        <div className="welcome-coordinates" aria-hidden="true">35°48′N &nbsp; 51°25′E</div>
      </section>

      <section className="metric-strip" aria-label={isRtl ? "وضعیت خانه" : "Home at a glance"}>
        <article className="metric-item">
          <span className="metric-symbol climate-symbol"><Thermometer size={17} /></span>
          <div className="metric-content"><span className="metric-label">{t("indoorComfort")}</span><strong>22° <small>{locale === "fa" ? "سانتی‌گراد" : "C"}</small></strong><span className="metric-foot"><span className="metric-dot" />{t("ideal")}</span></div>
          <div className="comfort-lines" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        </article>
        <article className="metric-item">
          <span className="metric-symbol energy-symbol"><Zap size={17} /></span>
          <div className="metric-content"><span className="metric-label">{t("energyToday")}</span><strong>{locale === "fa" ? "۸٫۴" : snapshot.energy.todayKwh} <small>kWh</small></strong><span className="metric-foot positive"><ArrowDownRight size={13} />{t("vsYesterday")}</span></div>
          <EnergySparkline points={snapshot.energy.points.slice(8)} />
        </article>
        <article className="metric-item">
          <span className="metric-symbol security-symbol"><ShieldCheck size={17} /></span>
          <div className="metric-content"><span className="metric-label">{t("securityTitle")}</span><strong className="security-value">{t("secured")}</strong><span className="metric-foot"><span className="metric-dot" />{t("lastChecked")}</span></div>
          <div className="security-orbit" aria-hidden="true"><div><LockKeyhole size={17} /></div></div>
        </article>
      </section>

      <section className="content-section rooms-section">
        <SectionHeading title={t("spaces")} detail={isRtl ? "هر فضا، درست همان‌طور که رهایش کرده‌اید." : "Each space, just as you left it."} action={t("seeAllRooms")} onAction={() => onNavigate("rooms")} arrow={arrow} />
        <div className="room-grid">
          {featuredRooms.map((room) => <RoomTile key={room.id} room={room} locale={locale} onClick={() => onNavigate("rooms")} onEdit={onEditRoom} />)}
        </div>
      </section>

      <div className="overview-lower-grid">
        <section className="surface-panel scenes-panel">
          <SectionHeading title={t("scenesTitle")} detail={t("scenesSubtitle")} action={t("viewAll")} onAction={() => onNavigate("scenes")} arrow={arrow} />
          <div className="scene-list">
            {snapshot.scenes.map((scene) => {
              const Icon = sceneIcons[scene.icon as keyof typeof sceneIcons];
              const selected = activeScene === scene.id;
              return (
                <button className={`scene-row${selected ? " scene-selected" : ""}`} key={scene.id} type="button" onClick={() => onActivateScene(scene.id)} aria-pressed={selected}>
                  <span className={`scene-icon scene-icon-${scene.id}`}><Icon size={17} strokeWidth={1.8} /></span>
                  <span className="scene-copy"><strong>{locale === "fa" ? sceneNameFa(scene.id) : scene.name}</strong><small>{locale === "fa" ? sceneDetailFa(scene.id) : scene.detail}</small></span>
                  <span className="scene-trigger">{selected ? <CircleCheck size={19} /> : <ChevronRight size={17} />}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="surface-panel devices-panel">
          <SectionHeading title={t("devicesTitle")} detail={t("devicesSubtitle")} action={t("allDevices")} onAction={() => onNavigate("devices")} arrow={arrow} />
          <div className="device-list">
            {featuredDevices.map((device) => <DeviceControl key={device.id} device={localizedDevice(device, locale, deviceValues)} isOn={deviceStates[device.id] ?? device.initialState} locale={locale} onToggle={onToggleDevice} onOpen={onOpenDevice} />)}
          </div>
        </section>
      </div>
      <div className="last-updated"><span className="status-pulse" />{t("onlineStatus")}<span className="updated-divider">·</span>{isRtl ? "همین حالا همگام شد" : "Synced moments ago"}</div>
    </>
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

function RoomTile({ room, locale, onClick, onEdit }: { room: Room; locale: Locale; onClick: () => void; onEdit?: (room: Room) => void }) {
  const defaultRoomNames: Record<string, string> = { living: "پذیرایی", kitchen: "آشپزخانه", bedroom: "اتاق خواب اصلی", terrace: "تراس باغ" };
  const name = locale === "fa" ? defaultRoomNames[room.id] ?? room.name : room.name;
  const roomLabel = locale === "fa" ? `${toPersian(room.activeDevices)} دستگاه فعال` : `${room.activeDevices} devices active`;
  return (
    <div className="room-card-wrap">
      <motion.button className={`room-tile room-tile-${room.id}`} type="button" onClick={onClick} whileHover={{ y: -3 }} transition={{ duration: 0.18 }}>
        <span className="room-image" style={{ backgroundImage: `url("${room.image}")`, backgroundPosition: room.imagePosition }} />
        <span className="room-overlay" />
        <span className="room-topline"><span><span className="room-live-dot" />{locale === "fa" ? "در حال استفاده" : "IN USE"}</span><span className="room-temp"><Thermometer size={13} />{locale === "fa" ? `${toPersian(room.temperature)}°` : `${room.temperature}°`}</span></span>
        <span className="room-bottomline"><span><strong>{name}</strong><small>{roomLabel}</small></span><span className="room-arrow"><ChevronRight size={17} /></span></span>
      </motion.button>
      {onEdit && <button type="button" className="room-edit-button" onClick={() => onEdit(room)} aria-label={locale === "fa" ? `ویرایش ${name}` : `Edit ${name}`}><Pencil size={14} /></button>}
    </div>
  );
}

function EnergySparkline({ points }: { points: number[] }) {
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${(index / (points.length - 1)) * 100} ${45 - point * 0.62}`).join(" ");
  return <svg className="energy-sparkline" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true"><path d={`${path} L 100 50 L 0 50 Z`} className="sparkline-fill" /><path d={path} className="sparkline-line" /></svg>;
}

function DeviceCollection({ devices, states, values, locale, onToggle, onOpen, onNavigate, onRemoveDevice, title }: { devices: Device[]; states: Record<string, boolean>; values: Record<string, number>; locale: Locale; onToggle: Props["onToggleDevice"]; onOpen: Props["onOpenDevice"]; onNavigate: Props["onNavigate"]; onRemoveDevice: Props["onRemoveDevice"]; title: string }) {
  const isRtl = locale === "fa";
  return (
    <section className="collection-section">
      <SectionHeading title={title} detail={isRtl ? "وضعیت دستگاه‌ها به‌صورت زنده به‌روز می‌شود." : "Device states are updated as they happen."} action={isRtl ? "مشاهده‌ی فضاها" : "Browse rooms"} onAction={() => onNavigate("rooms")} arrow={isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />} />
      <div className="collection-device-grid">{devices.map((device) => <div className="device-management-row" key={device.id}><DeviceControl showRoom device={localizedDevice(device, locale, values)} isOn={states[device.id] ?? device.initialState} locale={locale} onToggle={onToggle} onOpen={onOpen} /><button type="button" className="device-remove-button" onClick={() => onRemoveDevice(device)} aria-label={locale === "fa" ? `حذف ${device.name}` : `Remove ${device.name}`}><Trash2 size={15} /></button></div>)}</div>
    </section>
  );
}

function SectionContent({ section, snapshot, locale, deviceStates, deviceValues, activeScene, onToggleDevice, onOpenDevice, onActivateScene, onNavigate, onAddRoom, onEditRoom, onRemoveDevice, onCreateAutomation, onToggleAutomation }: Omit<Props, "propertyName" | "propertyImage" | "propertyOnline" | "displayName" | "query" | "onClearSearch">) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const isRtl = locale === "fa";

  if (section === "rooms") {
    return <section className="collection-section"><div className="room-grid collection-room-grid">{snapshot.rooms.map((room) => <RoomTile key={room.id} room={room} locale={locale} onClick={() => onNavigate("devices")} onEdit={onEditRoom} />)}</div>{snapshot.rooms.length === 0 && <div className="workspace-empty"><Building2 size={21} /><strong>{isRtl ? "هنوز فضایی نساخته‌اید" : "A place for everything"}<small>{isRtl ? "اولین فضای خانه را اضافه کنید." : "Add your first room to get started."}</small></strong><button type="button" className="workspace-quick-add" onClick={onAddRoom}><Plus size={15} />{isRtl ? "افزودن فضا" : "Add space"}</button></div>}<RoomDetails rooms={snapshot.rooms} locale={locale} onNavigate={onNavigate} /></section>;
  }

  if (section === "devices") {
    return <DeviceCollection devices={snapshot.devices} states={deviceStates} values={deviceValues} locale={locale} onToggle={onToggleDevice} onOpen={onOpenDevice} onNavigate={onNavigate} onRemoveDevice={onRemoveDevice} title={isRtl ? "تمام دستگاه‌ها" : "Every device, in its place"} />;
  }

  if (section === "scenes") {
    return <section className="collection-section"><div className="scene-card-grid">{snapshot.scenes.map((scene) => {
      const Icon = sceneIcons[scene.icon as keyof typeof sceneIcons];
      const selected = activeScene === scene.id;
      return <button className={`large-scene-card${selected ? " scene-selected" : ""}`} type="button" onClick={() => onActivateScene(scene.id)} key={scene.id} aria-pressed={selected}><span className={`large-scene-icon scene-icon-${scene.id}`}><Icon size={22} /></span><strong>{isRtl ? sceneNameFa(scene.id) : scene.name}</strong><span>{isRtl ? sceneDetailFa(scene.id) : scene.detail}</span><span className="large-scene-action">{selected ? <CircleCheck size={20} /> : <ChevronRight size={19} />}</span></button>;
    })}<button className="large-scene-card new-scene-card" type="button" onClick={() => onActivateScene("custom")}><span className="large-scene-icon"><Plus size={21} /></span><strong>{t("newScene")}</strong><span>{isRtl ? "خانه را به روش خودتان تنظیم کنید" : "Create a feeling all your own"}</span><span className="large-scene-action"><Plus size={18} /></span></button></div></section>;
  }

  if (section === "automations") {
    return <AutomationSection snapshot={snapshot} locale={locale} onCreate={onCreateAutomation} onToggle={onToggleAutomation} />;
  }

  if (section === "energy") {
    return <EnergySection snapshot={snapshot} locale={locale} />;
  }

  if (section === "security") {
    return <SecuritySection locale={locale} onNavigate={onNavigate} />;
  }

  if (section === "cameras") {
    return <CameraSection locale={locale} />;
  }

  if (section === "notifications") {
    return <div className="quiet-panel"><span className="quiet-icon"><CircleCheck size={26} strokeWidth={1.6} /></span><h2>{t("notificationsTitle")}</h2><p>{t("notificationsCopy")}</p><span className="quiet-meta"><Clock3 size={14} />{isRtl ? "همه‌چیز به‌روز است" : "You’re all caught up"}</span></div>;
  }

  if (section === "settings") {
    return <SettingsSection locale={locale} />;
  }

  return null;
}

function RoomDetails({ rooms, locale, onNavigate }: { rooms: Room[]; locale: Locale; onNavigate: Props["onNavigate"] }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const icons = [House, Utensils, BedDouble, Sunset];
  const names: Record<string, string> = { living: t("livingRoom"), kitchen: t("kitchen"), bedroom: t("bedroom"), terrace: t("terrace") };

  return (
    <div className="room-detail-list">
      {rooms.map((room, index) => {
        const Icon = icons[index % icons.length];
        return (
          <button className="room-detail-row" key={room.id} type="button" onClick={() => onNavigate("devices")}>
            <span className={`room-mini-icon room-mini-${room.id}`}><Icon size={17} /></span>
            <span className="room-detail-copy">
              <strong>{locale === "fa" ? names[room.id] ?? room.name : room.name}</strong>
              <small>{locale === "fa" ? `${toPersian(room.activeDevices)} دستگاه · ${toPersian(room.humidity)}٪ رطوبت` : `${room.activeDevices} devices · ${room.humidity}% humidity`}</small>
            </span>
            <span className="room-detail-temp">{locale === "fa" ? toPersian(room.temperature) : room.temperature}°</span>
            <ChevronRight size={16} />
          </button>
        );
      })}
    </div>
  );
}

function AutomationSection({ snapshot, locale, onCreate, onToggle }: { snapshot: HomeSnapshot; locale: Locale; onCreate: (automation: Automation) => void; onToggle: (id: string) => void }) {
  const isRtl = locale === "fa";
  const [builderOpen, setBuilderOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<"time" | "sunset" | "motion">("time");
  const [time, setTime] = useState("19:00");
  const [deviceId, setDeviceId] = useState(snapshot.devices.find((device) => device.kind !== "lock")?.id ?? "");
  const [turnOn, setTurnOn] = useState(true);
  const namesFa = ["غروب دلنشین", "خوش‌آمدگویی", "آرامش شب"];
  const descriptionsFa = ["هر روز، هنگام غروب آفتاب", "با رسیدن امیر به خانه", "هر شب، ساعت ۱۰:۳۰"];
  const destinationsFa = ["چراغ‌های مسیر باغ", "ورودی و تهویه", "تمام خانه"];
  const devices = snapshot.devices.filter((device) => device.kind !== "lock");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const device = devices.find((item) => item.id === deviceId);
    if (!name.trim() || !device) return;
    const detail = trigger === "time"
      ? isRtl ? `هر روز ساعت ${toPersianTime(time)}` : `Every day at ${time}`
      : trigger === "sunset"
        ? isRtl ? "هر روز هنگام غروب آفتاب" : "Every day at sunset"
        : isRtl ? "هنگام تشخیص حرکت" : "When motion is detected";
    const action = isRtl ? (turnOn ? "روشن شود" : "خاموش شود") : (turnOn ? "Turn on" : "Turn off");
    onCreate({
      id: `routine-${crypto.randomUUID()}`,
      name: name.trim(),
      detail,
      destination: `${localizedDevice(device, locale, {}).name} · ${action}`,
      enabled: true,
      icon: "zap",
      trigger: trigger === "time"
        ? { type: "time", time, recurrence: "daily" }
        : trigger === "sunset"
          ? { type: "sunset" }
          : { type: "motion" },
      actions: [{ type: "device", deviceId: device.id, command: turnOn ? "on" : "off" }],
    });
    setName("");
    setBuilderOpen(false);
  };

  return (
    <>
      <section className="automation-layout">
        <div className="surface-panel automation-list">
          <div className="panel-intro">
            <span className="panel-overline">{isRtl ? "روال‌های هوشمند شما" : "YOUR HOME, ON AUTOPILOT"}</span>
            <h2>{isRtl ? "جزئیات، خودش رسیدگی می‌شود." : "The details, taken care of."}</h2>
            <p>{translate(locale, "automationSubtitle")}</p>
          </div>
          {snapshot.automations.map((automation, index) => {
            const Icon = automation.icon === "sunset" ? Sunset : automation.icon === "house" ? House : automation.icon === "moon" ? Moon : Zap;
            const nameFa = automation.icon === "zap" ? automation.name : namesFa[index] ?? automation.name;
            const detailFa = automation.icon === "zap" ? automation.detail : descriptionsFa[index] ?? automation.detail;
            const destinationFa = automation.icon === "zap" ? automation.destination : destinationsFa[index] ?? automation.destination;
            return (
              <div className="automation-row" key={automation.id}>
                <span className="automation-icon"><Icon size={18} /></span>
                <span className="automation-copy">
                  <strong>{isRtl ? nameFa : automation.name}</strong>
                  <small>{isRtl ? detailFa : automation.detail}</small>
                  <span className="automation-destination">{isRtl ? destinationFa : automation.destination}</span>
                </span>
                <span className={`automation-enabled${automation.enabled ? "" : " is-paused"}`}>
                  <span />{isRtl ? (automation.enabled ? "فعال" : "متوقف") : (automation.enabled ? "On" : "Paused")}
                </span>
                <button
                  type="button"
                  className={`automation-switch${automation.enabled ? " is-enabled" : ""}`}
                  role="switch"
                  aria-checked={automation.enabled}
                  aria-label={isRtl ? `${nameFa} ${automation.enabled ? "فعال" : "متوقف"}` : `${automation.name} ${automation.enabled ? "enabled" : "paused"}`}
                  onClick={() => onToggle(automation.id)}
                ><span /></button>
              </div>
            );
          })}
          <button className="add-automation" type="button" onClick={() => setBuilderOpen(true)}>
            <Plus size={16} />{isRtl ? "ساخت روال جدید" : "Create a routine"}
          </button>
        </div>
        <aside className="automation-aside">
          <span className="automation-aside-icon"><Sun size={21} /></span>
          <h3>{isRtl ? "کمتر فکر کنید. بیشتر زندگی کنید." : "Think about it less."}</h3>
          <p>{isRtl ? "خانه هر روز تا غروب، چراغ‌های باغ را خودکار روشن می‌کند." : "Your garden path lights come on every evening, just as daylight fades."}</p>
          <div className="automation-aside-foot"><span className="status-pulse" />{toLocalizedNumber(snapshot.automations.filter((automation) => automation.enabled).length, locale)} {translate(locale, "activeAutomations")}</div>
        </aside>
      </section>
      {builderOpen && (
        <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setBuilderOpen(false)}>
          <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-dialog-title" dir={isRtl ? "rtl" : "ltr"}>
            <button type="button" className="dialog-close" onClick={() => setBuilderOpen(false)} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
            <span className="workspace-dialog-icon"><Zap size={19} /></span>
            <span className="panel-overline">{isRtl ? "خودکارسازی خانه" : "HOME AUTOMATION"}</span>
            <h2 id="automation-dialog-title">{isRtl ? "ساخت روال جدید" : "Create a routine"}</h2>
            <p className="workspace-dialog-description">{isRtl ? "یک زمان یا رویداد را به یک اقدام ساده وصل کنید." : "Connect a time or event to a simple device action."}</p>
            <form className="workspace-form" onSubmit={submit}>
              <label className="form-field"><span>{isRtl ? "نام روال" : "Routine name"}</span><input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={isRtl ? "مثلاً چراغ‌های عصرگاهی" : "e.g. Evening lights"} /></label>
              <label className="form-field"><span>{isRtl ? "هنگام" : "When"}</span><select value={trigger} onChange={(event) => setTrigger(event.target.value as typeof trigger)}><option value="time">{isRtl ? "هر روز در ساعت مشخص" : "Every day at a time"}</option><option value="sunset">{isRtl ? "هنگام غروب آفتاب" : "At sunset"}</option><option value="motion">{isRtl ? "تشخیص حرکت" : "Motion detected"}</option></select></label>
              {trigger === "time" && <label className="form-field"><span>{isRtl ? "ساعت" : "Time"}</span><input type="time" required value={time} onChange={(event) => setTime(event.target.value)} /></label>}
              <div className="form-two-columns">
                <label className="form-field"><span>{isRtl ? "دستگاه" : "Device"}</span><select required value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>{devices.map((device) => <option key={device.id} value={device.id}>{localizedDevice(device, locale, {}).name}</option>)}</select></label>
                <label className="form-field"><span>{isRtl ? "اقدام" : "Action"}</span><select value={turnOn ? "on" : "off"} onChange={(event) => setTurnOn(event.target.value === "on")}><option value="on">{isRtl ? "روشن کردن" : "Turn on"}</option><option value="off">{isRtl ? "خاموش کردن" : "Turn off"}</option></select></label>
              </div>
              <div className="workspace-form-actions"><button type="button" className="button-subtle" onClick={() => setBuilderOpen(false)}>{isRtl ? "انصراف" : "Cancel"}</button><button type="submit" className="button-primary" disabled={!devices.length}><Plus size={15} />{isRtl ? "ذخیره‌ی روال" : "Save routine"}</button></div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function EnergySection({ snapshot, locale }: { snapshot: HomeSnapshot; locale: Locale }) {
  const isRtl = locale === "fa";
  const energy = snapshot.energy;
  return <section className="energy-layout"><div className="surface-panel energy-main"><div className="energy-headline"><div><span className="panel-overline">{isRtl ? "امروز · ویلای تهران" : "TODAY · TEHRAN VILLA"}</span><h2>{isRtl ? "خانه‌ای هوشمندتر،" : "A lighter footprint,"}<br /><span>{isRtl ? "مصرفی سبک‌تر." : "without thinking twice."}</span></h2></div><span className="energy-badge"><Leaf size={15} />{isRtl ? "۱۲٪ کمتر" : "12% less"}</span></div><div className="energy-total"><strong>{isRtl ? "۸٫۴" : energy.todayKwh}</strong><span>kWh</span><small>{isRtl ? "در مقایسه با دیروز کمتر" : "12% lower than yesterday"}<ArrowDownRight size={15} /></small></div><EnergyChart points={energy.points} locale={locale} /><div className="energy-axis"><span>{isRtl ? "۱۲ صبح" : "12 am"}</span><span>{isRtl ? "۶ صبح" : "6 am"}</span><span>{isRtl ? "۱۲ ظهر" : "12 pm"}</span><span>{isRtl ? "۶ عصر" : "6 pm"}</span><span>{isRtl ? "اکنون" : "Now"}</span></div><div className="energy-footnote"><span><span className="energy-legend-dot" />{isRtl ? "مصرف خانه" : "Home consumption"}</span><span>{isRtl ? "آخرین بررسی همین حالا" : "Updated just now"}</span></div></div><aside className="energy-aside"><div className="energy-aside-block"><span className="metric-symbol energy-symbol"><Zap size={17} /></span><span className="metric-label">{isRtl ? "مصرف همین لحظه" : "Right now"}</span><strong>{isRtl ? toPersian(energy.currentWatts) : energy.currentWatts}<small> W</small></strong><span className="metric-foot positive"><span className="metric-dot" />{isRtl ? "کمتر از میانگین خانه" : "Below your home average"}</span></div><div className="energy-aside-block"><span className="metric-symbol climate-symbol"><Sun size={17} /></span><span className="metric-label">{isRtl ? "تولید خورشیدی" : "Solar production"}</span><strong>{isRtl ? "۱٫۸" : "1.8"}<small> kWh</small></strong><span className="metric-foot">{isRtl ? "۲۱٪ نیاز امروز خانه" : "21% of today's home use"}</span></div><div className="energy-note"><Check size={15} />{isRtl ? "روال عصرگاهی ۰٫۶ کیلووات‌ساعت صرفه‌جویی کرد." : "Your evening routine saved 0.6 kWh."}</div></aside></section>;
}

function EnergyChart({ points, locale }: { points: number[]; locale: Locale }) {
  const line = points.map((point, index) => `${index ? "L" : "M"} ${index * (480 / (points.length - 1))} ${152 - point * 2.35}`).join(" ");
  return <svg className="energy-chart" viewBox="0 0 480 170" role="img" aria-label={locale === "fa" ? "نمودار مصرف انرژی امروز" : "Today's energy consumption chart"} preserveAspectRatio="none"><defs><linearGradient id="energy-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs><path className="chart-grid-line" d="M0 32 H480 M0 76 H480 M0 120 H480 M0 164 H480" /><path d={`${line} L480 170 L0 170 Z`} fill="url(#energy-gradient)" /><path className="energy-chart-line" d={line} /><circle cx="480" cy={152 - points.at(-1)! * 2.35} r="4.5" className="chart-current-dot" /></svg>;
}

function SecuritySection({ locale, onNavigate }: { locale: Locale; onNavigate: Props["onNavigate"] }) {
  const isRtl = locale === "fa";
  const rows = isRtl ? [["قفل ورودی اصلی", "قفل است · ۳ دقیقه پیش"], ["پنجره‌ی اتاق خواب", "بسته است · همین حالا"], ["حسگرهای حرکتی", "۳ از ۳ متصل"], ["دوربین ورودی", "در حال ضبط · بدون رویداد"]] : [["Front entry deadbolt", "Secured · 3 min ago"], ["Primary suite window", "Closed · just now"], ["Motion sensors", "3 of 3 connected"], ["Entry camera", "Recording · no events"]];
  const icons = [LockKeyhole, House, ShieldHalf, Camera];
  return <section className="security-layout"><div className="security-banner"><div className="security-banner-icon"><ShieldCheck size={26} /></div><div><span className="panel-overline">{isRtl ? "وضعیت امنیت خانه" : "HOME SECURITY STATUS"}</span><h2>{isRtl ? "در امان و آرام." : "Safe, and sound."}</h2><p>{translate(locale, "secureDescription")}</p></div><span className="security-banner-badge"><span className="status-pulse" />{isRtl ? "تماماً امن" : "All secure"}</span></div><div className="surface-panel security-checklist"><div className="section-heading"><div><h2>{isRtl ? "همه‌چیز مرتب است" : "Everything is in its place"}<span className="check-count">4 / 4</span></h2><p>{isRtl ? "آخرین بررسی همین لحظه" : "Last checked just now"}</p></div></div>{rows.map(([name, detail], index) => { const Icon = icons[index]; return <button type="button" key={name} className="security-row" onClick={() => index === 3 && onNavigate("cameras")}><span className="security-device-icon"><Icon size={18} /></span><span className="security-device-copy"><strong>{name}</strong><small>{detail}</small></span><CircleCheck className="security-check-icon" size={19} /></button>; })}</div><div className="security-footnote"><span className="status-pulse" />{isRtl ? "خانه در حالت نظارت است" : "Your home is being monitored"}<span>·</span>{isRtl ? "اعلان‌ها فعال هستند" : "Alerts are on"}</div></section>;
}

function CameraSection({ locale }: { locale: Locale }) {
  const isRtl = locale === "fa";
  return <section className="camera-grid"><article className="camera-tile camera-entry"><div className="camera-image camera-image-entry" /><div className="camera-scrim" /><span className="camera-top"><span className="camera-recording"><span />REC</span><span className="camera-live-label"><span />{translate(locale, "cameraLive")}</span></span><div className="camera-bottom"><span><Camera size={15} />{isRtl ? "ورودی اصلی" : "Front entry"}</span><small>{isRtl ? "دوربین حیاط" : "Entry camera"}</small></div></article><article className="camera-tile camera-garden"><div className="camera-image camera-image-garden" /><div className="camera-scrim" /><span className="camera-top"><span className="camera-recording"><span />REC</span><span className="camera-live-label"><span />{translate(locale, "cameraLive")}</span></span><div className="camera-bottom"><span><Camera size={15} />{isRtl ? "تراس باغ" : "Garden terrace"}</span><small>{isRtl ? "دوربین بیرونی" : "Outdoor camera"}</small></div></article><div className="camera-status-card"><span className="camera-health-icon"><CircleCheck size={18} /></span><strong>{isRtl ? "همه‌چیز روشن است." : "All in view."}</strong><p>{isRtl ? "۲ دوربین از ۲ دوربین آماده هستند." : "Both cameras are online and recording."}</p><span><span className="status-pulse" />2 / 2 {isRtl ? "متصل" : "cameras online"}</span></div></section>;
}

function SettingsSection({ locale }: { locale: Locale }) {
  const isRtl = locale === "fa";
  const labels = isRtl ? ["حساب و پروفایل", "امنیت و ورود", "اعلان‌ها", "زبان و منطقه", "پوسته و دسترس‌پذیری", "خانه‌ها و اعضا"] : ["Account & profile", "Security & sign-in", "Notifications", "Language & region", "Appearance & accessibility", "Homes & members"];
  const descriptions = isRtl ? ["نام، ایمیل و اطلاعات حساب", "رمز عبور، نشست‌ها و ورود دومرحله‌ای", "کانال‌ها و اولویت‌های اعلان", "زبان، منطقه‌ی زمانی و تقویم", "پوسته، رنگ و اندازه‌ی نمایش", "خانه‌های متصل و دسترسی اعضا"] : ["Your name, email and account details", "Password, sessions and two-factor sign-in", "Channels and notification preferences", "Language, timezone and calendar", "Theme, color and display density", "Connected homes and member access"];
  const icons = [House, LockKeyhole, Wifi, Sun, Wind, BedDouble];
  return <section className="settings-layout"><div className="surface-panel settings-list">{labels.map((label, index) => { const Icon = icons[index]; return <button className="settings-row" key={label} type="button"><span className="settings-icon"><Icon size={18} /></span><span className="settings-copy"><strong>{label}</strong><small>{descriptions[index]}</small></span><ChevronRight size={17} /></button>; })}</div><aside className="settings-aside"><span className="m2-mark small-mark">M2</span><span className="panel-overline">M2SMART HOME</span><strong>{isRtl ? "خانه‌ای برای زندگی." : "A little more at home."}</strong><small>{isRtl ? "نسخه‌ی ۱٫۰ · به‌روز" : "Version 1.0 · Up to date"}</small></aside></section>;
}

function localizedDevice(device: Device, locale: Locale, values: Record<string, number>): Device {
  const value = values[device.id] ?? device.value;
  if (locale === "en") {
    if (device.kind === "climate" && value !== undefined) return { ...device, detail: `${value}°C · Auto` };
    if (device.kind === "light" && value !== undefined) return { ...device, detail: `Warm white · ${value}%` };
    if (device.kind === "curtain" && value !== undefined) return { ...device, detail: `${value === 0 ? "Closed" : "Open"} · ${value}%` };
    return device;
  }
  const details: Record<string, string> = {
    climate: `${toPersian(value ?? 22)}° · خودکار`,
    lights: `نور گرم · ${toPersian(value ?? 68)}٪`,
    curtains: `${value === 0 ? "بسته" : "باز"} · ${toPersian(value ?? 75)}٪`,
    "entry-lock": "قفل شب‌بند ایمن است",
    "air-quality": "عالی · ۱۸ میکروگرم/متر³",
    coffee: "هر وقت بخواهید آماده است",
    "garden-lights": "نور ملایم · ۴۰٪",
    window: "حسگر · بسته",
  };
  const names: Record<string, string> = {
    climate: "تهویه‌ی هوشمند",
    lights: "چراغ‌های آویز",
    curtains: "پرده‌های حریر",
    "entry-lock": "در ورودی",
    "air-quality": "کیفیت هوا",
    coffee: "قهوه‌ساز",
    "garden-lights": "چراغ‌های مسیر",
    window: "پنجره‌ی اتاق خواب",
  };
  return { ...device, name: names[device.id] ?? device.name, detail: details[device.id] ?? device.detail };
}

function sceneNameFa(id: string): string {
  return ({ morning: "صبح بخیر", movie: "تماشای فیلم", dinner: "شام", away: "بیرون از خانه" })[id] ?? id;
}

function sceneDetailFa(id: string): string {
  return ({ morning: "چراغ‌ها روشن · پرده‌ها باز", movie: "چراغ‌ها کم‌نور · پرده‌ها بسته", dinner: "نور گرم · موسیقی روشن", away: "خانه امن · مصرف کمتر" })[id] ?? "";
}

function toPersian(value: number): string {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(value);
}

function toLocalizedNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(value);
}

function toPersianTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  return `${new Intl.NumberFormat("fa-IR", { minimumIntegerDigits: 2 }).format(hours)}:${new Intl.NumberFormat("fa-IR", { minimumIntegerDigits: 2 }).format(minutes)}`;
}