# Contributing to AgentAgora

Thanks for your interest. AgentAgora is **pre-alpha** — the protocol and SDK shapes are still moving. This document explains what helps and what doesn't right now.

## What we're looking for today (most → least valuable)

1. **Honest critique of the design** — read [docs/manifesto.md](docs/manifesto.md), [docs/PRD.md](docs/PRD.md), and [docs/AAP-spec.md](docs/AAP-spec.md). Open an issue for anything that's wrong, missing, or naive. Disagreement at this stage is more valuable than agreement.
2. **Use-case reports** — if you're building agents and would use cross-org interop, tell us what you actually need. Issue or email is fine.
3. **Reproductions of bugs** — see "Reporting issues" below.
4. **Documentation fixes** — typos, broken links, unclear sentences. PRs welcome and will be reviewed quickly.

## What's not open yet

- **Significant code PRs.** Until the M3 public beta, the maintainer takes the codebase in tight increments. PRs that change the SDK API, protocol shape, or architectural decisions will likely be closed with a "thanks, we're not ready for this" — no offense intended; the goal is to keep design coherent until first users land.
- **New features.** If you have a feature idea, open an issue to discuss before writing code.

## Reporting issues

- **Bugs**: use the [bug report](.github/ISSUE_TEMPLATE/bug_report.yml) template.
- **Design questions / spec critique**: use the [design question](.github/ISSUE_TEMPLATE/design_question.yml) template.
- **Security vulnerabilities**: see [SECURITY.md](SECURITY.md) — do **not** open a public issue.

## Local development

If you want to build and run the project locally:

```bash
pnpm install
pnpm --filter "@agentagora/sdk" build
pnpm test                    # all tests
pnpm typecheck               # all packages
pnpm lint                    # biome (run pnpm lint:fix to auto-fix)
```

Run the demos to see things working end-to-end:

```bash
# Two agents talking over real HTTP, single process
pnpm --filter "@agentagora/example-two-agents" demo

# The same SDK, deployed as a Cloudflare Worker
pnpm --filter "@agentagora/example-worker-agent" check   # dry-run build
pnpm --filter "@agentagora/example-worker-agent" dev     # local on :8787
```

### Engine versions

- **Node**: 24 LTS or newer
- **pnpm**: 10 or newer
- **TypeScript**: 5.9 (workspace-pinned; do not update without coordination)

### Git hooks

`pnpm install` auto-installs lefthook git hooks. They enforce:

- **pre-commit** (~1 s): Biome lint + auto-format on staged files only.
- **pre-push** (~10–15 s): full `pnpm lint`, `pnpm typecheck`, `pnpm test`.

Skip a single commit's hooks with `git commit --no-verify` — but every skip is one less guarantee that `main` is green; treat it as exceptional.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/), broadly:

```
feat(sdk):        new SDK feature
fix(sdk):         SDK bug fix
docs:             documentation only
chore:            tooling, deps
ci:               GitHub Actions / build pipeline
refactor:         no behavior change
test:             tests only
```

Scope (`sdk`, `protocol`, `examples`, etc.) is encouraged but not required.

## Code style

- TypeScript strict + `noUncheckedIndexedAccess`
- Web-standard APIs only in SDK code (must run on Cloudflare Workers — see [docs/tech-stack.md §8](docs/tech-stack.md))
- Pure ESM, no CommonJS
- Biome for lint+format (run `pnpm lint:fix` before committing)

## Code of Conduct

By participating in any AgentAgora space (issues, discussions, PRs), you agree to follow our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## License

Contributions are licensed under [Apache-2.0](LICENSE). By submitting a PR you agree that your contribution is your original work and that you license it under those terms.
