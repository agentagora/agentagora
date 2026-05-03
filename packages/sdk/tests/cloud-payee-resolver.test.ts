/**
 * cloudPayeeAccountResolver tests.
 *
 *   - 200 with { account_id } → returns it; subsequent calls hit cache
 *   - 404 → returns undefined; cached
 *   - 5xx / network error → returns undefined, no cache poisoning
 */

import { describe, expect, it } from "vitest";
import { cloudPayeeAccountResolver } from "../src/settlement/stripe.js";

interface StubResponseSpec {
  status: number;
  body?: object;
}

function stubFetch(specs: StubResponseSpec[]): {
  fn: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  const fn = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const spec = specs[Math.min(i, specs.length - 1)];
    i++;
    return new Response(JSON.stringify(spec?.body ?? {}), {
      status: spec?.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

describe("cloudPayeeAccountResolver", () => {
  it("returns the account id for a known AID", async () => {
    const { fn, calls } = stubFetch([
      { status: 200, body: { aid: "aid:x", account_id: "acct_alice_42" } },
    ]);
    const resolver = cloudPayeeAccountResolver("https://cloud.test", { fetchImpl: fn });
    expect(await resolver("aid:agentagora:alice/code")).toBe("acct_alice_42");
    expect(calls[0]).toContain("/v1/connect/accounts/aid%3Aagentagora%3Aalice%2Fcode");
  });

  it("caches the result so subsequent calls don't re-fetch", async () => {
    const { fn, calls } = stubFetch([{ status: 200, body: { account_id: "acct_alice" } }]);
    const resolver = cloudPayeeAccountResolver("https://cloud.test", { fetchImpl: fn });
    await resolver("aid:agentagora:alice/x");
    await resolver("aid:agentagora:alice/x");
    expect(calls).toHaveLength(1);
  });

  it("caches 404 as undefined", async () => {
    const { fn, calls } = stubFetch([{ status: 404 }]);
    const resolver = cloudPayeeAccountResolver("https://cloud.test", { fetchImpl: fn });
    expect(await resolver("aid:agentagora:nobody/x")).toBeUndefined();
    expect(await resolver("aid:agentagora:nobody/x")).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("returns undefined on 5xx without poisoning cache (next call retries)", async () => {
    const { fn, calls } = stubFetch([
      { status: 503 },
      { status: 200, body: { account_id: "acct_alice" } },
    ]);
    const resolver = cloudPayeeAccountResolver("https://cloud.test", { fetchImpl: fn });
    expect(await resolver("aid:agentagora:alice/x")).toBeUndefined();
    expect(await resolver("aid:agentagora:alice/x")).toBe("acct_alice");
    expect(calls).toHaveLength(2);
  });

  it("returns undefined when fetch throws (network error)", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const resolver = cloudPayeeAccountResolver("https://cloud.test", { fetchImpl: failing });
    expect(await resolver("aid:agentagora:alice/x")).toBeUndefined();
  });

  it("strips trailing slashes from cloudUrl", async () => {
    const { fn, calls } = stubFetch([{ status: 200, body: { account_id: "acct" } }]);
    const resolver = cloudPayeeAccountResolver("https://cloud.test///", { fetchImpl: fn });
    await resolver("aid:agentagora:alice/x");
    expect(calls[0]?.startsWith("https://cloud.test/v1/connect/accounts/")).toBe(true);
  });
});
