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

## Group E — Deferred dependency upgrades (post-launch hardening)

These are major-version bumps with breaking changes. They're not on the M3 critical path, and their advisories are mitigated for now (see "today's mitigation" notes). Do them in a quiet week after M3 stabilises, ideally one at a time so you can isolate regressions.

The CI audit step at `.github/workflows/typescript.yml` runs at `--audit-level=high` and emits these as `::warning::` annotations rather than failing the job. Once both upgrades land, drop the level back to `moderate` so the gate has teeth again.

### M.15  Bump `next` 14.x → 15.5.15+

> Closes 2 high-severity advisories on `apps/cloud/dashboard`:
>   - `>=13.0.0 <15.0.8` HTTP request deserialization DoS — `GHSA-h25m-26qc-wcjf`
>   - `>=13.0.0 <15.5.15` Server Components DoS — `GHSA-q4gf-8mx6-v5v3`

- **What:** upgrade `apps/cloud/dashboard` from Next 14.2.30 to 15.5.15+.
- **Why:** both are remotely exploitable DoS — low likelihood of weaponisation against a single-tenant dashboard with auth-gated routes (most dashboard endpoints require an OAuth session), but worth fixing before public launch hits non-trivial traffic.
- **Today's mitigation:** dashboard routes that take user input are auth-gated (`(dashboard)/...` group). Public routes (`(public)/...`, `/login`) take only the GitHub OAuth callback parameters which are validated against the HMAC-signed state. Risk is bounded.
- **Migration shape:** Next 15 enables async `cookies()` / `headers()` / `params` / `searchParams` by default — every Server Component that uses them needs `await`. Run `npx @next/codemod@canary next-async-request-api .` from `apps/cloud/dashboard/` to auto-fix most call sites; review and run the typecheck.
- **Acceptance:**
  - `apps/cloud/dashboard/package.json` bumps `next` and `eslint-config-next` to 15.5.15+
  - `pnpm --filter @agentagora/cloud-dashboard build` passes
  - `pnpm --filter @agentagora/cloud-dashboard test` passes (the existing 64 lib tests don't touch Next surfaces, so they should be no-ops)
  - Manual smoke: GitHub OAuth flow + agent CRUD round-trip, identical to today
- **Time:** 2-4 hours (~30 min upgrade, the rest is touching every Server Component the codemod missed)

### M.16  Bump `astro` 4.16 → 5.15.8+ (or 6+)

> Closes 1 high-severity advisory on `apps/marketing`:
>   - `<=5.15.6` reflected XSS via server islands — `GHSA-wrwg-2hg8-v723`
> Also clears 1 moderate (`<6.1.6` define:vars XSS — `GHSA-j687-52p2-xcff`) if you go to 6+.

- **What:** upgrade `apps/marketing` from Astro 4.16.18 to 5.15.8+. Going to 6+ in the same migration is cleaner.
- **Why:** marketing site is fully public-facing (the literal entry point for the project). Reflected-XSS surface should be patched before HN traffic.
- **Today's mitigation:** we don't use Astro server islands (`server:defer`) anywhere in `apps/marketing/src/`, so the XSS path isn't actually reachable in our build. Verify with `grep -r "server:defer" apps/marketing/src` — should be empty. Doesn't make the bump optional, but means there's no urgency to ship it before launch.
- **Migration shape:** Astro 5 hardens default config (Content Layer GA, type-safe env, simplified routing). Run the official migration guide. Watch out for `@astrojs/sitemap` — we previously pinned to 3.2.1 because 3.7 crashed on Astro 4.16 (`pnpm-lock.yaml`). Astro 5/6 likely needs sitemap 4+. Test the sitemap output before merging.
- **Acceptance:**
  - `apps/marketing/package.json` bumps `astro` and `@astrojs/sitemap` (and any other `@astrojs/*` deps) to compatible versions
  - `pnpm --filter @agentagora/marketing build` passes
  - `apps/marketing/dist/sitemap-*.xml` exists and lists every page
  - Manual smoke: the agent catalog at `/` renders live cards; OG cards on blog posts still resolve
- **Time:** 3-6 hours (Astro is more migration-heavy than Next typically because Tailwind + the sitemap integration both have version-coupling)

### M.17  After both upgrades: tighten the audit floor

- **What:** in `.github/workflows/typescript.yml`, change the audit step from `--audit-level=high` back to `--audit-level=moderate`, and convert the `::warning::` annotation back into a hard `exit 1` so the gate fails the build on regressions.
- **Acceptance:** CI run on a fresh push is green with the moderate floor.
- **Time:** 5 min

---

## Group F — M4 spec-hardening decisions (deferred — engage after M3 launch)

These are decisions that gate M4 Phase 2 / 3 — see [`docs/m4-plan.md`](m4-plan.md) for the full plan. Phase 1 (compliance scaffold + Tier 1 tests) doesn't need them and is already in flight; Phases 2 + 3 hit the decision points below.

These are **non-urgent during M3 launch**. Triage them when you sit down to start M4 spec hardening.

### F.1  Pick an RFC-style structure for the Phase 3 spec rewrite

- **What:** decide whether the hardened `docs/AAP-spec.md` should follow IETF RFC structure (IANA considerations, security considerations, etc.), W3C TR style, or a homegrown shape inspired by but not bound to either.
- **Why:** the choice affects how external SDK authors read the spec at M6 public release. IETF style is the most familiar to systems engineers; W3C style is more web-oriented. Homegrown is faster to write but less legible to standards readers.
- **Recommendation:** IETF style. Mirrors how OAuth / OIDC specs read; minimum-friction for crypto-aware reviewers; supports inline `MUST` / `SHOULD` / `MAY` natively. But you decide.
- **Acceptance:** `docs/m4-plan.md` Phase 3 section updated with the chosen structure; first hardened section uses it.
- **Time:** 30 min reading + decision

### F.2  Define what level of compliance earns the "AgentAgora-compatible" badge

- **What:** decide which tier(s) a second cloud implementation must pass to claim AgentAgora-compatibility:
  - Tier 1 only (read-path, public surface) — minimum bar
  - Tier 1 + Tier 2 (read + auth) — passable third-party registry
  - All three tiers (incl. Tier 3 mutation paths) — full federation-ready
- **Why:** badge level shapes adoption — too lax and "compatible" means nothing; too strict and nobody clears it. The right answer probably depends on how lighthouse partners react to early access.
- **Recommendation:** Tier 1 + 2 for the public badge; Tier 3 for "registered as a peer registry" once federation is live (M10+).
- **Acceptance:** decision recorded in `docs/m4-plan.md` and the compliance suite README; badge wording drafted.
- **Time:** 1-2 hours (likely needs a couple of partner conversations first)

### F.3  Decide Phase 2 Tier 3 fixture-setup approach

- **What:** Tier 3 tests need known-state setup (a published manifest, a known keypair, a seeded conversation). Choose between:
  - **CLI provisioner:** `pnpm protocol-compliance --setup` writes fixtures via the candidate API
  - **Declarative seed file:** YAML/JSON describing fixtures, runner applies them
  - **Per-test setup hooks:** each test creates + tears down its own state
- **Why:** the choice ripples into how a third-party impl runs the suite. CLI-provisioner is most ergonomic but assumes the candidate API supports the full publish flow first. Declarative seed is most portable. Per-test is most isolated but slowest.
- **Recommendation:** CLI provisioner with a fallback declarative seed mode for impls that don't support the full publish flow yet (those run only Tier 1 + 2).
- **Acceptance:** decision recorded in `docs/m4-plan.md` Phase 2; first Tier 3 test follows the chosen pattern.
- **Time:** 30 min decision + design notes

### F.4  Decide M6 public-release scope

- **What:** decide what ships together at M6:
  - Just the spec (`docs/AAP-spec.md`)
  - Spec + compliance suite (`packages/protocol-compliance/`)
  - Spec + compliance suite + reference TypeScript impl (`packages/sdk` + `apps/cloud/api/`)
- **Why:** more = more useful to early implementers; less = smaller blast radius if something is wrong on day 1.
- **Recommendation:** spec + compliance suite. Reference impl is already public (Apache-2.0) by virtue of the repo flipping public, so this is mostly about how we frame the M6 launch post.
- **Acceptance:** decision recorded; M6 launch post drafts mention the chosen scope; `docs/protocol-stewardship.md` trigger #1 (AAP v1.0 / first breaking change in production) updated with the M6 scope.
- **Time:** 30 min

### F.5  Spec licensing decision

- **What:** decide whether to re-license `docs/AAP-spec.md` under a different license than the rest of the repo (Apache-2.0). Common alternatives:
  - **CC-BY-4.0** — "anyone can implement; just credit AgentAgora as the originator"
  - **CC-BY-SA-4.0** — same, but derivative specs must also be CC-BY-SA
  - **Apache-2.0 (current)** — same license as the code; less common for prose specs but legally fine
- **Why:** the spec is a different kind of artifact than the code — implementers want clarity that they can ship code under any license while implementing the spec. CC-BY signals "this is meant to be implemented widely."
- **Recommendation:** CC-BY-4.0 for the spec at M6 launch. Code stays Apache-2.0 (per [GOVERNANCE.md](../GOVERNANCE.md)). Add a `docs/AAP-spec.md` header explaining the dual-license setup.
- **Acceptance:** licensing decision in `docs/m4-plan.md`; spec header updated; `docs/protocol-stewardship.md` trigger #3 (relicense) updated.
- **Time:** 30 min decision + read [https://creativecommons.org/share-your-work/](https://creativecommons.org/share-your-work/)

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
