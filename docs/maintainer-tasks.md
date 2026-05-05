# Maintainer tasks — things only the human can do

> A focused checklist of every M3-launch task that requires **human action in an external system** (GitHub UI, production Cloudflare, Stripe dashboard, your own sales / outreach motion). Written so you can batch through them in one sitting.
>
> If a task can be automated by code, it is **not** in this file. See [`docs/m3-launch-checklist.md`](m3-launch-checklist.md) for the full M3 status.

Owner: **weijt606** (single maintainer).

Last updated: 2026-05-05.

---

## How to use this doc

Work top to bottom. Each task has:

- **What** — the actual action
- **Why** — the M3 checklist link
- **Where** — the external system you'll touch
- **Acceptance** — "I'm done with this when…"
- **Time estimate** — rough order-of-magnitude

When you finish one, edit `docs/m3-launch-checklist.md` to flip the marker (`⬜ → ✅`).

The order below is the recommended order — earlier tasks unblock later ones (e.g., B.4 produces a Discussions URL that B.5's roadmap board can link to).

---

## Group A — Community infrastructure (do these before flipping repo public)

### M.1  Enable GitHub Discussions and pin the welcome thread

> M3 §B.4 — `⬜` in `m3-launch-checklist.md`

- **What:** flip Discussions on in repo Settings → Features → Discussions; create categories (Q&A, Show & Tell, Ideas, RFCs); write + pin a welcome thread; categorise the existing draft.
- **Why:** first external user needs a place to land that isn't an Issue. The blog post + README will link to a Discussions URL on launch day.
- **Where:** github.com/agentagora/agentagora — Settings → Features (toggle), then Discussions tab.
- **Acceptance:**
  - Discussions tab visible on the public repo home
  - Categories: Q&A · Show & Tell · Ideas · RFCs (parking-lot until M6)
  - One welcome post pinned to the **General** or top-of-feed slot
  - Welcome post links to Quickstart, manifesto, AAP-spec
- **Time:** 30–45 min (most of it is writing the welcome post)
- **Hand-back to me:** the Discussions URL + the welcome thread URL — I'll wire them into README footer, governance doc, and the launch blog post.

### M.2  Create the public roadmap (GitHub Projects board)

> M3 §B.5 — `⬜`

- **What:** new Projects board ("AgentAgora — public roadmap") with one row per M3-M9 milestone; 3–6 visible cards each; private detail stays in `docs/PRD.md`.
- **Why:** lets a stranger see "what's shipping next" without reading source. Goes in README + footer.
- **Where:** github.com/agentagora — Projects tab → New project → Board template.
- **Acceptance:**
  - Board is **public** (Settings → Visibility)
  - Columns: M3 In Progress · M4 Planned · M5 Planned · M6 Planned · M7+ Backlog
  - Each milestone row has 3–6 task cards; cards reference issues where they exist
  - URL added to README's "Roadmap" section
- **Time:** 45–60 min
- **Hand-back to me:** board URL + I'll wire it into README + the marketing site footer.

---

## Group B — Pre-deploy ops setup (you need real accounts before launch)

These are the prerequisites the launch runbook §2 assumes are already done.

### M.3  Cloudflare account + zone + Workers + D1 + KV provisioned

> Launch runbook §2.1, §2.2

- **What:** create Cloudflare account on the domain; create the D1 database (`wrangler d1 create agentagora-cloud`); create the two KV namespaces (`NONCES`, `RATE_LIMITS`); paste IDs into `apps/cloud/api/wrangler.jsonc` (copied from the example).
- **Where:** dash.cloudflare.com + local terminal.
- **Acceptance:**
  - `wrangler whoami` prints your account
  - `wrangler d1 list` shows `agentagora-cloud`
  - `wrangler kv namespace list` shows `NONCES` and `RATE_LIMITS`
  - `apps/cloud/api/wrangler.jsonc` has real IDs (no `REPLACE_BEFORE_DEPLOY` left)
- **Time:** 30–45 min
- **Note:** `wrangler.jsonc` stays gitignored. CI uses the example file.

### M.4  Stripe account + Connect platform + webhook endpoint

> Launch runbook §2.3, security review §M2

- **What:** create Stripe account in the legal entity that will receive fees; enable Connect (Express); configure webhook endpoint; copy keys into Worker secrets.
- **Where:** dashboard.stripe.com.
- **Acceptance:**
  - Connect is enabled (`Settings → Connect → Get started`)
  - Webhook endpoint added: `https://<your-cloud-url>/v1/stripe/webhook` listening to `account.updated`, `charge.refunded`, `charge.failed`
  - Worker secrets set:
    - `wrangler secret put STRIPE_SECRET_KEY` (test key first; rotate to live before Trigger 3)
    - `wrangler secret put STRIPE_WEBHOOK_SECRET`
- **Time:** 45–60 min
- **Test:** Stripe CLI `stripe trigger account.updated` should land in your Worker logs.

### M.5  GitHub OAuth app for sign-in

> Launch runbook §2.4

- **What:** create OAuth app, copy client ID + secret into Worker secrets + dashboard env.
- **Where:** github.com/settings/developers → New OAuth App.
- **Acceptance:**
  - Worker secrets:
    - `wrangler secret put GITHUB_CLIENT_ID`
    - `wrangler secret put GITHUB_CLIENT_SECRET`
  - Dashboard env (Cloudflare Pages or wherever you deploy it) has the same.
  - Callback URL points at `https://<your-cloud-url>/v1/auth/github/callback`.
- **Time:** 15–20 min

### M.6  OIDC signing key generated and stored

> Launch runbook §2.5, RUNBOOK §2.2

- **What:** generate the EdDSA private key for OIDC issuance; store as Worker secret.
- **Acceptance:**
  - `wrangler secret put OIDC_SIGNING_KEY` set with a fresh Ed25519 PKCS8 PEM
  - `OIDC_ISSUER` set to `https://<your-cloud-url>` (the same origin)
  - `curl https://<your-cloud-url>/.well-known/jwks.json` returns at least one `kty:OKP, crv:Ed25519` key
- **Time:** 10 min

### M.7  Cookie secret and HMAC keys generated

- **What:** generate dashboard cookie secret + state-signing HMAC keys (32 bytes random each).
- **Acceptance:**
  - Dashboard deploy env: `DASHBOARD_COOKIE_SECRET` (≥ 32 bytes; cookie.ts fail-closes in prod if shorter)
  - `wrangler secret put OAUTH_STATE_HMAC_KEY` set
- **Time:** 5 min

---

## Group C — Deploy + smoke (one-shot, do once you've got M.3–M.7 done)

### M.8  First production deploy

> Launch runbook §3.1–3.4

- **What:** `wrangler deploy` cloud-api; deploy dashboard (Cloudflare Pages or Vercel); deploy marketing site; deploy status worker.
- **Acceptance:** all four URLs respond. JWKS responds. Dashboard login round-trips through GitHub OAuth.
- **Time:** 30 min if M.3–M.7 are clean; longer otherwise.

### M.9  Run the post-deploy smoke script

> M3 §D.5 — automated, but you have to invoke it

- **What:** `pnpm --filter @agentagora/cloud-api smoke -- --url=https://<your-cloud-url> --bearer=<your-test-bearer>`
- **Acceptance:** all 8 steps green; markdown table on stdout; `.smoke-results.json` written.
- **Time:** ~5 min runtime; reading the output is the slow part.
- **If anything red:** roll back per launch runbook §7. Don't push through.

### M.10  Manually walk the §9.3 #1 happy path

> PRD §9.3 — the M3 acceptance criterion

- **What:** sign up via the dashboard with a fresh GitHub account; publish a manifest; have a second agent call the first; verify audit log + earnings show in dashboard. Time-box yourself to 15 min.
- **Acceptance:** end-to-end works in ≤ 15 min from a cold-cache browser, no insider knowledge.
- **Time:** 20 min (15 min budget + 5 min note-taking on rough edges)

---

## Group D — Post-launch ops drills (do within the first two weeks)

### M.11  PIT (point-in-time) restore drill against production D1

> M3 §D.6 — `⬜` (the only D-section item still open)

- **What:** export D1 → import to a scratch D1 instance → query a row that you wrote 1 hour ago → confirm it's there.
- **Why:** RUNBOOK §3.4 explicitly flags PIT-restore as un-rehearsed. Until you've done it once on real prod data, the durability story is theoretical.
- **Where:** local terminal + `wrangler d1`.
- **Acceptance:**
  - Wrote a sentinel row to a known table (e.g., `INSERT INTO audit_events (... 'maintainer-pit-test-2026-05-XX' ...)`)
  - Waited ≥ 1 h
  - Ran `wrangler d1 export agentagora-cloud --output=/tmp/pit-test.sql` (or equivalent)
  - Created scratch D1: `wrangler d1 create agentagora-cloud-pit-scratch`
  - Imported and queried the sentinel row — got it back
  - Wrote up the elapsed time + rough byte size to `apps/cloud/api/RUNBOOK.md` §3.4 (replacing the "un-rehearsed" note)
  - Deleted the scratch DB
- **Time:** 60–90 min (most of it is waiting for export)

### M.12  Promote the latency benchmark from informational to required gate

> M3 §A.5 — `🟡`

- **What:** after 2 weeks of green latency-bench runs, edit `.github/workflows/typescript.yml` to remove `continue-on-error: true` from the `latency-bench` job and adjust thresholds based on the observed baseline.
- **Why:** PRD §9.3 #4 — overhead < 200 ms p95. Gate prevents drift.
- **Acceptance:**
  - At least 14 consecutive green latency-bench runs in CI
  - p50 / p95 baselines documented in RUNBOOK §4.3 from those runs
  - `LATENCY_P50_MS_LIMIT` / `LATENCY_P95_MS_LIMIT` env values reflect baseline + headroom (e.g., 1.2× observed p95)
  - `continue-on-error: true` removed from the `latency-bench` job
  - One-line CHANGELOG entry under "Hardening"
- **Time:** 30 min (the work) + 2 weeks of waiting

### M.13  Outreach list — 20 lighthouse candidates

> M3 §C.1 — `⬜`

- **What:** build a list of 20 named candidate agent builders (mix: code-review, research assistants, ops/SRE bots, scheduling helpers). For each: name, GitHub or LinkedIn, a one-line "why this person", a personal opener.
- **Why:** without this, the launch blog post on day one is shouting into the void. PRD §10's "first 20 agents" milestone hinges on it.
- **Where:** wherever you keep CRM-y notes (private). The output is a private doc, **not** something committed to the repo.
- **Acceptance:**
  - 20 names, each with a personal opener
  - Email template ready (the same template + per-person opener)
  - Plan: send to first 5 at Trigger 2, the next 15 staggered over the first month after Trigger 3
- **Time:** 3–5 hours (the slow research kind, not typing kind)

### M.14  First paid agent-to-agent call

> M3 §C.2 — `⬜` (external trigger; can't be self-induced cleanly)

- **What:** observe — not cause — the first real billable call between two parties who aren't you. Could be from M.13's outreach.
- **Acceptance:** an audit-log row + Stripe charge ID + both dashboards showing it.
- **Time:** unbounded; this is the M3 success milestone, not a task.

---

## After all of the above

- Edit `docs/m3-launch-checklist.md` and flip every applicable `⬜ → ✅` / `🟡 → ✅`.
- Add a "Done" note to this doc with the date you closed each group.
- Send me (Claude) the URLs from M.1 + M.2 so I can wire them into the README, footer, governance doc, and welcome post.

---

## What I (Claude) am NOT doing while you work through this

- **Not pushing speculative changes** that depend on your URLs (Discussions, Projects). I'll wait for you to hand them back.
- **Not auto-flipping** any `⬜ → ✅` in the M3 checklist for tasks I can't verify happened.
- **Not creating issues** in the public repo for these — they'd noise your tracker on launch day.

If you want me to start on Direction-2 hardening or Direction-3 M4-prep work in parallel, say the word and I'll start there.
