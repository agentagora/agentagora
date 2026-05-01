/**
 * Agent definition via factory function (idiomatic TS — no decorators).
 *
 * ```ts
 * import { z } from "zod";
 * import { createAgent, capability } from "@agentagora/sdk";
 *
 * const codeReview = createAgent({
 *   name: "code-review",
 *   namespace: "weijt606",
 *   accepts: ["stripe-fiat"],
 *   capabilities: {
 *     review_pull_request: capability({
 *       input: z.object({ repoUrl: z.string(), prNumber: z.number() }),
 *       output: z.object({ comments: z.array(z.string()) }),
 *       price: { amount: "0.50", currency: "USD" },
 *       handler: async ({ repoUrl, prNumber }) => ({ comments: [] }),
 *     }),
 *   },
 * });
 *
 * await codeReview.serve({ port: 8080 });
 * ```
 */

import {
  AAP_VERSION,
  AuditEventTypes,
  ErrorCodes,
  Methods,
  type Privacy,
  type RpcErrorResponseEnvelope,
  type RpcRequestEnvelope,
  type RpcResponseEnvelope,
  type RpcSuccessResponseEnvelope,
} from "@agentagora/protocol";
import type { z } from "zod";
import { writeEvent } from "./_internal/audit-events.js";
import { makeId, makeTimestamp } from "./_internal/ids.js";
import { AuditLog } from "./audit.js";
import type { RegistryResolver } from "./registry.js";
import { signEnvelope, verifyEnvelope } from "./signing.js";
import type { MockTransport, Transport } from "./transport.js";

export interface CapabilityPrice {
  amount?: string;
  currency?: string;
  /** Defaults to "per_call". Use "free" to omit amount/currency. */
  model?: "per_call" | "per_token" | "negotiated" | "free";
}

export interface CapabilitySLA {
  p50_ms?: number;
  p99_ms?: number;
  success_rate?: number;
}

export interface CapabilityDefinition<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  input: I;
  output: O;
  price?: CapabilityPrice;
  sla?: CapabilitySLA;
  description?: string;
  handler: (input: z.infer<I>) => Promise<z.infer<O>> | z.infer<O>;
}

/**
 * Marker function — declares a capability. Returns the same object
 * unchanged plus a brand for type inference.
 */
export function capability<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: CapabilityDefinition<I, O>,
): CapabilityDefinition<I, O> & { readonly __aap_capability: true } {
  return Object.assign(def, { __aap_capability: true as const });
}

export interface AgentOptions {
  /** Local name segment of the AID (e.g. "code-review"). */
  name: string;
  /** Owner namespace segment of the AID (e.g. "weijt606"). */
  namespace: string;
  /** Registry segment of the AID. Defaults to "agentagora". */
  registry?: string;
  description?: string;
  accepts?: string[];
  privacy?: Partial<Privacy>;
  tags?: string[];
  homepage?: string;
  contact?: string;
  capabilities: Record<string, CapabilityDefinition<z.ZodTypeAny, z.ZodTypeAny>>;
}

export interface ServeOptions {
  /** HTTP host (real-transport mode only). */
  host?: string;
  /** HTTP port (real-transport mode only). */
  port?: number;
  /** Path prefix where AAP routes are mounted. Defaults to "/aap/v1". */
  basePath?: string;
  /**
   * Pluggable transport. Pass a `MockTransport` for in-memory tests.
   * If omitted, the agent starts a real HTTP server (M1 task #7;
   * currently unimplemented).
   */
  transport?: Transport;
  /**
   * Resolver for verifying signatures on inbound envelopes. Required
   * when `transport` is provided.
   */
  registry?: RegistryResolver;
  /** Ed25519 private key the agent uses to sign responses. Required. */
  signingKey?: Uint8Array;
  /**
   * Stable identifier for the signing key (e.g., `"alice/code-review#k1"`).
   * Required.
   */
  signingKeyId?: string;
}

export interface Agent {
  readonly name: string;
  readonly aid: string;
  readonly options: AgentOptions;
  serve(options?: ServeOptions): Promise<void>;
  stop(): Promise<void>;
  /**
   * Internal: handle one inbound request envelope. Exposed for
   * direct in-process invocation by transports and for testing.
   */
  handle(envelope: RpcRequestEnvelope): Promise<RpcResponseEnvelope>;
  /**
   * Look up the (responder-side) audit log for a conversation this
   * agent participated in. Returns undefined if unknown.
   */
  getAuditLog(conversationId: string): AuditLog | undefined;
}

interface ServeContext {
  transport: Transport;
  registry: RegistryResolver;
  signingKey: Uint8Array;
  signingKeyId: string;
}

class AgentImpl implements Agent {
  readonly name: string;
  readonly aid: string;
  readonly options: AgentOptions;
  private context: ServeContext | undefined;
  private readonly auditLogs = new Map<string, AuditLog>();

  constructor(options: AgentOptions) {
    this.name = options.name;
    this.options = options;
    const registry = options.registry ?? "agentagora";
    this.aid = `aid:${registry}:${options.namespace}/${options.name}`;
  }

  getAuditLog(conversationId: string): AuditLog | undefined {
    return this.auditLogs.get(conversationId);
  }

  private logFor(conversationId: string): AuditLog {
    let log = this.auditLogs.get(conversationId);
    if (!log) {
      log = new AuditLog(conversationId);
      this.auditLogs.set(conversationId, log);
    }
    return log;
  }

