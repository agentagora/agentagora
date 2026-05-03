/**
 * Earnings + Stripe Connect status.
 *
 * Server-renders the caller's `GET /v1/connect/account` response and
 * branches on the three states the cloud-api can return:
 *   - 404 (no account yet)            → "connect a Stripe account"
 *   - 200 + details_submitted: false  → "finish onboarding"
 *   - 200 + charges_enabled: true     → "connected; payouts pending M3 §A.4"
 *
 * We don't render a number for "earnings" because the cloud doesn't
 * index per-AID payouts yet — destination charges + the per-AID
 * ledger join land in M3 §A.4. Showing $0 would be a lie; saying so
 * explicitly is the v0 behavior.
 *
 * TODO(cloud-api): expose `GET /v1/connect/payouts?owner=<id>` (or
 * an equivalent ledger view) so the dashboard can show an earnings
 * total per AID once destination charges go live.
 */

import Link from "next/link";
import { requireOwner } from "../../../lib/auth";
import { type StripeAccountResult, getStripeAccount } from "../../../lib/cloud-api";

export default async function EarningsPage() {
  const session = await requireOwner();
  const account = await getStripeAccount(session.bearer);

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, marginBottom: 4 }}>Earnings</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          Stripe Connect onboarding status. Per-AID payout tracking ships with destination charges
          (M3 §A.4) — until then the dashboard intentionally does not display a number.
        </p>
      </header>

      <StatusCard account={account} />

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Earnings</h2>
        <p style={{ color: "#555", margin: 0 }}>
          The cloud doesn't index per-AID payouts yet. Once destination charges are live, this page
          will surface a per-agent earnings total joined from the Stripe ledger.
        </p>
      </section>
    </div>
  );
}

function StatusCard({ account }: { account: StripeAccountResult }) {
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
          We couldn't read your Stripe account status. The cloud-api may be down — try again in a
          moment.
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
        <h2 style={{ marginTop: 0, fontSize: 16 }}>You haven't connected a Stripe account yet</h2>
        <p style={{ color: "#555" }}>
          Agents can publish without payouts, but capabilities priced in real money need a Stripe
          Connect account to receive funds.
        </p>
        <Link
          href="/onboarding"
          style={{
            display: "inline-block",
            padding: "8px 14px",
            background: "#0366d6",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Connect Stripe →
        </Link>
      </div>
    );
  }

  // account.kind === "ok"
  const { status, account_id, created_at, updated_at } = account;

  if (!status.details_submitted) {
    return (
      <div
        style={{
          border: "1px solid #e3a23a",
          background: "#fff8e8",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Onboarding incomplete</h2>
        <p style={{ color: "#5a4400" }}>
          Your Stripe account exists but hasn't finished onboarding. Stripe needs the rest of your
          business details before you can accept payouts.
        </p>
        <Link
          href="/onboarding"
          style={{
            display: "inline-block",
            padding: "8px 14px",
            background: "#b87900",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Finish onboarding in Stripe →
        </Link>
        <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
      </div>
    );
  }

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
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Account connected</h2>
        <p style={{ color: "#1f5a1f", margin: 0 }}>
          Earnings tracking lands when destination charges go live (M3 §A.4). Until then, payments
          run through the platform account and per-AID payouts aren't routed yet.
        </p>
        <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
      </div>
    );
  }

  // details_submitted: true but charges_enabled: false — Stripe is
  // still reviewing. Show a neutral status.
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
      <p style={{ color: "#555", margin: 0 }}>
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
