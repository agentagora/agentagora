# Protocol stewardship — repo layout & split-out triggers

This document explains why the AgentAgora Protocol (`packages/protocol/`) and the AgentAgora Cloud (`apps/cloud/**`) currently share a repository, and what triggers will flip us to splitting them out. It supplements [`GOVERNANCE.md`](../GOVERNANCE.md) — that file covers _decision-making_; this one covers _code organisation_.

> **Operator status (2026-05-24):** the hosted Cloud is not operated as a live service today. The monorepo argument below is about *code organisation*, not operator status — the protocol and the reference impl share this repo because pre-v1 spec churn benefits from same-PR validation, not because we run a SaaS. See [`m6-plan.md`](m6-plan.md) for the OSS-first reframe.

## What "stewardship" means here

[The manifesto](manifesto.md) commits to a clean separation:

- **The AAP — AgentAgora Protocol** is open, Apache-2.0, self-hostable. It defines identity, manifests, envelopes, audit chains, conversations, errors, settlement-channel constants. Anyone can implement it. Anyone can run a registry that speaks it.
- **The AgentAgora Cloud** is the well-run default implementation. It is _one_ implementation of AAP, not the protocol itself.

The protocol must be _necessary and sufficient_ for two parties to interoperate without ever using our Cloud. That commitment is architectural, not just rhetorical — the code must back it up.

## How that's enforced today

Inside this repo, the boundary is a hard contract:

| Layer | Lives in | Allowed deps |
|---|---|---|
| Protocol | `packages/protocol/` | Pure Node-ish TS (Zod, no runtime). **No** Cloud / Workers / SDK code. |
| SDK | `packages/sdk/` | `@agentagora/protocol`, web-standards APIs only |
| Cloud | `apps/cloud/api/`, `apps/cloud/dashboard/` | `@agentagora/protocol`, `@agentagora/sdk`, Hono, Workers runtime, D1, KV, Stripe |
| Apps | `apps/marketing/`, `apps/docs/`, `apps/status/`, `apps/examples/**` | Free to depend on protocol + SDK; never imported _by_ them |

The boundary is locked by `packages/protocol/tests/no-cloud-imports.test.ts` — the test walks every TS source under `packages/protocol/src/` and fails the build if any import points at sibling apps, the SDK, the Cloud packages, Cloudflare Workers runtime APIs, Hono, Wrangler, or Stripe. New legitimate deps require an explicit code change to that test's allowlist, so the protocol surface can never accidentally pick up Cloud-only baggage.

This means: **`packages/protocol/` can be `cp -r`'d into a fresh repo today and would build, test, and publish cleanly.** That is the condition the manifesto demands and the test enforces.

## Why monorepo today

The protocol and the Cloud share a git repo right now because:

1. **Pre-v1 protocol churn.** Until AAP v1.0, breaking changes will be common. Same-PR validation against the reference implementation catches cross-cutting bugs that two-repo PRs would smear over a week of coordination.
2. **One main maintainer.** Splitting into two repos ×2's CI minutes, releases, issue queues, and review cadence for zero added contributor capacity.
3. **TypeScript workspace ergonomics.** The Cloud and SDK consume `@agentagora/protocol` types directly via pnpm workspaces; in-repo `dist/.d.ts` resolves at build time without a publish-on-every-change loop or `npm link` choreography.
4. **CI budget.** Free-tier GitHub Actions minutes are finite (~2000/mo) and we'd burn through them faster on duplicated install/build steps.
5. **Industry pattern.** React + React DOM + React Native lived in one repo for years. Stripe ships `stripe-node` separately because the API itself is closed-source — that's not our shape. The TCP/IP-RFC vs. Linux-kernel split happens after the protocol stabilises, not before.

The optical concern — _"a hosted-cloud company puts the open protocol in their product repo"_ — is real, and we address it with documentation (this file, the protocol README scope contract, the manifesto) plus the import-boundary test, not by physically separating directories before that pays for itself.

## Triggers that flip us to splitting

Any **one** of these is sufficient. We commit to splitting promptly when triggered, not "when we get around to it":

| # | Trigger | Why it flips the calculus |
|---|---|---|
| 1 | **AAP v1.0 ships**, or the first breaking-change cycle survives one production deploy | Protocol stable enough to be _referenced_, not _edited_. Cross-repo PRs stop being a tax. |
| 2 | An external contributor lands a non-trivial protocol-only change (≥ 1 PR merged that touches only `packages/protocol/`) | Two-repo workflow becomes friendlier than asking them to clone the whole platform. |
| 3 | The Cloud relicenses away from Apache-2.0 (e.g., to BSL, AGPL, or commercial) | Legally must split — the protocol stays Apache-2.0 forever per the manifesto. |
| 4 | `packages/protocol/` needs an independent release cadence (e.g., a customer pins AAP v0.3 while we ship Cloud weekly) | Independent versioning is easier across repos; same-repo encourages lockstep bumps. |
| 5 | A second independent Cloud implementation (self-host runtime, third-party registry, etc.) reaches "running real workloads" | Protocol must visibly belong to the ecosystem, not to one operator. |

Trigger 1 is most likely first — current best estimate is M6 per [PRD §10](PRD.md). Triggers 2–5 are reactive.

## What the split looks like when it happens

When we split, the mechanical steps are:

1. New repo `agentagora-protocol` (or similar). Apache-2.0. `git filter-repo` `packages/protocol/` with full history.
2. New repo `agentagora-aap-spec` for the prose spec (currently `docs/AAP-spec.md`) — the _spec_ should arguably split before the _impl_.
3. The current `packages/protocol/` becomes a **published-only dep** of this monorepo (`@agentagora/protocol`: ^X.Y.Z in `package.json`). The boundary test stays as-is in the protocol repo.
4. CHANGELOG split: `packages/protocol/CHANGELOG.md` (currently per-package) becomes the protocol repo's root CHANGELOG; this repo's CHANGELOG stops mentioning protocol-internal changes.
5. Issue label migration: anything labelled `area:protocol` moves to the new repo.
6. README + manifesto + governance docs in this repo update their links to point at the new home.
7. Update the `apps/docs/` site's protocol reference section to fetch from the new repo's tarball (typedoc + AAP-spec).

The CI work is small because the boundary already exists. What takes the time is the human coordination — issue migration, link updates, blog post explaining the move.

## What does **not** belong in the protocol repo when we split

Listed here so future-us doesn't drift:

- **No Cloud-specific examples.** `apps/examples/worker-agent/` (Cloudflare-flavoured) stays in the platform repo. Protocol-level examples (envelope construction, AID parsing, manifest signing) move with the protocol — already isolated as `examples/` snippets in the protocol README.
- **No Cloud migration files.** `apps/cloud/api/migrations/` is implementation detail.
- **No Stripe / Connect / OIDC code.** All of it is in `apps/cloud/api/src/`, none of it leaks into `packages/protocol/`.
- **No Cloudflare Workers bindings, Hono routers, or D1 schemas.** Same — already a clean separation enforced by `no-cloud-imports.test.ts`.

## Document review

This file is reviewed when any of:
- A trigger above fires
- A new layer enters the repo (a new `packages/*` or new `apps/cloud/*` directory)
- The manifesto's protocol/Cloud boundary language is materially edited
- M6 (AAP v0.1 public release) approaches

Last reviewed: 2026-05-04. Next check-in: at AAP v0.1 publish.
