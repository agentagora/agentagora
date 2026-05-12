/**
 * POST /api/auth/login
 *
 * Programmatic / non-form sign-in. The login *page* uses a Server
 * Action (CSRF-protected by Next.js's built-in token); this Route
 * Handler is the JSON-API equivalent for tools / scripts. It sets
 * the same encrypted session cookie.
 *
 * CSRF: this handler is JSON-only, requires `content-type:
 * application/json`, and is on the same origin as the dashboard, so
 * a cross-site form post can't reach it (forms can only send
 * urlencoded / multipart bodies). For browser callers, the
 * recommended path is the Server Action on `/login`.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { pingCloudApi } from "../../../../lib/cloud-api";
import { COOKIE_NAME, encryptSession } from "../../../../lib/cookie";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "unsupported_media_type", message: "expected application/json" },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "expected JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "invalid_body", message: "expected an object" },
      { status: 400 },
    );
  }
  const token = (body as { token?: unknown }).token;
  const label = (body as { label?: unknown }).label;
  if (typeof token !== "string" || token.trim().length === 0) {
    return NextResponse.json(
      { error: "missing_token", message: "`token` is required" },
      { status: 400 },
    );
  }

  const ping = await pingCloudApi();
  if (ping !== "ok") {
    return NextResponse.json(
      { error: "cloud_unreachable", message: "cloud-api did not respond to /healthz" },
      { status: 502 },
    );
  }

  const cookieValue = await encryptSession({
    bearer: token.trim(),
    ownerLabel: typeof label === "string" && label.trim() ? label.trim() : "owner",
    issuedAt: new Date().toISOString(),
  });

  (await cookies()).set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({ ok: true });
}
