# Self-hosting AgentAgora Cloud

End-to-end runbook for standing up the AgentAgora Cloud reference implementation on your own Cloudflare account, with no DM to the maintainer required. Follow this top-to-bottom and you'll end up with:

- A live cloud-api Worker at `https://<your-worker>.workers.dev` (or a custom domain)
- An issuing identity (OIDC + JWT, Ed25519 keys you control)
- A registry where you and people you authorise can publish AAP agents
- A protocol-compliance Tier 1 + Tier 2 green-bar against your own deploy

Scope: **Cloudflare-only.** This is the M6 scope ceiling per [`m6-plan.md`](m6-plan.md) Group G.3. Non-Cloudflare deploys (Fly.io, Postgres, Turso, etc.) are a separate, larger piece of work — open a discussion if you want to scope it.

This guide is the **standalone source of truth**. You should not need to read any other doc in the repo to complete it. [`apps/cloud/api/DEPLOY.md`](../apps/cloud/api/DEPLOY.md) is now a short maintainer quick-reference for code-change redeploys; [`apps/cloud/api/RUNBOOK.md`](../apps/cloud/api/RUNBOOK.md) is for steady-state ops once you're live; [`docs/local-dev.md`](local-dev.md) is the dev-loop equivalent (everything on `localhost`, no Cloudflare account).

> **Time estimate.** First-time provisioning takes 60–90 minutes if you have nothing yet (account creation accounts for the bulk of it). A re-run on a fresh CF account, with credentials pre-collected, lands in ~30 minutes.
>
> **Cost estimate.** Cloudflare free tier covers everything in this guide. Realistic month-1 bill: **$0** until you cross 100k Worker requests / day or 5 GB D1 storage. See §10.

---

## §0. What you'll have at the end

Three URLs and a verification signal:

| Component | Default URL shape | Required? |
|---|---|---|
| cloud-api Worker | `https://agentagora-cloud-api.<your-account>.workers.dev` | **Yes** — this is the AAP service |
| Dashboard (Next.js) | `https://your-dashboard.example.com` | Optional — see §7 |
| Marketing/docs site | `https://your-site.example.com` | Optional — see §8 |
| Compliance green-bar | `pnpm --filter @agentagora/protocol-compliance test` exits 0 | **Yes** — this proves §9 |

The **only required artifact** for an AAP-compliant deploy is the cloud-api Worker + a green Tier 1 + Tier 2 compliance run. Everything else (dashboard, marketing) is operator polish.

---

## §1. Prerequisites — accounts and tools

You need each of these before §2. Skip ahead to §3 once they're all checked.

### 1.1 Local toolchain

