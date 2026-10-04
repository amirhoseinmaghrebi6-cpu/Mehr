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
import { can, defaultSettings, type CapabilityName, type CapabilityValue, type Device, type Room, type UpdateSettingsRequest, type UserSettings } from "@m2smart/contracts";
import { DashboardView, homeTimeZone, type DashboardSection } from "@/features/dashboard/dashboard-view";
import { DeviceSheet } from "@/components/device-sheet";
import { useI18n } from "@/components/i18n-provider";
import { LanguageMenu } from "@/components/language-menu";
import { signOutAction } from "@/app/(app)/actions";
import { AddDeviceDialog, DeviceDetailsDialog, PropertyManagerDialog, RoomEditorDialog } from "@/components/workspace-dialogs";
import { confirmBeforeCommand, primaryCapability, stateOf, toggledValue, typeLabel, valueLabel } from "@/lib/device-ui";
import { gatewayMessage } from "@/lib/gateway-messages";
import { formatTime, messages, timeZoneCity } from "@/lib/i18n";
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
  const { locale, m, rtl, calendar, temperatureUnit, setPreferences } = useI18n();
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
      const o = messages[current].shell.outcomes;
      const name = demoMode ? demoName(outcome.device.name, current) : outcome.device.name;
      if (outcome.status === "applied") setToast({ message: o.applied(name, valueLabel(outcome.capability, outcome.target, current)), tone: "ok" });
      else if (outcome.status === "not_sent" && outcome.device.type === "camera" && outcome.capability === "recording" && outcome.error === "conflict") setToast({ message: o.cameraOff(name), tone: "warn" });
      else if (outcome.status === "not_sent") setToast({ message: o.notSent(name, gatewayMessage(outcome.error ?? "network", current)), tone: "warn" });
      else if (outcome.status === "timed_out") setToast({ message: o.timedOut(name), tone: "warn" });
      else setToast({ message: o.failed(name), tone: "warn" });
    },
    [demoMode],
  );

  // Preferences live on the account (the demo keeps them in its browser). On load the account's
  // preferences apply, except on a first visit: if the account still has the defaults and a different
  // language, calendar or unit was already chosen here (e.g. on the sign-up screen), that choice is
  // kept and saved to the account. Later changes, from the settings page or the language menu, are
  // saved as they happen.
  const preferences = useRef<UserSettings>({ language: locale, calendar, temperatureUnit });
  preferences.current = { language: locale, calendar, temperatureUnit };
  const account = useRef<UserSettings | null>(null);
  useEffect(() => {
    let active = true;
    account.current = null;
    gateway.getSettings().then(
      (stored) => {
        if (!active) return;
        const current = preferences.current;
        const untouched = stored.language === defaultSettings.language && stored.calendar === defaultSettings.calendar && stored.temperatureUnit === defaultSettings.temperatureUnit;
        const differs = current.language !== stored.language || current.calendar !== stored.calendar || current.temperatureUnit !== stored.temperatureUnit;
        if (untouched && differs) {
          account.current = current;
          void gateway.updateSettings(current).catch(() => undefined);
        } else {
          account.current = stored;
          if (differs) setPreferences(stored);
        }
      },
      () => undefined, // Offline: the cookies keep this device's preferences.
    );
    return () => {
      active = false;
    };
  }, [gateway, setPreferences]);
  useEffect(() => {
    const saved = account.current;
    if (!saved) return;
    const changes: UpdateSettingsRequest = {};
    if (locale !== saved.language) changes.language = locale;
    if (calendar !== saved.calendar) changes.calendar = calendar;
    if (temperatureUnit !== saved.temperatureUnit) changes.temperatureUnit = temperatureUnit;
    if (!Object.keys(changes).length) return;
    account.current = { ...saved, ...changes };
    gateway.updateSettings(changes).catch(() => setToast({ message: messages[locale].settings.saveFailed, tone: "warn" }));
  }, [gateway, locale, calendar, temperatureUnit]);

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
    try {
      const storedTheme = window.localStorage.getItem("m2smart-theme") ?? window.localStorage.getItem("mehr-theme");
      if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
    } catch {
      // Storage unavailable: keep the light theme.
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("m2smart-theme", theme);
    } catch {
      // The theme still applies to this page.
    }
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
    showToast(m.shell.toasts.sceneRunning);
  };

  const toggleTheme = () => setTheme((current) => (current === "light" ? "dark" : "light"));
  const propertyName = property ? nameOf(property.name) : "";
  const roleCaption = property ? m.shell.roles[property.role] : null;

  return (
    <div className={`app-frame${rtl ? " app-rtl" : ""}`} dir={rtl ? "rtl" : "ltr"}>
      <aside className="sidebar" aria-label={m.nav.mainNavigation}>
        <div className="brand-lockup">
          <span className="m2-mark">M2</span>
          <span className="brand-word">M2smart</span>
          <span className={`brand-edition${demoMode ? " demo-edition" : ""}`}>{demoMode ? "DEMO" : "HOME"}</span>
        </div>

        <div className="property-switcher">
          <span className="sidebar-caption">{m.shell.residence}</span>
          <label className="property-select-wrap">
            <span className="property-avatar"><House size={16} strokeWidth={1.7} /></span>
            <span className="property-select-copy"><strong>{propertyName || (!properties ? "…" : m.shell.noHomeYet)}</strong><small>{roleCaption ?? (!properties ? m.shell.loadingCaption : m.shell.createFirstHomeCaption)}</small></span>
            <ChevronDown size={15} className="property-chevron" aria-hidden="true" />
            <select aria-label={m.shell.chooseHome} value={propertyId ?? ""} onChange={(event) => changeProperty(event.target.value)} disabled={!properties?.length}>
              {properties?.map((item) => <option value={item.id} key={item.id}>{nameOf(item.name)}</option>)}
            </select>
          </label>
          <button type="button" className="property-manage-link" onClick={() => setPropertyManagerOpen(true)}><Plus size={13} />{m.shell.manageHomes}</button>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-caption nav-caption">{m.nav.yourHome}</span>
          <div className="nav-group">{primaryLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} onClick={() => navigate(item.id)} />)}</div>
          <span className="sidebar-caption nav-caption nav-caption-spaced">{m.nav.living}</span>
          <div className="nav-group">{routineLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} onClick={() => navigate(item.id)} />)}</div>
          <span className="sidebar-caption nav-caption nav-caption-spaced">{m.nav.homeAndYou}</span>
          <div className="nav-group">{moreLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} onClick={() => navigate(item.id)} />)}</div>
        </nav>

        <div className="sidebar-bottom">
          <button className="help-link" type="button" onClick={() => showToast(m.shell.helpToast)}><CircleHelp size={17} /><span>{m.shell.help}</span><ArrowUpLeft size={14} /></button>
          <div className="profile-row"><span className="profile-avatar">{displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="profile-copy"><strong>{displayName}</strong><small>{roleCaption ?? m.shell.memberFallback}</small></span><button className="profile-menu" type="button" aria-label={m.shell.accountSettings} onClick={() => navigate("settings")}><MoreHorizontal size={19} /></button><form action={signOutAction}><button className="profile-logout" type="submit" aria-label={m.shell.signOut} title={m.shell.signOut}><LogOut size={16} /></button></form></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="m2-mark">M2</span><span>M2smart</span>{demoMode && <span className="demo-mode-badge">DEMO</span>}</div>
          <button type="button" className="topbar-location" onClick={() => setPropertyManagerOpen(true)} aria-label={m.shell.manageHomes}><span className="breadcrumb-label">{m.shell.myHome}</span><ChevronDown size={13} /><span className="breadcrumb-current">{propertyName || m.common.none}</span><span className="location-dot" /></button>
          <div className="topbar-actions">
            <label className={`global-search${searchFocused ? " search-focused" : ""}`}>
              <Search size={16} aria-hidden="true" />
              <input id="home-search" type="search" placeholder={m.shell.searchPlaceholder} aria-label={m.shell.searchLabel} value={search} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onChange={(event) => setSearch(event.target.value)} />
              <kbd><Command size={10} /> K</kbd>
            </label>
            <span className="topbar-divider" />
            <button className="icon-button theme-button" type="button" title={m.shell.switchTheme} aria-label={m.shell.switchTheme} onClick={toggleTheme}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
            <LanguageMenu />
            <button className="icon-button notification-button" type="button" title={m.shell.notifications} aria-label={m.shell.notifications} onClick={() => navigate("notifications")}><Bell size={17} /><span className="notification-indicator" /></button>
          </div>
        </header>

        <div className="scroll-area" key={propertyId ?? "none"}>
          {home.loadError && !properties ? (
            <div className="quiet-panel" role="alert"><span className="quiet-icon"><TriangleAlert size={24} strokeWidth={1.6} /></span><h2>{m.shell.loadErrorTitle}</h2><p>{gatewayMessage(home.loadError, locale)}</p><button type="button" className="workspace-quick-add" onClick={() => void home.reloadProperties()}><RefreshCw size={14} />{m.common.tryAgain}</button></div>
          ) : !properties ? (
            <div className="quiet-panel" role="status"><span className="quiet-icon"><House size={24} strokeWidth={1.6} /></span><h2>{m.shell.preparing}</h2></div>
          ) : !property ? (
            <div className="quiet-panel first-home"><span className="quiet-icon"><Building2 size={24} strokeWidth={1.6} /></span><h2>{m.shell.firstHomeTitle}</h2><p>{m.shell.firstHomeText}</p><button type="button" className="button-primary" onClick={() => setPropertyManagerOpen(true)}><Plus size={15} />{m.shell.createHome}</button></div>
          ) : (
            <DashboardView
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
          <footer className="app-footer"><span>{m.shell.footerTagline}</span><span>{property ? <LocalTime timeZone={homeTimeZone(property)} /> : null}</span></footer>
        </div>
      </main>

      <nav className="mobile-nav" aria-label={m.nav.bottomNavigation}>
        <MobileNavigationItem id="overview" icon={LayoutDashboard} active={section === "overview"} onClick={() => navigate("overview")} />
        <MobileNavigationItem id="rooms" icon={BedDouble} active={section === "rooms"} onClick={() => navigate("rooms")} />
        <MobileNavigationItem id="devices" icon={Lightbulb} active={section === "devices"} onClick={() => navigate("devices")} />
        <MobileNavigationItem id="automations" icon={Sparkles} active={section === "automations"} onClick={() => navigate("automations")} />
        <button type="button" className={`mobile-nav-item${mobileMoreOpen ? " is-active" : ""}`} onClick={() => setMobileMoreOpen((open) => !open)} aria-expanded={mobileMoreOpen}><MoreHorizontal size={20} /><span>{m.nav.more}</span></button>
      </nav>

      <AnimatePresence>
        {mobileMoreOpen && <motion.div className="mobile-more-menu" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18 }}>
          {([["scenes", Sunset], ["energy", Zap], ["security", ShieldCheck], ["cameras", Activity], ["notifications", Bell], ["settings", Settings]] as const).map(([id, Icon]) => <button type="button" key={id} onClick={() => navigate(id)}><Icon size={18} /><span>{m.nav[id]}</span></button>)}
          <div className="mobile-more-language"><LanguageMenu className="mobile-language-button" /></div>
          <form action={signOutAction}><button type="submit"><LogOut size={18} /><span>{m.shell.signOut}</span></button></form>
        </motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {confirmation && <motion.div className="modal-backdrop lock-confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && setConfirmation(null)}>
          <motion.section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" initial={{ opacity: 0, y: 15, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}>
            <button type="button" className="dialog-close" onClick={() => setConfirmation(null)} aria-label={m.common.close}><X size={18} /></button>
            <span className="dialog-lock-icon"><ShieldCheck size={21} /></span>
            <span className="panel-overline">{m.shell.confirm.overline}</span>
            <h2 id="confirm-dialog-title">{m.shell.confirm.question(nameOf(confirmation.device.name), valueLabel(confirmation.capability, confirmation.target, locale))}</h2>
            <p>{confirmation.device.type === "garage_door" ? m.shell.confirm.garage : m.shell.confirm.alarm}</p>
            <div className="dialog-actions"><button type="button" className="button-subtle" onClick={() => setConfirmation(null)}>{m.common.notNow}</button><button type="button" className="button-primary" onClick={() => { command(confirmation.device, confirmation.capability, confirmation.target, true); setConfirmation(null); }}><Check size={15} />{m.shell.confirm.proceed}</button></div>
          </motion.section>
        </motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {activeDevice && <DeviceSheet
          key={activeDevice.id}
          device={activeDevice}
          name={nameOf(activeDevice.name)}
          roomName={nameOf(rooms.find((room) => room.id === activeDevice.roomId)?.name ?? "")}
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
        nameOf={nameOf}
        onClose={() => setPropertyManagerOpen(false)}
        onSelect={(id) => { setPropertyManagerOpen(false); changeProperty(id); }}
        onCreate={async (form) => {
          const created = await gateway.createProperty(form);
          home.setProperties((current) => [...(current ?? []), created]);
          setPropertyManagerOpen(false);
          changeProperty(created.id);
          showToast(m.shell.toasts.homeAdded(created.name));
        }}
        onUpdate={async (id, form) => {
          const updated = await gateway.updateProperty(id, form);
          home.setProperties((current) => current?.map((item) => (item.id === id ? updated : item)) ?? null);
          showToast(m.shell.toasts.homeSaved);
        }}
        onDelete={async (id) => {
          await gateway.deleteProperty(id);
          const remaining = (properties ?? []).filter((item) => item.id !== id);
          home.setProperties(remaining);
          if (propertyId === id) {
            if (remaining[0]) changeProperty(remaining[0].id);
            else router.push("/dashboard");
          }
          showToast(m.shell.toasts.homeRemoved);
        }}
      />}

      {roomEditor && propertyId && <RoomEditorDialog
        key={roomEditor === "new" ? "new-room" : roomEditor.id}
        room={roomEditor === "new" ? null : roomEditor}
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
          showToast(m.shell.toasts.roomSaved);
        }}
        onDelete={async () => {
          if (roomEditor === "new") return;
          await gateway.deleteRoom(propertyId, roomEditor.id);
          home.setRooms((current) => current.filter((item) => item.id !== roomEditor.id));
          home.setDevices((current) => current.map((device) => (device.roomId === roomEditor.id ? { ...device, roomId: null } : device)));
          setRoomEditor(null);
          showToast(m.shell.toasts.roomDeleted);
        }}
      />}

      {editingDevice && propertyId && <DeviceDetailsDialog
        device={editingDevice}
        name={nameOf(editingDevice.name)}
        rooms={rooms}
        nameOf={nameOf}
        onClose={() => setEditingDevice(null)}
        onSave={async (form) => {
          const updated = await gateway.updateDevice(propertyId, editingDevice.id, form);
          home.setDevices((current) => current.map((device) => (device.id === updated.id ? updated : device)));
          setEditingDevice(null);
          showToast(m.shell.toasts.deviceSaved);
        }}
      />}

      {addDeviceOpen && propertyId && <AddDeviceDialog
        rooms={rooms}
        nameOf={nameOf}
        onClose={() => setAddDeviceOpen(false)}
        onAddDemo={gateway.addDemoDevice ? async (input) => {
          const created = await gateway.addDemoDevice!(propertyId, input);
          home.setDevices((current) => [...current, created]);
          setAddDeviceOpen(false);
          showToast(m.shell.toasts.deviceAdded(created.name));
        } : undefined}
      />}

      {pendingRemoveDevice && propertyId && <div className="modal-backdrop lock-confirm-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingRemoveDevice(null)}>
        <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-device-title" dir={rtl ? "rtl" : "ltr"}>
          <button type="button" className="dialog-close" onClick={() => setPendingRemoveDevice(null)} aria-label={m.common.close}><X size={18} /></button>
          <span className="workspace-dialog-icon delete-dialog-icon"><Lightbulb size={19} /></span>
          <span className="panel-overline">{m.shell.removeDevice.overline}</span>
          <h2 id="remove-device-title">{m.shell.removeDevice.title(nameOf(pendingRemoveDevice.name))}</h2>
          <p>{typeLabel(pendingRemoveDevice.type, locale)}</p>
          <div className="dialog-actions"><button type="button" className="button-subtle" onClick={() => setPendingRemoveDevice(null)}>{m.common.cancel}</button><button type="button" className="button-danger" onClick={() => { const device = pendingRemoveDevice; setPendingRemoveDevice(null); void gateway.removeDemoDevice?.(propertyId, device.id).then(() => home.setDevices((current) => current.filter((item) => item.id !== device.id))); }}><Lightbulb size={15} />{m.shell.removeDevice.action}</button></div>
        </section>
      </div>}

      <AnimatePresence>{toast && <motion.div className={`toast-message${toast.tone === "warn" ? " toast-warn" : ""}`} role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}><span>{toast.tone === "warn" ? <TriangleAlert size={14} /> : <Check size={14} />}</span>{toast.message}</motion.div>}</AnimatePresence>
    </div>
  );
}

