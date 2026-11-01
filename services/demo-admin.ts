/**
 * The operator's panel for the demo: sample people and boards kept in this browser
 * (localStorage), so blocking, unblocking and deleting can be shown to a customer, and firmware
 * versions of the sample boards' models, so uploading and publishing an update can be shown too
 * (any file is taken, as the next version). Nothing reaches the API, and no real account is ever
 * touched.
 */
import { ADMIN_PAGE_SIZE, type AdminBoard, type AdminBoardListResponse, type AdminFirmwareResponse, type AdminOverview, type AdminUser, type AdminUserListResponse, type FirmwareRelease } from "@m2smart/contracts";
import type { AdminSource } from "@/features/admin/admin-panel";
import type { Locale } from "@/lib/i18n";
import { demoName } from "@/services/demo-home";

const STORAGE_PREFIX = "m2smart-demo-admin-v1-";
type DemoAdminData = { users: AdminUser[]; boards: AdminBoard[]; releases?: FirmwareRelease[] };

/** A demo model's code, from its name: "2-switch board" → "m2-2-switch-board-rev-a". */
const modelCode = (name: string) => `m2-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-rev-a`;
const fakeSha = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

/** Every sample model runs 1.4.2; some still have 1.3.0 listed, as an older version. */
function createReleases(boards: AdminBoard[]): FirmwareRelease[] {
  const models = [...new Set(boards.map((board) => board.model))];
  return models.flatMap((model, index) => [
    { id: `demo-fw-${index}-142`, modelCode: modelCode(model), version: "1.4.2", sizeBytes: 1_012_736, sha256: fakeSha(), notes: "Faster reconnect after power cuts", active: true, createdAt: daysAgo(12) },
    ...(index % 4 === 3 ? [{ id: `demo-fw-${index}-130`, modelCode: modelCode(model), version: "1.3.0", sizeBytes: 998_400, sha256: fakeSha(), notes: "First release", active: false, createdAt: daysAgo(60) }] : []),
  ]);
}

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
  const releases = () => (data.releases ??= createReleases(data.boards));
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
    async firmware(): Promise<AdminFirmwareResponse> {
      const names = [...new Set(data.boards.map((board) => board.model))];
      return {
        models: names.map((name) => {
          const code = modelCode(name);
          const counts = new Map<string, number>();
          for (const board of data.boards.filter((item) => item.model === name)) counts.set(board.firmwareVersion ?? "", (counts.get(board.firmwareVersion ?? "") ?? 0) + 1);
          return {
            code,
            name: demoName(name, locale),
            activeVersion: releases().find((release) => release.modelCode === code && release.active)?.version ?? null,
            boards: [...counts].map(([version, count]) => ({ version: version || null, count })),
          };
        }),
        releases: [...releases()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    },
    async uploadFirmware(code, file, notes) {
      // In the demo any file is taken, as the next version of the model.
      const latest = releases().filter((release) => release.modelCode === code).map((release) => release.version.split(".").map(Number)).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0] ?? [1, 0, -1];
      const release: FirmwareRelease = { id: `demo-fw-${crypto.randomUUID()}`, modelCode: code, version: `${latest[0]}.${latest[1]}.${latest[2] + 1}`, sizeBytes: file.size, sha256: fakeSha(), notes, active: false, createdAt: new Date().toISOString() };
      releases().push(release);
      save();
      return release;
    },
    async setFirmwareActive(id, active) {
      const release = releases().find((item) => item.id === id);
      if (!release) return;
      for (const item of releases()) if (item.modelCode === release.modelCode) item.active = false;
      release.active = active;
      // Published: the demo's boards of that model update at once.
      if (active) for (const board of data.boards) if (modelCode(board.model) === release.modelCode) board.firmwareVersion = release.version;
      save();
    },
    async deleteFirmware(id) {
      data.releases = releases().filter((item) => item.id !== id);
      save();
    },
    setBlocked: (id, blocked) => change(id, (user) => (user.blocked = blocked)),
    remove: (id) => {
      const user = data.users.find((item) => item.id === id && !item.platformAdmin);
      if (user) data = { ...data, users: data.users.filter((item) => item !== user), boards: data.boards.filter((board) => board.ownerPhone !== user.phone) };
      save();
      return Promise.resolve();
    },
  };
}
