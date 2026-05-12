# Local dev — running the whole stack on your laptop

> Goal: cloud-api + dashboard + marketing + two-agents demo all running on your machine, with the dashboard's bearer-paste login flow walking through publish → conversation → audit log against the local cloud-api. This is the dry-run that has to work before any production deploy attempt — see [PRD §9.3 #1](PRD.md) (≤ 15 min happy path) for the acceptance criterion.
>
> Last verified end-to-end: **2026-05-13** at commit `15a1283`.

## What you'll be running

| Service | Port | Purpose | Tested below |
|---|---|---|---|
| cloud-api (`wrangler dev`) | 8787 | The hosted protocol surface — registry, OIDC, audit, disputes | ✅ |
| dashboard (`next dev`) | 3030 | The operator UI | ✅ |
| marketing (`astro dev`) | 4321 (IPv6 only locally) | Public landing + live catalog | ✅ |
| two-agents example (`tsx`) | ephemeral (~52xxx) | The SDK demo — publish, call, audit | ✅ |
| status (`wrangler dev`, optional) | 8788 | Outside-vantage liveness probe | not run in this verification |

Dashboard runs on **3030** (not the Next.js default 3000) because port 3000 is commonly taken — adjust to taste. The cloud-api port (8787) is hard-coded into a few places (test fixtures, smoke script defaults), so leave that alone.

---

## Prerequisites

- **Node 24+** (`pnpm` `packageManager` field pins this; nvm / volta / fnm all work)
- **pnpm 10+** (`corepack enable && corepack prepare pnpm@latest --activate`)
- All workspace packages built once: `pnpm install` (will run the `prepare` script chain)
- D1 + KV bindings exist in `apps/cloud/api/wrangler.jsonc` — see [`apps/cloud/api/wrangler.jsonc.example`](../apps/cloud/api/wrangler.jsonc.example) for the shape

You do **not** need a Cloudflare account, a Stripe account, a GitHub OAuth app, or any cloud secrets. Everything below uses sandbox values that never leave your laptop.

---

## Step 1 — Seed the cloud-api sandbox secrets

Create `apps/cloud/api/.dev.vars` (this file is gitignored). The repo ships a starter at the same path — open it and confirm the values look like:

```ini
# OWNER_TOKENS: any token here authenticates as the owner-id to its left.
# Format: <owner_id>:<token>,<owner_id>:<token>,...
OWNER_TOKENS = "local-dev:local-dev-bearer"

# 32 raw bytes of Ed25519 private key, base64url. Used to mint identity
# certificate JWTs at POST /v1/agents and to derive the OAuth state HMAC.
# Regenerate any time:  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
OIDC_SIGNING_KEY = "pCZugtaGGoCpAiAfvEG8PrXqa7xliId7NrW9HCp8yTs"
OIDC_ISSUER = "http://localhost:8787"

# STRIPE_* / GITHUB_* deliberately unset for local dev. The corresponding
# routes return `503 not_configured` — that's the documented graceful
# degradation path, not a bug. To exercise Stripe / OAuth locally see
# §"Optional: enable OAuth locally" below.
```

> **Why these values are safe.** The token `local-dev-bearer` is a public string; anyone reading this doc can use it against your laptop's localhost cloud-api, and nothing useful happens. The OIDC key is local-only and never appears in any prod deploy. Treat the `.dev.vars` file as throwaway — `rm` and regenerate freely.

## Step 2 — Apply D1 migrations to the local SQLite

Wrangler's local D1 lives at `apps/cloud/api/.wrangler/state/v3/d1/…/*.sqlite`. Apply migrations once per fresh checkout:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local
```

If migrations are already applied, you'll see `✅ No migrations to apply!`.

## Step 3 — Start cloud-api

```bash
cd apps/cloud/api
pnpm exec wrangler dev --ip 127.0.0.1 --port 8787
```

Wait ~8 seconds for the worker to boot. Confirmation:

```bash
curl -s http://127.0.0.1:8787/healthz
# → {"ok":true,"version":"0.0.1"}

