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
import { Alert } from "../../_components/alert";
import { Badge } from "../../_components/badge";
import { Card, CardBody, CardHeader } from "../../_components/card";
import { OnboardingForm } from "./_onboarding-form";

export default async function OnboardingPage() {
  const session = await requireOwner();
  const account = await getStripeAccount(session.bearer);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">
          Stripe Connect onboarding
        </h1>
        <p className="text-sm leading-relaxed text-accent-600">
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
      <Alert tone="danger" title="Cloud-api is unreachable">
        We couldn't read your Stripe account status. Try again in a moment.
      </Alert>
    );
  }

  if (account.kind === "missing") {
    return (
      <Card>
        <CardHeader
          title="Create your Stripe Connect account"
          description="Submitting this form creates an Express account on Stripe and forwards you to their hosted onboarding form. Country and email are passed straight through to Stripe."
        />
        <CardBody>
          <OnboardingForm
            cloudApiBaseUrl={BASE_URL}
            bearer={bearer}
            defaultEmail={looksLikeEmail(email) ? email : undefined}
            submitLabel="Start Stripe onboarding"
          />
        </CardBody>
      </Card>
    );
  }

  // account.kind === "ok"
  const { status, account_id, created_at, updated_at } = account;

  if (status.charges_enabled) {
    return (
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-3">
              Onboarding complete
              <Badge tone="success">live</Badge>
            </span>
          }
          description={
            <>
              Account <Mono>{account_id}</Mono> is ready to receive payouts.
            </>
          }
        />
        <CardBody>
          <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
        </CardBody>
      </Card>
    );
  }

  if (!status.details_submitted) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="warn" title="Resume onboarding">
          Your Stripe account <Mono>{account_id}</Mono> exists but Stripe still needs the rest of
          your business details. Re-submit to fetch a fresh hosted-onboarding link (Stripe links
          expire after a short window).
        </Alert>
        <Card>
          <CardHeader title="Resume Stripe onboarding" />
          <CardBody>
            <OnboardingForm
              cloudApiBaseUrl={BASE_URL}
              bearer={bearer}
              defaultEmail={looksLikeEmail(email) ? email : undefined}
              submitLabel="Resume onboarding"
            />
            <div className="mt-6">
              <AccountMeta accountId={account_id} createdAt={created_at} updatedAt={updated_at} />
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // details_submitted: true but charges_enabled still false — Stripe
  // is reviewing. We don't generate a new link in that state; the
  // user just waits.
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
    <dl className="grid gap-x-6 gap-y-1 text-sm" style={{ gridTemplateColumns: "max-content 1fr" }}>
      <dt className="text-accent-500">account_id</dt>
      <dd className="m-0">
        <Mono>{accountId}</Mono>
      </dd>
      <dt className="text-accent-500">created</dt>
      <dd className="m-0 font-mono text-xs text-accent-700">{createdAt}</dd>
      <dt className="text-accent-500">updated</dt>
      <dd className="m-0 font-mono text-xs text-accent-700">{updatedAt}</dd>
    </dl>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
      {children}
    </code>
  );
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
