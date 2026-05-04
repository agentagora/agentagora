import { defineConfig } from "vitest/config";

// First-cut test config for the dashboard. Today this only covers the
// pure-logic helpers under `lib/` (cookie crypto, manifest signing,
// auth session) — no React rendering, no Server Components. Coverage
// thresholds are intentionally not set yet; baseline-locking is a
// future round once the suite is broader.
//
// Provider is v8 (built into vitest, no extra dep).
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
    },
  },
});