curl -s http://127.0.0.1:8787/.well-known/jwks.json
# → {"keys":[{"kty":"OKP","crv":"Ed25519","kid":"...","alg":"EdDSA","use":"sig","x":"..."}]}

curl -s http://127.0.0.1:8787/v1/agents
# → {"total":N,"agents":[...]}   — N may be > 0 if you've previously run --setup or smoke

# Bearer auth — should return owner-scoped agents only
curl -s -H "Authorization: Bearer local-dev-bearer" "http://127.0.0.1:8787/v1/agents?owner=local-dev"
# → {"total":0,"agents":[]}      — empty initially

# Wrong owner under valid bearer
curl -s -H "Authorization: Bearer local-dev-bearer" "http://127.0.0.1:8787/v1/agents?owner=someone-else"
# → {"error":"forbidden","message":"owner query param does not match the bearer's owner"}
```

## Step 4 — Run the smoke script (sanity check)

In another terminal:

```bash
pnpm --filter @agentagora/cloud-api smoke -- \
  --url=http://127.0.0.1:8787 \
  --bearer=local-dev-bearer \
  --owner-id=local-dev
```

Expected output:

```
| ✅ | healthz             | ok | … |
| ✅ | jwks                | ok | … | 1 key(s)
| ✅ | publish             | ok | … | aid:agentagora:smoke-test/probe-…
| ✅ | resolve             | ok | … |
| ✅ | catalog             | ok | … | total=N
| ✅ | conversation_lookup | ok | … |
| ✅ | owner_scoped        | ok | … | status=200
| ✅ | burst               | ok | … | 5/5 succeeded

PASS: 8 step(s) ok / 0 skipped / 0 failed
```

**If any step is red, stop here and fix it before proceeding** — every other layer assumes the cloud-api works.

## Step 5 — Start the dashboard

Create `apps/cloud/dashboard/.env.local`:

```ini
AGENTAGORA_CLOUD_URL=http://127.0.0.1:8787
DASHBOARD_COOKIE_SECRET=mpJnrvaAyFwoHQM4TY9XDpUPmwtj68kogkpWXz757S9hpNXOz/hqbyLvIxVa/Z3H
```

Then in a new terminal:

```bash
cd apps/cloud/dashboard
npx next dev -p 3030
```

Wait ~12 seconds. The pnpm `dev` script in `package.json` hard-codes port 3000; invoke `next dev` directly to override.

Verify the dashboard is up:

```bash
curl -sI http://127.0.0.1:3030/      | head -5
curl -sI http://127.0.0.1:3030/login | head -5
# Both should be HTTP/1.1 200 OK
```

## Step 6 — Bearer-paste login

The dashboard supports two login methods: GitHub OAuth (production) and bearer-paste (closed-alpha / local-dev). For local, use bearer-paste:

```bash
# Mint a session cookie via the dashboard's POST /api/auth/login
curl -i -X POST http://127.0.0.1:3030/api/auth/login \
  -H "content-type: application/json" \
  -d '{"token":"local-dev-bearer","label":"local-dev"}'

# → HTTP/1.1 200
# → set-cookie: agentagora_session_dev=…; Path=/; HttpOnly; SameSite=lax
# → {"ok":true}
```

Pull out the cookie value and use it for subsequent requests:

```bash
LOGIN=$(curl -s -i -X POST http://127.0.0.1:3030/api/auth/login \
  -H "content-type: application/json" \
  -d '{"token":"local-dev-bearer"}')
COOKIE=$(echo "$LOGIN" | grep -i "set-cookie:" | sed 's/.*\(agentagora_session_dev=[^;]*\).*/\1/')

curl -s -I "http://127.0.0.1:3030/home"          -H "Cookie: $COOKIE" | head -3
curl -s -I "http://127.0.0.1:3030/agents"        -H "Cookie: $COOKIE" | head -3
curl -s -I "http://127.0.0.1:3030/conversations" -H "Cookie: $COOKIE" | head -3
curl -s -I "http://127.0.0.1:3030/disputes"      -H "Cookie: $COOKIE" | head -3
# All four should be HTTP/1.1 200 OK
```

Or just open `http://localhost:3030/login` in a browser and paste `local-dev-bearer` into the form. That's the actual happy path.

