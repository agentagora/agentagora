/**
 * AP2 (Agent Payments Protocol) mandate carriage — AAP v0.2.
 *
 * AAP does not fork AP2. It carries AP2's three signed Mandates
 * (Intent / Cart / Payment) verbatim as the payment-authorization payload,
 * so an AP2-native counterparty interoperates. Field names mirror AP2
 * exactly to keep the wire byte-compatible.
 *
 * Each mandate is a W3C Verifiable Credential signed by its issuing party
 * (typically ES256 over JSON-LD). That proof is verified INDEPENDENTLY of
 * the EdDSA AAP envelope signature — the two sit at different layers and do
 * not conflict. A verifier MUST check both: the envelope signature and each
 * contained mandate's proof.
 *
 * See `docs/AAP-spec-ap2-binding.md` for the full binding and rationale.
 */

import { z } from "zod";

/**
 * A monetary amount, as used in AP2's W3C Payment Request data model. Per the
 * W3C Payment Request spec, `value` is a **decimal string** (e.g. "603.49"),
 * not a float — which also matches AAP's "decimals as strings" convention and
 * keeps mandates float-free so they ride inside a signed AAP envelope.
 */
export const AmountSchema = z.object({
  currency: z.string(), // ISO 4217, e.g. "USD"
  value: z.string(), // decimal string, e.g. "603.49"
});
export type Amount = z.infer<typeof AmountSchema>;

/**
 * W3C Verifiable Credential `proof` block carried by a mandate. AAP treats
 * this as opaque and independently verifiable — it is NOT the AAP envelope
 * signature. `type`/`cryptosuite` are free strings so AP2's ES256 proofs and
 * any AAP-internal EdDSA VC proofs both validate structurally.
 */
export const VcProofSchema = z.object({
  type: z.string(), // e.g. "DataIntegrityProof"
  cryptosuite: z.string().optional(), // e.g. "ecdsa-rdfc-2019"
  created: z.string().optional(), // ISO 8601
  verificationMethod: z.string(),
  proofValue: z.string(),
});
export type VcProof = z.infer<typeof VcProofSchema>;

/**
 * IntentMandate — what the user authorized the agent to purchase. Created by
 * the requesting (shopping) agent, confirmed by the user. Carried on
 * `aap.handshake`.
 */
export const IntentMandateSchema = z.object({
  user_cart_confirmation_required: z.boolean(),
  natural_language_description: z.string(),
  /** Merchant allow-list; empty = unconstrained. */
  merchants: z.array(z.string()),
  /** SKU constraints; empty = unconstrained. */
  skus: z.array(z.string()),
  requires_refundability: z.boolean(),
  intent_expiry: z.string(), // ISO 8601
});
export type IntentMandate = z.infer<typeof IntentMandateSchema>;

/** A line item in a cart, mirroring the W3C Payment Request display item. */
export const DisplayItemSchema = z.object({
  label: z.string(),
  amount: AmountSchema,
  refund_period: z.number().optional(), // days
});

/** W3C Payment Request API shape, as embedded by AP2's CartMandate. */
export const PaymentRequestSchema = z.object({
  method_data: z.array(
    z.object({
      supported_methods: z.string(), // e.g. "CARD"
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  details: z.object({
    id: z.string(),
    display_items: z.array(DisplayItemSchema),
    total: z.object({
      label: z.string(),
      amount: AmountSchema,
      refund_period: z.number().optional(),
    }),
  }),
  options: z.record(z.string(), z.unknown()).optional(),
});

/**
 * CartMandate — a merchant-signed cart binding SKU-level pricing, payment
 * options, and expiry. The responder signs `merchant_authorization`. AAP
 * binding: `details.total.amount` MUST equal the escrowed amount (§5 Q4).
 */
export const CartMandateSchema = z.object({
  id: z.string(),
  user_cart_confirmation_required: z.boolean(),
  payment_request: PaymentRequestSchema,
  shipping_address: z.record(z.string(), z.unknown()).optional(),
  cart_expiry: z.string(), // ISO 8601
  merchant_name: z.string(),
  /** Merchant's JWT/VC proof over the cart. */
  merchant_authorization: z.string(),
});
export type CartMandate = z.infer<typeof CartMandateSchema>;

/**
 * PaymentMandate — the payer's authorization to capture, binding the chosen
 * payment method to a cart hash. Gates `capture()`. Carried on
 * `aap.authorize` (or `aap.invoke` params).
 */
export const PaymentMandateSchema = z.object({
  payment_mandate_contents: z.object({
    payment_mandate_id: z.string(),
    payment_details_id: z.string(),
    payment_details_total: z.object({
      label: z.string(),
      amount: AmountSchema,
      refund_period: z.number().optional(),
    }),
    payment_response: z.unknown(),
    merchant_agent: z.string(),
    timestamp: z.string(), // ISO 8601
  }),
  /** Cart-hash-bound user proof. */
  user_authorization: z.string(),
});
export type PaymentMandate = z.infer<typeof PaymentMandateSchema>;

/**
 * The optional `mandates` block carried in the `params` of settlement-bearing
 * AAP methods. Keys mirror AP2's A2A data-part convention
 * (`ap2.mandates.<Type>`) so a single message is legible to both stacks.
 */
export const MandatesBlockSchema = z
  .object({
    "ap2.mandates.IntentMandate": IntentMandateSchema.optional(),
    "ap2.mandates.CartMandate": CartMandateSchema.optional(),
    "ap2.mandates.PaymentMandate": PaymentMandateSchema.optional(),
  })
  .partial();
export type MandatesBlock = z.infer<typeof MandatesBlockSchema>;
