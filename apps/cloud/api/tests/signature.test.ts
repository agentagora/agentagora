/**
 * Manifest signature verification tests for POST /v1/agents.
 *
 *   400 — pubkey/signature header is missing or malformed
 *   401 — signature does not verify against the provided pubkey
 *   403 — owner is allowed to update but tries to rotate the signing
 *         key (TOFU pin mismatch)
 *
 * Bearer auth is held constant; auth.test.ts covers those rejection
 * paths separately.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage } from "../src/storage.js";
import { type SigningKey, generateSigningKey, signManifest } from "./_signing.js";

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

let aliceKey: SigningKey;
let aliceKey2: SigningKey;

beforeAll(async () => {
  aliceKey = await generateSigningKey(1);
  aliceKey2 = await generateSigningKey(7);
});

function setup() {
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
  return { app: createApi({ storage, ownerAuth }), storage };
}

interface PublishOptions {
  body?: unknown;
  pubkey?: string;
  signature?: string;
  omitPubkey?: boolean;
  omitSignature?: boolean;
  key?: SigningKey;
}

async function publish(app: ReturnType<typeof createApi>, options: PublishOptions = {}) {
  const body = options.body ?? validManifest;
  const key = options.key ?? aliceKey;
  const signed = await signManifest(body, key);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: "Bearer tok-alice",
  };
  if (!options.omitPubkey) headers["x-aap-pubkey"] = options.pubkey ?? signed.pubkey;
  if (!options.omitSignature) headers["x-aap-signature"] = options.signature ?? signed.signature;
  return app.request("/v1/agents", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /v1/agents — signature verification", () => {
  it("rejects request with no X-AAP-Pubkey header (400)", async () => {
    const { app } = setup();
    const res = await publish(app, { omitPubkey: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_signature");
  });

  it("rejects request with no X-AAP-Signature header (400)", async () => {
    const { app } = setup();
    const res = await publish(app, { omitSignature: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_signature");
  });

  it("rejects malformed pubkey (wrong byte length) with 400", async () => {
    const { app } = setup();
    const res = await publish(app, { pubkey: "AAAA" }); // 3 bytes
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("malformed_signature");
  });

  it("rejects malformed signature (wrong byte length) with 400", async () => {
    const { app } = setup();
    const res = await publish(app, { signature: "AAAA" }); // 3 bytes
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("malformed_signature");
  });

  it("rejects signature signed over a different body (401)", async () => {
    const { app } = setup();
    // Sign one body, send another.
    const signedFor = await signManifest({ ...validManifest, description: "other" }, aliceKey);
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
        "x-aap-pubkey": signedFor.pubkey,
        "x-aap-signature": signedFor.signature,
      },
      body: JSON.stringify(validManifest),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("unauthorized");
    expect(body.message).toMatch(/signature does not verify/);
  });

  it("rejects signature produced by a different private key (401)", async () => {
    const { app } = setup();
    // Declare alice's pubkey but ship a signature made with aliceKey2.
    const wrongKeySig = await signManifest(validManifest, aliceKey2);
    const res = await publish(app, {
      pubkey: aliceKey.pubkeyB64u,
      signature: wrongKeySig.signature,
    });
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed manifest and stores the pubkey", async () => {
    const { app, storage } = setup();
    const res = await publish(app);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { pubkey: string };
    expect(body.pubkey).toBe(aliceKey.pubkeyB64u);

    const stored = await storage.getAgent(validManifest.aid);
    expect(stored?.pubkey).toBe(aliceKey.pubkeyB64u);
  });

  it("lets the same owner re-sign with the same key (update)", async () => {
    const { app, storage } = setup();
    await publish(app);
    const res = await publish(app, {
      body: { ...validManifest, description: "updated" },
    });
    expect(res.status).toBe(201);
    const stored = await storage.getAgent(validManifest.aid);
    expect(stored?.manifest.description).toBe("updated");
    expect(stored?.pubkey).toBe(aliceKey.pubkeyB64u);
  });

  it("rejects key rotation by the same owner (403, TOFU pin)", async () => {
    const { app, storage } = setup();
    await publish(app);

    // Same bearer (tok-alice), different signing key.
    const res = await publish(app, { key: aliceKey2 });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("forbidden");
    expect(body.message).toMatch(/different signing key/);

    const stored = await storage.getAgent(validManifest.aid);
    expect(stored?.pubkey).toBe(aliceKey.pubkeyB64u);
  });

  // security-review-2026-05 §M2: legacy / failed-migration rows can
  // carry an empty `pubkey` (NOT NULL DEFAULT ''). The previous truthy
  // guard `existing.pubkey && …` short-circuited on those rows,
  // letting any owner-controlled bearer rotate the signing key past
  // the TOFU pin. The fix tightens to an explicit empty-string check
  // and refuses publish until ops resets the row.
  it("rejects publish against an existing empty-pubkey row (403, no implicit pin) [§M2]", async () => {
    const { app, storage } = setup();

    // Seed a legacy row whose `pubkey` is the empty default. This
    // simulates a manifest published before migration 0002 where the
    // row was never republished afterwards.
    await storage.putAgent({
      manifest: validManifest as never,
      identityJwt: "mock.legacy",
      publishedAt: "2026-01-01T00:00:00.000Z",
      publishedBy: "alice",
      pubkey: "",
    });

    const res = await publish(app);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("forbidden");
    expect(body.message).toMatch(/no pinned signing key/);

    // The empty-pubkey row is left as-is — fix is "ops resets it",
    // not "the next caller silently claims it".
    const stored = await storage.getAgent(validManifest.aid);
    expect(stored?.pubkey).toBe("");
  });
});
