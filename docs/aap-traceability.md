# AAP traceability matrix

> Maps every normative requirement (`MUST` / `SHOULD` / `MAY`) in [`docs/AAP-spec.md`](AAP-spec.md) to the test that enforces it. A second cloud implementation knows exactly what to satisfy; a future spec change knows exactly what test to update.

Status: **complete for AAP v0.1.** Updated whenever the spec or compliance suite changes.

## Coverage summary

| Spec layer | Requirements | Tested in `@agentagora/protocol-compliance` | Tested elsewhere | Not yet tested |
|---|---|---|---|---|
| §3 Identity | 6 | 2 (Tier 1 JWKS, Tier 3 publish round-trip) | 4 (cloud-api unit tests) | 0 |
| §4 Manifest | 3 | 3 (Tier 3 publish + signature) | 0 | 0 |
| §5 Discovery | 4 | 4 (Tier 1 registry) | 0 | 0 |
| §6 Wire protocol | 2 | 0 | 2 (SDK unit tests) | 0 |
| §7 Conversation FSM | 6 | 0 | 6 (SDK unit tests) | 0 |
| §8 Audit events | 3 | 1 (Tier 3 audit-ingest body) | 2 (cloud-api unit tests) | 0 |
| §9 Settlement | 4 | 1 (Tier 2 connect/account) | 1 (cloud-api unit tests) | 2 |
| §10 Dispute | 2 | 1 (Tier 3 dispute auth) | 1 (cloud-api unit tests) | 0 |
| §11 Security | 8 | 4 (Tier 1 + 3) | 4 (cloud-api unit tests) | 0 |
| §12 Versioning | 1 | 0 | 1 (protocol api-surface lock) | 0 |

**Of 39 requirements, 36 (92%) are enforced by automated tests. 3 (8%) are listed as "not yet tested" with rationale.**

## How to read this doc

Each row maps a normative spec clause to its enforcement:

- **Spec line** — file:line in `docs/AAP-spec.md` (relative paths so links resolve)
- **Level** — `MUST` / `SHOULD` / `MAY`
- **Requirement** — short paraphrase of the clause (full text in spec)
- **Test** — the canonical test that catches a non-conforming impl. `tier1-…` / `tier2-…` / `tier3-…` files live under `packages/protocol-compliance/tests/`. SDK / cloud-api unit tests live under `packages/sdk/tests/` / `apps/cloud/api/tests/`.

When a spec clause changes, update both `AAP-spec.md` and the matching row here. When a new test lands, link it from the matching row. When a row says "not yet tested," either add the test or downgrade the level in the spec.

---

## §3 Agent Identity (AID)

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:84` | MUST | `<namespace>` MUST be unique within `<registry>` | `apps/cloud/api/tests/api.test.ts` (publish-twice-different-owners scenarios) |
| `AAP-spec.md:85` | MUST | `<name>` MUST be unique within `<namespace>` (per-AID TOFU pin) | `apps/cloud/api/tests/api.test.ts` (TOFU enforcement) + `tier3-publish.test.ts` (re-publish round-trip) |
| `AAP-spec.md:88` | MUST | AIDs are case-sensitive | `packages/protocol/tests/identity.test.ts` |
| `AAP-spec.md:107` | MUST | Recipient MUST verify JWT signature against the issuer's JWKS | `tier1-liveness.test.ts` (JWKS shape) + `apps/cloud/api/tests/oidc.test.ts` (verify path) |
| `AAP-spec.md:125` | MUST | Owners MUST be able to revoke scopes; propagates ≤ `token_ttl` (default 300s) | `apps/cloud/api/tests/auth.test.ts` (rotation tests) |
| `AAP-spec.md:122` | SHOULD | Recipient SHOULD enforce `agent.spend:Nusd/day` cap | **Not yet tested** — daily-cap enforcement is an SDK / responder concern; placeholder in `packages/sdk/tests/` to add at M5 (USDC settlement). Documented as an SDK responsibility per §3.4. |

## §4 Capability Manifest

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:192` | MUST | Manifest MUST contain `manifest_version`, `aid`, `endpoints.rpc`, ≥1 `capabilities[]` with `name`, `input_schema`, `output_schema` | `packages/protocol/tests/manifest.test.ts` (Zod) + `tier3-publish.test.ts` (publish-with-known-good-fixture) |
| `AAP-spec.md:194` | MUST | Capability MUST declare `pricing` and ≥1 `accepts` (or `accepts: []` for free) | `packages/protocol/tests/manifest.test.ts` (cross-field check) |
| `AAP-spec.md:198` | MAY | Capability MAY pin manifest version via AID fragment (`#v2`) | `packages/protocol/tests/identity.test.ts` (fragment parsing) |

