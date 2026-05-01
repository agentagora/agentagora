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
