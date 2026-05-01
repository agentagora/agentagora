/**
 * Helpers for generating envelope identifiers and timestamps.
 *
 * Uses Web Standard APIs only (`crypto.getRandomValues`,
 * `Date.toISOString`), so this works on Node, Bun, Deno, and
 * Cloudflare Workers without polyfills.
 */

import { b64uEncode } from "../signing.js";

/** Generate a short random identifier (≈ 16 base64url characters). */
export function makeId(prefix = ""): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return prefix + b64uEncode(bytes);
}

/** Current timestamp in the wire format (ISO 8601, .mmmZ). */
export function makeTimestamp(): string {
  return new Date().toISOString();
}
