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
import { Alert } from "../../../_components/alert";
import { Badge } from "../../../_components/badge";
import { Card, CardBody, CardHeader } from "../../../_components/card";

export default async function OnboardingReturnPage() {
  const session = await requireOwner();
  const account = await getStripeAccount(session.bearer);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">
          Welcome back from Stripe
        </h1>
        <p className="text-sm leading-relaxed text-accent-600">
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
      <Alert tone="danger" title="Cloud-api is unreachable">
        We couldn't read your Stripe account status. Try again in a moment, or{" "}
        <RefreshLink label="refresh" />.
      </Alert>
    );
  }

  if (account.kind === "missing") {
    return (
      <Card>
        <CardHeader title="No Stripe account on file" />
        <CardBody>
          <p className="text-sm leading-relaxed text-accent-700">
            We don't have a Stripe Connect account associated with your owner ID yet. Head back to{" "}
            <Link
              href="/onboarding"
              className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
            >
              /onboarding
            </Link>{" "}
            to start over.
          </p>
        </CardBody>
      </Card>
    );
  }

  const { status, account_id, updated_at } = account;

  if (status.charges_enabled) {
    return (
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-3">
              Done — your account is live
              <Badge tone="success">live</Badge>
            </span>
          }
        />
        <CardBody>
          <p className="text-sm leading-relaxed text-accent-700">
            Account <Mono>{account_id}</Mono> can now receive payouts.
          </p>
          <p className="mt-3 font-mono text-xs text-accent-500">
            Updated <time>{updated_at}</time>
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Alert tone="warn" title="Stripe is still verifying">
      <p className="leading-relaxed">
        Stripe hasn't enabled charges on account <Mono>{account_id}</Mono> yet. This is normal —
        verification usually clears within a few minutes for most countries, longer for some.
      </p>
      <p className="mt-2">
        <RefreshLink label="Refresh now →" />
      </p>
    </Alert>
  );
}

function RefreshLink({ label }: { label: string }) {
  return (
    <Link
      href="/onboarding/return"
      className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
    >
      {label}
    </Link>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
      {children}
    </code>
  );
}
