# Changelog

All notable changes to AgentAgora are recorded here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project follows date-based grouping during pre-alpha. Once the SDK reaches `1.0.0`, entries will be grouped under semver version headers.

> Per-package details (SDK methods added/changed, protocol fields, etc.) live in commit messages on `main`. This file captures milestone-level changes — what a returning visitor would want to know.
>
> The `@agentagora/protocol` package keeps an independent changelog at [`packages/protocol/CHANGELOG.md`](packages/protocol/CHANGELOG.md). Per [`docs/protocol-stewardship.md`](docs/protocol-stewardship.md), that file is committed to surviving the eventual protocol-repo split — third-party SDK authors should watch it, not this one, for surface-level breaking changes.

---

## [2026-05-24] — M6 AAP v0.1 public release

The protocol and the TypeScript SDK go to npm. The AAP spec sheds its `-rfc-draft` suffix and ships as a public v0.1 contract. M9 ("Self-host runtime open-sourced") is folded into M6 — under OSS-first, self-host IS the release.

### Published to npm

- [`@agentagora/protocol@0.1.0`](https://www.npmjs.com/package/@agentagora/protocol) — wire types and Zod schemas (single source of truth for protocol-level definitions)
- [`@agentagora/sdk@0.1.0`](https://www.npmjs.com/package/@agentagora/sdk) — TypeScript SDK (register agents, call other agents, audit chain verification)

Both are published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions trusted publishing — consumers can run `npm audit signatures` to verify the tarball was built by this repo's CI from a specific commit. See [`.github/workflows/publish.yml`](.github/workflows/publish.yml) for the workflow.

`@agentagora/protocol-compliance` **stays workspace-only at 0.1.0** for this release — the package needs a `tsup` build pipeline + `src/index.ts` export surface before it's safely publishable as a library. Tracked for v0.2. Third parties run it via the documented `git clone` + `pnpm --filter @agentagora/protocol-compliance test` flow, unchanged.

### Protocol freeze

- [`docs/AAP-spec.md`](docs/AAP-spec.md) — header version `v0.1-rfc-draft` → `v0.1`. Document History entry stamps the freeze; the bytes are identical to the M4 hardening pass (2026-05-07), only the draft suffix is dropped. Internal-only footer removed — the spec is now public.
- Per-package surface contract locked by `tests/api-surface.test.ts` + `tests/json-schema-lock.test.ts` (snapshot tests in `@agentagora/protocol`).
- Versioning policy after v0.1 (G.1 maintainer decision): PATCH for editorial / MINOR for backward-compatible additions / MAJOR for breaking changes. Every spec change appends a Document History row.

### Self-host

- New [`docs/self-host-guide.md`](docs/self-host-guide.md) — 12-section standalone runbook from "I have nothing" to "I have a running AAP cloud" on Cloudflare. No DM-to-the-maintainer required. Scope ceiling: Cloudflare-only per G.3.
- [`apps/cloud/api/DEPLOY.md`](apps/cloud/api/DEPLOY.md) slimmed from 319 → 108 lines and reframed as a maintainer quick-reference for code-change redeploys.
- README's Operations section leads with the self-host guide.

### Repositioning copy (M6 Phase 1)

The hosted Cloud is reframed across README, manifesto (EN+ZH), protocol-stewardship, and PRD §10 as the Apache-2.0 reference implementation, not a live SaaS. No operator runs it today; the protocol works either way.

### Maintainer decisions accepted (Group G)

- **G.1** — Semver-style spec versioning after v0.1
- **G.2** — GitHub Actions trusted publishing with `--provenance` (no long-lived npm tokens)
- **G.3** — Cloudflare-only self-host runbook scope; non-CF deploys deferred to a discussion-driven future milestone

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
- Coverage threshold gate per package (protocol 94/95/80/94, sdk 82/80/70/82, cloud-api 80/82/78/80 — post-M.18 backfill)
- Synthetic latency benchmark job (informational; promotes to required after 2 weeks of green)

### Testing

- M.18 cloud-api coverage backfill: dedicated unit tests for §M7 production fail-closed (`buildApp` rejects boot without NONCES/RATE_LIMITS KV), §M11 body-limit middleware (413 `payload_too_large` on every capped route + under-limit happy path still reaches handler), §L4 auth-before-503 on `/v1/connect/{account,onboarding}` (401 fires before the 503 existence-leak). Cloud-api lines/statements coverage 66.84% → 86.21%; floors ratcheted from 65 back to 80, above the original M3 baseline of 72.68%.

### Operations

- Latency-bench CI gate unblocked (M.12 precondition): new `apps/cloud/api/bench/server.ts` hosts `createApi()` via `@hono/node-server`, replacing the `wrangler dev` background process that never detached cleanly on GitHub runners. The `latency-bench` job is back in `.github/workflows/typescript.yml`, still `continue-on-error: true` until 14 consecutive green runs accumulate.
- M.11 PIT restore drill is now executable: `apps/cloud/api/scripts/pit-restore-drill.sh` encodes the two-phase sentinel-row roundtrip (write → wait ≥ 1 h → verify) against production D1. RUNBOOK §3.4 updated to point at it.

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
