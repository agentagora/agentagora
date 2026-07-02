/**
 * Agent definition via factory function (idiomatic TS — no decorators).
 *
 * ```ts
 * import { z } from "zod";
 * import { createAgent, capability } from "@agentagora/sdk";
 *
 * const codeReview = createAgent({
 *   name: "code-review",
 *   namespace: "acme",
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
  AuditEventTypes,
  ErrorCodes,
  type MandatesBlock,
  MandatesBlockSchema,
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
import { AuditLog, mandateHashes } from "./audit.js";
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
  /** Owner namespace segment of the AID (e.g. "acme"). */
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
  /**
   * Pluggable transport. If a `MockTransport` is provided, the agent
   * registers itself as the handler for in-memory routing.
   *
   * If omitted, the agent enters "configured but not actively
   * listening" mode — wire up an HTTP server yourself by passing
   * `agent.fetchHandler()` to your runtime's HTTP server (e.g.
   * `@hono/node-server`'s `serve`, `Bun.serve`, `Deno.serve`, or
   * Cloudflare Workers' `export default { fetch: ... }`).
   */
  transport?: Transport;
  /**
   * Resolver for verifying signatures on inbound envelopes. Always
   * required.
   */
  registry?: RegistryResolver;
  /** Ed25519 private key the agent uses to sign responses. Required. */
  signingKey?: Uint8Array;
  /**
   * Stable identifier for the signing key (e.g., `"alice/code-review#k1"`).
   * Required.
   */
  signingKeyId?: string;
  /**
   * Replay-protection tracker. Defaults to a per-isolate
   * `InMemoryNonceTracker`. Pass a `CloudNonceTracker` (or any
   * implementation) to dedup nonces across Worker isolates and
   * cold restarts.
   */
  nonceTracker?: NonceTracker;
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
  /**
   * IDs of every conversation this agent has an audit log for — the
   * enumeration a periodic audit sync (CloudAuditSink) iterates over.
   */
  listConversations(): string[];
  /**
   * Returns a Web-standard fetch handler that this agent can be served
   * behind on any runtime that accepts one (Node via @hono/node-server,
   * Bun, Deno, Cloudflare Workers).
   */
  fetchHandler(): (request: Request) => Promise<Response>;
}

interface ServeContext {
  transport: Transport;
  registry: RegistryResolver;
  signingKey: Uint8Array;
  signingKeyId: string;
}

/** Sentinel transport used when an agent is configured for HTTP-only
 *  inbound (no outbound transport needed on the agent side). */
const noOpTransport: Transport = {
  async send() {
    throw new Error("Agent transport is not configured for outbound calls");
  },
};

/** Per AAP-spec §11.1 — receivers MUST reject envelopes outside this window. */
const TIMESTAMP_PAST_TOLERANCE_MS = 5 * 60_000; // 5 minutes
const TIMESTAMP_FUTURE_TOLERANCE_MS = 30_000; // 30 seconds

/**
 * Replay-protection contract — receivers consult the tracker for
 * each inbound envelope. Returns true on first sighting, false on
 * replay. Async so a `CloudNonceTracker` (KV-backed via cloud-api)
 * can replace the in-process variant for multi-isolate deployments.
 */
export interface NonceTracker {
  check(envelope: RpcRequestEnvelope, nowMs: number): Promise<boolean>;
}

/** Per AAP-spec §11.1 — nonce uniqueness is enforced per (conversation_id, from).
 *  Old entries are pruned beyond TIMESTAMP_PAST_TOLERANCE_MS so memory stays bounded. */
export class InMemoryNonceTracker implements NonceTracker {
  private seen = new Map<string, number>();

