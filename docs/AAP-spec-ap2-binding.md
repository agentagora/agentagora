# AAP ⇄ AP2 Mandate Binding (proposal)

| | |
|---|---|
| **Status** | Accepted — folded into [`AAP-spec.md`](AAP-spec.md) v0.2 (2026-06-30) |
| **Targets** | AAP v0.2 (additive over frozen v0.1) |
| **Author** | weijt606 |
| **Created** | 2026-06-29 |
| **Supersedes** | nothing; extends [`AAP-spec.md`](AAP-spec.md) §9 (Settlement), §8 (Audit), §6 (Wire) |

> The normative summary lives in `AAP-spec.md` (§6.3, §6.5, §9.6); this document is the **full
> binding** — data model, rationale, and the open design choices behind those clauses. The type
> sketch in §7 is implemented in `packages/protocol/src/mandate.ts`. See
> [`protocol-stewardship.md`](protocol-stewardship.md) for the versioning rules.

## 1. Why

In September 2025 Google launched the **Agent Payments Protocol (AP2)** — an open standard for
agent-initiated payments built on three signed **Mandates** (Intent / Cart / Payment) carried as
**W3C Verifiable Credentials**, riding over A2A, with an **x402** extension for onchain stablecoin
settlement. By April 2026 AP2 has 60+ partners (Mastercard, PayPal, Coinbase, Amex) and x402 is the
de-facto onchain settlement rail (USDC on Base/Solana).

AP2 lands squarely on AAP's **Settlement layer** (§9). Rather than maintain a parallel, bespoke
payment vocabulary that the market will route around, AAP adopts AP2 Mandates as its
**payment-authorization payload** and x402 as a first-class **stablecoin settlement channel**.

What AAP keeps as its own (and AP2 does **not** provide):

- **AID identity + EdDSA envelope signing** (§3, §6) — AP2 is silent on agent identity issuance.
- **Escrow-backed conversation FSM** (§7) — AP2/x402 is authorize-then-pull; it has no escrow,
  capture-split, or dispute-driven partial refund. AAP's escrow is a *stronger* guarantee and stays
  the differentiator.
- **Chain-hashed audit trail** (§8) — AAP threads mandate hashes into its tamper-evident event chain.

> **Design stance:** AAP is the *trust + escrow + audit* envelope; AP2 Mandates are the
> *authorization evidence* that flows inside it; x402 is *one* settlement rail underneath.
> AAP does not fork AP2 — it carries it verbatim so an AP2-native counterparty interoperates.

## 2. Concept mapping

| AAP concept (v0.1) | AP2 / x402 equivalent | Binding |
|---|---|---|
| Capability `pricing` + handshake channel proposal | `IntentMandate` | Initiator's intent (budget, refundability, expiry) expressed as an `IntentMandate` attached to `aap.handshake`. |
| `ACCEPTED` → escrow amount/currency | `CartMandate` | Responder-signed cart fixes the amount AAP escrows. `cart.total` MUST equal the escrowed amount. |
| `EscrowFunded` / capture authorization | `PaymentMandate` | Payer-authorized payment method + cart hash; gates `capture()`. |
| `usdc-base` channel (§9.3, reserved M5) | **x402** | Reimplement the stablecoin channel as x402-conformant (see §5). |
| Audit event `previous_event_hash` chain (§8) | — (AP2 has none) | Each mandate's canonical hash is recorded in the corresponding audit event. |
| Dispute/Council partial refund (§10) | — (AP2 has none) | Unchanged. Mandates are evidence the Council reads; resolution still emits signed AAP events. |

## 3. The signature-suite question (resolved: nesting, not conversion)

AAP envelopes sign with **EdDSA / Ed25519** (`envelope.ts` `SignatureSchema` pins `alg: "EdDSA"`).
AP2 Mandates sign with **ECDSA P-256 (ES256)** over JSON-LD VCs.

These do **not** conflict because they sit at different layers:

- The **AAP envelope** keeps its EdDSA signature over the JCS-canonicalized envelope — unchanged.
- Each **embedded Mandate** carries its *own* VC `proof` (ES256, or whatever the issuing party's rail
  requires). AAP treats the mandate as an opaque, independently-verifiable credential.

So `SignatureSchema` stays as-is. We add a `Mandate` type whose `proof` is verified by a *separate*
verifier keyed on the mandate issuer's published key — not the AAP envelope key. A verifier MUST
check both: (a) the envelope EdDSA signature, and (b) each contained mandate's VC proof.

## 4. Wire carriage

AP2 rides A2A by attaching mandates as `data` parts keyed `ap2.mandates.<Type>` with an
`X-A2A-Extensions: https://github.com/google-agentic-commerce/ap2/v1` header. AAP mirrors this so a
single message is legible to both stacks:

1. **Within AAP params.** Settlement-bearing methods gain an optional `mandates` block in `params`:

   ```jsonc
   {
     "jsonrpc": "2.0", "id": 1, "method": "aap.handshake",
     "params": {
       "channel": "x402",
       "mandates": {
         "ap2.mandates.IntentMandate": { /* VC with ES256 proof */ }
       }
     },
     "aap": { "version": "0.2", "conversation_id": "...", "signature": { "alg": "EdDSA", ... } }
   }
   ```

2. **Header parity.** When AAP runs over an A2A transport, implementations SHOULD also emit the
   `X-A2A-Extensions` AP2 header and the parallel `data` part, so AP2-only middleboxes see it.

