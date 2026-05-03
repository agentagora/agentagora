/**
 * Login page.
 *
 * Two ways to sign in:
 *   1. "Sign in with GitHub" — POSTs to /api/auth/github/start, which
 *      redirects to GitHub's authorize URL via cloud-api's
 *      /v1/auth/github/start. The browser comes back to /login/callback
 *      after GitHub consent, and that page exchanges the code +
 *      mints the encrypted session cookie.
 *
 *   2. "Or paste a bearer token" (closed-alpha fallback, behind a
 *      <details> collapsible) — same Server Action the original login
 *      page used. CI / integration tests / agents on bare bearer
 *      tokens (configured via OWNER_TOKENS) keep working forever.
 *
 * The OAuth path runs entirely server-side: the dashboard's route
 * handler calls cloud-api on the server, and the GitHub access token
 * never reaches the browser. The only thing the cookie ever holds is
 * the cloud-api-issued opaque bearer.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pingCloudApi } from "../../../lib/cloud-api";
import { COOKIE_NAME, encryptSession } from "../../../lib/cookie";

interface SearchParams {
  error?: string;
}

export default function LoginPage({ searchParams }: { searchParams?: SearchParams }) {
  async function loginWithBearer(formData: FormData) {
    "use server";
    const token = String(formData.get("token") ?? "").trim();
    const label = String(formData.get("label") ?? "").trim();

    if (!token) {
      redirect("/login?error=missing");
    }

    const ping = await pingCloudApi();
    if (ping !== "ok") {
      redirect("/login?error=unreachable");
    }

    const cookieValue = await encryptSession({
      bearer: token,
      ownerLabel: label || "owner",
      issuedAt: new Date().toISOString(),
      provider: "static",
    });

    cookies().set(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // 7-day session for the static fallback. OAuth sessions get a
      // 30-day TTL bound by cloud-api's oauth_sessions row.
      maxAge: 60 * 60 * 24 * 7,
    });
    redirect("/home");
  }

  const error = searchParams?.error;

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "64px 24px",
        lineHeight: 1.55,
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Sign in</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        AgentAgora Cloud dashboard. Sign in with GitHub to manage your published agents.
      </p>

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid #d93025",
            background: "#fce8e6",
            color: "#7c0c00",
            borderRadius: 8,
            padding: 12,
            marginTop: 16,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {errorLabel(error)}
        </div>
      ) : null}

      <form action="/api/auth/github/start" method="POST" style={{ marginTop: 24 }}>
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "12px 16px",
            background: "#24292f",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Sign in with GitHub
        </button>
      </form>

      <details
        style={{
          marginTop: 32,
          padding: "12px 16px",
          background: "#f6f8fa",
          border: "1px solid #d0d7de",
          borderRadius: 6,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "#444",
          }}
        >
          Or paste a bearer token (closed-alpha fallback)
        </summary>

        <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
          Useful for CI, integration tests, or any agent that runs on a bare token issued via{" "}
          <code>OWNER_TOKENS</code>. The token is encrypted with{" "}
          <code>DASHBOARD_COOKIE_SECRET</code> in an httpOnly cookie.
        </p>

        <form
          action={loginWithBearer}
          style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#333" }}>Bearer token</span>
            <input
              type="password"
              name="token"
              autoComplete="off"
              required
              style={{
                padding: "8px 10px",
                border: "1px solid #ccc",
                borderRadius: 6,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 13,
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#333" }}>
              Display name <span style={{ color: "#888" }}>(optional)</span>
            </span>
            <input
              type="text"
              name="label"
              autoComplete="off"
              placeholder="how the dashboard refers to you"
              style={{
                padding: "8px 10px",
                border: "1px solid #ccc",
                borderRadius: 6,
                fontSize: 13,
              }}
            />
          </label>

          <button
            type="submit"
            style={{
              padding: "8px 14px",
              background: "#0366d6",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Sign in with bearer
          </button>
        </form>
      </details>
    </main>
  );
}

function errorLabel(code: string): string {
  switch (code) {
    case "missing":
      return "A bearer token is required.";
    case "unreachable":
      return "Cloud API is unreachable. Check AGENTAGORA_CLOUD_URL and try again.";
    case "github_not_configured":
      return "GitHub sign-in is not configured on the cloud-api. Use the bearer fallback below.";
    case "github_start_failed":
      return "Could not start GitHub sign-in. Try again or use the bearer fallback.";
    case "github_state":
      return "GitHub sign-in state was invalid or expired. Try again.";
    case "github_exchange":
      return "GitHub did not authorise the sign-in. Try again.";
    case "github_callback":
      return "GitHub sign-in failed. Try again or use the bearer fallback.";
    default:
      return "Sign-in failed. Try again.";
  }
}
