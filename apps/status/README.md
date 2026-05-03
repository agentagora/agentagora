# @agentagora/status

Lightweight public status page for AgentAgora. Marketing and docs sites link
here so visitors can see at a glance whether the cloud API is up.

## What it does

On every request the Worker performs a fresh probe against
`UPSTREAM_HEALTHZ` (defaults to `http://localhost:8787/healthz` for local
dev). The probe has a 5-second timeout per attempt and is retried once on
failure or non-200 response.

### Status thresholds

- `operational` — first attempt returns 200 within 5 s.
- `degraded` — second attempt returns 200, OR either attempt returns a
  non-200 HTTP status (e.g. 500, 503).
- `down` — both attempts threw (network error / abort / timeout).

## Endpoints

- `GET /` — server-rendered HTML page (brutalist, single inline `<style>`).
- `GET /status.json` — machine-readable
  `{ service, status, checked_at, latency_ms, message? }`.

## Why no KV / D1

The page is intentionally stateless. Every visitor's request is its own
probe, so we never need to write to or schedule against storage. That keeps
the Worker bundle tiny (< 50 KiB), removes a class of "stale data" bugs,
and means an outage of the status page itself is the only thing that can
mask an upstream outage. If we ever need historical uptime numbers we'll
add that as a separate aggregator Worker.

## Scripts

```sh
pnpm --filter @agentagora/status dev        # wrangler dev
pnpm --filter @agentagora/status check      # wrangler deploy --dry-run
pnpm --filter @agentagora/status deploy     # wrangler deploy
pnpm --filter @agentagora/status test       # vitest run
pnpm --filter @agentagora/status typecheck  # tsc --noEmit
```

## Configuring the upstream

Set the `UPSTREAM_HEALTHZ` var in `wrangler.jsonc` (or via
`wrangler secret`/`--var`) to point at the deployed cloud-api healthz
endpoint, e.g. `https://api.agentagora.dev/healthz`.
