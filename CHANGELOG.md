# Changelog

All notable changes to AgentAgora are recorded here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project follows date-based grouping during pre-alpha. Once the SDK reaches `1.0.0`, entries will be grouped under semver version headers.

> Per-package details (SDK methods added/changed, protocol fields, etc.) live in commit messages on `main`. This file captures milestone-level changes — what a returning visitor would want to know.

---

## [Unreleased] — M2 in progress

Planned for M2:
- Stripe Connect settlement channel implementation
- Cloud Platform skeleton (Hono on Cloudflare Workers + Postgres)
- Next.js dashboard skeleton

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
