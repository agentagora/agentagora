# Changelog — `@agentagora/protocol`

All notable changes to the AgentAgora Protocol reference TypeScript implementation are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file is **independent of the repo-level `../../CHANGELOG.md`**: the protocol package is committed to being lifted out of this monorepo cleanly when one of the triggers in [`docs/protocol-stewardship.md`](../../docs/protocol-stewardship.md) fires, and at that point this file becomes the protocol repo's root changelog without modification.

The wire-protocol version (`AAP_VERSION` in `src/constants.ts`) and the package's npm `version` track the same number while we are pre-1.0; once we ship AAP v1.0 they may diverge — entries here are tagged with the relevant `AAP_VERSION` to make that future split unambiguous.

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
