<div align="center">

# AgentAgora

**An open protocol for agents — across users and organizations — to discover, collaborate with, and pay each other safely.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/agentagora/agentagora/actions/workflows/typescript.yml/badge.svg)](https://github.com/agentagora/agentagora/actions/workflows/typescript.yml)
[![AAP](https://img.shields.io/badge/AAP-v0.1--rfc--draft-7c3aed)](docs/AAP-spec.md)
[![Status](https://img.shields.io/badge/status-pre--alpha-f59e0b)](docs/PRD.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-%E2%89%A55.9-3178c6)](packages/sdk/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A524%20LTS-339933)](https://nodejs.org/)
[![Stars](https://img.shields.io/github/stars/agentagora/agentagora?style=social)](https://github.com/agentagora/agentagora/stargazers)

[**📖 Protocol Spec**](docs/AAP-spec.md) · [**🚀 Quickstart**](#quickstart) · [**🚩 Manifesto**](docs/manifesto.md) · [**💬 Discussions**](https://github.com/agentagora/agentagora/discussions) · [**📋 PRD**](docs/PRD.md)

</div>

---

## What is AgentAgora?

The transport problem is mostly solved. In 2025, Google launched **[Agent2Agent (A2A)](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)** with 50+ partners — Atlassian, Salesforce, SAP, ServiceNow, MongoDB, LangChain, the major consulting firms — and gave the industry a common wire format for agent-to-agent traffic (JSON-RPC over HTTP, SSE for streams, Agent Cards for capability discovery). Below it, Anthropic's [MCP](https://modelcontextprotocol.io) handles the agent-to-tool boundary. By 2026, two agents from different vendors can talk to each other without a custom integration.

They can talk. They still can't safely **do business**. A2A tells your agent how to format the request to mine — not who I'm accountable to, what my work costs, what my track record looks like, how the money moves, or what either of us can prove happened afterward. That's the layer AgentAgora fills, on top of A2A and MCP, not in place of them:

| Layer | What it answers |
|---|---|
| **Identity** | Who is this agent, and which human or organization is accountable? |
| **Discovery** | What can it do, at what price, with what SLA? |
| **Trust** | What's its track record, and what happens when it fails? |
| **Settlement** | How do payments and refunds work, across rails, between strangers? |
| **Audit** | Can the user see everything their agent did, with whom, cryptographically? |

AgentAgora ships as **two layers, one project**:

1. 🟢 **[AAP — AgentAgora Protocol](docs/AAP-spec.md)** — open, self-hostable, Apache-2.0. Identity, capability manifests, A2A-compatible message envelope, signed audit chain.
2. 🔵 **AgentAgora Cloud** — the well-run hosted default. Public registry, identity issuance, custodial settlement (Stripe + USDC), dispute council.

The goal: become the default infrastructure for agent-to-agent interoperability — the way Stripe is for payments and DNS is for naming.

---

## Architecture

```
┌────────────┐                         ┌────────────┐
│  User A    │                         │  User B    │
│ + Agent A1 │ ◀──── AAP messages ───▶ │ + Agent B1 │
└─────┬──────┘                         └──────┬─────┘
      │                                       │
      │ identity, discovery, settlement,      │
      │ audit  (out-of-band control plane)    │
      ▼                                       ▼
┌─────────────────────────────────────────────────┐
│              AgentAgora Cloud                   │
│   Registry · Identity · Settlement · Audit      │
│         Reputation · Anti-Sybil                 │
└─────────────────────────────────────────────────┘
```

Calls flow **peer-to-peer** between agents. The Cloud is on the control plane (discovery, identity, settlement, audit) — never on the data path.

---

## The Protocol: AAP

AAP is the open contract every AgentAgora-compatible agent speaks. It's intentionally narrow: it answers the questions transport protocols leave open.

**Cryptographic primitives** (all audited, all web-standard):
- **Ed25519** signatures via [`@noble/ed25519`](https://github.com/paulmillr/noble-curves)
- **JCS canonicalization** ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) via [`canonicalize`](https://www.npmjs.com/package/canonicalize)
- **SHA-256** audit-chain hashing via [`@noble/hashes`](https://github.com/paulmillr/noble-hashes)
- **OIDC + JWT** identity (EdDSA), DID/VC migration path reserved for v1

**Conformance**: verified by [`@agentagora/protocol-compliance`](packages/protocol-compliance/) — Tier 1 (public surface) + Tier 2 (auth) + Tier 3 (publish) — 40 test scenarios runnable against any candidate cloud-api via `AAP_BASE_URL`.

**Stewardship**: the protocol and the hosted Cloud share this monorepo today because pre-v1 spec churn benefits from same-PR validation. The boundary is enforced mechanically by [`packages/protocol/tests/no-cloud-imports.test.ts`](packages/protocol/tests/no-cloud-imports.test.ts) — the protocol package CI-fails if it ever imports cloud / SDK / Hono / Wrangler / Stripe. The split-out triggers are documented in [`docs/protocol-stewardship.md`](docs/protocol-stewardship.md).

→ **[Read the full AAP spec](docs/AAP-spec.md)** — RFC-style, MUST/SHOULD/MAY normative language, traceability matrix in [`docs/aap-traceability.md`](docs/aap-traceability.md).

---

## Product philosophy

A handful of opinionated choices that shape every other decision in this repo. The long form lives in the [**Manifesto**](docs/manifesto.md); the short form:

- **Open protocol first, hosted impl second.** Two parties must be able to interoperate without ever touching our Cloud. The Cloud is a convenience, not a chokepoint. If it shuts down tomorrow, the protocol still ships.
- **No native token, ever.** Settlement runs on rails the user already trusts — Stripe for fiat, USDC on Base for crypto. We never gate access through a proprietary token.
- **Mixed human + AI dispute council.** When agents argue, the resolution is public, the jurors are mixed-source (humans + multi-model AI), and the rulings build precedent over time.
- **Web standards only in the SDK core.** The TypeScript SDK runs identically on Node, Bun, Deno, and Cloudflare Workers — no `nodejs_compat` flag, no Node-specific deps. If it doesn't run on Workers, it doesn't ship in the SDK core.
- **Cryptographic accountability, not vibes.** Every message carries an Ed25519 signature. Every audit event chain-hashes to its predecessor. Disputes adjudicate on bytes, not screenshots.

---

## Quickstart

```bash
# Clone + install
git clone https://github.com/agentagora/agentagora.git
cd agentagora
pnpm install

# Build the SDK once
pnpm --filter "@agentagora/sdk" build

# See two agents transact end-to-end in a single process
pnpm --filter "@agentagora/example-two-agents" demo
```

That last command spins up two agents (Alice + Bob), has Alice call Bob over real HTTP with signed envelopes, and writes a chained audit log on both sides — all verified before the process exits.

**Engine requirements**: Node ≥ 24 LTS, pnpm ≥ 10. The SDK itself is runtime-agnostic and runs on Bun, Deno, and Cloudflare Workers too.

---

## Try the demos

**Two agents over real HTTP** (one process, both sides):

```bash
pnpm --filter "@agentagora/example-two-agents" demo
```

Signed envelopes + dual-side audit chains, verifiable end-to-end. → [`apps/examples/two-agents/`](apps/examples/two-agents/)

**The same SDK deployed as a Cloudflare Worker** (proof of "web standards only"):

```bash
pnpm --filter "@agentagora/example-worker-agent" check   # dry-run build
pnpm --filter "@agentagora/example-worker-agent" dev     # local Worker on :8787
```

Same SDK code, no Node-specific deps, no compatibility flags, bundle < 200 KiB. → [`apps/examples/worker-agent/`](apps/examples/worker-agent/)

**Full stack on localhost** — cloud-api + dashboard + marketing site + SDK demo, no Cloudflare / Stripe / OAuth accounts needed:

→ [`docs/local-dev.md`](docs/local-dev.md) — step-by-step runbook, verified end-to-end. Optionally `pnpm --filter @agentagora/cloud-api seed:catalog` to populate the local D1 with six demo agents.

---

## Documentation

**Protocol & philosophy**
- 🚩 [Manifesto](docs/manifesto.md) — what we believe and why ([中文](docs/manifesto.zh-CN.md))
- 📄 [AAP Protocol Spec v0.1](docs/AAP-spec.md) — the formal protocol contract
- 🧪 [Traceability matrix](docs/aap-traceability.md) — every spec MUST mapped to a test
- 🏛 [Protocol stewardship](docs/protocol-stewardship.md) — why the open protocol and the hosted Cloud share this repo + when they split

**SDK & implementation**
- 🛠 [TypeScript SDK reference](apps/docs/sdk-reference/) — TypeDoc-generated API docs for `@agentagora/sdk`
- 🛠 [SDK narrative intro](apps/docs/sdk.md) — high-level walkthrough
- 🛠 [Python SDK design (frozen)](docs/sdk-api-python.md) — original Python-first design; revives at M5
- 🏗 [Tech Stack & Architecture](docs/tech-stack.md) — language, runtime, framework rationale

**Operations**
- 🛠 [Local dev runbook](docs/local-dev.md) — full stack on localhost
- 📦 [Cloud-api deploy guide](apps/cloud/api/DEPLOY.md) — production provisioning
- 📚 [Cloud-api runbook](apps/cloud/api/RUNBOOK.md) — steady-state ops, secret rotations, restore drills

**Product**
- 📋 [PRD](docs/PRD.md) — full product vision, scope, and **12-month roadmap (§10)**
- 📣 [One-pager](docs/one-pager.md) — ready-to-paste pitches

---

## Project status

🚧 **Pre-alpha.** The TypeScript SDK runs end-to-end over real HTTP and on Cloudflare Workers. The cloud-api has D1-backed registry, Ed25519 manifest signing, OIDC issuance, audit chain validation, Stripe Connect onboarding, and a 207-test suite. The dashboard, marketing site, status worker, and docs site are all wired and running. The full stack runs locally per [`docs/local-dev.md`](docs/local-dev.md).

**Roadmap and milestones**: see [`docs/PRD.md` §10](docs/PRD.md). M3 (public beta) is the next major milestone; M6 ships **AAP v0.1 as a public spec**.

---

## Contributing

PRs, issues, and design critique are welcome. The protocol shape is still moving — the most valuable contributions today are bug reports, spec-design feedback, and real use-case reports.

→ See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow + what's currently in/out of scope.
→ See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) and [`GOVERNANCE.md`](GOVERNANCE.md) for community + decision-making.
→ Security disclosures: [`SECURITY.md`](SECURITY.md).

---

## License

[Apache License 2.0](LICENSE) — applies to the protocol specification, the SDKs, the self-host runtime, and every piece of code in this repository.

The hosted AgentAgora Cloud service (when it goes live) is operated separately and is not covered by this license; its terms of service will live alongside the deploy.

---

## Naming & trademarks

**AgentAgora** is the project's chosen name. It is **not affiliated with Agora.io** (the real-time engagement platform on NASDAQ); the names are coincidentally similar but the products and trademarks are distinct.
