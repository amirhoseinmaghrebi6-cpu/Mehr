"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowUpLeft,
  BedDouble,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  House,
  LayoutDashboard,
  Languages,
  Lightbulb,
  LockKeyhole,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunset,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { DashboardView, type DashboardSection } from "@/features/dashboard/dashboard-view";
import { DeviceSheet } from "@/components/device-sheet";
import { signOutAction } from "@/app/(app)/actions";
import { DeviceEditorDialog, PropertyManagerDialog, RoomEditorDialog } from "@/components/workspace-dialogs";
import { translate, type Locale } from "@/lib/i18n";
import { homeGateway } from "@/services/home-gateway";
import { getMockHomeSnapshot, type Device, type Property, type Room } from "@/services/mock-home-service";
import { createDefaultWorkspace, getWorkspaceSnapshot, loadWorkspace, saveWorkspace, type HomeWorkspace } from "@/services/workspace-store";

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

type AppShellProps = {
  userId: string;
  displayName: string;
  demoMode?: boolean;
  children?: React.ReactNode;
  initialSection?: DashboardSection;
  initialPropertyId?: string;
};

export function AppShell({ userId, displayName, demoMode = false, initialSection = "overview", initialPropertyId = "tehran" }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [section, setSection] = useState<DashboardSection>(initialSection);
  const [propertyId, setPropertyId] = useState<string>(initialPropertyId);
  const [workspace, setWorkspace] = useState<HomeWorkspace>(() => createDefaultWorkspace());
  const workspaceRef = useRef(workspace);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [snapshot, setSnapshot] = useState(() => getMockHomeSnapshot(initialPropertyId));
  const [deviceStates, setDeviceStates] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(snapshot.devices.map((device) => [device.id, device.initialState])),
  );
  const [deviceValues, setDeviceValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(snapshot.devices.flatMap((device) => device.value === undefined ? [] : [[device.id, device.value]])),
  );
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [pendingLock, setPendingLock] = useState<Device | null>(null);
  const [activeDevice, setActiveDevice] = useState<Device | null>(null);
  const [propertyManagerOpen, setPropertyManagerOpen] = useState(false);
  const [roomEditor, setRoomEditor] = useState<Room | "new" | null>(null);
  const [deviceEditorOpen, setDeviceEditorOpen] = useState(false);
  const [pendingRemoveDevice, setPendingRemoveDevice] = useState<Device | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const selectedProperty = useMemo(() => workspace.properties.find((property) => property.id === propertyId) ?? workspace.properties[0], [propertyId, workspace.properties]);
  const isRtl = locale === "fa";

  useEffect(() => {
    setWorkspace(loadWorkspace(userId));
    setWorkspaceReady(true);
  }, [userId]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (!workspaceReady) return;
    saveWorkspace(workspace, userId);
  }, [workspace, workspaceReady, userId]);

  useEffect(() => {
    if (!workspaceReady) return;
    const nextSnapshot = getWorkspaceSnapshot(propertyId, workspaceRef.current);
    setDeviceStates(Object.fromEntries(nextSnapshot.devices.map((device) => [device.id, device.initialState])));
    setDeviceValues(Object.fromEntries(nextSnapshot.devices.flatMap((device) => device.value === undefined ? [] : [[device.id, device.value]])));
    setActiveScene(null);
  }, [propertyId, workspaceReady]);

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
    let mounted = true;
    const nextSnapshot = getWorkspaceSnapshot(propertyId, workspace);
    void homeGateway.getSnapshot(propertyId).then(() => {
      if (mounted) setSnapshot(nextSnapshot);
    });
    return () => { mounted = false; };
  }, [propertyId, workspace]);

  useEffect(() => {
    const [routeRoot, routeHome, routeSection] = pathname.split("/").filter(Boolean);
    if (routeRoot === "homes" && routeHome) {
      setPropertyId(routeHome);
      setSection(isDashboardSection(routeSection) ? routeSection : "overview");
    } else if (routeRoot === "dashboard") {
      setSection("overview");
    }
  }, [pathname]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("home-search")?.focus();
      }
      if (event.key === "Escape") {
        setPendingLock(null);
        setActiveDevice(null);
        setMobileMoreOpen(false);
        if (document.activeElement?.id === "home-search") setSearch("");
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const toggleDevice = (id: string) => {
    const device = snapshot.devices.find((item) => item.id === id);
    if (!device) return;
    if (device.kind === "lock") {
      setPendingLock(device);
      return;
    }
    const previousValue = deviceStates[id] ?? device.initialState;
    const nextValue = !previousValue;
    setDeviceStates((current) => ({ ...current, [id]: nextValue }));
    void homeGateway.setDeviceState(propertyId, id, nextValue).then(
      () => setToast(deviceToast(device, nextValue, locale)),
      () => {
        setDeviceStates((current) => ({ ...current, [id]: previousValue }));
        setToast(locale === "fa" ? "فرمان ارسال نشد؛ اتصال خانه را بررسی کنید." : "That command didn’t reach your home. Check the connection and try again.");
      },
    );
  };

  const createProperty = (property: Property) => {
    setWorkspace((current) => ({
      ...current,
      properties: [...current.properties, property],
      roomsByProperty: { ...current.roomsByProperty, [property.id]: [] },
      devicesByProperty: { ...current.devicesByProperty, [property.id]: [] },
    }));
    setPropertyManagerOpen(false);
    changeProperty(property.id);
    setToast(locale === "fa" ? `${property.name} اضافه شد` : `${property.name} was added`);
  };

  const updateProperty = (property: Property) => {
    setWorkspace((current) => ({ ...current, properties: current.properties.map((item) => item.id === property.id ? property : item) }));
    setToast(locale === "fa" ? "اطلاعات خانه ذخیره شد" : "Property details saved");
  };

  const removeProperty = (id: string) => {
    const remaining = workspace.properties.filter((property) => property.id !== id);
    if (!remaining.length) return;
    setWorkspace((current) => ({
      ...current,
      properties: current.properties.filter((property) => property.id !== id),
      roomsByProperty: omitKey(current.roomsByProperty, id),
      devicesByProperty: omitKey(current.devicesByProperty, id),
    }));
    if (propertyId === id) changeProperty(remaining[0].id);
    setToast(locale === "fa" ? "خانه حذف شد" : "Property removed");
  };

  const saveRoom = (room: Room) => {
    setWorkspace((current) => {
      const rooms = current.roomsByProperty[propertyId] ?? [];
      const exists = rooms.some((item) => item.id === room.id);
      return {
        ...current,
        roomsByProperty: { ...current.roomsByProperty, [propertyId]: exists ? rooms.map((item) => item.id === room.id ? room : item) : [...rooms, room] },
      };
    });
    setRoomEditor(null);
    setToast(locale === "fa" ? "اطلاعات فضا ذخیره شد" : "Space details saved");
  };

  const addDevice = (device: Device) => {
    setWorkspace((current) => ({ ...current, devicesByProperty: { ...current.devicesByProperty, [propertyId]: [...(current.devicesByProperty[propertyId] ?? []), device] } }));
    setDeviceStates((current) => ({ ...current, [device.id]: device.initialState }));
    if (device.value !== undefined) setDeviceValues((current) => ({ ...current, [device.id]: device.value! }));
    setDeviceEditorOpen(false);
    setToast(locale === "fa" ? `«${device.name}» به ${device.room} اضافه شد` : `${device.name} added to ${device.room}`);
  };

  const removeDevice = (device: Device) => {
    setWorkspace((current) => ({
      ...current,
      devicesByProperty: { ...current.devicesByProperty, [propertyId]: (current.devicesByProperty[propertyId] ?? []).filter((item) => item.id !== device.id) },
    }));
    setDeviceStates((current) => omitKey(current, device.id));
    setDeviceValues((current) => omitKey(current, device.id));
    setPendingRemoveDevice(null);
    if (activeDevice?.id === device.id) setActiveDevice(null);
    setToast(locale === "fa" ? "دستگاه از خانه حذف شد" : "Device removed from this home");
  };

  const confirmLock = () => {
    if (!pendingLock) return;
    const device = pendingLock;
    const previousValue = deviceStates[device.id] ?? device.initialState;
    const nextValue = !previousValue;
    setDeviceStates((current) => ({ ...current, [device.id]: nextValue }));
    void homeGateway.setDeviceState(propertyId, device.id, nextValue).then(
      () => setToast(lockToast(nextValue, locale)),
      () => {
        setDeviceStates((current) => ({ ...current, [device.id]: previousValue }));
        setToast(locale === "fa" ? "قفل به خانه متصل نشد؛ هیچ تغییری انجام نشد." : "The lock couldn’t reach your home. Nothing changed.");
      },
    );
    setPendingLock(null);
  };

  const updateDeviceValue = (id: string, value: number) => {
    const device = snapshot.devices.find((item) => item.id === id);
    if (!device) return;
    const previousValue = deviceValues[id] ?? device.value ?? value;
    setDeviceValues((current) => ({ ...current, [id]: value }));
    void homeGateway.setDeviceValue(propertyId, id, value).then(
      () => setToast(locale === "fa" ? "تنظیم ذخیره شد" : `${device.name} updated`),
      () => {
        setDeviceValues((current) => ({ ...current, [id]: previousValue }));
        setToast(locale === "fa" ? "تنظیم به خانه نرسید؛ اتصال را بررسی کنید." : "That change didn’t reach your home. Check the connection and try again.");
      },
    );
  };

  const activateScene = (id: string) => {
    if (id === "custom") {
      setToast(locale === "fa" ? "ساخت سناریو به‌زودی در دسترس است" : "Scene builder is coming soon");
      return;
    }
    if (activeScene === id) {
      setActiveScene(null);
      setToast(locale === "fa" ? "سناریو غیرفعال شد" : "Scene paused");
      return;
    }
    const previousStates = deviceStates;
    const nextDevices = { ...deviceStates };
    if (id === "away") {
      for (const device of snapshot.devices) if (device.kind === "light" || device.kind === "plug") nextDevices[device.id] = false;
    }
    if (id === "morning") {
      nextDevices.lights = true;
      nextDevices.curtains = true;
    }
    if (id === "movie") {
      nextDevices.lights = false;
      nextDevices.curtains = false;
    }
    if (id === "dinner") nextDevices.lights = true;
    setDeviceStates(nextDevices);
    setActiveScene(id);
    const scene = snapshot.scenes.find((item) => item.id === id);
    void homeGateway.activateScene(propertyId, id).then(
      () => setToast(locale === "fa" ? `سناریوی «${scene?.name === "Good morning" ? "صبح بخیر" : scene?.name === "Movie night" ? "تماشای فیلم" : scene?.name === "Dinner" ? "شام" : "بیرون از خانه"}» اجرا شد` : `${scene?.name ?? "Scene"} is ready`),
      () => {
        setDeviceStates(previousStates);
        setActiveScene(null);
        setToast(locale === "fa" ? "سناریو اجرا نشد؛ اتصال خانه را بررسی کنید." : "That scene didn’t reach your home. Check the connection and try again.");
      },
    );
  };

  const navigate = (nextSection: DashboardSection) => {
    setSection(nextSection);
    setSearch("");
    setMobileMoreOpen(false);
    const nextPath = nextSection === "overview" ? `/homes/${propertyId}` : `/homes/${propertyId}/${nextSection}`;
    if (pathname !== nextPath) router.push(nextPath, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const changeProperty = (nextPropertyId: string) => {
    setPropertyId(nextPropertyId);
    setSection("overview");
    const nextSnapshot = getWorkspaceSnapshot(nextPropertyId, workspaceRef.current);
    setDeviceStates(Object.fromEntries(nextSnapshot.devices.map((device) => [device.id, device.initialState])));
    setDeviceValues(Object.fromEntries(nextSnapshot.devices.flatMap((device) => device.value === undefined ? [] : [[device.id, device.value]])));
    setActiveScene(null);
    router.push(`/homes/${nextPropertyId}`, { scroll: false });
  };

  const toggleLocale = () => setLocale((current) => current === "en" ? "fa" : "en");
  const toggleTheme = () => setTheme((current) => current === "light" ? "dark" : "light");

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
            <span className="property-select-copy"><strong>{isRtl && propertyId === "tehran" ? "ویلای تهران" : isRtl && propertyId === "caspian" ? "خانه‌ی کاسپین" : selectedProperty.name}</strong><small>{isRtl ? "ملک شخصی" : "Private residence"}</small></span>
            <ChevronDown size={15} className="property-chevron" aria-hidden="true" />
            <select aria-label={isRtl ? "انتخاب ملک" : "Choose property"} value={propertyId} onChange={(event) => changeProperty(event.target.value)}>
              {workspace.properties.map((property) => <option value={property.id} key={property.id}>{property.name}</option>)}
            </select>
          </label>
          <button type="button" className="property-manage-link" onClick={() => setPropertyManagerOpen(true)}><Plus size={13} />{isRtl ? "مدیریت و افزودن خانه" : "Manage homes"}</button>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-caption nav-caption">{isRtl ? "خانه‌ی شما" : "YOUR HOME"}</span>
          <div className="nav-group">
            {primaryLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} locale={locale} onClick={() => navigate(item.id)} />)}
          </div>
          <span className="sidebar-caption nav-caption nav-caption-spaced">{isRtl ? "زندگی هوشمند" : "LIVING, THOUGHTFULLY"}</span>
          <div className="nav-group">
            {routineLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} locale={locale} onClick={() => navigate(item.id)} />)}
          </div>
          <span className="sidebar-caption nav-caption nav-caption-spaced">{isRtl ? "مدیریت خانه" : "HOME & YOU"}</span>
          <div className="nav-group">
            {moreLinks.map((item) => <NavigationItem key={item.id} item={item} active={section === item.id} locale={locale} onClick={() => navigate(item.id)} />)}
          </div>
        </nav>

        <div className="sidebar-bottom">
          <button className="help-link" type="button" onClick={() => setToast(isRtl ? "تیم پشتیبانی M2smart در کنار شماست" : "M2smart support is here whenever you need it")}><CircleHelp size={17} /><span>{isRtl ? "راهنمایی و پشتیبانی" : "Help & support"}</span><ArrowUpLeft size={14} /></button>
          <div className="profile-row"><span className="profile-avatar">{displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="profile-copy"><strong>{displayName}</strong><small>{isRtl ? "عضو خانه" : "Home member"}</small></span><button className="profile-menu" type="button" aria-label={isRtl ? "تنظیمات حساب" : "Account settings"} onClick={() => navigate("settings")}><MoreHorizontal size={19} /></button><form action={signOutAction}><button className="profile-logout" type="submit" aria-label={isRtl ? "خروج از حساب" : "Sign out"} title={isRtl ? "خروج از حساب" : "Sign out"}><LogOut size={16} /></button></form></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="m2-mark">M2</span><span>M2smart</span>{demoMode && <span className="demo-mode-badge">DEMO</span>}</div>
          <button type="button" className="topbar-location" onClick={() => setPropertyManagerOpen(true)} aria-label={isRtl ? "مدیریت خانه‌ها" : "Manage homes"}><span className="breadcrumb-label">{isRtl ? "خانه‌ی من" : "MY HOME"}</span><ChevronDown size={13} /><span className="breadcrumb-current">{selectedProperty.name}</span><span className="location-dot" /></button>
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

        <div className="scroll-area" key={propertyId}>
          <DashboardView
            snapshot={snapshot}
            locale={locale}
            section={section}
            propertyName={isRtl && propertyId === "tehran" ? "ویلای تهران" : isRtl && propertyId === "caspian" ? "خانه‌ی کاسپین" : selectedProperty.name}
            propertyImage={selectedProperty.coverImage}
            propertyOnline={selectedProperty.online}
            displayName={displayName}
            deviceStates={deviceStates}
            deviceValues={deviceValues}
            activeScene={activeScene}
            query={search}
            onToggleDevice={toggleDevice}
            onOpenDevice={setActiveDevice}
            onActivateScene={activateScene}
            onNavigate={navigate}
            onClearSearch={() => setSearch("")}
            onAddRoom={() => setRoomEditor("new")}
            onEditRoom={setRoomEditor}
            onAddDevice={() => setDeviceEditorOpen(true)}
            onRemoveDevice={setPendingRemoveDevice}
          />
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
          {[
            ["scenes", Sunset], ["energy", Zap], ["security", ShieldCheck], ["cameras", Activity], ["notifications", Bell], ["settings", Settings],
          ].map(([id, Icon]) => { const target = id as DashboardSection; const ItemIcon = Icon as LucideIcon; return <button type="button" key={target} onClick={() => navigate(target)}><ItemIcon size={18} /><span>{t(target)}</span></button>; })}
          <form action={signOutAction}><button type="submit"><LogOut size={18} /><span>{isRtl ? "خروج از حساب" : "Sign out"}</span></button></form>
        </motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {pendingLock && <motion.div className="modal-backdrop lock-confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && setPendingLock(null)}>
          <motion.section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="lock-dialog-title" aria-describedby="lock-dialog-description" initial={{ opacity: 0, y: 15, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}>
            <button type="button" className="dialog-close" onClick={() => setPendingLock(null)} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
            <span className="dialog-lock-icon"><LockKeyhole size={21} /></span>
            <span className="panel-overline">{isRtl ? "تأیید امنیتی" : "SECURITY CHECK"}</span>
            <h2 id="lock-dialog-title">{isRtl ? (deviceStates[pendingLock.id] ? "قفل ورودی باز شود؟" : "در ورودی قفل شود؟") : (deviceStates[pendingLock.id] ? "Unlock the front door?" : "Lock the front door?")}</h2>
            <p id="lock-dialog-description">{isRtl ? "فقط در صورتی ادامه دهید که نزدیک خانه هستید و آماده‌ی ورودید." : "Only continue if you’re near home and ready to enter."}</p>
            <div className="dialog-actions"><button type="button" className="button-subtle" onClick={() => setPendingLock(null)}>{isRtl ? "لغو" : "Not now"}</button><button type="button" className="button-primary" onClick={confirmLock}><LockKeyhole size={15} />{isRtl ? "بله، ادامه بده" : "Confirm"}</button></div>
          </motion.section>
        </motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {activeDevice && <DeviceSheet
          key={activeDevice.id}
          device={activeDevice}
          isOn={deviceStates[activeDevice.id] ?? activeDevice.initialState}
          value={deviceValues[activeDevice.id] ?? activeDevice.value ?? 0}
          locale={locale}
          onClose={() => setActiveDevice(null)}
          onToggle={toggleDevice}
          onValueChange={updateDeviceValue}
        />}
      </AnimatePresence>

      {propertyManagerOpen && <PropertyManagerDialog
        properties={workspace.properties}
        selectedId={propertyId}
        locale={locale}
        onClose={() => setPropertyManagerOpen(false)}
        onSelect={(id) => { setPropertyManagerOpen(false); changeProperty(id); }}
        onCreate={createProperty}
        onUpdate={updateProperty}
        onDelete={removeProperty}
      />}

      {roomEditor && <RoomEditorDialog
        key={roomEditor === "new" ? "new-room" : roomEditor.id}
        room={roomEditor === "new" ? null : roomEditor}
        locale={locale}
        onClose={() => setRoomEditor(null)}
        onSave={saveRoom}
      />}

      {deviceEditorOpen && <DeviceEditorDialog
        rooms={snapshot.rooms}
        locale={locale}
        onClose={() => setDeviceEditorOpen(false)}
        onSave={addDevice}
      />}

      {pendingRemoveDevice && <div className="modal-backdrop lock-confirm-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingRemoveDevice(null)}>
        <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-device-title" dir={isRtl ? "rtl" : "ltr"}>
          <button type="button" className="dialog-close" onClick={() => setPendingRemoveDevice(null)} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
          <span className="workspace-dialog-icon delete-dialog-icon"><Lightbulb size={19} /></span>
          <span className="panel-overline">{isRtl ? "حذف دستگاه" : "REMOVE DEVICE"}</span>
          <h2 id="remove-device-title">{isRtl ? `«${pendingRemoveDevice.name}» حذف شود؟` : `Remove ${pendingRemoveDevice.name}?`}</h2>
          <p>{isRtl ? `این دستگاه از ${pendingRemoveDevice.room} جدا و از این خانه حذف می‌شود.` : `This device will be unassigned from ${pendingRemoveDevice.room} and removed from this home.`}</p>
          <div className="dialog-actions"><button type="button" className="button-subtle" onClick={() => setPendingRemoveDevice(null)}>{isRtl ? "انصراف" : "Cancel"}</button><button type="button" className="button-danger" onClick={() => removeDevice(pendingRemoveDevice)}><Lightbulb size={15} />{isRtl ? "حذف دستگاه" : "Remove device"}</button></div>
        </section>
      </div>}

      <AnimatePresence>{toast && <motion.div className="toast-message" role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}><span><Check size={14} /></span>{toast}</motion.div>}</AnimatePresence>
    </div>
  );
}

