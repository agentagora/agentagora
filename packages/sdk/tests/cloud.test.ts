/**
 * Cloud connectivity — HttpRegistry / publishAgent / CloudAuditSink.
 *
 * All tests run against an injected fake fetch; the "registry" mints real
 * EdDSA identity certificates with a test key so HttpRegistry's JWKS
 * verification path is exercised for real, not stubbed.
 */

import * as ed from "@noble/ed25519";
import { describe, expect, it } from "vitest";
import { canonicalizeForSigning } from "../src/canonical.js";
import { CloudAuditSink, HttpRegistry, publishAgent } from "../src/cloud.js";
import { b64uDecode, b64uEncode, generatePrivateKey, publicKeyFrom } from "../src/index.js";
import { makeTwoAgentRig } from "./_fixtures.js";

const BOB_AID = "aid:agentagora:bob/echo";

/** Mint a compact EdDSA JWT the way the cloud's OidcIssuer does. */
async function mintIdentityJwt(options: {
  registryKey: Uint8Array;
  kid: string;
  sub: string;
  agentPubkeyB64u: string;
  expOffsetSec?: number;
}): Promise<string> {
  const enc = new TextEncoder();
  const header = b64uEncode(
    enc.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: options.kid })),
  );
  const now = Math.floor(1_750_000_000);
  const payload = b64uEncode(
    enc.encode(
      JSON.stringify({
        iss: "http://registry.test",
        sub: options.sub,
        aud: "agentagora",
        iat: now,
        exp: now + (options.expOffsetSec ?? 3600),
        "aap.pubkey": options.agentPubkeyB64u,
      }),
    ),
  );
  const sig = await ed.signAsync(enc.encode(`${header}.${payload}`), options.registryKey);
  return `${header}.${payload}.${b64uEncode(sig)}`;
}

/** A fake registry: JWKS + one published agent. Returns [fetch, callLog]. */
async function makeFakeRegistry(opts?: { subOverride?: string; corruptSig?: boolean }) {
  const registryKey = generatePrivateKey();
  const registryPub = await publicKeyFrom(registryKey);
  const bobKey = generatePrivateKey();
  const bobPub = await publicKeyFrom(bobKey);

  let jwt = await mintIdentityJwt({
    registryKey,
    kid: "k-test",
    sub: opts?.subOverride ?? BOB_AID,
    agentPubkeyB64u: b64uEncode(bobPub),
  });
  if (opts?.corruptSig) {
    const [h, p] = jwt.split(".");
    jwt = `${h}.${p}.${b64uEncode(new Uint8Array(64))}`;
  }

  const manifest = {
    manifest_version: 1,
    aid: BOB_AID,
    endpoints: { rpc: "http://bob.test:4602" },
    capabilities: [],
  };

  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/.well-known/jwks.json")) {
      return Response.json({
        keys: [
          { kty: "OKP", crv: "Ed25519", kid: "k-test", alg: "EdDSA", x: b64uEncode(registryPub) },
        ],
      });
    }
    if (url.includes("/v1/agents/")) {
      return Response.json({
        aid: BOB_AID,
        manifest,
        identity_jwt: jwt,
        published_at: "2026-06-01",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return { fakeFetch, calls, bobPub };
}

describe("HttpRegistry", () => {
  it("resolves an AID to a JWKS-verified pubkey + endpoint + manifest", async () => {
    const { fakeFetch, bobPub } = await makeFakeRegistry();
    const reg = new HttpRegistry({ baseUrl: "http://registry.test", fetch: fakeFetch });

    const resolved = await reg.resolveAgent(BOB_AID);
    expect(b64uEncode(resolved.pubkey)).toBe(b64uEncode(bobPub));
    expect(resolved.endpoint).toBe("http://bob.test:4602");
    expect(resolved.manifest.aid).toBe(BOB_AID);

    // Interface delegation.
    expect(b64uEncode(await reg.resolvePublicKey(BOB_AID))).toBe(b64uEncode(bobPub));
    expect(await reg.resolveEndpoint(BOB_AID)).toBe("http://bob.test:4602");
  });

  it("caches resolutions (one agent fetch for repeated resolves)", async () => {
    const { fakeFetch, calls } = await makeFakeRegistry();
    const reg = new HttpRegistry({ baseUrl: "http://registry.test", fetch: fakeFetch });
    await reg.resolveAgent(BOB_AID);
    await reg.resolveAgent(BOB_AID);
    await reg.resolveEndpoint(BOB_AID);
    expect(calls.filter((u) => u.includes("/v1/agents/")).length).toBe(1);

    reg.invalidate(BOB_AID);
    await reg.resolveAgent(BOB_AID);
    expect(calls.filter((u) => u.includes("/v1/agents/")).length).toBe(2);
  });

  it("rejects a certificate whose subject does not match the AID", async () => {
    const { fakeFetch } = await makeFakeRegistry({ subOverride: "aid:agentagora:mallory/fake" });
    const reg = new HttpRegistry({ baseUrl: "http://registry.test", fetch: fakeFetch });
    await expect(reg.resolveAgent(BOB_AID)).rejects.toThrow(/subject .* does not match/);
  });

  it("rejects a certificate with an invalid registry signature", async () => {
    const { fakeFetch } = await makeFakeRegistry({ corruptSig: true });
    const reg = new HttpRegistry({ baseUrl: "http://registry.test", fetch: fakeFetch });
    await expect(reg.resolveAgent(BOB_AID)).rejects.toThrow(/signature .* invalid/);
  });

  it("tolerates expired certificates by default, rejects with rejectExpired", async () => {
    const registryKey = generatePrivateKey();
    const registryPub = await publicKeyFrom(registryKey);
    const bobPub = await publicKeyFrom(generatePrivateKey());
    const expiredJwt = await mintIdentityJwt({
      registryKey,
      kid: "k-test",
      sub: BOB_AID,
      agentPubkeyB64u: b64uEncode(bobPub),
      expOffsetSec: -100_000_000, // long past
    });
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/.well-known/jwks.json")) {
        return Response.json({
          keys: [{ kty: "OKP", crv: "Ed25519", kid: "k-test", x: b64uEncode(registryPub) }],
        });
      }
      return Response.json({
        aid: BOB_AID,
        manifest: {
          manifest_version: 1,
          aid: BOB_AID,
          endpoints: { rpc: "http://b" },
          capabilities: [],
        },
        identity_jwt: expiredJwt,
      });
    }) as typeof fetch;

    const lenient = new HttpRegistry({ baseUrl: "http://r.test", fetch: fakeFetch });
    await expect(lenient.resolveAgent(BOB_AID)).resolves.toBeDefined();

    const strict = new HttpRegistry({
      baseUrl: "http://r.test",
      fetch: fakeFetch,
      rejectExpired: true,
    });
    await expect(strict.resolveAgent(BOB_AID)).rejects.toThrow(/expired/);
  });
});

