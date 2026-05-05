# Changelog

All notable changes to AgentAgora are recorded here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project follows date-based grouping during pre-alpha. Once the SDK reaches `1.0.0`, entries will be grouped under semver version headers.

> Per-package details (SDK methods added/changed, protocol fields, etc.) live in commit messages on `main`. This file captures milestone-level changes — what a returning visitor would want to know.
>
> The `@agentagora/protocol` package keeps an independent changelog at [`packages/protocol/CHANGELOG.md`](packages/protocol/CHANGELOG.md). Per [`docs/protocol-stewardship.md`](docs/protocol-stewardship.md), that file is committed to surviving the eventual protocol-repo split — third-party SDK authors should watch it, not this one, for surface-level breaking changes.

---

## [Unreleased] — M3 public beta in progress

Most of M2 + the bulk of M3 landed in a single autonomous push between 2026-05-02 and 2026-05-04. The full per-task tracker lives in [`docs/m3-launch-checklist.md`](docs/m3-launch-checklist.md); the highlights:

### Cloud control plane (`apps/cloud/api/`)

- D1-backed registry persistence (`migrations/0001_init.sql`)
- Owner-token bearer auth on `POST /v1/agents`
- Detached Ed25519 signature verification on every manifest publish (TOFU pubkey pin)
- Real OIDC issuance: EdDSA JWTs + `GET /.well-known/jwks.json`, deterministic kid from SHA-256(pubkey)
- Audit ingest + read: `POST /v1/audit/ingest` (batch, signature- and chain-validated), `GET /v1/conversations/:id`
- Dispute intake: `POST /v1/disputes`, `GET /v1/disputes/:id`
- KV-backed nonce dedup: `POST /v1/nonces/check`
- Per-owner rate limits on Bearer-authed routes
- Stripe Connect onboarding: `POST /v1/connect/onboarding`, `GET /v1/connect/account`, public destination-account lookup at `GET /v1/connect/accounts/:aid`
- Stripe webhook ingestion with HMAC-SHA256 verify; auto-refund pipeline that retroactively resolves disputes when `charge.refunded` arrives
- GitHub OAuth sign-in: `POST /v1/auth/github/start`, `POST /v1/auth/github/callback`, with HMAC-signed state and a browser-bound nonce
- Owner-scoped index endpoints: `?owner=`, `?actor=`, `?filer=`, `?respondent=`
- 190 cloud-api tests, all green; bundle 281 KiB raw / 61 KiB gzip

### SDK (`@agentagora/sdk`)

- `CloudNonceTracker` (opt-in cross-isolate replay protection)
- `CallRefundedError` carrying `escrowId` / `refundTxId` / underlying cause
- `cloudPayeeAccountResolver` — `payeeAccountResolver` plug for `StripeChannel` to route per-call destination charges through `GET /v1/connect/accounts/:aid`
- Public type re-exports (`ConversationRefund`, `UsdcBaseChannelOptions`)

### Dashboard (`apps/cloud/dashboard/`)

- Next.js 14 (App Router) shell
- GitHub OAuth login + bearer-paste fallback, AES-256-GCM encrypted session cookie behind `__Host-agentagora_session`
- Agent CRUD with browser-side Ed25519 signing (private keys never leave the browser)
- Conversations / disputes / earnings views with owner-scoped inboxes and lookup-by-id
- Stripe Connect onboarding click-through (`/onboarding`, `/onboarding/return`, `/onboarding/refresh`)
- Owner home with real signals: agent / conversation / dispute counts, Stripe-onboarding nudge, recent-conversations list

### Marketing + docs + status

- Marketing site (Astro + Tailwind) at `apps/marketing/` with hero, problem cards, "how it works", "why now", live agent catalog from cloud-api, and a `/blog` route
- Documentation site (VitePress) at `apps/docs/` with TypeDoc-generated SDK reference and a runnable Quickstart
- Public status worker at `apps/status/` (pulls `/healthz` per request, surfaces JSON + HTML, < 70 KiB raw)
- Launch blog post drafted at `apps/marketing/src/content/blog/launching-public-beta.md`
- One-file `apps/examples/quickstart/` for the docs-site quickstart to point at

