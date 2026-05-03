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
