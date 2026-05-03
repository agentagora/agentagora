import { defineConfig } from "vitest/config";

// Coverage thresholds locked to the M3 §D gate. Numbers were measured
// against the current test suite and set ~5pp below the live baseline so
// CI doesn't flap on small refactors. Bump these as the suite grows.
//
// Baseline at lock-in:
//   statements 87.79% / branches 85.49% / functions 75.22% / lines 87.79%
//
// Provider is v8 (built into vitest, no extra dep). Coverage only runs
// when --coverage is passed (CI workflow + local opt-in); plain
// `pnpm test` stays fast and unchanged.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 82,
        branches: 80,
        functions: 70,
        statements: 82,
      },
    },
  },
});
