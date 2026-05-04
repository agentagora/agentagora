/**
 * POST /api/auth/github/start
 *
 * Kicks off the GitHub OAuth dance:
 *   1. Generates a 32-byte browser-bound nonce, stores the raw nonce
 *      in an httpOnly `__Host-agentagora_oauth_nonce` cookie, and posts
 *      its SHA-256 hash to cloud-api's /v1/auth/github/start
 *      (security-review-2026-05 §H3).
 *   2. cloud-api returns `{ authorize_url, state }` where `state` is
 *      HMAC-signed and embeds the nonce hash.
 *   3. We 303 the browser to authorize_url AFTER validating that the
 *      URL points at github.com/login/oauth/authorize — defence-in-
 *      depth against a spoofed cloud-api response (security-review-
 *      2026-05 §M4). cloud-api shouldn't return anything else, but
 *      the dashboard verifies anyway.
 *
 * Errors fall back to /login?error=…; the user can re-try GitHub or
 * use the closed-alpha bearer-paste fallback (the <details> block on
 * the login page).
 *
 * GET is intentionally not exposed — the form on the login page POSTs
 * here, which (combined with sameSite=lax cookies + same-origin) is
 * the standard pattern. A casual GET visit redirects back to /login.
 */

import { NextResponse } from "next/server";
import { BASE_URL } from "../../../../../lib/cloud-api";

export const runtime = "nodejs";

/**
 * Cookie name for the OAuth nonce. The `__Host-` prefix forces Secure
 * + Path=/ + no Domain at the browser level (security-review-2026-05
 * §H3). In dev (no Secure on http://localhost) we drop the prefix so
 * the cookie can still be set.
 */
const OAUTH_NONCE_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-agentagora_oauth_nonce"
    : "agentagora_oauth_nonce_dev";

/** 10 minutes — matches cloud-api's STATE_TTL_MS. */
const NONCE_TTL_SECONDS = 10 * 60;

const ENC = new TextEncoder();

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256B64u(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ENC.encode(input));
  return b64uEncode(new Uint8Array(digest));
}

function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64uEncode(bytes);
}

function failureRedirect(req: Request, code: string): Response {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, req.url), { status: 303 });
  // security-review-2026-05 §H3: clear any stale nonce cookie on
  // failure so a half-finished flow can't be paired with a future state.
  res.cookies.set(OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function POST(req: Request): Promise<Response> {
  const url = `${BASE_URL}/v1/auth/github/start`;

  // security-review-2026-05 §H3: mint a fresh per-flow nonce, send the
  // hash to cloud-api so it ends up inside the signed state, and stash
  // the raw nonce in an httpOnly cookie that the callback page reads
  // back. Without this binding any leaked `state` value can complete a
  // login against a different browser within the 10-minute TTL.
  const nonce = generateNonce();
  const nonceHash = await sha256B64u(nonce);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ nonce_hash: nonceHash }),
    });
  } catch (err) {
    console.error("[dashboard] /v1/auth/github/start unreachable", err);
    return failureRedirect(req, "github_start_failed");
  }

  if (res.status === 503) {
    // cloud-api signals GitHub OAuth not configured — surface the
    // copy that points the user at the bearer-paste fallback.
    return failureRedirect(req, "github_not_configured");
  }

  if (!res.ok) {
    console.error(`[dashboard] /v1/auth/github/start responded ${res.status}`);
    return failureRedirect(req, "github_start_failed");
  }

  let body: { authorize_url?: string; state?: string };
  try {
    body = (await res.json()) as { authorize_url?: string; state?: string };
  } catch {
    return failureRedirect(req, "github_start_failed");
  }

  if (!body.authorize_url) {
    return failureRedirect(req, "github_start_failed");
  }

  // security-review-2026-05 §M4: defence-in-depth against a spoofed
  // cloud-api response — refuse to redirect anywhere except GitHub's
  // canonical authorize endpoint. cloud-api wouldn't return anything
  // else under normal operation, but the dashboard verifies regardless
  // so a compromised upstream can't turn /api/auth/github/start into
  // an open redirector.
  let target: URL;
  try {
    target = new URL(body.authorize_url);
  } catch {
    console.error(`[dashboard] /v1/auth/github/start returned non-URL: ${body.authorize_url}`);
    return new NextResponse(
      JSON.stringify({
        error: "bad_gateway",
        message: "cloud-api returned an unparseable authorize_url",
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
  if (target.host !== "github.com" || target.pathname !== "/login/oauth/authorize") {
    console.error(
      `[dashboard] /v1/auth/github/start returned non-GitHub URL: ${body.authorize_url}`,
    );
    return new NextResponse(
      JSON.stringify({
        error: "bad_gateway",
        message: "cloud-api returned a non-GitHub authorize_url",
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  const redirectRes = NextResponse.redirect(target.toString(), { status: 303 });
  // Set the raw nonce cookie. httpOnly + sameSite=lax + Secure (prod)
  // + Path=/ + no Domain → the `__Host-` prefix is honoured.
  redirectRes.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: NONCE_TTL_SECONDS,
  });
  return redirectRes;
}

export async function GET(req: Request): Promise<Response> {
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}

export { OAUTH_NONCE_COOKIE };
