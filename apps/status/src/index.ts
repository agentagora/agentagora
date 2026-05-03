/**
 * AgentAgora public status page.
 *
 * Pull-based: each request probes `UPSTREAM_HEALTHZ` once (with a single
 * retry on failure / non-200) and reports the result. There is no KV /
 * D1 / scheduled job — the page is intentionally stateless so it can
 * never serve stale data.
 *
 * Status thresholds:
 *   - operational : first attempt returns 200 within 5 s.
 *   - degraded    : second attempt returns 200, OR either attempt
 *                   returned a non-200 HTTP response.
 *   - down        : both attempts threw (network error / timeout).
 */

import { Hono } from "hono";

export type Status = "operational" | "degraded" | "down";

export interface Env {
  UPSTREAM_HEALTHZ?: string;
}

export interface StatusReport {
  service: string;
  status: Status;
  checked_at: string;
  latency_ms: number;
  message?: string;
}

const SERVICE = "agentagora-cloud-api";
const PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_UPSTREAM = "http://localhost:8787/healthz";

interface ProbeResult {
  ok: boolean;
  httpStatus?: number;
  error?: string;
}

/**
 * Single probe with a 5-second AbortController timeout. Resolves with
 * `{ ok }` derived from `response.ok` (200-299) on a completed fetch, or
 * `{ ok: false, error }` if the fetch threw / aborted.
 */
async function probeOnce(url: string, fetchImpl: typeof fetch): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, method: "GET" });
    return { ok: res.ok, httpStatus: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkUpstream(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StatusReport> {
  const startedAt = Date.now();
  const first = await probeOnce(url, fetchImpl);
  if (first.ok) {
    return {
      service: SERVICE,
      status: "operational",
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
    };
  }

  const second = await probeOnce(url, fetchImpl);
  const latency = Date.now() - startedAt;

  if (second.ok) {
    return {
      service: SERVICE,
      status: "degraded",
      checked_at: new Date().toISOString(),
      latency_ms: latency,
      message: "Recovered on retry",
    };
  }

  // Both attempts failed.
  const bothErrored = first.error !== undefined && second.error !== undefined;
  if (bothErrored) {
    return {
      service: SERVICE,
      status: "down",
      checked_at: new Date().toISOString(),
      latency_ms: latency,
      message: `Upstream unreachable: ${second.error ?? first.error}`,
    };
  }

  // At least one attempt got an HTTP response, just not a 2xx.
  const lastStatus = second.httpStatus ?? first.httpStatus;
  return {
    service: SERVICE,
    status: "degraded",
    checked_at: new Date().toISOString(),
    latency_ms: latency,
    message:
      lastStatus !== undefined ? `Upstream returned HTTP ${lastStatus}` : "Upstream unhealthy",
  };
}

function badgeColor(status: Status): string {
  if (status === "operational") return "#0a7d2e";
  if (status === "degraded") return "#b87600";
  return "#a01818";
}

function renderHtml(report: StatusReport): string {
  const color = badgeColor(report.status);
  const label = report.status.toUpperCase();
  const msg = report.message ? `<p>${escapeHtml(report.message)}</p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentAgora Status</title><style>body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#fafafa;color:#111;margin:0;padding:48px;max-width:640px}h1{font-size:18px;text-transform:uppercase;letter-spacing:.1em;margin:0 0 24px;border-bottom:2px solid #111;padding-bottom:8px}.badge{display:inline-block;padding:24px 32px;font-size:32px;font-weight:700;letter-spacing:.05em;color:#fff;background:${color};border:3px solid #111;box-shadow:6px 6px 0 #111}p{font-size:14px;line-height:1.5;margin:24px 0 0}a{color:#111;border-bottom:1px solid #111;text-decoration:none}a:hover{background:#111;color:#fafafa}.meta{color:#555;font-size:12px;margin-top:32px;padding-top:16px;border-top:1px dashed #888}</style></head><body><h1>AgentAgora &mdash; ${escapeHtml(report.service)}</h1><div class="badge">${label}</div>${msg}<p>Last check: <code>${escapeHtml(report.checked_at)}</code> (${report.latency_ms} ms)</p><p><a href="/status.json">status.json</a></p><div class="meta">Stateless probe &mdash; each request runs its own check. No history retained.</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/", async (c) => {
    const url = c.env.UPSTREAM_HEALTHZ ?? DEFAULT_UPSTREAM;
    const report = await checkUpstream(url);
    return c.html(renderHtml(report));
  });

  app.get("/status.json", async (c) => {
    const url = c.env.UPSTREAM_HEALTHZ ?? DEFAULT_UPSTREAM;
    const report = await checkUpstream(url);
    return c.json(report);
  });

  return app;
}

const app = createApp();
export default app;
