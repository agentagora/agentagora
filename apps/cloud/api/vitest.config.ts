import { defineConfig } from "vitest/config";

// Coverage thresholds locked to the M3 §D gate. Numbers were measured
// against the current test suite and set ~5pp below the live baseline so
// CI doesn't flap on small refactors. Bump these as the suite grows.
//
// Baseline at lock-in (M3 close):
//   statements 72.68% / branches 87.32% / functions 80.12% / lines 72.68%
//
// State after Hono 4.6 → 4.12.18 + M7/M9/M10/M11/L4 hardening pack:
//   statements 66.84% / branches 87.46% / functions 80.89% / lines 66.84%
//
// Hono's patch bump grew the transitively-included framework surface,
// and the M7+M9+M10+M11+L4 security pack added fail-closed checks +
// body-limit middleware + auth-before-503 fallbacks whose branches
// only fired under environment / payload conditions the unit suite
// didn't simulate. The lines/statements floor was dropped from 67
// to 65 as a stop-gap while the backfill was tracked under M.18.
//
// Post-M.18 backfill (build-app.test.ts + body-limit.test.ts + L4
// connect tests added 2026-05-20):
//   statements 86.21% / branches 87.73% / functions 83.70% / lines 86.21%
//
// Floors bumped back above the original M3 gate (with ~6pp buffer
// against the new baseline, matching the existing convention).
//
// Provider is v8 (built into vitest, no extra dep). Coverage only runs
// when --coverage is passed (CI workflow + local opt-in); plain
// `pnpm test` stays fast and unchanged.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // Coverage measures production source under src/. Dev-time
      // tooling (scripts/, bench/) and config files are explicitly
      // excluded so adding a new helper script doesn't dilute the
      // statement / line ratios without contributing testable
      // production code. v8's own defaults already drop node_modules,
      // tests, dist, and config files.
      exclude: [
        "scripts/**",
        "bench/**",
        "tests/**",
        "*.config.*",
        ".wrangler/**",
        "dist/**",
        "node_modules/**",
      ],
      thresholds: {
        lines: 80,
        branches: 82,
        functions: 78,
        statements: 80,
      },
    },
  },
});
