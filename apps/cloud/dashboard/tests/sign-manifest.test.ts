import { describe, expect, it } from "vitest";

import { b64uDecode, b64uEncode, signManifest } from "../lib/sign-manifest";

// Cross-package import: the dashboard's sign path must produce
// signatures the cloud-api's verifier accepts. To prove that, we
// import the verifier directly from cloud-api's source. This is
// unusual — normally tests don't reach across package boundaries —
// but here it's the security-critical guarantee: if the two ever
// drift (different canonicalize behavior, different b64u, different
// Ed25519 wiring), every publish from the dashboard fails. Vitest
// resolves through TypeScript source, so no build artifact is needed.
import {
  b64uDecode as apiB64uDecode,
  canonicalizeJsonBytes as apiCanonicalize,
  verifyEd25519 as apiVerify,
} from "../../api/src/_crypto.js";

const ZERO_KEY = b64uEncode(new Uint8Array(32)); // 32 bytes of 0x00
const OTHER_KEY = b64uEncode(new Uint8Array(32).fill(1));

const FIXTURE_MANIFEST = {
  agent_id: "test:fixture",
  capabilities: ["echo"],
  endpoints: { call: "https://example.com/call" },
  metadata: { display_name: "Fixture Agent" },
};

describe("signManifest determinism", () => {
  it("produces a reproducible signature for a fixed key + manifest (locks JCS canonicalize behavior)", async () => {
    const sigA = await signManifest(FIXTURE_MANIFEST, ZERO_KEY);
    const sigB = await signManifest(FIXTURE_MANIFEST, ZERO_KEY);
    expect(sigA.signature).toBe(sigB.signature);
    expect(sigA.body).toBe(sigB.body);
    expect(sigA.pubkey).toBe(sigB.pubkey);
    // Spot-check the body is JCS-canonical (sorted keys, no whitespace).
    expect(sigA.body).toBe(
      JSON.stringify({
        agent_id: "test:fixture",
        capabilities: ["echo"],
        endpoints: { call: "https://example.com/call" },
        metadata: { display_name: "Fixture Agent" },
      }),
    );
  });

  it("produces different signatures for different private keys", async () => {
    const a = await signManifest(FIXTURE_MANIFEST, ZERO_KEY);
    const b = await signManifest(FIXTURE_MANIFEST, OTHER_KEY);
    expect(a.signature).not.toBe(b.signature);
    expect(a.pubkey).not.toBe(b.pubkey);
  });
});

describe("signManifest cross-package verification (cloud-api verifier)", () => {
  it("dashboard signature verifies via cloud-api's verifyEd25519 + canonicalizeJsonBytes", async () => {
    const signed = await signManifest(FIXTURE_MANIFEST, ZERO_KEY);
    const sigBytes = apiB64uDecode(signed.signature);
    const pubBytes = apiB64uDecode(signed.pubkey);
    const canonicalBytes = apiCanonicalize(FIXTURE_MANIFEST);
    const ok = await apiVerify(sigBytes, canonicalBytes, pubBytes);
    expect(ok).toBe(true);
  });

  it("verifier returns false when the manifest is tampered after signing", async () => {
    const signed = await signManifest(FIXTURE_MANIFEST, ZERO_KEY);
    const sigBytes = apiB64uDecode(signed.signature);
    const pubBytes = apiB64uDecode(signed.pubkey);
    const tamperedManifest = { ...FIXTURE_MANIFEST, agent_id: "test:tampered" };
    const canonicalBytes = apiCanonicalize(tamperedManifest);
    const ok = await apiVerify(sigBytes, canonicalBytes, pubBytes);
    expect(ok).toBe(false);
  });

  it("verifier returns false when the signature bytes are tampered", async () => {
    const signed = await signManifest(FIXTURE_MANIFEST, ZERO_KEY);
    const sigBytes = apiB64uDecode(signed.signature);
    sigBytes[0] = (sigBytes[0] ?? 0) ^ 0x01;
    const pubBytes = apiB64uDecode(signed.pubkey);
    const canonicalBytes = apiCanonicalize(FIXTURE_MANIFEST);
    const ok = await apiVerify(sigBytes, canonicalBytes, pubBytes);
    expect(ok).toBe(false);
  });
});

describe("signManifest input validation", () => {
  it("throws when the private key isn't 32 bytes after decoding", async () => {
    const tooShort = b64uEncode(new Uint8Array(16));
    await expect(signManifest(FIXTURE_MANIFEST, tooShort)).rejects.toThrow(/32 bytes/);
  });

  it("dashboard b64uDecode round-trips with cloud-api's b64uDecode", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]);
    const enc = b64uEncode(bytes);
    expect(Array.from(b64uDecode(enc))).toEqual(Array.from(apiB64uDecode(enc)));
  });
});
