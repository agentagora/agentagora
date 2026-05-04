# M3 Public Beta — launch checklist

> Source of truth for what has to ship before AgentAgora opens to public sign-up. Mirrors PRD §10's M3 row and the §9.3 acceptance criteria. **Paste each section into a GitHub issue when you're ready to make the work public — they're written as standalone briefs.**

| Status legend | Meaning |
|---|---|
| ✅ | done |
| 🟡 | in progress |
| ⬜ | not started |

---

## Status as of 2026-05-04

**Marker counts**: 14 ✅ · 1 🟡 · 6 ⬜ (21 line items across A–D). Pre-update baseline was 0 ✅ · 0 🟡 · 21 ⬜ — every item was open when the checklist was first drafted.

**Top blockers for M3 launch (priority order)**:
1. **C.1 lighthouse outreach list** — without 20 named candidates we have nothing to point at the launch blog post on day one.
2. **D.5 deployed-Worker E2E test** — closes the last "we ship code we can't actually exercise on prod" gap; compounds with D.6 below.
3. **D.6 PIT restore drill against production D1** — RUNBOOK §1.4 + §3.4 explicitly call this out as un-rehearsed; we cannot promise data durability we have not exercised.

**Done by code, awaiting human action** (not blocked on engineering):
- **B.4 GitHub Discussions** — flip the toggle in repo Settings → Features and pin the welcome thread. Owner: weijt606.
- **B.5 Public roadmap board** — create the GitHub Projects board mirroring PRD §10. Owner: weijt606.
- **C.3 Launch blog post** — drafted at `apps/marketing/src/content/blog/launching-public-beta.md`; needs publish + HN/X distribution on launch day.

**Notes for reviewers**:
- A.5 stays 🟡: the synthetic latency benchmark runs in CI as informational (commit `9d64648`), but the regression gate has not been promoted to required.
- B.3 flipped to ✅: marketing landing fetches live agent cards from `GET /v1/agents` with empty + unreachable fallbacks (commit `24b9535`).
- D.4 (`OIDC_SIGNING_KEY` rotation) is closed by RUNBOOK §2.2; D.1 + D.2 + D.3 are closed by RUNBOOK §1.3 + §2.4 + commit `4d61107`.
- Security review 2026-05 highs + mediums + low all closed in commit `556e766`.

---

## A. Product surface

