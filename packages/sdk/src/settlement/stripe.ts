/**
 * Stripe Connect settlement channel.
 *
 * Wraps the official `stripe` SDK to fulfil the SettlementChannel
 * contract: escrow funds via a manual-capture PaymentIntent, capture
 * on completion, refund on dispute or cancellation, and surface
 * status on demand.
 *
 * Workers / Deno / browser compatibility: Stripe ships an explicit
 * `createFetchHttpClient()` for runtimes without a Node HTTP module.
 * Production code on edge runtimes should pass that as `httpClient`.
 *
 * Status of integration: this channel is fully implemented and
 * unit-tested against a mocked Stripe instance. Wiring it into the
 * automatic call/handle pipeline (so `client.call()` actually goes
 * through escrow/capture) is a separate task tracked in M2.
 */

import type Stripe from "stripe";
import type { EscrowHandle, EscrowState, EscrowStatus, SettlementChannel } from "./index.js";

/**
 * Subset of the Stripe SDK surface the channel actually uses.
 * Tests inject a minimal mock conforming to this; production passes
 * a real `Stripe` instance.
 */
export interface StripeLike {
  paymentIntents: {
    create(params: Stripe.PaymentIntentCreateParams): Promise<Stripe.PaymentIntent>;
    capture(id: string, params?: Stripe.PaymentIntentCaptureParams): Promise<Stripe.PaymentIntent>;
    retrieve(id: string): Promise<Stripe.PaymentIntent>;
  };
  refunds: {
    create(params: Stripe.RefundCreateParams): Promise<Stripe.Refund>;
  };
}

export interface StripeChannelOptions {
  /**
   * Default Connect account id to receive payouts. Used as the
   * `transfer_data.destination` on PaymentIntents when set.
   */
  defaultPayeeAccount?: string;
  /** Default currency for new escrows. ISO 4217. */
  currency?: string;
  /**
   * Platform fee in basis points. 500 = 5%. Default 500.
   * Charged via `application_fee_amount` on the PaymentIntent.
   */
  platformFeeBasisPoints?: number;
}

const DEFAULT_FEE_BP = 500;

export class StripeChannel implements SettlementChannel {
  readonly id = "stripe-fiat";
  private readonly stripe: StripeLike;
  private readonly defaultCurrency: string;
  private readonly defaultPayeeAccount: string | undefined;
  private readonly platformFeeBp: number;

  constructor(stripe: StripeLike, options: StripeChannelOptions = {}) {
    this.stripe = stripe;
    this.defaultCurrency = (options.currency ?? "USD").toLowerCase();
    this.defaultPayeeAccount = options.defaultPayeeAccount;
    this.platformFeeBp = options.platformFeeBasisPoints ?? DEFAULT_FEE_BP;
  }

  async escrow(args: {
    payerAid: string;
    payeeAid: string;
    amount: string;
    currency: string;
    conversationId: string;
  }): Promise<EscrowHandle> {
    const cents = decimalToCents(args.amount);
    const fee = Math.floor((cents * this.platformFeeBp) / 10000);
    const currency = args.currency.toLowerCase();

    const params: Stripe.PaymentIntentCreateParams = {
      amount: cents,
      currency,
      capture_method: "manual",
      metadata: {
        aap_conversation_id: args.conversationId,
        aap_payer_aid: args.payerAid,
        aap_payee_aid: args.payeeAid,
      },
    };
    if (fee > 0) params.application_fee_amount = fee;
    if (this.defaultPayeeAccount) {
      params.transfer_data = { destination: this.defaultPayeeAccount };
    }

    const intent = await this.stripe.paymentIntents.create(params);

    return {
      channelId: this.id,
      escrowId: intent.id,
      payerAid: args.payerAid,
      payeeAid: args.payeeAid,
      amount: args.amount,
      currency: args.currency,
      conversationId: args.conversationId,
      metadata: {
        clientSecret: intent.client_secret ?? undefined,
        status: intent.status,
      },
    };
  }

  async capture(escrow: EscrowHandle, split?: Record<string, string>): Promise<string> {
    if (split) {
      // Partial capture is supported by Stripe via amount_to_capture;
      // honoring split semantics would require resolving multi-party
      // payouts which we don't model in v0.1. Reject for now.
      throw new Error("StripeChannel.capture: split is not supported in v0.1");
    }
    const captured = await this.stripe.paymentIntents.capture(escrow.escrowId);
    const charge = captured.latest_charge;
    return typeof charge === "string" ? charge : (charge?.id ?? captured.id);
  }

  async refund(escrow: EscrowHandle, amount?: string): Promise<string> {
    const params: Stripe.RefundCreateParams = {
      payment_intent: escrow.escrowId,
    };
    if (amount !== undefined) {
      params.amount = decimalToCents(amount);
    }
    const refund = await this.stripe.refunds.create(params);
    return refund.id;
  }

  async status(escrow: EscrowHandle): Promise<EscrowStatus> {
    const intent = await this.stripe.paymentIntents.retrieve(escrow.escrowId);
    return {
      state: mapStripeState(intent.status),
      amount: centsToDecimal(intent.amount),
      currency: intent.currency.toUpperCase(),
      lastEventAt: new Date(intent.created * 1000).toISOString(),
    };
  }
}

/**
 * Construct a `StripeChannel` backed by a real `Stripe` SDK
 * instance. Lives on `StripeChannel` for ergonomics.
 *
 * Pass `httpClient: Stripe.createFetchHttpClient()` (from
 * `import Stripe from "stripe"`) when running on Cloudflare Workers,
 * Deno, or any non-Node runtime.
 */
export interface StripeChannelFromKeyOptions extends StripeChannelOptions {
  stripeKey: string;
  apiVersion?: string;
  httpClient?: Stripe.HttpClient;
}

export async function createStripeChannelFromKey(
  options: StripeChannelFromKeyOptions,
): Promise<StripeChannel> {
  const { default: StripeCtor } = await import("stripe");
  const stripeInstance = new StripeCtor(options.stripeKey, {
    apiVersion: options.apiVersion as Stripe.LatestApiVersion | undefined,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
  return new StripeChannel(stripeInstance as unknown as StripeLike, options);
}

/**
 * Best-effort env-driven constructor. Reads STRIPE_SECRET_KEY,
 * STRIPE_CONNECT_ACCOUNT, STRIPE_CURRENCY. Returns undefined if no
 * key is configured.
 */
export async function stripeChannelFromEnv(): Promise<StripeChannel | undefined> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const key = env?.STRIPE_SECRET_KEY;
  if (!key) return undefined;
  return createStripeChannelFromKey({
    stripeKey: key,
    defaultPayeeAccount: env?.STRIPE_CONNECT_ACCOUNT,
    currency: env?.STRIPE_CURRENCY,
  });
}

// ----- internal helpers -----

function decimalToCents(decimal: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(decimal)) {
    throw new Error(`StripeChannel: invalid decimal amount ${JSON.stringify(decimal)}`);
  }
  const [whole, frac = ""] = decimal.split(".");
  const fracPadded = `${frac}00`.slice(0, 2);
  return Number.parseInt(whole as string, 10) * 100 + Number.parseInt(fracPadded, 10);
}

function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

function mapStripeState(status: Stripe.PaymentIntent.Status): EscrowState {
  switch (status) {
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
    case "processing":
      return "frozen";
    case "requires_capture":
      return "funded";
    case "succeeded":
      return "captured";
    case "canceled":
      return "refunded";
    default:
      return "frozen";
  }
}
