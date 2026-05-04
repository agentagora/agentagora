/**
 * Request-ID correlation for cloud-api.
 *
 * Each request gets a stable id surfaced as the `X-Request-Id` response
 * header and (for error bodies) the top-level `request_id` field. The
 * id is also stashed on the Hono context via `c.set("requestId", id)`
 * so route handlers can fold it into log lines without re-minting.
 *
 * Format: `req_` + 16 random bytes encoded as base64url (~22 chars), so
 * a complete id looks like `req_a1b2c3d4e5f6g7h8i9j0k1`. This matches
 * the legacy `newRequestId()` helpers in routes/connect.ts and
 * routes/stripe-webhook.ts (which now delegate here).
 *
 * Inbound `X-Request-Id` is preserved when present and well-formed —
 * a load balancer or operator probe can pin a value of their choosing
 * (e.g. `req_curl_<…>` for ad-hoc traces) so long as it matches
 * `^[A-Za-z0-9_-]{8,64}$`. Malformed ids are silently replaced; we
 * never echo arbitrary client input back into the response header.
 *
 * Workers-compatible: uses Web Crypto only (`crypto.getRandomValues`).
 * No `crypto.randomUUID()` — works in both Workers and Node.
 */

import type { MiddlewareHandler } from "hono";

/** Prefix used by `newRequestId()`. Exported for test assertions. */
export const REQUEST_ID_PREFIX = "req_";

/** Allowed shape for an inbound `X-Request-Id`. Tight enough to keep
 *  log greps clean, loose enough to accept whatever upstream LBs mint. */
const INBOUND_REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Mint a fresh request-id: 16 random bytes, base64url-encoded, with
 * the `req_` prefix. ~22 chars after the prefix; ~26 chars total.
 *
 * No security boundary — this is a correlation token, not a secret.
 * Collision probability across cloud-api's expected lifetime is
 * astronomically low (128 bits of entropy).
 */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64u = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${REQUEST_ID_PREFIX}${b64u}`;
}

/**
 * Hono middleware that establishes the per-request id and surfaces it
 * on every response. Mount globally via `app.use("*", …)` BEFORE any
 * routes so even 404s and route-handler exceptions get an id.
 *
 * Order:
 *   1. Read incoming `X-Request-Id`. Accept if it matches the regex;
 *      otherwise mint a fresh id (we never echo unsanitised client
 *      input back as a header).
 *   2. Stash on the context under the `requestId` key.
 *   3. Run the rest of the chain.
 *   4. Set `X-Request-Id` on the outgoing response.
 *
 * Bundle-conscious: ~30 lines total once minified.
 */
export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const inbound = c.req.header("x-request-id");
    const id = inbound && INBOUND_REQUEST_ID_RE.test(inbound) ? inbound : newRequestId();
    c.set("requestId", id);
    await next();
    c.res.headers.set("X-Request-Id", id);
  };
}

/**
 * Read the request id off the context. Always returns a string when
 * the middleware has run; falls back to `"req_unknown"` only if a
 * caller forgets to mount the middleware (defensive).
 */
export function getRequestId(c: { get: (key: string) => unknown }): string {
  const v = c.get("requestId");
  return typeof v === "string" ? v : "req_unknown";
}