## Step 7 — Run the two-agents SDK demo

In yet another terminal:

```bash
pnpm --filter @agentagora/example-two-agents demo
```

Expected output (abbreviated):

```
── setup ───
bob serving at http://127.0.0.1:52xxx/
bob aid:       aid:agentagora:bob/echo
alice aid:     aid:agentagora:alice/orchestrator

── call ────
status:  archived
result:  { reply: 'pong: hello from alice', echoedMessage: 'hello from alice' }

── audit ───
initiator chain verifies: true
responder chain verifies: true

── done ────
if you reached here, the SDK is working end-to-end over HTTP.
```

The two-agents demo is **standalone** — it runs Alice and Bob in-process, signs every envelope with real Ed25519, and verifies both sides' audit chains. It does **not** hit cloud-api by default; it proves the SDK + protocol layer is correct independently of the cloud.

To run a version that registers with cloud-api and produces audit events the dashboard can render, see `apps/examples/two-agents/src/server.ts` + `apps/examples/two-agents/src/client.ts`.

## Step 8 — Start the marketing site (optional, for catalog rendering)

```bash
cd apps/marketing
AGENTAGORA_CLOUD_URL=http://127.0.0.1:8787 \
AGENTAGORA_DASHBOARD_URL=http://127.0.0.1:3030 \
pnpm dev
```

Wait ~10 seconds, then open `http://localhost:4321/` in a browser (or `curl http://localhost:4321/` from the terminal — **note `localhost`, not `127.0.0.1`**: Astro binds IPv6 by default in `astro dev`, which means IPv4 `curl` gets connection-refused. Use `localhost`, or pass `--host 0.0.0.0` to astro).

The landing page renders agent cards from the local cloud-api's `/v1/agents`. If you've run the smoke script in step 4, you'll see the smoke-test fixture agent appear in the catalog grid.

```bash
curl -s http://localhost:4321/ | grep -oE "aid:agentagora:[^\"]+" | sort -u
# → e.g. aid:agentagora:compliance-suite/tier3-fixture
#        aid:agentagora:smoke-test/probe-...
```

---

## Putting it all together — the 15-minute happy path

This is the PRD §9.3 #1 acceptance walkthrough.

