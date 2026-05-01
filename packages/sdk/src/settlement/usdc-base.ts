/**
 * USDC on Base settlement channel.
 *
 * Skeleton — full implementation lands in M5 (per PRD §10).
 *
 * Will use `viem` for chain interaction. Escrow funds are locked in
 * the AgentAgora escrow contract; release requires either both
 * parties' signatures or a Council resolution.
 */

import type { EscrowHandle, EscrowStatus, SettlementChannel } from "./index.js";

export interface UsdcBaseChannelOptions {
  /** RPC endpoint URL. */
  rpcUrl: string;
  /**
   * Wallet private key (hex). Held in memory only; never logged.
   * In production, prefer a signer abstraction over a raw key.
   */
  walletPrivateKey: string;
  /** AgentAgora escrow contract address on Base. */
  escrowContract: string;
}

export class UsdcBaseChannel implements SettlementChannel {
  readonly id = "usdc-base";
  private readonly options: UsdcBaseChannelOptions;

  constructor(options: UsdcBaseChannelOptions) {
    this.options = options;
  }

  async escrow(_args: {
    payerAid: string;
    payeeAid: string;
    amount: string;
    currency: string;
    conversationId: string;
  }): Promise<EscrowHandle> {
    throw new Error("UsdcBaseChannel.escrow — implemented in M5");
  }

  async capture(_escrow: EscrowHandle, _split?: Record<string, string>): Promise<string> {
    throw new Error("UsdcBaseChannel.capture — implemented in M5");
  }

  async refund(_escrow: EscrowHandle, _amount?: string): Promise<string> {
    throw new Error("UsdcBaseChannel.refund — implemented in M5");
  }

  async status(_escrow: EscrowHandle): Promise<EscrowStatus> {
    throw new Error("UsdcBaseChannel.status — implemented in M5");
  }
}
