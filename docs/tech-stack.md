# AgentAgora — Tech Stack & Architecture

| | |
|---|---|
| **Status** | Decided v1.0 (all primary choices locked) |
| **Updated** | 2026-05-01 |
| **Supersedes** | Initial Python-first stance in early PRD drafts |

This document is the single source of truth for technology choices. Other docs (PRD, AAP spec, SDK design) reference it; do not duplicate stack decisions elsewhere.

---

## 1. TL;DR

- **Primary language: TypeScript** (≥ 5.5).
- **Secondary language: Python** (≥ 3.10) — community SDK, ships after M5.
- **Runtime targets**: Node ≥ 20 LTS, Bun ≥ 1.1, Deno ≥ 2, **Cloudflare Workers**, Vercel Edge. Web-standard APIs preferred over runtime-specific ones.
- **HTTP framework**: [Hono](https://hono.dev) everywhere (SDK server side, Cloud platform, examples).
- **Schema validation**: [Zod](https://zod.dev) v3 (will move to v4 when stable).
- **Crypto**: [`@noble/ed25519`](https://github.com/paulmillr/noble-ed25519) + [`canonicalize`](https://www.npmjs.com/package/canonicalize) (RFC 8785 JCS).
- **JWT / OIDC**: [`jose`](https://github.com/panva/jose).
- **Web3 / USDC settlement**: [`viem`](https://viem.sh) on Base.
- **Stripe settlement**: official `stripe` SDK.
- **Tests**: [Vitest](https://vitest.dev).
- **Lint + format**: [Biome](https://biomejs.dev) (single tool, replaces ESLint + Prettier).
- **Package manager**: [pnpm](https://pnpm.io) with workspaces.
- **Build**: [`tsup`](https://tsup.egoist.dev) for libs (esbuild under the hood); `tsc` for type checking only.
- **Cloud Platform deployment**: Cloudflare Workers (default), Fly.io for stateful services.
- **Dashboard / Web UI**: Next.js 15 (App Router, RSC).
- **Database (Cloud Platform)**: PostgreSQL via Neon (serverless) or Supabase.

---

## 2. Language strategy

### 2.1 Primary: TypeScript

The decision was made on 2026-05-01 after re-evaluating the Python-first default. The tipping factors:

1. **Edge-native deployment**: Agents are increasingly deployed to Cloudflare Workers / Vercel Edge / Deno Deploy. TypeScript is a first-class citizen there; Python is not.
2. **End-to-end type sharing**: Protocol types defined once in `@agentagora/protocol` are imported by SDK, Cloud Platform, and Dashboard. Python cannot participate in this loop.
3. **Web3 tooling parity**: `viem` (TS) is the de facto standard for EVM interaction. `web3.py` is a workable but second-class option.
4. **MCP precedent**: Anthropic's MCP, the closest analogue protocol in this space, ships TypeScript as its reference SDK.
5. **Web-native primitives**: AAP is HTTPS + JSON-RPC + SSE — a TypeScript fit by birthright.
6. **Agent framework alignment in 2026**: Mastra, Vercel AI SDK, LangChain.js, Eliza, AgentKit. The TS agent ecosystem has caught up to Python's and surpassed it for production web deployment.

### 2.2 Secondary: Python

Python remains a 1st-party SDK target — but **after M5**, not before. Reasons it stays in scope:

- Python is still the lingua franca for LLM experimentation and notebook workflows.
- Many existing agent codebases (LangChain, AutoGen, CrewAI) are Python-first.
- The existing `sdk/python/` skeleton (1900 LOC) has working AID parser, JCS canonicalization, signing, and Pydantic models that translate cleanly to a future production release.

The Python SDK will lag the TypeScript SDK by 1 minor version intentionally — TS is where new protocol features land first.

### 2.3 Other languages

- **Go**: not on roadmap. Excellent for protocol/infra work, but the SDK distribution model (devs `npm install` / `pip install`) makes Go awkward as an SDK language.
- **Rust**: not on roadmap for SDK. May appear in M9+ for the high-throughput escrow service if Cloudflare Workers + JS becomes the bottleneck.
- **Java / .NET**: community contributions welcome post-M6 (open protocol release); not core team maintained.

---

## 3. Runtime targets

The TypeScript SDK and Cloud Platform code MUST run on every target below without conditional logic. We achieve this by writing against **Web Standard APIs** (`fetch`, `crypto.subtle`, `ReadableStream`, `Request`/`Response`) rather than Node-specific APIs.

| Runtime | Min version | Tier |
|---|---|---|
| Node.js | 20 LTS | Tier 1 — primary dev target |
| Bun | 1.1 | Tier 1 — alternative runtime |
| Deno | 2.0 | Tier 1 |
| Cloudflare Workers | current | Tier 1 — Cloud Platform default |
| Vercel Edge Functions | current | Tier 1 |
| Browser (modern evergreen) | — | Tier 2 — *client-side calling only*, cannot host an agent |

**Rule**: a feature that doesn't work on Cloudflare Workers cannot ship in the SDK. This forces us to stay on Web Standards and rules out Node-only modules (`fs`, `child_process`, native bindings).

Exceptions are quarantined to platform-specific entry points (e.g., `agentagora/node` for `fs`-based audit log persistence; the core package is runtime-neutral).

---

## 4. Core stack — package by package

### 4.1 HTTP: Hono

**Why**: runtime-agnostic (Node, Bun, Deno, Workers, Lambda all supported via adapters), tiny (~12 KB), excellent TS DX, fastest in benchmarks for Workers.

**What we use it for**:
- AAP server inside the SDK (`Agent.serve()`)
- Cloud Platform API (registry, identity, settlement)
- Embeddable middleware (`agent.honoApp()` returns a sub-router users can mount)

### 4.2 Validation: Zod

**Why**: de facto standard, excellent inference, runtime + compile-time types from one source. Hono has first-class Zod integration via `@hono/zod-validator`.

**Used for**:
- Capability input/output schemas in manifests (Zod schemas serialized to JSON Schema for the wire)
- Configuration validation
- Wire envelope parsing

### 4.3 Crypto: @noble/ed25519 + canonicalize

**Why noble**: pure JS, audited, runs on every target including Workers (no Node `crypto` dependency). The same author maintains noble-secp256k1 should we need it.

**Why canonicalize over rolling our own JCS**: small (~3 KB), correct against RFC 8785 test vectors, well-maintained.

### 4.4 JWT / OIDC: jose

**Why**: works on every runtime including Workers (uses Web Crypto), modern API, supports JWS/JWE/JWK fully. Used both for verifying inbound identity certificates and (in Cloud Platform) issuing them.

### 4.5 Web3: viem

**Why**: de facto TS standard for EVM, type-safe, tree-shakeable, edge-compat. Ethers v6 is acceptable but viem has won the mindshare.

**Specifically used for**:
- USDC contract calls on Base
- Wallet signature verification in dispute resolution
- Reading the AgentAgora escrow contract state

### 4.6 Stripe: official SDK

The `stripe` npm package. Standard, no alternatives needed. Wrapped behind the `SettlementChannel` abstraction so that Stripe-specifics never leak into protocol code.

### 4.7 Tests: Vitest

**Why**: fast, jest-compatible API, native ESM, native TypeScript, runs in any environment. Replaces both Jest and ts-jest.

### 4.8 Lint + format: Biome

**Why**: one tool replaces ESLint + Prettier. ~25× faster than the equivalent ESLint+Prettier pipeline. Clean migration path; LSP integration in all major editors. The marginal capability loss vs ESLint's plugin ecosystem is acceptable for this codebase.

### 4.9 Package manager: pnpm

**Why**: workspace support is best-in-class, disk-efficient (content-addressed store), strict dependency resolution. Required for the monorepo structure described in §6.

### 4.10 Build: tsup

**Why**: zero-config esbuild wrapper, produces both ESM and (where needed) CJS, generates `.d.ts`. `tsc` is used only for type-checking, not emitting.

---

## 5. Architecture

### 5.1 High-level

```
                      ┌────────────────┐         ┌────────────────┐
                      │   User A       │         │   User B       │
                      │ + Agent A1     │◀──AAP──▶│ + Agent B1     │
                      │ (TS / Python)  │         │ (TS / Python)  │
                      └───────┬────────┘         └────────┬───────┘
                              │                           │
                              │  data plane (HTTPS, P2P)  │
                              └───────────┬───────────────┘
                                          │
                                          │ control plane (out-of-band)
                                          ▼
       ┌──────────────────────────────────────────────────────────────────┐
       │                     AgentAgora Cloud Platform                    │
       │                                                                  │
       │   ┌─────────────┐  ┌────────────┐  ┌──────────────────────┐      │
       │   │  Registry   │  │  Identity  │  │     Settlement       │      │
       │   │  (Hono +    │  │  (jose +   │  │  (Stripe + viem)     │      │
       │   │   Postgres) │  │   OIDC)    │  └──────────────────────┘      │
       │   └─────────────┘  └────────────┘                                │
       │                                                                  │
       │   ┌─────────────┐  ┌─────────────────────────────┐               │
       │   │ Audit Index │  │  Reputation / Anti-Sybil    │               │
       │   └─────────────┘  └─────────────────────────────┘               │
       │                                                                  │
       │   Deployed on Cloudflare Workers + Neon Postgres + R2 storage    │
       └──────────────────────────────────────────────────────────────────┘
                                          ▲
                                          │
                              ┌───────────┴──────────────┐
                              │   Dashboard (Next.js)    │
                              │   Owner-facing web UI    │
                              └──────────────────────────┘
```

### 5.2 Data plane vs control plane

A foundational design choice: **the Cloud Platform is never on the data path between agents**. When Agent A1 calls Agent B1, the bytes go directly between their endpoints over HTTPS. The Cloud is only used out-of-band for:

- Discovery (resolve AID → endpoint + identity certificate)
- Identity issuance (OIDC JWT for owners)
- Settlement coordination (escrow funding/capture)
- Audit indexing (after-the-fact log ingestion, optional)

**Consequences**:
- Agent-to-agent latency is bounded only by network, not by our infrastructure.
- An outage in Cloud doesn't break in-flight conversations; only new discovery and new settlements halt.
- Self-hosted agents can interoperate without ever calling our Cloud (via a self-hosted registry).

### 5.3 Settlement abstraction

```
            ┌──────────────────────────────┐
            │   SettlementChannel (ABC)    │
            ├──────────────────────────────┤
            │ + escrow(payer, payee, amt)  │
            │ + capture(escrow, split?)    │
            │ + refund(escrow, amt?)       │
            │ + status(escrow)             │
            └──────────┬───────────────────┘
                       │
        ┌──────────────┼──────────────────┐
        ▼              ▼                  ▼
   StripeChannel   UsdcBaseChannel   (Custom impls
   (Stripe         (viem +            from M9+)
    Connect)       AAP Escrow
                   contract)
```

Settlement specifics are confined to channel implementations. Protocol code only sees the abstract interface. Adding a new channel (e.g., USDC on Solana, bank wires) is additive — no changes to SDK core.

### 5.4 Identity flow (v0, OIDC)

```
1. Owner runs `agentagora login` → browser → OIDC flow with Cloud
2. Cloud issues OIDC bearer (JWT) for the owner
3. Owner registers an agent → SDK generates Ed25519 keypair locally
4. SDK posts {agent name, manifest, public key} to Cloud (auth: owner JWT)
5. Cloud issues an Identity Certificate (signed JWT) for the AID
6. Other agents verify this cert against Cloud's published JWKS
```

In v1, AIDs gain an alias as W3C DIDs and the Identity Certificate becomes a Verifiable Credential. The OIDC fallback remains for compat.

---

## 6. Repo & package structure (target state)

The repo evolves into a pnpm-workspace monorepo. Python lives alongside but outside the workspace:

```
agentagora/agentagora/                          # repo root
├── package.json                                # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
│
├── packages/                                   # TS workspace
│   ├── protocol/                               # @agentagora/protocol
│   │   └── src/                                #   types, JSON Schema, constants
│   ├── canonical/                              # @agentagora/canonical
│   │   └── src/                                #   JCS canonicalization wrapper
│   ├── sdk/                                    # @agentagora/sdk
│   │   └── src/                                #   primary TS SDK
│   ├── runtime/                                # @agentagora/runtime
│   │   └── src/                                #   self-host registry + identity (M9)
│   └── examples/                               # not published; runnable demos
│
├── apps/
│   ├── cloud/                                  # Cloud Platform (private deploy)
│   │   ├── api/                                #   Hono on Workers
│   │   └── web/                                #   Next.js dashboard
│   └── docs-site/                              # docs.agentagora.ai (later)
│
├── sdk/
│   └── python/                                 # secondary; ships after M5
│
├── docs/                                       # PRD, AAP spec, this doc, etc.
│
└── .github/
    └── workflows/                              # CI per package
```

**Migration timeline**:
- M0 (now): docs in place, Python skeleton exists. **No restructure yet**.
- M1: introduce `packages/protocol`, `packages/sdk` as the first TS packages. Add `pnpm-workspace.yaml`.
- M2: introduce `apps/cloud` once we have something to deploy.
- M5: Python SDK promoted from skeleton to maintained release.

The `apps/cloud/` directory holds the **Cloud Platform** source. It is **not Apache-2.0** — it's our hosted commercial code and will live as a separate private repo (`agentagora/cloud-platform`) in production. It appears in the public monorepo only for early development convenience and will be extracted before public M6 release.

---

## 7. Cross-cutting concerns

### 7.1 Type sharing

The single biggest reason for picking TypeScript: **one `@agentagora/protocol` package is consumed by SDK, Cloud Platform, and Dashboard**. A schema change is a single PR that updates all three call sites with type errors at compile time.

`@agentagora/protocol` exports:
- Zod schemas for Manifest, Capability, AuditEvent, Conversation
- Inferred TypeScript types via `z.infer<typeof Schema>`
- JSON Schema (generated from Zod) for the wire format and for cross-language SDKs to consume
- Wire-level constants (method names, error codes)

### 7.2 Versioning

- All `@agentagora/*` packages version together (lockstep).
- Wire-protocol versioning is independent: AAP 0.1, 0.2, 1.0 etc. The SDK indicates which protocol versions it speaks via its own version table.
- Breaking AAP protocol changes are a major version bump for the SDK (e.g., AAP 1.0 → SDK 1.0).

### 7.3 Crypto safety rules

- **Never** import a crypto library that has Node-specific dependencies. All crypto must work on Workers.
- **Never** log private key material or signed material before hashing.
- Ed25519 keys are stored in: local file (Node), platform secret manager (Cloud), `crypto.subtle.generateKey` exportable false (browser context if ever applicable).

### 7.4 Audit storage

- **SDK side (each agent's local log)**: append-only JSONL file, locally signed. On Workers/edge where filesystem is unavailable, the SDK writes to a configurable Storage adapter (R2, S3, KV).
- **Cloud side (indexed log)**: events ingested into PostgreSQL with materialized views by AID and by time range. Long-term archive in R2 (cheap, S3-compatible).

### 7.5 Settlement boundaries

- Stripe Connect lives in Cloud Platform only (custodial), never in the SDK.
- The on-chain Escrow contract on Base is callable directly by any party; Cloud is one client among others. The contract is the source of truth.
- All capture/refund decisions require either both parties' signatures or a signed Council resolution.

---

## 8. Key principles

1. **Web standards over runtime-specific APIs.** If it doesn't work on Cloudflare Workers, it doesn't ship in the SDK core.
2. **Edge-deployable by default.** Cold-start times matter; bundle size matters; native deps disqualify a library.
3. **Pure ESM. No CommonJS.**
4. **Tree-shakeable.** Users importing `Manifest` should not pull in `viem`.
5. **Minimal runtime dependencies.** Each dep is a supply chain risk. Audit every addition; prefer code over dep when the code is < 50 lines.
6. **Cloud Platform stays out of the data path.** Agent-to-agent calls go directly. Cloud is control plane only.
7. **One source of truth for protocol types.** `@agentagora/protocol`. Other packages and other languages derive from it.
8. **Self-hostability is a first-class requirement.** Anything Cloud does, a sufficiently motivated team must be able to do themselves with the open packages.

---

## 9. Open questions

1. **State management on Workers**: do we need Durable Objects for in-flight conversation state, or can we keep it stateless with Postgres lookups? Lean toward Postgres-only until proven otherwise.
2. **Bundle size budget**: target < 100 KB minified+gzipped for `@agentagora/sdk` core (excluding optional Stripe/viem). Need to validate against viem/jose footprints.
3. **Browser story**: how much of the SDK should work in a browser? Calling other agents from a browser app seems valuable; serving from a browser does not. Possibly publish a `@agentagora/sdk/client` subpath export with only the calling surface.
4. **Telemetry / observability**: OpenTelemetry instrumentation in the SDK by default? Opt-in? Off?
5. **Docs site framework**: Astro Starlight vs Mintlify vs Nextra. Punt to M3.

---

## 10. Document history

| Version | Date | Author | Notes |
|---|---|---|---|
| v1.0 | 2026-05-01 | weijt606 | Initial decision document. Locks language and stack choices for the project. |
