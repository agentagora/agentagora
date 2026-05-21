# `@agentagora/cloud-api` operations runbook

Steady-state ops + incident response. First-time provisioning is in [DEPLOY.md](./DEPLOY.md). Commands run from the repo root and assume `wrangler login` has succeeded. The verbose `pnpm --filter @agentagora/cloud-api exec wrangler …` prefix is intentional — copy-paste accuracy beats shell aliases when you're paged.

> **Paged in the first 24 h after launch?** This runbook is broad and comprehensive — slow to scan when half-awake. Go to [`docs/day-0-oncall.md`](../../../docs/day-0-oncall.md) instead: 5 most-likely scenarios, copy-paste commands, no preamble. Come back here once the bleeding stops.

---

## 1. Routine

### 1.1 Apply a new D1 migration

**When to do this.** A new `apps/cloud/api/migrations/000N_*.sql` file lands. Migrations are forward-only.

**Steps.**

```bash
# Local SQLite under .wrangler/state — what `wrangler dev` reads.
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local

# Sanity-check against the new schema before prod.
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test

# Inspect what would run on production.
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations list DB --remote

# Apply on production.
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --remote
```

**How to verify.**

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations list DB --remote
# New file appears under "Already applied".

pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

**Rollback.** Wrangler does not support down migrations. Write a compensating `000(N+1)_revert_*.sql`, apply it the same way, and `git revert` the Worker commit if app code changed. Snapshot (§1.3) before any destructive migration.

---

### 1.2 Sweep expired `oauth_sessions`

**When to do this.** Storage hygiene. OAuth-issued bearers live in `oauth_sessions` for 30 days (`migrations/0007_oauth_sessions.sql`); rows past `expires_at` are dead weight. The `expires_at` index makes the sweep a prefix scan.

**Steps (manual one-shot).**

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "DELETE FROM oauth_sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');"
```

**Steps (recommended cron Worker).** A `scheduled()` handler on this Worker can call `Storage.deleteExpiredOauthSessions(new Date().toISOString())` once a day (`src/d1-storage.ts:343`). Wiring it up is a ~10-line change to `src/index.ts` plus a `triggers.crons` entry in `wrangler.jsonc`. Not done today — manual sweep is fine while the OAuth user count is small.

**How to verify.**

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "SELECT COUNT(*) AS expired FROM oauth_sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');"
# Expect 0.
```

**Rollback.** Deleted sessions force the user to re-run the GitHub OAuth flow. No row-level undo short of a §1.3 restore — only run on rows whose `expires_at` is genuinely past.

---

### 1.3 Snapshot D1 backup

**When to do this.** Before destructive migrations or bulk row updates; weekly cadence otherwise.

**Steps (manual export).**

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
pnpm --filter @agentagora/cloud-api exec wrangler d1 export DB --remote \
  --output "apps/cloud/api/backups/agentagora-cloud-${TS}.sql"
```

Output is plain SQL (`CREATE TABLE` + `INSERT`), suitable for `wrangler d1 execute --file`. Store off-host (R2 / encrypted laptop / ops vault); add `apps/cloud/api/backups/` to `.gitignore` if you stage backups locally.

**Automatic backups.** D1 Time Travel keeps platform-managed snapshots on the paid tier:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 time-travel info DB --remote
```

We have **not** rehearsed a full point-in-time restore against production (see §3.4). The exported `.sql` dump is the only restore path we've actually exercised.

**How to verify.**

```bash
ls -lh apps/cloud/api/backups/agentagora-cloud-*.sql | tail -1
head -20 "apps/cloud/api/backups/agentagora-cloud-${TS}.sql"
# Expect CREATE TABLE for agents, audit_events, disputes, refunds,
# oauth_sessions, stripe_accounts, plus migration metadata.
```

**Rollback.** Snapshots are read-only. Nothing to undo.

---

### 1.4 Verify a D1 backup actually restores (quarterly drill)

**When to do this.** Quarterly, plus immediately after any migration that touches multiple tables.

**Steps.**

