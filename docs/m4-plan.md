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

### Phase 2 — Tier 2 + Tier 3 tests

Split into two sub-phases so they ship independently:

**Phase 2a — Tier 2 (authenticated read paths)**

Bearer-required reads, no destructive ops. The suite skips these tests when `AAP_TEST_BEARER` is unset (same opt-in pattern Tier 1 has for `AAP_BASE_URL`). Routes covered:

- `GET /v1/agents?owner=<id>` — owner scoping; bearer's resolved owner must match
- `GET /v1/conversations?actor=<aid>` — bearer must own the AID
- `GET /v1/disputes?filer=<aid>` and `?respondent=<aid>` — auth boundaries
- `GET /v1/connect/account` — bearer's Stripe Connect state

For each: 401 on missing bearer, 401 on invalid bearer, 200 + correctly-scoped data on valid bearer, 403 on cross-owner queries (where applicable).

**Phase 2b — Tier 3 (mutation paths)**

Sandbox-only writes. Per F.3 decision:

- **Primary**: CLI provisioner. `packages/protocol-compliance/src/cli.ts` exposes `pnpm protocol-compliance --setup --base-url=…` which:
  1. Generates a known Ed25519 keypair
  2. Publishes a fresh manifest via the candidate's `POST /v1/agents`
  3. Seeds a conversation via `POST /v1/audit/ingest`
  4. Persists fixture identifiers to a temp file the test runner reads
- **Fallback**: `--seed-file=fixtures.json` accepts pre-provisioned fixtures from impls that don't support full publish flow yet — those impls run only Tier 1 + 2 toward the badge.

Tier 3 routes covered:
- `POST /v1/agents` manifest publish + Ed25519 verify + JCS canonicalisation
- `POST /v1/audit/ingest` chain integrity (broken_chain detection)
- `POST /v1/disputes` filer/respondent authz
- `POST /v1/nonces/check` replay-protection semantics

### Phase 3 — Spec hardening pass (later session)

After Phases 1 + 2 codify the protocol surface into runnable tests, the spec doc itself gets the four-pass treatment from §"What spec hardening means" above. Each `MUST` / `SHOULD` in the spec gets a footnote pointing at the compliance test that enforces it. Anything without a test either gets a test or gets demoted from `MUST` to `MAY`.

Output of Phase 3 is the version of `AAP-spec.md` that's a candidate for the M6 public release. It stays in `docs/` (private) until M6.

## Maintainer decisions (Group F — closed 2026-05-07)

All five M4 decisions are settled. F.1-F.4 went with the recommendations; F.5 was overridden to Apache-2.0 (single-license simplicity). Full rationale in [`docs/maintainer-tasks.md` §F](maintainer-tasks.md#group-f--m4-spec-hardening-decisions).

| # | Decision | Notes |
|---|---|---|
| F.1 | **IETF RFC style** | Sections: Introduction, Terminology (RFC 2119), normative MUST/SHOULD/MAY, Security Considerations, IANA Considerations placeholder. Phase 3 implements. |
| F.2 | **Tier 1+2 = AgentAgora-compatible badge** | Tier 3 = "registered peer registry" (M10+). Badge wording lands in compliance suite README in Phase 2. |
| F.3 | **CLI provisioner + declarative-seed fallback** | Phase 2 builds `packages/protocol-compliance/src/cli.ts`. `--setup --base-url=…` provisions; `--seed-file=fixtures.json` bypasses for impls that don't yet support publish. |
| F.4 | **Spec + compliance suite at M6** | Reference impl is already public via M3 repo flip; M6 framing is "protocol becomes referenceable." |
| F.5 | **Apache-2.0 (single license)** | Maintainer override of CC-BY recommendation. Reduces downstream cognitive load — one license to scan, no per-file headers, identical implementation rights. |

These decisions are now baked into the Phase 2 / Phase 3 design below.

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
