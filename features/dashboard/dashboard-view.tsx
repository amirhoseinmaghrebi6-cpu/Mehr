"use client";

import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
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
  Wind,
  Zap,
} from "lucide-react";
import type { CapabilityName, CapabilityValue, Device, Property, Room } from "@m2smart/contracts";
import { DeviceControl } from "@/components/device-control";
import { deviceSummary, deviceTypeInfo, formatNumber, isActive, isAlert, photoUrl, primaryCapability, text } from "@/lib/device-ui";
import { translate, type Locale } from "@/lib/i18n";
import type { HomeSnapshot } from "@/services/mock-home-service";

export type DashboardSection = "overview" | "rooms" | "devices" | "scenes" | "automations" | "energy" | "security" | "cameras" | "notifications" | "settings";

/** Sections that only have sample data so far; real users see "coming soon" there. */
const sampleOnlySections: ReadonlySet<DashboardSection> = new Set(["scenes", "automations", "energy", "security", "cameras"]);

type DeviceView = {
  valueOf: (device: Device, capability: CapabilityName) => CapabilityValue | null;
  activityOf: (device: Device) => "sending" | "working" | null;
};

type Props = DeviceView & {
  locale: Locale;
  section: DashboardSection;
  property: Property;
  displayName: string;
  rooms: Room[];
  devices: Device[];
  loading: boolean;
  canEditRooms: boolean;
  nameOf: (name: string) => string;
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

export function DashboardView(props: Props) {
  const { locale, section, property, devices, rooms, query, nameOf, demo, onClearSearch } = props;
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const isRtl = locale === "fa";
  const title = section === "overview" ? t("commandCenter") : t(section);
  const roomName = (device: Device) => nameOf(rooms.find((room) => room.id === device.roomId)?.name ?? "");
  const search = query.trim().toLocaleLowerCase();
  const filteredDevices = search
    ? devices.filter((device) => `${nameOf(device.name)} ${device.name} ${roomName(device)} ${text(deviceTypeInfo[device.type], locale)}`.toLocaleLowerCase().includes(search))
    : devices;
  const online = devices.filter((device) => device.online).length;

  if (search && filteredDevices.length === 0) {
    return (
      <div className="empty-state search-empty" role="status">
        <span className="empty-icon"><Wifi size={23} /></span>
        <h2>{t("noResults")}</h2>
        <p>{isRtl ? `برای «${query}» چیزی پیدا نکردیم.` : `We couldn’t find anything for “${query}”.`}</p>
        <button className="text-action" onClick={onClearSearch} type="button">{isRtl ? "پاک‌کردن جست‌وجو" : "Clear search"}</button>
      </div>
    );
  }

  const status = devices.length === 0 ? (isRtl ? "آماده‌ی افزودن برد" : "Ready for its first board") : isRtl ? `${formatNumber(online, locale)} از ${formatNumber(devices.length, locale)} دستگاه متصل` : `${online} of ${devices.length} devices online`;

  return (
    <motion.div className="page-content" key={`${section}-${property.id}-${locale}`} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }} dir={isRtl ? "rtl" : "ltr"}>
      <header className="page-heading">
        <div>
          <div className="eyebrow"><span className={`status-pulse${online > 0 ? "" : " is-pending"}`} />{nameOf(property.name)} <span className="eyebrow-divider">/</span> {status}</div>
          <h1>{title}</h1>
          <p>{section === "overview" ? t("subtitle") : sectionCopy[section][locale]}</p>
        </div>
        <div className="heading-tools">
          {section === "rooms" && props.canEditRooms && <button type="button" className="workspace-quick-add" onClick={props.onAddRoom}><Plus size={15} />{isRtl ? "افزودن فضا" : "Add space"}</button>}
          {section === "devices" && <button type="button" className="workspace-quick-add" onClick={props.onAddDevice}><Plus size={15} />{isRtl ? "افزودن دستگاه" : "Add device"}</button>}
        </div>
      </header>

      {props.loading ? (
        <div className="quiet-panel" role="status"><span className="quiet-icon"><Hourglass size={24} strokeWidth={1.6} /></span><h2>{isRtl ? "در حال دریافت اطلاعات خانه…" : "Getting your home ready…"}</h2></div>
      ) : search ? (
        <DeviceCollection {...props} devices={filteredDevices} roomName={roomName} title={isRtl ? "نتایج جست‌وجو" : "Search results"} />
      ) : section === "overview" ? (
        <Overview {...props} roomName={roomName} />
      ) : !demo && sampleOnlySections.has(section) ? (
        <ComingSoon locale={locale} section={section} />
      ) : (
        <SectionContent {...props} roomName={roomName} />
      )}
    </motion.div>
  );
}

