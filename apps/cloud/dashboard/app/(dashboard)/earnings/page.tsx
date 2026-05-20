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
import { Alert } from "../../_components/alert";
import { Badge } from "../../_components/badge";
import { Button } from "../../_components/button";
import { Card, CardBody, CardHeader } from "../../_components/card";

export default async function EarningsPage() {
  const session = await requireOwner();
  const account = await getStripeAccount(session.bearer);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Earnings</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
          Stripe Connect onboarding status. Per-AID payout tracking ships with destination charges
          (M3 §A.4) — until then the dashboard intentionally does not display a number.
        </p>
      </header>

      <StatusCard account={account} />

      <Card>
        <CardHeader title="Earnings totals" description="Per-AID payouts (waiting on M3 §A.4)" />
        <CardBody>
          <p className="text-sm leading-relaxed text-accent-600">
            The cloud doesn't index per-AID payouts yet. Once destination charges are live, this
            page will surface a per-agent earnings total joined from the Stripe ledger.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function StatusCard({ account }: { account: StripeAccountResult }) {
  if (account.kind === "unreachable") {
    return (
      <Alert tone="danger" title="Cloud-api is unreachable">
        We couldn't read your Stripe account status. The cloud-api may be down — try again in a
        moment.
      </Alert>
    );
  }

  if (account.kind === "missing") {
    return (
      <Card>
        <CardHeader
          title="You haven't connected a Stripe account yet"
          description="Agents can publish without payouts, but capabilities priced in real money need a Stripe Connect account to receive funds."
        />
        <CardBody>
          <Link href="/onboarding">
            <Button>Connect Stripe →</Button>
          </Link>
        </CardBody>
      </Card>
    );
  }

  // account.kind === "ok"
  const { status, account_id, created_at, updated_at } = account;

  if (!status.details_submitted) {
    return (
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-3">
              Onboarding incomplete
              <Badge tone="warn">action required</Badge>
            </span>
          }
          description="Your Stripe account exists but hasn't finished onboarding. Stripe needs the rest of your business details before you can accept payouts."
        />
        <CardBody>
          <Link href="/onboarding">
            <Button>Finish onboarding in Stripe →</Button>
          </Link>
          <div className="mt-5">
            <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
          </div>
        </CardBody>
      </Card>
    );
  }

  if (status.charges_enabled) {
    return (
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-3">
              Account connected
              <Badge tone="success">live</Badge>
            </span>
          }
          description="Earnings tracking lands when destination charges go live (M3 §A.4). Until then, payments run through the platform account and per-AID payouts aren't routed yet."
        />
        <CardBody>
          <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
        </CardBody>
      </Card>
    );
  }

  // details_submitted: true but charges_enabled: false — Stripe is
  // still reviewing. Show a neutral status.
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-3">
            Stripe is reviewing your account
            <Badge tone="info">in review</Badge>
          </span>
        }
        description="You've submitted your details; Stripe hasn't enabled charges yet. This is normal and usually clears within a business day."
      />
      <CardBody>
        <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
      </CardBody>
    </Card>
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
      className="grid items-baseline gap-x-6 gap-y-1.5 text-sm"
      style={{ gridTemplateColumns: "max-content 1fr" }}
    >
      <dt className="text-accent-500">account_id</dt>
      <dd className="m-0">
        <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
          {accountId}
        </code>
      </dd>
      <dt className="text-accent-500">created</dt>
      <dd className="m-0 font-mono text-xs text-accent-700">{createdAt}</dd>
      <dt className="text-accent-500">updated</dt>
      <dd className="m-0 font-mono text-xs text-accent-700">{updatedAt}</dd>
    </dl>
  );
}
