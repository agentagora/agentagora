# Maintainer tasks — things only the human can do

> A focused checklist of every M3-launch task that requires **human action in an external system** (GitHub UI, production Cloudflare, Stripe dashboard, your own sales / outreach motion). Written so you can batch through them in one sitting.
>
> If a task can be automated by code, it is **not** in this file. See [`docs/m3-launch-checklist.md`](m3-launch-checklist.md) for the full M3 status.

Owner: **maintainer** (single maintainer).

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

> **Local dry-run first.** Before any of M.3–M.7, walk [`docs/local-dev.md`](local-dev.md). The full stack (cloud-api + dashboard + marketing + SDK demo) runs on your laptop with sandbox secrets and no external accounts — that proves the engine works before you spend time on real provisioning. The local dry-run was verified end-to-end on 2026-05-13.

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
>
> **Tooling ready (2026-05-21):** `apps/cloud/api/scripts/pit-restore-drill.sh` encodes the two phases below. Run `…/pit-restore-drill.sh write` from a terminal logged into prod wrangler; wait ≥ 1 h; run `…/pit-restore-drill.sh verify <sentinel-id>`. The script handles export → scratch create → import → sentinel query → scratch delete → prod sentinel cleanup. RUNBOOK §3.4 was updated to point at it.

- **What:** export D1 → import to a scratch D1 instance → query a row that you wrote 1 hour ago → confirm it's there.
- **Why:** RUNBOOK §3.4 explicitly flags PIT-restore as un-rehearsed. Until you've done it once on real prod data, the durability story is theoretical.
- **Where:** local terminal + `wrangler d1`. Drives prod via the cloud-api package's pinned wrangler (`pnpm --filter @agentagora/cloud-api exec wrangler …`).
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
>
> **Precondition unblocked (2026-05-21):** the `latency-bench` job sat disabled because `nohup wrangler dev &` never detached cleanly on GitHub runners. Resolution: a `bench:server` entry in `apps/cloud/api/bench/server.ts` hosts `createApi()` via `@hono/node-server`, sidestepping wrangler-in-CI. The job is now live in `.github/workflows/typescript.yml` with `continue-on-error: true` so the 14-run counter can actually start accumulating. Trade-off documented in `bench/server.ts`: measures Hono+Node, not the Workers runtime — right granularity for regression detection.

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

### M.15 ✅ Bump `next` 14.x → 15.5.18 (closed 2026-05-13)

Landed at `next@15.5.18`. Codemod (`@next/codemod next-async-request-api`) applied to all 38 dashboard files — modified 10 (cookies/params/searchParams now awaited). Build clean, all 64 dashboard tests pass, end-to-end session lifecycle verified locally: bearer-paste login mints session, `/home /agents /conversations /disputes /earnings` all 200 with cookie, `/api/auth/logout` 303s + post-logout `/home` redirects (307). Two latest CVEs closed: middleware/proxy bypass in Pages router i18n (`<15.5.16`) and Server Components DoS (`<15.5.15`).

Stayed on React 18 (Next 15 supports both 18 and 19) to minimize blast radius. React 19 migration is independent and tracked separately when there's a concrete reason.



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

### M.16 ✅ Bump `astro` 4.16 → 5.x (closed 2026-05-13)

Landed at `astro@5.18.1`. The marketing site (only Astro consumer) builds cleanly, dev server starts, sitemap output unchanged, landing page renders + live catalog from cloud-api still populates. `pnpm audit` no longer reports any Astro advisory. Tailwind plugin bumped to `@astrojs/tailwind@6.0.2` (peer-compatible with Astro 5); sitemap to `^3.7.2`. Kept on Astro 5 (not 6) because `@astrojs/tailwind@6` doesn't yet declare Astro-6 peer compatibility — revisit at M7 when Astro 6 ecosystem catches up.



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

### M.17  After both upgrades: tighten the audit floor (deferred)

- **Status as of 2026-05-13:** `pnpm audit --prod --audit-level=high` is **0 highs / 0 criticals** after M.15 + M.16 landed. Tightening the floor to `moderate` would fail CI on 4 remaining moderates (transitive deps of build tools; mostly path / hostname disclosure with no exploit path against our deploy). Leave the gate at `--audit-level=high` for now — that's correctly fail-closed against the class of advisories that actually matter.
- **Action:** when the 4 moderates are either patched upstream or you decide to formally accept them, then change `.github/workflows/typescript.yml`'s audit step from `--audit-level=high` back to `--audit-level=moderate` and convert the `::warning::` annotation back to a hard `exit 1`.
- **Acceptance:** CI run on a fresh push is green with the moderate floor.
- **Time:** 5 min — when ready.

### M.18 ✅ Backfill cloud-api coverage: fail-closed + body-limit + L4 (closed 2026-05-21)

Landed. `buildApp` exported from `apps/cloud/api/src/index.ts` so the §M7 env-adapter layer is reachable from tests. New test files:

