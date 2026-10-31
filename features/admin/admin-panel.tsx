"use client";

/**
 * The operator's panel (/admin): counts and the health of the services, people with block,
 * unblock and delete, and boards. Only for the numbers in the API's PLATFORM_ADMIN_PHONES; the API
 * checks that on every request. Nothing from inside a home is shown (the API never sends it).
 *
 * The demo shows the same panel over sample people and boards in the browser
 * (services/demo-admin.ts), so it can be shown to customers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Ban, Check, Cpu, Home, LayoutDashboard, LockOpen, Search, Trash2, TriangleAlert, Users, X } from "lucide-react";
import { ADMIN_PAGE_SIZE, type AdminBoard, type AdminBoardListResponse, type AdminOverview, type AdminUser, type AdminUserListResponse } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { LanguageMenu } from "@/components/language-menu";
import { phoneLabel } from "@/features/members/members";
import { gatewayMessage } from "@/lib/gateway-messages";
import { formatDate, formatNumber, formatTime } from "@/lib/i18n";
import { request } from "@/services/api-gateway";
import { createDemoAdminSource } from "@/services/demo-admin";
import { GatewayError, type GatewayErrorCode } from "@/services/home-gateway";

/** Where the panel's data comes from: the API, or the demo's samples. */
export type AdminSource = {
  overview(): Promise<AdminOverview>;
  users(search: string, offset: number): Promise<AdminUserListResponse>;
  boards(offset: number): Promise<AdminBoardListResponse>;
  setBlocked(userId: string, blocked: boolean): Promise<void>;
  remove(userId: string): Promise<void>;
};

const apiSource: AdminSource = {
  overview: () => request<AdminOverview>("GET", "/admin/overview"),
  users: (search, offset) => request<AdminUserListResponse>("GET", `/admin/users?search=${encodeURIComponent(search)}&offset=${offset}`),
  boards: (offset) => request<AdminBoardListResponse>("GET", `/admin/boards?offset=${offset}`),
  setBlocked: (userId, blocked) => request("PATCH", `/admin/users/${userId}`, { blocked }),
  remove: (userId) => request("DELETE", `/admin/users/${userId}`),
};

type Tab = "overview" | "users" | "boards";
type Toast = { message: string; tone: "ok" | "warn" };
const codeOf = (error: unknown): GatewayErrorCode => (error instanceof GatewayError ? error.code : "network");
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function AdminPanel({ demoUserId }: { /** Set for the demo: sample data, nothing reaches the API. */ demoUserId?: string }) {
  const { locale, m } = useI18n();
  const t = m.admin;
  const source = useMemo(() => (demoUserId ? createDemoAdminSource(demoUserId, locale) : apiSource), [demoUserId, locale]);
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<GatewayErrorCode | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await source.overview());
      setError(null);
    } catch (caught) {
      setError(codeOf(caught));
    }
  }, [source]);
  useEffect(() => void loadOverview(), [loadOverview]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), toast.tone === "warn" ? 6000 : 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const tabs = [["overview", LayoutDashboard], ["users", Users], ["boards", Cpu]] as const;
  return (
    <div className="admin-page">
      <header className="admin-header">
        <a className="admin-back" href="/dashboard"><ArrowLeft size={16} />{t.back}</a>
        <span className="admin-brand"><span className="m2-mark">M2</span>{demoUserId && <span className="demo-mode-badge">DEMO</span>}</span>
        <LanguageMenu />
      </header>
      <main className="admin-main">
        <div className="panel-intro"><span className="panel-overline">M2SMART</span><h1>{t.title}</h1><p>{t.subtitle}</p></div>
        <nav className="admin-tabs" aria-label={t.title}>
          {tabs.map(([id, Icon]) => (
            <button type="button" key={id} className={tab === id ? "is-active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon size={16} />{t.tabs[id]}</button>
          ))}
        </nav>
        {error && !overview && <div className="quiet-panel" role="alert"><h2>{gatewayMessage(error, locale)}</h2><button type="button" className="workspace-quick-add" onClick={() => void loadOverview()}>{m.common.tryAgain}</button></div>}
        {tab === "overview" && overview && <OverviewSection overview={overview} />}
        {tab === "users" && <UsersSection source={source} accounts={overview?.services.accounts ?? false} onToast={setToast} onChanged={() => void loadOverview()} />}
        {tab === "boards" && <BoardsSection source={source} />}
      </main>
      <AnimatePresence>{toast && <motion.div className={`toast-message${toast.tone === "warn" ? " toast-warn" : ""}`} role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}><span>{toast.tone === "warn" ? <TriangleAlert size={14} /> : <Check size={14} />}</span>{toast.message}</motion.div>}</AnimatePresence>
    </div>
  );
}

