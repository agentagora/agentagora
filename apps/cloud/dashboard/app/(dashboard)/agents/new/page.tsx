/**
 * Publish-agent shell. Server Component; renders the page chrome and
 * mounts the `<PublishForm>` Client Component which handles the
 * sensitive part — the user's private signing key never touches the
 * Next.js server (no Server Action, no Route Handler involved in
 * publishing). The form posts the signed payload directly from the
 * browser to cloud-api's `POST /v1/agents` with the bearer fetched
 * from the dashboard via a small JSON GET.
 */

import { requireOwner } from "../../../../lib/auth";
import { BASE_URL } from "../../../../lib/cloud-api";
import { PublishForm } from "./_publish-form";

export default async function NewAgentPage() {
  const session = await requireOwner();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Publish agent</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
          Build a manifest, sign it with your Ed25519 private key, and POST to{" "}
          <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
            {BASE_URL}/v1/agents
          </code>
          . The signing happens in this browser tab — your private key is not sent to the dashboard
          server.
        </p>
      </header>

      <PublishForm cloudApiBaseUrl={BASE_URL} bearer={session.bearer} />
    </div>
  );
}