**Amounts are decimal strings.** Per the W3C Payment Request spec, `amount.value` is a decimal
**string** (e.g. `"603.49"`), not a float. This matches AAP's "decimals as strings" convention and —
critically — keeps mandates **float-free**, so a mandate rides unchanged inside a signed AAP envelope
(whose JCS canonicalization rejects floats by policy to avoid cross-runtime precision drift).

Mandate-to-method binding:

| Method | Mandate carried |
|---|---|
| `aap.handshake` | `IntentMandate` (initiator) |
| `aap.handshake` (response) | `CartMandate` (responder, signs the cart) |
| new: `aap.authorize` *or* `aap.invoke` params | `PaymentMandate` (payer authorizes capture) |

## 5. New settlement channel: `x402`

Add `x402` to the canonical channel registry alongside `stripe-fiat` and `usdc-base`.

```
SettlementChannels = { StripeFiat: "stripe-fiat", UsdcBase: "usdc-base", X402: "x402" }
```

x402 has **no native escrow** — it is a pull on HTTP 402 challenge. To honor AAP's
`SettlementChannel` interface (`escrow/capture/refund/status`) we wrap it:

| AAP op | x402 realization |
|---|---|
| `escrow()` | Lock funds in the AAP escrow contract (same contract as `usdc-base`); record the `PaymentMandate` hash. **Escrow stays an AAP construct** — x402 is the *capture* rail, not the *hold* rail. |
| `capture()` | Settle to payee via x402 (USDC on Base), less platform fee; `split` supported by N transfers. |
| `refund()` | Onchain return from escrow contract. |
| `status()` | Onchain escrow state + last tx. |

> **Open design choice (§8 Q1):** alternatively run *escrow-less* x402 for low-value / high-trust
> capabilities — authorize via `PaymentMandate`, pull on completion, skip the contract. This trades
> AAP's escrow guarantee for x402-native simplicity. Recommend: escrow by default, escrow-less only
> for `pricing.model: per_call` under a configurable threshold.

## 6. Audit integration

Each mandate exchange emits an audit event (§8) whose payload includes the mandate's JCS hash, so the
chain-hashed trail remains the single source of truth and a verifier can prove *which* mandate
authorized *which* capture:

```
aap.handshake.accepted   → { intent_mandate_hash, cart_mandate_hash }
aap.escrow.funded        → { payment_mandate_hash }
aap.escrow.captured      → { payment_mandate_hash, settlement_tx }
```

No new event *types* needed; the existing `AuditEventTypes` gain mandate-hash fields in their payloads.

## 7. Type sketch (for `packages/protocol/`, on acceptance)

New file `packages/protocol/src/mandate.ts` (Zod, no runtime deps — boundary-test clean). AP2 field
names verbatim so the wire is byte-compatible:

```ts
// W3C VC envelope carrying an AP2 mandate; proof verified independently of the AAP envelope.
export const VcProofSchema = z.object({
  type: z.string(),            // e.g. "DataIntegrityProof"
  cryptosuite: z.string(),     // e.g. "ecdsa-rdfc-2019"
  created: z.string(),
  verificationMethod: z.string(),
  proofValue: z.string(),
});

export const IntentMandateSchema = z.object({
  user_cart_confirmation_required: z.boolean(),
  natural_language_description: z.string(),
  merchants: z.array(z.string()),
  skus: z.array(z.string()),
  requires_refundability: z.boolean(),
  intent_expiry: z.string(),   // ISO 8601
});

export const CartMandateSchema = z.object({
  id: z.string(),
  user_cart_confirmation_required: z.boolean(),
  payment_request: PaymentRequestSchema, // W3C Payment Request API shape: method_data, details, options
  cart_expiry: z.string(),
  merchant_name: z.string(),
  merchant_authorization: z.string(),    // merchant JWT/VC proof
});

export const PaymentMandateSchema = z.object({
  payment_mandate_contents: z.object({
    payment_mandate_id: z.string(),
    payment_details_id: z.string(),
    payment_details_total: AmountSchema,
    payment_response: z.unknown(),
    merchant_agent: z.string(),
    timestamp: z.string(),
  }),
  user_authorization: z.string(),        // cart-hash-bound user proof
});
```

## 8. Open questions

1. **Escrow vs. escrow-less x402** (§5) — default to escrow; allow escrow-less under a threshold?
2. **VC proof suite** — accept any ES256 VC proof, or also issue AAP's own EdDSA VC proofs so an
   all-AAP conversation can stay single-suite? Leaning: accept ES256 (AP2 parity) + allow EdDSA VC
   proofs as an AAP-internal optimization.
3. **`aap.authorize` method** — add a dedicated method for `PaymentMandate`, or fold it into
   `aap.invoke` params? New method is cleaner for the FSM but is a wire addition.
4. **Cart binding** — MUST `cart.total` exactly equal the escrow amount, or allow tolerance for
   onchain gas? Recommend exact-match + gas paid by payer outside the cart.

## 9. Non-goals

- Replacing AAP's FSM, escrow, audit chain, or AID identity. AP2 is carried, not adopted wholesale.
- Implementing AP2's optional `risk_data` JWT fan-out (deferred; AAP's reputation layer is M7).
- DID-based identity — still deferred to v1 per §3.3 (2026 landscape confirms DIDs remain
  research-grade; the deferral is validated).

## 10. References

- AP2 spec & mandate types — https://ap2-protocol.org/specification/
- AP2 illustrated guide (concrete mandate JSON) — https://arthurchiao.art/blog/ap2-illustrated-guide/
- A2A x402 extension — https://github.com/google-agentic-commerce/ap2
- x402 onchain settlement — https://www.coinbase.com/developer-platform/discover/launches/google_x402
