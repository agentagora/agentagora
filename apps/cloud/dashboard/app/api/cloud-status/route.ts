/**
 * GET /api/cloud-status
 *
 * Server-side probe of `${AGENTAGORA_CLOUD_URL}/healthz` so the
 * dashboard's topbar status pill has a same-origin endpoint to poll
 * (browser → /api/cloud-status → cloud-api/healthz). Going through
 * the dashboard server side avoids the cross-origin CORS dance that
 * the live `/healthz` endpoint doesn't otherwise advertise.
 *
 * Stateless — each request is a fresh probe with a 2 s timeout.
 * No retry; the client polls every 30 s and a single tick missing
 * is fine.
 */

import { NextResponse } from "next/server";
import { BASE_URL } from "../../../lib/cloud-api";

export const runtime = "nodejs";
// Don't let Next.js cache this — every poll should hit cloud-api fresh.
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 2_000;

type Status = "operational" | "degraded" | "down";

interface ProbeResult {
  status: Status;
  latency_ms: number;
  upstream: string;
  checked_at: string;
  http_status?: number;
  message?: string;
}

export async function GET(): Promise<Response> {
  const upstream = `${BASE_URL.replace(/\/+$/, "")}/healthz`;
  const startedAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(upstream, {
      signal: ctrl.signal,
      cache: "no-store",
      method: "GET",
    });
    const latency = Date.now() - startedAt;

    if (res.ok) {
      // Slow but successful — surface as "degraded" so the pill
      // glows amber instead of green. 750 ms is well past any
      // reasonable local-dev / production latency for a healthz.
      const status: Status = latency > 750 ? "degraded" : "operational";
      const result: ProbeResult = {
        status,
        latency_ms: latency,
        upstream,
        checked_at: new Date().toISOString(),
        http_status: res.status,
      };
      return NextResponse.json(result, { status: 200 });
    }

    const result: ProbeResult = {
      status: "degraded",
      latency_ms: latency,
      upstream,
      checked_at: new Date().toISOString(),
      http_status: res.status,
      message: `cloud-api returned HTTP ${res.status}`,
    };
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const latency = Date.now() - startedAt;
    const result: ProbeResult = {
      status: "down",
      latency_ms: latency,
      upstream,
      checked_at: new Date().toISOString(),
      message: err instanceof Error ? err.message : String(err),
    };
    return NextResponse.json(result, { status: 200 });
  } finally {
    clearTimeout(timer);
  }
}