```bash
# 1. Fresh export.
TS=$(date -u +%Y%m%dT%H%M%SZ)
pnpm --filter @agentagora/cloud-api exec wrangler d1 export DB --remote \
  --output "/tmp/agentagora-restore-drill-${TS}.sql"

# 2. Throwaway D1 instance.
pnpm --filter @agentagora/cloud-api exec wrangler d1 create agentagora-restore-drill
# Note the printed UUID; do NOT paste into wrangler.jsonc.

# 3. Apply the dump.
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute agentagora-restore-drill --remote \
  --file "/tmp/agentagora-restore-drill-${TS}.sql"

# 4. Spot-check row counts vs production.
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute agentagora-restore-drill --remote \
  --command "SELECT (SELECT COUNT(*) FROM agents) AS agents,
                    (SELECT COUNT(*) FROM audit_events) AS audit_events,
                    (SELECT COUNT(*) FROM disputes) AS disputes;"
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "SELECT (SELECT COUNT(*) FROM agents) AS agents,
                    (SELECT COUNT(*) FROM audit_events) AS audit_events,
                    (SELECT COUNT(*) FROM disputes) AS disputes;"
# Counts match modulo writes during the drill.

# 5. Tear down.
pnpm --filter @agentagora/cloud-api exec wrangler d1 delete agentagora-restore-drill
```

**How to verify.** Steps 4 and 5. Log date / row counts in `apps/cloud/api/backups/DRILL_LOG.md` (create on first run).

**Rollback.** None — the drill never touches production.

---

### 1.6 Post-deploy smoke test

**When to do this.** Every time after `pnpm --filter @agentagora/cloud-api deploy` returns, before declaring the rollout done.

**Why.** A successful `wrangler deploy` only proves the bundle uploaded — it doesn't prove the bindings, secrets, and route wiring actually compose. The smoke script (M3 §D.5) walks the same arc as the integration test but against the deployed Worker, so a broken deploy fails loud in seconds rather than at the next user request.

**Steps.**

```bash
pnpm --filter @agentagora/cloud-api smoke -- \
  --url=https://<your-cloud-url> \
  --bearer=<one of the OWNER_TOKENS> \
  --owner-id=smoke-test
```

The script runs 8 sequential checks: `healthz` → `jwks` → `publish` → `resolve` → `catalog` → `conversation_lookup` → `owner_scoped` → `burst`. Output is a markdown PASS/FAIL table plus a JSON snapshot at `scripts/.smoke-results.json`. Exit code 0 iff every required step is `ok` or `skipped`; 1 if any is `failed`.

Without `--bearer`, the write-path steps skip cleanly — useful when a machine without `OWNER_TOKENS` access wants a quick reachability check.

**How to verify.** The script's own exit code. CI doesn't run this against production yet (no Cloudflare credentials configured); it's an on-demand operator tool. Once we wire deploy-preview credentials, this becomes a CI gate.

**Rollback.** If the smoke fails:

1. The most recent failed step is your hint — `healthz` failure means the deploy didn't bind, `publish` failure usually means a missing secret (most often `OIDC_SIGNING_KEY` or `OIDC_ISSUER`).
2. `wrangler tail` to inspect logs — the smoke's `[req=…]` IDs let you grep precisely. See §3.1.
3. If the deploy itself is bad (not a config issue), revert the deploying commit on `main` and redeploy.

**Cleanup quirk.** Each smoke run publishes a fresh `aid:agentagora:smoke-test/probe-<timestamp>` agent. The cloud-api has no `DELETE /v1/agents/:aid` yet, so the agent stays. Multiple smokes don't conflict (timestamp suffix), but the public catalog accumulates probe entries. Filter them out client-side or wait for the delete route.

---

## 2. Rotation drills

Same shape every time: **set the new secret, redeploy, verify, decommission the old credential at the source**. `wrangler secret put NAME` overwrites in place — there's no staging slot — so the redeploy is what makes the new value visible to running isolates.

### 2.1 `OWNER_TOKENS`

**When.** Staff turnover, suspected leak, scheduled quarterly hygiene.

**Steps.**

```bash
# 1. Fresh per-owner token (32 random bytes, base64url).
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url") + "\n")'

# 2. Build the new comma-separated list (drop revoked owners):
#    <ownerId>:<token>,<ownerId>:<token>,...
#    ownerId is opaque for OWNER_TOKENS bearers; OAuth-issued sessions use
#    `gh:<login>` (see commit af9c416, src/oauth-github.ts). Both shapes
#    coexist — OWNER_TOKENS rotation only affects the static-bearer set.

# 3. Replace + redeploy.
pnpm --filter @agentagora/cloud-api exec wrangler secret put OWNER_TOKENS
pnpm --filter @agentagora/cloud-api deploy
```

