# M2smart Product Architecture

## Product map

The organization is the tenancy boundary. A person may belong to multiple organizations; each organization owns properties. A property contains buildings, floors, rooms, areas, devices, scenes, automations, cameras, and membership grants. The active organization and property scope every read, realtime subscription, and mutation. The backend remains authoritative for identity, authorization, audit, and device commands.

Primary customer navigation is: Overview; Spaces (rooms and devices); Scenarios; Safety (security and cameras); Home & you (activity and settings). Emergency, AI, users and sharing, integrations, and device onboarding are contextual destinations that can be added without expanding the first-level navigation.

## Route hierarchy

The App Router exposes `/login`, `/register`, `/forgot-password`, `/update-password`, `/dashboard`, `/homes/[homeId]`, and `/homes/[homeId]/[[...section]]`. The `(auth)` route group is public (except `/update-password`, which needs a signed-in user); the `(app)` route group is guarded by middleware and loads the signed-in user from the M2smart API (`/v1/me`) in a server layout. Authentication is described in [auth.md](auth.md) and the trust model in [architecture/trust-boundaries.md](architecture/trust-boundaries.md). The catch-all gives each current home view a shareable URL and leaves room for resource detail segments such as `/homes/[homeId]/rooms/[roomId]` and `/homes/[homeId]/devices/[deviceId]`.

Planned route groups: `(auth)` for sign-in, registration, verification and recovery; `(app)` for home-scoped consumer routes; `/notifications` and `/ai` for global workflows; `/settings` for account preferences; and `/admin` for tenant operations. Authenticated layouts should resolve the active tenant server-side before rendering any protected route.

## Feature ownership

- `features/dashboard/` owns the command-center composition and its view models.
- `components/` owns cross-feature shell and device-control primitives.
- `services/home-gateway.ts` defines the replaceable request boundary; its current adapter returns realistic local data.
- `services/realtime-client.ts` defines typed domain events and a transport-neutral subscription port. Components must not connect directly to sockets, MQTT brokers, or credentials.
- `lib/i18n.ts` owns locale selection and message lookup; all content direction derives from locale.
- `app/` owns route composition, document metadata, and PWA declarations.

As the product grows, split domain owners into `features/homes`, `rooms`, `devices`, `scenarios`, `security`, `cameras`, `emergency`, `notifications`, `ai`, `users`, `settings`, and `admin`; keep service contracts and domain types out of presentation components.

## State and backend boundary

Route state identifies the active home and section (`/homes/:homeId/:section`). Homes, rooms and devices come from the M2smart API through `HomeGateway` (`services/api-gateway.ts`): same-origin `/api/v1`, request timeouts, user-safe errors in English and Persian. The demo account uses the same interface with sample data kept in its browser (`services/demo-gateway.ts`). Local component state is limited to transient controls and presentation preferences (language, theme).

Device commands are requests, not facts. A control shows the target at once, marked as sending, then in progress once the ESP32 has started (e.g. a door motor is running), and keeps the value only when the ESP32 reports it. Each command has a deadline set by the database: 30 s for the network plus the hardware's own time (a parking door gets minutes, a light seconds). The client waits until that deadline and falls back to the last reported value if nothing is confirmed. Commands are retried on a lost connection with the same idempotency key, so a command never runs twice. Parking doors and the alarm ask for confirmation first. Device lists refresh every 15 seconds, which picks up wall switches and sensors until realtime push exists (`services/use-home-data.ts`).

Inject a production `RealtimeClient` behind the declared port. It should subscribe only to the active property, coalesce high-frequency sensor events, expose connection state, retry with backoff, and release subscriptions on scope changes. Realtime payloads are hints to refresh authoritative state, never proof of authorization.

## Design system and responsive strategy

`app/globals.css` is the token source: semantic colors and surfaces, typography, compact radii, elevation, interaction timing, and breakpoints. Components consume semantic tokens rather than brand literals. Light is the default; dark is a semantic token override. Contrast, focus visibility, reduced motion, touch targets, and readable non-glass surfaces take precedence over visual effects.

The desktop layout uses a fixed-width contextual rail and fluid, capped content. Tablet reduces rail and column count. At 800px the rail becomes a safe-area-aware bottom navigation with a secondary destination sheet; the command center reflows from four room tiles to two, and device controls become one-thumb rows. RTL uses logical spacing and a mirrored rail instead of translated strings layered over an LTR layout.

## Localization and preferences

