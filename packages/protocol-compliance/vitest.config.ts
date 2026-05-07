import { defineConfig } from "vitest/config";

// Compliance suite is a *runtime* check against a deployed cloud-api,
// not a unit test against in-process code. By default the runner
// targets `http://localhost:8787` (i.e., `wrangler dev` in another
// terminal); set `AAP_BASE_URL` to point at a deployed candidate.
//
// We don't gate coverage here — these tests are integration probes
// and coverage of the compliance package's own code is not the
// signal we care about.
export default defineConfig({
  test: {
    // Conformance probes hit the network; default 5s vitest timeout
    // is too tight for a cold cloud-api. 30s is generous enough that
    // a slow first-request through Cloudflare's edge cache doesn't
    // false-fail.
    testTimeout: 30_000,
    // Run sequentially to keep failure output readable when a
    // candidate is partially broken — interleaved fails are noisy.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
