/**
 * Cloud-API control-plane synthetic latency benchmark.
 *
 * Per PRD §9.3 #4 the cloud control plane must add < 200 ms p95 of
 * overhead to read paths it serves. M3 §A.5 promotes that from a soft
 * goal to a measured CI signal: this script exercises the hot read
 * paths against a `wrangler dev` instance, computes p50 / p95 per
 * route, and exits non-zero if either threshold is exceeded.
 *
 * What we measure:
 *   - GET /healthz                       — pure routing baseline
 *   - GET /v1/agents                     — public list (InMemoryStorage
 *                                           in test env, but representative
 *                                           of the hot read path)
 *   - GET /v1/agents/:aid                — single read; the 404 branch
 *                                           is intentional, we measure
 *                                           routing + JSON serialization,
 *                                           not D1 latency
 *   - GET /v1/conversations/:id          — same shape as above
 *   - GET /.well-known/jwks.json         — only when OIDC is wired; if
 *                                           the server returns 503 the
 *                                           route is skipped, not failed
 *
 * Methodology:
 *   - 100 iterations per path (override with BENCH_ITERATIONS).
 *   - First 10 samples per path are warm-up and discarded — wrangler
 *     dev pays a one-time isolate-init cost on the first hit and Hono
 *     lazily compiles route trees, both of which would otherwise skew
 *     p95.
 *   - Each request is timed end-to-end with `performance.now()`,
 *     including reading the response body so we measure serialization,
 *     not just headers.
 *   - Sequential, not concurrent: we want per-request overhead, not
 *     server throughput. (Throughput is a separate question; keeping
 *     the bench single-threaded keeps the numbers comparable across
 *     CI runners.)
 *
 * Outputs:
 *   - markdown table to stdout (so a CI summary step can capture it)
 *   - JSON file at `bench/results.json` for artifact upload / PR
 *     comments
 *
 * Threshold reasoning (defaults, env-overridable):
 *   - LATENCY_P50_MS_LIMIT=100  median per-request overhead. Half the
 *     200 ms p95 budget — keeps headroom for tail blow-ups and for the
 *     ~30-50 ms of fixed Cloudflare edge time we'll see in production
 *     once the dev environment is replaced with a real Worker.
 *   - LATENCY_P95_MS_LIMIT=200  the PRD §9.3 #4 acceptance criterion
 *     itself. Once green for 2 weeks the CI step is promoted from
 *     informational to required.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RouteSpec {
  /** Display name for the markdown table / JSON output. */
  name: string;
  /** Path appended to BASE_URL. */
  path: string;
  /** HTTP method (always GET for the read-path bench). */
  method: "GET";
  /** Status codes that count as a successful sample. Anything outside
   * this set fails the bench — we don't want a misrouted request
   * silently producing a fast 404 from the Workers shim. */
  acceptStatuses: number[];
  /** When true and every response in the warm-up phase returns 503
   * not_configured, the route is skipped (not failed). Used for
   * /.well-known/jwks.json which only works once OIDC is wired. */
  skipOn503?: boolean;
}

interface RouteResult {
  name: string;
  path: string;
  method: string;
  iterations: number;
  warmup: number;
  measured: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  status: "ok" | "skipped" | "failed";
  reason?: string;
}

interface BenchReport {
  generatedAt: string;
  baseUrl: string;
  iterations: number;
  warmup: number;
  thresholds: { p50Ms: number; p95Ms: number };
  results: RouteResult[];
  worstP50Ms: number;
  worstP95Ms: number;
  passed: boolean;
}

const BASE_URL = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:8787";
const ITERATIONS = Number.parseInt(process.env.BENCH_ITERATIONS ?? "100", 10);
const WARMUP = Number.parseInt(process.env.BENCH_WARMUP ?? "10", 10);
const P50_LIMIT = Number.parseFloat(process.env.LATENCY_P50_MS_LIMIT ?? "100");
const P95_LIMIT = Number.parseFloat(process.env.LATENCY_P95_MS_LIMIT ?? "200");
const RESULTS_PATH = resolve(__dirname, "results.json");

