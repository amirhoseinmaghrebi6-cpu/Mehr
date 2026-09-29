"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowUpLeft,
  BedDouble,
  Bell,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  House,
  LayoutDashboard,
  Languages,
  Lightbulb,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunset,
  TriangleAlert,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { can, type CapabilityName, type CapabilityValue, type Device, type Room } from "@m2smart/contracts";
import { DashboardView, type DashboardSection } from "@/features/dashboard/dashboard-view";
import { DeviceSheet } from "@/components/device-sheet";
import { signOutAction } from "@/app/(app)/actions";
import { AddDeviceDialog, DeviceDetailsDialog, PropertyManagerDialog, RoomEditorDialog } from "@/components/workspace-dialogs";
import { confirmBeforeCommand, deviceTypeInfo, primaryCapability, stateOf, text, toggledValue, valueLabel } from "@/lib/device-ui";
import { gatewayMessage } from "@/lib/gateway-messages";
import { translate, type Locale } from "@/lib/i18n";
import { createApiGateway } from "@/services/api-gateway";
import { createDemoGateway } from "@/services/demo-gateway";
import { demoName } from "@/services/demo-home";
import { getMockHomeSnapshot } from "@/services/mock-home-service";
import { useHomeData, type CommandOutcome } from "@/services/use-home-data";

type Theme = "light" | "dark";

const primaryLinks: { id: DashboardSection; icon: LucideIcon }[] = [
  { id: "overview", icon: LayoutDashboard },
  { id: "rooms", icon: BedDouble },
  { id: "devices", icon: Lightbulb },
  { id: "scenes", icon: Sunset },
];
const routineLinks: { id: DashboardSection; icon: LucideIcon }[] = [
  { id: "automations", icon: Sparkles },
  { id: "energy", icon: Zap },
  { id: "security", icon: ShieldCheck },
];
const moreLinks: { id: DashboardSection; icon: LucideIcon }[] = [
  { id: "cameras", icon: Activity },
  { id: "notifications", icon: Bell },
  { id: "settings", icon: Settings },
];

/** Device types whose hardware takes long enough to mention it while a command runs. */
const slowTypes = new Set(["garage_door", "curtain"]);

type AppShellProps = {
  userId: string;
  displayName: string;
  demoMode?: boolean;
  children?: React.ReactNode;
};

type Confirmation = { device: Device; capability: CapabilityName; target: CapabilityValue };

