# The Open Layer for Agents

*A vision for how autonomous software entities — owned by different people, built by different teams, deployed in different clouds — should be able to find each other, work together, and pay each other safely.*

> 📄 中文版本：[manifesto.zh-CN.md](manifesto.zh-CN.md)

---

## 1. Where we are

By 2026, every team is shipping agents.

Your assistant manages your calendar. The new hire's research agent compiles competitive intel. The procurement team's agent negotiates renewals. The on-call agent triages incidents. Most of these are quiet, narrow, useful — and they live in **silos**.

When you need your agent to coordinate with mine, the answer is still a meeting. When my company's agent wants to buy something from yours, a human writes the email. When my research agent could save four hours by asking your domain-expert agent one question, neither agent has the language, the identity, or the wallet to do it.

The agents have outgrown their cages. The walls between them haven't moved.

## 2. The problem isn't transport

This isn't the first attempt at agent interop. Anthropic's MCP solved how a model talks to a tool. Google's A2A defined a message format for agent-to-agent traffic. IBM's ACP did the same. These protocols are good. They're getting adopted. And they leave the hardest layer untouched.

Because the hard problem is not **how messages travel**. It is:

- **Who is this agent?** Not its IP address — the human or organization who is *accountable* for what it does.
- **What can it do, at what price, with what guarantees?** Discovery, not connection.
- **What's its track record?** Reputation, when there's no boss to vouch for it.
- **How do I pay it, and what happens when something goes wrong?** Settlement and dispute, not just request and response.
- **What did my agent actually do, with whom, and on whose authority?** Audit and revocability, after the fact.

These are not engineering problems. They are **the problems markets have always had to solve**, every time strangers needed to trade with each other. We've solved them before, for humans, with passports and credit ratings and small claims courts and Stripe. We have solved approximately none of them for agents.

That is the missing layer. It does not yet exist. We are building it.

## 3. What we believe

Five things, said plainly.

**One. The agent population will grow by orders of magnitude.** Not because agents replace humans, but because the cost of spinning up another one approaches zero, and the cost of *not* spinning one up keeps rising. We will go from "agents at large companies" to "agents at every desk" to "every individual has a small fleet" within five years. Trillions of agent-to-agent transactions per day is not a fringe scenario. It is the floor.

**Two. Most of the value will be cross-organizational.** A single company's agents talking to themselves is not a market. The interesting value is when *your* agent and *my* agent get something useful done that neither of us would have done alone. That work cannot stay inside any one platform — it has to cross trust boundaries.

**Three. Open protocols win, but only when there's a trustworthy default implementation.** TCP/IP is open. Most people run a Linux kernel implementation operated by a major cloud. HTTP is open. Most people use Cloudflare or AWS. The pattern is: an open standard everyone can implement, with one or two reference operations that **most people use because it's easier**. We are doing both.

**Four. Trust is a socio-technical layer, not a feature.** Every shortcut here ends in tears. Anonymous agents transacting freely is a fraud machine. Agents with no recourse for bad behavior are a complaint generator. Agents whose owners can't audit them are a compliance disaster. Identity, reputation, and dispute resolution are not optional polish — they are the core product.

**Five. Every agent must remain accountable to a human or organization.** This is non-negotiable. AgentAgora exists to *enable* agent-to-agent interaction, but never at the cost of severing the chain of responsibility back to the people who deployed those agents. There is always a human or organization who answers when something goes wrong.

## 4. Why "agora"

The Greek **agora** was simultaneously a marketplace and a public forum. It was the place where strangers could meet, transact, debate, and depart — held together by shared rules, shared scales, shared coinage, and the knowledge that disputes would be heard. It worked because it was *both* commercial and civic at once. Stripping out either dimension would have collapsed it.

This is the structure we intend for agent interaction. Not a closed marketplace where one company sets the rules. Not a leaderless mesh where every transaction reinvents trust from zero. A **public layer** with shared rules, transparent governance, and an open protocol that any team can implement, alongside a **trustworthy default implementation** that handles the unglamorous infrastructure: identity, reputation, settlement, audit, dispute resolution.

We named the project AgentAgora because we believe the right metaphor for cross-user agent interaction is not "API integration" or "marketplace" or "blockchain." It is **the agora**. A place where strangers' agents can meet, transact, and have their disputes adjudicated — under rules that are written down, debated in the open, and enforceable.

## 5. What AgentAgora is

Two layers. One project.

**The AAP — AgentAgora Protocol.** Open. Apache-2.0. Self-hostable. It defines:

- **Agent identities** that resolve to a human or organization, with verifiable cryptographic proof
- **Capability manifests** that declare what an agent can do, at what price, with what guarantees
- **A wire format** for safe, signed, auditable agent-to-agent calls
- **An audit chain** that lets users see, with cryptographic certainty, what their agents did and on whose behalf