describe("publishAgent", () => {
  const manifest = {
    manifest_version: 1 as const,
    aid: BOB_AID as never,
    endpoints: { rpc: "http://bob.test:4602" },
    capabilities: [],
    privacy: { data_retention_days: 7, pii_handling: "redact" as const, region_restriction: [] },
    metadata: { tags: [], languages: [], models_used: [] },
  };

  it("signs the canonical manifest bytes and posts the right headers", async () => {
    const privateKey = generatePrivateKey();
    let captured: { url: string; headers: Record<string, string>; body: string } | undefined;
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        url: String(input),
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
        body: String(init?.body),
      };
      return Response.json(
        { aid: BOB_AID, pubkey: "x", identity_jwt: "j", published_at: "t", published_by: "o" },
        { status: 201 },
      );
    }) as typeof fetch;

    await publishAgent({
      baseUrl: "http://registry.test/",
      manifest: manifest as never,
      ownerToken: "tok_owner",
      privateKey,
      fetch: fakeFetch,
    });

    expect(captured?.url).toBe("http://registry.test/v1/agents");
    expect(captured?.headers.authorization).toBe("Bearer tok_owner");
    // The detached signature must verify over the canonical bytes of the
    // exact JSON posted — the same check the server performs.
    const pubkey = b64uDecode(captured?.headers["x-aap-pubkey"] as string);
    const sig = b64uDecode(captured?.headers["x-aap-signature"] as string);
    const canonical = canonicalizeForSigning(JSON.parse(captured?.body as string));
    expect(await ed.verifyAsync(sig, canonical, pubkey)).toBe(true);
  });

  it("throws with the server's error detail on non-2xx", async () => {
    const fakeFetch = (async () =>
      Response.json(
        { error: "forbidden", message: "pinned to a different signing key" },
        { status: 403 },
      )) as typeof fetch;
    await expect(
      publishAgent({
        baseUrl: "http://r.test",
        manifest: manifest as never,
        ownerToken: "t",
        privateKey: generatePrivateKey(),
        fetch: fakeFetch,
      }),
    ).rejects.toThrow(/403 — forbidden: pinned to a different signing key/);
  });
});

describe("CloudAuditSink", () => {
  it("pushes incrementally: only events beyond the cursor, across syncs", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(bobAgent.aid, "ping", { message: "hi" });

    const batches: number[] = [];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { events } = JSON.parse(String(init?.body)) as { events: unknown[] };
      batches.push(events.length);
      return Response.json({ ingested: events.map(() => ({})), rejected: [] }, { status: 201 });
    }) as typeof fetch;

    const sink = new CloudAuditSink({ baseUrl: "http://cloud.test", fetch: fakeFetch });
    const first = await sink.sync(conv.audit);
    expect(first.pushed).toBe(conv.audit.events.length);

    // Nothing new → no request payload needed.
    const second = await sink.sync(conv.audit);
    expect(second.pushed).toBe(0);
    expect(batches).toEqual([conv.audit.events.length]);
  });

  it("advances the cursor only past server-ingested events on partial rejection", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(bobAgent.aid, "ping", { message: "hi" });
    const total = conv.audit.events.length;
    expect(total).toBeGreaterThan(1);

    let call = 0;
    const batches: number[] = [];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { events } = JSON.parse(String(init?.body)) as { events: unknown[] };
      batches.push(events.length);
      call++;
      if (call === 1) {
        // Server ingests only the first event, rejects the rest.
        return Response.json(
          {
            ingested: [{}],
            rejected: events
              .slice(1)
              .map(() => ({ event_id: "e", error: "broken_chain", message: "x" })),
          },
          { status: 207 },
        );
      }
      return Response.json({ ingested: events.map(() => ({})), rejected: [] }, { status: 201 });
    }) as typeof fetch;

    const sink = new CloudAuditSink({ baseUrl: "http://cloud.test", fetch: fakeFetch });
    await expect(sink.sync(conv.audit)).rejects.toThrow(/broken_chain/);

    // Retry resumes AFTER the one event the server accepted.
    const retry = await sink.sync(conv.audit);
    expect(retry.pushed).toBe(total - 1);
    expect(batches).toEqual([total, total - 1]);
  });
});

describe("Agent.listConversations", () => {
  it("enumerates every conversation the agent has a log for", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    expect(bobAgent.listConversations()).toEqual([]);
    const a = await aliceClient.callRich(bobAgent.aid, "ping", { message: "1" });
    const b = await aliceClient.callRich(bobAgent.aid, "ping", { message: "2" });
    expect(new Set(bobAgent.listConversations())).toEqual(new Set([a.id, b.id]));
  });
});