const ROUTES: RouteSpec[] = [
  {
    name: "healthz",
    path: "/healthz",
    method: "GET",
    acceptStatuses: [200],
  },
  {
    name: "agents.list",
    path: "/v1/agents",
    method: "GET",
    acceptStatuses: [200],
  },
  {
    // Deliberately a non-existent agent — we benchmark routing + JSON,
    // not data lookup. 404 is the expected status.
    name: "agents.get",
    path: "/v1/agents/bench-nonexistent",
    method: "GET",
    acceptStatuses: [200, 404],
  },
  {
    name: "conversations.get",
    path: "/v1/conversations/bench-nonexistent",
    method: "GET",
    acceptStatuses: [200, 404],
  },
  {
    name: "jwks",
    path: "/.well-known/jwks.json",
    method: "GET",
    acceptStatuses: [200],
    skipOn503: true,
  },
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  // Nearest-rank percentile. For a sorted array of length n, the p-th
  // percentile sits at index ceil(p/100 * n) - 1 (clamped to [0, n-1]).
  // This is the same formula prom-style quantiles use and matches the
  // intuition "p95 = the 95th-fastest of 100 samples".
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] as number;
}

function mean(samples: number[]): number {
  if (samples.length === 0) return Number.NaN;
  let s = 0;
  for (const v of samples) s += v;
  return s / samples.length;
}

function fmt(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms >= 100) return ms.toFixed(0);
  if (ms >= 10) return ms.toFixed(1);
  return ms.toFixed(2);
}

async function waitForReady(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) {
        // drain body so the connection can be reused
        await res.text();
        return;
      }
      lastErr = new Error(`/healthz responded ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `cloud-api did not become ready at ${baseUrl} within ${timeoutMs}ms — last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

async function timeRequest(url: string, method: string): Promise<{ status: number; ms: number }> {
  const started = performance.now();
  const res = await fetch(url, { method });
  // Drain the body — we want to measure full serialization, not just
  // the time to first byte. Workers responses are small JSON so this
  // is cheap, but it makes the numbers honest.
  await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - started };
}