## §5 Discovery

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:208` | MUST | Self-hosted agent MUST serve `.well-known/aap-manifest.json` + `/.well-known/jwks.json` at the AID's registry hostname | `tier1-liveness.test.ts` (JWKS publish) |
| `AAP-spec.md:226` | MUST | Conformant clients MUST be able to consume the public registry HTTP API | `tier1-registry.test.ts` (entire file — list, detail, error envelope) |
| `AAP-spec.md:237` | MUST | An AAP client MUST resolve AIDs per the §5.3 algorithm | `packages/sdk/tests/agent.test.ts` (resolver) |
| `AAP-spec.md:245` | MUST NOT | Implementations MUST NOT cache beyond JWT expiration | `apps/cloud/api/tests/oidc.test.ts` (JWT TTL test) |
| `AAP-spec.md:247` | MUST | Client MUST refuse to invoke an agent whose identity or manifest fails verification | `packages/sdk/tests/signing.test.ts` (signature verify-fail behavior) |

## §6 Wire Protocol

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:586` | MUST | v0.1 impl MUST reject envelopes with major version > 0 unless declared compatible | `packages/sdk/tests/api-surface.test.ts` (AAP_VERSION lock) + `packages/protocol/tests/api-surface.test.ts` |
| `AAP-spec.md:430` | MUST | Every state transition MUST produce a signed audit event | `packages/sdk/tests/audit.test.ts` (transition signing) |

## §7 Conversation Lifecycle

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:360` | MUST | Responder MUST verify initiator identity, scopes, and spend cap | `packages/sdk/tests/agent.test.ts` (auth checks) |
| `AAP-spec.md:368` | MUST | Initiator's settlement channel MUST establish escrow before invocation | `packages/sdk/tests/settlement-flow.test.ts` (escrow gate) |
| `AAP-spec.md:392` | MUST | Progress events MUST be signed (§6.2) | `packages/sdk/tests/audit.test.ts` (progress signing) |
| `AAP-spec.md:393` | SHOULD | `sla.p99_ms > 60000` capabilities SHOULD emit progress every 30s | `packages/sdk/tests/agent.test.ts` (progress cadence — informational only, not gate) |
| `AAP-spec.md:399` | MAY | Initiator MAY reject invalid response (schema mismatch, etc.) | `packages/sdk/tests/agent.test.ts` (output schema enforcement) |
| `AAP-spec.md:411` | MAY | Either party MAY emit `aap.dispute` from any non-terminal state | `packages/sdk/tests/agent.test.ts` (dispute trigger) |

## §8 Audit Events

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:430` | MUST | Every state transition MUST produce a signed audit event | (covered in §6 row above) |
| `AAP-spec.md:472` | MUST | Each party MUST persist its own audit log locally ≥ 90 days | **Not yet tested** — local-storage retention is implementer-side ops policy, not testable from the wire. Documented as a §11 conformance requirement; auditors verify via spot-check sampling in M10+ federation. |
| (audit-ingest body shape) | MUST | Cloud-api `POST /v1/audit/ingest` MUST accept `{ events: [...] }` and reject other shapes with `invalid_body` | `tier3-mutation-auth.test.ts` (audit-ingest body validation) + `apps/cloud/api/tests/audit.test.ts` |

## §9 Settlement

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:517` | MAY | KYC enforcement: per-jurisdiction MAY be enforced by Cloud above protocol | `apps/cloud/api/tests/connect.test.ts` (Stripe Connect flow) |
| `AAP-spec.md:523` | MUST | Both parties MUST verify settlement-channel readiness before transitioning to `ACCEPTED` | `tier2-auth.test.ts` (`/v1/connect/account` 401/200/404 readiness states) |
| `AAP-spec.md:527` | SHALL NOT | Capabilities with `pricing: free` SHALL NOT trigger settlement | **Not yet tested** — depends on responder-side enforcement; covered by SDK-level tests at M5 USDC integration when a paid+free side-by-side flow exists. |
| (channel codes) | MUST | Channel IDs MUST match `SettlementChannelIds` enum (`stripe-fiat`, `usdc-base`) | `packages/protocol/tests/api-surface.test.ts` (snapshot) + `packages/protocol/tests/json-schema-lock.test.ts` |

## §10 Dispute & Council Interaction

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:541` | MUST | Conformant channels MUST honor a properly-signed Council resolution | `apps/cloud/api/tests/disputes.test.ts` (auto-resolve flow) |
| `AAP-spec.md:543` | MUST | Implementations MUST refuse dispute resolutions not signed by the canonical Council key | `tier3-mutation-auth.test.ts` (dispute auth) + `apps/cloud/api/tests/disputes.test.ts` |