- `apps/cloud/api/tests/build-app.test.ts` — 7 tests: production fail-closed throws on missing NONCES / RATE_LIMITS / both; success path with both bindings; non-production dev fallback accepts any env shape.
- `apps/cloud/api/tests/body-limit.test.ts` — 7 tests: 413 `payload_too_large` on oversized POST to `/v1/audit/ingest` (1024 KiB), `/v1/agents` (64 KiB), `/v1/disputes` (16 KiB), `/v1/nonces/check` (16 KiB); under-limit happy path still reaches each route's validator (proving body-limit didn't swallow the request).
- `apps/cloud/api/tests/connect.test.ts` — extended with §L4 sub-describe: 4 × 401 (no bearer / invalid bearer on `/account` + `/onboarding`) and a positive 503 case (valid bearer + Stripe unconfigured) to prove the short-circuit still routes correctly.

Coverage moved from 66.84% lines/statements → **86.21% lines/statements** (87.73% branches / 83.70% functions). Floors in `apps/cloud/api/vitest.config.ts` ratcheted from 65/82/75/65 → **80/82/78/80**, above the original M3 baseline of 72.68%. CHANGELOG entry recorded under "Testing".

---

> Original brief preserved for context:

- **Why:** the M3 §D gate locked cloud-api at 67% lines/statements. After Hono 4.6 → 4.12.18 + the M7/M9/M10/M11/L4 hardening pack, measured coverage dropped to 66.84%. The drop is real (new code paths fire only under conditions the unit suite doesn't simulate) but doesn't reflect missing test value — it reflects missing tests on already-shipped guards. The threshold was lowered to 65 in `apps/cloud/api/vitest.config.ts` as a stop-gap so green CI doesn't block UI PRs.
- **What:** add unit tests for these specific branches, then bump the floor back to ≥72 (the post-hardening target should be higher than the original 67 since the security pack added MORE testable surface, not less):
  - **M7 fail-closed checks** — set `AAP_ENV=production` + leave `NONCES` / `RATE_LIMITS` KV bindings unset, assert `createApi` throws the production-must-bind error. Mirror tests for the success path (production with bindings).
  - **M11 body-limit middleware** — POST `> tooLarge(N)` bytes to `/v1/audit/ingest` (1024 KiB cap), `/v1/agents` (64 KiB), `/v1/disputes` (16 KiB); assert 413 + `{ error: "payload_too_large" }` envelope. Confirm under-limit happy path still returns the existing 200/201.
  - **L4 auth-before-503** — call `POST /v1/connect/account` and `POST /v1/connect/onboarding` with no bearer / invalid bearer when Stripe is unconfigured; assert 401 (not 503). Confirm 503 still fires when bearer is valid + Stripe is unconfigured.

---

## Group F — M4 spec-hardening decisions

> **Status: closed 2026-05-07.** All five F items decided. F.1-F.4 went with the recommendations; F.5 was overridden by the maintainer (Apache-2.0 wins over CC-BY for simplicity — single-license repo, less mental overhead). Decisions recorded in `docs/m4-plan.md`. Phase 2 of the M4 plan is now unblocked.

### F.1 ✅ RFC-style structure for the Phase 3 spec rewrite

**Decision: IETF style** (recommendation accepted).

Modeled on OAuth / OIDC. Sections include: Introduction, Terminology (RFC 2119 keywords), normative requirements with explicit MUST/SHOULD/MAY, Security Considerations, IANA Considerations (placeholder), Acknowledgements. First hardened section will use this shape.

### F.2 ✅ "AgentAgora-compatible" badge level

**Decision: Tier 1 + Tier 2 for the public badge; Tier 3 reserved for "registered peer registry" status when federation goes live (M10+).** (Recommendation accepted.)

Badge wording draft: *"This service implements AgentAgora Protocol v0.x — Tier 1 (public surface) + Tier 2 (auth)."* Wired into the suite's README in Phase 2.

### F.3 ✅ Tier 3 fixture-setup approach

**Decision: CLI provisioner is the primary path; declarative-seed mode is a fallback for impls that don't yet support full publish flow.** (Recommendation accepted.)

Implications for code:
- `packages/protocol-compliance/src/cli.ts` — entry point: `pnpm protocol-compliance --setup --base-url=…`
- Provisioner writes a known keypair + manifest + seeded conversation through the candidate API
- A `--seed-file=fixtures.json` flag bypasses provisioning when the candidate isn't full-impl
- Tier 3 tests assume fixtures exist; emit clear error if not yet provisioned

### F.4 ✅ M6 public-release scope

**Decision: spec + compliance suite (no separate "reference impl" framing).** (Recommendation accepted.)

The reference impl (`packages/sdk` + `apps/cloud/api`) is already part of the public repo by virtue of the M3 flip; M6 is positioned as "the protocol becomes referenceable, not just shipped" — spec doc + the compliance suite that gives `AgentAgora-compatible` an objective definition.

### F.5 ✅ Spec licensing — Apache-2.0 (maintainer override)

**Decision: spec stays Apache-2.0.** (Recommendation was CC-BY-4.0; maintainer chose to keep the repo single-license.)

Rationale recorded by maintainer: lower mental overhead for downstream implementers (one license to scan, not two), simpler for the M6 launch post, no header gymnastics on every doc file. Apache-2.0 is unambiguous about implementation rights — the spec is "Apache-licensed prose" rather than "Apache-licensed code", but the legal effect of "you can implement it" is identical.

`docs/protocol-stewardship.md` Trigger #3 ("Cloud relicenses to non-Apache-2.0") still applies as written; it now also implicitly applies to the spec since they share a license.

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
