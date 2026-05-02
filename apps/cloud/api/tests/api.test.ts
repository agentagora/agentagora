/**
 * Cloud API integration tests.
 *
 * Uses Hono's in-process `app.request()` to exercise the full
 * routing + validation + storage stack without spinning up an
 * HTTP server. Each test gets its own InMemoryStorage so there's
 * no test-order coupling.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage } from "../src/storage.js";
import { type SigningKey, generateSigningKey, signManifest } from "./_signing.js";

const validManifest = {
  manifest_version: 1 as const,
  aid: "aid:agentagora:weijt606/code-review",
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

const ALICE_TOKEN = "tok-alice";
const BOB_TOKEN = "tok-bob";

let aliceKey: SigningKey;

beforeAll(async () => {
  aliceKey = await generateSigningKey(1);
});

function setup() {
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({
    [ALICE_TOKEN]: "alice",
    [BOB_TOKEN]: "bob",
  });
  return { app: createApi({ storage, ownerAuth }), storage };
}

async function postJson(
  app: ReturnType<typeof createApi>,
  path: string,
  body: unknown,
  token = ALICE_TOKEN,
) {
  const { pubkey, signature } = await signManifest(body, aliceKey);
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-aap-pubkey": pubkey,
      "x-aap-signature": signature,
    },
    body: JSON.stringify(body),
  });
}

describe("metadata + healthz", () => {
  it("GET / returns service metadata", async () => {
    const { app } = setup();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; status: string; version: string };
    expect(body.name).toBe("AgentAgora Cloud API");
    expect(body.status).toBe("pre-alpha");
    expect(body.version).toBe("0.0.2");
  });

  it("GET /healthz returns ok", async () => {
    const { app } = setup();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("unknown route returns structured 404", async () => {
    const { app } = setup();
    const res = await app.request("/v1/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; path: string };
    expect(body.error).toBe("not_found");
    expect(body.path).toBe("/v1/nope");
  });
});

describe("POST /v1/agents", () => {
  it("publishes a valid manifest and returns a mock identity JWT", async () => {
    const { app } = setup();
    const res = await postJson(app, "/v1/agents", validManifest);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      aid: string;
      identity_jwt: string;
      published_at: string;
      published_by: string;
    };
    expect(body.aid).toBe(validManifest.aid);
    expect(body.identity_jwt).toMatch(/^mock\.jwt\./);
    expect(body.published_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(body.published_by).toBe("alice");
  });

  it("rejects a manifest with an invalid AID", async () => {
    const { app } = setup();
    const res = await postJson(app, "/v1/agents", { ...validManifest, aid: "not-an-aid" });
    expect(res.status).toBe(400);
  });

  it("rejects a manifest with no capabilities", async () => {
    const { app } = setup();
    const res = await postJson(app, "/v1/agents", { ...validManifest, capabilities: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a paid capability without a settlement channel", async () => {
    const { app } = setup();
    const res = await postJson(app, "/v1/agents", {
      ...validManifest,
      capabilities: [{ ...validManifest.capabilities[0], accepts: [] }],
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/agents/:aid", () => {
  it("returns the published manifest", async () => {
    const { app } = setup();
    await postJson(app, "/v1/agents", validManifest);

    const res = await app.request(`/v1/agents/${encodeURIComponent(validManifest.aid)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { aid: string; manifest: typeof validManifest };
    expect(body.aid).toBe(validManifest.aid);
    expect(body.manifest.description).toBe("Reviews PRs");
  });

  it("returns 404 with structured error for unknown AID", async () => {
    const { app } = setup();
    const res = await app.request("/v1/agents/aid:agentagora:nobody/missing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

describe("GET /v1/agents (list / search)", () => {
  async function seed(app: ReturnType<typeof createApi>) {
    await postJson(app, "/v1/agents", validManifest);
    await postJson(app, "/v1/agents", {
      ...validManifest,
      aid: "aid:agentagora:alice/translator",
      description: "Translates text",
      capabilities: [
        {
          name: "translate",
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          pricing: { model: "free" as const },
          accepts: [],
        },
      ],
    });
  }

  it("lists all agents when no filter", async () => {
    const { app } = setup();
    await seed(app);
    const body = (await (await app.request("/v1/agents")).json()) as {
      total: number;
      agents: { aid: string }[];
    };
    expect(body.total).toBe(2);
  });

  it("filters by capability name", async () => {
    const { app } = setup();
    await seed(app);
    const r1 = (await (await app.request("/v1/agents?capability=translate")).json()) as {
      total: number;
    };
    expect(r1.total).toBe(1);

    const r2 = (await (await app.request("/v1/agents?capability=does_not_exist")).json()) as {
      total: number;
    };
    expect(r2.total).toBe(0);
  });

  it("filters by accepted settlement channel", async () => {
    const { app } = setup();
    await seed(app);
    const body = (await (await app.request("/v1/agents?accepts=stripe-fiat")).json()) as {
      total: number;
      agents: { aid: string }[];
    };
    expect(body.total).toBe(1);
    expect(body.agents[0]?.aid).toBe(validManifest.aid);
  });

  it("supports text search via q", async () => {
    const { app } = setup();
    await seed(app);
    const body = (await (await app.request("/v1/agents?q=translates")).json()) as {
      total: number;
    };
    expect(body.total).toBe(1);
  });
});