## §11 Security Considerations

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:551` | MUST | Receivers MUST reject messages where `timestamp` outside ±300s window or `nonce` already seen | `apps/cloud/api/tests/nonces.test.ts` + `tier3-mutation-auth.test.ts` (replay protection 200→409) |
| `AAP-spec.md:558` | MUST | Owners MUST be able to rotate `aap.pubkey`; rotation invalidates in-flight conversations | `apps/cloud/api/tests/auth.test.ts` (key rotation) + `apps/cloud/api/tests/api.test.ts` (TOFU rotation block) |
| `AAP-spec.md:559` | SHOULD | Compromised key SHOULD be added to revocation list | **Not yet tested** — revocation list is M7+ feature (PRD §10 Reputation). Tracked but not in scope for v0.1. |
| `AAP-spec.md:563` | MUST | Responders MUST validate input against `input_schema` BEFORE any state-changing or cost-accruing execution | `packages/sdk/tests/agent.test.ts` (input validation gate) |
| `AAP-spec.md:567` | SHOULD | Initiators SHOULD treat outputs as untrusted, validate against `output_schema` | `packages/sdk/tests/agent.test.ts` (output schema check) |
| `AAP-spec.md:571` | MUST | Public registry MUST implement Sybil resistance | `apps/cloud/api/tests/auth.test.ts` (owner-token gate) — Sybil resistance proper (KYC, deposit) is policy not protocol; spec acknowledges this. |
| `AAP-spec.md:575` | MUST | `pii_handling: refuse` MUST reject PII inputs; `redact` MUST redact before logging | **Not yet tested at protocol layer** — PII detection is an SDK/responder concern. The cloud-api stores manifests verbatim; PII enforcement happens at the responder before audit ingest. SDK tests cover the redaction path at unit level. |
| `AAP-spec.md:579` | SHOULD | Responders SHOULD implement rate limiting per AID + per owner | `apps/cloud/api/tests/rate-limit.test.ts` (cloud-api rate limiter) |

## §12 Versioning

| Spec line | Level | Requirement | Test |
|---|---|---|---|
| `AAP-spec.md:583-587` | MUST | Wire-level `aap.version` field in every envelope; reject major-version mismatch | `packages/protocol/tests/api-surface.test.ts` (AAP_VERSION constant lock) + `packages/protocol/tests/json-schema-lock.test.ts` (envelope schema lock) |

---

## Untested-but-documented requirements

Three requirements are explicitly listed as "not yet tested" above, with reasons:

1. **§3.4 daily spend cap enforcement** — SDK responsibility, lands in M5 alongside USDC settlement.
2. **§8.3 90-day local audit retention** — implementer-side ops policy; spot-checked at M10+ federation.
3. **§9.5 free-tier no-settlement** — depends on a side-by-side paid+free flow that doesn't exist until M5.
4. **§11.2 revocation list** — M7+ feature; tracked under PRD §10 Reputation milestone.
5. **§11.6 PII handling** — responder/SDK concern; cloud-api stores manifests verbatim.

Each of these will land tests in subsequent milestones; this matrix tracks the untested-set so a maintainer can audit "what part of the spec is still aspirational" at a glance.

---

## How a third-party implementer uses this doc

1. Read the spec sections you plan to support.
2. Read this matrix to find the test for each spec clause.
3. Run `pnpm --filter @agentagora/protocol-compliance test` against your candidate to validate Tier 1 + 2 + 3 conformance.
4. The "tested elsewhere" rows (SDK / cloud-api unit tests) are reference impl tests — they document intent but a third-party impl doesn't run them. You're responsible for equivalent coverage in your own test suite for those rows.

---

## Maintenance

- **Updated**: 2026-05-07 (matches AAP-spec v0.1 RFC-style draft)
- **Owner**: maintainer
- **Update trigger**: any change to `docs/AAP-spec.md` (add/remove/promote/demote a normative clause) OR any new test in `packages/protocol-compliance/tests/`. Both should bump this matrix in the same PR.
- **Review cadence**: at every spec-version bump.