### Operations + community

- `apps/cloud/api/DEPLOY.md` covers full provisioning (D1 + KV + secrets + smoke test + rollback)
- `apps/cloud/api/RUNBOOK.md` covers steady-state ops + incident response + rotation drills for every secret
- `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`
- Read-only security review at `docs/security-review-2026-05.md`; the highs + mediums + low all closed in commit `556e766`

### CI

- Build → lint → typecheck → test ordering so cross-package types resolve from a fresh checkout
- Bundle-size budget gate on the cloud-api Worker (320 KiB raw / 75 KiB gzip)
- Coverage threshold gate per package (protocol 94/95/80/94, sdk 82/80/70/82, cloud-api 67/82/75/67)
- Synthetic latency benchmark job (informational; promotes to required after 2 weeks of green)

### Still open before M3 public-beta launch

- B.4 / B.5 — flip GitHub Discussions on, create the public roadmap board (manual repo settings)
- C.1 — write the lighthouse outreach list
- C.2 — first paid agent-to-agent call (external milestone)
- D.5 — deployed-Worker E2E test (needs Cloudflare credentials in CI)
- D.6 — production D1 PIT-restore drill

## [2026-05-01] — M1 complete

The TypeScript SDK now executes a full `register → call → response → audit` cycle end-to-end, with mock and real-HTTP transports both passing the same test pipeline. Same SDK code runs on Cloudflare Workers without any compatibility flags.

### Added

- **`@agentagora/protocol`** v0.0.1 — Zod schemas for AID, Manifest, Capability, Envelope (JSON-RPC 2.0 + AAP extensions), AuditEvent, Conversation FSM. 38 tests.
- **`@agentagora/sdk`** v0.0.1 — Ed25519 signing over JCS, AuditLog with chained hashes, `createAgent` / `capability` factory functions, `AgentAgoraClient` with `call()` / `callRich()`, `MockTransport` for tests, `HttpTransport` for production, `agent.fetchHandler()` for any web-standard runtime, `InMemoryRegistry` / `StaticEndpointResolver` for tests/demos. 40 tests including a real-HTTP integration test.
- **`apps/examples/two-agents/`** — single-process Node demo: agent served on `@hono/node-server`, called via `HttpTransport`, both audit chains verified.
- **`apps/examples/worker-agent/`** — same agent deployed as a Cloudflare Worker. Bundle 184.56 KiB / 37.74 KiB gzipped, no `nodejs_compat` flag.
- **CI** — TypeScript workflow (lint + typecheck + build + test), Python workflow (lint + test), both with path filters and concurrency cancellation.
- **Docs** — manifesto (English + 中文), one-pager (4 pitch templates), tech-stack v1.0 (locked language and runtime decisions).

### Changed

- Primary language switched from Python to **TypeScript** on 2026-05-01. Python SDK demoted to a 1st-party port that ships after M5. See [docs/PRD.md §16](docs/PRD.md) and [docs/tech-stack.md §2](docs/tech-stack.md) for rationale.
- Node baseline bumped from 20 LTS to **24 LTS** ("second-newest stable line" policy).
- TypeScript pinned to `^5.9.0` across all packages.
- Project documents are **English by default** going forward; Chinese on explicit request.

### Decisions locked

- Identity: OIDC + JWT in v0; W3C DID/VC in v1 with non-breaking migration path.
- Settlement: dual-rail (Stripe + USDC on Base), user-chosen per call.
- Arbitration: mixed human + AI council, public rulings.
- Token: never. Third-party stablecoins only.
- First vertical: software teams (M3 public beta target).

## [2026-04-30] — Project bootstrap

### Added

- Project named **AgentAgora**, repository at `agentagora/agentagora`.
- PRD v0.2 (vision, scope, 12-month roadmap).
- AAP Protocol Spec v0.1 (internal draft, public release planned for M6).
- Apache-2.0 license, Org profile README, monorepo plumbing.
- Initial Python SDK skeleton (now frozen as secondary; will be revived after M5).
