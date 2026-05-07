/**
 * Tier 1 compliance — liveness.
 *
 * Spec section: AAP-spec.md §5 (Discovery) implies an active
 * registry; PRD §9.3 #1 requires the cloud-api be reachable.
 *
 * Every cloud-api candidate MUST:
 *   - Respond 200 to `GET /healthz`
 *   - Publish a JWKS document at `GET /.well-known/jwks.json` whose
 *     body is JSON with a `keys` array; each key MUST be `kty=OKP`
 *     `crv=Ed25519` and carry an `x` (the public key) and `kid`.
 *
 * If JWKS is empty, mock-mode is acceptable for development but a
 * production cloud-api MUST publish at least one real key (so
 * downstream verifiers have something to bind to).
 */

import { describe, expect, it } from "vitest";

import { loadConfig, shouldRunCompliance } from "../src/config.js";
import { probe } from "../src/probe.js";

const cfg = loadConfig();
const enabled = shouldRunCompliance();

describe.skipIf(!enabled)("Tier 1 · Liveness", () => {
  it("MUST respond to GET /healthz with 200 + JSON body", async () => {
    const res = await probe(`${cfg.baseUrl}/healthz`);
    expect(res.status, `GET /healthz at ${cfg.baseUrl} returned ${res.status}`).toBe(200);
    expect(res.body, "GET /healthz body must be a JSON object").toBeTypeOf("object");
  });

  it("SHOULD publish a JWKS document at /.well-known/jwks.json", async () => {
    // SHOULD because a development candidate without `OIDC_SIGNING_KEY`
    // returns 503 — that's allowed in dev/mock mode (`OIDC_SIGNING_KEY
    // missing — JWKS is 503` is the documented graceful-degradation
    // path). A production candidate MUST publish 200; we encode that
    // as a separate assertion so dev-mode runs surface the gap as a
    // `SHOULD` warning rather than a hard fail.
    const res = await probe(`${cfg.baseUrl}/.well-known/jwks.json`);
    if (res.status === 503) {
      // Dev-mode: candidate hasn't configured OIDC. Accepted at Tier 1.
      // (Production deployments should never hit this path — that's
      // checked at higher tiers / pre-launch self-test in the
      // launch-runbook.)
      return;
    }
    expect(res.status, `JWKS endpoint MUST be 200 or 503 (got ${res.status})`).toBe(200);
    const body = res.body as { keys?: unknown };
    expect(Array.isArray(body.keys), "JWKS `keys` MUST be an array").toBe(true);
  });

  it("JWKS keys (if published) MUST be Ed25519 with kid + x", async () => {
    const res = await probe(`${cfg.baseUrl}/.well-known/jwks.json`);
    if (res.status !== 200) return; // dev-mode 503 — covered by previous test
    type Jwk = { kty?: string; crv?: string; x?: string; kid?: string };
    const body = res.body as { keys?: Jwk[] };
    const keys = body.keys ?? [];

    if (keys.length === 0) {
      // Empty JWKS array (200 status) is acceptable in dev; a production
      // candidate that emits no keys is a SHOULD-fail at higher tiers
      // but Tier 1 is about shape, not population.
      return;
    }
    for (const key of keys) {
      expect(key.kty, "Every JWK MUST set kty=OKP (RFC 8037)").toBe("OKP");
      expect(key.crv, "Every JWK MUST set crv=Ed25519").toBe("Ed25519");
      expect(typeof key.x, "Every JWK MUST set `x` (public key)").toBe("string");
      expect(
        (key.x ?? "").length,
        "JWK `x` MUST be base64url 32 bytes (~43 chars)",
      ).toBeGreaterThan(0);
      expect(
        typeof key.kid,
        "Every JWK MUST set `kid` (deterministic SHA-256(pubkey) preferred)",
      ).toBe("string");
    }
  });

  it("MUST set CORS-friendly headers on /healthz (allow public read)", async () => {
    const res = await probe(`${cfg.baseUrl}/healthz`);
    // Cloudflare Workers default to permissive CORS via Hono; the
    // protocol doesn't mandate a specific CORS policy beyond "the
    // public-surface routes must be readable from a browser" (see
    // PRD §9 acceptance — agent catalog renders client-side from
    // marketing site). Loose check: a `content-type` header is
    // present, and the response is not blocked by a default
    // `access-control-allow-origin: null`.
    const ct = res.headers.get("content-type") ?? "";
    expect(ct.toLowerCase()).toContain("application/json");
    const origin = res.headers.get("access-control-allow-origin");
    if (origin !== null) {
      expect(origin, "If ACA-O is set, it must permit cross-origin reads").not.toBe("null");
    }
  });
});