The whole app is in Persian, English and Arabic.
- **Message files:** all text lives in `messages/en.ts` (the reference), `messages/fa.ts` and `messages/ar.ts`. The English file's shape is the type of the others, so a missing key fails the type check.
- **Direction and digits:** Persian and Arabic are right to left. Numbers use each language's digits through `Intl.NumberFormat` (۰۱۲, ٠١٢, 012).
- **Where the language is kept:** in a cookie (`m2smart-locale`), so the server renders the first byte in the right language and direction. `components/i18n-provider.tsx` gives components the messages, and `components/language-menu.tsx` switches language on the sign-in screens and in the app.
- **Preferences on the account:** language, calendar (Solar Hijri or Gregorian) and temperature unit (°C or °F) are stored on the account (`GET`/`PATCH /v1/me/settings`; defaults English, Solar Hijri, °C) and in cookies for the first render. The app shell applies the account’s preferences after sign-in; on a first visit, choices made before signing up are kept and saved. The demo keeps them in its browser. Values are always stored in °C and Gregorian; only the display converts.
- **Colour palettes:** six palettes (Sage, the original and default, Ocean, Violet, Rose, Sand, Graphite), each with a light and a dark mode. The palette is a preference on the account, set in Settings and kept in a cookie, so the server renders the first byte in the right colours. `scripts/palettes.mjs` generates `app/palettes.css` and adjusts every colour that carries text until it meets its WCAG contrast ratio (7:1 for main text, at least 4.5:1 for everything else); `pnpm check:palettes` fails if that file is out of date or any text would not be readable.
- **Time zones and calendars:** every home has an IANA time zone (`properties.time_zone`, checked by the database; default Asia/Tehran). The home’s date, the footer clock and scenario times are in the home’s time, never the phone’s. Solar Hijri ⇄ Gregorian conversion is our own code in `packages/contracts/src/calendar.ts`, checked against the browser’s Solar Hijri calendar for every day from 1925 to 2150, so a stored date never reads differently on screen.
- **Scenarios (Phase 3.5 E2):** periodic (weekdays + local time), one-time (local date + time, stored Gregorian, picked in Solar Hijri or Gregorian) and themed (run by a tap).
  - Tables `scenarios`, `scenario_actions` and `scenario_runs`, with RLS and composite foreign keys. An action can only target a writable capability of a device of the same home, with a value that fits it; the database checks this too.
  - Owners and admins create, edit, switch off and delete; every member can run a themed scenario.
  - Each action becomes an ordinary command, linked to its run (`device_commands.scenario_run_id`), so it has the hardware's deadline and is applied only when the ESP32 reports.
  - Scheduled scenarios run on the server, for every home (there is no hub, and boards hold no schedules). A server job checks every 5 s; each occurrence runs at most once, because it is unique per scenario and occurrence. Occurrences before a scenario was created, changed or switched back on never count.
  - Each scheduled scenario has a validity window chosen by the user: never late, 10 minutes (default), 1 hour or 3 hours. If the power or internet was out at its time, its commands wait and reach the board the moment it is back within the window; after the window the run is recorded as missed. Commands sent by a tap keep their short deadline.
  - No history: only the latest run of a scenario is kept, and a one-time scenario is deleted once it is over.
  - The demo keeps sample scenarios in the browser and runs themed ones. Scheduled ones show when they would run but do not run, because the demo never reaches the server.

## Delivery sequence

1. Product map, domain boundaries, route and adapter contracts.
2. Semantic theme tokens and accessible interaction primitives.
3. App shell, tenant/property scope, localization, and preferences.
4. Command center, room/device collections, scenarios, security, cameras, and activity.
5. Device-specific control sheets and lifecycle/diagnostics.
6. Scenario authoring and scheduling.
7. Emergency workflows, audit surfaces, and permission-aware controls.
8. Organization administration, integrations, and white-label configuration.
9. Realtime, authenticated API adapters, offline policy, and PWA validation.
10. Accessibility, security, responsive, performance, and end-to-end review.

The current delivery implements:
- the app foundation and the slices in steps 1–4;
- (Phase 2) a fully self-hosted base: PostgreSQL with RLS, a Fastify API, Ory Kratos sign-in by SMS code with an optional password, and fonts and images served by the app itself;
- (Phase 3) real homes, rooms, devices and commands:
  - The home roles are owner, admin and member.
  - A hardware catalog describes M2smart's own ESP32 boards and their fixed pin maps (`docs/hardware-catalog.md`).
  - Devices are built from the board models.
  - Command deadlines follow the hardware's time.
  - A development simulator plays the ESP32s: each simulated board is a real client of the MQTT broker, so commands and reports travel the same path real boards will use.
- (Phase 4) boards connect straight to the cloud over MQTT, with no hub:
  - A board joins a home by the QR code it shows on its own setup page, uploaded by an owner or admin.
  - A factory reset leaves nothing of the board on the server.
  - See `docs/plans/phase-4.md` and `docs/board-protocol.md`.

Security and cameras still use sample data, in the demo only; real users see "coming soon" there. There is no Automations page and no Energy page, and the app shows no consumption numbers: scenarios cover scheduling, and consumption is not a feature of the product (decided 2026-10-04).

Still to be implemented:
- firmware;
- realtime push;
- member invitations;
- administration;
- the real SMS provider;
- deployment on servers in Iran, with TLS and our own certificate authority for the boards.