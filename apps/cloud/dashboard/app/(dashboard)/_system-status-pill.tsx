"use client";

/**
 * Live cloud-api status indicator for the dashboard topbar.
 *
 * Polls the dashboard's own `/api/cloud-status` route every 30 s.
 * That route in turn probes `cloud-api/healthz` server-side, so
 * we avoid the cross-origin CORS dance for a route that isn't
 * marked CORS-friendly. The pill renders one of three tones:
 *
 *   operational  green   — last probe succeeded fast (< 750 ms)
 *   degraded     amber   — last probe took > 750 ms OR returned non-2xx
 *   down         red     — last probe threw / aborted (timeout, no DNS, etc.)
 *
 * A hover tooltip surfaces the last-checked timestamp + latency +
 * any error message. The pill is decorative-but-meaningful, not
 * a button; clicking it navigates to /status (the public status
 * page) for the full report.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Status = "operational" | "degraded" | "down" | "checking";

interface ProbeResult {
  status: Exclude<Status, "checking">;
  latency_ms: number;
  upstream: string;
  checked_at: string;
  http_status?: number;
  message?: string;
}

const POLL_INTERVAL_MS = 30_000;

const TONE: Record<Status, { dot: string; bg: string; fg: string; label: string }> = {
  operational: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-50",
    fg: "text-emerald-800",
    label: "Operational",
  },
  degraded: {
    dot: "bg-amber-500",
    bg: "bg-amber-50",
    fg: "text-amber-800",
    label: "Degraded",
  },
  down: {
    dot: "bg-red-500",
    bg: "bg-red-50",
    fg: "text-red-800",
    label: "Down",
  },
  checking: {
    dot: "bg-accent-400",
    bg: "bg-accent-50",
    fg: "text-accent-600",
    label: "Checking…",
  },
};

export function SystemStatusPill() {
  const [state, setState] = useState<{
    status: Status;
    last?: ProbeResult;
    error?: string;
  }>({ status: "checking" });

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/cloud-status", { cache: "no-store" });
      if (!res.ok) {
        setState({ status: "down", error: `dashboard /api/cloud-status HTTP ${res.status}` });
        return;
      }
      const body = (await res.json()) as ProbeResult;
      setState({ status: body.status, last: body });
    } catch (err) {
      setState({
        status: "down",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void probe();
    const id = setInterval(() => {
      void probe();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [probe]);

  const tone = TONE[state.status];
  const tooltip = buildTooltip(state.status, state.last, state.error);

  return (
    <Link
      href="/status"
      title={tooltip}
      className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 sm:inline-flex ${tone.bg} ${tone.fg}`}
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {state.status === "operational" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.dot}`} />
      </span>
      <span>{tone.label}</span>
    </Link>
  );
}

function buildTooltip(
  status: Status,
  last: ProbeResult | undefined,
  error: string | undefined,
): string {
  if (status === "checking") return "Probing cloud-api…";
  if (!last) {
    return error ? `Probe failed: ${error}` : "Cloud-api status unknown.";
  }
  const checkedAt = new Date(last.checked_at).toLocaleTimeString();
  const lines = [
    `${TONE[status].label} — ${last.latency_ms} ms (last checked ${checkedAt})`,
    `Upstream: ${last.upstream}`,
  ];
  if (last.message) lines.push(last.message);
  return lines.join("\n");
}
