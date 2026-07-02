import { describe, expect, it } from "vitest";
import { Ap2 } from "../src/constants.js";
import {
  CartMandateSchema,
  IntentMandateSchema,
  MandatesBlockSchema,
  PaymentMandateSchema,
} from "../src/mandate.js";

// Concrete AP2 mandate shapes, mirroring the AP2 reference types
// (ap2/types/mandate.py) so we assert wire compatibility with real AP2 peers.

const intent = {
  user_cart_confirmation_required: true,
  natural_language_description: "espresso coffee maker",
  merchants: null, // AP2: list[str] | None — null/omitted = unconstrained
  skus: ["sku_123"],
  requires_refundability: true,
  intent_expiry: "2026-07-12T03:45:42.037Z",
};

// AP2's CartMandate nests the cart body under `contents`.
const cart = {
  contents: {
    id: "cart_3",
    user_cart_confirmation_required: true,
    payment_request: {
      method_data: [{ supported_methods: "CARD", data: { network: ["mastercard", "amex"] } }],
      details: {
        id: "order_3",
        display_items: [
          {
            label: "Espresso machine",
            amount: { currency: "USD", value: "599.99" },
            refund_period: 60,
          },
        ],
        total: { label: "Total", amount: { currency: "USD", value: "603.49" }, refund_period: 30 },
      },
      options: { request_shipping: true },
    },
    cart_expiry: "2026-07-11T04:15:58.088Z",
    merchant_name: "Generic Merchant",
  },
  merchant_authorization: "eyJhbGciOiJSUzI1NiIs...",
};

const payment = {
  payment_mandate_contents: {
    payment_mandate_id: "848f97b287584cd1aa3085bed1985c22",
    payment_details_id: "order_3",
    payment_details_total: { label: "Total", amount: { currency: "USD", value: "603.49" } },
    payment_response: { request_id: "order_3", method_name: "CARD" },
    merchant_agent: "Generic Merchant",
    timestamp: "2026-07-11T03:50:04.532Z",
  },
  user_authorization: "cart_hash_cart_3",
};

describe("AP2 mandate schemas", () => {
  it("accepts a complete IntentMandate (null merchants = unconstrained)", () => {
    expect(IntentMandateSchema.safeParse(intent).success).toBe(true);
  });

  it("accepts an IntentMandate that omits merchants/skus entirely", () => {
    const { merchants: _m, skus: _s, ...without } = intent;
    expect(IntentMandateSchema.safeParse(without).success).toBe(true);
  });

  it("accepts AP2's nested CartMandate ({ contents, merchant_authorization })", () => {
    expect(CartMandateSchema.safeParse(cart).success).toBe(true);
  });

  it("accepts an unsigned cart (merchant_authorization null per AP2)", () => {
    expect(CartMandateSchema.safeParse({ ...cart, merchant_authorization: null }).success).toBe(
      true,
    );
  });

  it("accepts a PaymentMandate with user_authorization", () => {
    expect(PaymentMandateSchema.safeParse(payment).success).toBe(true);
  });

  it("accepts numeric amounts (AP2 reference impl serializes JSON numbers)", () => {
    const numericTotal = {
      ...payment,
      payment_mandate_contents: {
        ...payment.payment_mandate_contents,
        payment_details_total: { label: "Total", amount: { currency: "USD", value: 603.49 } },
      },
    };
    expect(PaymentMandateSchema.safeParse(numericTotal).success).toBe(true);
  });

  it("passes through unmodeled AP2 fields (VC proof) instead of stripping them", () => {
    const withProof = {
      ...intent,
      proof: { type: "DataIntegrityProof", verificationMethod: "did:x#k1", proofValue: "z3s..." },
    };
    const r = IntentMandateSchema.safeParse(withProof);
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).proof).toEqual(withProof.proof);
    }
  });

  it("rejects a CartMandate missing contents", () => {
    const { contents: _omit, ...without } = cart;
    expect(CartMandateSchema.safeParse(without).success).toBe(false);
  });

  it("carries mandates under the AP2 data-part keys", () => {
    const block = {
      [Ap2.MandateKeys.Intent]: intent,
      [Ap2.MandateKeys.Cart]: cart,
    };
    const r = MandatesBlockSchema.safeParse(block);
    expect(r.success).toBe(true);
    expect(Ap2.MandateKeys.Intent).toBe("ap2.mandates.IntentMandate");
  });

  it("allows a partial mandates block (intent only)", () => {
    expect(MandatesBlockSchema.safeParse({ [Ap2.MandateKeys.Intent]: intent }).success).toBe(true);
  });
});