  async serve(serveOptions: ServeOptions = {}): Promise<void> {
    const { transport, registry, signingKey, signingKeyId } = serveOptions;
    if (transport) {
      if (!registry) {
        throw new Error("Agent.serve: `registry` is required when `transport` is provided");
      }
      if (!signingKey || !signingKeyId) {
        throw new Error("Agent.serve: `signingKey` and `signingKeyId` are required");
      }
      this.context = { transport, registry, signingKey, signingKeyId };
      // If the transport is a MockTransport (or any transport with
      // registerAgent), wire ourselves in.
      const mock = transport as MockTransport;
      if (typeof mock.registerAgent === "function") {
        mock.registerAgent(this.aid, (env) => this.handle(env));
      }
      return;
    }
    throw new Error("Agent.serve: HTTP transport not yet implemented (M1 task #7)");
  }

  async stop(): Promise<void> {
    if (!this.context) return;
    const mock = this.context.transport as MockTransport;
    if (typeof mock.unregisterAgent === "function") {
      mock.unregisterAgent(this.aid);
    }
    this.context = undefined;
  }

  async handle(envelope: RpcRequestEnvelope): Promise<RpcResponseEnvelope> {
    if (!this.context) {
      throw new Error(`agent ${this.aid} is not serving`);
    }
    const { registry, signingKey, signingKeyId } = this.context;

    // 1. Verify caller's signature.
    let senderKey: Uint8Array;
    try {
      senderKey = await registry.resolvePublicKey(envelope.aap.from);
    } catch (e) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.Unauthorized,
        e instanceof Error ? e.message : "unable to resolve sender public key",
      );
    }
    const valid = await verifyEnvelope(envelope, senderKey);
    if (!valid) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.Unauthorized,
        "envelope signature verification failed",
      );
    }

    // 2. Method dispatch. v0.1 only supports aap.invoke directly here;
    //    handshake / progress / acknowledge live in client.callRich (M1 task #6).
    if (envelope.method !== Methods.Invoke) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.InputInvalid,
        `unsupported method: ${envelope.method}`,
      );
    }

    // 3. Locate capability.
    const params = envelope.params as { capability?: string; input?: unknown } | undefined;
    const capName = params?.capability;
    const cap = capName ? this.options.capabilities[capName] : undefined;
    if (!cap) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.InputInvalid,
        `unknown capability: ${capName ?? "(missing)"}`,
      );
    }

    // 4. Validate input.
    const inputResult = cap.input.safeParse(params?.input ?? {});
    if (!inputResult.success) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.InputInvalid,
        "input failed schema validation",
        { issues: inputResult.error.issues },
      );
    }

    // Audit: invocation started.
    const log = this.logFor(envelope.aap.conversation_id);
    await writeEvent(log, {
      type: AuditEventTypes.InvocationStarted,
      actorAid: this.aid,
      privateKey: signingKey,
      keyId: signingKeyId,
      data: { capability: capName, from: envelope.aap.from },
    });

    // 5. Run handler.
    let raw: unknown;
    try {
      raw = await Promise.resolve(cap.handler(inputResult.data));
    } catch (e) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.Internal,
        e instanceof Error ? e.message : String(e),
      );
    }

    // 6. Validate output.
    const outputResult = cap.output.safeParse(raw);
    if (!outputResult.success) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.Internal,
        "handler output failed schema validation",
        { issues: outputResult.error.issues },
      );
    }

    // Audit: invocation completed.
    await writeEvent(log, {
      type: AuditEventTypes.InvocationCompleted,
      actorAid: this.aid,
      privateKey: signingKey,
      keyId: signingKeyId,
      data: { capability: capName },
    });

    // 7. Build & sign success response.
    const response: RpcSuccessResponseEnvelope = {
      jsonrpc: "2.0",
      id: envelope.id,
      result: outputResult.data,
      aap: {
        version: AAP_VERSION,
        conversation_id: envelope.aap.conversation_id,
        timestamp: makeTimestamp(),
        nonce: makeId(),
        from: this.aid as never,
        to: envelope.aap.from,
        signature: { alg: "EdDSA", key_id: signingKeyId, value: "" },
      },
    };
    await signEnvelope(response, { privateKey: signingKey, keyId: signingKeyId });
    return response;
  }

  private async errorResponse(
    request: RpcRequestEnvelope,
    code: number,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<RpcErrorResponseEnvelope> {
    if (!this.context) {
      throw new Error(`agent ${this.aid} is not serving`);
    }
    const { signingKey, signingKeyId } = this.context;
    const response: RpcErrorResponseEnvelope = {
      jsonrpc: "2.0",
      id: request.id,
      error: data ? { code, message, data } : { code, message },
      aap: {
        version: AAP_VERSION,
        conversation_id: request.aap.conversation_id,
        timestamp: makeTimestamp(),
        nonce: makeId(),
        from: this.aid as never,
        to: request.aap.from,
        signature: { alg: "EdDSA", key_id: signingKeyId, value: "" },
      },
    };
    await signEnvelope(response, { privateKey: signingKey, keyId: signingKeyId });
    return response;
  }
}

/**
 * Build an agent from a name, capabilities, and options. Does not
 * start a server — call `.serve()` for that.
 */
export function createAgent(options: AgentOptions): Agent {
  if (Object.keys(options.capabilities).length === 0) {
    throw new Error(`agent ${options.name}: at least one capability is required`);
  }
  return new AgentImpl(options);
}