**How to verify.**

```bash
URL=https://agentagora-cloud-api.<account>.workers.dev
NEW=<new>; OLD=<old>
curl -s -o /dev/null -w "new=%{http_code}\n" -H "Authorization: Bearer $NEW" "$URL/v1/disputes/__probe__"
curl -s -o /dev/null -w "old=%{http_code}\n" -H "Authorization: Bearer $OLD" "$URL/v1/disputes/__probe__"
# new=404 (auth passed, dispute not found); old=401.
```

**Rollback.** `wrangler secret put OWNER_TOKENS` with the previous list and redeploy. There is no persisted history — keep the previous list in your password vault until the new one is confirmed.

---

### 2.2 `OIDC_SIGNING_KEY`

**When.** Suspected key compromise, quarterly hygiene, key handled on a now-untrusted machine.

**Impact.** The `kid` is the first 16 chars of `SHA-256(public_key)` (DEPLOY.md §3). Rotating changes the `kid` deterministically, so:

- Every previously issued `identity_jwt` becomes invalid at next verify (the new JWKS no longer publishes the old `kid`).
- Consumers must refetch `/.well-known/jwks.json`. Anyone caching JWKS longer than their JWT TTL sees verification failures until their cache expires.
- Re-publishing manifests is **not** required — `OIDC_SIGNING_KEY` only signs the identity JWT, not manifest pubkeys.

**Steps.**

```bash
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url") + "\n")'
pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_SIGNING_KEY
pnpm --filter @agentagora/cloud-api deploy
```

**How to verify.**

```bash
URL=https://agentagora-cloud-api.<account>.workers.dev
curl -s "$URL/.well-known/jwks.json" | python3 -m json.tool
# `keys[0].kid` is the new value; old JWTs verified against this JWKS fail
# with "kid not found".
```

**Rollback.** Re-run with the previous private key and redeploy. JWTs issued under the new key in the interim then become invalid — prefer rolling forward unless the new key is provably broken.

---

### 2.3 `STRIPE_SECRET_KEY`

**When.** Suspected leak; rolling a Stripe restricted key; switching modes (`sk_test_…` ↔ `sk_live_…`).

**Steps.**

```bash
# 1. Stripe → Developers → API keys → "Roll key" or "Create restricted key".
#    Copy the new sk_… value somewhere ephemeral.
pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_SECRET_KEY
pnpm --filter @agentagora/cloud-api deploy
# 2. After verifying, revoke the old key in the Stripe dashboard.
```

**How to verify.**

```bash
URL=https://agentagora-cloud-api.<account>.workers.dev
TOKEN=<an OWNER_TOKENS bearer>
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
  "$URL/v1/connect/account"
# 200 (with body) or 404 (no Connect account yet) — NOT 503.
# 503 'not_configured' means the secret is missing or misnamed.
```

**Rollback.** If the new key is rejected by Stripe, swap back to the previous value and redeploy. **Do not** revoke the old key in Stripe until the new one is verified live.

---

### 2.4 `STRIPE_WEBHOOK_SECRET`

**When.** Suspected leak, quarterly hygiene, switching webhook endpoint URL.

**Why this is fiddly.** Stripe signs each delivery with the endpoint's signing secret. Swap without overlap and queued deliveries land after the secret has changed, fail verification, and enter exponential-backoff retry. Stripe lets you keep the previous signing secret active for 24 hours ("Roll secret" → "Expire current secret in 24 hours"). The cloud-api checks against a **single** `STRIPE_WEBHOOK_SECRET`, so the bridge is a brief dual-deploy, not a code-level dual-secret.

**Steps.**

```bash
# 1. Stripe → Developers → Webhooks → <endpoint> → "Roll signing secret",
#    choosing "Expire current secret in 24 hours". Copy the NEW whsec_… value.

# 2. Update + redeploy.
pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_WEBHOOK_SECRET
pnpm --filter @agentagora/cloud-api deploy

# 3. (Bridge.) Watch Stripe → Webhooks → "Recent deliveries" for ~30 minutes.
#    If signature failures from deliveries Stripe queued under the OLD secret
#    show up, swap BACK to the OLD secret briefly:
pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_WEBHOOK_SECRET
pnpm --filter @agentagora/cloud-api deploy
#    …drain the backlog with the dashboard's "Resend", then swap forward to
#    the NEW secret again.

# 4. After Stripe's 24h grace expires, you're done.
```

