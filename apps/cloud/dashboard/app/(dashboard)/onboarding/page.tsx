/**
 * Stripe Connect onboarding entrypoint.
 *
 * Server-renders the caller's `GET /v1/connect/account` response and
 * branches on the four states:
 *   - cloud-api unreachable           → "try again in a moment"
 *   - 404 (no account yet)            → render <OnboardingForm> to create one
 *   - account_id + !details_submitted → render <OnboardingForm> with "Resume" CTA
 *   - charges_enabled: true           → done banner with the account_id
 *
 * The bearer is read from the encrypted session cookie here on the
 * server (`requireOwner()` → `session.bearer`) and then forwarded to
 * the Client Component as a render-time prop. It never travels via
 * URL or response body — same pattern as the publish form.
 */

import { requireOwner } from "../../../lib/auth";
import { BASE_URL, getStripeAccount } from "../../../lib/cloud-api";
import { OnboardingForm } from "./_onboarding-form";

export default async function OnboardingPage() {
  const session = await requireOwner();
  const account = await getStripeAccount(session.bearer);

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, marginBottom: 4 }}>Stripe Connect onboarding</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          Connect a Stripe Express account so capabilities priced in real money can route payouts to
          you. The dashboard hands you off to Stripe's hosted onboarding flow; you'll land back here
          when it's done.
        </p>
      </header>

      <Body account={account} bearer={session.bearer} email={session.ownerLabel} />
    </div>
  );
}

type AccountResult = Awaited<ReturnType<typeof getStripeAccount>>;

function Body({
  account,
  bearer,
  email,
}: {
  account: AccountResult;
  bearer: string;
  email: string;
}) {
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
          We couldn't read your Stripe account status. Try again in a moment.
        </p>
      </div>
    );
  }

  if (account.kind === "missing") {
    return (
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Create your Stripe Connect account</h2>
        <p style={{ color: "#555", marginTop: 0 }}>
          Submitting this form creates an Express account on Stripe and forwards you to their hosted
          onboarding form. Country and email are passed straight through to Stripe.
        </p>
        <OnboardingForm
          cloudApiBaseUrl={BASE_URL}
          bearer={bearer}
          defaultEmail={looksLikeEmail(email) ? email : undefined}
          submitLabel="Start Stripe onboarding"
        />
      </section>
    );
  }

  // account.kind === "ok"
  const { status, account_id, created_at, updated_at } = account;

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
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Onboarding complete</h2>
        <p style={{ color: "#1f5a1f" }}>
          Account <code>{account_id}</code> is ready to receive payouts.
        </p>
        <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
      </div>
    );
  }

  if (!status.details_submitted) {
    return (
      <section>
        <div
          style={{
            border: "1px solid #e3a23a",
            background: "#fff8e8",
            borderRadius: 8,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Resume onboarding</h2>
          <p style={{ color: "#5a4400", marginBottom: 0 }}>
            Your Stripe account <code>{account_id}</code> exists but Stripe still needs the rest of
            your business details. Re-submit to fetch a fresh hosted-onboarding link (Stripe links
            expire after a short window).
          </p>
        </div>
        <OnboardingForm
          cloudApiBaseUrl={BASE_URL}
          bearer={bearer}
          defaultEmail={looksLikeEmail(email) ? email : undefined}
          submitLabel="Resume onboarding"
        />
        <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
      </section>
    );
  }

  // details_submitted: true but charges_enabled still false — Stripe
  // is reviewing. We don't generate a new link in that state; the
  // user just waits.
  return (
    <div
      style={{
        border: "1px solid #e3e3e3",
        background: "#fff",
        borderRadius: 8,
        padding: 20,
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Stripe is reviewing your account</h2>
      <p style={{ color: "#555" }}>
        You've submitted your details; Stripe hasn't enabled charges yet. This is normal and usually
        clears within a business day.
      </p>
      <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
    </div>
  );
}

function AccountMeta({
  accountId,
  createdAt,
  updatedAt,
}: {
  accountId: string;
  createdAt: string;
  updatedAt: string;
}) {
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        gap: "4px 16px",
        fontSize: 13,
        marginTop: 16,
        marginBottom: 0,
      }}
    >
      <dt style={{ color: "#666" }}>account_id</dt>
      <dd style={{ margin: 0 }}>
        <code>{accountId}</code>
      </dd>
      <dt style={{ color: "#666" }}>created</dt>
      <dd style={{ margin: 0 }}>{createdAt}</dd>
      <dt style={{ color: "#666" }}>updated</dt>
      <dd style={{ margin: 0 }}>{updatedAt}</dd>
    </dl>
  );
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
