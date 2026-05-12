/**
 * POST /api/auth/logout
 *
 * Clears the session cookie and redirects to /login.
 *
 * The dashboard's logout button posts a plain HTML form to this
 * route — sameSite=lax on the cookie + same-origin form means the
 * cookie is sent and a CSRF token isn't required for a cookie-clear
 * action. The redirect keeps the no-JS path working.
 */

import { type UnsafeUnwrappedCookies, cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "../../../../lib/cookie";

export const runtime = "nodejs";

function clearAndRedirect(req: Request): Response {
  (cookies() as unknown as UnsafeUnwrappedCookies).set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  // Resolve the redirect against the request URL so we land on the
  // same origin the user is browsing (works in dev, in production,
  // and behind reverse proxies).
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: Request): Promise<Response> {
  return clearAndRedirect(req);
}

// Allow GET as well so a plain link can sign the user out (handy
// for tests / debugging). The cookie clear is idempotent.
export async function GET(req: Request): Promise<Response> {
  return clearAndRedirect(req);
}
