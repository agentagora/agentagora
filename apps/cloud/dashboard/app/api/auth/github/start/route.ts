/**
 * POST /api/auth/github/start
 *
 * Kicks off the GitHub OAuth dance:
 *   1. Calls cloud-api's /v1/auth/github/start to obtain
 *      `{ authorize_url, state }`.
 *   2. 302s the browser to authorize_url.
 *
 * Errors fall back to /login?error=…; the user can re-try GitHub or
 * use the closed-alpha bearer-paste fallback (the <details> block on
 * the login page).
 *
 * The state parameter is HMAC-signed by cloud-api with a key derived
 * from OIDC_SIGNING_KEY — we don't need to track it in a session
 * cookie here; the HMAC + freshness window is the CSRF defense.
 *
 * GET is intentionally not exposed — the form on the login page POSTs
 * here, which (combined with sameSite=lax cookies + same-origin) is
 * the standard pattern. A casual GET visit redirects back to /login.
 */

import { NextResponse } from "next/server";
import { BASE_URL } from "../../../../../lib/cloud-api";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const url = `${BASE_URL}/v1/auth/github/start`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (err) {
    console.error("[dashboard] /v1/auth/github/start unreachable", err);
    return NextResponse.redirect(new URL("/login?error=github_start_failed", req.url), {
      status: 303,
    });
  }

  if (res.status === 503) {
    // cloud-api signals GitHub OAuth not configured — surface the
    // copy that points the user at the bearer-paste fallback.
    return NextResponse.redirect(new URL("/login?error=github_not_configured", req.url), {
      status: 303,
    });
  }

  if (!res.ok) {
    console.error(`[dashboard] /v1/auth/github/start responded ${res.status}`);
    return NextResponse.redirect(new URL("/login?error=github_start_failed", req.url), {
      status: 303,
    });
  }

  let body: { authorize_url?: string; state?: string };
  try {
    body = (await res.json()) as { authorize_url?: string; state?: string };
  } catch {
    return NextResponse.redirect(new URL("/login?error=github_start_failed", req.url), {
      status: 303,
    });
  }

  if (!body.authorize_url) {
    return NextResponse.redirect(new URL("/login?error=github_start_failed", req.url), {
      status: 303,
    });
  }

  return NextResponse.redirect(body.authorize_url, { status: 303 });
}

export async function GET(req: Request): Promise<Response> {
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
