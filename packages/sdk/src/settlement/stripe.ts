/**
 * Stripe Connect settlement channel.
 *
 * Skeleton — full implementation lands in M2 task #10.
 */

import type { EscrowHandle, EscrowStatus, SettlementChannel } from "./index.js";

export interface StripeChannelOptions {
  /** Stripe secret key (live or test). NEVER log this. */
  stripeKey: string;
  /** Stripe Connect account id (for receiving payouts). */
  connectAccount?: string;
  /** Default currency for new escrows. */
  currency?: string;
}

export class StripeChannel implements SettlementChannel {
  readonly id = "stripe-fiat";
  private readonly options: StripeChannelOptions;

  constructor(options: StripeChannelOptions) {
    this.options = options;
  }

  static fromEnv(): StripeChannel | undefined {
    const key = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env?.STRIPE_SECRET_KEY;
    if (!key) return undefined;
    return new StripeChannel({
      stripeKey: key,
      connectAccount: (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.STRIPE_CONNECT_ACCOUNT,
    });
  }

  async escrow(_args: {
    payerAid: string;
    payeeAid: string;
    amount: string;
    currency: string;
    conversationId: string;
  }): Promise<EscrowHandle> {
    throw new Error("StripeChannel.escrow — implemented in M2 task #10");
  }

  async capture(_escrow: EscrowHandle, _split?: Record<string, string>): Promise<string> {
    throw new Error("StripeChannel.capture — implemented in M2 task #10");
  }

  async refund(_escrow: EscrowHandle, _amount?: string): Promise<string> {
    throw new Error("StripeChannel.refund — implemented in M2 task #10");
  }

  async status(_escrow: EscrowHandle): Promise<EscrowStatus> {
    throw new Error("StripeChannel.status — implemented in M2 task #10");
  }
}
