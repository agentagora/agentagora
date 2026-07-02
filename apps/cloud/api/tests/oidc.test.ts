/**
 * OIDC issuance + JWKS endpoint tests.
 *
 * Two layers:
 *   1. OidcIssuer.issue() produces a JWT whose payload validates against
 *      @agentagora/protocol's IdentityCertificateClaimsSchema and whose
 *      signature verifies against the issuer's public key.
 *   2. The HTTP surface — /.well-known/jwks.json, the identity_jwt
 *      returned from POST /v1/agents — exposes the same key + signs
 *      what the SDK can verify with `jose` against the JWKS.
 */

import { IdentityCertificateClaimsSchema, ManifestSchema } from "@agentagora/protocol";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { beforeAll, describe, expect, it } from "vitest";
import { b64uDecode } from "../src/_crypto.js";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { OidcIssuer } from "../src/oidc.js";
import { InMemoryStorage } from "../src/storage.js";
import { type SigningKey, generateSigningKey, signManifest } from "./_signing.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const ISSUER = "https://cloud.agentagora.test";

const validManifest = {
  manifest_version: 1 as const,
  aid: "aid:agentagora:acme/code-review",
  description: "Reviews PRs",
  endpoints: { rpc: "https://example.com/aap/v1/rpc" },
  capabilities: [
    {
      name: "review_pull_request",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      pricing: { model: "per_call" as const, amount: "0.50", currency: "USD" },
      accepts: ["stripe-fiat"],
    },
  ],
};

let issuerKey: Uint8Array;
let aliceKey: SigningKey;

beforeAll(async () => {
  // Deterministic issuer key for stable kid across test runs.
  issuerKey = new Uint8Array(32).fill(42);
  aliceKey = await generateSigningKey(1);
});

function decodeJwt(token: string) {
  const [headerSeg, payloadSeg, sigSeg] = token.split(".");
  if (!headerSeg || !payloadSeg || !sigSeg) {
    throw new Error("malformed JWT compact form");
  }
  const decoder = new TextDecoder();
  return {
    header: JSON.parse(decoder.decode(b64uDecode(headerSeg))),
    payload: JSON.parse(decoder.decode(b64uDecode(payloadSeg))),
    signingInput: new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
    signature: b64uDecode(sigSeg),
  };
}

describe("OidcIssuer", () => {
  it("issues a JWT whose payload matches IdentityCertificateClaimsSchema", async () => {
    const issuer = await OidcIssuer.create({
      privateKey: issuerKey,
      issuer: ISSUER,
      now: () => 1_700_000_000,
    });
    const manifest = ManifestSchema.parse(validManifest);
    const jwt = await issuer.issue({
      manifest,
      ownerId: "alice",
      publisherPubkey: aliceKey.pubkeyB64u,
    });

    const { header, payload } = decodeJwt(jwt);
    expect(header).toMatchObject({ alg: "EdDSA", typ: "JWT", kid: issuer.kid });

    const claims = IdentityCertificateClaimsSchema.parse(payload);
    expect(claims.iss).toBe(ISSUER);
    expect(claims.sub).toBe(validManifest.aid);
    expect(claims.aud).toBe("agentagora");
    expect(claims.iat).toBe(1_700_000_000);
    expect(claims.exp).toBe(1_700_000_000 + 3600);
    expect(claims["aap.owner"]).toBe("alice");
    expect(claims["aap.scopes"]).toEqual(["agent:publish"]);
    expect(claims["aap.pubkey"]).toBe(aliceKey.pubkeyB64u);
    expect(claims["aap.manifest_url"]).toBe(
      `${ISSUER}/v1/agents/${encodeURIComponent(validManifest.aid)}`,
    );
    expect(claims["aap.settlement"]).toEqual({ accepts: ["stripe-fiat"] });
  });

  it("produces a signature that verifies against its public key", async () => {
    const issuer = await OidcIssuer.create({ privateKey: issuerKey, issuer: ISSUER });
    const jwt = await issuer.issue({
      manifest: ManifestSchema.parse(validManifest),
      ownerId: "alice",
      publisherPubkey: aliceKey.pubkeyB64u,
    });
    const { signingInput, signature } = decodeJwt(jwt);
    const ok = await ed.verifyAsync(signature, signingInput, issuer.publicKeyBytes());
    expect(ok).toBe(true);
  });

  it("derives a stable 16-char kid from SHA-256(pubkey)", async () => {
    const a = await OidcIssuer.create({ privateKey: issuerKey, issuer: ISSUER });
    const b = await OidcIssuer.create({ privateKey: issuerKey, issuer: ISSUER });
    expect(a.kid).toBe(b.kid);
    expect(a.kid).toMatch(/^[A-Za-z0-9_-]{16}$/);

    const otherKey = new Uint8Array(32).fill(7);
    const c = await OidcIssuer.create({ privateKey: otherKey, issuer: ISSUER });
    expect(c.kid).not.toBe(a.kid);
  });

  it("publishes a JWKS document that matches the issued JWT's kid", async () => {
    const issuer = await OidcIssuer.create({ privateKey: issuerKey, issuer: ISSUER });
    const jwks = issuer.jwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      kty: "OKP",
      crv: "Ed25519",
      alg: "EdDSA",
      use: "sig",
      kid: issuer.kid,
    });

    const pub = b64uDecode(jwks.keys[0]?.x ?? "");
    expect(pub).toEqual(issuer.publicKeyBytes());
  });

  it("aggregates accepted settlement channels across capabilities", async () => {
    const issuer = await OidcIssuer.create({ privateKey: issuerKey, issuer: ISSUER });
    const multiChannel = ManifestSchema.parse({
      ...validManifest,
      capabilities: [
        validManifest.capabilities[0],
        {
          ...validManifest.capabilities[0],
          name: "buy_widget",
          accepts: ["usdc-base", "stripe-fiat"],
        },
      ],
    });
    const jwt = await issuer.issue({
      manifest: multiChannel,
      ownerId: "alice",
      publisherPubkey: aliceKey.pubkeyB64u,
    });
    const { payload } = decodeJwt(jwt);
    expect(new Set((payload["aap.settlement"] as { accepts: string[] }).accepts)).toEqual(
      new Set(["stripe-fiat", "usdc-base"]),
    );
  });
});

