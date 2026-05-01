/**
 * Settlement Channel abstraction and built-in implementations.
 *
 * The protocol package defines the canonical channel IDs
 * (`stripe-fiat`, `usdc-base`). This module provides:
 *   - The `SettlementChannel` interface
 *   - StripeChannel (stub; M2)
 *   - UsdcBaseChannel (stub; M5)
 *
 * Settlement specifics never leak into protocol code. Adding a new
 * channel is additive.
 */

export type EscrowState = "funded" | "captured" | "refunded" | "frozen";

export interface EscrowHandle {
  readonly channelId: string;
  readonly escrowId: string;
  readonly payerAid: string;
  readonly payeeAid: string;
  readonly amount: string; // decimal string
  readonly currency: string;
  readonly conversationId: string;
  readonly metadata?: Record<string, unknown>;
}

export interface EscrowStatus {
  readonly state: EscrowState;
  readonly amount: string;
  readonly currency: string;
  readonly lastEventAt: string; // ISO 8601
}

export interface SettlementChannel {
  readonly id: string;
  escrow(args: {
    payerAid: string;
    payeeAid: string;
    amount: string;
    currency: string;
    conversationId: string;
  }): Promise<EscrowHandle>;
  capture(escrow: EscrowHandle, split?: Record<string, string>): Promise<string>;
  refund(escrow: EscrowHandle, amount?: string): Promise<string>;
  status(escrow: EscrowHandle): Promise<EscrowStatus>;
}

export {
  type StripeChannelFromKeyOptions,
  type StripeChannelOptions,
  type StripeLike,
  StripeChannel,
  createStripeChannelFromKey,
  stripeChannelFromEnv,
} from "./stripe.js";
export { UsdcBaseChannel } from "./usdc-base.js";
