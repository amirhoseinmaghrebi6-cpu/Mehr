# M2smart

M2smart is a premium smart-home operating platform, built with Next.js App Router, strict TypeScript, Tailwind CSS, and a feature-oriented architecture.

## Run locally

```bash
pnpm install
pnpm dev
```

## Product architecture

- `app/` owns route composition, document metadata, and the PWA manifest.
- `components/` contains reusable application-shell and navigation primitives.
- `features/` owns domain-specific experiences and presentation.
- `services/` is the replaceable boundary for API and realtime adapters.
- `lib/` holds locale and shared application utilities.

The product map, route hierarchy, state boundaries, responsive strategy, and phased delivery plan are documented in [docs/product-architecture.md](docs/product-architecture.md).

Supabase Auth configuration, redirect URLs, and the tenant/RLS migration are documented in [docs/supabase-auth.md](docs/supabase-auth.md). Copy `.env.example` to `.env.local` and configure a Supabase project before signing in; no demo credential or service-role key is bundled with the app.

The browser UI consumes domain-shaped mock services, never broker credentials. Production authentication, permissions, and device authorization must be enforced by the backend.# Mehr