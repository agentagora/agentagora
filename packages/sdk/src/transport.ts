/**
 * Transport abstraction.
 *
 * The wire-level transport is pluggable so that:
 *   - Tests can route messages in-memory (MockTransport, in tests/)
 *   - Production uses HTTP (HttpTransport — implemented in M1 task #7)
 *   - Future runtimes can plug in (gRPC, WebSocket, etc.)
 *
 * v0.1 only requires request/response. Streaming progress events
 * use a separate `EventTransport` interface added in M1 task #6.
 */

import type { RpcRequestEnvelope, RpcResponseEnvelope } from "@agentagora/protocol";

export interface Transport {
  /**
   * Send a signed AAP request envelope to the responder identified
   * in `envelope.aap.to` and return the signed response envelope.
   *
   * Resolves the target endpoint internally (via injected resolver
   * or by caller-side resolution before calling).
   */
  send(envelope: RpcRequestEnvelope): Promise<RpcResponseEnvelope>;
}

export class HttpTransport implements Transport {
  private readonly endpointResolver: (toAid: string) => Promise<string>;

  constructor(options: { endpointResolver: (toAid: string) => Promise<string> }) {
    this.endpointResolver = options.endpointResolver;
  }

  async send(_envelope: RpcRequestEnvelope): Promise<RpcResponseEnvelope> {
    throw new Error("HttpTransport.send — implemented in M1 task #7");
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
