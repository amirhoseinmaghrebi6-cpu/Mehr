import type { NextConfig } from "next";

const apiInternalUrl = (process.env.M2SMART_API_INTERNAL_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Same-origin access to the public M2smart API for browser code: /api/v1/* → API /v1/*.
  // Only /v1 is forwarded: the API's /internal/* routes (webhooks, dev SMS) must never be
  // reachable through the web app, where they would appear to come from 127.0.0.1.
  // Kratos is not exposed at all: sign-in runs in server actions (lib/auth/adapters/kratos.ts).
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiInternalUrl}/v1/:path*` }];
  },
  ...(process.env.NODE_ENV === "development"
    ? { experimental: { serverActions: { allowedOrigins: ["localhost:3000"] } } }
    : {}),
};

export default nextConfig;
