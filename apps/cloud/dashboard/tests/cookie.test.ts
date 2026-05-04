import { afterEach, beforeEach, describe, expect, it } from "vitest";

// We can't statically import `../lib/cookie` because COOKIE_NAME is
// resolved at module load time from `process.env.NODE_ENV`, and one of
// the tests below toggles NODE_ENV to "production" to exercise the
// fail-closed branch in resolveSecret(). Each test imports the module
// fresh after setting the desired env, via `vi.resetModules` /
// `await import(...)`.
//
// All other tests run with the default NODE_ENV ("test" under vitest),
// which exercises the dev path (ephemeral fallback secret) — fine for
// round-trip + tampering coverage; the secret never leaves the test
// process.

import { vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("cookie.encryptSession / decryptSession", () => {
  it("round-trips a SessionPayload", async () => {
    const { encryptSession, decryptSession } = await import("../lib/cookie");
    const payload = {
      bearer: "test-bearer-token-abcdef0123456789",
      ownerLabel: "gh:octocat",
      issuedAt: "2026-05-02T12:00:00.000Z",
      provider: "github" as const,
      githubLogin: "octocat",
    };

    const cipher = await encryptSession(payload);
    expect(typeof cipher).toBe("string");
    expect(cipher.length).toBeGreaterThan(0);

    const decoded = await decryptSession(cipher);
    expect(decoded).toEqual(payload);
  });

  it("returns null on empty string", async () => {
    const { decryptSession } = await import("../lib/cookie");
    expect(await decryptSession("")).toBeNull();
  });

  it("returns null on malformed base64url", async () => {
    const { decryptSession } = await import("../lib/cookie");
    // Characters outside the base64url alphabet — atob throws, the
    // catch around b64uDecode returns null.
    expect(await decryptSession("!!!not-base64!!!")).toBeNull();
  });

  it("returns null when ciphertext is shorter than IV+tag (12+16 bytes)", async () => {
    const { decryptSession } = await import("../lib/cookie");
    // 16 bytes worth of base64url (no padding) — way under the 28-byte
    // floor enforced by the length check.
    const tooShort = "AAAAAAAAAAAAAAAAAAAAAA";
    expect(await decryptSession(tooShort)).toBeNull();
  });

  it("returns null when ciphertext is tampered (single-byte flip)", async () => {
    const { encryptSession, decryptSession } = await import("../lib/cookie");
    const payload = {
      bearer: "bearer",
      ownerLabel: "owner",
      issuedAt: "2026-05-02T12:00:00.000Z",
    };
    const cipher = await encryptSession(payload);

    // Decode, flip one byte in the ciphertext region (after the 12-byte
    // IV), re-encode. AES-GCM's auth tag must reject this.
    const pad = "=".repeat((4 - (cipher.length % 4)) % 4);
    const norm = (cipher + pad).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(norm);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    bytes[20] = (bytes[20] ?? 0) ^ 0x01;
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    const tampered = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    expect(await decryptSession(tampered)).toBeNull();
  });
});

describe("cookie.COOKIE_NAME", () => {
  it("uses the dev variant when NODE_ENV !== 'production'", async () => {
    // Vitest sets NODE_ENV="test" by default; the cookie module's
    // top-level check resolves to the dev variant.
    const { COOKIE_NAME } = await import("../lib/cookie");
    expect(COOKIE_NAME).toBe("agentagora_session_dev");
  });

  it("uses the __Host- prefix when NODE_ENV === 'production'", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    vi.resetModules();
    const { COOKIE_NAME } = await import("../lib/cookie");
    expect(COOKIE_NAME).toBe("__Host-agentagora_session");
  });
});

describe("cookie production fail-closed (security-review-2026-05 §H1)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("encryptSession throws when DASHBOARD_COOKIE_SECRET is empty in production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.DASHBOARD_COOKIE_SECRET = "";
    const { encryptSession } = await import("../lib/cookie");
    await expect(
      encryptSession({
        bearer: "x",
        ownerLabel: "x",
        issuedAt: "2026-05-02T12:00:00.000Z",
      }),
    ).rejects.toThrow(/DASHBOARD_COOKIE_SECRET/);
  });

  it("encryptSession throws when DASHBOARD_COOKIE_SECRET is too short in production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.DASHBOARD_COOKIE_SECRET = "too-short";
    const { encryptSession } = await import("../lib/cookie");
    await expect(
      encryptSession({
        bearer: "x",
        ownerLabel: "x",
        issuedAt: "2026-05-02T12:00:00.000Z",
      }),
    ).rejects.toThrow(/shorter than 32 bytes/);
  });
});
