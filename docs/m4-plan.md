# M4 plan — spec hardening + compliance test suite

> Per [PRD §10](PRD.md): **M4 = "Spec hardening". Internal protocol promoted to RFC-style draft (still private).** This document plans how we get there. M5 (USDC on Base + Python SDK) and M6 (AAP v0.1 public release) are out of scope here — they get their own plans when we approach them.

Status: **engaged 2026-05-06**, after M3 engine work + hardening pack landed.

---

## What "spec hardening" actually means

Today's `docs/AAP-spec.md` is a working draft. It's good enough to drive the M3 implementation but not good enough to hand to a third-party SDK author. M4 closes that gap by making the spec into a **document a stranger could implement against without asking us questions**.

Concretely, the spec gets four passes:

1. **Normative language pass.** Every assertion gets explicit `MUST` / `SHOULD` / `MAY` per [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119). No "we should probably" hedges. Every requirement is testable.
2. **Ambiguity pass.** Every line a future implementer would have to ask about gets either a definite answer or an explicit "implementation choice" marker.
3. **Conformance traceability.** Every requirement gets a pointer to the test that enforces it. If a requirement has no test, either write the test or downgrade the requirement to `MAY`.
4. **Errors-as-first-class.** Today's §6.4 lists 9 AAP wire codes; the cloud-api uses 22 HTTP error codes. The spec needs to reconcile what's protocol-level vs implementation-detail.

Done by code, awaiting maintainer decisions: passes 1 + 3 are mostly mechanical; passes 2 + 4 contain decisions the maintainer needs to make (see §"Maintainer decisions").

## What "compliance test suite" means

Today's protocol enforcement is implicit — buried in the cloud-api's 200+ tests. A second cloud implementation (self-host runtime, third-party registry, vertical fork) has no way to verify "I'm AgentAgora-compatible" without reading our source.

The compliance test suite makes that verifiable: a runnable artifact a second implementation can point at their own deploy URL, that emits a green/red report saying which spec requirements they pass.

```
$ AAP_BASE_URL=https://my-cloud.example/ pnpm --filter @agentagora/protocol-compliance test
✓ Liveness · MUST respond to GET /healthz with 200
✓ Liveness · MUST publish JWKS at /.well-known/jwks.json
✓ Registry · GET /v1/agents/:aid MUST return 404 with `not_found` envelope on missing AID
✗ Errors · MUST return `unauthorized` envelope on missing bearer (got `auth_error`)
…
```

This is the artifact PRD §10 M9 ("Self-host runtime open-sourced") implicitly assumes exists. We build it now (M4) so the protocol surface is locked down by tests, not by tribal knowledge, before M5 + M6 widen the audience.

## Phase plan

Three phases, roughly two weeks of work each. Each phase ships independently — the maintainer can interrupt the sequence to handle M3 launch ops without losing progress.

### Phase 1 — Compliance scaffold + Tier 1 tests (THIS COMMIT)

**Code**:
- New workspace package `packages/protocol-compliance/`
- Vitest test runner, points at `AAP_BASE_URL` env var (default `http://localhost:8787`)
- Tier 1 tests covering the read-path public surface — no auth required, no destructive ops
  - Liveness: `GET /healthz`, `GET /.well-known/jwks.json`
  - Registry contract: `GET /v1/agents` shape, `GET /v1/agents/:aid` 200/404
  - Error envelope shape on intentional bad requests
- README documenting how to run

**Docs**:
- This file
- `packages/protocol-compliance/README.md`
- New §F in `docs/maintainer-tasks.md` for M4 decisions

**Scope discipline**: Tier 1 is intentionally small — scaffolds the runner shape and proves the pattern. Real coverage is Phase 2.

### Phase 2 — Tier 2 + Tier 3 tests (later session)

**Tier 2** — Authenticated read paths (require a test bearer):
- `GET /v1/agents?owner=X` ownership scoping
- `GET /v1/conversations/:id` audit chain integrity
- `GET /v1/disputes?filer=X` auth boundaries
- `GET /v1/connect/account` Stripe-attached account state

**Tier 3** — Mutation paths (sandbox-only; require setup):
- `POST /v1/agents` manifest publish + Ed25519 verify + JCS canonicalisation
- `POST /v1/audit/ingest` chain integrity (broken_chain detection)
- `POST /v1/disputes` filer/respondent authz
- `POST /v1/nonces/check` replay-protection semantics

Tier 3 needs a "test fixtures" setup: a known keypair, a published manifest, a reset-between-runs storage seed. We design this in Phase 2 — likely a CLI (`pnpm protocol-compliance --setup`) that provisions known state, then runs the suite.

### Phase 3 — Spec hardening pass (later session)

After Phases 1 + 2 codify the protocol surface into runnable tests, the spec doc itself gets the four-pass treatment from §"What spec hardening means" above. Each `MUST` / `SHOULD` in the spec gets a footnote pointing at the compliance test that enforces it. Anything without a test either gets a test or gets demoted from `MUST` to `MAY`.

Output of Phase 3 is the version of `AAP-spec.md` that's a candidate for the M6 public release. It stays in `docs/` (private) until M6.

## Maintainer decisions (Group F in `docs/maintainer-tasks.md`)

Manual items — these don't unblock Phase 1, but Phase 2 / 3 hit decision points the maintainer has to make:

- **F.1** Decide RFC-style structure (IETF / W3C / homegrown) for the Phase 3 spec rewrite.
- **F.2** Decide what counts as the "AgentAgora-compatible" badge level: Tier-1-only, Tier-1+2, or all three.
- **F.3** Decide Phase 2's Tier 3 fixture-setup approach: CLI-provisioned, declarative seed file, or per-test setup hooks.
- **F.4** Decide M6 public-release scope (just the spec, or the spec + compliance suite + reference impl all together).
- **F.5** After Phase 3, decide whether to re-license the spec doc separately from the codebase (e.g., spec under CC-BY for "all implementations free", code stays Apache-2.0).

## What this plan does NOT cover

- USDC on Base settlement (M5)
- Python SDK promotion to maintained release (M5)
- AAP v0.1 public release announcement (M6)
- Self-host runtime open-source release (M9)
- Reputation / leaderboard (M7)
- Enterprise tier (M8)

Each of those gets its own plan doc when we engage that milestone. M4 is just the spec-hardening predecessor that has to land before any of them.

## Cross-references

- [PRD §10](PRD.md) — milestone roadmap
- [AAP spec](AAP-spec.md) — the document being hardened
- [maintainer-tasks.md §F](maintainer-tasks.md) — manual decisions for M4
- [protocol-stewardship.md](protocol-stewardship.md) — how M4 + M5 progression interacts with the eventual protocol-repo split
