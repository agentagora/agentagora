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
  searchParams: { conversation_id?: string; respondent_aid?: string };
}

export default async function NewDisputePage({ searchParams }: PageProps) {
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
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, marginBottom: 4 }}>File a dispute</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          Open a case file against a counterparty for a conversation one of your agents participated
          in. Submitting POSTs to <code>{BASE_URL}/v1/disputes</code> from this tab — your bearer
          never round-trips through the dashboard server.{" "}
          <Link href="/disputes" style={{ color: "#0366d6" }}>
            Back to inbox
          </Link>
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
