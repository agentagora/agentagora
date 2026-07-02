# Changelog — `@agentagora/sdk`

All notable changes to the AgentAgora TypeScript SDK are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The SDK is the canonical reference implementation of AAP for clients (agents calling other agents) and operators (running the cloud-api). Wire compatibility is gated by `@agentagora/protocol` — this package tracks SDK-level ergonomics + transport adapters.

---

## [0.3.0] — 2026-07-02 — Cloud connectivity (the MVP loop)

No wire-protocol change (`@agentagora/protocol` stays 0.2.0). This release adds the connective tissue between a local agent and a registry/control plane, closing the "publish → discover → call → audit-in-the-dashboard" product loop that previously required mocks and hand-wired keys.

### Added

- `HttpRegistry` — the registry-backed resolver long promised by `registry.ts`. Implements **both** `RegistryResolver` and `EndpointResolver`: `GET /v1/agents/:aid`, then verifies the identity certificate (compact EdDSA JWT) against the registry's `/.well-known/jwks.json` and extracts `aap.pubkey` — trust anchors at the registry's JWKS, never a raw pubkey field. Per-AID cache with TTL + `invalidate()`. **Certificate freshness is enforced by default** (`rejectExpired: true`): the reference registry now reissues a fresh certificate on every read, so an expired cert signals a stale or non-conforming registry — pass `rejectExpired: false` only against legacy registries that still serve publish-time certs.
- `publishAgent()` — sign a manifest (detached Ed25519 over RFC 8785 canonical bytes) and `POST /v1/agents` with the `x-aap-pubkey` / `x-aap-signature` headers the server verifies. Surfaces the registry's TOFU-pin errors verbatim.
- `CloudAuditSink` — incremental push of a local `AuditLog` to `POST /v1/audit/ingest`, with a per-conversation cursor that only ever advances past server-ingested events (a partial rejection throws and the retry resumes cleanly).
- `Agent.listConversations()` — enumeration for periodic audit sync loops.
- `AgentAgoraClient.resolve(aid)` — implemented (was an M1-task stub): resolves via a lazily constructed `HttpRegistry` against `options.registry`.
- Golden-path example: `apps/examples/two-agents/src/server.ts` + `client.ts` (the files `demo:server` / `demo:client` always pointed at) — publish → discover → call (+ optional paid call via Stripe) → audit sync, against a local cloud-api per `docs/local-dev.md` §7b.
- **M7-lite feedback (reputation data layer):** `AgentAgoraClient.recordFeedback(conversationId, { score, tags?, comment? })` — signs an `aap.feedback.recorded` event into the initiator's chain (subject/capability derived from the conversation's opening event); syncs to the cloud like any other event and is served raw via `GET /v1/agents/:aid/feedback`. `buildErc8004Feedback()` — builds the ERC-8004 off-chain feedback file (keccak-256 `feedbackHash`, suggested `giveFeedback` args) with AAP audit evidence embedded (conversation id, chain head hash, mandate hashes, optional `proofOfPayment`); no chain client dependency — the caller hosts the file and submits with their own wallet tooling. See `docs/AAP-interop-positioning.md` §3.

## [0.2.0] — 2026-06-30 — AAP v0.2 (AP2 interop)

Tracks `@agentagora/protocol@0.2.0`. Adds end-to-end AP2 mandate carriage on the data path — backward-compatible, every addition opt-in.

### Added

- `AgentAgoraClient.call` / `callRich`: optional `options.mandates` (an AP2 `MandatesBlock`). Mandates are attached to `params.mandates` and **all** their canonical hashes are bound into the initiator's audit chain on conversation open (so a `PaymentMandate` without `options.pay` — escrow-less settlement — is still provable), with `payment_mandate_hash` additionally recorded on escrow funding.
- Responder: inbound `params.mandates` are validated against `MandatesBlockSchema` (malformed or uncanonicalizable → `aap.input_invalid`, never a crash) and the same hashes are bound into the responder's own audit chain.
- `hashMandate(mandate)` — SHA-256 over plain RFC 8785 canonical bytes (float-tolerant: mandates are opaque third-party payloads), always computed over the **original wire object** — never a schema-parsed copy — so both parties and any later verifier bind identical bytes even when a mandate carries fields the schemas don't model (VC `proof`, `risk_data`).
- `mandateHashes(block)` — the shared hash-key convention (`intent_mandate_hash` / `cart_mandate_hash` / `payment_mandate_hash`), exported for verifiers.
- `X402Channel` — AP2 x402 settlement-channel stub (escrow stays an AAP construct; x402 is the capture rail). Onchain impl lands with the M5 USDC work.
- Re-exports from `@agentagora/protocol`: `Ap2`, the mandate schemas + types, and `SUPPORTED_AAP_VERSIONS`, so SDK users need only one import.

### Changed

- Wire-version emission: requests are stamped with the **lowest** version their content requires (`0.1` for mandate-free calls, `0.2` with mandates), and agent responses **echo the requester's version** — unupgraded v0.1 peers keep validating all traffic that doesn't use v0.2 features.

### Notes

- Mandate proofs (typically ES256) are verified independently of the EdDSA AAP envelope signature — see AAP-spec §6.5.
- AP2/W3C amounts SHOULD be decimal strings (e.g. `"603.49"`); numeric amounts validate (AP2 reference-impl parity) and hash fine, but non-integral numbers cannot ride inside a signed AAP envelope (envelope canonicalization rejects floats by policy).

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
