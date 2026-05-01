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

import {
  AAP_VERSION,
  type ConversationStatus,
  ErrorCodes,
  Methods,
  type RpcErrorResponseEnvelope,
  type RpcRequestEnvelope,
  type RpcSuccessResponseEnvelope,
} from "@agentagora/protocol";
import { makeId, makeTimestamp } from "./_internal/ids.js";
import type { ConversationSnapshot } from "./conversation.js";
import { AAPError } from "./errors.js";
import type { RegistryResolver } from "./registry.js";
import type { SettlementChannel } from "./settlement/index.js";
import { signEnvelope, verifyEnvelope } from "./signing.js";
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
  /**
   * Resolver for verifying signatures on inbound responses.
   * Required for `.call()`. Production code uses a registry-backed
   * resolver; tests use `InMemoryRegistry`.
   */
  registryResolver?: RegistryResolver;
  /** Pluggable transport. Required for `.call()`. */
  transport?: Transport;
  /** AID this client uses as `aap.from` when signing outbound calls. */
  fromAid?: string;
  /** Ed25519 private key used to sign outbound envelopes. */
  signingKey?: Uint8Array;
  /** Stable identifier for the signing key. Required if `signingKey` set. */
  signingKeyId?: string;
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
    if (options.signingKey && !options.signingKeyId) {
      throw new Error("AgentAgoraClient: `signingKeyId` is required when `signingKey` is set");
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
    aid: string,
    capabilityName: string,
    input: Record<string, unknown> = {},
    _options: CallOptions = {},
  ): Promise<T> {
    const transport = this.options.transport;
    const resolver = this.options.registryResolver;
    const signingKey = this.options.signingKey;
    const signingKeyId = this.options.signingKeyId;
    const fromAid = this.options.fromAid;

    if (!transport) {
      throw new Error("AgentAgoraClient.call: `transport` is required");
    }
    if (!resolver) {
      throw new Error("AgentAgoraClient.call: `registryResolver` is required");
    }
    if (!signingKey || !signingKeyId) {
      throw new Error("AgentAgoraClient.call: `signingKey` and `signingKeyId` are required");
    }
    if (!fromAid) {
      throw new Error("AgentAgoraClient.call: `fromAid` is required");
    }

    const conversationId = makeId("conv_");
    const requestId = makeId("req_");

    const request: RpcRequestEnvelope = {
      jsonrpc: "2.0",
      id: requestId,
      method: Methods.Invoke,
      params: { capability: capabilityName, input },
      aap: {
        version: AAP_VERSION,
        conversation_id: conversationId,
        timestamp: makeTimestamp(),
        nonce: makeId(),
        from: fromAid as never,
        to: aid as never,
        signature: { alg: "EdDSA", key_id: signingKeyId, value: "" },
      },
    };

    await signEnvelope(request, { privateKey: signingKey, keyId: signingKeyId });

    const response = await transport.send(request);

    // Verify the response's signature against the responder's public key.
    const responderKey = await resolver.resolvePublicKey(aid);
    const valid = await verifyEnvelope(response, responderKey);
    if (!valid) {
      throw new AAPError(ErrorCodes.Unauthorized, "response signature verification failed");
    }

    if ("error" in response) {
      throw AAPError.fromRpc((response as RpcErrorResponseEnvelope).error);
    }

    return (response as RpcSuccessResponseEnvelope).result as T;
  }

  async callRich(
    _aid: string,
    _capability: string,
    _input: Record<string, unknown>,
    _options?: CallOptions,
  ): Promise<ConversationSnapshot> {
    throw new Error(
      "AgentAgoraClient.callRich — implemented in M1 task #6 (audit-log integration)",
    );
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