export function AppShell({ userId, displayName, demoMode = false }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [section, setSection] = useState<DashboardSection>("overview");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "warn" } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [propertyManagerOpen, setPropertyManagerOpen] = useState(false);
  const [roomEditor, setRoomEditor] = useState<Room | "new" | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [pendingRemoveDevice, setPendingRemoveDevice] = useState<Device | null>(null);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const isRtl = locale === "fa";
  const nameOf = useCallback((name: string) => (demoMode ? demoName(name, locale) : name), [demoMode, locale]);

  const gateway = useMemo(() => (demoMode ? createDemoGateway(userId) : createApiGateway()), [demoMode, userId]);
  const [routeRoot, routeHome, routeSection] = pathname.split("/").filter(Boolean);
  const requestedPropertyId = routeRoot === "homes" && routeHome ? decodeURIComponent(routeHome) : null;

  const localeRef = useRef(locale);
  localeRef.current = locale;
  const showToast = (message: string, tone: "ok" | "warn" = "ok") => setToast({ message, tone });
  const onOutcome = useCallback(
    (outcome: CommandOutcome) => {
      const current = localeRef.current;
      const fa = current === "fa";
      const name = demoMode ? demoName(outcome.device.name, current) : outcome.device.name;
      if (outcome.status === "applied") {
        setToast({ message: `${name}: ${valueLabel(outcome.capability, outcome.target, current)}`, tone: "ok" });
      } else if (outcome.status === "not_sent") {
        setToast({ message: `${name}: ${gatewayMessage(outcome.error ?? "network", current)}`, tone: "warn" });
      } else if (outcome.status === "timed_out") {
        setToast({ message: fa ? `${name} در زمان مقرر تأیید نکرد؛ ممکن است تغییری نکرده باشد. اتصال هاب را بررسی کنید.` : `${name} didn’t confirm in time, so it may not have changed. Check your hub’s connection.`, tone: "warn" });
      } else {
        setToast({ message: fa ? `${name} نتوانست این فرمان را انجام دهد.` : `${name} couldn’t carry that out.`, tone: "warn" });
      }
    },
    [demoMode],
  );

  const home = useHomeData(gateway, requestedPropertyId, onOutcome);
  const { property, propertyId, properties, rooms, devices } = home;
  const activeDevice = devices.find((device) => device.id === activeDeviceId) ?? null;
  const demoSnapshot = useMemo(() => (demoMode && propertyId ? getMockHomeSnapshot(propertyId) : null), [demoMode, propertyId]);
  const canEditRooms = property ? can(property.role, "room.edit") : false;
  const canEditDevices = property ? can(property.role, "device.edit") : false;
  const canControl = property ? can(property.role, "device.control") : false;

  // Remember each dimmer's last brightness, so switching it back on restores it.
  const lastBrightness = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const device of devices) {
      const value = stateOf(device, "brightness")?.value;
      if (typeof value === "number" && value > 0) lastBrightness.current[device.id] = value;
    }
  }, [devices]);

  // The URL names the home and section; an unknown home falls back to the first one.
  useEffect(() => {
    setSection(routeRoot === "homes" && isDashboardSection(routeSection) ? routeSection : "overview");
  }, [routeRoot, routeSection]);
  useEffect(() => {
    if (!properties || !propertyId || requestedPropertyId === propertyId) return;
    router.replace(`/homes/${propertyId}${section === "overview" ? "" : `/${section}`}`, { scroll: false });
  }, [properties, propertyId, requestedPropertyId, router, section]);
  useEffect(() => {
    if (properties && properties.length === 0) setPropertyManagerOpen(true);
  }, [properties]);

  useEffect(() => {
    const storedLocale = window.localStorage.getItem("m2smart-locale") ?? window.localStorage.getItem("mehr-locale");
    const storedTheme = window.localStorage.getItem("m2smart-theme") ?? window.localStorage.getItem("mehr-theme");
    if (storedLocale === "fa" || storedLocale === "en") setLocale(storedLocale);
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
    window.localStorage.setItem("m2smart-locale", locale);
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("m2smart-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("home-search")?.focus();
      }
      if (event.key === "Escape") {
        setConfirmation(null);
        setActiveDeviceId(null);
        setMobileMoreOpen(false);
        if (document.activeElement?.id === "home-search") setSearch("");
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), toast.tone === "warn" ? 6000 : 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const command = (device: Device, capability: CapabilityName, target: CapabilityValue, confirmed = false) => {
    if (!canControl) {
      showToast(gatewayMessage("forbidden", locale), "warn");
      return;
    }
    if (!confirmed && confirmBeforeCommand.has(device.type)) {
      setConfirmation({ device, capability, target });
      return;
    }
    void home.sendCommand(device, capability, target);
  };

  const quickAction = (device: Device) => {
    const capability = primaryCapability(device);
    if (!capability) return setActiveDeviceId(device.id);
    command(device, capability, toggledValue(device.type, home.valueOf(device, capability), lastBrightness.current[device.id] ?? 100));
  };

  const navigate = (nextSection: DashboardSection) => {
    setSection(nextSection);
    setSearch("");
    setMobileMoreOpen(false);
    if (!propertyId) return;
    const nextPath = nextSection === "overview" ? `/homes/${propertyId}` : `/homes/${propertyId}/${nextSection}`;
    if (pathname !== nextPath) router.push(nextPath, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const changeProperty = (nextPropertyId: string) => {
    setSection("overview");
    setActiveScene(null);
    router.push(`/homes/${nextPropertyId}`, { scroll: false });
  };

  // Demo scenes run as ordinary commands, so they behave like real devices would.
  const activateScene = (id: string) => {
    if (activeScene === id) {
      setActiveScene(null);
      return;
    }
    const targets: Array<[Device, CapabilityName, CapabilityValue]> = [];
    for (const device of devices) {
      if (id === "morning" && device.type === "dimmer") targets.push([device, "brightness", 80]);
      if (id === "morning" && device.type === "curtain") targets.push([device, "curtain", "open"]);
      if (id === "movie" && device.type === "dimmer") targets.push([device, "brightness", 15]);
      if (id === "movie" && device.type === "curtain") targets.push([device, "curtain", "closed"]);
      if (id === "dinner" && device.type === "dimmer") targets.push([device, "brightness", 60]);
      if (id === "away" && (device.type === "switch" || device.type === "socket")) targets.push([device, "power", false]);
      if (id === "away" && device.type === "dimmer") targets.push([device, "brightness", 0]);
    }
    for (const [device, capability, target] of targets) void home.sendCommand(device, capability, target);
    setActiveScene(id);
    showToast(isRtl ? "سناریو در حال اجراست…" : "Setting the scene…");
  };

  const toggleLocale = () => setLocale((current) => (current === "en" ? "fa" : "en"));
  const toggleTheme = () => setTheme((current) => (current === "light" ? "dark" : "light"));
  const propertyName = property ? nameOf(property.name) : "";

  return (
    <div className={`app-frame${isRtl ? " app-rtl" : ""}`} dir={isRtl ? "rtl" : "ltr"}>
      <aside className="sidebar" aria-label={isRtl ? "ناوبری اصلی" : "Main navigation"}>
        <div className="brand-lockup">
          <span className="m2-mark">M2</span>
          <span className="brand-word">M2smart</span>
          <span className={`brand-edition${demoMode ? " demo-edition" : ""}`}>{demoMode ? "DEMO" : "HOME"}</span>
        </div>

        <div className="property-switcher">
          <span className="sidebar-caption">{t("organization")}</span>
          <label className="property-select-wrap">
            <span className="property-avatar"><House size={16} strokeWidth={1.7} /></span>
            <span className="property-select-copy"><strong>{propertyName || (!properties ? "…" : isRtl ? "خانه‌ای ندارید" : "No home yet")}</strong><small>{property ? roleCaption(property.role, locale) : !properties ? (isRtl ? "در حال دریافت" : "Loading") : isRtl ? "اولین خانه را بسازید" : "Create your first home"}</small></span>
            <ChevronDown size={15} className="property-chevron" aria-hidden="true" />
            <select aria-label={isRtl ? "انتخاب ملک" : "Choose property"} value={propertyId ?? ""} onChange={(event) => changeProperty(event.target.value)} disabled={!properties?.length}>
              {properties?.map((item) => <option value={item.id} key={item.id}>{nameOf(item.name)}</option>)}
            </select>
          </label>
          <button type="button" className="property-manage-link" onClick={() => setPropertyManagerOpen(true)}><Plus size={13} />{isRtl ? "مدیریت و افزودن خانه" : "Manage homes"}</button>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-caption nav-caption">{isRtl ? "خانه‌ی شما" : "YOUR HOME"}</span>
          <div className="nav-group">{primaryLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} locale={locale} onClick={() => navigate(item.id)} />)}</div>
          <span className="sidebar-caption nav-caption nav-caption-spaced">{isRtl ? "زندگی هوشمند" : "LIVING, THOUGHTFULLY"}</span>
          <div className="nav-group">{routineLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} locale={locale} onClick={() => navigate(item.id)} />)}</div>
          <span className="sidebar-caption nav-caption nav-caption-spaced">{isRtl ? "مدیریت خانه" : "HOME & YOU"}</span>
          <div className="nav-group">{moreLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} locale={locale} onClick={() => navigate(item.id)} />)}</div>
        </nav>

        <div className="sidebar-bottom">
          <button className="help-link" type="button" onClick={() => showToast(isRtl ? "تیم پشتیبانی M2smart در کنار شماست" : "M2smart support is here whenever you need it")}><CircleHelp size={17} /><span>{isRtl ? "راهنمایی و پشتیبانی" : "Help & support"}</span><ArrowUpLeft size={14} /></button>
          <div className="profile-row"><span className="profile-avatar">{displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="profile-copy"><strong>{displayName}</strong><small>{property ? roleCaption(property.role, locale) : isRtl ? "عضو M2smart" : "M2smart member"}</small></span><button className="profile-menu" type="button" aria-label={isRtl ? "تنظیمات حساب" : "Account settings"} onClick={() => navigate("settings")}><MoreHorizontal size={19} /></button><form action={signOutAction}><button className="profile-logout" type="submit" aria-label={isRtl ? "خروج از حساب" : "Sign out"} title={isRtl ? "خروج از حساب" : "Sign out"}><LogOut size={16} /></button></form></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="m2-mark">M2</span><span>M2smart</span>{demoMode && <span className="demo-mode-badge">DEMO</span>}</div>
          <button type="button" className="topbar-location" onClick={() => setPropertyManagerOpen(true)} aria-label={isRtl ? "مدیریت خانه‌ها" : "Manage homes"}><span className="breadcrumb-label">{isRtl ? "خانه‌ی من" : "MY HOME"}</span><ChevronDown size={13} /><span className="breadcrumb-current">{propertyName || "—"}</span><span className="location-dot" /></button>
          <div className="topbar-actions">
            <label className={`global-search${searchFocused ? " search-focused" : ""}`}>
              <Search size={16} aria-hidden="true" />
              <input id="home-search" type="search" placeholder={t("searchHint")} aria-label={t("searchDevices")} value={search} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onChange={(event) => setSearch(event.target.value)} />
              <kbd><Command size={10} /> K</kbd>
            </label>
            <span className="topbar-divider" />
            <button className="icon-button theme-button" type="button" title={t("theme")} aria-label={t("theme")} onClick={toggleTheme}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
            <button className="icon-button language-button" type="button" title={t("language")} aria-label={t("language")} onClick={toggleLocale}><Languages size={17} /><span>{locale === "en" ? "فا" : "EN"}</span></button>
            <button className="icon-button notification-button" type="button" title={t("notifications")} aria-label={t("notifications")} onClick={() => navigate("notifications")}><Bell size={17} /><span className="notification-indicator" /></button>
          </div>
        </header>

        <div className="scroll-area" key={propertyId ?? "none"}>
          {home.loadError && !properties ? (
            <div className="quiet-panel" role="alert"><span className="quiet-icon"><TriangleAlert size={24} strokeWidth={1.6} /></span><h2>{isRtl ? "اطلاعات خانه دریافت نشد" : "We couldn’t load your homes"}</h2><p>{gatewayMessage(home.loadError, locale)}</p><button type="button" className="workspace-quick-add" onClick={() => void home.reloadProperties()}><RefreshCw size={14} />{isRtl ? "تلاش دوباره" : "Try again"}</button></div>
          ) : !properties ? (
            <div className="quiet-panel" role="status"><span className="quiet-icon"><House size={24} strokeWidth={1.6} /></span><h2>{isRtl ? "در حال آماده‌سازی…" : "Getting things ready…"}</h2></div>
          ) : !property ? (
            <div className="quiet-panel first-home"><span className="quiet-icon"><Building2 size={24} strokeWidth={1.6} /></span><h2>{isRtl ? "اولین خانه‌ی خود را بسازید" : "Create your first home"}</h2><p>{isRtl ? "خانه را بسازید، فضاهایش را اضافه کنید و بعد بردهای M2smart را از راه هاب به آن وصل کنید." : "Create your home, add its spaces, then connect your M2smart boards through the hub."}</p><button type="button" className="button-primary" onClick={() => setPropertyManagerOpen(true)}><Plus size={15} />{isRtl ? "ساخت خانه" : "Create a home"}</button></div>
          ) : (
            <DashboardView
              locale={locale}
              section={section}
              property={property}
              displayName={displayName}
              rooms={rooms}
              devices={devices}
              loading={home.homeLoading}
              canEditRooms={canEditRooms}
              nameOf={nameOf}
              demo={demoSnapshot}
              activeScene={activeScene}
              query={search}
              valueOf={home.valueOf}
              activityOf={home.activityOf}
              onOpenDevice={(device) => setActiveDeviceId(device.id)}
              onQuickAction={quickAction}
              onActivateScene={activateScene}
              onNavigate={navigate}
              onClearSearch={() => setSearch("")}
              onAddRoom={() => setRoomEditor("new")}
              onEditRoom={setRoomEditor}
              onAddDevice={() => setAddDeviceOpen(true)}
              onRemoveDevice={gateway.removeDemoDevice ? setPendingRemoveDevice : undefined}
            />
          )}
          <footer className="app-footer"><span>M2SMART · {isRtl ? "ساخته‌شده برای زندگی بهتر" : "MADE FOR BETTER LIVING"}</span><span>{isRtl ? "زمان محلی · تهران" : "LOCAL TIME · TEHRAN"}</span></footer>
        </div>
      </main>

      <nav className="mobile-nav" aria-label={isRtl ? "ناوبری پایین" : "Bottom navigation"}>
        <MobileNavigationItem id="overview" icon={LayoutDashboard} active={section === "overview"} locale={locale} onClick={() => navigate("overview")} />
        <MobileNavigationItem id="rooms" icon={BedDouble} active={section === "rooms"} locale={locale} onClick={() => navigate("rooms")} />
        <MobileNavigationItem id="devices" icon={Lightbulb} active={section === "devices"} locale={locale} onClick={() => navigate("devices")} />
        <MobileNavigationItem id="automations" icon={Sparkles} active={section === "automations"} locale={locale} onClick={() => navigate("automations")} />
        <button type="button" className={`mobile-nav-item${mobileMoreOpen ? " is-active" : ""}`} onClick={() => setMobileMoreOpen((open) => !open)} aria-expanded={mobileMoreOpen}><MoreHorizontal size={20} /><span>{isRtl ? "بیشتر" : "More"}</span></button>
      </nav>

      <AnimatePresence>
        {mobileMoreOpen && <motion.div className="mobile-more-menu" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18 }}>
          {([["scenes", Sunset], ["energy", Zap], ["security", ShieldCheck], ["cameras", Activity], ["notifications", Bell], ["settings", Settings]] as const).map(([id, Icon]) => <button type="button" key={id} onClick={() => navigate(id)}><Icon size={18} /><span>{t(id)}</span></button>)}
          <form action={signOutAction}><button type="submit"><LogOut size={18} /><span>{isRtl ? "خروج از حساب" : "Sign out"}</span></button></form>
        </motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {confirmation && <motion.div className="modal-backdrop lock-confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && setConfirmation(null)}>
          <motion.section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" initial={{ opacity: 0, y: 15, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}>
            <button type="button" className="dialog-close" onClick={() => setConfirmation(null)} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
            <span className="dialog-lock-icon"><ShieldCheck size={21} /></span>
            <span className="panel-overline">{isRtl ? "تأیید امنیتی" : "SECURITY CHECK"}</span>
            <h2 id="confirm-dialog-title">{nameOf(confirmation.device.name)}: {valueLabel(confirmation.capability, confirmation.target, locale)}?</h2>
            <p>{confirmation.device.type === "garage_door" ? (isRtl ? "فقط وقتی ادامه دهید که مسیر درب خالی است. حرکت درب ممکن است یکی دو دقیقه طول بکشد." : "Only continue if the doorway is clear. The door can take a minute or two to move.") : isRtl ? "وضعیت دزدگیر خانه تغییر می‌کند." : "This changes your home’s alarm."}</p>
            <div className="dialog-actions"><button type="button" className="button-subtle" onClick={() => setConfirmation(null)}>{isRtl ? "لغو" : "Not now"}</button><button type="button" className="button-primary" onClick={() => { command(confirmation.device, confirmation.capability, confirmation.target, true); setConfirmation(null); }}><Check size={15} />{isRtl ? "بله، ادامه بده" : "Confirm"}</button></div>
          </motion.section>
        </motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {activeDevice && <DeviceSheet
          key={activeDevice.id}
          device={activeDevice}
          name={nameOf(activeDevice.name)}
          roomName={nameOf(rooms.find((room) => room.id === activeDevice.roomId)?.name ?? "")}
          locale={locale}
          valueOf={(capability) => home.valueOf(activeDevice, capability)}
          activity={home.activityOf(activeDevice)}
          slowHardware={slowTypes.has(activeDevice.type)}
          canEdit={canEditDevices}
          onCommand={(capability, value) => command(activeDevice, capability, value)}
          onEdit={() => { setEditingDevice(activeDevice); setActiveDeviceId(null); }}
          onClose={() => setActiveDeviceId(null)}
        />}
      </AnimatePresence>

      {propertyManagerOpen && properties && <PropertyManagerDialog
        properties={properties}
        selectedId={propertyId}
        locale={locale}
        nameOf={nameOf}
        onClose={() => setPropertyManagerOpen(false)}
        onSelect={(id) => { setPropertyManagerOpen(false); changeProperty(id); }}
        onCreate={async (form) => {
          const created = await gateway.createProperty(form);
          home.setProperties((current) => [...(current ?? []), created]);
          setPropertyManagerOpen(false);
          changeProperty(created.id);
          showToast(isRtl ? `${created.name} اضافه شد` : `${created.name} was added`);
        }}
        onUpdate={async (id, form) => {
          const updated = await gateway.updateProperty(id, form);
          home.setProperties((current) => current?.map((item) => (item.id === id ? updated : item)) ?? null);
          showToast(isRtl ? "اطلاعات خانه ذخیره شد" : "Property details saved");
        }}
        onDelete={async (id) => {
          await gateway.deleteProperty(id);
          const remaining = (properties ?? []).filter((item) => item.id !== id);
          home.setProperties(remaining);
          if (propertyId === id) {
            if (remaining[0]) changeProperty(remaining[0].id);
            else router.push("/dashboard");
          }
          showToast(isRtl ? "خانه حذف شد" : "Property removed");
        }}
      />}

      {roomEditor && propertyId && <RoomEditorDialog
        key={roomEditor === "new" ? "new-room" : roomEditor.id}
        room={roomEditor === "new" ? null : roomEditor}
        locale={locale}
        nameOf={nameOf}
        canDelete={canEditRooms}
        onClose={() => setRoomEditor(null)}
        onSave={async (form) => {
          if (roomEditor === "new") {
            const created = await gateway.createRoom(propertyId, form);
            home.setRooms((current) => [...current, created]);
          } else {
            const updated = await gateway.updateRoom(propertyId, roomEditor.id, form);
            home.setRooms((current) => current.map((item) => (item.id === updated.id ? updated : item)));
          }
          setRoomEditor(null);
          showToast(isRtl ? "اطلاعات فضا ذخیره شد" : "Space details saved");
        }}
        onDelete={async () => {
          if (roomEditor === "new") return;
          await gateway.deleteRoom(propertyId, roomEditor.id);
          home.setRooms((current) => current.filter((item) => item.id !== roomEditor.id));
          home.setDevices((current) => current.map((device) => (device.roomId === roomEditor.id ? { ...device, roomId: null } : device)));
          setRoomEditor(null);
          showToast(isRtl ? "فضا حذف شد؛ دستگاه‌هایش در خانه می‌مانند" : "Space deleted; its devices stay in the home");
        }}
      />}

      {editingDevice && propertyId && <DeviceDetailsDialog
        device={editingDevice}
        name={nameOf(editingDevice.name)}
        rooms={rooms}
        locale={locale}
        nameOf={nameOf}
        onClose={() => setEditingDevice(null)}
        onSave={async (form) => {
          const updated = await gateway.updateDevice(propertyId, editingDevice.id, form);
          home.setDevices((current) => current.map((device) => (device.id === updated.id ? updated : device)));
          setEditingDevice(null);
          showToast(isRtl ? "دستگاه ذخیره شد" : "Device saved");
        }}
      />}

      {addDeviceOpen && propertyId && <AddDeviceDialog
        rooms={rooms}
        locale={locale}
        nameOf={nameOf}
        onClose={() => setAddDeviceOpen(false)}
        onAddDemo={gateway.addDemoDevice ? async (input) => {
          const created = await gateway.addDemoDevice!(propertyId, input);
          home.setDevices((current) => [...current, created]);
          setAddDeviceOpen(false);
          showToast(isRtl ? `«${created.name}» اضافه شد` : `${created.name} added`);
        } : undefined}
      />}

      {pendingRemoveDevice && propertyId && <div className="modal-backdrop lock-confirm-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingRemoveDevice(null)}>
        <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-device-title" dir={isRtl ? "rtl" : "ltr"}>
          <button type="button" className="dialog-close" onClick={() => setPendingRemoveDevice(null)} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
          <span className="workspace-dialog-icon delete-dialog-icon"><Lightbulb size={19} /></span>
          <span className="panel-overline">{isRtl ? "حذف دستگاه" : "REMOVE DEVICE"}</span>
          <h2 id="remove-device-title">{isRtl ? `«${nameOf(pendingRemoveDevice.name)}» حذف شود؟` : `Remove ${pendingRemoveDevice.name}?`}</h2>
          <p>{text(deviceTypeInfo[pendingRemoveDevice.type], locale)}</p>
          <div className="dialog-actions"><button type="button" className="button-subtle" onClick={() => setPendingRemoveDevice(null)}>{isRtl ? "انصراف" : "Cancel"}</button><button type="button" className="button-danger" onClick={() => { const device = pendingRemoveDevice; setPendingRemoveDevice(null); void gateway.removeDemoDevice?.(propertyId, device.id).then(() => home.setDevices((current) => current.filter((item) => item.id !== device.id))); }}><Lightbulb size={15} />{isRtl ? "حذف دستگاه" : "Remove device"}</button></div>
        </section>
      </div>}

      <AnimatePresence>{toast && <motion.div className={`toast-message${toast.tone === "warn" ? " toast-warn" : ""}`} role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}><span>{toast.tone === "warn" ? <TriangleAlert size={14} /> : <Check size={14} />}</span>{toast.message}</motion.div>}</AnimatePresence>
    </div>
  );
}