function Overview(props: Props & { roomName: (device: Device) => string }) {
  const { locale, property, displayName, devices, rooms, demo, activeScene, nameOf, onNavigate, onActivateScene } = props;
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const isRtl = locale === "fa";
  const arrow = isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />;
  const featured = [...devices].sort((a, b) => Number(primaryCapability(b) !== null) - Number(primaryCapability(a) !== null)).slice(0, 5);
  const temperatures = devices.flatMap((device) => device.capabilities.filter((state) => state.capability === "temperature" && typeof state.value === "number").map((state) => state.value as number));
  const humidity = devices.flatMap((device) => device.capabilities.filter((state) => state.capability === "humidity" && typeof state.value === "number").map((state) => state.value as number));
  const powerNow = devices.flatMap((device) => device.capabilities.filter((state) => state.capability === "power_w" && typeof state.value === "number").map((state) => state.value as number));
  const alerts = devices.filter(isAlert);
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

  return (
    <>
      <section className="welcome-banner" aria-label={t("homeStatus")}>
        <div className="welcome-photo" style={{ backgroundImage: `url("${photoUrl(property.coverPhoto, "large")}")` }} />
        <div className="welcome-wash" />
        <div className="welcome-content">
          <span className="welcome-kicker"><span className="welcome-live-dot" />{t("currently")}</span>
          <h2>{t("greeting")},<br />{displayName.split(/\s+/)[0]}.</h2>
          <p>{alerts.length ? (isRtl ? "یکی از حسگرها به توجه شما نیاز دارد." : "One of your sensors needs your attention.") : t("homeStatusDetail")}</p>
          {nameOf(property.address) && <div className="welcome-weather"><CloudSun size={16} />{nameOf(property.address)}</div>}
        </div>
        <div className="welcome-status">
          <span className="welcome-status-check">{alerts.length ? <TriangleAlert size={15} /> : <Check size={15} strokeWidth={2.4} />}</span>
          <span><strong>{alerts.length ? (isRtl ? "نیاز به بررسی" : "Needs a look") : t("homeStatus")}</strong><small>{isRtl ? "تا این لحظه" : "As of just now"}</small></span>
        </div>
      </section>

      <section className="metric-strip" aria-label={isRtl ? "وضعیت خانه" : "Home at a glance"}>
        <article className="metric-item">
          <span className="metric-symbol climate-symbol"><Thermometer size={17} /></span>
          <div className="metric-content"><span className="metric-label">{t("indoorComfort")}</span>
            {temperatures.length ? <strong>{formatNumber(average(temperatures), locale, 1)}° <small>{isRtl ? "سانتی‌گراد" : "C"}</small></strong> : <strong className="metric-empty">—</strong>}
            <span className="metric-foot"><span className="metric-dot" />{humidity.length ? (isRtl ? `رطوبت ${formatNumber(average(humidity), locale)}٪` : `${formatNumber(average(humidity), locale)}% humidity`) : isRtl ? "حسگر دما و رطوبت ندارید" : "No climate sensor yet"}</span></div>
        </article>
        <article className="metric-item">
          <span className="metric-symbol energy-symbol"><Zap size={17} /></span>
          <div className="metric-content"><span className="metric-label">{isRtl ? "مصرف همین لحظه" : "Power right now"}</span>
            {powerNow.length ? <strong>{formatNumber(powerNow.reduce((sum, value) => sum + value, 0), locale)} <small>{isRtl ? "وات" : "W"}</small></strong> : <strong className="metric-empty">—</strong>}
            <span className="metric-foot">{powerNow.length ? (isRtl ? `از ${formatNumber(powerNow.length, locale)} پریز و کنتور` : `From ${powerNow.length} metered devices`) : isRtl ? "پریز یا کنتور هوشمند ندارید" : "No metered socket yet"}</span></div>
        </article>
        <article className="metric-item">
          <span className="metric-symbol security-symbol">{alerts.length ? <TriangleAlert size={17} /> : <ShieldCheck size={17} />}</span>
          <div className="metric-content"><span className="metric-label">{t("securityTitle")}</span><strong className="security-value">{alerts.length ? (isRtl ? `${formatNumber(alerts.length, locale)} هشدار` : `${alerts.length} alert${alerts.length > 1 ? "s" : ""}`) : isRtl ? "همه‌چیز عادی" : "All clear"}</strong><span className="metric-foot"><span className="metric-dot" />{alerts.length ? alerts.map((device) => nameOf(device.name)).join("، ") : isRtl ? "از آخرین گزارش حسگرها" : "From the latest sensor reports"}</span></div>
        </article>
      </section>

      <section className="content-section rooms-section">
        <SectionHeading title={t("spaces")} detail={isRtl ? "هر فضا، درست همان‌طور که رهایش کرده‌اید." : "Each space, just as you left it."} action={t("seeAllRooms")} onAction={() => onNavigate("rooms")} arrow={arrow} />
        {rooms.length ? (
          <div className="room-grid">{rooms.slice(0, 4).map((room) => <RoomTile key={room.id} room={room} {...props} onClick={() => onNavigate("rooms")} />)}</div>
        ) : (
          <EmptyRooms {...props} />
        )}
      </section>

      <div className="overview-lower-grid">
        {demo ? (
          <section className="surface-panel scenes-panel">
            <SectionHeading title={t("scenesTitle")} detail={t("scenesSubtitle")} action={t("viewAll")} onAction={() => onNavigate("scenes")} arrow={arrow} />
            <div className="scene-list">
              {demo.scenes.map((scene) => {
                const Icon = sceneIcons[scene.icon as keyof typeof sceneIcons];
                const selected = activeScene === scene.id;
                return (
                  <button className={`scene-row${selected ? " scene-selected" : ""}`} key={scene.id} type="button" onClick={() => onActivateScene(scene.id)} aria-pressed={selected}>
                    <span className={`scene-icon scene-icon-${scene.id}`}><Icon size={17} strokeWidth={1.8} /></span>
                    <span className="scene-copy"><strong>{isRtl ? sceneNameFa(scene.id) : scene.name}</strong><small>{isRtl ? sceneDetailFa(scene.id) : scene.detail}</small></span>
                    <span className="scene-trigger">{selected ? <CircleCheck size={19} /> : <ChevronRight size={17} />}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="surface-panel scenes-panel coming-soon-panel">
            <span className="quiet-icon"><Sunrise size={22} strokeWidth={1.6} /></span>
            <h3>{isRtl ? "سناریوها به‌زودی" : "Scenes are coming soon"}</h3>
            <p>{isRtl ? "به‌زودی می‌توانید با یک لمس، چند دستگاه را با هم تنظیم کنید." : "Soon one tap will set several devices at once."}</p>
          </section>
        )}

        <section className="surface-panel devices-panel">
          <SectionHeading title={t("devicesTitle")} detail={t("devicesSubtitle")} action={t("allDevices")} onAction={() => onNavigate("devices")} arrow={arrow} />
          <div className="device-list">
            {featured.length ? featured.map((device) => <DeviceCard key={device.id} device={device} {...props} />) : <NoDevices {...props} />}
          </div>
        </section>
      </div>
    </>
  );
}

function DeviceCard({ device, locale, nameOf, valueOf, activityOf, onOpenDevice, onQuickAction, showRoom, roomName }: Props & { device: Device; showRoom?: boolean; roomName?: (device: Device) => string }) {
  const primary = primaryCapability(device);
  const value = (capability: CapabilityName) => valueOf(device, capability);
  const primaryValue = primary ? value(primary) : device.capabilities[0] ? value(device.capabilities[0].capability) : null;
  return (
    <DeviceControl
      device={device}
      name={nameOf(device.name)}
      summary={deviceSummary(device, value, locale)}
      roomName={showRoom ? roomName?.(device) : undefined}
      active={isActive(device.type, primaryValue)}
      alert={isAlert(device)}
      activity={activityOf(device)}
      locale={locale}
      onOpen={onOpenDevice}
      onQuickAction={primary ? onQuickAction : undefined}
    />
  );
}

function NoDevices({ locale, onAddDevice }: Props) {
  const isRtl = locale === "fa";
  return (
    <div className="workspace-empty"><Building2 size={21} /><strong>{isRtl ? "هنوز دستگاهی ندارید" : "No devices yet"}<small>{isRtl ? "دستگاه‌ها با افزودن برد از راه هاب خانه اضافه می‌شوند." : "Devices appear when a board is added through your hub."}</small></strong><button type="button" className="workspace-quick-add" onClick={onAddDevice}><Plus size={15} />{isRtl ? "چطور اضافه کنم؟" : "How to add"}</button></div>
  );
}

function EmptyRooms({ locale, canEditRooms, onAddRoom }: Props) {
  const isRtl = locale === "fa";
  return (
    <div className="workspace-empty"><Building2 size={21} /><strong>{isRtl ? "هنوز فضایی نساخته‌اید" : "A place for everything"}<small>{isRtl ? "اولین فضای خانه را اضافه کنید." : "Add your first room to get started."}</small></strong>{canEditRooms && <button type="button" className="workspace-quick-add" onClick={onAddRoom}><Plus size={15} />{isRtl ? "افزودن فضا" : "Add space"}</button>}</div>
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

function RoomTile({ room, locale, devices, nameOf, valueOf, canEditRooms, onEditRoom, onClick }: Props & { room: Room; onClick: () => void }) {
  const inRoom = devices.filter((device) => device.roomId === room.id);
  const active = inRoom.filter((device) => {
    const primary = primaryCapability(device);
    return primary !== null && isActive(device.type, valueOf(device, primary));
  }).length;
  const temperature = inRoom.flatMap((device) => device.capabilities).find((state) => state.capability === "temperature" && typeof state.value === "number")?.value as number | undefined;
  const name = nameOf(room.name);
  const label = locale === "fa" ? `${formatNumber(inRoom.length, locale)} دستگاه · ${formatNumber(active, locale)} فعال` : `${inRoom.length} devices · ${active} on`;
  return (
    <div className="room-card-wrap">
      <motion.button className="room-tile" type="button" onClick={onClick} whileHover={{ y: -3 }} transition={{ duration: 0.18 }}>
        <span className="room-image" style={{ backgroundImage: `url("${photoUrl(room.photo)}")` }} />
        <span className="room-overlay" />
        <span className="room-topline"><span><span className="room-live-dot" />{active ? (locale === "fa" ? "در حال استفاده" : "IN USE") : locale === "fa" ? "آرام" : "QUIET"}</span>{temperature !== undefined && <span className="room-temp"><Thermometer size={13} />{formatNumber(temperature, locale)}°</span>}</span>
        <span className="room-bottomline"><span><strong>{name}</strong><small>{label}</small></span><span className="room-arrow"><ChevronRight size={17} /></span></span>
      </motion.button>
      {canEditRooms && <button type="button" className="room-edit-button" onClick={() => onEditRoom(room)} aria-label={locale === "fa" ? `ویرایش ${name}` : `Edit ${name}`}><Pencil size={14} /></button>}
    </div>
  );
}

function DeviceCollection(props: Props & { roomName: (device: Device) => string; title: string }) {
  const { devices, locale, title, onNavigate, onRemoveDevice } = props;
  const isRtl = locale === "fa";
  return (
    <section className="collection-section">
      <SectionHeading title={title} detail={isRtl ? "وضعیت‌ها همان چیزی است که دستگاه‌ها گزارش داده‌اند." : "States are what your devices last reported."} action={isRtl ? "مشاهده‌ی فضاها" : "Browse rooms"} onAction={() => onNavigate("rooms")} arrow={isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />} />
      {devices.length === 0 ? <NoDevices {...props} /> : (
        <div className="collection-device-grid">
          {devices.map((device) => (
            <div className="device-management-row" key={device.id}>
              <DeviceCard device={device} {...props} showRoom />
              {onRemoveDevice && <button type="button" className="device-remove-button" onClick={() => onRemoveDevice(device)} aria-label={isRtl ? `حذف ${props.nameOf(device.name)}` : `Remove ${device.name}`}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionContent(props: Props & { roomName: (device: Device) => string }) {
  const { section, locale, rooms, demo, activeScene, onActivateScene, onNavigate } = props;
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const isRtl = locale === "fa";

  if (section === "rooms") {
    return (
      <section className="collection-section">
        {rooms.length ? <div className="room-grid collection-room-grid">{rooms.map((room) => <RoomTile key={room.id} room={room} {...props} onClick={() => onNavigate("devices")} />)}</div> : <EmptyRooms {...props} />}
      </section>
    );
  }
  if (section === "devices") return <DeviceCollection {...props} title={isRtl ? "تمام دستگاه‌ها" : "Every device, in its place"} />;
  if (section === "notifications") return <div className="quiet-panel"><span className="quiet-icon"><CircleCheck size={26} strokeWidth={1.6} /></span><h2>{t("notificationsTitle")}</h2><p>{t("notificationsCopy")}</p><span className="quiet-meta"><Clock3 size={14} />{isRtl ? "همه‌چیز به‌روز است" : "You’re all caught up"}</span></div>;
  if (section === "settings") return <SettingsSection locale={locale} />;
  if (!demo) return <ComingSoon locale={locale} section={section} />;

  if (section === "scenes") {
    return <section className="collection-section"><div className="scene-card-grid">{demo.scenes.map((scene) => {
      const Icon = sceneIcons[scene.icon as keyof typeof sceneIcons];
      const selected = activeScene === scene.id;
      return <button className={`large-scene-card${selected ? " scene-selected" : ""}`} type="button" onClick={() => onActivateScene(scene.id)} key={scene.id} aria-pressed={selected}><span className={`large-scene-icon scene-icon-${scene.id}`}><Icon size={22} /></span><strong>{isRtl ? sceneNameFa(scene.id) : scene.name}</strong><span>{isRtl ? sceneDetailFa(scene.id) : scene.detail}</span><span className="large-scene-action">{selected ? <CircleCheck size={20} /> : <ChevronRight size={19} />}</span></button>;
    })}</div></section>;
  }
  if (section === "automations") return <AutomationSection snapshot={demo} locale={locale} />;
  if (section === "energy") return <EnergySection snapshot={demo} locale={locale} />;
  if (section === "security") return <SecuritySection locale={locale} onNavigate={onNavigate} />;
  if (section === "cameras") return <CameraSection locale={locale} />;
  return null;
}

function ComingSoon({ locale, section }: { locale: Locale; section: DashboardSection }) {
  const isRtl = locale === "fa";
  const icons = { scenes: Sunrise, automations: Sunset, energy: Zap, security: ShieldCheck, cameras: Camera } as Partial<Record<DashboardSection, typeof Sunrise>>;
  const Icon = icons[section] ?? Clock3;
  return (
    <div className="quiet-panel coming-soon" role="status">
      <span className="quiet-icon"><Icon size={24} strokeWidth={1.6} /></span>
      <h2>{isRtl ? "به‌زودی" : "Coming soon"}</h2>
      <p>{isRtl ? "این بخش در نسخه‌های بعدی با اطلاعات واقعی خانه‌ی شما فعال می‌شود. حساب دمو نمونه‌ای از آن را نشان می‌دهد." : "This part arrives in a coming release, built on your home’s real data. The demo account shows a preview."}</p>
    </div>
  );
}

function AutomationSection({ snapshot, locale }: { snapshot: HomeSnapshot; locale: Locale }) {
  const isRtl = locale === "fa";
  const icons = [Sunset, House, Moon];
  const namesFa = ["غروب دلنشین", "خوش‌آمدگویی", "آرامش شب"];
  const descriptionsFa = ["هر روز، هنگام غروب آفتاب", "با رسیدن امیر به خانه", "هر شب، ساعت ۱۰:۳۰"];
  const destinationsFa = ["چراغ‌های مسیر باغ", "ورودی و تهویه", "تمام خانه"];
  return <section className="automation-layout"><div className="surface-panel automation-list"><div className="panel-intro"><span className="panel-overline">{isRtl ? "روال‌های هوشمند شما" : "YOUR HOME, ON AUTOPILOT"}</span><h2>{isRtl ? "جزئیات، خودش رسیدگی می‌شود." : "The details, taken care of."}</h2><p>{translate(locale, "automationSubtitle")}</p></div>{snapshot.automations.map((automation, index) => { const Icon = icons[index]; return <div className="automation-row" key={automation.id}><span className="automation-icon"><Icon size={18} /></span><span className="automation-copy"><strong>{isRtl ? namesFa[index] : automation.name}</strong><small>{isRtl ? descriptionsFa[index] : automation.detail}</small><span className="automation-destination">{isRtl ? destinationsFa[index] : automation.destination}</span></span><span className="automation-enabled"><span />{isRtl ? "فعال" : "On"}</span></div>; })}<button className="add-automation" type="button"><Plus size={16} />{isRtl ? "ساخت روال جدید" : "Create a routine"}</button></div><aside className="automation-aside"><span className="automation-aside-icon"><Sun size={21} /></span><h3>{isRtl ? "کمتر فکر کنید. بیشتر زندگی کنید." : "Think about it less."}</h3><p>{isRtl ? "خانه هر روز تا غروب، چراغ‌های باغ را خودکار روشن می‌کند." : "Your garden path lights come on every evening, just as daylight fades."}</p><div className="automation-aside-foot"><span className="status-pulse" />{formatNumber(snapshot.automations.length, locale)} {translate(locale, "activeAutomations")}</div></aside></section>;
}

function EnergySection({ snapshot, locale }: { snapshot: HomeSnapshot; locale: Locale }) {
  const isRtl = locale === "fa";
  const energy = snapshot.energy;
  return <section className="energy-layout"><div className="surface-panel energy-main"><div className="energy-headline"><div><span className="panel-overline">{isRtl ? "امروز · ویلای تهران" : "TODAY · TEHRAN VILLA"}</span><h2>{isRtl ? "خانه‌ای هوشمندتر،" : "A lighter footprint,"}<br /><span>{isRtl ? "مصرفی سبک‌تر." : "without thinking twice."}</span></h2></div><span className="energy-badge"><Leaf size={15} />{isRtl ? "۱۲٪ کمتر" : "12% less"}</span></div><div className="energy-total"><strong>{formatNumber(energy.todayKwh, locale, 1)}</strong><span>kWh</span><small>{isRtl ? "در مقایسه با دیروز کمتر" : "12% lower than yesterday"}<ArrowDownRight size={15} /></small></div><EnergyChart points={energy.points} locale={locale} /><div className="energy-axis"><span>{isRtl ? "۱۲ صبح" : "12 am"}</span><span>{isRtl ? "۶ صبح" : "6 am"}</span><span>{isRtl ? "۱۲ ظهر" : "12 pm"}</span><span>{isRtl ? "۶ عصر" : "6 pm"}</span><span>{isRtl ? "اکنون" : "Now"}</span></div><div className="energy-footnote"><span><span className="energy-legend-dot" />{isRtl ? "مصرف خانه" : "Home consumption"}</span><span>{isRtl ? "آخرین بررسی همین حالا" : "Updated just now"}</span></div></div><aside className="energy-aside"><div className="energy-aside-block"><span className="metric-symbol energy-symbol"><Zap size={17} /></span><span className="metric-label">{isRtl ? "مصرف همین لحظه" : "Right now"}</span><strong>{formatNumber(energy.currentWatts, locale)}<small> W</small></strong><span className="metric-foot positive"><span className="metric-dot" />{isRtl ? "کمتر از میانگین خانه" : "Below your home average"}</span></div><div className="energy-aside-block"><span className="metric-symbol climate-symbol"><Sun size={17} /></span><span className="metric-label">{isRtl ? "تولید خورشیدی" : "Solar production"}</span><strong>{formatNumber(1.8, locale, 1)}<small> kWh</small></strong><span className="metric-foot">{isRtl ? "۲۱٪ نیاز امروز خانه" : "21% of today's home use"}</span></div><div className="energy-note"><Check size={15} />{isRtl ? "روال عصرگاهی ۰٫۶ کیلووات‌ساعت صرفه‌جویی کرد." : "Your evening routine saved 0.6 kWh."}</div></aside></section>;
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
  const descriptions = isRtl ? ["نام، شماره‌ی موبایل و اطلاعات حساب", "رمز عبور و نشست‌ها", "کانال‌ها و اولویت‌های اعلان", "زبان، منطقه‌ی زمانی و تقویم", "پوسته، رنگ و اندازه‌ی نمایش", "خانه‌های متصل و دسترسی اعضا"] : ["Your name, mobile number and account details", "Password and sessions", "Channels and notification preferences", "Language, timezone and calendar", "Theme, color and display density", "Connected homes and member access"];
  const icons = [House, LockKeyhole, Wifi, Sun, Wind, BedDouble];
  return <section className="settings-layout"><div className="surface-panel settings-list">{labels.map((label, index) => { const Icon = icons[index]; return <button className="settings-row" key={label} type="button"><span className="settings-icon"><Icon size={18} /></span><span className="settings-copy"><strong>{label}</strong><small>{descriptions[index]}</small></span><ChevronRight size={17} /></button>; })}</div><aside className="settings-aside"><span className="m2-mark small-mark">M2</span><span className="panel-overline">M2SMART HOME</span><strong>{isRtl ? "خانه‌ای برای زندگی." : "A little more at home."}</strong><small>{isRtl ? "نسخه‌ی ۱٫۰ · به‌روز" : "Version 1.0 · Up to date"}</small></aside></section>;
}

function sceneNameFa(id: string): string {
  return ({ morning: "صبح بخیر", movie: "تماشای فیلم", dinner: "شام", away: "بیرون از خانه" })[id] ?? id;
}

function sceneDetailFa(id: string): string {
  return ({ morning: "چراغ‌ها روشن · پرده‌ها باز", movie: "چراغ‌ها کم‌نور · پرده‌ها بسته", dinner: "نور گرم · موسیقی روشن", away: "خانه امن · مصرف کمتر" })[id] ?? "";
}
