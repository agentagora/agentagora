# M6 plan — AAP v0.1 public release (OSS-first scope)

> Per [PRD §10](PRD.md): **M6 = "AAP v0.1 public release. Spec public, SDK packages open-sourced, first partner integrations."** This document plans how we get there.
>
> **Scope reshape (2026-05-21):** the maintainer is shipping AgentAgora as an open framework first, deferring operation of a hosted AgentAgora Cloud as a real service. PRD's "first partner integrations" line presupposes a live operator who can onboard partners — that's not the M6 we're shipping. The M6 we ARE shipping is the one that lets a stranger ([1] read the spec, [2] install the SDK from npm, [3] either point at someone else's deploy or self-host the reference impl, [4] verify "I implemented this correctly" against the compliance suite) without ever talking to us. M9 ("Self-host runtime open-sourced") is pulled forward into this milestone because under OSS-first, self-host IS the release.

Status: **engaged 2026-05-21**, after M4 spec-hardening + M.18 coverage-backfill closed.

---

## What "AAP v0.1 public release" actually means under OSS-first

The repo is already public (M3 flipped it). The reference implementation (`apps/cloud/api/`) is already public. The spec already lives in `docs/AAP-spec.md` at version `v0.1-rfc-draft`. The compliance suite (`packages/protocol-compliance/`) already runs all three tiers green. So "public release" is not "make code public" — that already happened.

What's missing is **referenceability**: today a third party can read the code, but they can't:

1. **Cite a frozen spec version.** The current spec header is `v0.1-rfc-draft` — by convention, `-rfc-draft` means "expect breaking changes". Implementers wait for the draft suffix to drop before sinking effort into compliance.
2. **`npm install` the SDK / protocol / compliance packages.** Today every consumer must clone the monorepo. The published `@agentagora/protocol`, `@agentagora/sdk`, and `@agentagora/protocol-compliance` versions don't exist on the npm registry.
3. **Stand up a self-hosted AAP cloud without reading the maintainer's mind.** `docs/local-dev.md` covers the dev-loop case (everything on localhost). A team that wants to actually deploy the reference impl on their own infra needs an end-to-end runbook that doesn't assume access to the maintainer's notes.
4. **Trust the framing.** Today's README + manifesto + protocol-stewardship docs read as "the hosted Cloud is a thing you'll be able to sign up for." Under OSS-first that's misleading copy. The same docs need to honestly say "the hosted Cloud is the reference operator's deploy; today the reference operator is nobody."

M6 closes those four gaps. Each is independently shippable.

## What this plan does NOT cover

