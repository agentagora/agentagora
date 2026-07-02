/**
 * AP2 (Agent Payments Protocol) mandate carriage — AAP v0.2.
 *
 * AAP does not fork AP2. It carries AP2's three signed Mandates
 * (Intent / Cart / Payment) verbatim as the payment-authorization payload,
 * so an AP2-native counterparty interoperates. Shapes mirror AP2's reference
 * types (`ap2/types/mandate.py`), and every object schema is `.passthrough()`
 * so fields we don't model (a VC `proof` block, `risk_data`, future AP2
 * additions) survive validation untouched — "verbatim" means the parsed
 * object is the wire object.
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
 * A monetary amount, as used in AP2's W3C Payment Request data model. The
 * W3C spec types `value` as a decimal **string** (e.g. "603.49") and AAP
 * recommends strings (envelope canonicalization rejects floats), but AP2's
 * reference implementation serializes JSON numbers — accept both so genuine
 * AP2 traffic validates. Number-valued amounts hash fine (`hashMandate` is
 * float-tolerant) but can only ride an AAP envelope when integral.
 */
export const AmountSchema = z
  .object({
    currency: z.string(), // ISO 4217, e.g. "USD"
    value: z.union([z.string(), z.number()]), // decimal string preferred
  })
  .passthrough();
export type Amount = z.infer<typeof AmountSchema>;

/**
 * W3C Verifiable Credential `proof` block carried by a mandate. AAP treats
 * this as opaque and independently verifiable — it is NOT the AAP envelope
 * signature. `type`/`cryptosuite` are free strings so AP2's ES256 proofs and
 * any AAP-internal EdDSA VC proofs both validate structurally.
 */
export const VcProofSchema = z
  .object({
    type: z.string(), // e.g. "DataIntegrityProof"
    cryptosuite: z.string().optional(), // e.g. "ecdsa-rdfc-2019"
    created: z.string().optional(), // ISO 8601
    verificationMethod: z.string(),
    proofValue: z.string(),
  })
  .passthrough();
export type VcProof = z.infer<typeof VcProofSchema>;

/**
 * IntentMandate — what the user authorized the agent to purchase. Created by
 * the requesting (shopping) agent, confirmed by the user. Carried on
 * `aap.handshake`. `merchants`/`skus` are nullable and omissible per AP2
 * (`list[str] | None = None`) — absent/null means unconstrained.
 */
export const IntentMandateSchema = z
  .object({
    user_cart_confirmation_required: z.boolean(),
    natural_language_description: z.string(),
    /** Merchant allow-list; null/omitted = unconstrained. */
    merchants: z.array(z.string()).nullable().optional(),
    /** SKU constraints; null/omitted = unconstrained. */
    skus: z.array(z.string()).nullable().optional(),
    requires_refundability: z.boolean(),
    intent_expiry: z.string(), // ISO 8601
  })
  .passthrough();
export type IntentMandate = z.infer<typeof IntentMandateSchema>;

/**
 * A `{label, amount, refund_period?}` item, mirroring the W3C Payment
 * Request display item. Also the shape of `details.total` and
 * `payment_details_total`.
 */
export const DisplayItemSchema = z
  .object({
    label: z.string(),
    amount: AmountSchema,
    refund_period: z.number().optional(), // days
  })
  .passthrough();
export type DisplayItem = z.infer<typeof DisplayItemSchema>;

/** W3C Payment Request API shape, as embedded by AP2's CartContents. */
export const PaymentRequestSchema = z
  .object({
    method_data: z.array(
      z
        .object({
          supported_methods: z.string(), // e.g. "CARD"
          data: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    ),
    details: z
      .object({
        id: z.string(),
        display_items: z.array(DisplayItemSchema),
        total: DisplayItemSchema,
      })
      .passthrough(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** The merchant-signed cart body, nested under CartMandate.contents per AP2. */
export const CartContentsSchema = z
  .object({
    id: z.string(),
    user_cart_confirmation_required: z.boolean(),
    payment_request: PaymentRequestSchema,
    cart_expiry: z.string(), // ISO 8601
    merchant_name: z.string(),
  })
  .passthrough();
export type CartContents = z.infer<typeof CartContentsSchema>;

/**
 * CartMandate — a merchant-signed cart binding SKU-level pricing, payment
 * options, and expiry. Mirrors AP2's wire shape: the cart fields nest under
 * `contents`, with the merchant's JWT/VC proof alongside (nullable before
 * the merchant signs). AAP binding: `contents.payment_request.details.total`
 * MUST equal the escrowed amount (§5 Q4).
 */
export const CartMandateSchema = z
  .object({
    contents: CartContentsSchema,
    /** Merchant's JWT/VC proof over the cart; null until signed. */
    merchant_authorization: z.string().nullable().optional(),
  })
  .passthrough();
export type CartMandate = z.infer<typeof CartMandateSchema>;

/**
 * PaymentMandate — the payer's authorization to capture, binding the chosen
 * payment method to a cart hash. Gates `capture()`. Carried on
 * `aap.authorize` (or `aap.invoke` params).
 */
export const PaymentMandateSchema = z
  .object({
    payment_mandate_contents: z
      .object({
        payment_mandate_id: z.string(),
        payment_details_id: z.string(),
        payment_details_total: DisplayItemSchema,
        payment_response: z.unknown(),
        merchant_agent: z.string(),
        timestamp: z.string(), // ISO 8601
      })
      .passthrough(),
    /** Cart-hash-bound user proof. */
    user_authorization: z.string(),
  })
  .passthrough();
export type PaymentMandate = z.infer<typeof PaymentMandateSchema>;

/**
 * The optional `mandates` block carried in the `params` of settlement-bearing
 * AAP methods. Keys mirror AP2's A2A data-part convention
 * (`ap2.mandates.<Type>`) so a single message is legible to both stacks.
 *
 * NOTE FOR IMPLEMENTERS: validate with this schema, but hash/audit-bind the
 * ORIGINAL wire object, never the parsed copy — both parties must bind the
 * same bytes. (The schemas are passthrough, but re-serialization order and
 * defaults are not guaranteed to round-trip.)
 */
export const MandatesBlockSchema = z
  .object({
    "ap2.mandates.IntentMandate": IntentMandateSchema.optional(),
    "ap2.mandates.CartMandate": CartMandateSchema.optional(),
    "ap2.mandates.PaymentMandate": PaymentMandateSchema.optional(),
  })
  .passthrough()
  .partial();
export type MandatesBlock = z.infer<typeof MandatesBlockSchema>;