  async check(envelope: RpcRequestEnvelope, nowMs: number): Promise<boolean> {
    this.prune(nowMs);
    const key = `${envelope.aap.conversation_id}\x00${envelope.aap.from}\x00${envelope.aap.nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, nowMs);
    return true;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - TIMESTAMP_PAST_TOLERANCE_MS;
    for (const [k, t] of this.seen) {
      if (t < cutoff) this.seen.delete(k);
    }
  }

  /** Test-only: reset state. Not exposed publicly. */
  _reset(): void {
    this.seen.clear();
  }
}

class AgentImpl implements Agent {
  readonly name: string;
  readonly aid: string;
  readonly options: AgentOptions;
  private context: ServeContext | undefined;
  private readonly auditLogs = new Map<string, AuditLog>();
  private nonceTracker: NonceTracker = new InMemoryNonceTracker();

  constructor(options: AgentOptions) {
    this.name = options.name;
    this.options = options;
    const registry = options.registry ?? "agentagora";
    this.aid = `aid:${registry}:${options.namespace}/${options.name}`;
  }

  getAuditLog(conversationId: string): AuditLog | undefined {
    return this.auditLogs.get(conversationId);
  }

  listConversations(): string[] {
    return [...this.auditLogs.keys()];
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
    const { transport, registry, signingKey, signingKeyId, nonceTracker } = serveOptions;
    if (!registry) {
      throw new Error("Agent.serve: `registry` is required");
    }
    if (!signingKey || !signingKeyId) {
      throw new Error("Agent.serve: `signingKey` and `signingKeyId` are required");
    }
    if (nonceTracker) this.nonceTracker = nonceTracker;
    this.context = {
      transport: transport ?? noOpTransport,
      registry,
      signingKey,
      signingKeyId,
    };
    if (transport) {
      const mock = transport as MockTransport;
      if (typeof mock.registerAgent === "function") {
        mock.registerAgent(this.aid, (env) => this.handle(env));
      }
    }
  }

  /**
   * Returns a Web-standard fetch handler that this agent can be
   * served behind on any runtime: Node (`@hono/node-server`'s
   * `serve`), Bun (`Bun.serve`), Deno (`Deno.serve`), Cloudflare
   * Workers (`export default { fetch: ... }`).
   *
   * The handler accepts POST requests with a JSON-encoded
   * `RpcRequestEnvelope` body and returns a JSON `RpcResponseEnvelope`.
   */
  fetchHandler(): (request: Request) => Promise<Response> {
    if (!this.context) {
      throw new Error(`agent ${this.aid} is not serving — call serve() first`);
    }
    const handle = (env: RpcRequestEnvelope) => this.handle(env);
    return async (request: Request): Promise<Response> => {
      if (request.method === "GET") {
        // Liveness ping for ops; no AAP semantics.
        return Response.json({ aid: this.aid, ok: true });
      }
      if (request.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      let envelope: RpcRequestEnvelope;
      try {
        envelope = (await request.json()) as RpcRequestEnvelope;
      } catch {
        return new Response("invalid JSON body", { status: 400 });
      }
      const response = await handle(envelope);
      return Response.json(response);
    };
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

    // 0a. Timestamp window enforcement (spec §11.1).
    const nowMs = Date.now();
    const tsMs = Date.parse(envelope.aap.timestamp);
    if (Number.isNaN(tsMs)) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.Unauthorized,
        "invalid envelope timestamp",
      );
    }
    if (tsMs < nowMs - TIMESTAMP_PAST_TOLERANCE_MS) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.Unauthorized,
        `envelope timestamp too old (more than ${TIMESTAMP_PAST_TOLERANCE_MS / 1000}s in the past)`,
      );
    }
    if (tsMs > nowMs + TIMESTAMP_FUTURE_TOLERANCE_MS) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.Unauthorized,
        `envelope timestamp too far in the future (more than ${TIMESTAMP_FUTURE_TOLERANCE_MS / 1000}s)`,
      );
    }

    // 0b. Nonce uniqueness enforcement (spec §11.1).
    if (!(await this.nonceTracker.check(envelope, nowMs))) {
      return await this.errorResponse(
        envelope,
        ErrorCodes.Unauthorized,
        "nonce already seen for this conversation_id + sender (replay rejected)",
      );
    }

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
    const params = envelope.params as
      | { capability?: string; input?: unknown; mandates?: unknown }
      | undefined;
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

    // 4b. Validate AP2 mandates if carried (v0.2). Malformed mandates are a
    //     client error; their proofs (typically ES256) are verified separately
    //     from the EdDSA envelope signature — see AAP-spec §6.5.
    //     IMPORTANT: validate against the schema but hash the ORIGINAL wire
    //     object — Zod parsing re-shapes the copy, and both parties must bind
    //     the same bytes the initiator hashed.
    let mandateHashData: Record<string, string> = {};
    if (params?.mandates !== undefined) {
      const parsed = MandatesBlockSchema.safeParse(params.mandates);
      if (!parsed.success) {
        return await this.errorResponse(
          envelope,
          ErrorCodes.InputInvalid,
          "mandates failed schema validation",
          { issues: parsed.error.issues },
        );
      }
      try {
        mandateHashData = mandateHashes(params.mandates as MandatesBlock);
      } catch (e) {
        // Unhashable mandate content (e.g. unsupported value types) is a
        // client error, not a server crash.
        return await this.errorResponse(
          envelope,
          ErrorCodes.InputInvalid,
          `mandates could not be canonicalized: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Audit: invocation started. Bind any mandate hashes into the chain.
    const log = this.logFor(envelope.aap.conversation_id);
    await writeEvent(log, {
      type: AuditEventTypes.InvocationStarted,
      actorAid: this.aid,
      privateKey: signingKey,
      keyId: signingKeyId,
      data: { capability: capName, from: envelope.aap.from, ...mandateHashData },
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

    // 7. Build & sign success response. Echo the requester's wire version so
    //    a v0.1 peer never receives an envelope its validators reject.
    const response: RpcSuccessResponseEnvelope = {
      jsonrpc: "2.0",
      id: envelope.id,
      result: outputResult.data,
      aap: {
        version: envelope.aap.version,
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
        // Echo the requester's wire version (v0.1 peers reject "0.2").
        version: request.aap.version,
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