- USDC on Base custodial settlement (M5's hosted half) — deferred under OSS-first.
- Python SDK promotion to maintained 1st-party (M5's OSS half) — still on the roadmap but doesn't gate M6; can ship alongside or after.
- Reputation / leaderboard (M7) — operator-side feature, no operator yet.
- Enterprise tier (M8) — same.
- "First partner integrations" line from PRD M6 — explicitly struck. Re-engages when someone else stands up a deploy worth integrating with, or when the maintainer signals scope changed.

## Phase plan

Three phases. Each ships independently — the maintainer can interrupt the sequence at any phase boundary without rework. Total wall-clock estimate: 2 weeks of work spread over 4–6 calendar weeks.

### Phase 1 — Repositioning copy + docs honesty pass

**Code**: none.

**Docs**:
- `README.md` — soften "**AgentAgora Cloud** — the well-run hosted default" present-tense framing. Reframe as "the reference operator's deploy, currently nobody — anyone can run it." Keep the architecture diagram (protocol vs. operator distinction is the right idea); only the operator-tense changes.
- `docs/manifesto.md` (+ `manifesto.zh-CN.md`) — same audit. "AgentAgora Cloud is the well-run default" → "the reference impl is the well-run default _for whoever runs it_."
- `docs/protocol-stewardship.md` — the §"How that's enforced today" framing is correct; the §"Why monorepo today" reasons still apply. No structural change. One-line addendum: "Note: as of 2026-05-21 the hosted Cloud is not operated. The monorepo argument is about code organisation, not operator status."
- `docs/PRD.md §10` — append a footnote to the M6 row striking the "first partner integrations" clause and pointing at this plan for the OSS-first reframe. Don't rewrite the table — the original PRD is preserved as a historical artifact; this plan documents the deviation.

**Acceptance**: a stranger reading the repo's front-door files (README + manifesto + first paragraph of PRD) walks away knowing that the protocol is open, the reference impl is runnable, and no hosted service exists today. Nobody clicks "sign up" expecting a SaaS.

**Time**: 2–3 hours. The copy edits are surgical.

### Phase 2 — Self-host runbook + M9 pulled forward

The reference impl already runs on Cloudflare Workers. What's missing is a single document that walks an external operator from "I have nothing" to "I have a running AAP cloud" without DM-ing the maintainer.

**Docs**:
- `docs/self-host-guide.md` (new) — end-to-end runbook covering:
  - Cloudflare account + Workers + D1 + KV provisioning (`wrangler login` + `wrangler d1 create` + `wrangler kv namespace create`)
  - Generating an OIDC signing key (Ed25519, base64url, stored as a Worker secret)
  - GitHub OAuth app registration (so the dashboard's sign-in flow works)
  - Stripe Connect test-mode wiring (optional — without it, `/v1/connect/*` returns 503, which is a valid configuration)
  - Setting `OWNER_TOKENS`, `DASHBOARD_COOKIE_SECRET`, `AAP_ENV=production`
  - First `wrangler deploy`, post-deploy smoke (`apps/cloud/api/scripts/smoke.ts`)
  - Pointing the dashboard + marketing site at the new cloud-api origin
- `docs/local-dev.md` — keep as-is (it's the dev-loop doc, complementary to self-host).
- One-line PRD §10 footnote moving M9 ("Self-host runtime open-sourced") into M6 scope, since the criterion ("any team can run the full stack on their own infrastructure") is what the runbook delivers.

**Acceptance**: a fresh maintainer of an unrelated GitHub org can follow `docs/self-host-guide.md` end-to-end and end up with a working AAP cloud, without reading any other doc in the repo. The compliance suite, pointed at their deploy URL, runs all three tiers green.

**Time**: 4–6 hours. Most of the time is testing the runbook against a fresh CF account to catch implicit assumptions.

### Phase 3 — npm publish + AAP v0.1 freeze

The actual "public release" act. Three packages go to npm, the spec sheds its `-rfc-draft` suffix, the repo gets a tag.

**Code**:
- `packages/protocol/package.json` — version `0.0.1` → `0.1.0`. Verify `publishConfig.access: "public"`. Add `repository`, `homepage`, `bugs` fields if missing.
- `packages/sdk/package.json` — same shape: `0.0.1` → `0.1.0`, public, repo/homepage/bugs.
- `packages/protocol-compliance/package.json` — same. Currently workspace-only; flip to publishable.
- `.github/workflows/publish.yml` (new) — manual `workflow_dispatch` job that runs `pnpm publish --filter <name> --access public --no-git-checks` for each package. Trusted publishing via npm provenance (`--provenance`) so consumers can verify the npm tarball was built by this repo's GitHub Actions, not by some compromised laptop. See [npm docs on trusted publishing](https://docs.npmjs.com/generating-provenance-statements).

**Docs**:
- `docs/AAP-spec.md` — header version bump `v0.1-rfc-draft` → `v0.1`. Document History entry: "v0.1 (2026-MM-DD): froze the rfc-draft. No protocol-surface changes since the M4 hardening pass — this is the same bytes, just stamped." No `-rfc-draft` line removal anywhere else in the doc; the matrix in `aap-traceability.md` already references the un-suffixed `v0.1`.
- `packages/protocol/CHANGELOG.md` — entry "## 0.1.0 — AAP v0.1 frozen", lists the M4-pass that produced this surface.
- Repo `CHANGELOG.md` — new section "## [M6] — AAP v0.1 public release", lists the three npm packages + spec freeze + self-host runbook.
- `git tag aap-v0.1` — annotated tag on the commit that ships the version bump. Tag message references this plan + the traceability matrix.

**Acceptance**:
- `npm view @agentagora/protocol versions` shows `0.1.0`.
- `npm view @agentagora/sdk versions` shows `0.1.0`.
- `npm view @agentagora/protocol-compliance versions` shows `0.1.0`.
- A fresh `npm install @agentagora/sdk` in an empty Node project resolves cleanly and the `import { createAgent } from "@agentagora/sdk"` example from the README compiles + runs.
- The spec at `docs/AAP-spec.md` says `v0.1` (no suffix).
- A git tag `aap-v0.1` exists and is pushed.

**Time**: 3–4 hours. The npm trusted-publishing workflow setup is the slowest part; everything else is mechanical version bumps.

### Phase 4 — (optional, maintainer-driven) announcement

Out of plan scope. Listed for completeness: whatever channels (Show HN, X, dev.to, mailing list) the maintainer wants to use to actually publicise the release. Phases 1–3 produce the artifacts; Phase 4 is communication, which is a maintainer judgment call about timing and audience.

## Maintainer decisions (Group G — pending)

Three decisions gate Phase 2 / Phase 3. They're tracked in [`docs/maintainer-tasks.md` Group G](maintainer-tasks.md#group-g--m6-public-release-decisions) for the same reason M4's Group F was: the implementation work is mechanical once the decisions land, and decisions are sticky.

| # | Decision needed | Why it gates | Recommendation |
|---|---|---|---|
| G.1 | Spec versioning policy after v0.1 | Phase 3 freezes v0.1; we need a stated rule for what v0.1.1 vs v0.2 vs v1.0 mean before the first post-release change lands | **semver-style**: PATCH for editorial fixes, MINOR for backward-compatible additions, MAJOR for breaking. Stamp every spec change with a Document History entry. |
| G.2 | npm publish mechanics | Phase 3 needs a workflow; "maintainer laptop publish" is fast but loses the provenance attestation, "GitHub Actions trusted publishing" is slower to set up but is the only path consumers can verify | **trusted publishing via Actions** with `--provenance`. Three-line workflow per package, one-time npm token setup. Once configured every release tag fires the workflow automatically. |
| G.3 | Self-host runbook scope ceiling | Phase 2 can scope-creep into "every cloud, every database, every auth provider"; we need a hard ceiling | **Cloudflare-only for M6.** The reference impl is Workers + D1 + KV; supporting non-Cloudflare deploys is a separate, larger piece of work (likely M10+ if anyone asks). Document the limitation explicitly. |

The maintainer can accept all three recommendations and proceed, or override individually. Recommendations are conservative — chosen to minimise downstream surprise rather than to be opinionated.

## Cross-references

- [PRD §10](PRD.md) — milestone roadmap (note: M6 row references "first partner integrations" which is deferred per this plan)
- [m4-plan.md](m4-plan.md) — predecessor, sets the format this plan follows
- [AAP spec](AAP-spec.md) — the document being frozen
- [aap-traceability.md](aap-traceability.md) — the matrix that proves the spec is testable
- [protocol-stewardship.md](protocol-stewardship.md) — code-organisation rules (orthogonal to going live; still apply)
- [maintainer-tasks.md Group G](maintainer-tasks.md#group-g--m6-public-release-decisions) — the three M6 decisions (added alongside this file)
