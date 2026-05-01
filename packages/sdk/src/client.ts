/**
 * Top-level client.
 *
 * One AgentAgoraClient per process is the typical pattern. It owns:
 *   - Owner OIDC token
 *   - Agent signing key(s)
 *   - Registry pointer
 *   - Configured settlement channels
 *   - Local audit directory
 */

import type { ConversationStatus } from "@agentagora/protocol";
import type { ConversationSnapshot } from "./conversation.js";
import type { SettlementChannel } from "./settlement/index.js";
import type { Transport } from "./transport.js";

export interface SpendCap {
  dailyUsd?: string;
  monthlyUsd?: string;
}

export interface AgentAgoraClientOptions {
  /** OIDC bearer for the owner. Required. */
  token: string;
  /** Registry base URL. Default: https://agentagora.ai */
  registry?: string;
  /** Pluggable transport. Default: HttpTransport. */
  transport?: Transport;
  /** Pre-configured settlement channels. */
  settlement?: SettlementChannel[];
  /** Local audit directory (Node only; ignored on Workers). */
  auditDir?: string;
  /** Per-call default timeout in milliseconds. */
  timeoutMs?: number;
  spendCap?: SpendCap;
}

export interface CallOptions {
  timeoutMs?: number;
  maxPrice?: string;
  /** Force a specific settlement channel id. */
  channel?: string;
  onProgress?: (progress: { percent: number; message: string }) => void;
}

export class AgentAgoraClient {
  private readonly options: AgentAgoraClientOptions;

  constructor(options: AgentAgoraClientOptions) {
    if (!options.token) {
      throw new Error("AgentAgoraClient: `token` is required");
    }
    this.options = {
      registry: "https://agentagora.ai",
      timeoutMs: 30_000,
      ...options,
    };
  }

  static fromEnv(): AgentAgoraClient {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env;
    const token = env?.AGENTAGORA_TOKEN;
    if (!token) {
      throw new Error("AGENTAGORA_TOKEN is not set; run `agentagora login` or set it explicitly");
    }
    return new AgentAgoraClient({
      token,
      registry: env?.AGENTAGORA_REGISTRY,
      auditDir: env?.AGENTAGORA_AUDIT_DIR,
    });
  }

  get registry(): string {
    return this.options.registry as string;
  }

  // ----- Calling agents -----

  async call<T = unknown>(
    _aid: string,
    _capability: string,
    _input: Record<string, unknown>,
    _options?: CallOptions,
  ): Promise<T> {
    throw new Error("AgentAgoraClient.call — implemented in M1 task #6");
  }

  async callRich(
    _aid: string,
    _capability: string,
    _input: Record<string, unknown>,
    _options?: CallOptions,
  ): Promise<ConversationSnapshot> {
    throw new Error("AgentAgoraClient.callRich — implemented in M1 task #6");
  }

  // ----- Discovery -----

  async resolve(_aid: string): Promise<unknown> {
    throw new Error("AgentAgoraClient.resolve — implemented in M1 task #7");
  }

  // ----- Owner-facing -----

  conversations(_filter?: {
    since?: Date;
    status?: ConversationStatus;
  }): AsyncIterable<ConversationSnapshot> {
    throw new Error("AgentAgoraClient.conversations — implemented in M1 task #6");
  }

  async revoke(_targetAid: string): Promise<void> {
    throw new Error("AgentAgoraClient.revoke — implemented in M1 task #7");
  }

  async revokeAll(): Promise<void> {
    throw new Error("AgentAgoraClient.revokeAll — implemented in M1 task #7");
  }

  // ----- Lifecycle -----

  async close(): Promise<void> {
    return;
  }
}
