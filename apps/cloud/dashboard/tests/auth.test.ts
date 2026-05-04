import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock both `next/headers` (for `cookies()`) and `next/navigation`
// (for `redirect()`). The dashboard never installs Next at test time —
// the package is present in node_modules from the workspace install,
// but we still mock to keep the tests pure and deterministic.
//
// `mockedStore` is mutated per-test so each case can stage a different
// cookie value (or none).

type CookieEntry = { value: string };
const mockedStore = {
  _entries: new Map<string, CookieEntry>(),
  get(name: string): CookieEntry | undefined {
    return this._entries.get(name);
  },
  set(name: string, value: string) {
    this._entries.set(name, { value });
  },
  clear() {
    this._entries.clear();
  },
};

const redirectMock = vi.fn((path: string) => {
  // next/navigation's `redirect()` throws a NEXT_REDIRECT error rather
  // than returning. Mirror that so `requireOwner` doesn't fall through
  // to `return session` on the no-session path.
  throw new Error(`__redirect__:${path}`);
});

vi.mock("next/headers", () => ({
  cookies: () => mockedStore,
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import { encryptSession } from "../lib/cookie";

beforeEach(() => {
  mockedStore.clear();
  redirectMock.mockClear();
});

afterEach(() => {
  mockedStore.clear();
});

describe("getOwnerSession", () => {
  it("returns the decrypted payload when a valid encrypted cookie is present", async () => {
    const payload = {
      bearer: "bearer-xyz",
      ownerLabel: "gh:octocat",
      issuedAt: "2026-05-02T12:00:00.000Z",
      provider: "github" as const,
      githubLogin: "octocat",
    };
    const cipher = await encryptSession(payload);
    // Default NODE_ENV in vitest is "test" → dev cookie name.
    mockedStore.set("agentagora_session_dev", cipher);

    const { getOwnerSession } = await import("../lib/auth");
    const session = await getOwnerSession();
    expect(session).toEqual(payload);
  });

  it("returns null when no cookie is present", async () => {
    const { getOwnerSession } = await import("../lib/auth");
    expect(await getOwnerSession()).toBeNull();
  });

  it("returns null when the cookie value fails to decrypt", async () => {
    mockedStore.set("agentagora_session_dev", "not-a-valid-cipher");
    const { getOwnerSession } = await import("../lib/auth");
    expect(await getOwnerSession()).toBeNull();
  });

  it("returns null when the decrypted payload doesn't match the schema", async () => {
    // Encrypt JSON that decrypts cleanly but is missing required fields.
    // We do this by hand-rolling a payload that lacks `bearer`. The
    // decryptSession check requires bearer+ownerLabel+issuedAt to all be
    // strings, so a partial object is rejected.
    const cipher = await encryptSession({
      // @ts-expect-error — intentionally malformed for the schema check
      bearer: 123,
      ownerLabel: "owner",
      issuedAt: "2026-05-02T12:00:00.000Z",
    });
    mockedStore.set("agentagora_session_dev", cipher);

    const { getOwnerSession } = await import("../lib/auth");
    expect(await getOwnerSession()).toBeNull();
  });
});

describe("requireOwner", () => {
  it("calls redirect('/login') when there's no session", async () => {
    const { requireOwner } = await import("../lib/auth");
    await expect(requireOwner()).rejects.toThrow("__redirect__:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("returns the session when one is present", async () => {
    const payload = {
      bearer: "bearer-xyz",
      ownerLabel: "owner",
      issuedAt: "2026-05-02T12:00:00.000Z",
    };
    const cipher = await encryptSession(payload);
    mockedStore.set("agentagora_session_dev", cipher);

    const { requireOwner } = await import("../lib/auth");
    const session = await requireOwner();
    expect(session).toEqual(payload);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

// Skipped: a real Server Component renderer would let us assert that
// the layout / page actually short-circuits to /login when requireOwner
// throws. That requires either react-server-dom + happy-dom, or a full
// Next test harness — both deliberately out of scope for this round
// (constraint: no jsdom/happy-dom, no React rendering). Revisit when
// the dashboard test suite expands beyond pure-logic helpers.
it.skip("layout redirects to /login when requireOwner has no session (needs Server Component renderer)", () => {});
