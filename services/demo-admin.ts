/**
 * The operator's panel for the demo: sample people and boards kept in this browser
 * (localStorage), so blocking, unblocking and deleting can be shown to a customer. Nothing
 * reaches the API, and no real account is ever touched.
 */
import { ADMIN_PAGE_SIZE, type AdminBoard, type AdminBoardListResponse, type AdminOverview, type AdminUser, type AdminUserListResponse } from "@m2smart/contracts";
import type { AdminSource } from "@/features/admin/admin-panel";
import type { Locale } from "@/lib/i18n";
import { demoName } from "@/services/demo-home";

const STORAGE_PREFIX = "m2smart-demo-admin-v1-";
type DemoAdminData = { users: AdminUser[]; boards: AdminBoard[] };

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** [name, phone, joined days ago, homes owned, homes joined, blocked] */
const PEOPLE: Array<[string, string, number, number, number, boolean?]> = [
  ["Sara Ahmadi", "+989121112233", 64, 1, 1],
  ["Reza Karimi", "+989351234567", 60, 0, 1],
  ["Maryam Rahimi", "+989127654321", 52, 2, 0],
  ["Ali Mohammadi", "+989133456789", 41, 1, 0],
  ["Neda Hosseini", "+989194567890", 37, 1, 2],
  ["Hamid Rezaei", "+989125678901", 30, 3, 0],
  ["Parisa Moradi", "+989366789012", 22, 1, 0, true],
  ["Kaveh Jafari", "+989017890123", 15, 1, 1],
  ["Leila Ghasemi", "+989128901234", 9, 0, 1],
  ["Omid Sadeghi", "+989389012345", 4, 1, 0],
  ["Zahra Karimi", "+989120123456", 1, 0, 0],
];

/** [model, owner (a PEOPLE name), online, last seen minutes ago (null: never)] */
const BOARDS: Array<[string, string, boolean, number | null]> = [
  ["2-switch board", "Sara Ahmadi", true, 1],
  ["Dimmer board", "Sara Ahmadi", true, 1],
  ["Curtain board", "Maryam Rahimi", true, 2],
  ["Cooler board", "Maryam Rahimi", true, 1],
  ["Door opener board", "Ali Mohammadi", true, 3],
  ["6-channel board", "Neda Hosseini", true, 1],
  ["Parking door board", "Hamid Rezaei", true, 2],
  ["Alarm board", "Hamid Rezaei", true, 1],
  ["Camera board", "Hamid Rezaei", false, 340],
  ["Smoke sensor", "Parisa Moradi", false, 2900],
  ["Water pump board", "Kaveh Jafari", true, 4],
  ["Leak sensor", "Omid Sadeghi", false, null],
];

function createData(userId: string): DemoAdminData {
  const users: AdminUser[] = [
    { id: userId, name: "You", phone: "+989120000000", createdAt: daysAgo(70), blocked: false, homesOwned: 2, homesJoined: 1, platformAdmin: true },
    ...PEOPLE.map(([name, phone, joined, owned, member, blocked], index) => ({
      id: `demo-person-${index}`, name, phone, createdAt: daysAgo(joined), blocked: blocked ?? false, homesOwned: owned, homesJoined: member, platformAdmin: false,
    })),
  ];
  const boards = BOARDS.map(([model, owner, online, seen], index): AdminBoard => {
    const person = users.find((user) => user.name === owner)!;
    return {
      id: `demo-board-${index}`, hardwareUid: `M2-${(0x3a41c0 + index * 977).toString(16).toUpperCase()}`, model, firmwareVersion: index % 4 === 3 ? "1.3.0" : "1.4.2",
      online, lastSeenAt: seen === null ? null : minutesAgo(seen), createdAt: daysAgo(40 - index * 3), ownerName: person.name, ownerPhone: person.phone,
    };
  });
  return { users, boards };
}

export function createDemoAdminSource(userId: string, locale: Locale): AdminSource {
  const key = `${STORAGE_PREFIX}${userId}`;
  const load = (): DemoAdminData => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) return JSON.parse(stored) as DemoAdminData;
    } catch {
      // Storage unavailable or corrupt: start from the samples.
    }
    return createData(userId);
  };
  let data = load();
  const save = () => {
    try {
      window.localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // The demo keeps working in memory.
    }
  };
  // Names as the visitor reads them, like the rest of the demo.
  const shown = <T extends { name?: string; model?: string; ownerName?: string }>(item: T): T => ({
    ...item,
    ...(item.name !== undefined && { name: demoName(item.name, locale) }),
    ...(item.model !== undefined && { model: demoName(item.model, locale) }),
    ...(item.ownerName !== undefined && { ownerName: demoName(item.ownerName, locale) }),
  });
  const page = <T>(items: T[], offset: number) => items.slice(offset, offset + ADMIN_PAGE_SIZE);
  const change = (id: string, work: (user: AdminUser) => void) => {
    const user = data.users.find((item) => item.id === id && !item.platformAdmin);
    if (user) work(user);
    save();
    return Promise.resolve();
  };

  return {
    async overview(): Promise<AdminOverview> {
      return {
        users: data.users.length,
        blockedUsers: data.users.filter((user) => user.blocked).length,
        homes: data.users.reduce((sum, user) => sum + user.homesOwned, 0),
        boards: data.boards.length,
        boardsOnline: data.boards.filter((board) => board.online).length,
        commandsToday: 37 + data.boards.filter((board) => board.online).length * 4,
        services: { database: true, broker: true, sms: true, accounts: true },
      };
    },
    async users(search, offset): Promise<AdminUserListResponse> {
      const query = search.trim().toLowerCase();
      const digits = query.replace(/\D/g, "");
      const found = data.users
        .map(shown)
        .filter((user) => !query || user.name.toLowerCase().includes(query) || (digits !== "" && (user.phone ?? "").includes(digits.replace(/^0/, ""))));
      return { users: page(found, offset), total: found.length };
    },
    async boards(offset): Promise<AdminBoardListResponse> {
      const sorted = [...data.boards].sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));
      return { boards: page(sorted, offset).map(shown), total: sorted.length };
    },
    setBlocked: (id, blocked) => change(id, (user) => (user.blocked = blocked)),
    remove: (id) => {
      const user = data.users.find((item) => item.id === id && !item.platformAdmin);
      if (user) data = { users: data.users.filter((item) => item !== user), boards: data.boards.filter((board) => board.ownerPhone !== user.phone) };
      save();
      return Promise.resolve();
    },
  };
}
