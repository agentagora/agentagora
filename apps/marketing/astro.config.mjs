import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// https://astro.build/config
//
// Build-time env wiring:
//
//   SITE_URL                 — canonical origin of the marketing site,
//                              used as the `site` field so sitemap +
//                              <HeadMeta> emit absolute URLs. Defaults
//                              to https://agentagora.dev.
//   AGENTAGORA_CLOUD_URL     — base URL of the cloud-api whose
//                              `GET /v1/agents` we render at build time
//                              for the landing-page catalog section.
//                              Override at deploy time for staging.
//   AGENTAGORA_DASHBOARD_URL — base URL the "View on dashboard" CTA
//                              links to (`/agents/<aid>`).
//
// All three are server-only — the catalog + meta render at build time
// and nothing is hydrated into the client bundle.
const SITE_URL = process.env.SITE_URL ?? "https://agentagora.dev";

export default defineConfig({
  site: SITE_URL,
  integrations: [sitemap()],
});
