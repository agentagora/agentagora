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

/**
 * Color tokens — kept in sync with `apps/marketing/tailwind.config.mjs`
 * and `apps/cloud/dashboard/tailwind.config.ts`. Inlined here because
 * the status Worker is a single-file build with no Tailwind step (the
 * bundle stays < 50 KiB).
 *
 * Status tones mirror the dashboard's `<Badge tone>` palette:
 *   success → operational, warn → degraded, danger → down.
 */
interface StatusTheme {
  pillBg: string;
  pillFg: string;
  pillBorder: string;
  dot: string;
  label: string;
  helper: string;
}

const THEMES: Record<Status, StatusTheme> = {
  operational: {
    pillBg: "#d1fae5",
    pillFg: "#065f46",
    pillBorder: "#86efac",
    dot: "#10b981",
    label: "OPERATIONAL",
    helper: "All checks passing.",
  },
  degraded: {
    pillBg: "#fef3c7",
    pillFg: "#92400e",
    pillBorder: "#fcd34d",
    dot: "#f59e0b",
    label: "DEGRADED",
    helper: "The service responded — just not as expected.",
  },
  down: {
    pillBg: "#fee2e2",
    pillFg: "#991b1b",
    pillBorder: "#fca5a5",
    dot: "#ef4444",
    label: "DOWN",
    helper: "The probe couldn't reach the service at all.",
  },
};

const STYLES = `
  *,*::before,*::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: linear-gradient(180deg, #ffffff 0%, #f5f6f8 100%);
    color: #23272f;
    font-family: 'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  ::selection { background: #23272f; color: #fff; }
  .wrap {
    max-width: 720px;
    margin: 0 auto;
    padding: 64px 24px 48px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: inherit;
    text-decoration: none;
  }
  .brand-mark {
    display: inline-flex;
    width: 28px;
    height: 28px;
    background: #23272f;
    border-radius: 6px;
    align-items: center;
    justify-content: center;
  }
  .brand-mark > span {
    display: block;
    width: 10px;
    height: 10px;
    border: 2px solid #fff;
    border-radius: 999px;
  }
  .brand-wordmark {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: #15181d;
  }
  h1 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #5a6172;
  }
  .headline {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    align-self: flex-start;
    padding: 10px 18px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.06em;
    border: 1px solid var(--pill-border);
    background: var(--pill-bg);
    color: var(--pill-fg);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--dot);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dot) 25%, transparent);
  }
  .lede {
    font-size: 22px;
    line-height: 1.35;
    color: #15181d;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .lede strong { font-weight: 600; }
  .card {
    background: #ffffff;
    border: 1px solid #e8eaee;
    border-radius: 12px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    overflow: hidden;
  }
  .card-head {
    padding: 14px 20px;
    border-bottom: 1px solid #e8eaee;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  .card-head h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #15181d;
  }
  .card-head .service {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: #5a6172;
    background: #e8eaee;
    padding: 2px 8px;
    border-radius: 6px;
  }
  .card-body { padding: 20px; }
  dl.meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 10px 24px;
    margin: 0;
    font-size: 14px;
  }
  dl.meta dt { color: #5a6172; }
  dl.meta dd { margin: 0; color: #23272f; }
  dl.meta dd code,
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    background: #e8eaee;
    color: #23272f;
    padding: 2px 8px;
    border-radius: 6px;
  }
  .message {
    margin: 20px 0 0;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--pill-bg) 70%, white);
    border-left: 3px solid var(--dot);
    border-radius: 4px;
    color: var(--pill-fg);
    font-size: 13px;
    line-height: 1.5;
  }
  .helper {
    margin: 0;
    color: #5a6172;
    font-size: 14px;
  }
  ul.legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 13px;
  }
  ul.legend li {
    display: grid;
    grid-template-columns: max-content 1fr;
    align-items: baseline;
    gap: 14px;
  }
  ul.legend .legend-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    border: 1px solid var(--row-border);
    background: var(--row-bg);
    color: var(--row-fg);
  }
  ul.legend .legend-text { color: #454b5a; }
  footer.site {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding-top: 24px;
    border-top: 1px solid #e8eaee;
    color: #5a6172;
    font-size: 12px;
    flex-wrap: wrap;
  }
  footer.site a {
    color: #23272f;
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: border-color 120ms ease;
  }
  footer.site a:hover,
  footer.site a:focus-visible { border-bottom-color: #23272f; }
  a:focus-visible, button:focus-visible {
    outline: 2px solid #363b48;
    outline-offset: 3px;
    border-radius: 4px;
  }
  @media (max-width: 540px) {
    .wrap { padding: 40px 18px 32px; }
    .lede { font-size: 18px; }
  }
`;

const LEGEND_ROWS: Array<{ status: Status; line: string }> = [
  {
    status: "operational",
    line: "first probe returns 200 within 5 s",
  },
  {
    status: "degraded",
    line: "second probe is needed, OR upstream answers with a non-2xx HTTP status",
  },
  {
    status: "down",
    line: "both probes time out or throw (no HTTP response)",
  },
];

function renderHtml(report: StatusReport): string {
  const theme = THEMES[report.status];
  const checkedAt = escapeHtml(report.checked_at);
  const service = escapeHtml(report.service);
  const messageBlock = report.message ? `<p class="message">${escapeHtml(report.message)}</p>` : "";

  const legendItems = LEGEND_ROWS.map((row) => {
    const t = THEMES[row.status];
    return `<li style="--row-bg:${t.pillBg};--row-fg:${t.pillFg};--row-border:${t.pillBorder};"><span class="legend-pill">${t.label}</span><span class="legend-text">${escapeHtml(row.line)}</span></li>`;
  }).join("");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex,nofollow">
<title>AgentAgora Status — ${theme.label.toLowerCase()}</title>
<style>${STYLES}</style>
</head>
<body style="--pill-bg:${theme.pillBg};--pill-fg:${theme.pillFg};--pill-border:${theme.pillBorder};--dot:${theme.dot};">
<div class="wrap">
  <header>
    <a class="brand" href="https://agentagora.dev" aria-label="AgentAgora home">
      <span class="brand-mark" aria-hidden="true"><span></span></span>
      <span class="brand-wordmark">AgentAgora</span>
    </a>
  </header>

  <section class="headline" aria-labelledby="status-heading">
    <h1 id="status-heading">Service status</h1>
    <span class="pill"><span class="dot" aria-hidden="true"></span>${theme.label}</span>
    <p class="lede">${escapeHtml(theme.helper)}</p>
  </section>

  <section class="card" aria-labelledby="probe-heading">
    <div class="card-head">
      <h2 id="probe-heading">Last probe</h2>
      <span class="service">${service}</span>
    </div>
    <div class="card-body">
      <dl class="meta">
        <dt>Checked</dt>
        <dd><code>${checkedAt}</code></dd>
        <dt>Latency</dt>
        <dd>${report.latency_ms} ms</dd>
        <dt>Mode</dt>
        <dd>stateless · one fresh probe per request · single retry on failure</dd>
      </dl>
      ${messageBlock}
    </div>
  </section>

  <section class="card" aria-labelledby="legend-heading">
    <div class="card-head"><h2 id="legend-heading">What these mean</h2></div>
    <div class="card-body">
      <ul class="legend">${legendItems}</ul>
    </div>
  </section>

  <footer class="site">
    <span>Stateless probe · no history retained</span>
    <span><a href="/status.json">status.json</a> · <a href="https://github.com/agentagora/agentagora" rel="noopener">github</a></span>
  </footer>
</div>
</body></html>`;
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
