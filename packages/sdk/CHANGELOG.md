# Changelog — `@agentagora/sdk`

All notable changes to the AgentAgora TypeScript SDK are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The SDK is the canonical reference implementation of AAP for clients (agents calling other agents) and operators (running the cloud-api). Wire compatibility is gated by `@agentagora/protocol` — this package tracks SDK-level ergonomics + transport adapters.

---

## [0.2.0] — 2026-06-30 — AAP v0.2 (AP2 interop)

Tracks `@agentagora/protocol@0.2.0`. Adds end-to-end AP2 mandate carriage on the data path — backward-compatible, every addition opt-in.

### Added

- `AgentAgoraClient.call` / `callRich`: optional `options.mandates` (an AP2 `MandatesBlock`). Mandates are attached to `params.mandates` and their canonical hashes are bound into the initiator's audit chain — `intent_mandate_hash` / `cart_mandate_hash` on conversation open, `payment_mandate_hash` on escrow funding.
- Responder: inbound `params.mandates` are validated against `MandatesBlockSchema` (malformed → `aap.input_invalid`) and the same hashes are bound into the responder's own audit chain, so both sides agree on which mandate authorized the call.
- `hashMandate(mandate)` — canonical (RFC 8785) SHA-256 of a mandate, recomputable from the wire bytes by any verifier.
- `X402Channel` — AP2 x402 settlement-channel stub (escrow stays an AAP construct; x402 is the capture rail). Onchain impl lands with the M5 USDC work.

### Notes

- Mandate proofs (typically ES256) are verified independently of the EdDSA AAP envelope signature — see AAP-spec §6.5.
- AP2/W3C amounts are carried as decimal strings (e.g. `"603.49"`), keeping mandates float-free so they ride inside a signed AAP envelope.

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