describe("HTTP surface", () => {
  async function setup() {
    const oidc = await OidcIssuer.create({ privateKey: issuerKey, issuer: ISSUER });
    const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
    const storage = new InMemoryStorage();
    return { oidc, app: createApi({ storage, ownerAuth, oidc }), storage };
  }

  it("GET /.well-known/jwks.json returns the active key", async () => {
    const { app, oidc } = await setup();
    const res = await app.request("/.well-known/jwks.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReturnType<typeof oidc.jwks>;
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]?.kid).toBe(oidc.kid);
  });

  it("GET /.well-known/jwks.json returns 503 when OIDC is not configured", async () => {
    const ownerAuth = new StaticOwnerAuth({});
    const app = createApi({ ownerAuth });
    const res = await app.request("/.well-known/jwks.json");
    expect(res.status).toBe(503);
  });

  it("POST /v1/agents returns a real JWT verifiable against the JWKS", async () => {
    const { app, oidc } = await setup();
    const signed = await signManifest(validManifest, aliceKey);
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
        "x-aap-pubkey": signed.pubkey,
        "x-aap-signature": signed.signature,
      },
      body: JSON.stringify(validManifest),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { identity_jwt: string };
    const { header, payload, signingInput, signature } = decodeJwt(body.identity_jwt);

    expect(header.kid).toBe(oidc.kid);
    expect(payload.sub).toBe(validManifest.aid);
    expect(payload["aap.owner"]).toBe("alice");
    expect(payload["aap.pubkey"]).toBe(aliceKey.pubkeyB64u);

    const ok = await ed.verifyAsync(signature, signingInput, oidc.publicKeyBytes());
    expect(ok).toBe(true);
  });

  it("GET /v1/agents/:aid REISSUES a fresh identity certificate on every read", async () => {
    // Certificates carry a ~1h TTL, so the publish-time JWT is expired for
    // almost every real-world resolve. The read path must mint a fresh
    // attestation — that's what lets SDK resolvers enforce `exp` strictly.
    let now = 1_750_000_000;
    const oidc = await OidcIssuer.create({
      privateKey: issuerKey,
      issuer: ISSUER,
      now: () => now,
    });
    const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
    const storage = new InMemoryStorage();
    const app = createApi({ storage, ownerAuth, oidc });

    const signed = await signManifest(validManifest, aliceKey);
    const pub = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
        "x-aap-pubkey": signed.pubkey,
        "x-aap-signature": signed.signature,
      },
      body: JSON.stringify(validManifest),
    });
    expect(pub.status).toBe(201);
    const publishJwt = ((await pub.json()) as { identity_jwt: string }).identity_jwt;

    // Two days later, the stored publish-time certificate is long expired…
    now += 2 * 24 * 3600;
    const res = await app.request(`/v1/agents/${encodeURIComponent(validManifest.aid)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { identity_jwt: string };

    // …but the read returns a FRESH one: newly minted, valid now, same
    // pinned pubkey, verifiable against the JWKS.
    expect(body.identity_jwt).not.toBe(publishJwt);
    const { payload, signingInput, signature } = decodeJwt(body.identity_jwt);
    expect(payload.iat).toBe(now);
    expect(payload.exp as number).toBeGreaterThan(now);
    expect(payload.sub).toBe(validManifest.aid);
    expect(payload["aap.pubkey"]).toBe(aliceKey.pubkeyB64u);
    expect(payload["aap.owner"]).toBe("alice");
    expect(await ed.verifyAsync(signature, signingInput, oidc.publicKeyBytes())).toBe(true);
  });

  it("POST /v1/agents falls back to mock JWT when no issuer is configured", async () => {
    const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
    const app = createApi({ ownerAuth });
    const signed = await signManifest(validManifest, aliceKey);
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
        "x-aap-pubkey": signed.pubkey,
        "x-aap-signature": signed.signature,
      },
      body: JSON.stringify(validManifest),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { identity_jwt: string };
    expect(body.identity_jwt).toMatch(/^mock\.jwt\./);
  });
});