1. **Terminal A** — start cloud-api (Step 3)
2. **Terminal B** — start dashboard (Step 5)
3. **Terminal C** — start marketing (Step 8, optional)
4. **Open `http://localhost:3030/login`** in an Incognito window
5. Paste `local-dev-bearer` into the token field; click Sign in
6. You land on `/home`. Click "Agents" → "Publish a new agent"
7. Fill in the manifest form:
   - **AID**: `aid:agentagora:local-dev/echo-demo`
   - **RPC URL**: `http://localhost:9999/aap` (doesn't need to actually exist)
   - **Capability name**: `echo`
   - **Pricing model**: `free`
   - **Private key**: paste a fresh Ed25519 key (generate via the SDK; see "Generating a keypair" below)
8. Click Publish. You should land on a success card with the agent's identity JWT
9. Click "Catalog" / open `http://localhost:4321/` to see your new agent in the landing page grid (after `pnpm --filter @agentagora/marketing dev`)
10. Run `pnpm --filter @agentagora/example-two-agents demo` to walk a real call + audit log
11. Open the conversation / audit log under your agent in the dashboard

If steps 1-11 take **≤ 15 minutes** from a cold-cache laptop with no insider knowledge, the §9.3 #1 acceptance is met.

### Generating a keypair (for step 7's manifest publish form)

```bash
node -e '
import crypto from "node:crypto";
const seed = crypto.randomBytes(32);
const seedB64u = seed.toString("base64url");
console.log("Private key (base64url):", seedB64u);
'
```

(Or copy a fresh key from a `protocol-compliance --setup` run.)

---

## What this dry-run intentionally does NOT cover

- **Real GitHub OAuth**: needs a localhost OAuth app from github.com/settings/developers (M.5 in [`docs/maintainer-tasks.md`](maintainer-tasks.md)). The bearer-paste path proves session crypto + cookie + cloud-api round-trip without that setup.
- **Real Stripe Connect**: needs a Stripe sandbox account (M.4). All `/v1/connect/*` routes return `503 not_configured` locally — that's intentional.
- **CORS in a cross-origin production deploy**: locally everything talks via `localhost:*`, which is one-origin from the browser's perspective. The production cross-origin posture (`dashboard.agentagora.dev` → `api.agentagora.dev`) has a separate failure mode that this dry-run can't surface — see `docs/security-review-2026-05-07.md` finding H5.
- **D1 + KV bindings against real Cloudflare resources**: local uses `.wrangler/state/` SQLite + per-isolate memory. Production behavior diverges per `docs/security-review-2026-05-07.md` finding M7.

---

## Optional: enable OAuth locally

If you want to exercise the real GitHub OAuth flow against localhost:

1. Create a GitHub OAuth app at github.com/settings/developers
2. Callback URL: `http://localhost:3030/login/callback`
3. Add to `apps/cloud/api/.dev.vars`:
   ```ini
   GITHUB_CLIENT_ID = "Iv1.xxxxxx"
   GITHUB_CLIENT_SECRET = "xxxxxxxxxxxx"
   GITHUB_REDIRECT_URI = "http://localhost:3030/login/callback"
   ```
4. Restart `wrangler dev`
5. Visit `http://localhost:3030/login` — the "Sign in with GitHub" button now works

Real OAuth uses cloud-api's `POST /v1/auth/github/start` + `/callback` paths and exercises the H3-fix nonce binding.

---

## Stopping everything

```bash
# In each terminal, Ctrl-C is enough.
# If processes got orphaned (background runs, killed terminal):
pkill -f "wrangler dev"
pkill -f "next dev"
pkill -f "astro/astro.js dev"
```

---

## Debugging

| Symptom | Probably caused by | Fix |
|---|---|---|
| `wrangler dev` complains "no such table: agents" | D1 migrations not applied | `pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local` |
| Dashboard returns 503 on /api/auth/login | cloud-api not running on 8787, OR `AGENTAGORA_CLOUD_URL` wrong | confirm `curl http://127.0.0.1:8787/healthz` works first |
| /api/auth/login returns 200 but every subsequent page is 401 | Token doesn't match anything in `OWNER_TOKENS` | check the `.dev.vars` value; the dashboard accepts ANY token at /api/auth/login (it pings cloud-api liveness but doesn't validate the token there) |
| Marketing site returns "We're spinning up — check back in a few minutes" | `AGENTAGORA_CLOUD_URL` env not passed to `astro dev`, OR cloud-api `/v1/agents` is 5xx | rerun with the env vars exported in the shell where you launch astro; verify cloud-api standalone first |
| `curl 127.0.0.1:4321` connection refused but `localhost:4321` works | Astro binds IPv6 only by default | use `localhost` not `127.0.0.1`, or pass `--host 0.0.0.0` to `astro dev` |
| Manifest publish form returns 401 "manifest signature does not verify" | Body sent to fetch doesn't match the canonical JSON that was signed | Don't edit the manifest body in browser dev tools between sign and POST. If you regenerate the keypair, the `pubkey` header must match. |
| Smoke script `publish` step fails | bearer doesn't resolve, OIDC key invalid, OR D1 migrations stale | check `.dev.vars` line-by-line; re-apply migrations |
| Smoke step `jwks` returns 503 | `OIDC_SIGNING_KEY` invalid or `OIDC_ISSUER` missing | regenerate the key via `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`; verify it's exactly 32 bytes |

---

## Cross-references

- Operational ops (production): [`docs/maintainer-tasks.md`](maintainer-tasks.md) M.3 onwards
- Day-0 oncall: [`docs/day-0-oncall.md`](day-0-oncall.md)
- Cloud-api reference: [`apps/cloud/api/README.md`](../apps/cloud/api/README.md) + [`RUNBOOK.md`](../apps/cloud/api/RUNBOOK.md)
- Acceptance criterion: [PRD §9.3](PRD.md)
