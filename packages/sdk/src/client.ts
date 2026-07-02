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
  type MandatesBlock,
  Methods,
  type RpcErrorResponseEnvelope,
  type RpcRequestEnvelope,
  type RpcSuccessResponseEnvelope,
} from "@agentagora/protocol";
import { writeEvent } from "./_internal/audit-events.js";
import { makeId, makeTimestamp } from "./_internal/ids.js";
import { AuditLog, mandateHashes } from "./audit.js";
import type { ConversationSnapshot } from "./conversation.js";
import { AAPError, CallRefundedError } from "./errors.js";
import type { RegistryResolver } from "./registry.js";
import type { EscrowHandle, SettlementChannel } from "./settlement/index.js";
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
  /**
   * If set, escrow funds via a configured SettlementChannel before
   * invoking. On a successful response, capture is called; on failure,
   * a refund is issued. Either way, audit events
   * (`aap.escrow.funded` / `.captured` / `.refunded`) are written.
   */
  pay?: {
    amount: string;
    currency: string;
    /**
     * Restrict to a specific channel id (e.g., "stripe-fiat").
     * If omitted, the first configured SettlementChannel is used.
     */
    channel?: string;
  };
  onProgress?: (progress: { percent: number; message: string }) => void;
  /**
   * Optional AP2 mandates (v0.2) carried as the payment-authorization
   * payload. Attached to `params.mandates`; their canonical hashes are
   * recorded in the audit chain (intent/cart on conversation open, payment
   * on escrow funding) so a verifier can prove which mandate authorized
   * which step. The responder validates them and binds the hashes into its
   * own audit log. See AAP-spec §6.5.
   */
  mandates?: MandatesBlock;
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
      // Paid call that returned an RPC error — escrow has already been
      // refunded inside callRich(). Surface the refund metadata so the
      // caller sees auto_refund happened without inspecting the audit
      // log.
      const refundData = extractRefundContext(snapshot);
      if (refundData) {
        throw new CallRefundedError({
          cause: AAPError.fromRpc(snapshot.error),
          escrowId: refundData.escrowId,
          channelId: refundData.channelId,
          refundTxId: refundData.refundTxId,
          refundError: refundData.refundError,
        });
      }
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
    options: CallOptions = {},
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

    // Resolve settlement channel (optional — only when options.pay set).
    let channel: SettlementChannel | undefined;
    if (options.pay) {
      const wantedId = options.pay.channel;
      const candidates = this.options.settlement ?? [];
      channel = wantedId ? candidates.find((c) => c.id === wantedId) : candidates[0];
      if (!channel) {
        throw new Error(
          `AgentAgoraClient.call: options.pay set but no SettlementChannel configured${
            wantedId ? ` matching id ${JSON.stringify(wantedId)}` : ""
          }`,
        );
      }
    }

    const conversationId = makeId("conv_");
    const requestId = makeId("req_");
    const log = new AuditLog(conversationId);
    this.auditLogs.set(conversationId, log);
    const startedAt = new Date();

    // Audit: conversation opened. Bind ALL mandate hashes here so every
    // mandate the initiator sends is bound into its chain regardless of
    // whether escrow is used (a PaymentMandate without options.pay — e.g.
    // escrow-less settlement — must still be provable/repudiable later).
    const hashes = mandateHashes(options.mandates);
    await writeEvent(log, {
      type: AuditEventTypes.ConversationOpened,
      actorAid: fromAid,
      privateKey: signingKey,
      keyId: signingKeyId,
      data: {
        responder: aid,
        capability: capabilityName,
        ...hashes,
      },
    });

    // Optional escrow funding — happens before invoke.
    let escrowHandle: EscrowHandle | undefined;
    if (channel && options.pay) {
      escrowHandle = await channel.escrow({
        payerAid: fromAid,
        payeeAid: aid,
        amount: options.pay.amount,
        currency: options.pay.currency,
        conversationId,
      });
      await writeEvent(log, {
        type: AuditEventTypes.EscrowFunded,
        actorAid: fromAid,
        privateKey: signingKey,
        keyId: signingKeyId,
        data: {
          channelId: channel.id,
          escrowId: escrowHandle.escrowId,
          amount: options.pay.amount,
          currency: options.pay.currency,
          ...(hashes.payment_mandate_hash
            ? { payment_mandate_hash: hashes.payment_mandate_hash }
            : {}),
        },
      });
    }

    // From this point forward, any thrown error must trigger a refund
    // if escrow has been funded. Wrap the rest of the flow in a guard
    // that consults `escrowSettled` so we never double-refund (RPC-error
    // path refunds explicitly inside the try; transport / signature /
    // unexpected throws refund in the catch).
    let escrowSettled = false;
    try {
      // Build, sign, send the request.
      const request: RpcRequestEnvelope = {
        jsonrpc: "2.0",
        id: requestId,
        method: Methods.Invoke,
        params: {
          capability: capabilityName,
          input,
          ...(options.mandates ? { mandates: options.mandates } : {}),
        },
        aap: {
          // Emit the lowest wire version the message needs: plain invokes
          // stay "0.1" so unupgraded peers (whose validators pin the version
          // literal) keep accepting our traffic; only mandate-bearing
          // requests are stamped with the v0.2 wire version they require.
          version: options.mandates ? AAP_VERSION : "0.1",
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
        // anything from the responder in this state). The catch below
        // refunds and re-throws.
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

      // Settle the escrow based on outcome.
      let snapshotRefund: RefundContext | undefined;
      if (channel && escrowHandle) {
        if (snapshotError) {
          snapshotRefund = await refundEscrow(
            channel,
            escrowHandle,
            log,
            fromAid,
            signingKey,
            signingKeyId,
          );
          escrowSettled = true;
        } else {
          const captureTxId = await channel.capture(escrowHandle);
          escrowSettled = true;
          // Once captured, the conversation is settled, not just archived.
          status = ConversationStatuses.Settled;
          await writeEvent(log, {
            type: AuditEventTypes.EscrowCaptured,
            actorAid: fromAid,
            privateKey: signingKey,
            keyId: signingKeyId,
            data: {
              channelId: channel.id,
              escrowId: escrowHandle.escrowId,
              captureTxId,
            },
          });
        }
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
        priceAmount: options.pay?.amount,
        currency: options.pay?.currency,
        channel: channel?.id,
        result,
        error: snapshotError,
        audit: log,
        ...(snapshotRefund ? { refund: refundContextToSnapshot(snapshotRefund) } : {}),
      } as ConversationSnapshot;
    } catch (err) {
      // Pre-RPC-result failure: transport blew up, response signature
      // didn't verify, or any unexpected throw between escrow.funded
      // and capture/refund. We still owe the payer their money.
      if (channel && escrowHandle && !escrowSettled) {
        const refund = await refundEscrow(
          channel,
          escrowHandle,
          log,
          fromAid,
          signingKey,
          signingKeyId,
        );
        escrowSettled = true;
        const cause = err instanceof Error ? err : new Error(String(err));
        throw new CallRefundedError({
          cause,
          escrowId: escrowHandle.escrowId,
          channelId: channel.id,
          refundTxId: refund.refundTxId,
          refundError: refund.refundError,
        });
      }
      throw err;
    }
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

interface RefundContext {
  readonly channelId: string;
  readonly escrowId: string;
  readonly refundTxId: string | undefined;
  readonly refundError: Error | undefined;
}

/**
 * Issue a refund against a funded escrow and append the matching
 * audit event. Idempotence is the caller's responsibility — they
 * gate this behind their own "already settled?" flag.
 *
 * If the refund call itself throws, we log it, attach the failure
 * to the returned context, and emit the audit event with
 * `refundError` so disputes can see the platform tried.
 *
 * Never re-throws — the original call error must win.
 */
async function refundEscrow(
  channel: SettlementChannel,
  escrow: EscrowHandle,
  log: AuditLog,
  actorAid: string,
  privateKey: Uint8Array,
  keyId: string,
): Promise<RefundContext> {
  let refundTxId: string | undefined;
  let refundError: Error | undefined;
  try {
    refundTxId = await channel.refund(escrow);
  } catch (err) {
    refundError = err instanceof Error ? err : new Error(String(err));
    console.error(
      "[AgentAgoraClient] auto-refund failed",
      { channelId: channel.id, escrowId: escrow.escrowId },
      refundError,
    );
  }
  await writeEvent(log, {
    type: AuditEventTypes.EscrowRefunded,
    actorAid,
    privateKey,
    keyId,
    data: {
      channelId: channel.id,
      escrowId: escrow.escrowId,
      ...(refundTxId !== undefined ? { refundTxId } : {}),
      ...(refundError !== undefined ? { refundError: refundError.message } : {}),
    },
  });
  return {
    channelId: channel.id,
    escrowId: escrow.escrowId,
    refundTxId,
    refundError,
  };
}

function extractRefundContext(snapshot: ConversationSnapshot): RefundContext | undefined {
  const r = snapshot.refund;
  if (!r) return undefined;
  return {
    channelId: r.channelId,
    escrowId: r.escrowId,
    refundTxId: r.refundTxId,
    refundError: r.refundError ? new Error(r.refundError) : undefined,
  };
}

function refundContextToSnapshot(ctx: RefundContext): {
  channelId: string;
  escrowId: string;
  refundTxId: string | undefined;
  refundError: string | undefined;
} {
  return {
    channelId: ctx.channelId,
    escrowId: ctx.escrowId,
    refundTxId: ctx.refundTxId,
    refundError: ctx.refundError?.message,
  };
}
