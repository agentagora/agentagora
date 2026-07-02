# AAP interop positioning — OASF/AGNTCY · KYA · ERC-8004

| | |
|---|---|
| **Status** | Informational — positioning + bridge designs, not normative spec text |
| **Created** | 2026-07-02 |
| **Relates to** | [`AAP-spec.md`](AAP-spec.md) §1 (layering), §3 (identity), §5 (discovery), §8 (audit) |

## 0. Stance: bridge, not fortress

By mid-2026 the agent-trust landscape has crowded: **AGNTCY** (Cisco → Linux
Foundation) ships a capability-centric agent directory on OASF; a dozen vendors
compete to define **KYA** ("Know Your Agent") identity verification; and
**ERC-8004** ("Trustless Agents") runs on-chain identity/reputation/validation
registries with six-figure agent registrations. Each occupies one layer AAP
also touches. None of them provides AAP's core: **an escrow-backed transaction
lifecycle with dual-sided, tamper-evident audit and dispute resolution, on
fiat-first rails, self-hostable end to end.**

The strategic consequence: AAP should **interoperate with each of these at the
layer they own**, and stay the layer where the business actually happens.
Every bridge below is additive and optional — a pure-AAP deployment (e.g. an
EU enterprise wanting nothing on-chain) remains fully functional.

## 1. Discovery: AAP manifests ↔ OASF records (AGNTCY ADS)

AGNTCY's Agent Directory Service solves discovery-at-scale — the gap our own
spec acknowledges (§5 is a single registry; federated discovery is future
work). OASF records and AAP manifests describe overlapping things:

| OASF record (v1.0.0) | AAP manifest | Notes |
|---|---|---|
| `name` / `description` / `authors` | `aid` / `description` / (owner via identity cert) | AID carried in `annotations["aap.aid"]` |
| `version` / `schema_version` / `created_at` | `manifest_version` (+ publish timestamp) | |
| `skills` (taxonomy) | `capabilities[].name` | OASF skills are a classification taxonomy; AAP capabilities carry executable contracts |
| `locators` | `endpoints.rpc` | AAP endpoint as a locator entry |
| `modules` (extensions) | **`aap.v1` module** → pricing, SLA, `accepts` (settlement channels), privacy, signed manifest | The commercial fields OASF deliberately does not model |
| record signing (content-addressed, OCI) | JCS + Ed25519 manifest signature | Both sign; formats differ — dual-sign when publishing to both |

**Bridge design (both directions):**

- **Publish out:** an AAP registry (or the SDK) can render a manifest as an
  OASF record whose `aap.v1` module embeds the full signed manifest. AAP
  agents become discoverable in the AGNTCY directory *with* their prices,
  SLAs, and settlement channels attached — the fields a hiring orchestrator
  actually needs and ADS alone doesn't provide.
- **Resolve in:** `HttpRegistry` can gain an ADS backend that accepts any OASF
  record carrying a valid `aap.v1` module (signature verified against the
  embedded manifest, identity certificate resolved per AAP §3).

**Positioning line:** *AGNTCY finds you an agent; AAP lets you safely hire it.*

## 2. Identity: AAP identity certificates ↔ KYA

KYA frameworks (Sumsub, Trulioo, Billions, Visa TAP, Microsoft Entra Agent ID)
converge on three questions. AAP already answers each with a concrete,
verifiable artifact:

| KYA question | AAP artifact |
|---|---|
| **Who is this agent?** (identity) | AID + registry-issued identity certificate (EdDSA JWT, `sub` = AID, `aap.pubkey`), reissued fresh on every read |
| **Who controls it?** (authority) | `aap.owner` (accountable human/org — manifesto principle five), `aap.scopes` incl. spend caps (`agent.spend:100usd/day`), TOFU pubkey pinning |
| **Can it be trusted?** (reputation) | Chain-hashed dual-sided audit trail today; reputation scoring at M7 |

**Bridge design:** AAP's identity certificate is already a KYA-shaped
attestation. Two additive steps make it ecosystem-legible:

1. **Vocabulary alignment** — document the mapping above so KYA-consuming
   merchants/gateways (e.g. bot-defense that admits "verified agents") can
   accept an AAP identity certificate as KYA evidence.
2. **Third-party attestation slot** — KYA vendors verify *owners* (KYC ⊂ KYA).
   Reserve an optional `aap.attestations[]` claim so a registry can embed
   owner-verification attestations from external KYA providers. They become
   certification *suppliers* to AAP registries, not competitors.

DID/VC formalization remains reserved for AAP v1 (§3.3) — the KYA field's
convergence on DID/VC vocabulary is an argument for keeping that slot warm,
not for rushing it: v0.2's mandate carriage already handles W3C VC payloads.

## 3. Reputation: AAP audit chains → ERC-8004 bridge

ERC-8004's Reputation Registry has real network effects (170k+ registered
agents, 150k+ feedback records within months) but a known weakness: feedback
is only as good as its evidence. AAP has exactly the missing evidence — a
signed, dual-sided, hash-chained record of what actually happened, including
settlement. The EIP's off-chain feedback schema **already reserves optional
fields for A2A task identifiers and x402 `proofOfPayment`** — AAP slots in
natively:

**Bridge design (write path, optional, post-`SETTLED`):**

1. The agent registers once in the ERC-8004 Identity Registry; its
   registration file lists `services: [{ "name": "AAP", "endpoint": <manifest URL> }]`
   and `supportedTrust: ["reputation"]`.
2. After a conversation reaches `SETTLED`, the **initiator** (never the
   responder's owner — satisfying the EIP's "feedback submitter MUST NOT be
   the agent owner") may call
   `giveFeedback(agentId, value, valueDecimals, tag1=<capability>, tag2, endpoint, feedbackURI, feedbackHash)`.
3. `feedbackURI` points to a signed off-chain feedback file that embeds the
   AAP evidence: `conversation_id`, both parties' audit-chain head hashes,
   the mandate hashes (v0.2 §6.5), and — for x402-settled calls — the
   settlement tx as `proofOfPayment`.

Anyone can then verify an ERC-8004 feedback entry against the underlying AAP
audit chain: **star ratings backed by cryptographic receipts.** AAP-attested
feedback becomes the highest-evidence tier in that ecosystem, and ERC-8004's
distribution becomes a showcase for AAP conversations.

**Read path (later, M7):** AAP reputation scoring MAY ingest ERC-8004
`getSummary()` signals as one input, weighted below AAP-native evidence.

**Non-goals:** no token (unchanged, ever); the bridge is client-side and
optional; EU/regulated deployments can run reputation entirely off-chain.

## 4. Sequencing

| Bridge | When | Shape |
|---|---|---|
| This document (positioning) | now | done |
| OASF `aap.v1` module spec + ADS resolve backend | with federated-discovery work | additive SDK/registry feature |
| KYA vocabulary mapping (publishable page) + `aap.attestations[]` reservation | M8 (enterprise) or on first merchant-gateway demand | doc + optional claim |
| ERC-8004 feedback writer (SDK helper) | alongside **M7 reputation** — see the M7 re-evaluation memo | small client-side module |

None of these change the wire protocol; all are additive. The order of
magnitude that matters: each bridge converts a potential competitor's network
into distribution for the layer only AAP provides.
