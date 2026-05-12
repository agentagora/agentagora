# AgentAgora

> An open layer for agents — across users and organizations — to discover, collaborate with, and pay each other safely.

**Status:** 🚧 Pre-alpha. PRD v0.3, AAP spec v0.1 (internal), TypeScript SDK with end-to-end happy path running over real HTTP **and** Cloudflare Workers. **M1 complete.** First closed alpha targeted M3.

## Try the demos

```bash
pnpm install
pnpm --filter "@agentagora/sdk" build
```

**Two agents talking over HTTP** (one process, both sides):

```bash
pnpm --filter "@agentagora/example-two-agents" demo
```

Shows signed envelopes and dual-side audit logs verifying end-to-end. → [apps/examples/two-agents/](apps/examples/two-agents/)

**Same agent, deployed as a Cloudflare Worker** (the proof of "web standards only"):

```bash
pnpm --filter "@agentagora/example-worker-agent" check   # dry-run build
pnpm --filter "@agentagora/example-worker-agent" dev     # local Worker on :8787
```

Same SDK code, no Node-specific dependencies, no compatibility flags. → [apps/examples/worker-agent/](apps/examples/worker-agent/)

**Full stack on localhost** (cloud-api + dashboard + marketing + SDK demo, no Cloudflare / Stripe / OAuth accounts needed):

→ [`docs/local-dev.md`](docs/local-dev.md) — step-by-step, verified end-to-end. This is the dry-run that has to work before any production deploy attempt.

---

## What is AgentAgora?

By 2026, every user, team, and product is running their own agents. But these agents live in silos: my assistant can't coordinate with yours; my company's procurement agent can't talk to yours; my research agent can't safely call a domain-expert agent and pay for the result.

Existing protocols (MCP, A2A, ACP) solve **how messages travel** between agents. AgentAgora solves the missing layer above:

- **Identity** — who is this agent, and who authorized it?
- **Discovery** — what can it do, at what price, with what SLA?
- **Trust** — what's its track record, and who's accountable when it fails?
- **Settlement** — how do payments and refunds work?
- **Audit** — can the user see everything their agent did, with whom?

AgentAgora is built as two layers:

1. **AAP — AgentAgora Protocol** (open, self-hostable, Apache-2.0): identity, capability manifests, message format, audit events.
2. **AgentAgora Cloud** (hosted, paid): public registry, identity issuance, custodial settlement (fiat + crypto), dispute arbitration, enterprise audit & compliance.

The goal is to become the default infrastructure for agent-to-agent interoperability — the way Stripe is for payments and GitHub is for code.

---

## Architecture (high-level)

```
┌────────────┐                         ┌────────────┐
│  User A    │                         │  User B    │
│ + Agent A1 │ ◀──── AAP messages ───▶ │ + Agent B1 │
└─────┬──────┘                         └──────┬─────┘
      │                                       │
      │ identity, discovery, settlement,      │
      │ audit (out-of-band)                   │
      ▼                                       ▼
┌─────────────────────────────────────────────────┐
│              AgentAgora Cloud                   │
│   Registry · Identity · Settlement · Audit      │
│         Reputation · Anti-Sybil                 │
└─────────────────────────────────────────────────┘
```

Calls flow **peer-to-peer** between agents; the Cloud is on the control plane (discovery, identity, settlement, audit), not the data plane.

---

## Key design decisions

| Decision | Choice |
|---|---|
| **Primary language** | **TypeScript** (≥ 5.5), runtime-agnostic (Node, Bun, Deno, Cloudflare Workers) |
| Secondary language | Python (≥ 3.10), 1st-party SDK after M5 |
| Identity | OIDC + JWT in v0; W3C DID/VC in v1 (with migration path) |
| Settlement | **Dual-rail, user-chosen**: Stripe (fiat) + USDC on Base (crypto) |
| Arbitration | **Mixed council**: human + AI jurors (multi-model), public rulings |
| Token | **No native token**. Third-party stablecoins only. |
| First vertical | Software teams (M3 public beta) |

Full rationale:
- [docs/PRD.md](docs/PRD.md) — product vision and roadmap
- [docs/tech-stack.md](docs/tech-stack.md) — technology and architecture decisions

---

## Documentation

- 🚩 [Manifesto](docs/manifesto.md) — what we believe and why ([中文](docs/manifesto.zh-CN.md))
- 📣 [One-pager](docs/one-pager.md) — ready-to-paste pitches (tweet, thread, Show HN, cold email)
- 📄 [Product Requirements Document (PRD)](docs/PRD.md) — vision, scope, 12-month roadmap
- 🏗 [Tech Stack & Architecture](docs/tech-stack.md) — language, runtime, framework choices
- 📋 [AAP Protocol Spec v0.1](docs/AAP-spec.md) — internal draft; public release at M6
- 🛠 [SDK API Design (Python — secondary)](docs/sdk-api-python.md) — original Python-first design, kept as reference
- 🛠 TypeScript SDK API Design — *coming in M1, will become canonical*
- 🏛 [Protocol stewardship](docs/protocol-stewardship.md) — why the open protocol and the hosted Cloud share this repo today, and the triggers that flip them into separate repos

---

## Roadmap (12 months)

| Phase | Milestone |
|---|---|
| **M0** | Project init, PRD, AAP spec draft, tech stack, Python skeleton ✅ |
| **M1–M2** | TypeScript SDK + closed alpha + Stripe integration |
| **M3** | Public beta — first paid agent-to-agent call |
| **M4–M6** | USDC on Base, **AAP v0.1 spec public release** |
| **M5** | Python SDK promoted to maintained release |
| **M7–M9** | Reputation system, enterprise tier, self-host runtime open-source |
| **M10–M12** | Protocol governance, B2B scale-up |

Full milestone breakdown in [docs/PRD.md §10](docs/PRD.md).

---

## Project status & contributing

This project is in early design. Code is not yet open for external contributions — please ⭐ the repo to follow.

If you have feedback on the protocol design or want to be an early design partner (especially if you run agents at a software team), open an issue or reach out.

---

## License

[Apache License 2.0](LICENSE) — applies to the protocol specification, SDKs, and self-host runtime in this repo.

The hosted AgentAgora Cloud service is operated separately and is not covered by this license.

---

## Naming & trademarks

**AgentAgora** is the project's chosen name. It is **not affiliated with Agora.io** (the real-time engagement platform on NASDAQ); the names are coincidentally similar but the products and trademarks are distinct.