> A cleaner pattern is to extend `STRIPE_WEBHOOK_SECRET` to accept a comma-separated list (try-each-in-turn). Not done today — see §4.4.

**How to verify.** Stripe → Webhooks → <endpoint> → "Send test webhook" (`account.updated`). Should land as 200 in "Recent deliveries". 400 with body `invalid_signature` means the cloud-api still has the old secret.

**Rollback.** Revert to the previous `STRIPE_WEBHOOK_SECRET` (step 3) and redeploy. The Stripe-side grace window is your safety net.

---

### 2.5 `GITHUB_CLIENT_SECRET`

**When.** Suspected leak; quarterly hygiene; rotating the OAuth app.

**Important property.** OAuth-issued bearers persist in the `oauth_sessions` D1 table — they are 32 random bytes minted at callback time, **not derived from `GITHUB_CLIENT_SECRET`**. Rotating the secret only invalidates *future* OAuth handshakes; **existing sessions stay valid** until their `expires_at`. Users do not have to sign back in.

**Steps.**

```bash
# 1. GitHub → Settings → Developer settings → OAuth Apps → <your app> →
#    "Generate a new client secret". Copy the new value.
pnpm --filter @agentagora/cloud-api exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm --filter @agentagora/cloud-api deploy
# 2. After verifying, click "Revoke" on the old secret on GitHub.
```

**How to verify.**

```bash
URL=https://agentagora-cloud-api.<account>.workers.dev
curl -s -o /dev/null -w "%{http_code}\n" "$URL/v1/auth/github/start"
# 302 with a Location header pointing at github.com/login/oauth/authorize.
# 503 means GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, or OIDC_SIGNING_KEY is unset.
```

End-to-end, drive a fresh GitHub login through the dashboard and confirm the callback completes.

**Rollback.** Re-run with the previous value and redeploy. **Do not** revoke the old secret on GitHub until the new one is verified live.

---

### 2.6 `DASHBOARD_COOKIE_SECRET`

**When.** Suspected leak of the dashboard cookie key; quarterly hygiene.

**Where this lives.** Set on the **dashboard** (`apps/cloud/dashboard`), not on cloud-api. Covered here so the rotation portfolio is in one place; canonical config is `apps/cloud/dashboard/lib/cookie.ts` (key derives via `SHA-256(DASHBOARD_COOKIE_SECRET)`).

**Impact.** Dashboard sessions are AES-256-GCM encrypted with a key derived from this secret. Rotating it makes every existing session cookie undecryptable — users see a forced logout. Coordinate with users (announce in `#announcements`, do it during low traffic).

**Steps.**

```bash
# 1. Fresh 32-byte secret.
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url") + "\n")'

# 2. Set on the dashboard host. For Vercel:
vercel env add DASHBOARD_COOKIE_SECRET production
#    For self-hosted Node, replace the env var in your secret store and
#    restart. Cloud-api itself does NOT consume this secret.

# 3. Redeploy the dashboard so the new value is loaded.
```

**How to verify.** Open the dashboard in a fresh browser; the existing cookie no longer decrypts and you're bounced to `/login`. Sign in; the new cookie is minted under the new key.

**Rollback.** Restore the previous secret on the dashboard host and redeploy. Sessions issued under the new key become unreadable in turn — the rotation is one-way; roll forward unless the new value is provably wrong.

---

## 3. Incident response

### 3.1 cloud-api is down

**Symptoms.** `/healthz` non-200, dashboard "Cloud unreachable" banner, Stripe webhook deliveries spiking red.

**Diagnostic checklist.**