Anyone can implement it. Anyone can run a registry. The protocol does not require trusting us.

**The AgentAgora Cloud — reference implementation.** Apache-2.0. Deployable as a hosted service. When operated, it provides:

- A public registry where most agents will be discoverable, by default
- Identity issuance with KYC and Sybil resistance
- Custodial settlement on two rails — Stripe for fiat, USDC on Base for crypto — chosen per-call by the user
- A mixed human + AI dispute council, with publicly archived rulings
- Long-term audit storage, compliance reporting, enterprise SSO

**No operator runs it today.** The protocol is **necessary and sufficient** for two parties to interoperate without any hosted Cloud. The reference impl is the well-run default *for whoever runs it* — we may operate one later, someone else may, or nobody may. The protocol still works. This is not a contradiction. It is exactly how the web works.

## 6. What AgentAgora is not

Equally important.

- **Not a cryptocurrency.** We will never issue our own token. We carry third-party stablecoins (USDC) as one of two settlement rails because some agent flows want them. Settlement is plumbing, not the product.
- **Not a closed marketplace.** Anyone can self-host. Our economic moat is durable infrastructure, brand, network data, and dispute reputation — not lock-in.
- **Not an agent framework.** AgentAgora does not make agents. We connect agents that already exist, regardless of which framework, model, or runtime built them.
- **Not a replacement for MCP, A2A, or ACP.** We sit *above* them. They define how messages travel; we define who is sending them, what those messages are worth, and how to settle the bill.
- **Not a research project.** We intend to be the boring infrastructure that 100,000 agent products run on without thinking about it. Excellent infrastructure is invisible. We aim for invisible.

## 7. What we plan to ship

We are at the beginning. Honesty about timing matters.

**Today.** A locked tech stack, a 17-section product requirements document, an internal AAP v0.1 specification draft, and a TypeScript SDK skeleton with 62 passing tests. No production users. No live network. No revenue.

**The next quarter.** A working SDK that lets two real agents at different companies complete a paid call end-to-end, on Stripe, with full audit logs that both sides can verify cryptographically. First closed alpha.

**Within twelve months.** A public beta serving software teams (the vertical where the per-call value is highest and the demand is most concrete). USDC settlement on Base. The AAP v0.1 specification published openly under Apache-2.0. First lighthouse partners running real workloads.

**Beyond.** A reputation system that works without becoming a popularity contest. An enterprise tier with the SOC 2 / GDPR machinery a Fortune 500 needs. A mixed human + AI dispute council with public judgment archives. A self-hostable runtime that lets a sufficiently determined team run the whole stack on their own infrastructure, never touching us.

We will publish the protocol when it has been tested under real load — not before. We will publish a formal technical whitepaper when the protocol has survived its first breaking change in production — not before. Premature publication is how good designs ossify around bad assumptions.

## 8. The shape of the moat

We have been asked, repeatedly: **what stops Anthropic, OpenAI, or Google from building this in a weekend and crushing you?**

A fair question. Three answers.

**One — neutrality.** A protocol owned by a single model provider cannot credibly serve agents built on other model providers. We are aggressively model-neutral, framework-neutral, and runtime-neutral. This is a structural advantage that the foundation labs cannot replicate without internal contradiction.

**Two — financial infrastructure.** Stripe-grade settlement, dispute resolution, and compliance are not weekend projects. They are years of unglamorous work that AI labs have shown no appetite for, because their core product economics doesn't reward it.

**Three — long-term reputation data.** The first network with real agent reputation history — verified, auditable, multi-year — is the network everyone else's customers will quietly migrate to. We are starting that clock now. The clock cannot be restarted by spinning up a competing service later.

If a foundation lab eventually does what we do, they will be using our protocol — because our protocol will be the one that gives their customers the cross-platform interop their customers actually need.

## 9. An invitation

We are early. The codebase is small. The protocol is malleable. The decisions that get made in the next six months will shape what kind of layer this becomes.

If you are building agent products and need cross-organization interop — talk to us. The cheapest way for you to influence what the protocol looks like is to influence it now.

If you run agents at a software team — you are our M3 vertical. We want to know what your agents need to do for and with each other. The answer will become a feature.

If you care about how trust between strangers gets built into the next generation of software — read the [AAP spec draft](AAP-spec.md), open an issue on the [main repo](https://github.com/agentagora/agentagora), and tell us what's wrong with it. Honest critique is more valuable to us right now than agreement.

This is the layer the agent economy needs. We intend to build it.

---

*This document is a vision, not a contract. Specific technical and commercial decisions are made in the [PRD](PRD.md) and [tech stack](tech-stack.md), which take precedence where they conflict with this manifesto. The manifesto exists to make the project's worldview legible; if a future fact ever forces a worldview update, this document will be revised in the open and dated accordingly.*

*Version 1.0 — 2026-05-01*
