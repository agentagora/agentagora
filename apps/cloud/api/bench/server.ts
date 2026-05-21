/**
 * Bench host for the cloud-api latency benchmark.
 *
 * Why this exists: the original M3 §A.5 latency-bench job in
 * .github/workflows/typescript.yml used `wrangler dev` as the
 * server-under-test, backgrounded with `nohup ... &`. That setup
 * never reliably detached from the GitHub Actions runner shell —
 * the step hung to the job timeout on every run — so the job
 * was disabled (commit reference in typescript.yml's comment
 * block) and M.12 in docs/maintainer-tasks.md has been stuck
 * waiting on either a setsid-style detach fix or this: host the
 * same Hono app via @hono/node-server instead.
 *
 * Trade-off: this measures Hono routing + Node http stack, not
 * the production Workers runtime. For *regression detection*
 * (the whole point of M.12's gate) that's the right granularity
 * — drift in our own code is what we want to catch, and the
 * Cloudflare edge cost is roughly constant across deploys.
 * Absolute latency to the prod edge is a separate question that
 * belongs in a deploy-time smoke test, not in a CI gate.
 *
 * Usage:
 *   pnpm --filter @agentagora/cloud-api bench:server   # foreground
 *   BENCH_PORT=9090 pnpm --filter @agentagora/cloud-api bench:server
 *
 * In CI: started in the background with the runner's & operator
 * — Node's own event loop holds the process open without any
 * nohup/setsid choreography (this was the wrangler-specific
 * problem). The CI job then waits for /healthz, runs bench.ts,
 * and lets the runner clean up the listener on job exit.
 */

import { serve } from "@hono/node-server";
import { createApi } from "../src/index.js";

const PORT = Number.parseInt(process.env.BENCH_PORT ?? "8787", 10);
const HOST = process.env.BENCH_HOST ?? "127.0.0.1";

const app = createApi();

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[bench-server] listening on http://${info.address}:${info.port}`);
});