```bash
URL=https://agentagora-cloud-api.<account>.workers.dev
STATUS_URL=https://<status-worker-host>  # see apps/status/wrangler.jsonc

# 0. Outside vantage point — the status Worker probes UPSTREAM_HEALTHZ per
#    request, so this tells you whether cloud-api was reachable from a
#    different network in the last few seconds. If a user reported the
#    incident, ask for the `X-Request-Id` from their failed response (or
#    the `request_id` field in the JSON body) — every cloud-api response
#    carries one and it lets you grep `wrangler tail` for the exact log
#    lines for that request:
#      pnpm --filter @agentagora/cloud-api exec wrangler tail --search "req=req_…"
curl -s "$STATUS_URL/status.json" | python3 -m json.tool

# 1. Liveness — should be 200 with `{ ok: true }`. The response carries
#    `X-Request-Id: req_…` like every other cloud-api response.
curl -i "$URL/healthz"

# 2. Cloudflare platform status (rules out platform outage).
curl -s https://www.cloudflarestatus.com/api/v2/status.json | python3 -m json.tool

# 3. Recent deploys.
pnpm --filter @agentagora/cloud-api exec wrangler deployments list

# 4. Live logs — most useful single tool.
pnpm --filter @agentagora/cloud-api exec wrangler tail
pnpm --filter @agentagora/cloud-api exec wrangler tail --status error

# 5. D1 reachable?
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "SELECT 1 AS ok;"

# 6. Secrets present?
pnpm --filter @agentagora/cloud-api exec wrangler secret list
#    Expect OWNER_TOKENS, OIDC_SIGNING_KEY, OIDC_ISSUER, STRIPE_SECRET_KEY,
#    STRIPE_WEBHOOK_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET.
```

**Most common causes (ordered by frequency).**

