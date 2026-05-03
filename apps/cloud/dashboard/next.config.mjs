/**
 * Next.js config — kept intentionally minimal at the scaffold stage.
 * Real config (rewrites, headers, image domains) lands once the
 * dashboard's UX shape is decided.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloud API base URL — overridden at deploy time. The default
  // points at a local cloud-api on the wrangler dev port.
  env: {
    AGENTAGORA_CLOUD_URL: process.env.AGENTAGORA_CLOUD_URL ?? "http://localhost:8787",
  },
};

export default nextConfig;