function NavigationItem({ item, active, locale, onClick }: { item: { id: DashboardSection; icon: LucideIcon }; active: boolean; locale: Locale; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={`nav-item${active ? " is-active" : ""}`} type="button" onClick={onClick} aria-current={active ? "page" : undefined}><span className="nav-icon"><Icon size={17} strokeWidth={active ? 2 : 1.75} /></span><span>{translate(locale, item.id)}</span>{active && <span className="nav-current-indicator" />}</button>;
}

function MobileNavigationItem({ id, icon: Icon, active, locale, onClick }: { id: DashboardSection; icon: LucideIcon; active: boolean; locale: Locale; onClick: () => void }) {
  return <button type="button" className={`mobile-nav-item${active ? " is-active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon size={19} strokeWidth={active ? 2 : 1.8} /><span>{translate(locale, id)}</span></button>;
}

function roleCaption(role: "owner" | "admin" | "member", locale: Locale): string {
  const labels = { owner: { en: "Owner", fa: "مالک خانه" }, admin: { en: "Home admin", fa: "مدیر خانه" }, member: { en: "Home member", fa: "عضو خانه" } } as const;
  return labels[role][locale];
}

function isDashboardSection(section: string | undefined): section is DashboardSection {
  return ["overview", "rooms", "devices", "scenes", "automations", "energy", "security", "cameras", "notifications", "settings"].includes(section ?? "");
}
