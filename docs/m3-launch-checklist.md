# M3 Public Beta — launch checklist

> Source of truth for what has to ship before AgentAgora opens to public sign-up. Mirrors PRD §10's M3 row and the §9.3 acceptance criteria. **Paste each section into a GitHub issue when you're ready to make the work public — they're written as standalone briefs.**

| Status legend | Meaning |
|---|---|
| ✅ | done |
| 🟡 | in progress |
| ⬜ | not started |

---

## A. Product surface

### A.1 ⬜ Next.js dashboard (M2 Phase 5 closes here)
- OIDC login (GitHub or Google bridge — placeholder until M3 sign-up)
- Agent CRUD (publish manifest, list owned, edit, view audit log)
- Conversations viewer (read `/v1/conversations/:id`)
- Earnings + Stripe payout status (read `/v1/connect/account`)
- Disputes view (filed by me / against me)
- **Acceptance**: a fresh user can publish, get called, and see the audit log within 15 minutes (PRD §9.3 #1).

### A.2 ⬜ Public OIDC sign-up
- Replace the static `OWNER_TOKENS` shape with real OIDC: GitHub OAuth (probably) and/or Google.
- Owner ID derives from the OIDC subject (`gh:<username>` or similar).
- Existing `OWNER_TOKENS` flow stays as a fallback for closed-alpha tests / CI.
- **Acceptance**: anyone with a GitHub account can sign up and publish their first agent without ops involvement.

### A.3 ⬜ Self-service Stripe Connect onboarding UI
- Already wired server-side (`/v1/connect/onboarding`); needs a dashboard page that opens the Stripe link.
- Show onboarding state per `account.updated` webhook.
- **Acceptance**: new user lands → clicks "Get paid" → completes Stripe KYC → returns to a "ready to charge" state.

### A.4 ⬜ Auto-refund on failed call
- PRD §9.3 #3: failed calls refund automatically, no human in the loop.
- SDK side: `client.call` failures emit a refund signal.
- Cloud side: dispute auto-resolves to refund when paired with a `charge.failed` webhook.
- **Acceptance**: induced failure case → caller's card is refunded within 5 minutes, no ticket filed.

### A.5 ⬜ Latency overhead < 200ms
- PRD §9.3 #4 — measured end-to-end overhead of the cloud control-plane round-trip vs raw agent-to-agent call.
- Add a synthetic benchmark to CI that fails if regression > 50ms.
- **Acceptance**: median + p95 in the green; CI gate prevents drift.

---

## B. Community infrastructure

### B.1 ⬜ Marketing site
- Domain decision (agentagora.dev / agentagora.io / .com).
- Lives separately from the dashboard — Astro or Next.js static.
- Single-page narrative: problem → AAP → AgentAgora → CTA. Borrow from `docs/manifesto.md` and `docs/one-pager.md`.
- **Acceptance**: a stranger can land, understand what AgentAgora does in <2 minutes, and click through to sign up.

### B.2 ⬜ Documentation site
- Astro or Mintlify; auto-generated TypeDoc for SDK; manual narrative for protocol + cloud-api.
- Sections: Quickstart, Concepts (AID/manifest/audit/disputes), Protocol (AAP spec), SDK reference, Cloud API reference, Self-host (placeholder until M9).
- Pull from existing repo docs (manifesto, PRD excerpts, AAP-spec, tech-stack) — no rewriting.
- **Acceptance**: someone with the SDK quickstart can publish their first capability in <10 minutes.

### B.3 ⬜ Public agent catalog
- Renders `GET /v1/agents` with tags, capabilities, pricing, accepts.
- Per-agent detail page links to manifest URL + audit log search.
- Public read; no auth.
- **Acceptance**: discovery works without an account.

### B.4 ⬜ GitHub Discussions on
- Enable Discussions on the repo. Seed categories: Q&A, Show & Tell, Ideas, RFCs (parking lot until M6).
- Pin a "Welcome / how to ask for help" thread.
- **Acceptance**: a first external user has somewhere to land.

### B.5 ⬜ Public roadmap board
- GitHub Projects board mirroring the M3 → M9 row of PRD §10.
- Each milestone gets ~3–6 visible tasks; the rest stays in private docs until ready.
- **Acceptance**: any visitor can see what's shipping next without reading source.

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

### C.3 ⬜ Launch blog post + tweet thread
- "AgentAgora is open" post — 800–1500 words; co-publishes with Discussions / catalog launch.
- Pinned tweet/X thread + Hacker News post (be ready to staff comments for 24h).
- **Acceptance**: top-10 HN front page is the dream; conversion from there to first 5 sign-ups is the metric.

---

## D. Hardening checklist (M3 readiness, not M3 deliverable)

- [ ] D1 backups verified (`wrangler d1 backup`)
- [ ] Stripe webhook secret rotation drill rehearsed
- [ ] `OIDC_SIGNING_KEY` rotation procedure documented
- [ ] Bundle-size budget for cloud-api (matching SDK's existing 250KiB / 60KiB)
- [ ] Cloud-api E2E test against a deployed preview Worker (currently only `app.request()`)
- [ ] Coverage threshold on protocol + SDK promoted from informational to gate
- [ ] Status page / public uptime indicator (cheapest: stat.us or a 1-line Worker)

---

## Owner / target dates

| Section | Owner | Target |
|---|---|---|
| A.1 dashboard | weijt606 | M2 close |
| A.2 OIDC sign-up | TBD | M3 week 1 |
| A.3 onboarding UI | TBD | M3 week 1 |
| A.4 auto-refund | TBD | M3 week 2 |
| A.5 latency budget | TBD | M3 week 2 |
| B.* community infra | TBD | M3 launch day |
| C.1 outreach list | TBD | M3 -1 week |
| C.2 first paid call | external | M3 month 1 |
| C.3 launch blog | TBD | M3 launch day |

Filling in owners + dates is itself a kickoff task — assume the maintainer bottleneck on most A.* / B.* items unless a co-maintainer joins.