- **Node ≥ 24 LTS** ([nodejs.org](https://nodejs.org)).
- **pnpm ≥ 10** (`npm install -g pnpm` or `corepack enable && corepack use pnpm@latest`).
- **Git**.

Verify:

```bash
node --version    # v24.x or higher
pnpm --version    # 10.x or higher
git --version
```

### 1.2 Cloudflare account

Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Free tier is sufficient. You will need:

- Email + verified phone (Cloudflare requires this before Workers will activate)
- Workers + D1 + KV enabled (all free-tier by default; no action needed beyond signup)

If you plan to use a custom domain (instead of `*.workers.dev`), add the domain to Cloudflare as a zone before §6.7.

### 1.3 GitHub OAuth app (required for dashboard sign-in)

You'll create this in §4. You can skip it if you don't intend to deploy the dashboard — the cloud-api works without it, falling back to `OWNER_TOKENS`-only authentication.

### 1.4 Stripe account (optional — only if you want settlement)

Required only if you want `/v1/connect/*` and `/v1/stripe/webhook` to return real responses. Without Stripe configured, those endpoints return `503 not_configured` and the rest of the API works normally. Sign up at [stripe.com/register](https://stripe.com/register) if you want it; details in §5.

### 1.5 What you should have collected before §2

- Cloudflare account email + login
- (Optional) A domain on Cloudflare for custom hostnames
- (If §7) A free GitHub account with OAuth app creation rights
- (If §5) A Stripe account in test mode

---

## §2. Clone, install, verify locally

```bash
git clone https://github.com/agentagora/agentagora.git
cd agentagora
pnpm install
```

Before touching anything Cloudflare-side, verify the local build works:

```bash
pnpm --filter @agentagora/sdk build
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test
```

All three should exit 0. If they don't, fix the local environment before continuing — there's no point provisioning Cloudflare resources for a broken build.

---

## §3. Cloudflare provisioning

### 3.1 Authenticate wrangler

```bash
pnpm --filter @agentagora/cloud-api exec wrangler login
```

This opens a browser; approve the OAuth grant. Verify:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler whoami
# Should print your email + account ID.
```

### 3.2 Create the `wrangler.jsonc` from the example

The repo ships `apps/cloud/api/wrangler.jsonc.example` as a template. The real `wrangler.jsonc` is git-ignored — it carries your account-specific D1 / KV resource IDs and **must never be committed**.

```bash
cp apps/cloud/api/wrangler.jsonc.example apps/cloud/api/wrangler.jsonc
```

The example file has `REPLACE_BEFORE_DEPLOY` sentinels that wrangler will refuse at deploy time — so a stray `wrangler deploy` from a fresh checkout fails fast instead of silently binding to placeholder resources.

### 3.3 Create the D1 database

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 create agentagora-cloud
```

Output:

```
✅ Successfully created DB 'agentagora-cloud' in region <REGION>
Created your new D1 database.

[[d1_databases]]
binding = "DB"
database_name = "agentagora-cloud"
database_id = "abcd1234-5678-90ef-..."
```

Open `apps/cloud/api/wrangler.jsonc` and replace `REPLACE_BEFORE_DEPLOY` in the `d1_databases[0].database_id` field with the UUID printed above.

### 3.4 Create the KV namespaces

```bash
pnpm --filter @agentagora/cloud-api exec wrangler kv namespace create NONCES
pnpm --filter @agentagora/cloud-api exec wrangler kv namespace create RATE_LIMITS
```

Each command prints an `id`. Open `apps/cloud/api/wrangler.jsonc` and paste them into the `kv_namespaces` array, matching `binding` to the namespace name.

After §3.3 + §3.4 your `wrangler.jsonc` should have **three** real IDs replacing the three `REPLACE_BEFORE_DEPLOY` sentinels.

### 3.5 Apply migrations

Migrations are forward-only. Apply them to local SQLite first (used by `wrangler dev`), then to production:

```bash
# Local (creates .wrangler/state SQLite)
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local

# Production
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --remote
```

Migration files live in `apps/cloud/api/migrations/`. They run in order (`0001_*.sql`, `0002_*.sql`, …); wrangler tracks applied versions in a metadata table.

Verify production schema landed:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

You should see ~10 tables including `agents`, `manifests`, `audit_events`, `disputes`, `oauth_sessions`, `nonces`.

---

## §4. GitHub OAuth app (for dashboard sign-in)

Skip this section if you don't intend to deploy the dashboard. The cloud-api works without it.

### 4.1 Create the OAuth app

Go to [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**.

| Field | Value |
|---|---|
| Application name | `AgentAgora Cloud (<your handle>)` — visible to users on the consent screen |
| Homepage URL | `https://<your-dashboard-domain>` (use `http://localhost:3000` if you haven't picked a domain yet — you can update later) |
| Authorization callback URL | `https://<your-dashboard-domain>/login/callback` |
| Application description | Optional |

Click **Register application**. You'll be taken to the app's settings page.

### 4.2 Generate a client secret

On the app settings page, click **Generate a new client secret**. GitHub will show it **once** — copy it immediately and treat it like a database password. You'll paste it as a wrangler secret in §6.4.

### 4.3 Collect what you need for §6

- **Client ID** — shown on the settings page (format: `Iv1.xxxxxxxx` or `Ov23xxxxxxx`)
- **Client Secret** — the one you just generated
- **Callback URL** — `https://<your-dashboard-domain>/login/callback`

---

## §5. Stripe Connect platform (optional)

Skip this section if you don't intend to support settlement on this deploy. `/v1/connect/*` will return `503 not_configured` and the rest of the API works normally.

### 5.1 Activate Connect on your Stripe account

Go to [dashboard.stripe.com/connect/overview](https://dashboard.stripe.com/connect/overview) → **Get started**. Pick **Platform or marketplace**, then **Express accounts**. Stripe walks you through a 5-minute onboarding (legal entity, branding, KYC if you go live).

For self-hosting, **stay in test mode** until you're ready to handle real money. Test-mode keys (prefix `sk_test_`) are sufficient for everything in this guide.

### 5.2 Collect the keys

Go to [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys). You need:

- **Secret key** (`sk_test_...`) — for `STRIPE_SECRET_KEY` in §6.4

### 5.3 Create the webhook endpoint

In [dashboard.stripe.com/test/webhooks](https://dashboard.stripe.com/test/webhooks) → **Add endpoint**:

| Field | Value |
|---|---|
| Endpoint URL | `https://<your-worker-url>/v1/stripe/webhook` (you'll know the worker URL after §6.6) |
| Events to send | `account.updated` (the only event the closed-alpha handler acts on; others are ack'd as `200 ignored` so Stripe won't retry) |

After creating, click **Reveal signing secret** → copy the `whsec_...` value. You'll paste it as `STRIPE_WEBHOOK_SECRET` in §6.4.

> **Bootstrapping order.** Stripe needs the worker URL, but you'll only know it after §6.6. Workaround: complete §6 with the webhook secret unset (it's a 503 if missing, not a failure), then come back here, set the webhook URL + secret, and re-deploy.

---

## §6. Deploy the cloud-api

This is the heart of the runbook. Eight wrangler secrets, one deploy command, one smoke test.

### 6.1 Generate the OIDC signing key

The cloud-api issues identity JWTs signed with Ed25519. Generate a fresh 32-byte key and base64url-encode it:

```bash
node -e '
  const { randomBytes } = require("node:crypto");
  process.stdout.write(randomBytes(32).toString("base64url") + "\n");
'
```

Copy the output. You'll paste it as `OIDC_SIGNING_KEY` in §6.4. **This key controls every JWT you ever issue** — store the value somewhere safe (a password manager, a sealed secret) so you can rotate-by-replacement later if needed.

### 6.2 Generate the dashboard cookie secret (optional, for §7)

```bash
node -e '
  const { randomBytes } = require("node:crypto");
  process.stdout.write(randomBytes(32).toString("base64url") + "\n");
'
```

You'll paste this as `DASHBOARD_COOKIE_SECRET` when you deploy the dashboard (§7). Skip if not using the dashboard.

### 6.3 Choose your OWNER_TOKENS

`OWNER_TOKENS` is a comma-separated list of `<ownerId>:<token>` pairs. Each `ownerId` is an identifier you choose (typically a human-readable handle like `alice` or `acme-corp`); each `token` is a high-entropy random bearer that authenticates publishes on behalf of that owner.

Generate one token per owner (≥ 32 bytes of randomness):

```bash
node -e '
  const { randomBytes } = require("node:crypto");
  process.stdout.write(randomBytes(32).toString("base64url") + "\n");
'
```

Then form the env value:

```
alice:tok-A1xxxxxxxxxxxxxxxx,bob:tok-B2yyyyyyyyyyyyyyyy
```

For a solo self-host, one owner is fine. You can add more later by re-setting the secret.

### 6.4 Set all the wrangler secrets

Each `wrangler secret put` opens an interactive prompt — paste the value, hit enter. The secret never enters the repo, never enters your shell history, and is encrypted at rest in Cloudflare.

```bash
# REQUIRED — these gate the core functionality

pnpm --filter @agentagora/cloud-api exec wrangler secret put OWNER_TOKENS
# Paste: alice:tok-A1...,bob:tok-B2...

pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_SIGNING_KEY
# Paste: <the base64url string from §6.1>

pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_ISSUER
# Paste: https://agentagora-cloud-api.<your-account>.workers.dev
#        (the URL where this Worker will live; see §6.6)

pnpm --filter @agentagora/cloud-api exec wrangler secret put AAP_ENV
# Paste: production
#        Enforces fail-closed for the NONCES / RATE_LIMITS KV
#        bindings — the Worker refuses to start if either is
#        unbound. Without this, the Worker silently degrades to
#        per-isolate fallbacks. NEVER omit on a real deploy.

# REQUIRED IF YOU USE THE DASHBOARD ON A DIFFERENT ORIGIN

pnpm --filter @agentagora/cloud-api exec wrangler secret put DASHBOARD_ORIGINS
# Paste: https://your-dashboard.example.com
#        Comma-separated allowed CORS origins for cross-origin
#        Authorization-bearing requests (publish, file dispute).
#        Localhost origins are always trusted, so this is only
#        needed once your dashboard lives somewhere else.

# REQUIRED IF YOU USE GITHUB SIGN-IN (skip if §4 was skipped)

pnpm --filter @agentagora/cloud-api exec wrangler secret put GITHUB_CLIENT_ID
# Paste the Client ID from §4.3

pnpm --filter @agentagora/cloud-api exec wrangler secret put GITHUB_CLIENT_SECRET
# Paste the Client Secret from §4.2

# Optional — only if your callback URL differs from the OAuth app default:
# pnpm --filter @agentagora/cloud-api exec wrangler secret put GITHUB_REDIRECT_URI

# REQUIRED IF YOU USE STRIPE (skip if §5 was skipped)

pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_SECRET_KEY
# Paste a sk_test_… key (or sk_live_… once you go live)

pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste the whsec_… value from §5.3 (or skip until after §6.6 then re-run)
```

> **Important: do NOT set `OAUTH_REQUIRE_NONCE`** in production. The default is fail-closed — the OAuth callback rejects any state minted without a browser-bound nonce. Only set it to `"false"` in `.dev.vars` if you specifically need to test the legacy curl-based OAuth flow locally.

Verify all secrets are bound:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret list
```

You should see at minimum: `OWNER_TOKENS`, `OIDC_SIGNING_KEY`, `OIDC_ISSUER`, `AAP_ENV` (and any optional ones you set).

### 6.5 Final pre-deploy check

```bash
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test
pnpm --filter @agentagora/cloud-api check
```

All three must exit 0. The third (`check`) is a wrangler dry-run that verifies the bundle would deploy.

### 6.6 Deploy

```bash
pnpm --filter @agentagora/cloud-api deploy
```

Output includes the production URL:

```
Uploaded agentagora-cloud-api (1.23 sec)
Published agentagora-cloud-api (0.45 sec)
  https://agentagora-cloud-api.<your-account>.workers.dev
```

**Update `OIDC_ISSUER` if needed.** If the worker URL printed above differs from what you set in §6.4, re-run `wrangler secret put OIDC_ISSUER` with the actual URL. The Worker uses this value as the `iss` claim on every JWT it signs.

### 6.7 (Optional) Custom domain

To serve the cloud-api at e.g. `https://api.example.com` instead of `*.workers.dev`:

1. Add your domain to Cloudflare as a zone (if not already).
2. In `apps/cloud/api/wrangler.jsonc`, add a `routes` block:
   ```jsonc
   "routes": [
     { "pattern": "api.example.com/*", "zone_name": "example.com" }
   ]
   ```
3. Re-deploy: `pnpm --filter @agentagora/cloud-api deploy`.
4. Update `OIDC_ISSUER` to the custom domain: `wrangler secret put OIDC_ISSUER` → paste `https://api.example.com`.

### 6.8 Post-deploy smoke

Run the smoke script immediately — a broken deploy should fail loud before any client notices:

```bash
pnpm --filter @agentagora/cloud-api smoke -- \
  --url=https://<your-cloud-url> \
  --bearer=<one of your OWNER_TOKENS> \
  --owner-id=<the matching ownerId>
```

The script walks 8 sequential checks (healthz → JWKS → publish → resolve → catalog → conversation lookup → owner-scoped → burst), prints a markdown PASS/FAIL table, and exits 1 on any failure.

If it passes, the cloud-api is live and protocol-compliant for read paths. Compliance suite verification in §9 will tell you the full picture.

---

## §7. Dashboard deploy (optional)

The dashboard is a Next.js 15 app under `apps/cloud/dashboard/`. It is **not required** for an AAP-compliant cloud — the API stands alone, and clients can publish via the SDK or `curl`. The dashboard is operator polish: a browser UI for sign-in, publishing, viewing the catalog, and managing earnings/disputes.

> **Honest status (2026-05-24).** The dashboard does not currently ship a Cloudflare Pages adapter (`@cloudflare/next-on-pages`). Three options for self-hosters:
>
> 1. **Run it on a Node host (recommended for now).** `pnpm --filter @agentagora/cloud-dashboard build && pnpm --filter @agentagora/cloud-dashboard start` — runs on any VPS, container, or PaaS that hosts Node. Set the two env vars below.
> 2. **Cloudflare Pages with `@cloudflare/next-on-pages`.** Install the adapter (not currently in `package.json`), follow Cloudflare's [Next.js on Pages](https://developers.cloudflare.com/pages/framework-guides/nextjs/) guide. Works for App Router with edge runtime restrictions — verify any Server Action paths.
> 3. **Skip entirely.** Use the SDK or the smoke script to publish; the catalog is also queryable via `curl` on the public read paths.

### 7.1 Environment variables

The dashboard reads two env vars at build/runtime:

| Variable | Value | Required |
|---|---|---|
| `AGENTAGORA_CLOUD_URL` | Your cloud-api URL from §6.6 (e.g. `https://agentagora-cloud-api.<account>.workers.dev`) | Yes — otherwise it falls back to `http://localhost:8787` |
| `DASHBOARD_COOKIE_SECRET` | The base64url string from §6.2 | Yes — without this, the dashboard generates an ephemeral fallback at boot, sessions don't survive restarts, and a warning is logged |

### 7.2 Build

```bash
pnpm --filter @agentagora/cloud-dashboard build
```

Static + server-rendered output lands in `apps/cloud/dashboard/.next/`.

### 7.3 Run (Node host)

```bash
AGENTAGORA_CLOUD_URL=https://<your-cloud-url> \
DASHBOARD_COOKIE_SECRET=<the base64url from §6.2> \
  pnpm --filter @agentagora/cloud-dashboard start
```

Default port: 3000. Reverse-proxy it via your VPS's nginx/Caddy/Traefik to a real hostname.

### 7.4 Wire to cloud-api CORS

Once your dashboard has a public hostname, go back to §6.4 and set `DASHBOARD_ORIGINS` on the cloud-api:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put DASHBOARD_ORIGINS
# Paste: https://your-dashboard.example.com
```

Without this, browser publish/dispute forms will 404 on their CORS preflight.

### 7.5 Update the GitHub OAuth app callback

If your dashboard hostname changed since §4.1, edit the OAuth app:
1. Go to [github.com/settings/developers](https://github.com/settings/developers) → your app
2. **Authorization callback URL** → `https://your-dashboard.example.com/login/callback`
3. **Homepage URL** → `https://your-dashboard.example.com`
4. Save.

---

## §8. Marketing site (optional)

The marketing site at `apps/marketing/` is an Astro 5 static site — your project's public landing page. **Skip if you don't want a public-facing brand site.**

```bash
pnpm --filter @agentagora/marketing build
# Static output in apps/marketing/dist/
```

Deploy the `dist/` folder to any static host:
- **Cloudflare Pages** (recommended, free): `wrangler pages deploy apps/marketing/dist` after `wrangler login`
- Any other static host: serve `dist/` over HTTPS

The marketing site has no env vars and does not talk to the cloud-api directly. Update any references in `apps/marketing/src/` if you want to advertise your cloud-api URL.

---

## §9. Verify compliance — Tier 1 + Tier 2

This is the **acceptance step** for the runbook. If §9 passes, your self-hosted cloud is AAP-compliant for the read-path surface and you can claim the **AgentAgora-compatible** badge (per maintainer decision F.2 in [`maintainer-tasks.md`](maintainer-tasks.md)).

### 9.1 Tier 1 — public read paths (no auth)

```bash
AAP_BASE_URL=https://<your-cloud-url> \
  pnpm --filter @agentagora/protocol-compliance test
```

Tier 1 tests `/healthz`, `/.well-known/jwks.json`, `/v1/agents` listing/lookup, and the error envelope shape. No writes; safe against production.

Tier 1 alone has 15 tests. They should all pass on a correctly-deployed cloud-api. Common failures:

- `JWKS publish` fails → `OIDC_SIGNING_KEY` or `OIDC_ISSUER` unset (re-check §6.4)
- `Health check returned 503` → `AAP_ENV=production` is set but `NONCES` / `RATE_LIMITS` KV bindings are unbound (re-check §3.4 and `wrangler.jsonc`)
- All `/v1/agents` shape tests fail → migrations not applied (re-check §3.5)

### 9.2 Tier 2 — authenticated read paths

```bash
AAP_BASE_URL=https://<your-cloud-url> \
AAP_TEST_BEARER=<one of your OWNER_TOKENS> \
AAP_TEST_OWNER_ID=<the matching ownerId> \
  pnpm --filter @agentagora/protocol-compliance test
```

Tier 2 verifies bearer-token auth + cross-owner isolation. Adds ~12 tests.

### 9.3 Tier 3 — mutation contracts (optional, sandbox only)

Tier 3 is for impls that want to claim "registered peer registry" status (relevant once federation goes live in M10+). It writes to your storage, so **only run against a sandbox / dev cloud** — never your production deploy.

If you want to run it, see [`packages/protocol-compliance/README.md`](../packages/protocol-compliance/README.md) for the provisioning fixture flow.

### 9.4 What "green" means

Tier 1 + Tier 2 all green = your deploy implements the AAP v0.1 read surface correctly. You can:

- Tell people about your cloud
- Add a "AgentAgora-compatible" badge to your README
- Connect agents that speak AAP to your cloud and have them resolve each other's manifests + audit chains

---

## §10. What you've got + ongoing cost

### 10.1 What's live

After §6 (and optionally §7–§8), you have:

- **A signing cloud-api** at `https://<your-cloud-url>` that issues identity JWTs, accepts manifest publishes, returns the public catalog, and ingests audit events
- **An Ed25519 key pair you control.** Public key visible at `/.well-known/jwks.json`. Private key only in Cloudflare's encrypted secret store.
- **A registry namespace** that you control. `aid:<your-registry>:<owner>/<name>` resolves through your `OIDC_ISSUER` URL.
- **Nonce-replay protection + rate limiting** backed by KV, enforced at the edge.

### 10.2 Cloudflare cost expectations (free tier)

| Resource | Free tier | Where you'll hit the wall |
|---|---|---|
| Workers | 100,000 requests/day | At ~1 req/sec sustained you're using ~10% of the daily allowance |
| D1 | 5 GB storage, 5M rows read/day, 100k rows written/day | First wall is usually rows-read on heavy catalog traffic |
| KV | 100k reads/day, 1k writes/day, 1 GB storage | Writes are the tight one (every NONCE check = 1 write) |
| Pages (marketing) | Unlimited bandwidth, 500 builds/month | Realistically never |

A solo self-host with ~dozens of agents and ~thousands of API calls per day fits comfortably in free tier. Paid tier ($5/month Workers Paid) buys you 10M Worker requests + much higher D1/KV ceilings.

### 10.3 Ongoing ops

Now read [`apps/cloud/api/RUNBOOK.md`](../apps/cloud/api/RUNBOOK.md). It covers:

- Applying a new migration when one lands
- Sweeping expired OAuth sessions
- Rotating secrets (`OIDC_SIGNING_KEY`, `OWNER_TOKENS`, Stripe keys)
- Point-in-time D1 restore drills
- Triaging Stripe webhook failures

[`docs/day-0-oncall.md`](day-0-oncall.md) is the paged-at-3am cheat-sheet for the most-likely failures in the first 24 hours after launch.

---

## §11. Troubleshooting + scope

### 11.1 Common stumbling blocks

| Symptom | Likely cause | Fix |
|---|---|---|
| `wrangler deploy` fails with "Invalid resource ID" | `REPLACE_BEFORE_DEPLOY` still in `wrangler.jsonc` | Re-do §3.3 / §3.4, paste real UUIDs |
| Worker returns 503 on every request | `AAP_ENV=production` is set but KV bindings unbound or missing | Re-check §3.4 + `wrangler.jsonc` |
| JWTs verify-fail at consumers | `OIDC_ISSUER` doesn't match the Worker's actual URL | Re-set the secret with the printed deploy URL |
| Dashboard "sign in with GitHub" 503 | `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` unset | Re-do §6.4 GitHub stanza |
| Dashboard sign-in works but cookie doesn't persist | `DASHBOARD_COOKIE_SECRET` is the ephemeral fallback | Set it explicitly (§6.2 + §7.3) |
| `/v1/connect/*` returns 503 | Stripe not configured | Either set the Stripe secrets (§5 + §6.4) or accept the 503 — settlement is optional |
| Compliance suite Tier 1 fails on `JWKS publish` | `OIDC_SIGNING_KEY` or `OIDC_ISSUER` unset | §6.4 |
| Browser publish form 404s on preflight | `DASHBOARD_ORIGINS` doesn't include your dashboard origin | §6.4 |

### 11.2 Want to run this on something other than Cloudflare?

That's not in M6 scope. The reference impl uses Cloudflare-specific bindings (`D1Database`, `KVNamespace`, Workers runtime APIs). Supporting Fly.io + Postgres, AWS + DynamoDB, or any other stack means writing a storage adapter layer — a non-trivial piece of work that hasn't been scoped.

If you need this:
1. Open a [discussion](https://github.com/agentagora/agentagora/discussions) describing the target stack and your timeline
2. Identify the abstraction boundary in `apps/cloud/api/src/d1-storage.ts` (the `Storage` interface) — that's the seam where a port would happen
3. Be prepared to maintain your fork until the upstream project ships a `StorageAdapter` abstraction

### 11.3 Reporting deploy issues

If you followed this guide and got stuck:

- Open a [discussion](https://github.com/agentagora/agentagora/discussions) with the section you got stuck on, what you tried, and the error message
- Don't open an issue unless you can identify a bug in the runbook itself (typo, wrong command, missing step) — discussion is the right channel for "stuck while self-hosting"

---

## §12. Acceptance — proving the runbook works

You've completed self-hosting when **all** of these are true:

- [ ] `pnpm --filter @agentagora/cloud-api smoke` exits 0 against your deploy URL
- [ ] `pnpm --filter @agentagora/protocol-compliance test` exits 0 with `AAP_BASE_URL` and `AAP_TEST_BEARER` set
- [ ] `curl https://<your-cloud-url>/.well-known/jwks.json` returns a JWK with `kty: "OKP"`, `crv: "Ed25519"`, and your public key
- [ ] `curl https://<your-cloud-url>/healthz` returns `200 ok`
- [ ] You can publish a manifest using the SDK pointed at your cloud, and the published AID resolves to a JWT signed by your `OIDC_SIGNING_KEY`

That's it. You're running AAP.

---

*Last reviewed: 2026-05-24. Next review at: M7 (post-public-release), or when the first non-CF self-host lands.*