function OverviewSection({ overview }: { overview: AdminOverview }) {
  const { locale, m } = useI18n();
  const t = m.admin;
  const counts = ["users", "blockedUsers", "homes", "boards", "boardsOnline", "commandsToday"] as const;
  return (
    <>
      <ul className="admin-counts">
        {counts.map((key) => <li key={key} className="surface-panel"><strong>{formatNumber(overview[key], locale)}</strong><span>{t.counts[key]}</span></li>)}
      </ul>
      <section className="surface-panel admin-services">
        <span className="panel-overline">{t.servicesTitle}</span>
        <ul>
          {(["database", "broker", "sms", "accounts"] as const).map((key) => (
            <li key={key}><span>{t.services[key]}</span><span className={`admin-status ${overview.services[key] ? "is-ok" : "is-off"}`}>{overview.services[key] ? <Check size={14} /> : <X size={14} />}{overview.services[key] ? t.working : t.notWorking}</span></li>
          ))}
        </ul>
      </section>
    </>
  );
}

function UsersSection({ source, accounts, onToast, onChanged }: { source: AdminSource; accounts: boolean; onToast: (toast: Toast) => void; onChanged: () => void }) {
  const { locale, calendar, m } = useI18n();
  const t = m.admin;
  const [search, setSearch] = useState("");
  const [list, setList] = useState<AdminUserListResponse | null>(null);
  const [error, setError] = useState<GatewayErrorCode | null>(null);
  const [confirming, setConfirming] = useState<{ user: AdminUser; action: "block" | "delete" } | null>(null);

  const load = useCallback(async (query: string, offset = 0) => {
    try {
      const page = await source.users(query, offset);
      setList((previous) => (offset && previous ? { users: [...previous.users, ...page.users], total: page.total } : page));
      setError(null);
    } catch (caught) {
      setError(codeOf(caught));
    }
  }, [source]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(search), 250);
    return () => window.clearTimeout(timeout);
  }, [load, search]);

  const nameOf = (user: AdminUser) => user.name || t.noName;
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      onToast({ message: done, tone: "ok" });
      setConfirming(null);
      onChanged();
      await load(search);
    } catch (caught) {
      onToast({ message: gatewayMessage(codeOf(caught), locale), tone: "warn" });
    }
  };
  const setBlocked = (user: AdminUser, blocked: boolean) =>
    act(() => source.setBlocked(user.id, blocked), blocked ? t.toasts.blocked(nameOf(user)) : t.toasts.unblocked(nameOf(user)));
  const remove = (user: AdminUser) => act(() => source.remove(user.id), t.toasts.deleted(nameOf(user)));

  return (
    <section className="surface-panel admin-list-panel">
      <label className="admin-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} aria-label={t.search} maxLength={60} /></label>
      {!accounts && <p className="admin-note" role="note"><TriangleAlert size={14} />{t.accountsOff}</p>}
      {error && <p className="admin-note" role="alert">{gatewayMessage(error, locale)}</p>}
      {list && !list.users.length && <p className="admin-empty">{t.noUsers}</p>}
      <ul className="member-list">
        {list?.users.map((user) => (
          <li className={`member-row admin-user${user.blocked ? " is-blocked" : ""}`} key={user.id}>
            <span className="profile-avatar member-avatar" aria-hidden="true">{nameOf(user).slice(0, 1).toUpperCase()}</span>
            <span className="member-copy">
              <strong>{nameOf(user)}{user.platformAdmin && <span className="member-role-badge role-owner">{t.operator}</span>}{user.blocked && <span className="member-role-badge admin-blocked-badge">{t.blockedBadge}</span>}</strong>
              <small>{user.phone && <bdi dir="ltr">{phoneLabel(user.phone, locale)}</bdi>}{" · "}{t.joined(formatDate(new Date(user.createdAt), locale, calendar, timeZone(), { day: "numeric", month: "short", year: "numeric" }))}</small>
              <small><Home size={12} /> {t.owns(formatNumber(user.homesOwned, locale))}{user.homesJoined > 0 && ` · ${t.memberOf(formatNumber(user.homesJoined, locale))}`}</small>
            </span>
            {confirming?.user.id === user.id ? (
              <span className="member-confirm admin-confirm">
                <small>{confirming.action === "block" ? t.blockQuestion(nameOf(user)) : t.deleteQuestion(nameOf(user))}</small>
                <span>
                  <button type="button" className="button-danger" onClick={() => void (confirming.action === "block" ? setBlocked(user, true) : remove(user))}>{confirming.action === "block" ? <Ban size={14} /> : <Trash2 size={14} />}{confirming.action === "block" ? t.confirmBlock : t.confirmDelete}</button>
                  <button type="button" className="button-subtle" onClick={() => setConfirming(null)}>{m.common.cancel}</button>
                </span>
              </span>
            ) : !user.platformAdmin && accounts && (
              <span className="admin-actions">
                {user.blocked
                  ? <button type="button" className="button-subtle" onClick={() => void setBlocked(user, false)}><LockOpen size={14} />{t.unblock}</button>
                  : <button type="button" className="button-subtle" onClick={() => setConfirming({ user, action: "block" })}><Ban size={14} />{t.block}</button>}
                <button type="button" className="icon-button member-remove" aria-label={`${t.delete}: ${nameOf(user)}`} title={t.delete} onClick={() => setConfirming({ user, action: "delete" })}><Trash2 size={15} /></button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {list && <MoreButton shown={list.users.length} total={list.total} onMore={() => void load(search, list.users.length)} />}
    </section>
  );
}

function BoardsSection({ source }: { source: AdminSource }) {
  const { locale, calendar, m } = useI18n();
  const t = m.admin;
  const [list, setList] = useState<AdminBoardListResponse | null>(null);
  const [error, setError] = useState<GatewayErrorCode | null>(null);
  const load = useCallback(async (offset = 0) => {
    try {
      const page = await source.boards(offset);
      setList((previous) => (offset && previous ? { boards: [...previous.boards, ...page.boards], total: page.total } : page));
      setError(null);
    } catch (caught) {
      setError(codeOf(caught));
    }
  }, [source]);
  useEffect(() => void load(), [load]);

  const seen = (board: AdminBoard) => {
    if (!board.lastSeenAt) return t.neverSeen;
    const at = new Date(board.lastSeenAt);
    return t.lastSeen(`${formatDate(at, locale, calendar, timeZone(), { day: "numeric", month: "short" })} ${formatTime(at, locale, timeZone())}`);
  };
  return (
    <section className="surface-panel admin-list-panel">
      <p className="admin-note">{t.boardsNote}</p>
      {error && <p className="admin-note" role="alert">{gatewayMessage(error, locale)}</p>}
      {list && !list.boards.length && <p className="admin-empty">{t.noBoards}</p>}
      <ul className="member-list">
        {list?.boards.map((board) => (
          <li className="member-row" key={board.id}>
            <span className={`admin-dot ${board.online ? "is-ok" : "is-off"}`} aria-hidden="true" />
            <span className="member-copy">
              <strong>{board.model}</strong>
              <small><bdi dir="ltr">{board.hardwareUid}</bdi>{board.firmwareVersion && ` · ${t.firmware(board.firmwareVersion)}`}</small>
              <small>{board.ownerPhone ? <>{board.ownerName || t.noName} · <bdi dir="ltr">{phoneLabel(board.ownerPhone, locale)}</bdi></> : t.noOwner}</small>
            </span>
            <span className="admin-board-state"><span className={`admin-status ${board.online ? "is-ok" : "is-off"}`}>{board.online ? t.online : t.offline}</span><small>{seen(board)}</small></span>
          </li>
        ))}
      </ul>
      {list && <MoreButton shown={list.boards.length} total={list.total} onMore={() => void load(list.boards.length)} />}
    </section>
  );
}

function MoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  const { locale, m } = useI18n();
  if (!total) return null;
  return (
    <div className="admin-more">
      <small>{m.admin.shown(formatNumber(shown, locale), formatNumber(total, locale))}</small>
      {shown < total && shown >= ADMIN_PAGE_SIZE && <button type="button" className="button-subtle" onClick={onMore}>{m.admin.showMore}</button>}
    </div>
  );
}
