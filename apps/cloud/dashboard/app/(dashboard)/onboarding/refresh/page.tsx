/**
 * Stripe Connect onboarding — refresh URL.
 *
 * Stripe sends the user here when their existing onboarding link has
 * expired (links have a short TTL). We just need to mint a fresh link.
 *
 * Behaviorally this is the same as the "no account yet" / "resume"
 * code path on /onboarding: render the form, let the user re-submit,
 * and POST `/v1/connect/onboarding` again — cloud-api is idempotent
 * here (it returns the existing account_id with a new link if one
 * already exists, or creates the account on first call).
 *
 * The bearer comes from the encrypted session cookie via a server
 * prop, exactly like /onboarding.
 */

import { requireOwner } from "../../../../lib/auth";
import { BASE_URL, getStripeAccount } from "../../../../lib/cloud-api";
import { Card, CardBody, CardHeader } from "../../../_components/card";
import { OnboardingForm } from "../_onboarding-form";

export default async function OnboardingRefreshPage() {
  const session = await requireOwner();
  // Best-effort lookup so we can show the existing account_id when
  // there is one; not load-bearing for the form itself.
  const account = await getStripeAccount(session.bearer);

  const resumingFor = account.kind === "ok" ? account.account_id : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">
          Refresh your onboarding link
        </h1>
        <p className="text-sm leading-relaxed text-accent-600">
          Stripe sent you back because your previous onboarding link had expired. Submit below to
          generate a new one — Stripe links have a short TTL by design.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Get a fresh hosted-onboarding link"
          description={
            resumingFor ? (
              <>
                Resuming for account{" "}
                <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
                  {resumingFor}
                </code>
                .
              </>
            ) : undefined
          }
        />
        <CardBody>
          <OnboardingForm
            cloudApiBaseUrl={BASE_URL}
            bearer={session.bearer}
            defaultEmail={looksLikeEmail(session.ownerLabel) ? session.ownerLabel : undefined}
            submitLabel="Get a fresh onboarding link"
          />
        </CardBody>
      </Card>
    </div>
  );
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
