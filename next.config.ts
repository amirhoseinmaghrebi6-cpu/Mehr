import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  ...(process.env.NODE_ENV === "development"
    ? { experimental: { serverActions: { allowedOrigins: ["localhost:3000"] } } }
    : {}),
};

export default nextConfig;