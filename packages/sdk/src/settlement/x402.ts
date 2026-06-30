/**
 * x402 settlement channel — AP2 onchain stablecoin rail (USDC on Base).
 *
 * Skeleton — full implementation lands alongside the M5 onchain work.
 *
 * x402 has no native escrow: it is a pull on an HTTP 402 challenge. To honor
 * AAP's `SettlementChannel` contract (escrow/capture/refund/status) we keep
 * escrow as an AAP construct — funds are held in the AgentAgora escrow
 * contract (shared with `usdc-base`) and x402 is the capture/settlement rail.
 *
 * The authorizing `PaymentMandate` (AP2) hash is recorded against the escrow
 * so a verifier can prove which mandate authorized which capture. See
 * `docs/AAP-spec-ap2-binding.md` §5.
 */

import type { EscrowHandle, EscrowStatus, SettlementChannel } from "./index.js";

export interface X402ChannelOptions {
  /** RPC endpoint URL (Base). */
  rpcUrl: string;
  /**
   * Wallet private key (hex). Held in memory only; never logged.
   * In production, prefer a signer abstraction over a raw key.
   */
  walletPrivateKey: string;
  /** AgentAgora escrow contract address on Base. */
  escrowContract: string;
  /**
   * Run escrow-less: authorize via PaymentMandate and pull on completion,
   * skipping the escrow contract. Trades AAP's escrow guarantee for
   * x402-native simplicity — recommended only for low-value `per_call`
   * capabilities under a configured threshold. Defaults to escrow-backed.
   */
  escrowless?: boolean;
}

export class X402Channel implements SettlementChannel {
  readonly id = "x402";
  private readonly options: X402ChannelOptions;

  constructor(options: X402ChannelOptions) {
    this.options = options;
  }

  async escrow(_args: {
    payerAid: string;
    payeeAid: string;
    amount: string;
    currency: string;
    conversationId: string;
  }): Promise<EscrowHandle> {
    throw new Error("X402Channel.escrow — onchain implementation pending (M5)");
  }

  async capture(_escrow: EscrowHandle, _split?: Record<string, string>): Promise<string> {
    throw new Error("X402Channel.capture — onchain implementation pending (M5)");
  }

  async refund(_escrow: EscrowHandle, _amount?: string): Promise<string> {
    throw new Error("X402Channel.refund — onchain implementation pending (M5)");
  }

  async status(_escrow: EscrowHandle): Promise<EscrowStatus> {
    throw new Error("X402Channel.status — onchain implementation pending (M5)");
  }
}
