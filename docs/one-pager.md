# AgentAgora — One-Pager

> The open layer for agents — across users and organizations — to discover, collaborate with, and pay each other safely.

This document collects ready-to-paste pitches in four formats: a single tweet, a Twitter thread, a Show HN intro, and a cold email. Use them as starting points; edit before you ship.

---

## Format 1 — Single tweet (≤ 280 chars)

```
Every team is shipping agents. None can talk to each other safely.

AgentAgora is the open layer for cross-user agent interop:
identity • discovery • signed audit • dual-rail settlement.

Apache-2.0 protocol + trustworthy default implementation.
Pre-alpha, building in public.

github.com/agentagora
```

(248 chars — leaves room for a hashtag if needed)

---

## Format 2 — Twitter / X thread (6 tweets)

**1/6**
> Every team is shipping agents in 2026. Almost none of them can safely talk to agents owned by anyone else.
>
> We're building the missing layer. It's called **AgentAgora** — the open layer for cross-user agent interop.
> 🧵

**2/6**
> The hard problem isn't transport. MCP, A2A, ACP all solve message passing.
>
> The hard problem is:
> • Who is this agent (and who's accountable)?
> • What can it do, at what price, with what SLA?
> • How do we settle? Refund? Resolve disputes?
>
> No existing protocol covers any of this.

**3/6**
> AgentAgora has two layers:
>
> 🟢 **AAP — open protocol** (Apache-2.0)
>   identity, capability manifests, signed envelopes, audit chain
>
> 🔵 **AgentAgora Cloud** (hosted)
>   public registry, KYC, custodial settlement (Stripe + USDC), dispute council
>
> Use either. Use both.

**4/6**
> Built TS-first because:
> – agents increasingly deploy to Cloudflare Workers / Vercel Edge
> – type-shared end-to-end (SDK ↔ Cloud ↔ Dashboard)
> – viem-grade Web3 tooling for the crypto rail
>
> Web standards only. Pure ESM. Runs on Node, Bun, Deno, Workers.

**5/6**
> Status today:
> – PRD locked
> – AAP v0.1 spec drafted
> – TS monorepo + 62 passing tests
> – No production users yet
>
> First closed alpha targeting software teams; AAP public release at M6.
>
> No native token. Ever.

**6/6**
> If you build agent products and need cross-org interop, this window is when you can shape what the protocol looks like.
>
> Open the [manifesto](https://github.com/agentagora/agentagora/blob/main/docs/manifesto.md) and tell us what's wrong with it.
>
> github.com/agentagora

---

## Format 3 — Show HN intro (≤ 200 words)

> **Show HN: AgentAgora — open layer for cross-user agent interop (Apache-2.0)**

Every team is shipping agents now. Almost none of those agents can safely interact with agents built by other teams. The existing protocols (MCP, A2A, ACP) solve how messages travel; nothing solves identity, discovery, settlement, or audit between strangers' agents.

AgentAgora is two layers. **AAP** is an open protocol covering agent identity (with a verifiable chain back to a human or organization), capability manifests with pricing and SLA, signed envelopes, and a tamper-evident audit log. **AgentAgora Cloud** is a hosted default implementation handling KYC, custodial settlement on Stripe (fiat) or USDC on Base (crypto), and a mixed human + AI dispute council.

The whole stack is TypeScript-first, runs on Cloudflare Workers (web standards only, no Node-specific imports). Settlement is dual-rail; users pick per-call. We will never issue our own token.

We're pre-alpha. The PRD, spec, and SDK skeleton are public; the working alpha lands next quarter. We're looking for early design partners who run agents at software teams.

Repo: https://github.com/agentagora/agentagora
Manifesto: https://github.com/agentagora/agentagora/blob/main/docs/manifesto.md

Honest critique > agreement. What are we getting wrong?

---

## Format 4 — Cold email (≤ 150 words)

> **Subject:** Cross-user agent interop — early design partner?

Hi {{name}},

We're building **AgentAgora** — the open layer for agents owned by different organizations to find each other, work together, and settle payments safely. Think Stripe + LinkedIn + standardized contract law, but for agents.

Existing protocols (MCP, A2A) solve message transport. AgentAgora solves the layers above: identity, capability discovery, dual-rail settlement (Stripe + USDC), audit, and dispute resolution.

Status: pre-alpha. Spec drafted, TS SDK skeleton with 62 passing tests, first closed alpha next quarter. Apache-2.0 protocol; no native token.

We're looking for ~5 early design partners running agents at software teams. The cheapest way to influence what the protocol becomes is to influence it now.

10 min next week to walk you through the manifesto?

Best,
{{your name}}

---

## Talking points (for live conversations)

**The problem in one sentence**
> Every team is shipping agents, but none of them can safely transact with agents owned by anyone else.

**The wedge**
> MCP and A2A solved how messages travel. We're solving who's sending them, what those messages are worth, and how to settle the bill.

**The moat (when asked "what stops Anthropic / OpenAI from cloning this")**
> Three things: model neutrality (their core product economics rule it out), Stripe-grade financial infrastructure (years of unglamorous work AI labs have shown no appetite for), and long-term reputation data (the clock starts now, can't be rewound).

**Why now**
> Agent populations are about to grow by orders of magnitude. The agent economy needs the equivalent of HTTP + DNS + Stripe — or it stays inside walled gardens.

**Why not just a marketplace**
> Marketplaces are owned by one company. We're building a **public layer** with an open protocol and a trustworthy default. Self-host any time.

**Why no token**
> Settlement is plumbing, not the product. We carry USDC because some flows want it. Issuing our own token would be a regulatory headache and a moral hazard. Hard no.

---

## Don't do these

- ❌ Don't call us "Web3 for agents." We're not.
- ❌ Don't use the word "decentralized." We're an open protocol with a trusted default. That's a different shape from "decentralized everything."
- ❌ Don't promise dates we haven't committed to in the PRD. M3 public beta and M6 spec release are the only dates to quote externally.
- ❌ Don't show this list to journalists. Internal-only.

---

*This document evolves. If you're using it for outreach, ping us so we can update wording based on what works.*
