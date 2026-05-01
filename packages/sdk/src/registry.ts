/**
 * Registry resolver — used by SDK-internal code to look up the
 * public key associated with an AID for signature verification.
 *
 * In production, the resolver fetches the agent's identity certificate
 * from the registry endpoint, verifies the JWT against the registry's
 * JWKS, and extracts `aap.pubkey`. That implementation lands in
 * M1 task #7 (real HTTP transport).
 *
 * For tests and mock setups, `InMemoryRegistry` lets you register
 * AIDs to public keys directly.
 */

export interface RegistryResolver {
  /**
   * Return the raw 32-byte Ed25519 public key for a given AID.
   * Throws if the AID is not known to this resolver.
   */
  resolvePublicKey(aid: string): Promise<Uint8Array>;
}

/**
 * Test-only registry resolver backed by an in-process map.
 * Real production code uses `HttpRegistry` (M1 task #7).
 */
export class InMemoryRegistry implements RegistryResolver {
  private readonly keys = new Map<string, Uint8Array>();

  register(aid: string, publicKey: Uint8Array): void {
    this.keys.set(aid, publicKey);
  }

  unregister(aid: string): void {
    this.keys.delete(aid);
  }

  has(aid: string): boolean {
    return this.keys.has(aid);
  }

  async resolvePublicKey(aid: string): Promise<Uint8Array> {
    const key = this.keys.get(aid);
    if (!key) {
      throw new Error(`InMemoryRegistry: no public key registered for ${aid}`);
    }
    return key;
  }
}
