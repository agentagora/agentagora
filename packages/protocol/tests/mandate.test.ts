import { describe, expect, it } from "vitest";
import { Ap2 } from "../src/constants.js";
import {
  CartMandateSchema,
  IntentMandateSchema,
  MandatesBlockSchema,
  PaymentMandateSchema,
} from "../src/mandate.js";

// Concrete AP2 mandate shapes, mirroring the reference demo logs so we assert
// byte-compatibility with the AP2 wire (field names verbatim).

const intent = {
  user_cart_confirmation_required: true,
  natural_language_description: "espresso coffee maker",
  merchants: [],
  skus: [],
  requires_refundability: true,
  intent_expiry: "2026-07-12T03:45:42.037Z",
};

const cart = {
  id: "cart_3",
  user_cart_confirmation_required: true,
  payment_request: {
    method_data: [{ supported_methods: "CARD", data: { network: ["mastercard", "amex"] } }],
    details: {
      id: "order_3",
      display_items: [
        {
          label: "Espresso machine",
          amount: { currency: "USD", value: 599.99 },
          refund_period: 60,
        },
      ],
      total: { label: "Total", amount: { currency: "USD", value: 603.49 }, refund_period: 30 },
    },
    options: { request_shipping: true },
  },
  cart_expiry: "2026-07-11T04:15:58.088Z",
  merchant_name: "Generic Merchant",
  merchant_authorization: "eyJhbGciOiJSUzI1NiIs...",
};

const payment = {
  payment_mandate_contents: {
    payment_mandate_id: "848f97b287584cd1aa3085bed1985c22",
    payment_details_id: "order_3",
    payment_details_total: { label: "Total", amount: { currency: "USD", value: 603.49 } },
    payment_response: { request_id: "order_3", method_name: "CARD" },
    merchant_agent: "Generic Merchant",
    timestamp: "2026-07-11T03:50:04.532Z",
  },
  user_authorization: "cart_hash_cart_3",
};

describe("AP2 mandate schemas", () => {
  it("accepts a complete IntentMandate", () => {
    expect(IntentMandateSchema.safeParse(intent).success).toBe(true);
  });

  it("accepts a merchant-signed CartMandate with a W3C payment_request", () => {
    expect(CartMandateSchema.safeParse(cart).success).toBe(true);
  });

  it("accepts a PaymentMandate with user_authorization", () => {
    expect(PaymentMandateSchema.safeParse(payment).success).toBe(true);
  });

  it("rejects a CartMandate missing merchant_authorization", () => {
    const { merchant_authorization: _omit, ...without } = cart;
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
