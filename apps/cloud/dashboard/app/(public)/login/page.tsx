/**
 * Closed-alpha login page.
 *
 * Single-field form: paste the bearer token issued in the cloud-api's
 * `OWNER_TOKENS` secret. The Server Action validates that the
 * cloud-api is reachable, encrypts the bearer into the session
 * cookie, then redirects to /home.
 *
 * Real OIDC sign-up replaces this in M3 task #A.2; the cookie
 * contract this page sets up is provider-agnostic so the swap is
 * mostly a route-handler change.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pingCloudApi } from "../../../lib/cloud-api";
import { COOKIE_NAME, encryptSession } from "../../../lib/cookie";

interface SearchParams {
  error?: string;
}

export default function LoginPage({ searchParams }: { searchParams?: SearchParams }) {
  async function login(formData: FormData) {
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
    });

    cookies().set(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // 7-day session. Real OIDC will replace this with shorter
      // access tokens + refresh.
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
      <h1 style={{ marginBottom: 4 }}>Owner login</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Paste the bearer token your operator issued you. This is the closed-alpha placeholder for{" "}
        <code>OWNER_TOKENS</code>; OIDC sign-up lands in M3.
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
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {errorLabel(error)}
        </div>
      ) : null}

      <form action={login} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 14, color: "#333" }}>Bearer token</span>
          <input
            type="password"
            name="token"
            autoComplete="off"
            required
            style={{
              padding: "10px 12px",
              border: "1px solid #ccc",
              borderRadius: 6,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 14, color: "#333" }}>
            Display name <span style={{ color: "#888" }}>(optional)</span>
          </span>
          <input
            type="text"
            name="label"
            autoComplete="off"
            placeholder="how the dashboard refers to you"
            style={{
              padding: "10px 12px",
              border: "1px solid #ccc",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
        </label>

        <button
          type="submit"
          style={{
            padding: "10px 16px",
            background: "#0366d6",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
      </form>

      <p style={{ marginTop: 24, fontSize: 13, color: "#666" }}>
        The token is encrypted with <code>DASHBOARD_COOKIE_SECRET</code> and stored in an httpOnly
        cookie. It is never exposed to JavaScript on the page.
      </p>
    </main>
  );
}

function errorLabel(code: string): string {
  switch (code) {
    case "missing":
      return "A bearer token is required.";
    case "unreachable":
      return "Cloud API is unreachable. Check AGENTAGORA_CLOUD_URL and try again.";
    default:
      return "Sign-in failed. Try again.";
  }
}
