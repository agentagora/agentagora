/**
 * /login/callback
 *
 * GitHub redirects the user's browser here with `?code=…&state=…`
 * after the OAuth consent screen. This Server Component:
 *
 *   1. Reads `code` and `state` from the URL.
 *   2. POSTs them to cloud-api's /v1/auth/github/callback. The exchange
 *      runs server-to-server — the GitHub access token cloud-api
 *      receives never reaches this process or the browser; only the
 *      cloud-issued opaque bearer comes back.
 *   3. Encrypts the bearer + the GitHub login into the session cookie.
 *   4. Redirects to /home.
 *
 * Errors land back on /login?error=… so the user can try GitHub again
 * or fall back to the bearer-paste collapsible.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BASE_URL } from "../../../../lib/cloud-api";
import { COOKIE_NAME, encryptSession } from "../../../../lib/cookie";

interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
}

export default async function CallbackPage({
  searchParams,
}: {
  searchParams?: CallbackParams;
}) {
  // GitHub itself can also redirect back with `?error=…` (e.g. user
  // declined consent). Surface it as a generic callback failure.
  if (searchParams?.error) {
    redirect("/login?error=github_callback");
  }

  const code = searchParams?.code;
  const state = searchParams?.state;
  if (!code || !state) {
    redirect("/login?error=github_callback");
  }

  const url = `${BASE_URL}/v1/auth/github/callback`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code, state }),
    });
  } catch (err) {
    console.error("[dashboard] /v1/auth/github/callback unreachable", err);
    redirect("/login?error=github_callback");
  }

  if (res.status === 401) {
    redirect("/login?error=github_state");
  }
  if (res.status === 502) {
    redirect("/login?error=github_exchange");
  }
  if (!res.ok) {
    console.error(`[dashboard] /v1/auth/github/callback responded ${res.status}`);
    redirect("/login?error=github_callback");
  }

  let body: { bearer?: string; owner_id?: string; github_login?: string };
  try {
    body = (await res.json()) as {
      bearer?: string;
      owner_id?: string;
      github_login?: string;
    };
  } catch {
    redirect("/login?error=github_callback");
  }

  if (!body.bearer || !body.owner_id) {
    redirect("/login?error=github_callback");
  }

  const cookieValue = await encryptSession({
    bearer: body.bearer,
    ownerLabel: body.owner_id,
    issuedAt: new Date().toISOString(),
    provider: "github",
    ...(body.github_login ? { githubLogin: body.github_login } : {}),
  });

  cookies().set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // 30-day session; cloud-api's oauth_sessions row has the matching
    // TTL, so the cookie and the server-side row expire together.
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect("/home");
}
