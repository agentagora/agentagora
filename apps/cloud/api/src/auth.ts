/**
 * Owner authentication for write endpoints.
 *
 * Closed-alpha shape: pre-issued bearer tokens map to owner IDs.
 * The interface is deliberately minimal so the static implementation
 * can be swapped for a real OIDC verifier (task #4) without touching
 * route code.
 *
 * Production tokens come from the OWNER_TOKENS Worker secret in the
 * format "<ownerId>:<token>,<ownerId>:<token>,...". Tokens are
 * compared with constant-time equality to avoid timing leaks.
 */

export interface OwnerAuthenticator {
  /** Returns the owner ID if the token is recognised, undefined otherwise. */
  resolve(token: string): Promise<string | undefined>;
}

/**
 * In-memory implementation backed by a static token→owner map.
 * Used by closed-alpha deploys (env-loaded) and by tests.
 */
export class StaticOwnerAuth implements OwnerAuthenticator {
  private readonly tokenToOwner: Map<string, string>;

  constructor(tokenToOwner: Map<string, string> | Record<string, string>) {
    this.tokenToOwner =
      tokenToOwner instanceof Map ? tokenToOwner : new Map(Object.entries(tokenToOwner));
  }

  async resolve(token: string): Promise<string | undefined> {
    for (const [knownToken, owner] of this.tokenToOwner) {
      if (constantTimeEqual(token, knownToken)) return owner;
    }
    return undefined;
  }

  /** Whether any tokens are configured. False ⇒ no one can publish. */
  get hasAnyTokens(): boolean {
    return this.tokenToOwner.size > 0;
  }
}

/**
 * Parse an OWNER_TOKENS env string into a token→owner map.
 *
 *   "alice:tok-A1,bob:tok-B2"  →  { tok-A1: alice, tok-B2: bob }
 *
 * Whitespace is trimmed, empty entries are skipped. Malformed pairs
 * (no colon, empty owner, empty token) are silently dropped — startup
 * is not the place to throw.
 */
export function parseOwnerTokens(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0 || idx === trimmed.length - 1) continue;
    const owner = trimmed.slice(0, idx).trim();
    const token = trimmed.slice(idx + 1).trim();
    if (owner && token) out.set(token, owner);
  }
  return out;
}

/**
 * Constant-time string comparison. Both inputs are coerced to UTF-8
 * bytes; differing lengths still walk the longer string to keep the
 * timing flat.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}
