/**
 * `lib/cloud-api.ts` covers every server-rendered fetch the dashboard
 * makes against the cloud-api. The module is a thin typed wrapper, so
 * the test surface is each function's branch table:
 *
 *   - 2xx happy path — returns parsed body / "ok" variant
 *   - 404 — translates to `null` / `{ kind: "missing" }` per function
 *   - other 4xx / 5xx — falls through to a quiet warn + safe default
 *   - network error (fetch throws) — same safe default
 *
 * The dashboard is the front face of the cloud; getting any of these
 * branches wrong shows the user a crash instead of a "we couldn't
 * reach the server" empty state. This suite locks in the contract.
 *
 * Mocking strategy: vi.stubGlobal("fetch", ...) per-test. We never let
 * a real fetch reach the network — every test defines an inline
 * Response (or rejection) for the URL it cares about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BASE_URL,
  fileDispute,
  getAgent,
  getConversation,
  getDispute,
  getOwnedAgents,
  getStripeAccount,
  listAgents,
  listOwnedConversations,
  listOwnedDisputes,
  pingCloudApi,
  validateBearer,
} from "../lib/cloud-api.js";

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];
type Handler = (...args: FetchArgs) => Response | Promise<Response>;

let fetchSpy: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

function stubFetch(handler: Handler) {
  fetchSpy = vi.fn(handler);
  vi.stubGlobal("fetch", fetchSpy);
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  // Silence the per-call console.warn the module emits on non-OK paths.
  // Tests assert via return value, not log output.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnSpy.mockRestore();
});

describe("BASE_URL", () => {
  it("falls back to localhost when AGENTAGORA_CLOUD_URL is unset", () => {
    // BASE_URL is captured at import time; this assertion documents the
    // default, since the test runner doesn't set the env var.
    expect(BASE_URL).toBe("http://localhost:8787");
  });
});

describe("listAgents", () => {
  it("returns the parsed catalog on 200", async () => {
    stubFetch(() =>
      jsonResponse({
        total: 1,
        agents: [
          {
            aid: "aid:agentagora:alice/code-review",
            description: "demo",
            capabilities: [],
            published_at: "2026-05-01T00:00:00Z",
          },
        ],
      }),
    );

    const result = await listAgents();
    expect(result.total).toBe(1);
    expect(result.agents[0]?.aid).toBe("aid:agentagora:alice/code-review");
  });

  it("forwards capability + accepts + q filters as query params", async () => {
    let captured: URL | undefined;
    stubFetch((input) => {
      captured = new URL(typeof input === "string" ? input : input.toString());
      return jsonResponse({ total: 0, agents: [] });
    });

    await listAgents({ capability: "review", accepts: "diff", q: "rust" });
    expect(captured?.searchParams.get("capability")).toBe("review");
    expect(captured?.searchParams.get("accepts")).toBe("diff");
    expect(captured?.searchParams.get("q")).toBe("rust");
  });

  it("returns empty list on non-2xx response", async () => {
    stubFetch(() => jsonResponse({}, { status: 500 }));
    const result = await listAgents();
    expect(result).toEqual({ total: 0, agents: [] });
  });

  it("returns empty list when fetch rejects (cloud-api unreachable)", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const result = await listAgents();
    expect(result).toEqual({ total: 0, agents: [] });
  });
});

describe("getAgent", () => {
  it("returns the parsed manifest on 200", async () => {
    stubFetch(() =>
      jsonResponse({
        aid: "aid:agentagora:alice/x",
        manifest: { aid: "aid:agentagora:alice/x" },
        identity_jwt: "jwt-here",
        published_at: "2026-05-01T00:00:00Z",
      }),
    );
    const result = await getAgent("aid:agentagora:alice/x");
    expect(result?.aid).toBe("aid:agentagora:alice/x");
  });

  it("returns null on 404", async () => {
    stubFetch(() => jsonResponse({}, { status: 404 }));
    expect(await getAgent("aid:agentagora:alice/missing")).toBeNull();
  });

  it("returns null on 5xx", async () => {
    stubFetch(() => jsonResponse({}, { status: 500 }));
    expect(await getAgent("aid:agentagora:alice/x")).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await getAgent("aid:agentagora:alice/x")).toBeNull();
  });

  it("URL-encodes the AID", async () => {
    let captured: string | undefined;
    stubFetch((input) => {
      captured = typeof input === "string" ? input : input.toString();
      return jsonResponse({}, { status: 404 });
    });
    await getAgent("aid:agentagora:alice/with spaces");
    expect(captured).toContain("alice%2Fwith%20spaces");
  });
});

describe("getOwnedAgents", () => {
  it("falls through to public catalog when expectedOwner is null", async () => {
    let urlSeen: string | undefined;
    stubFetch((input) => {
      urlSeen = typeof input === "string" ? input : input.toString();
      return jsonResponse({ total: 0, agents: [] });
    });
    await getOwnedAgents("bearer-X", null);
    // Should have hit /v1/agents WITHOUT ?owner=
    expect(urlSeen).toMatch(/\/v1\/agents$/);
  });

  it("sends Authorization: Bearer when expectedOwner is set", async () => {
    let authSeen: string | null | undefined;
    stubFetch((_input, init) => {
      const headers = new Headers(init?.headers);
      authSeen = headers.get("authorization");
      return jsonResponse({ total: 0, agents: [] });
    });
    await getOwnedAgents("bearer-Y", "acme");
    expect(authSeen).toBe("Bearer bearer-Y");
  });

  it("returns the bearer-scoped list on 200", async () => {
    stubFetch(() =>
      jsonResponse({
        total: 1,
        agents: [
          {
            aid: "aid:agentagora:acme/x",
            capabilities: [],
            published_at: "2026-05-01T00:00:00Z",
          },
        ],
      }),
    );
    const out = await getOwnedAgents("bearer-Y", "acme");
    expect(out).toHaveLength(1);
    expect(out[0]?.aid).toBe("aid:agentagora:acme/x");
  });

  it("returns [] when cloud-api 401s", async () => {
    stubFetch(() => jsonResponse({ error: "unauthorized" }, { status: 401 }));
    expect(await getOwnedAgents("bearer-bad", "acme")).toEqual([]);
  });

  it("returns [] when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await getOwnedAgents("bearer-Y", "acme")).toEqual([]);
  });
});

describe("listOwnedConversations", () => {
  it("returns parsed conversations on 200", async () => {
    stubFetch(() =>
      jsonResponse({
        total: 1,
        conversations: [
          {
            conversation_id: "conv_1",
            first_seen_at: "2026-05-01T00:00:00Z",
            last_seen_at: "2026-05-01T01:00:00Z",
            event_count: 3,
            latest_event_type: "aap.invoke",
          },
        ],
      }),
    );
    const out = await listOwnedConversations("bearer-Z", "aid:agentagora:alice/x");
    expect(out.total).toBe(1);
    expect(out.conversations[0]?.conversation_id).toBe("conv_1");
  });

  it("returns empty result on 403 (cross-owner query)", async () => {
    stubFetch(() => jsonResponse({ error: "forbidden" }, { status: 403 }));
    const out = await listOwnedConversations("bearer-Z", "aid:agentagora:bob/x");
    expect(out).toEqual({ total: 0, conversations: [] });
  });

  it("returns empty result when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const out = await listOwnedConversations("bearer-Z", "aid:agentagora:alice/x");
    expect(out).toEqual({ total: 0, conversations: [] });
  });
});

describe("listOwnedDisputes", () => {
  it("issues two parallel queries (filer + respondent)", async () => {
    const seen: string[] = [];
    stubFetch((input) => {
      seen.push(typeof input === "string" ? input : input.toString());
      return jsonResponse({ total: 0, disputes: [] });
    });
    await listOwnedDisputes("b", "aid:agentagora:alice/x");
    expect(seen.some((u) => u.includes("filer="))).toBe(true);
    expect(seen.some((u) => u.includes("respondent="))).toBe(true);
  });

  it("merges + dedups disputes that appear in both filer and respondent results", async () => {
    const dup = {
      dispute_id: "disp_dup",
      conversation_id: "conv_1",
      filed_by: "alice",
      filer_aid: "aid:agentagora:alice/x",
      respondent_aid: "aid:agentagora:alice/x",
      reason: "non_delivery" as const,
      state: "open",
      filed_at: "2026-05-02T00:00:00Z",
    };
    stubFetch(() => jsonResponse({ total: 1, disputes: [dup] }));
    const out = await listOwnedDisputes("b", "aid:agentagora:alice/x");
    // Same dispute_id from both queries → returned once.
    expect(out.disputes).toHaveLength(1);
    expect(out.total).toBe(1);
  });

  it("sorts merged disputes by filed_at descending", async () => {
    const older = {
      dispute_id: "disp_older",
      filed_at: "2026-04-01T00:00:00Z",
      conversation_id: "c",
      filed_by: "x",
      filer_aid: "x",
      respondent_aid: "y",
      reason: "other" as const,
      state: "open",
    };
    const newer = { ...older, dispute_id: "disp_newer", filed_at: "2026-05-01T00:00:00Z" };
    let call = 0;
    stubFetch(() => {
      call++;
      return jsonResponse({
        total: 1,
        disputes: [call === 1 ? older : newer],
      });
    });
    const out = await listOwnedDisputes("b", "aid:agentagora:alice/x");
    expect(out.disputes.map((d) => d.dispute_id)).toEqual(["disp_newer", "disp_older"]);
  });

  it("returns empty list on full failure (both fetches reject)", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await listOwnedDisputes("b", "aid:agentagora:alice/x")).toEqual({
      total: 0,
      disputes: [],
    });
  });
});

describe("getConversation", () => {
  it("returns the event chain on 200", async () => {
    stubFetch(() =>
      jsonResponse({
        conversation_id: "conv_1",
        total: 1,
        events: [
          {
            event_id: "ev_1",
            conversation_id: "conv_1",
            actor_aid: "aid:agentagora:alice/x",
            type: "aap.invoke",
          },
        ],
      }),
    );
    const out = await getConversation("conv_1");
    expect(out?.conversation_id).toBe("conv_1");
    expect(out?.events).toHaveLength(1);
  });

  it("returns null on non-2xx", async () => {
    stubFetch(() => jsonResponse({}, { status: 500 }));
    expect(await getConversation("conv_1")).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await getConversation("conv_1")).toBeNull();
  });
});

describe("getStripeAccount", () => {
  it("returns kind:ok with status fields on 200", async () => {
    stubFetch(() =>
      jsonResponse({
        account_id: "acct_test",
        status: { details_submitted: true, charges_enabled: true, payouts_enabled: false },
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T01:00:00Z",
      }),
    );
    const out = await getStripeAccount("bearer-X");
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.account_id).toBe("acct_test");
      expect(out.status.charges_enabled).toBe(true);
    }
  });

  it("returns kind:missing on 404", async () => {
    stubFetch(() => jsonResponse({}, { status: 404 }));
    expect((await getStripeAccount("b")).kind).toBe("missing");
  });

  it("returns kind:unreachable on 5xx", async () => {
    stubFetch(() => jsonResponse({}, { status: 500 }));
    expect((await getStripeAccount("b")).kind).toBe("unreachable");
  });

  it("returns kind:unreachable when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect((await getStripeAccount("b")).kind).toBe("unreachable");
  });
});

describe("getDispute", () => {
  it("returns the case file on 200", async () => {
    stubFetch(() =>
      jsonResponse({
        dispute_id: "disp_1",
        conversation_id: "c1",
        filed_by: "alice",
        filer_aid: "aid:agentagora:alice/x",
        respondent_aid: "aid:agentagora:bob/y",
        reason: "non_delivery",
        state: "open",
        filed_at: "2026-05-01T00:00:00Z",
      }),
    );
    const out = await getDispute("disp_1");
    expect(out?.dispute_id).toBe("disp_1");
  });

  it("returns null on 404", async () => {
    stubFetch(() => jsonResponse({}, { status: 404 }));
    expect(await getDispute("disp_missing")).toBeNull();
  });

  it("returns null on 5xx", async () => {
    stubFetch(() => jsonResponse({}, { status: 500 }));
    expect(await getDispute("disp_1")).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await getDispute("disp_1")).toBeNull();
  });
});

describe("fileDispute", () => {
  const body = {
    conversation_id: "c1",
    filer_aid: "aid:agentagora:alice/x",
    respondent_aid: "aid:agentagora:bob/y",
    reason: "non_delivery" as const,
  };

  it("posts JSON with bearer + content-type", async () => {
    let methodSeen: string | undefined;
    let authSeen: string | null | undefined;
    let ctSeen: string | null | undefined;
    let bodySeen: string | undefined;
    stubFetch((_input, init) => {
      methodSeen = init?.method;
      const headers = new Headers(init?.headers);
      authSeen = headers.get("authorization");
      ctSeen = headers.get("content-type");
      bodySeen = init?.body as string;
      return jsonResponse({ dispute_id: "disp_x" }, { status: 201 });
    });

    await fileDispute("bearer-Y", body);
    expect(methodSeen).toBe("POST");
    expect(authSeen).toBe("Bearer bearer-Y");
    expect(ctSeen).toBe("application/json");
    expect(JSON.parse(bodySeen ?? "{}")).toEqual(body);
  });

  it("returns kind:ok on 201", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          dispute_id: "disp_new",
          conversation_id: "c1",
          filed_by: "alice",
          filer_aid: body.filer_aid,
          respondent_aid: body.respondent_aid,
          reason: body.reason,
          state: "open",
          filed_at: "2026-05-04T00:00:00Z",
        },
        { status: 201 },
      ),
    );
    const out = await fileDispute("b", body);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") expect(out.dispute.dispute_id).toBe("disp_new");
  });

  it("returns kind:error with field on 400 validation failure", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: "invalid_argument", message: "reason must be one of …", field: "reason" },
        { status: 400 },
      ),
    );
    const out = await fileDispute("b", body);
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.status).toBe(400);
      expect(out.error).toBe("invalid_argument");
      expect(out.field).toBe("reason");
      expect(out.message).toBe("reason must be one of …");
    }
  });

  it("returns kind:error with synthetic codes when body is empty / non-JSON", async () => {
    stubFetch(() => new Response("not json", { status: 401 }));
    const out = await fileDispute("b", body);
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.status).toBe(401);
      expect(out.error).toBe("http_401");
      expect(out.message).toBe("HTTP 401");
    }
  });

  it("returns kind:error{error:'unreachable'} when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const out = await fileDispute("b", body);
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.status).toBe(0);
      expect(out.error).toBe("unreachable");
    }
  });
});

describe("pingCloudApi", () => {
  it("returns 'ok' on 200", async () => {
    stubFetch(() => jsonResponse({ ok: true }));
    expect(await pingCloudApi()).toBe("ok");
  });

  it("returns 'unreachable' on 5xx", async () => {
    stubFetch(() => jsonResponse({}, { status: 503 }));
    expect(await pingCloudApi()).toBe("unreachable");
  });

  it("returns 'unreachable' when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await pingCloudApi()).toBe("unreachable");
  });

  it("hits /healthz", async () => {
    let urlSeen: string | undefined;
    stubFetch((input) => {
      urlSeen = typeof input === "string" ? input : input.toString();
      return jsonResponse({ ok: true });
    });
    await pingCloudApi();
    expect(urlSeen).toMatch(/\/healthz$/);
  });
});

describe("validateBearer (security-review-2026-05-07 §L3)", () => {
  it("returns 'invalid' on 401", async () => {
    stubFetch(() => jsonResponse({ error: "unauthorized" }, { status: 401 }));
    expect(await validateBearer("bad")).toBe("invalid");
  });

  it("returns 'ok' on 403 (valid bearer, cross-owner — the probe's sentinel owner)", async () => {
    stubFetch(() => jsonResponse({ error: "forbidden" }, { status: 403 }));
    expect(await validateBearer("good")).toBe("ok");
  });

  it("returns 'ok' on 200 (sentinel happens to match owner — vanishingly rare)", async () => {
    stubFetch(() => jsonResponse({ total: 0, agents: [] }));
    expect(await validateBearer("good")).toBe("ok");
  });

  it("returns 'unreachable' on 5xx", async () => {
    stubFetch(() => jsonResponse({}, { status: 503 }));
    expect(await validateBearer("good")).toBe("unreachable");
  });

  it("returns 'unreachable' when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await validateBearer("good")).toBe("unreachable");
  });

  it("sends the bearer in an Authorization header and probes /v1/agents?owner=<sentinel>", async () => {
    let urlSeen: string | undefined;
    let authSeen: string | null | undefined;
    stubFetch((input, init) => {
      urlSeen = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);
      authSeen = headers.get("authorization");
      return jsonResponse({ error: "forbidden" }, { status: 403 });
    });
    await validateBearer("the-actual-bearer");
    expect(authSeen).toBe("Bearer the-actual-bearer");
    expect(urlSeen).toMatch(/\/v1\/agents\?owner=/);
  });
});
