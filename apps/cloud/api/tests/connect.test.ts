/**
 * /v1/connect/* tests.
 *
 *   POST /v1/connect/onboarding
 *     - 401 missing/invalid bearer
 *     - 400 missing return_url / refresh_url / bad shape
 *     - 201 happy path: creates Stripe account, returns onboarding link
 *     - 201 idempotent: second call reuses the same Stripe account ID
 *     - 502 when Stripe createAccount fails
 *     - 502 when Stripe createAccountLink fails (after account already
 *           exists in storage)
 *
 *   GET /v1/connect/account
 *     - 401 missing bearer
 *     - 404 when no account exists
 *     - 200 returns the cached status
 *
 * Routes are also reachable when the parent app is configured WITHOUT
 * a stripe client — they then return 503 not_configured.
 */

import { describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage } from "../src/storage.js";
import { MockStripeApiClient } from "./_mock-stripe.js";

interface OnboardingBody {
  return_url?: string;
  refresh_url?: string;
  email?: string;
  country?: string;
}

interface SetupOptions {
  stripe?: MockStripeApiClient | null;
}

function setup(options: SetupOptions = {}) {
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice", "tok-bob": "bob" });
  const stripe =
    options.stripe === null ? undefined : (options.stripe ?? new MockStripeApiClient());
  const app = createApi({ storage, ownerAuth, stripe });
  return { app, storage, ownerAuth, stripe };
}

