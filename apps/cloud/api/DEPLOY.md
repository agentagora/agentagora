# `@agentagora/cloud-api` deploy quick-reference

Maintainer cheat-sheet for code-change redeploys, migration applies, secret rotations, rollbacks, and Stripe-failure triage. Assumes you already have a deployed cloud-api with all secrets set.

> **First-time setup?** This file does **not** cover provisioning a fresh Cloudflare account, generating signing keys, configuring secrets, or wiring the GitHub OAuth / Stripe integrations. For that, go to [`docs/self-host-guide.md`](../../../docs/self-host-guide.md) — it's the standalone end-to-end runbook. This file picks up after that runbook finishes.

Commands run from the repo root and assume `wrangler login` has succeeded.

---

## Deploy a code change

```bash
# Pre-flight
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test
pnpm --filter @agentagora/cloud-api check

# Ship
pnpm --filter @agentagora/cloud-api deploy

# Smoke immediately — fail loud before traffic notices
pnpm --filter @agentagora/cloud-api smoke -- \
  --url=https://<your-cloud-url> \
  --bearer=<one of OWNER_TOKENS> \
  --owner-id=<the matching ownerId>
```

Smoke walks 8 sequential checks (healthz → JWKS → publish → resolve → catalog → conversation → owner-scope → burst), prints a markdown table, and exits 1 on any failure.

---

## Apply a new migration

Migrations are forward-only. Always apply local first.

```bash
# Local (.wrangler/state SQLite — what wrangler dev reads)
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local

# Production
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --remote

# Verify
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations list DB --remote
```

Schema lives in `apps/cloud/api/migrations/`. Add new migrations as `000N_*.sql`.

> **No down-migrations.** To roll back schema: write a compensating `000(N+1)_revert_*.sql` and apply it the same way. Snapshot before any destructive migration — see [`RUNBOOK.md`](RUNBOOK.md) §1.3.

---

## Rotate a secret

Every secret is set via `wrangler secret put <NAME>`. Re-running with the same name replaces the value.

| Secret | Rotation impact |
|---|---|
| `OWNER_TOKENS` | Clients re-authenticate with the new bearer; old bearers stop working at next request |
| `OIDC_SIGNING_KEY` | All issued JWTs become invalid at next verify; consumers must refetch JWKS |
| `STRIPE_SECRET_KEY` | New Connect-account creations use the new key; existing accounts unaffected |
| `STRIPE_WEBHOOK_SECRET` | Stripe-side: regenerate signing secret in the dashboard; paste it back |
| `GITHUB_CLIENT_SECRET` | Existing OAuth-issued bearers stay valid (stored in `oauth_sessions`, not derived from the secret); only new sign-ins use the new value |
| `DASHBOARD_COOKIE_SECRET` | All active dashboard sessions invalidated at next request |

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put <NAME>
# Paste new value
```

After rotating, redeploy isn't required — Workers pick up new secret values on the next request.

---

## Rolling back a release

D1 migrations are forward-only (no built-in down migrations). To roll back a code-only release:

```bash
git revert <commit-sha>
pnpm --filter @agentagora/cloud-api deploy
```

Schema rollback (if needed) is a manual SQL operation: write a compensating `000(N+1)_revert_*.sql` and apply it. D1 keeps automatic backups; `wrangler d1 backup` can restore at the row level if a migration corrupts data.

Always test migrations on `--local` first.

---

## Triaging Stripe failures (`request_id` correlation)

When `/v1/connect/*` returns `502 stripe_unavailable` or `/v1/stripe/webhook` returns `500 handler_failed`, the response body carries an opaque `request_id` (security-review-2026-05 §L1: no Stripe-side trace data leaks to the caller). The verbose Stripe error is logged server-side.

```bash
pnpm --filter @agentagora/cloud-api exec wrangler tail \
  --search "request_id=<paste id here>"
```

The matching `[connect] Stripe …` or `[stripe-webhook] handler failed …` log line carries the full Stripe error (status + body) for diagnosis.

---

## Related docs

- [`docs/self-host-guide.md`](../../../docs/self-host-guide.md) — first-time provisioning, end-to-end
- [`RUNBOOK.md`](RUNBOOK.md) — steady-state ops, secret rotation hygiene, PIT restore drills
- [`docs/day-0-oncall.md`](../../../docs/day-0-oncall.md) — paged-at-3am cheat-sheet for the first 24 h after launch
