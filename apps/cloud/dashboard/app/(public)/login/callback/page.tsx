/**
 * /login/callback
 *
 * GitHub redirects the user's browser here with `?code=…&state=…`
 * after the OAuth consent screen. This Server Component:
 *
 *   1. Reads `code` and `state` from the URL.
 *   2. Reads the browser-bound OAuth nonce from the
 *      `__Host-agentagora_oauth_nonce` cookie set by /api/auth/github/start
 *      (security-review-2026-05 §H3).
 *   3. POSTs `{ code, state, nonce }` to cloud-api's
 *      /v1/auth/github/callback. cloud-api re-hashes the nonce and
 *      compares against the hash embedded inside the signed state — a
 *      leaked state alone is no longer enough to complete a login on
 *      a different browser. The exchange runs server-to-server, so
 *      the GitHub access token cloud-api receives never reaches this
 *      process or the browser; only the cloud-issued opaque bearer
 *      comes back.
 *   4. Encrypts the bearer + the GitHub login into the session cookie.
 *   5. Redirects to /home.
 *
 * The OAuth nonce cookie is cleared on success AND on every failure
 * branch so a half-finished flow can't be re-paired with a future
 * `state` value.
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

/** Mirror of OAUTH_NONCE_COOKIE in the start route — keeping this
 *  inline rather than importing a Route Handler module from a Server
 *  Component (Next.js bundles those as different roots).
 *  security-review-2026-05 §H3. */
const OAUTH_NONCE_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-agentagora_oauth_nonce"
    : "agentagora_oauth_nonce_dev";

function clearNonceCookie(): void {
  cookies().set(OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export default async function CallbackPage({
  searchParams,
}: {
  searchParams?: CallbackParams;
}) {
  // GitHub itself can also redirect back with `?error=…` (e.g. user
  // declined consent). Surface it as a generic callback failure.
  if (searchParams?.error) {
    clearNonceCookie();
    redirect("/login?error=github_callback");
  }

  const code = searchParams?.code;
  const state = searchParams?.state;
  if (!code || !state) {
    clearNonceCookie();
    redirect("/login?error=github_callback");
  }

  // security-review-2026-05 §H3: read the raw nonce that the start
  // route minted. Missing → state-binding can't be checked, fail
  // closed. cloud-api would also reject (state_nonce_mismatch), but
  // catching it here yields a clearer error code in the dashboard UI.
  const nonce = cookies().get(OAUTH_NONCE_COOKIE)?.value;
  if (!nonce) {
    clearNonceCookie();
    redirect("/login?error=github_state");
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
      body: JSON.stringify({ code, state, nonce }),
    });
  } catch (err) {
    console.error("[dashboard] /v1/auth/github/callback unreachable", err);
    clearNonceCookie();
    redirect("/login?error=github_callback");
  }

  if (res.status === 401) {
    clearNonceCookie();
    redirect("/login?error=github_state");
  }
  if (res.status === 502) {
    clearNonceCookie();
    redirect("/login?error=github_exchange");
  }
  if (!res.ok) {
    console.error(`[dashboard] /v1/auth/github/callback responded ${res.status}`);
    clearNonceCookie();
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
    clearNonceCookie();
    redirect("/login?error=github_callback");
  }

  if (!body.bearer || !body.owner_id) {
    clearNonceCookie();
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

  // Successful exchange — clear the now-spent nonce cookie.
  clearNonceCookie();

  redirect("/home");
}
