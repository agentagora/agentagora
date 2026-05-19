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
import { pingCloudApi, validateBearer } from "../../../lib/cloud-api";
import { COOKIE_NAME, encryptSession } from "../../../lib/cookie";
import { Alert } from "../../_components/alert";
import { Button } from "../../_components/button";
import { Input } from "../../_components/input";
import { Field, FormHint, Label } from "../../_components/label";
import { AuthShell } from "../../_layouts/auth-shell";

interface SearchParams {
  error?: string;
}

export default async function LoginPage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;

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

    const verdict = await validateBearer(token);
    if (verdict === "invalid") {
      redirect("/login?error=invalid_token");
    }
    if (verdict === "unreachable") {
      redirect("/login?error=unreachable");
    }

    const cookieValue = await encryptSession({
      bearer: token,
      ownerLabel: label || "owner",
      issuedAt: new Date().toISOString(),
      provider: "static",
    });

    (await cookies()).set(COOKIE_NAME, cookieValue, {
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
    <AuthShell
      title="Sign in"
      description="AgentAgora Cloud dashboard. Sign in with GitHub to manage your published agents."
      banner={
        error ? (
          <Alert tone="danger" role="alert">
            {errorLabel(error)}
          </Alert>
        ) : undefined
      }
      footer={
        <span>
          Don't have an account yet?{" "}
          <a
            href="https://github.com/agentagora/agentagora"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
          >
            Browse the project on GitHub
          </a>
          .
        </span>
      }
    >
      <form action="/api/auth/github/start" method="POST" className="flex flex-col gap-3">
        <Button type="submit" size="lg" fullWidth>
          <GithubMark />
          Sign in with GitHub
        </Button>
      </form>

      <details className="mt-6 rounded-md border border-accent-100 bg-accent-50/40 px-4 py-3 text-sm open:py-4">
        <summary className="cursor-pointer select-none font-medium text-accent-700 hover:text-accent-900">
          Or paste a bearer token <span className="text-accent-500">(closed-alpha fallback)</span>
        </summary>

        <div className="mt-4 flex flex-col gap-3">
          <FormHint>
            Useful for CI, integration tests, or any agent that runs on a bare token issued via{" "}
            <code className="rounded bg-accent-100 px-1 py-0.5 font-mono text-[12px]">
              OWNER_TOKENS
            </code>
            . The token is encrypted with{" "}
            <code className="rounded bg-accent-100 px-1 py-0.5 font-mono text-[12px]">
              DASHBOARD_COOKIE_SECRET
            </code>{" "}
            in an httpOnly cookie.
          </FormHint>

          <form action={loginWithBearer} className="flex flex-col gap-3">
            <Field>
              <Label htmlFor="bearer-token">Bearer token</Label>
              <Input
                id="bearer-token"
                type="password"
                name="token"
                autoComplete="off"
                required
                mono
              />
            </Field>

            <Field>
              <Label htmlFor="bearer-label" hint="(optional)">
                Display name
              </Label>
              <Input
                id="bearer-label"
                type="text"
                name="label"
                autoComplete="off"
                placeholder="how the dashboard refers to you"
              />
            </Field>

            <Button type="submit" variant="secondary" size="md" className="self-start">
              Sign in with bearer
            </Button>
          </form>
        </div>
      </details>
    </AuthShell>
  );
}

function GithubMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.466-1.332-5.466-5.93 0-1.31.468-2.381 1.235-3.221-.135-.302-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.957-.266 1.98-.398 3-.404 1.02.006 2.043.138 3 .404 2.295-1.552 3.3-1.23 3.3-1.23.645 1.653.24 2.874.12 3.176.765.84 1.23 1.911 1.23 3.221 0 4.609-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.215v3.285c0 .32.21.694.825.576 4.765-1.587 8.2-6.083 8.2-11.386 0-6.626-5.373-12-12-12" />
    </svg>
  );
}

function errorLabel(code: string): string {
  switch (code) {
    case "missing":
      return "A bearer token is required.";
    case "unreachable":
      return "Cloud API is unreachable. Check AGENTAGORA_CLOUD_URL and try again.";
    case "invalid_token":
      return "Cloud API rejected that bearer (401). Check the value and try again.";
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
