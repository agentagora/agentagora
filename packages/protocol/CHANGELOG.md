# Changelog — `@agentagora/protocol`

All notable changes to the AgentAgora Protocol reference TypeScript implementation are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file is **independent of the repo-level `../../CHANGELOG.md`**: the protocol package is committed to being lifted out of this monorepo cleanly when one of the triggers in [`docs/protocol-stewardship.md`](../../docs/protocol-stewardship.md) fires, and at that point this file becomes the protocol repo's root changelog without modification.

The wire-protocol version (`AAP_VERSION` in `src/constants.ts`) and the package's npm `version` track the same number while we are pre-1.0; once we ship AAP v1.0 they may diverge — entries here are tagged with the relevant `AAP_VERSION` to make that future split unambiguous.

---

## [0.2.0] — 2026-06-30 — AAP v0.2 (AP2 interop)

Backward-compatible MINOR (`AAP_VERSION` `0.1` → `0.2`). Adds [AP2](https://ap2-protocol.org) mandate carriage so AAP interoperates with the Agent Payments Protocol ecosystem. v0.1 implementations remain conforming — every addition is optional. Full binding: [`docs/AAP-spec-ap2-binding.md`](../../docs/AAP-spec-ap2-binding.md).

### Added

- `mandate.ts` (new subpath `@agentagora/protocol/mandate`): `IntentMandateSchema`, `CartMandateSchema` (+ `CartContentsSchema`), `PaymentMandateSchema`, `MandatesBlockSchema`, `VcProofSchema`, `AmountSchema`, `DisplayItemSchema`, `PaymentRequestSchema` — shapes mirror AP2's reference types (`ap2/types/mandate.py`): `CartMandate` nests the cart body under `contents` with a nullable `merchant_authorization`; `IntentMandate.merchants`/`skus` are nullable/omissible; `AmountSchema.value` accepts decimal strings (preferred) **and** JSON numbers (AP2 reference-impl parity). Every object schema is `.passthrough()` so unmodeled AP2 fields (VC `proof`, `risk_data`, …) survive validation. Mandate proofs are verified independently of the EdDSA envelope signature.
- `SettlementChannels.X402` (`"x402"`) — AP2 onchain stablecoin rail; escrow stays an AAP construct, x402 is the capture rail.
- `Methods.Authorize` (`"aap.authorize"`) — optional method carrying a `PaymentMandate` (the reference SDK folds the mandate into `aap.invoke` params instead, which the spec permits).
- `Ap2` constants — `ExtensionUri` (the `X-A2A-Extensions` value) and `MandateKeys` (the `ap2.mandates.<Type>` data-part keys).
- `SUPPORTED_AAP_VERSIONS` (`["0.1", "0.2"]`) and `SupportedAapVersion`.

### Changed

- `AAP_VERSION` is now `"0.2"` — the **highest** version this package speaks, not an unconditional stamp. Implementations SHOULD emit the lowest version an envelope's content requires (`"0.1"` for mandate-free traffic, so unupgraded v0.1 validators — which pin the version literal — keep accepting it) and SHOULD echo the requester's version on responses. The reference SDK does both.
- `AapEnvelopeMetaSchema.version` accepts any value in `SUPPORTED_AAP_VERSIONS` (was `z.literal("0.1")`), so inbound v0.1 envelopes still validate.
- **Compat note:** a v0.1 peer only sees `"0.2"` on envelopes that actually carry v0.2 features (mandates) — which it couldn't process anyway. All other cross-version traffic validates on both sides.

## [0.1.0] — 2026-05-24 — AAP v0.1 frozen

First public npm release. AAP v0.1 spec frozen; this is the byte-for-byte surface that survived M4's RFC-style hardening pass — no protocol-surface changes since v0.1-rfc-draft (2026-05-07), just the `-rfc-draft` suffix dropped.

### Added

- npm publish under `@agentagora/protocol@0.1.0` (was workspace-only at 0.0.1)
- Trusted publishing via GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) — consumers can run `npm audit signatures` to verify the tarball was built by this repo's CI from a specific commit

### Surface

No additions, removals, or changes since v0.1-rfc-draft. The contract third-party SDKs implement is:

- **Identity** — `AidSchema`, `parseAid`, `IdentityCertificateClaimsSchema`
- **Manifest** — `ManifestSchema`, `ManifestMetadataSchema`, `CapabilitySchema`, `EndpointsSchema`, `PricingSchema`, `PricingModelSchema`, `SettlementChannelIds`
- **Envelope** — `AapEnvelopeMetaSchema` (the AAP-specific extension on JSON-RPC 2.0)
- **Audit** — `AuditEventSchema`, `AuditEventTypes`
- **Conversation** — `ConversationStatuses`, `LegalTransitions` (FSM)
- **Errors** — `ErrorCodes`, `ErrorNames`
- **Methods** — `Methods` enum (`aap.invoke`, etc.)

