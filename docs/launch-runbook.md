# Launch runbook

> One-shot sequence for going from **private + nothing-deployed** to **public + announced**. Read once, execute once. After M3 launch this document becomes historical — the routine + incident docs that take over for steady-state are [`apps/cloud/api/DEPLOY.md`](../apps/cloud/api/DEPLOY.md) and [`apps/cloud/api/RUNBOOK.md`](../apps/cloud/api/RUNBOOK.md).

This runbook covers what's between the code being ready and strangers being allowed to land on it. It does **not** cover: registering the domain, opening a Cloudflare account, opening a Stripe account, opening a GitHub OAuth app — those are pre-prerequisites. Do them before §3 below.

Owner: **weijt606** (single maintainer, no on-call rotation).

---

## 1. Trigger framework — when to do what

We split "going public" into three triggers because each has a different risk profile. The mistake to avoid is conflating them ("go public" usually means Trigger 3 in people's heads, but the controlled path is Trigger 2).

### Trigger 1 — Soft public

Repo flips public, nothing announced, no DNS pointed yet, no traffic.

**When it makes sense**: only as a 1–7 day prep period before Trigger 2. If you're not deploying within a week, skip Trigger 1 and stay private — public-but-broken is worse than private.

**Risks**: someone surfaces the repo on Hacker News before you're ready, with broken demos. Low probability for a project nobody knows about, but non-zero.

### Trigger 2 — Quiet launch (recommended starting point)

Repo public + product deployed + 5–10 trusted-contact outreach. **No HN, no X, no blog post yet.**

**Go/no-go signals (all must be green):**

- [ ] Cloud-api responds at its real URL: `curl https://<your-cloud-url>/healthz` → 200
- [ ] JWKS publishes: `curl https://<your-cloud-url>/.well-known/jwks.json` → 200 with at least one key
- [ ] Dashboard renders: open the dashboard URL, GitHub OAuth works end-to-end
- [ ] Marketing landing renders **with at least one real agent** (the catalog isn't in the unreachable / empty fallback)
- [ ] You personally walked the §9.3 #1 happy path: sign up → publish a manifest → call from a second agent → see audit log + earnings. Took ≤ 15 minutes.
- [ ] Stripe Connect onboarding tested end-to-end with a real test-mode account; `charges_enabled` flipped after webhook landed
- [ ] `wrangler.jsonc` carries the real D1 / KV ids — and is **not committed** (it's gitignored; verify with `git status`)
- [ ] `git log -p | grep -iE "(sk_live|whsec_|password|secret.*=|api[_-]?key)"` produced zero hits
- [ ] B.4 Discussions is on, B.5 Projects board is up
- [ ] You've drafted the soft-launch email to 5–10 contacts (not sent yet)

**What you do at Trigger 2:**

1. Flip the repo public (§5)
2. Send the soft-launch email to your 5–10 contacts ("hey, this exists, want to try it and tell me what's broken?")
3. **Do not** post anywhere public

**Goal of Trigger 2**: collect 3–5 real friction reports from people whose names you know. Fix obvious P0s. Get 1–2 outsiders to publish a manifest.

### Trigger 3 — Public launch

HN, X, blog post, full lighthouse outreach.

**Go/no-go signals (all must be green):**

- [ ] Trigger 2 has been running long enough for at least 14 days of soak
- [ ] At least 2 outsiders have successfully published a manifest
- [ ] First paid agent-to-agent call has settled (PRD §10 M3 success milestone)
- [ ] All P0 reports from Trigger 2 fixed; nothing P0 in the last 7 days
- [ ] C.1 outreach list (20 lighthouse builders) has been written and email templates are ready
- [ ] You have bandwidth for the next 48–72 hours to staff inbound (HN top-of-page is a real possibility for novel infra projects)

**What you do at Trigger 3:**

1. Publish `apps/marketing/src/content/blog/launching-public-beta.md` to the live site
2. Submit to Hacker News (best window: weekday 9–11am Pacific)
3. Post the X thread (timed within an hour of HN)
4. Email the 20-person C.1 lighthouse list (each personalized; no BCC blast)
5. Pin the launch post on Discussions (Announcements category)
6. Be online for ~48 hours to respond

---

## 2. Credential audit — before flipping public

This is the one-shot you cannot un-do. Even if you flip the repo back to private, anyone who cloned during the public window keeps everything they cloned. Treat this audit as gating.

```bash
# From repo root. All commands assume the current branch is the one
# you're about to publish (typically main).

# 1. Scan history for likely secrets.
git log -p | grep -iE "(sk_live_|whsec_|password|secret.*=|api[_-]?key|aws[_-]?access|bearer.*[a-z0-9]{32}|ghp_[A-Za-z0-9]{30,}|github_pat_)" | head -40

# 2. Scan for accidentally committed env files.
git log --all --diff-filter=A --name-only -- '.env*' '*.pem' '*.key' '*.p12' '*.kdbx' | head -20

# 3. Scan for the wrangler.jsonc that should NOT be committed.
git ls-files apps/cloud/api/wrangler.jsonc
# Should print nothing. If it prints the file, you have a leak — see remediation below.

# 4. Confirm wrangler.jsonc.example IS committed (the template is fine to publish).
git ls-files apps/cloud/api/wrangler.jsonc.example
# Should print: apps/cloud/api/wrangler.jsonc.example

# 5. Confirm sentinel UUIDs are still sentinels in the example.
grep -E "00000000-0000-0000-0000-000000000000" apps/cloud/api/wrangler.jsonc.example
# Should match — these are placeholders by design.
```

**If any scan turns up something real:**

| Finding | Remediation |
|---|---|
| Real secret in commit history (sk_live_…, whsec_…, github_pat_…) | The secret is **already compromised**. Rotate it now in the issuer's dashboard (Stripe / GitHub / AWS). After rotation the leaked value is dead — purging it from git history is hygiene, not security. Use `git filter-repo` for the purge; rebase will fight you. |
| `.env` or `.pem` / `.key` file committed | Same: rotate / regenerate the underlying credential, then `git filter-repo --path <file> --invert-paths`. |
| `wrangler.jsonc` (real, not `.example`) committed | If the file only carries D1 / KV ids — those aren't secrets, they're routing data and are visible at deploy time anyway. Fine. If it ALSO has secrets pasted into it (against the design), purge + rotate. |

If the audit comes back clean, you're cleared to flip.

---

## 3. Pre-deploy account setup

Do these in any order, but all need to be done before §4.

| Provider | What to do | Where the credentials end up |
|---|---|---|
| **DNS / domain** | Buy `agentagora.dev` (or chosen domain) at any registrar. Point name servers at Cloudflare. | DNS dashboard, no secret to paste anywhere |
| **Cloudflare** | Sign up. Add the domain. Enable Workers + D1 + KV in the dashboard. | `wrangler login` writes a token under `~/.wrangler` |
| **Stripe** | Sign up. **Stay in Test mode** until Trigger 3 day. Create a Connect platform (Settings → Connect → Get started). | `STRIPE_SECRET_KEY` (sk_test_…), `STRIPE_WEBHOOK_SECRET` (whsec_…) |
| **GitHub OAuth app** | github.com/settings/developers → New OAuth App. Auth callback URL = `https://<dashboard-url>/login/callback`. | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |

---

## 4. Deploy walkthrough

This walks the steps. Day-to-day reference is [`apps/cloud/api/DEPLOY.md`](../apps/cloud/api/DEPLOY.md); this section just sequences them in launch order.

### 4.1 Cloud-api

```bash
# 1. Bootstrap the wrangler config from the example.
cp apps/cloud/api/wrangler.jsonc.example apps/cloud/api/wrangler.jsonc

# 2. Provision D1 + KV; paste the printed ids into wrangler.jsonc.
pnpm --filter @agentagora/cloud-api exec wrangler d1 create agentagora-cloud
pnpm --filter @agentagora/cloud-api exec wrangler kv namespace create NONCES
pnpm --filter @agentagora/cloud-api exec wrangler kv namespace create RATE_LIMITS

# 3. Apply migrations.
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --remote

# 4. Set every secret. See DEPLOY.md §3 for the full list of formats.
pnpm --filter @agentagora/cloud-api exec wrangler secret put OWNER_TOKENS
pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_SIGNING_KEY
pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_ISSUER
pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_SECRET_KEY
pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_WEBHOOK_SECRET
pnpm --filter @agentagora/cloud-api exec wrangler secret put GITHUB_CLIENT_ID
pnpm --filter @agentagora/cloud-api exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm --filter @agentagora/cloud-api exec wrangler secret put DASHBOARD_COOKIE_SECRET   # 32+ random bytes, base64url

# 5. Sanity check + deploy.
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test
pnpm --filter @agentagora/cloud-api check          # bundle dry-run
pnpm --filter @agentagora/cloud-api deploy
```

After the deploy command, wrangler prints the live URL. Note it — you'll need it for everything else.

### 4.2 Dashboard

Cloudflare Pages or Vercel. Either way, the `AGENTAGORA_CLOUD_URL` and `DASHBOARD_COOKIE_SECRET` env vars need to be set on the deploy target.

```bash
# Cloudflare Pages example (if using their git integration, you do this in their UI;
# below is the manual variant via wrangler):
pnpm --filter @agentagora/cloud-dashboard build
# Upload .next or use Cloudflare's Next.js adapter.
```

The **dashboard's GitHub OAuth callback URL** must match what you set in the OAuth app — both pointing at `https://<dashboard-url>/login/callback`. If they disagree, login redirects will land on a 404.

### 4.3 Marketing site

Pure static. Easiest target: Cloudflare Pages with the repo connected.

```bash
# Verify the build works locally first.
SITE_URL=https://agentagora.dev \
AGENTAGORA_CLOUD_URL=https://<your-cloud-url> \
AGENTAGORA_DASHBOARD_URL=https://<your-dashboard-url> \
pnpm --filter @agentagora/marketing build

# Output: apps/marketing/dist/
```

Cloudflare Pages settings:
- **Build command**: `pnpm --filter @agentagora/marketing build`
- **Build output directory**: `apps/marketing/dist`
- **Environment variables**: the three above

### 4.4 Documentation site

Same shape. Output is `apps/docs/.vitepress/dist`. Build command: `pnpm --filter @agentagora/docs build`.

### 4.5 Status worker

```bash
pnpm --filter @agentagora/status exec wrangler secret put UPSTREAM_HEALTHZ
# Paste: https://<your-cloud-url>/healthz
pnpm --filter @agentagora/status deploy
```

---

## 5. Self-test before flipping public

You're acting as a fresh user. Do this in an incognito window so you're not authed against any of your other tabs.

1. Open the marketing site at its public URL. Confirm the catalog renders **with real agents** (not the empty / unreachable fallback).
2. Click "Get started" → arrive at the dashboard.
3. Sign in with GitHub. After the OAuth round-trip you should land on `/home`.
4. Click "Onboarding" → complete the Stripe test-mode flow → return to the dashboard. `charges_enabled` should flip within ~10 seconds (the webhook).
5. Click "Publish your first agent" → fill the form → paste a freshly generated Ed25519 private key → submit. The form should redirect to `/agents/<aid>` showing your published manifest.
6. From a separate tab, fetch `GET https://<cloud-url>/v1/agents/<your-aid>`. Should return your manifest with a real EdDSA JWT.
7. Verify the JWT against JWKS:

   ```bash
   # Decode JWT header to confirm kid; then fetch JWKS and look for the kid.
   curl https://<cloud-url>/.well-known/jwks.json | jq '.keys[] | .kid'
   ```

8. Open `https://<status-url>/status.json`. Should return `{ status: "operational", … }`.

If any step fails, fix before flipping public. The marketing site rendering "Catalog temporarily unavailable" instead of agents is the most likely failure — it means the cloud-api URL in `AGENTAGORA_CLOUD_URL` is wrong or unreachable from Cloudflare's build environment.

---

## 6. Flipping the repo to public

```bash
# Final pre-flip sanity check.
git status                # working tree clean
git log --oneline -10     # last 10 commits look reasonable
```

Then:

1. github.com/agentagora/agentagora/settings → scroll to **Danger Zone** at the bottom → **Change repository visibility** → **Public**
2. GitHub asks you to type the repo name to confirm — type it
3. The repo is now public. Anyone with the URL can clone, fork, read all history.

**Within 5 minutes after flipping:**

- Verify https://github.com/agentagora/agentagora loads in an incognito window without auth
- Verify Discussions is reachable: https://github.com/agentagora/agentagora/discussions in incognito
- Verify the Projects board (B.5) is set to public visibility under Project Settings
- Replace `TODO-PASTE-PROJECT-URL-AFTER-B5` in the welcome discussion post with the real Projects URL

---

## 7. Soft launch (Trigger 2 → 3 transition)

The 14-day soak. What to actually do during it:

- **Daily**: check Discussions for new posts. Reply within ~24h.
- **Daily**: check Issues. Triage, label, respond.
- **Daily**: skim cloud-api logs for `[req=…]` patterns that look anomalous: bursts of 401s, repeated 5xxs, unexpected paths
- **Weekly**: run the smoke script (D.5 — once we land it) against production
- **As they happen**: bug fixes go through the normal PR + lefthook flow. Don't disable the lefthook gates "just for an emergency" — those gates have already saved this repo from broken pushes during the autonomous build-out

When you're past the 14 days **and** every other Trigger 3 signal is green, you're cleared for the public launch.

---

## 8. Rollback (if Trigger 2 reveals something P0)

In rough order from cheapest to scariest:

1. **Code regression**: revert the offending commit on `main`, redeploy. The lefthook + CI gates make this safe.
2. **Stripe / OAuth misconfig**: the secrets live in wrangler — rotate them. See [`apps/cloud/api/RUNBOOK.md`](../apps/cloud/api/RUNBOOK.md) §2.
3. **D1 corruption / accidental wipe**: Cloudflare keeps automatic D1 backups. `wrangler d1 backup list DB` to see snapshots; restore via the Cloudflare dashboard. **PIT-restore drill is not yet rehearsed** (M3 §D.6) — do not assume restore will work without testing.
4. **You have to flip the repo back to private**: Settings → Danger Zone → Change visibility → Private. The fork-and-clone window is permanent, but you stop the bleeding.

For everything else, [`apps/cloud/api/RUNBOOK.md`](../apps/cloud/api/RUNBOOK.md) §3 is the on-call playbook.

---

## What this runbook intentionally does NOT cover

- DNS purchasing / Cloudflare account creation / Stripe account creation — pre-prereqs
- Marketing copy decisions for HN / X / blog — the prose lives in `apps/marketing/src/content/blog/launching-public-beta.md`; tweak it before publishing
- Lighthouse outreach list (C.1) — that's strategy, not ops
- Anything that happens after Trigger 3 — that's everything from M3 onward, not a launch concern

When in doubt, the order is: **deploy → self-test → flip → soft → soak → announce**. Don't skip steps; the gating is what stops the "looks live but isn't" failure mode.
