import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

// https://astro.build/config
//
// Build-time env wiring for the catalog section on the landing page
// (read via `process.env` in `src/pages/index.astro`'s frontmatter):
//
//   AGENTAGORA_CLOUD_URL     — base URL of the cloud-api whose
//                              `GET /v1/agents` we render at build time.
//                              Default: production. Override at deploy
//                              time to point at staging or a preview.
//   AGENTAGORA_DASHBOARD_URL — base URL the "View on dashboard" CTA
//                              links to (`/agents/<aid>`). Defaults to
//                              the production dashboard.
//
// Both are server-only — the catalog renders at build time and nothing
// is hydrated into the client bundle.
export default defineConfig({
  site: "https://agentagora.dev",
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
  ],
});