For tree-shaking, prefer subpath imports (`@agentagora/protocol/manifest`, `@agentagora/protocol/identity`).

### Versioning policy after v0.1

Per maintainer decision G.1 (semver-style on the spec itself):
- **PATCH** (`0.1.1`) — editorial fixes, clarifications, typo passes, traceability matrix updates. No protocol-surface change. Existing implementations need no work.
- **MINOR** (`0.2.0`) — backward-compatible additions: new optional fields, new optional capabilities, new error codes, new settlement-channel constants. Existing implementations remain conforming.
- **MAJOR** (`1.0.0`, `2.0.0`) — breaking changes: removed fields, renamed methods, semantic changes. Existing implementations must update.

The compliance suite gates which spec version a deploy claims — Tier 1+2 tests are versioned in lockstep with the spec.

---

## [Unreleased] — pre-AAP-v0.1

The protocol surface is locked by three layered tests:
- `tests/api-surface.test.ts` — snapshot of every public TypeScript export name
- `tests/no-cloud-imports.test.ts` — boundary guard (no imports from Cloud / SDK / Workers / Stripe — see [protocol stewardship](../../docs/protocol-stewardship.md))
- `tests/json-schema-lock.test.ts` — JSON-Schema rendering of every public Zod schema (Manifest, Envelope, AuditEvent, Identity, RPC arms, …). Locks the **wire shape**, not just the TypeScript types — so a Zod refactor that preserves TS but changes JSON output is caught in PR review. Snapshots live in `tests/__snapshots__/json-schema-lock.test.ts.snap`. Update via `pnpm --filter @agentagora/protocol test -u`; treat the diff as a contract change.

### Surface (the contract third-party SDKs implement)

`AAP_VERSION` is the version constant shipped on every signed envelope. `MANIFEST_VERSION` is the manifest schema generation. The public API surface is:

- **Identity** — `AidSchema`, `parseAid`, `IdentityCertificateClaimsSchema`
- **Manifest** — `ManifestSchema`, `ManifestMetadataSchema`, `CapabilitySchema`, `EndpointsSchema`, `PricingSchema`, `PricingModelSchema`, `SettlementChannelIds`
- **Envelope** — `AapEnvelopeMetaSchema` (the AAP-specific extension on JSON-RPC 2.0)
- **Audit** — `AuditEventSchema`, `AuditEventTypes`
- **Conversation** — `ConversationStatuses`, `LegalTransitions` (FSM)
- **Errors** — `ErrorCodes`, `ErrorNames`
- **Methods** — `Methods` enum (`aap.invoke`, etc.)

For tree-shaking, prefer subpath imports (`@agentagora/protocol/manifest`, `@agentagora/protocol/identity`).

### History prior to this changelog

The protocol package was written between 2026-04 and 2026-05 as part of the M2 → M3 push. Per-commit detail lives in `git log -- packages/protocol/`. Notable landmarks (commit hash → what shipped):

- `82af3ae` — bootstrap, AID + Manifest + Envelope + AuditEvent schemas
- `54498a0` — protocol-level conversation FSM + legal transitions
- `747ddaf` — replay-protection schema fields (timestamp window + nonce)
- `3299348` — surface lock test (api-surface.test.ts) added; locks the export shape against accidental drift

### Stewardship boundary

This package commits to depending on **no AgentAgora Cloud code, no Workers runtime APIs, no Hono, no Wrangler, no Stripe SDK, and not on its own consumer (`@agentagora/sdk`)**. Enforced by `tests/no-cloud-imports.test.ts`. Any new dep that wants in must update that test's allowlist as part of the same PR.

---

## Versioning policy

While `version` < `1.0.0`:

- **PATCH** — additive non-breaking surface (new exported helper, new optional schema field with default).
- **MINOR** — additive surface that other SDKs need to know about (new method name, new required field with a migration note here).
- **MAJOR bump to 1.0.0** — coincides with AAP v0.1 public release per [PRD §10 M6](../../docs/PRD.md). Triggers the protocol repo split per [`docs/protocol-stewardship.md`](../../docs/protocol-stewardship.md).

Once at `1.0.0+`:

- Strict semver on the package `version`.
- `AAP_VERSION` follows its own date-based versioning (see AAP spec) and may pin to a different number; entries below will note both.

---

> Per-commit detail lives in `git log -- packages/protocol/`. This file captures protocol-surface-meaningful changes only — the kind of entry a third-party SDK author scanning for breaking changes should see.
