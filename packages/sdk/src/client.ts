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
  AuditEventTypes,
  type ConversationStatus,
  ConversationStatuses,
  ErrorCodes,
  Methods,
  type RpcErrorResponseEnvelope,
  type RpcRequestEnvelope,
  type RpcSuccessResponseEnvelope,
} from "@agentagora/protocol";
import { writeEvent } from "./_internal/audit-events.js";
import { makeId, makeTimestamp } from "./_internal/ids.js";
import { AuditLog } from "./audit.js";
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
  private readonly auditLogs = new Map<string, AuditLog>();

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

  /**
   * Call a capability and return the result directly. Throws an
   * AAPError subclass on RPC error or signature failure.
   */
  async call<T = unknown>(
    aid: string,
    capabilityName: string,
    input: Record<string, unknown> = {},
    options: CallOptions = {},
  ): Promise<T> {
    const snapshot = await this.callRich(aid, capabilityName, input, options);
    if (snapshot.error) {
      throw AAPError.fromRpc(snapshot.error);
    }
    return snapshot.result as T;
  }

  /**
   * Call a capability and return a full ConversationSnapshot — result,
   * status, audit log, etc. Does NOT throw on RPC errors; inspect the
   * returned snapshot's `error` field instead. Still throws on
   * signature verification failure (a security-critical condition).
   */
  async callRich(
    aid: string,
    capabilityName: string,
    input: Record<string, unknown> = {},
    _options: CallOptions = {},
  ): Promise<ConversationSnapshot> {
    const transport = this.options.transport;
    const resolver = this.options.registryResolver;
    const signingKey = this.options.signingKey;
    const signingKeyId = this.options.signingKeyId;
    const fromAid = this.options.fromAid;

    if (!transport) throw new Error("AgentAgoraClient.call: `transport` is required");
    if (!resolver) throw new Error("AgentAgoraClient.call: `registryResolver` is required");
    if (!signingKey || !signingKeyId) {
      throw new Error("AgentAgoraClient.call: `signingKey` and `signingKeyId` are required");
    }
    if (!fromAid) throw new Error("AgentAgoraClient.call: `fromAid` is required");

    const conversationId = makeId("conv_");
    const requestId = makeId("req_");
    const log = new AuditLog(conversationId);
    this.auditLogs.set(conversationId, log);
    const startedAt = new Date();

    // Audit: conversation opened.
    await writeEvent(log, {
      type: AuditEventTypes.ConversationOpened,
      actorAid: fromAid,
      privateKey: signingKey,
      keyId: signingKeyId,
      data: { responder: aid, capability: capabilityName },
    });

    // Build, sign, send the request.
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

    // Verify the responder's signature.
    const responderKey = await resolver.resolvePublicKey(aid);
    const valid = await verifyEnvelope(response, responderKey);
    if (!valid) {
      // Hard failure — do not write further audit (we cannot trust
      // anything from the responder in this state).
      throw new AAPError(ErrorCodes.Unauthorized, "response signature verification failed");
    }

    let snapshotError:
      | { code: number; message: string; data?: Record<string, unknown> }
      | undefined;
    let result: unknown;
    let status: ConversationStatus;

    if ("error" in response) {
      const wireErr = (response as RpcErrorResponseEnvelope).error;
      snapshotError = wireErr;
      status = ConversationStatuses.Cancelled;
    } else {
      result = (response as RpcSuccessResponseEnvelope).result;
      status = ConversationStatuses.Archived;
      // Audit: acknowledged. Only on success — failure paths do not
      // emit ack because the initiator hasn't accepted any work.
      await writeEvent(log, {
        type: AuditEventTypes.Acknowledged,
        actorAid: fromAid,
        privateKey: signingKey,
        keyId: signingKeyId,
        data: { responder: aid },
      });
    }

    // Audit: conversation archived (always, regardless of outcome).
    await writeEvent(log, {
      type: AuditEventTypes.ConversationArchived,
      actorAid: fromAid,
      privateKey: signingKey,
      keyId: signingKeyId,
      data: snapshotError ? { status, error: snapshotError } : { status },
    });

    return {
      id: conversationId,
      initiator: fromAid,
      responder: aid,
      capability: capabilityName,
      status,
      startedAt,
      endedAt: new Date(),
      priceAmount: undefined,
      currency: undefined,
      channel: undefined,
      result,
      error: snapshotError,
      audit: log,
    };
  }

  /** Look up the local (initiator-side) audit log for a conversation. */
  getAuditLog(conversationId: string): AuditLog | undefined {
    return this.auditLogs.get(conversationId);
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
