/**
 * M2 end-to-end integration test.
 *
 * Walks the closed-alpha happy path through every cloud-api surface
 * a real agent + dashboard would touch, in the order they'd touch
 * them. Proves the whole control plane composes.
 *
 *   1. Alice + Bob publish signed manifests; cloud issues real OIDC
 *      JWTs and pins their pubkeys (TOFU)
 *   2. JWKS exposes the verifying public key — JWT verifies against it
 *   3. Both owners onboard with Stripe Connect (mocked)
 *   4. account.updated webhook arrives → cached flags flip
 *   5. Bob calls Alice (off-cloud), ingests the chain of audit events
 *   6. Anyone can read the conversation by ID
 *   7. Bob files a dispute against Alice; case file is publicly
 *      retrievable by ID
 *   8. Rate limiting bites if alice tries to publish 31 times in
 *      a minute
 *
 * If anything in this test breaks, it's a P0: a real M2 deployment
 * would be unable to execute the full flow.
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { describe, expect, it } from "vitest";
import { b64uDecode } from "../src/_crypto.js";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryNonceStore } from "../src/nonces.js";
import { OidcIssuer } from "../src/oidc.js";
import { InMemoryRateLimiter } from "../src/rate-limit.js";
import { InMemoryStorage } from "../src/storage.js";
import { HmacWebhookVerifier } from "../src/stripe-webhook.js";
import { MockStripeApiClient } from "./_mock-stripe.js";
import {
  type AuditEventDraft,
  type SigningKey,
  chainHash,
  generateSigningKey,
  signAuditEvent,
  signManifest,
} from "./_signing.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const ALICE_AID = "aid:agentagora:alice/code-review";
const BOB_AID = "aid:agentagora:bob/translator";
const CONVO = "convo-m2-happy-path";
const ISSUER = "https://cloud.agentagora.test";
const WEBHOOK_SECRET = "whsec_integration_test";

const aliceManifest = {
  manifest_version: 1 as const,
  aid: ALICE_AID,
  description: "Reviews TypeScript pull requests",
  endpoints: { rpc: "https://alice.example.com/aap/v1/rpc" },
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

const bobManifest = {
  manifest_version: 1 as const,
  aid: BOB_AID,
  description: "Translates between English and Mandarin",
  endpoints: { rpc: "https://bob.example.com/aap/v1/rpc" },
  capabilities: [
    {
      name: "translate",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      pricing: { model: "free" as const },
      accepts: [],
    },
  ],
};

interface Harness {
  app: ReturnType<typeof createApi>;
  storage: InMemoryStorage;
  stripe: MockStripeApiClient;
  oidc: OidcIssuer;
  webhookSecret: string;
  aliceKey: SigningKey;
  bobKey: SigningKey;
}

async function harness(): Promise<Harness> {
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice", "tok-bob": "bob" });
  const oidc = await OidcIssuer.create({
    privateKey: new Uint8Array(32).fill(42),
    issuer: ISSUER,
  });
  const stripe = new MockStripeApiClient();
  const stripeWebhookVerifier = new HmacWebhookVerifier(WEBHOOK_SECRET);
  const nonceStore = new InMemoryNonceStore();
  const rateLimiter = new InMemoryRateLimiter();

  const app = createApi({
    storage,
    ownerAuth,
    oidc,
    nonceStore,
    rateLimiter,
    stripe,
    stripeWebhookVerifier,
  });

  const aliceKey = await generateSigningKey(1);
  const bobKey = await generateSigningKey(2);
  return { app, storage, stripe, oidc, webhookSecret: WEBHOOK_SECRET, aliceKey, bobKey };
}

async function publishManifest(
  app: ReturnType<typeof createApi>,
  manifest: object,
  token: string,
  key: SigningKey,
): Promise<{ identity_jwt: string; published_by: string }> {
  const signed = await signManifest(manifest, key);
  const res = await app.request("/v1/agents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-aap-pubkey": signed.pubkey,
      "x-aap-signature": signed.signature,
    },
    body: JSON.stringify(manifest),
  });
  if (res.status !== 201) {
    throw new Error(`publish failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<{ identity_jwt: string; published_by: string }>;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postWebhook(app: ReturnType<typeof createApi>, secret: string, payload: object) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(secret, `${ts}.${body}`);
  return app.request("/v1/stripe/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${ts},v1=${sig}`,
    },
    body,
  });
}

describe("M2 end-to-end happy path", () => {
  it("walks the full closed-alpha flow without skips", async () => {
    const h = await harness();

    // Step 1 — Both agents publish signed manifests.
    const aliceResp = await publishManifest(h.app, aliceManifest, "tok-alice", h.aliceKey);
    const bobResp = await publishManifest(h.app, bobManifest, "tok-bob", h.bobKey);
    expect(aliceResp.published_by).toBe("alice");
    expect(bobResp.published_by).toBe("bob");

    // Step 2 — JWT verifies against JWKS.
    const jwksRes = await h.app.request("/.well-known/jwks.json");
    const jwks = (await jwksRes.json()) as { keys: { kid: string; x: string }[] };
    expect(jwks.keys).toHaveLength(1);

    const [headerSeg, payloadSeg, sigSeg] = aliceResp.identity_jwt.split(".");
    expect(headerSeg).toBeDefined();
    const header = JSON.parse(new TextDecoder().decode(b64uDecode(headerSeg as string)));
    expect(header.kid).toBe(jwks.keys[0]?.kid);
    const signingInput = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const sigOk = await ed.verifyAsync(
      b64uDecode(sigSeg as string),
      signingInput,
      h.oidc.publicKeyBytes(),
    );
    expect(sigOk).toBe(true);

    // Step 3 — Both owners onboard with Stripe Connect.
    const onboardingBody = {
      return_url: "https://app.example.com/onboarded",
      refresh_url: "https://app.example.com/onboard/refresh",
      email: "alice@example.com",
    };
    const aliceOnboard = await h.app.request("/v1/connect/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok-alice" },
      body: JSON.stringify(onboardingBody),
    });
    expect(aliceOnboard.status).toBe(201);
    const aliceConnect = (await aliceOnboard.json()) as { account_id: string };

    await h.app.request("/v1/connect/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok-bob" },
      body: JSON.stringify({ ...onboardingBody, email: "bob@example.com" }),
    });

    // Step 4 — account.updated webhook flips alice's flags.
    const wh = await postWebhook(h.app, h.webhookSecret, {
      id: "evt_int_1",
      type: "account.updated",
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: aliceConnect.account_id,
          details_submitted: true,
          charges_enabled: true,
          payouts_enabled: true,
        },
      },
    });
    expect(wh.status).toBe(200);
    const aliceAccount = await h.storage.getStripeAccountByOwner("alice");
    expect(aliceAccount?.chargesEnabled).toBe(true);

    // Step 5 — Bob calls Alice off-cloud; alice ingests her chain of
    // audit events. Two events: rpc.request.received + rpc.response.sent.
    const e1Draft: AuditEventDraft = {
      event_id: "evt-int-r1",
      conversation_id: CONVO,
      type: "rpc.request.received",
      timestamp: "2026-05-01T12:00:00.000Z",
      actor_aid: ALICE_AID,
      previous_event_hash: null,
    };
    const e1 = await signAuditEvent(e1Draft, h.aliceKey);
    const e2Draft: AuditEventDraft = {
      event_id: "evt-int-r2",
      conversation_id: CONVO,
      type: "rpc.response.sent",
      timestamp: "2026-05-01T12:00:01.000Z",
      actor_aid: ALICE_AID,
      previous_event_hash: chainHash(e1),
    };
    const e2 = await signAuditEvent(e2Draft, h.aliceKey);

    const ingest = await h.app.request("/v1/audit/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [e1, e2] }),
    });
    expect(ingest.status).toBe(201);
    const ingestBody = (await ingest.json()) as { ingested: string[] };
    expect(ingestBody.ingested).toEqual([e1.event_id, e2.event_id]);

    // Step 6 — Anyone can read the conversation by ID (no bearer).
    const convoRes = await h.app.request(`/v1/conversations/${CONVO}`);
    const convo = (await convoRes.json()) as {
      total: number;
      events: { event_id: string }[];
    };
    expect(convo.total).toBe(2);
    expect(convo.events.map((e) => e.event_id)).toEqual([e1.event_id, e2.event_id]);

    // Step 7 — Bob files a dispute against alice.
    const dispute = await h.app.request("/v1/disputes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok-bob" },
      body: JSON.stringify({
        conversation_id: CONVO,
        filer_aid: BOB_AID,
        respondent_aid: ALICE_AID,
        reason: "wrong_output",
        narrative: "Reviewed the wrong PR; never apologised.",
        claimed_remedy: "refund",
      }),
    });
    expect(dispute.status).toBe(201);
    const disputeBody = (await dispute.json()) as { dispute_id: string; state: string };
    expect(disputeBody.state).toBe("open");

    // Public read by opaque ID (no bearer).
    const disputeRead = await h.app.request(`/v1/disputes/${disputeBody.dispute_id}`);
    const disputeView = (await disputeRead.json()) as { reason: string };
    expect(disputeView.reason).toBe("wrong_output");

    // Step 8 — Rate limiting bites alice's 31st publish in a minute.
    // (She already used 1 publish, so 29 more succeed and the 31st is
    // the 30th = at-cap; the next one is rejected.)
    let lastStatus = 0;
    for (let i = 0; i < 30; i++) {
      const r = await publishManifest(
        h.app,
        { ...aliceManifest, aid: `aid:agentagora:alice/agent-${i}` },
        "tok-alice",
        h.aliceKey,
      ).catch(async () => {
        return { __failed: true } as unknown as { identity_jwt: string; published_by: string };
      });
      if ("__failed" in r) {
        const sniff = await h.app.request("/v1/agents", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer tok-alice",
            "x-aap-pubkey": "x",
            "x-aap-signature": "y",
          },
          body: "{}",
        });
        lastStatus = sniff.status;
        break;
      }
    }
    expect(lastStatus).toBe(429);
  });
});