async function postOnboarding(
  app: ReturnType<typeof createApi>,
  body: OnboardingBody,
  token: string | null = "tok-alice",
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return app.request("/v1/connect/onboarding", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const validBody: OnboardingBody = {
  return_url: "https://app.example.com/onboarded",
  refresh_url: "https://app.example.com/onboard/refresh",
  email: "alice@example.com",
};

describe("POST /v1/connect/onboarding — happy path", () => {
  it("creates a Stripe account on first call and returns the onboarding link (201)", async () => {
    const { app, storage, stripe } = setup();
    const res = await postOnboarding(app, validBody);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      account_id: string;
      onboarding_url: string;
      expires_at: string;
      status: { details_submitted: boolean; charges_enabled: boolean; payouts_enabled: boolean };
    };
    expect(body.account_id).toMatch(/^acct_test_/);
    expect(body.onboarding_url).toContain(body.account_id);
    expect(body.expires_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(body.status.details_submitted).toBe(false);

    expect(stripe?.createAccountCalls).toHaveLength(1);
    expect(stripe?.createAccountCalls[0]?.email).toBe("alice@example.com");
    expect(stripe?.createLinkCalls).toHaveLength(1);
    expect(stripe?.createLinkCalls[0]?.return_url).toBe(validBody.return_url);

    const stored = await storage.getStripeAccountByOwner("alice");
    expect(stored?.stripeAccountId).toBe(body.account_id);
  });

  it("reuses the existing Stripe account on subsequent calls", async () => {
    const { app, stripe } = setup();
    const a = await postOnboarding(app, validBody);
    const b = await postOnboarding(app, validBody);
    const aBody = (await a.json()) as { account_id: string };
    const bBody = (await b.json()) as { account_id: string };
    expect(bBody.account_id).toBe(aBody.account_id);
    // One account, two links.
    expect(stripe?.createAccountCalls).toHaveLength(1);
    expect(stripe?.createLinkCalls).toHaveLength(2);
  });

  it("scopes accounts per owner — alice and bob get different accounts", async () => {
    const { app } = setup();
    const a = await postOnboarding(app, validBody, "tok-alice");
    const b = await postOnboarding(app, validBody, "tok-bob");
    const aBody = (await a.json()) as { account_id: string };
    const bBody = (await b.json()) as { account_id: string };
    expect(aBody.account_id).not.toBe(bBody.account_id);
  });

  it("forwards the country code when provided", async () => {
    const { app, stripe } = setup();
    await postOnboarding(app, { ...validBody, country: "GB" });
    expect(stripe?.createAccountCalls[0]?.country).toBe("GB");
  });
});

describe("POST /v1/connect/onboarding — rejection paths", () => {
  it("401 on missing bearer", async () => {
    const { app } = setup();
    const res = await postOnboarding(app, validBody, null);
    expect(res.status).toBe(401);
  });

  it("401 on unknown bearer", async () => {
    const { app } = setup();
    const res = await postOnboarding(app, validBody, "tok-nope");
    expect(res.status).toBe(401);
  });

  it("400 on missing return_url", async () => {
    const { app } = setup();
    const { return_url: _ignored, ...rest } = validBody;
    const res = await postOnboarding(app, rest);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe("return_url");
  });

  it("400 on non-http return_url", async () => {
    const { app } = setup();
    const res = await postOnboarding(app, { ...validBody, return_url: "javascript:alert(1)" });
    expect(res.status).toBe(400);
  });

  it("400 on bad country code", async () => {
    const { app } = setup();
    const res = await postOnboarding(app, { ...validBody, country: "USA" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe("country");
  });

  it("502 when Stripe createAccount fails", async () => {
    const stripe = new MockStripeApiClient({
      failNextCreateAccount: new Error("Stripe is on fire"),
    });
    const { app } = setup({ stripe });
    const res = await postOnboarding(app, validBody);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; op: string };
    expect(body.error).toBe("stripe_unavailable");
    expect(body.op).toBe("createExpressAccount");
  });

  it("502 when Stripe createAccountLink fails after account exists", async () => {
    const stripe = new MockStripeApiClient();
    const { app, storage } = setup({ stripe });
    // Pre-seed the account so the route only hits createAccountLink.
    await postOnboarding(app, validBody);
    expect(await storage.getStripeAccountByOwner("alice")).toBeDefined();

    stripe.createLinkCalls.length = 0; // reset
    const failingStripe = stripe as MockStripeApiClient & { failNextCreateLink?: Error };
    // Inject the failure via the options field.
    (failingStripe as unknown as { options: { failNextCreateLink?: Error } }).options = {
      failNextCreateLink: new Error("rate-limited by Stripe"),
    };
    const res = await postOnboarding(app, validBody);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { op: string };
    expect(body.op).toBe("createAccountLink");
  });
});

describe("GET /v1/connect/account", () => {
  it("404 when the owner has not onboarded yet", async () => {
    const { app } = setup();
    const res = await app.request("/v1/connect/account", {
      headers: { authorization: "Bearer tok-alice" },
    });
    expect(res.status).toBe(404);
  });

  it("200 with cached status after onboarding", async () => {
    const { app } = setup();
    await postOnboarding(app, validBody);
    const res = await app.request("/v1/connect/account", {
      headers: { authorization: "Bearer tok-alice" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      account_id: string;
      status: { details_submitted: boolean; charges_enabled: boolean; payouts_enabled: boolean };
    };
    expect(body.account_id).toMatch(/^acct_test_/);
    expect(body.status.details_submitted).toBe(false);
  });

  it("401 on missing bearer", async () => {
    const { app } = setup();
    const res = await app.request("/v1/connect/account");
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/connect/accounts/:aid (public)", () => {
  it("404 when the AID is not registered", async () => {
    const { app } = setup();
    const res = await app.request("/v1/connect/accounts/aid%3Aagentagora%3Aghost%2Fnobody");
    expect(res.status).toBe(404);
  });

  it("404 not_ready when the owner has not completed onboarding", async () => {
    const { app } = setup();
    // Onboard alice but don't flip charges_enabled.
    await postOnboarding(app, validBody, "tok-alice");

    // Need a registered agent owned by alice. We don't run the
    // publish flow here (it'd require signing); seed storage directly.
    const setupRes = setup();
    // setupRes is a fresh harness — use it instead so the agent + onboard line up.
    await setupRes.storage.putAgent({
      manifest: {
        manifest_version: 1,
        aid: "aid:agentagora:alice/agent" as never,
        endpoints: { rpc: "https://example.com" },
        capabilities: [
          {
            name: "x",
            input_schema: { type: "object" },
            output_schema: { type: "object" },
            pricing: { model: "per_call", amount: "1.00", currency: "USD" },
            sla: {},
            accepts: ["stripe-fiat"],
          },
        ],
        privacy: { data_retention_days: 7, pii_handling: "redact", region_restriction: [] },
        metadata: { tags: [], languages: [], models_used: [] },
      } as never,
      identityJwt: "mock",
      publishedAt: "2026-05-01T00:00:00.000Z",
      publishedBy: "alice",
      pubkey: "x".repeat(43),
    });
    await postOnboarding(setupRes.app, validBody, "tok-alice");
    const res = await setupRes.app.request("/v1/connect/accounts/aid%3Aagentagora%3Aalice%2Fagent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_ready");
  });

  it("200 with the account_id once onboarding has completed", async () => {
    const { app, storage, stripe } = setup();
    // Seed an alice-owned agent and an onboarded alice account.
    await storage.putAgent({
      manifest: {
        manifest_version: 1,
        aid: "aid:agentagora:alice/agent" as never,
        endpoints: { rpc: "https://example.com" },
        capabilities: [
          {
            name: "x",
            input_schema: { type: "object" },
            output_schema: { type: "object" },
            pricing: { model: "per_call", amount: "1.00", currency: "USD" },
            sla: {},
            accepts: ["stripe-fiat"],
          },
        ],
        privacy: { data_retention_days: 7, pii_handling: "redact", region_restriction: [] },
        metadata: { tags: [], languages: [], models_used: [] },
      } as never,
      identityJwt: "mock",
      publishedAt: "2026-05-01T00:00:00.000Z",
      publishedBy: "alice",
      pubkey: "x".repeat(43),
    });
    const onboard = await postOnboarding(app, validBody, "tok-alice");
    const onboardBody = (await onboard.json()) as { account_id: string };
    // Mark alice's account as onboarded by updating storage.
    const account = await storage.getStripeAccountByOwner("alice");
    if (!account) throw new Error("setup: account missing");
    await storage.upsertStripeAccount({ ...account, chargesEnabled: true });
    // (stripe mock isn't strictly needed past this point — keep in
    // scope so the test reads naturally if we extend it.)
    void stripe;

    const res = await app.request("/v1/connect/accounts/aid%3Aagentagora%3Aalice%2Fagent");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { aid: string; account_id: string };
    expect(body.account_id).toBe(onboardBody.account_id);
  });
});

describe("/v1/connect/* with no Stripe client configured", () => {
  it("returns 503 not_configured", async () => {
    const { app } = setup({ stripe: null });
    const res = await app.request("/v1/connect/account", {
      headers: { authorization: "Bearer tok-alice" },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_configured");
  });
});
