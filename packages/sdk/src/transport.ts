/**
 * Transport abstraction.
 *
 * The wire-level transport is pluggable so that:
 *   - Tests and demos route messages in-memory via MockTransport
 *   - Production uses HttpTransport over fetch
 *   - Future runtimes can plug in (gRPC, WebSocket, etc.)
 *
 * v0.1 only requires request/response. Streaming progress events
 * use a separate `EventTransport` interface added in a later task.
 */

import type { RpcRequestEnvelope, RpcResponseEnvelope } from "@agentagora/protocol";

export interface Transport {
  /**
   * Send a signed AAP request envelope to the responder identified
   * in `envelope.aap.to` and return the signed response envelope.
   *
   * The responder is resolved internally (via an injected resolver
   * or by caller-side resolution before calling).
   */
  send(envelope: RpcRequestEnvelope): Promise<RpcResponseEnvelope>;
}

/**
 * Resolves an AID to a network endpoint URL. For HttpTransport,
 * this controls where outbound calls are addressed.
 *
 * In production, an HTTP-based resolver fetches the agent's manifest
 * from the registry and returns its `endpoints.rpc`. For tests and
 * demos, `StaticEndpointResolver` lets you wire endpoints directly.
 */
export interface EndpointResolver {
  resolveEndpoint(aid: string): Promise<string>;
}

/** Test- and demo-only resolver backed by a static map. */
export class StaticEndpointResolver implements EndpointResolver {
  private readonly endpoints: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.endpoints = new Map(Object.entries(initial));
  }

  set(aid: string, url: string): void {
    this.endpoints.set(aid, url);
  }

  async resolveEndpoint(aid: string): Promise<string> {
    const url = this.endpoints.get(aid);
    if (!url) {
      throw new Error(`StaticEndpointResolver: no endpoint registered for ${aid}`);
    }
    return url;
  }
}

export interface HttpTransportOptions {
  endpointResolver: EndpointResolver;
  /** Optional fetch override for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
}

/**
 * Production transport. Delivers envelopes over HTTPS via the
 * Web-standard `fetch` API (works on Node, Bun, Deno, Cloudflare
 * Workers, and any runtime with a global `fetch`).
 */
export class HttpTransport implements Transport {
  private readonly resolver: EndpointResolver;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpTransportOptions) {
    this.resolver = options.endpointResolver;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async send(envelope: RpcRequestEnvelope): Promise<RpcResponseEnvelope> {
    const url = await this.resolver.resolveEndpoint(envelope.aap.to);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(
        `HttpTransport.send: HTTP ${response.status} ${response.statusText} from ${url}`,
      );
    }
    return (await response.json()) as RpcResponseEnvelope;
  }
}

/**
 * Handler signature used by MockTransport: an in-process function
 * that takes a request envelope and returns a response envelope.
 */
export type AgentHandler = (envelope: RpcRequestEnvelope) => Promise<RpcResponseEnvelope>;

/**
 * In-memory transport for tests and demos. Routes envelopes to
 * handlers registered for `envelope.aap.to`.
 *
 * Lets two agents owned by separate clients exchange messages without
 * any HTTP, while still exercising the full sign / verify / dispatch
 * pipeline.
 */
export class MockTransport implements Transport {
  private readonly handlers = new Map<string, AgentHandler>();

  registerAgent(aid: string, handler: AgentHandler): void {
    this.handlers.set(aid, handler);
  }

  unregisterAgent(aid: string): void {
    this.handlers.delete(aid);
  }

  hasAgent(aid: string): boolean {
    return this.handlers.has(aid);
  }

  async send(envelope: RpcRequestEnvelope): Promise<RpcResponseEnvelope> {
    const target = envelope.aap.to;
    const handler = this.handlers.get(target);
    if (!handler) {
      throw new Error(`MockTransport: no handler registered for ${target}`);
    }
    return handler(envelope);
  }
}