function NavigationItem({ item, active, locale, onClick }: { item: { id: DashboardSection; icon: LucideIcon }; active: boolean; locale: Locale; onClick: () => void }) {
  const Icon = item.icon;
  const label = translate(locale, item.id);
  return <button className={`nav-item${active ? " is-active" : ""}`} type="button" onClick={onClick} aria-current={active ? "page" : undefined}><span className="nav-icon"><Icon size={17} strokeWidth={active ? 2 : 1.75} /></span><span>{label}</span>{active && <span className="nav-current-indicator" />}</button>;
}

function MobileNavigationItem({ id, icon: Icon, active, locale, onClick }: { id: DashboardSection; icon: LucideIcon; active: boolean; locale: Locale; onClick: () => void }) {
  return <button type="button" className={`mobile-nav-item${active ? " is-active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon size={19} strokeWidth={active ? 2 : 1.8} /><span>{translate(locale, id)}</span></button>;
}

function deviceToast(device: Device, on: boolean, locale: Locale): string {
  const names: Record<string, string> = {
    climate: locale === "fa" ? "تهویه‌ی هوشمند" : "Climate",
    lights: locale === "fa" ? "چراغ‌ها" : "Pendant lights",
    curtains: locale === "fa" ? "پرده‌ها" : "Sheer curtains",
    "air-quality": locale === "fa" ? "کیفیت هوا" : "Air quality",
    coffee: locale === "fa" ? "قهوه‌ساز" : "Coffee machine",
    "garden-lights": locale === "fa" ? "چراغ‌های مسیر" : "Path lighting",
    window: locale === "fa" ? "پنجره" : "Window sensor",
  };
  return locale === "fa" ? `${names[device.id] ?? device.name} ${on ? "روشن شد" : "خاموش شد"}` : `${names[device.id] ?? device.name} turned ${on ? "on" : "off"}`;
}

function lockToast(locked: boolean, locale: Locale): string {
  return locale === "fa" ? (locked ? "در ورودی قفل شد" : "در ورودی باز شد") : (locked ? "Front door locked" : "Front door unlocked");
}

function isDashboardSection(section: string | undefined): section is DashboardSection {
  return ["overview", "rooms", "devices", "scenes", "automations", "energy", "security", "cameras", "notifications", "settings"].includes(section ?? "");
}

function omitKey<Value>(record: Record<string, Value>, key: string): Record<string, Value> {
  return Object.fromEntries(Object.entries(record).filter(([recordKey]) => recordKey !== key)) as Record<string, Value>;
}