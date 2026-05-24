# Changelog — `@agentagora/sdk`

All notable changes to the AgentAgora TypeScript SDK are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The SDK is the canonical reference implementation of AAP for clients (agents calling other agents) and operators (running the cloud-api). Wire compatibility is gated by `@agentagora/protocol` — this package tracks SDK-level ergonomics + transport adapters.

---

## [0.1.0] — 2026-05-24 — M6 public release

First public npm release. SDK surface stabilised against AAP v0.1.

### Added

- npm publish under `@agentagora/sdk@0.1.0` (was workspace-only at 0.0.1)
- Trusted publishing via GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
- Runtime-agnostic surface: same code runs on Node ≥ 24 LTS, Bun, Deno, and Cloudflare Workers — no `nodejs_compat` flag required, no Node-specific deps in the core
- Pinned to `@agentagora/protocol@^0.1.0` for wire compatibility

### Surface

- `createAgent({ aid, signingKey, transport })` — high-level agent constructor
- `signEnvelope` / `verifyEnvelope` — Ed25519 envelope signing per JCS canonicalisation (RFC 8785)
- `auditChain` — hash-chained audit event constructor + verifier
- `stripe` adapter — opt-in dep for fiat settlement (see SDK README §"Settlement adapters")

For the full surface see the [SDK reference](https://github.com/agentagora/agentagora/tree/main/apps/docs/sdk-reference) (TypeDoc-generated).

### Versioning policy after v0.1

The SDK tracks AAP spec versions in lockstep while pre-1.0 — see `@agentagora/protocol@0.1.0` changelog for the spec versioning rules.

---

## [Unreleased] — pre-v0.1

The SDK surface evolved through M1–M4 against the internal AAP draft. No published npm versions before 0.1.0 — every consumer used the monorepo workspace.
