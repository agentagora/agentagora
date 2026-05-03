import { defineConfig } from "vitest/config";

// Coverage thresholds locked to the M3 §D gate. Numbers were measured
// against the current test suite and set ~5pp below the live baseline so
// CI doesn't flap on small refactors. Bump these as the suite grows.
//
// Baseline at lock-in:
//   statements 72.68% / branches 87.32% / functions 80.12% / lines 72.68%
//
// Lines/statements are lower than protocol/sdk because the Worker entry
// (src/index.ts) carries large surface (D1, KV, Stripe, OIDC, OAuth,
// audit, disputes) — much of which is integration-tested through the
// route handlers rather than unit-tested. Raise these as we backfill
// unit coverage on the wiring layer.
//
// Provider is v8 (built into vitest, no extra dep). Coverage only runs
// when --coverage is passed (CI workflow + local opt-in); plain
// `pnpm test` stays fast and unchanged.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 67,
        branches: 82,
        functions: 75,
        statements: 67,
      },
    },
  },
});
