# M2smart Product Architecture

## Product map

The organization is the tenancy boundary. A person may belong to multiple organizations; each organization owns properties. A property contains buildings, floors, rooms, areas, devices, scenes, automations, cameras, and membership grants. The active organization and property scope every read, realtime subscription, and mutation. The backend remains authoritative for identity, authorization, audit, and device commands.

Primary customer navigation is: Overview; Spaces (rooms and devices); Living (scenes and automations); Insights (energy); Safety (security and cameras); Home & you (activity and settings). Emergency, AI, users and sharing, integrations, and device onboarding are contextual destinations that can be added without expanding the first-level navigation.

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

As the product grows, split domain owners into `features/homes`, `rooms`, `devices`, `scenes`, `automations`, `energy`, `security`, `cameras`, `emergency`, `notifications`, `ai`, `users`, `settings`, and `admin`; keep service contracts and domain types out of presentation components.

## State and backend boundary

Route state identifies the active home and section. Local component state is limited to transient controls, presentation preferences, and optimistic mock interactions. Replace the mock gateway with a typed HTTP adapter that attaches the authenticated session, tenant scope, idempotency keys for commands, timeouts, and normalized user-safe errors. Mutations must be confirmed by the gateway before being described as successful; security-sensitive actions require server authorization and explicit user confirmation.

Inject a production `RealtimeClient` behind the declared port. It should subscribe only to the active property, coalesce high-frequency sensor events, expose connection state, retry with backoff, and release subscriptions on scope changes. Realtime payloads are hints to refresh authoritative state, never proof of authorization.

## Design system and responsive strategy

`app/globals.css` is the token source: semantic colors and surfaces, typography, compact radii, elevation, interaction timing, and breakpoints. Components consume semantic tokens rather than brand literals. Light is the default; dark is a semantic token override. Contrast, focus visibility, reduced motion, touch targets, and readable non-glass surfaces take precedence over visual effects.

The desktop layout uses a fixed-width contextual rail and fluid, capped content. Tablet reduces rail and column count. At 800px the rail becomes a safe-area-aware bottom navigation with a secondary destination sheet; the command center reflows from four room tiles to two, and device controls become one-thumb rows. RTL uses logical spacing and a mirrored rail instead of translated strings layered over an LTR layout.

## Localization and preferences

English and Persian messages currently exercise LTR/RTL switching. Add Arabic through the same typed message catalog. Production localization should move catalogs to message files and add localized date, number, calendar, timezone, and unit formatters. Store user preferences on the account through the API; local storage is only a prototype fallback. Jalali date conversion, calendar scheduling, density controls, and accent presets remain follow-up work.

## Delivery sequence

1. Product map, domain boundaries, route and adapter contracts.
2. Semantic theme tokens and accessible interaction primitives.
3. App shell, tenant/property scope, localization, and preferences.
4. Command center, room/device collections, scenes, energy, security, cameras, and activity.
5. Device-specific control sheets and lifecycle/diagnostics.
6. Visual automation authoring and scheduling.
7. Emergency workflows, audit surfaces, and permission-aware controls.
8. Organization administration, integrations, and white-label configuration.
9. Realtime, authenticated API adapters, offline policy, and PWA validation.
10. Accessibility, security, responsive, performance, and end-to-end review.

The current delivery implements the app foundation, the interactive mock-backed slices in steps 1–4, and (Phase 2) a fully self-hosted base: PostgreSQL with the organization/property RLS migrations, a Fastify API, and Ory Kratos sign-in by SMS code with an optional password. Fonts and images are served by the app itself. Property, room, and device management is still stored in a versioned browser-local workspace scoped by authenticated user ID; it is not yet synchronized across devices. Room/device API endpoints and tables, hub connectivity over MQTT, realtime transport, offline command policy, administration, and full localized calendar/unit handling remain to be implemented.