/** "LOCAL TIME · TEHRAN · 14:05": the home's own clock, refreshed every 20 seconds. */
function LocalTime({ timeZone }: { timeZone: string }) {
  const { locale, m } = useI18n();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{m.shell.localTime} · {timeZoneCity(timeZone, locale)}{now ? <> · <bdi>{formatTime(now, locale, timeZone)}</bdi></> : null}</>;
}

function NavigationItem({ item, active, onClick }: { item: { id: DashboardSection; icon: LucideIcon }; active: boolean; onClick: () => void }) {
  const { m } = useI18n();
  const Icon = item.icon;
  return <button className={`nav-item${active ? " is-active" : ""}`} type="button" onClick={onClick} aria-current={active ? "page" : undefined}><span className="nav-icon"><Icon size={17} strokeWidth={active ? 2 : 1.75} /></span><span>{m.nav[item.id]}</span>{active && <span className="nav-current-indicator" />}</button>;
}

function MobileNavigationItem({ id, icon: Icon, active, onClick }: { id: DashboardSection; icon: LucideIcon; active: boolean; onClick: () => void }) {
  const { m } = useI18n();
  return <button type="button" className={`mobile-nav-item${active ? " is-active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon size={19} strokeWidth={active ? 2 : 1.8} /><span>{m.nav[id]}</span></button>;
}

function isDashboardSection(section: string | undefined): section is DashboardSection {
  return ["overview", "rooms", "devices", "scenes", "automations", "energy", "security", "cameras", "notifications", "settings"].includes(section ?? "");
}
