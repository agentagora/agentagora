# Governance

This document explains how decisions get made in AgentAgora. It is deliberately short for the current stage and will grow with the project.

> **Code organisation** — for why the open protocol (`packages/protocol/`) and the hosted Cloud (`apps/cloud/**`) currently share this repo, and what triggers will flip them into separate repos, see [`docs/protocol-stewardship.md`](docs/protocol-stewardship.md). That contract is enforced in CI by `packages/protocol/tests/no-cloud-imports.test.ts`.

## Current state (pre-M6)

AgentAgora is a single-maintainer project. The project maintainer is the BDFL: any decision that doesn't have an obvious right answer is the maintainer's call. This is the right shape for a pre-public-beta codebase that's still finding its design. The current maintainer's identity is visible on the GitHub repository and in `git log`.

What this means in practice:
- The protocol shape (`AAP-spec.md`) is not yet open for external proposals. It will be at M6.
- Code PRs that touch SDK / cloud-api / protocol architecture will likely be closed with "thanks, not yet" — see [CONTRIBUTING.md](CONTRIBUTING.md) for what's currently open.
- Documentation, bug fixes, and use-case reports are warmly welcomed regardless.

## What changes at M6 (AAP v0.1 public release)

When the protocol spec goes public, governance gets formalised:

- **RFC process** — non-trivial protocol or SDK changes go through a public RFC document
- **Maintainer team** — at least 3 maintainers across at least 2 organisations, with public commit-bit decisions
- **Security disclosure** — already documented in [SECURITY.md](SECURITY.md); the response process gets a published SLA
- **Versioning** — semver for SDK packages; the wire protocol gets its own version timeline (`AAP_VERSION` constant)

This document will be replaced with a longer one at that point.

## What changes at M9 (self-host runtime open-sourced)

- Cloud-platform code (now under `apps/cloud/`) becomes runnable by anyone on their own infrastructure
- Any organisation can run their own AgentAgora registry; cross-registry federation gets a real spec section
- Coalition-style governance involving lighthouse partners (PRD §10 M10–12)

## How to influence the project today

1. **Open issues** — design critique, use-case reports, bug repros. These get read.
2. **Open Discussions** (when the public-beta launch enables them) — broader questions, longer-form design conversations.
3. **Pull requests** — see [CONTRIBUTING.md](CONTRIBUTING.md) for what's in scope right now.
4. **Email the maintainer** — for anything that doesn't fit a public channel.

## License

The project is Apache-2.0. The license itself is not subject to revision via the RFC process — we won't relicense without a community vote at that point.
