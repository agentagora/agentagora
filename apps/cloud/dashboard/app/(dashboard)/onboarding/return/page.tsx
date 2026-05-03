/**
 * Stripe Connect onboarding — return URL.
 *
 * Stripe sends the user here after they've finished (or abandoned)
 * the hosted onboarding flow. We re-fetch the account status so we
 * can tell them what happened:
 *
 *   - charges_enabled: true   → "Done — your account is live."
 *   - account exists, !ce     → "Stripe is still verifying; refresh in a minute."
 *   - 404 / unreachable       → fall back to the main onboarding page.
 *
 * We never trust query parameters from Stripe's redirect — Stripe's
 * docs explicitly call out that the return URL is *not* a webhook,
 * so the fact that the user landed here doesn't prove anything; we
 * have to ask cloud-api.
 */

import Link from "next/link";
import { requireOwner } from "../../../../lib/auth";
import { getStripeAccount } from "../../../../lib/cloud-api";

export default async function OnboardingReturnPage() {
  const session = await requireOwner();
  const account = await getStripeAccount(session.bearer);

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, marginBottom: 4 }}>Welcome back from Stripe</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          Re-checking your Stripe Connect account status.
        </p>
      </header>

      <Body account={account} />
    </div>
  );
}

type AccountResult = Awaited<ReturnType<typeof getStripeAccount>>;

function Body({ account }: { account: AccountResult }) {
  if (account.kind === "unreachable") {
    return (
      <div
        style={{
          border: "1px solid #f0c0c0",
          background: "#fff5f5",
          color: "#7a1f1f",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Cloud-api is unreachable</h2>
        <p style={{ margin: 0 }}>
          We couldn't read your Stripe account status. Try again in a moment, or{" "}
          <RefreshLink label="refresh" />.
        </p>
      </div>
    );
  }

  if (account.kind === "missing") {
    return (
      <div
        style={{
          border: "1px solid #e3e3e3",
          background: "#fff",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>No Stripe account on file</h2>
        <p style={{ color: "#555" }}>
          We don't have a Stripe Connect account associated with your owner ID yet. Head back to{" "}
          <Link href="/onboarding" style={linkStyle}>
            /onboarding
          </Link>{" "}
          to start over.
        </p>
      </div>
    );
  }

  const { status, account_id, updated_at } = account;

  if (status.charges_enabled) {
    return (
      <div
        style={{
          border: "1px solid #c3e6c3",
          background: "#f3fbf3",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Done — your account is live.</h2>
        <p style={{ color: "#1f5a1f", marginBottom: 0 }}>
          Account <code>{account_id}</code> can now receive payouts. Updated{" "}
          <time>{updated_at}</time>.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #e3a23a",
        background: "#fff8e8",
        borderRadius: 8,
        padding: 20,
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Stripe is still verifying</h2>
      <p style={{ color: "#5a4400" }}>
        Stripe hasn't enabled charges on account <code>{account_id}</code> yet. This is normal —
        verification usually clears within a few minutes for most countries, longer for some.
        Refresh in a minute.
      </p>
      <RefreshLink label="Refresh now" />
    </div>
  );
}

function RefreshLink({ label }: { label: string }) {
  return (
    <Link href="/onboarding/return" style={linkStyle}>
      {label}
    </Link>
  );
}

const linkStyle: React.CSSProperties = {
  color: "#0366d6",
  textDecoration: "underline",
};