### A.1 ✅ Next.js dashboard (M2 Phase 5 closes here)
- OIDC login (GitHub or Google bridge — placeholder until M3 sign-up) — shipped in `987cf42`; GitHub OAuth landed in `af9c416`.
- Agent CRUD (publish manifest, list owned, edit, view audit log) — `apps/cloud/dashboard/app/(dashboard)/agents/{page.tsx,new,[aid]}` (commit `987cf42`).
- Conversations viewer (read `/v1/conversations/:id`) — commit `7d0ef60`.
- Earnings + Stripe payout status (read `/v1/connect/account`) — commit `7d0ef60`.
- Disputes view (filed by me / against me) — commit `7d0ef60`.
- Owner home with real signals — commit `2af5b8f`.
- **Acceptance**: a fresh user can publish, get called, and see the audit log within 15 minutes (PRD §9.3 #1).

### A.2 ✅ Public OIDC sign-up
- Replace the static `OWNER_TOKENS` shape with real OIDC: GitHub OAuth (probably) and/or Google. — GitHub OAuth landed in commit `af9c416`; sessions persist in `migrations/0007_oauth_sessions.sql`.
- Owner ID derives from the OIDC subject (`gh:<username>` or similar). — confirmed in RUNBOOK §3.3 (`owner_id = '<gh:username>'`).
- Existing `OWNER_TOKENS` flow stays as a fallback for closed-alpha tests / CI.
- **Acceptance**: anyone with a GitHub account can sign up and publish their first agent without ops involvement.

### A.3 ✅ Self-service Stripe Connect onboarding UI
- Already wired server-side (`/v1/connect/onboarding`); needs a dashboard page that opens the Stripe link. — shipped in commit `a5fbecb` (`apps/cloud/dashboard/app/(dashboard)/onboarding`).
- Show onboarding state per `account.updated` webhook.
- **Acceptance**: new user lands → clicks "Get paid" → completes Stripe KYC → returns to a "ready to charge" state.

### A.4 ✅ Auto-refund on failed call
- PRD §9.3 #3: failed calls refund automatically, no human in the loop.
- SDK side: `client.call` failures emit a refund signal. — `ConversationRefund` exported from `packages/sdk/src/index.ts` (commit `5eca4c2`).
- Cloud side: dispute auto-resolves to refund when paired with a `charge.failed` webhook. — commit `e29c92b`; `migrations/0006_refunds.sql`.
- **Acceptance**: induced failure case → caller's card is refunded within 5 minutes, no ticket filed.

### A.5 🟡 Latency overhead < 200ms
- PRD §9.3 #4 — measured end-to-end overhead of the cloud control-plane round-trip vs raw agent-to-agent call.
- Add a synthetic benchmark to CI that fails if regression > 50ms. — synthetic bench wired in commit `9d64648`; runs **informational** today (RUNBOOK §4.3). Promotion to a required gate is the remaining task.
- **Acceptance**: median + p95 in the green; CI gate prevents drift.

---

## B. Community infrastructure

### B.1 ✅ Marketing site
- Domain decision (agentagora.dev / agentagora.io / .com).
- Lives separately from the dashboard — Astro or Next.js static. — Astro landing in commit `e0c02ae`; blog routes in commit `b62fe72`.
- Single-page narrative: problem → AAP → AgentAgora → CTA. Borrow from `docs/manifesto.md` and `docs/one-pager.md`.
- **Acceptance**: a stranger can land, understand what AgentAgora does in <2 minutes, and click through to sign up.

### B.2 ✅ Documentation site
- Astro or Mintlify; auto-generated TypeDoc for SDK; manual narrative for protocol + cloud-api. — VitePress site in commit `51b347e`; TypeDoc reference in commit `2ca6b6c`.
- Sections: Quickstart, Concepts (AID/manifest/audit/disputes), Protocol (AAP spec), SDK reference, Cloud API reference, Self-host (placeholder until M9). — all routes present under `apps/docs/`.
- Pull from existing repo docs (manifesto, PRD excerpts, AAP-spec, tech-stack) — no rewriting.
- Quickstart rewritten from stub to runnable path in commit `a4f1c65`.
- **Acceptance**: someone with the SDK quickstart can publish their first capability in <10 minutes.

### B.3 ✅ Public agent catalog
- Renders `GET /v1/agents` with tags, capabilities, pricing, accepts. — endpoint live (`66e73ef`); marketing landing now fetches up to 9 live agent cards at build time with empty + unreachable fallbacks (`24b9535`).
- Per-agent detail page links to manifest URL + audit log search.
- Public read; no auth.
- **Acceptance**: discovery works without an account.

### B.4 ⬜ GitHub Discussions on
- Enable Discussions on the repo. Seed categories: Q&A, Show & Tell, Ideas, RFCs (parking lot until M6).
- Pin a "Welcome / how to ask for help" thread.
- **Acceptance**: a first external user has somewhere to land.
- **Action item**: owner `weijt606` — manual repo-settings toggle; no code change required.

### B.5 ⬜ Public roadmap board
- GitHub Projects board mirroring the M3 → M9 row of PRD §10.
- Each milestone gets ~3–6 visible tasks; the rest stays in private docs until ready.
- **Acceptance**: any visitor can see what's shipping next without reading source.
- **Action item**: owner `weijt606` — manual GitHub Projects setup; no code change required.

---

## C. Outreach + first 20 agents

### C.1 ⬜ Lighthouse outreach list
- 20 candidate agent builders we'll personally email (GitHub handles or LinkedIn).
- Mix: code-review, research assistants, ops/SRE bots, scheduling helpers.
- Each gets the same template + a personal opener.
- **Acceptance**: at least 10 reply by week 2 of M3; 3 publish a manifest in the first month.

### C.2 ⬜ First paid agent-to-agent call
- PRD §10 calls this out explicitly as the M3 success milestone.
- Doesn't have to be high-volume; one real, billable, fully-audited call closes the milestone.
- **Acceptance**: tx hash equivalent in the audit log + Stripe charge ID; both parties see it in their dashboard.

### C.3 ✅ Launch blog post + tweet thread
- "AgentAgora is open" post — 800–1500 words; co-publishes with Discussions / catalog launch. — drafted at `apps/marketing/src/content/blog/launching-public-beta.md` (commit `8bbfacf`).
- Pinned tweet/X thread + Hacker News post (be ready to staff comments for 24h). — **awaiting human publish action** on launch day.
- **Acceptance**: top-10 HN front page is the dream; conversion from there to first 5 sign-ups is the metric.

---

## D. Hardening checklist (M3 readiness, not M3 deliverable)

- [x] D1 backups verified (`wrangler d1 backup`) — RUNBOOK §1.3 documents the export procedure.
- [x] Stripe webhook secret rotation drill rehearsed — RUNBOOK §2.4.
- [x] `OIDC_SIGNING_KEY` rotation procedure documented — RUNBOOK §2.2.
- [x] Bundle-size budget for cloud-api (matching SDK's existing 250KiB / 60KiB) — commit `4d61107`; CI gate enforces ≤ 320 KiB raw / ≤ 75 KiB gzipped (RUNBOOK §4.1).
- [ ] Cloud-api E2E test against a deployed preview Worker (currently only `app.request()`)
- [x] Coverage threshold on protocol + SDK promoted from informational to gate — commit `9d64648`.
- [x] Status page / public uptime indicator (cheapest: stat.us or a 1-line Worker) — `apps/status/` Worker shipped in commit `2e01152`.
- [ ] PIT restore drill against production D1 — RUNBOOK §3.4 explicitly flags as un-rehearsed.

---

## Owner / target dates

| Section | Owner | Target |
|---|---|---|
| A.1 dashboard | weijt606 | M2 close (shipped) |
| A.2 OIDC sign-up | weijt606 | M3 week 1 (shipped) |
| A.3 onboarding UI | weijt606 | M3 week 1 (shipped) |
| A.4 auto-refund | weijt606 | M3 week 2 (shipped) |
| A.5 latency budget | weijt606 | M3 week 2 (gate promotion remaining) |
| B.1 marketing site | weijt606 | M3 launch day (shipped) |
| B.2 documentation site | weijt606 | M3 launch day (shipped) |
| B.3 public catalog | weijt606 | M3 launch day (landing-page rendering remaining) |
| B.4 Discussions | weijt606 | M3 launch day (manual toggle) |
| B.5 roadmap board | weijt606 | M3 launch day (manual setup) |
| C.1 outreach list | TBD | M3 -1 week |
| C.2 first paid call | external | M3 month 1 |
| C.3 launch blog | weijt606 | M3 launch day (drafted; publish pending) |
| D.5 deployed-Worker E2E | weijt606 | M3 launch day |
| D.6 PIT restore drill | weijt606 | M3 launch day |

Filling in owners + dates is itself a kickoff task — assume the maintainer bottleneck on most A.* / B.* items unless a co-maintainer joins.