async function benchRoute(route: RouteSpec): Promise<RouteResult> {
  const url = `${BASE_URL}${route.path}`;
  const samples: number[] = [];
  let observed503 = false;
  let observed503Count = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    let status: number;
    let ms: number;
    try {
      const r = await timeRequest(url, route.method);
      status = r.status;
      ms = r.ms;
    } catch (err) {
      return {
        name: route.name,
        path: route.path,
        method: route.method,
        iterations: ITERATIONS,
        warmup: WARMUP,
        measured: samples.length,
        p50: Number.NaN,
        p95: Number.NaN,
        p99: Number.NaN,
        min: Number.NaN,
        max: Number.NaN,
        mean: Number.NaN,
        status: "failed",
        reason: `request error on iter ${i}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (status === 503 && route.skipOn503) {
      observed503 = true;
      observed503Count++;
      // Don't bother running the rest — if 503 is sticky we'll skip.
      // Still let warm-up complete so we can detect a "503 only on
      // first hit" misconfiguration vs. a true skip.
      if (i >= WARMUP && observed503Count === i + 1) break;
    }

    if (!route.acceptStatuses.includes(status) && !(status === 503 && route.skipOn503)) {
      return {
        name: route.name,
        path: route.path,
        method: route.method,
        iterations: ITERATIONS,
        warmup: WARMUP,
        measured: samples.length,
        p50: Number.NaN,
        p95: Number.NaN,
        p99: Number.NaN,
        min: Number.NaN,
        max: Number.NaN,
        mean: Number.NaN,
        status: "failed",
        reason: `unexpected status ${status} on iter ${i} (accepted: ${route.acceptStatuses.join(", ")})`,
      };
    }

    if (i >= WARMUP) samples.push(ms);
  }

  if (observed503 && samples.length === 0) {
    return {
      name: route.name,
      path: route.path,
      method: route.method,
      iterations: ITERATIONS,
      warmup: WARMUP,
      measured: 0,
      p50: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      status: "skipped",
      reason: "endpoint returned 503 not_configured (OIDC signing key not wired)",
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name: route.name,
    path: route.path,
    method: route.method,
    iterations: ITERATIONS,
    warmup: WARMUP,
    measured: samples.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? Number.NaN,
    max: sorted[sorted.length - 1] ?? Number.NaN,
    mean: mean(samples),
    status: "ok",
  };
}

function renderMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push("# cloud-api latency benchmark");
  lines.push("");
  lines.push(`- base URL: \`${report.baseUrl}\``);
  lines.push(`- iterations / route: ${report.iterations} (warm-up discarded: ${report.warmup})`);
  lines.push(
    `- thresholds: p50 ≤ ${report.thresholds.p50Ms} ms, p95 ≤ ${report.thresholds.p95Ms} ms`,
  );
  lines.push(`- generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(
    "| route | method | path | n | p50 (ms) | p95 (ms) | p99 (ms) | min | max | mean | status |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of report.results) {
    lines.push(
      `| ${r.name} | ${r.method} | \`${r.path}\` | ${r.measured} | ${fmt(r.p50)} | ${fmt(
        r.p95,
      )} | ${fmt(r.p99)} | ${fmt(r.min)} | ${fmt(r.max)} | ${fmt(r.mean)} | ${
        r.status === "ok" ? "ok" : r.status + (r.reason ? ` (${r.reason})` : "")
      } |`,
    );
  }
  lines.push("");
  lines.push(
    `**worst observed:** p50 = ${fmt(report.worstP50Ms)} ms, p95 = ${fmt(report.worstP95Ms)} ms — ${
      report.passed ? "PASS" : "FAIL"
    }`,
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  console.error(`[bench] target=${BASE_URL} iterations=${ITERATIONS} warmup=${WARMUP}`);
  console.error(`[bench] thresholds: p50 ≤ ${P50_LIMIT}ms, p95 ≤ ${P95_LIMIT}ms`);
  console.error("[bench] waiting for /healthz to come up…");
  await waitForReady(BASE_URL);
  console.error(`[bench] server ready, running ${ROUTES.length} routes`);

  const results: RouteResult[] = [];
  for (const route of ROUTES) {
    console.error(`[bench]  → ${route.method} ${route.path}`);
    const result = await benchRoute(route);
    results.push(result);
  }

  const ok = results.filter((r) => r.status === "ok");
  const worstP50 = ok.length > 0 ? Math.max(...ok.map((r) => r.p50)) : 0;
  const worstP95 = ok.length > 0 ? Math.max(...ok.map((r) => r.p95)) : 0;
  const anyFailed = results.some((r) => r.status === "failed");
  const breached = worstP50 > P50_LIMIT || worstP95 > P95_LIMIT;
  const passed = !anyFailed && !breached;

  const report: BenchReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    iterations: ITERATIONS,
    warmup: WARMUP,
    thresholds: { p50Ms: P50_LIMIT, p95Ms: P95_LIMIT },
    results,
    worstP50Ms: worstP50,
    worstP95Ms: worstP95,
    passed,
  };

  // stdout: the markdown table (CI summary captures this)
  process.stdout.write(`${renderMarkdown(report)}\n`);

  // disk: the structured form for artifact upload / PR comments
  mkdirSync(dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`[bench] wrote ${RESULTS_PATH}`);

  if (anyFailed) {
    console.error("[bench] one or more routes failed (see status column above)");
    process.exit(1);
  }
  if (breached) {
    console.error(
      `[bench] threshold breached — p50 ${fmt(worstP50)}ms (limit ${P50_LIMIT}ms), p95 ${fmt(
        worstP95,
      )}ms (limit ${P95_LIMIT}ms)`,
    );
    process.exit(1);
  }
  console.error(
    `[bench] PASS — worst p50 ${fmt(worstP50)}ms ≤ ${P50_LIMIT}ms, worst p95 ${fmt(
      worstP95,
    )}ms ≤ ${P95_LIMIT}ms`,
  );
}

main().catch((err) => {
  console.error("[bench] fatal:", err);
  process.exit(1);
});
