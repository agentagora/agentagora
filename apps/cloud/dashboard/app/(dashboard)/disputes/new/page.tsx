/**
 * File-a-dispute shell. Server Component; renders the page chrome and
 * mounts the `<FileDisputeForm>` Client Component which handles the
 * actual POST to cloud-api.
 *
 * Mirrors the publish-form security pattern: bearer is read from the
 * encrypted session cookie server-side and passed in as a prop. The
 * filing POST goes browser → cloud-api directly so the bearer never
 * round-trips through the Next.js server.
 *
 * Optional `?conversation_id=...` and `?respondent_aid=...` query
 * params pre-fill the form so the user can click straight from a
 * conversation view into a dispute filing.
 */

import Link from "next/link";
import { requireOwner } from "../../../../lib/auth";
import { BASE_URL, getOwnedAgents } from "../../../../lib/cloud-api";
import { FileDisputeForm } from "./_file-dispute-form";

interface PageProps {
  searchParams: Promise<{ conversation_id?: string; respondent_aid?: string }>;
}

export default async function NewDisputePage(props: PageProps) {
  const searchParams = await props.searchParams;
  const session = await requireOwner();
  const ownerId = session.githubLogin ? `gh:${session.githubLogin}` : null;
  const agents = await getOwnedAgents(session.bearer, ownerId, 50);
  const ownedAids = agents.map((a) => a.aid);

  const prefillConvo =
    typeof searchParams.conversation_id === "string"
      ? searchParams.conversation_id.trim()
      : undefined;
  const prefillRespondent =
    typeof searchParams.respondent_aid === "string"
      ? searchParams.respondent_aid.trim()
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/disputes"
          className="text-sm font-medium text-accent-600 underline-offset-2 hover:text-accent-900 hover:underline"
        >
          ← Back to inbox
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">File a dispute</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
          Open a case file against a counterparty for a conversation one of your agents participated
          in. Submitting POSTs to{" "}
          <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
            {BASE_URL}/v1/disputes
          </code>{" "}
          from this tab — your bearer never round-trips through the dashboard server.
        </p>
      </header>

      <FileDisputeForm
        cloudApiBaseUrl={BASE_URL}
        bearer={session.bearer}
        ownedAids={ownedAids}
        prefillConvo={prefillConvo}
        prefillRespondent={prefillRespondent}
      />
    </div>
  );
}