1. A deploy went out with a regression. Roll back: `wrangler rollback <previous-deployment-id>`.
2. A secret got cleared or renamed. Re-run the relevant §2 procedure.
3. D1 binding UUID drift (someone re-ran `wrangler d1 create` and didn't update `wrangler.jsonc`). Confirm against `wrangler d1 list`.
4. Cloudflare platform incident — wait it out.

**Rollback.**

```bash
pnpm --filter @agentagora/cloud-api exec wrangler deployments list
pnpm --filter @agentagora/cloud-api exec wrangler rollback <deployment-id>
```

**Honest gap.** No on-call rotation today — the maintainer is the on-call.

---

### 3.2 Stripe webhook deliveries failing

**Symptoms.** Stripe → Webhooks → <endpoint> → "Recent deliveries" red. Logs show `400 invalid_signature` or `503 not_configured` on `POST /v1/stripe/webhook`.

**Triage.**

```bash
# Worker side — secret set?
pnpm --filter @agentagora/cloud-api exec wrangler secret list | grep STRIPE_WEBHOOK_SECRET

# Watch live deliveries.
pnpm --filter @agentagora/cloud-api exec wrangler tail --search "/v1/stripe/webhook"
```

- **Signature failures** → most likely a half-finished §2.4 rotation. Either swap back to the previous secret (Stripe's 24h grace keeps the old one valid) or wait the grace out.
- **5xx** → code regression. Roll back per §3.1.

**Replay.** After the root cause is fixed: Stripe → Webhooks → <endpoint> → Recent deliveries → filter "Failed" → "Resend" each. Idempotency is safe: cloud-api uses `INSERT OR IGNORE` on `refunds.refund_id` and a `WHERE state='open'` guard on dispute resolution.

**Rollback.** §3.1 if it's a deploy regression; otherwise failed deliveries expire from Stripe's retention window on their own.

---

### 3.3 Mass dispute filing / abuse

**Symptoms.** `wrangler tail --search "/v1/disputes"` floods, `RATE_LIMITS` KV counters saturated, third-party complaints.

**Immediate lever — drop an owner from `OWNER_TOKENS`.** Once the redeploy finishes, every new request validates against the updated list.

```bash
# 1. Build the new list omitting the abusive owner. (No `wrangler secret get`
#    by design — copy from the password vault where the previous list is logged.)
# 2. Replace + redeploy.
pnpm --filter @agentagora/cloud-api exec wrangler secret put OWNER_TOKENS
pnpm --filter @agentagora/cloud-api deploy
```

**OAuth-issued bearer revocation.** OAuth bearers don't live in `OWNER_TOKENS` — they're rows in `oauth_sessions`. To kill all of an owner's OAuth sessions:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "DELETE FROM oauth_sessions WHERE owner_id = '<gh:username>';"
```

**Emergency rate-limit lever.** The per-route caps in `README.md` "Rate limiting" are hard-coded in `src/index.ts`. To lower them under fire, edit the constant (e.g. drop the `disputes` cap from 5 to 1), redeploy, revert when traffic normalises:

```bash
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test
pnpm --filter @agentagora/cloud-api deploy
```

**Honest gap.** No runtime knob for rate limits today — every change is a code change.

**How to verify.**

```bash
URL=https://agentagora-cloud-api.<account>.workers.dev
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <revoked>" \
  -H "Content-Type: application/json" -d '{}' "$URL/v1/disputes"
# 401 unauthorized.
```

**Rollback.** Re-add the owner to `OWNER_TOKENS`. OAuth sessions deleted via SQL cannot be restored — the user signs in again.

---

### 3.4 D1 row corruption suspected

**Symptoms.** Audit chain hash mismatches on `POST /v1/audit/ingest`; dispute IDs returning `404` that should exist; manifest list with impossible fields.

**Steps.**

```bash
# 1. STOP writes from the offending source — usually OWNER_TOKENS revocation
#    per §3.3, or a temporary deploy that 503s the affected route.

# 2. Capture a forensic snapshot BEFORE doing anything else.
TS=$(date -u +%Y%m%dT%H%M%SZ)
pnpm --filter @agentagora/cloud-api exec wrangler d1 export DB --remote \
  --output "/tmp/agentagora-forensic-${TS}.sql"

# 3. Inspect suspicious rows.
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "SELECT * FROM audit_events WHERE conversation_id = '<id>' ORDER BY ts;"

# 4. Point-in-time restore (D1 paid tier).
pnpm --filter @agentagora/cloud-api exec wrangler d1 time-travel info DB --remote
pnpm --filter @agentagora/cloud-api exec wrangler d1 time-travel restore DB --remote \
  --bookmark <bookmark-id>
#    Restoring overwrites the database — there is NO automatic snapshot of
#    the pre-restore state. Your step-2 export is the only path back.
```

**Honest gap.** We have not rehearsed `time-travel restore` against a non-production D1 instance — that path remains the day-we-need-it discovery. The plainer export → scratch-restore → query path (no time-travel) IS rehearsable via `apps/cloud/api/scripts/pit-restore-drill.sh` (maintainer-tasks.md §M.11): phase 1 plants a sentinel row, phase 2 (after ≥ 1 h) exports prod, imports into a scratch D1, queries the sentinel, and tears down. Running that quarterly covers the "can our backups even be replayed" half of the durability question; time-travel restore stays a separate, untested branch.

**How to verify.** Re-run the queries from step 3 against the restored database; counts reflect the bookmark's timestamp.

**Rollback.** None — `time-travel restore` is destructive. The forensic export from step 2 is the only path back to the post-incident state for forensic comparison.

---

## 4. Capacity + observability

This section is intentionally short. Real production observability isn't built out yet.

### 4.1 Bundle-size budget

CI enforces **≤ 320 KiB raw / ≤ 75 KiB gzipped** on the cloud-api Worker bundle (`.github/workflows/typescript.yml`, "Enforce bundle-size budget" step) via `wrangler deploy --dry-run`. Catches dependency creep before it hits the Cloudflare 1 MiB Worker ceiling.

### 4.2 Logs

```bash
pnpm --filter @agentagora/cloud-api exec wrangler tail
pnpm --filter @agentagora/cloud-api exec wrangler tail --status error
pnpm --filter @agentagora/cloud-api exec wrangler tail --search "/v1/stripe/webhook"
```

`wrangler tail` is the only live log surface today. No retention beyond Cloudflare's default observability dashboard, no SIEM aggregation, no structured query language.

### 4.3 Latency benchmark as observability proxy

The CI `latency-bench` job starts `wrangler dev` against a fresh build and runs `pnpm --filter @agentagora/cloud-api bench`, producing median + p95 per endpoint and failing the PR on regression. It tests against a local Worker, not production — the only latency gate we have until M3 §A.5 lands a synthetic prod benchmark.

### 4.4 What we don't have yet

- **No formal SLO.** "p95 < 200ms" is a PRD §9.3 #4 target, not a paged-on alert.
- **No on-call rotation.** Maintainer is on-call.
- **Status page.** `apps/status/` is a live stateless Worker that probes `UPSTREAM_HEALTHZ` per request and serves HTML at `/` plus JSON at `/status.json`. Deploy with `pnpm --filter @agentagora/status deploy`; monitor via `wrangler tail` against the `@agentagora/status` Worker. Configuration + thresholds are in `apps/status/README.md`.
- **No prod log aggregation** beyond the Cloudflare dashboard.
- **No PIT-restore drill** against production D1 (§3.4).
- **No multi-secret support** for `STRIPE_WEBHOOK_SECRET` (§2.4 brief dual-deploy is the workaround).

These gaps are §D of `docs/m3-launch-checklist.md` — this runbook closes D.1, D.2, and D.3, and acknowledges D.7 + the rest as open.
