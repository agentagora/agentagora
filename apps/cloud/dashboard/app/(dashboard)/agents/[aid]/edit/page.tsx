/**
 * Edit-manifest shell. Server Component; mounts the `<EditManifestForm>`
 * Client Component which signs and POSTs the updated manifest from the
 * browser (cloud-api's POST /v1/agents is an upsert).
 *
 * Owner gate. We require an active session (`requireOwner()`) and
 * additionally check that the existing record's `published_by` matches
 * the caller's owner identity. The cloud-api will refuse mismatching
 * upserts on its own — this client-side check is purely a UX
 * convenience so we can show a clear "you don't own this AID" message
 * before the user wastes a signing round-trip. The check is *not* a
 * security boundary; the cloud-api remains the source of truth.
 *
 * Owner identity. The dashboard's session carries `githubLogin`; the
 * cloud-api stamps owners as `gh:<login>` for OAuth-issued bearers.
 * For paste-bearer / static sessions we don't know the owner ID locally
 * (cloud-api has no /v1/whoami today), so we skip the pre-flight check
 * and let the upsert's 403 response show through. Same fallback the
 * `/home`, `/conversations`, and `/disputes` pages use.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "../../../../../lib/auth";
import { BASE_URL, getAgent } from "../../../../../lib/cloud-api";
import { Alert } from "../../../../_components/alert";
import { EditManifestForm } from "./_edit-form";

interface Params {
  aid: string;
}

export default async function EditAgentPage(props: { params: Promise<Params> }) {
  const params = await props.params;
  const session = await requireOwner();
  const aid = decodeURIComponent(params.aid);
  const detail = await getAgent(aid);
  if (!detail) {
    notFound();
  }

  const ownerId = session.githubLogin ? `gh:${session.githubLogin}` : null;
  const ownsRecord =
    ownerId === null || detail.published_by === undefined || detail.published_by === ownerId;

  if (!ownsRecord) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            href={`/agents/${encodeURIComponent(aid)}`}
            className="text-sm font-medium text-accent-600 underline-offset-2 hover:text-accent-900 hover:underline"
          >
            ← Back to {aid}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Not your agent</h1>
        </header>
        <Alert tone="danger" title="Owner mismatch">
          <p className="leading-relaxed">
            This AID is registered to a different owner — the cloud-api would refuse a re-publish
            from your account anyway.
          </p>
          <dl
            className="mt-3 grid gap-x-6 gap-y-1 text-sm"
            style={{ gridTemplateColumns: "max-content 1fr" }}
          >
            <dt className="text-red-800/80">Pinned to</dt>
            <dd className="m-0">
              <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[12px] text-red-900">
                {detail.published_by}
              </code>
            </dd>
            <dt className="text-red-800/80">Your session</dt>
            <dd className="m-0">
              <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[12px] text-red-900">
                {ownerId ?? "(unknown — non-OAuth bearer)"}
              </code>
            </dd>
          </dl>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/agents/${encodeURIComponent(aid)}`}
          className="text-sm font-medium text-accent-600 underline-offset-2 hover:text-accent-900 hover:underline"
        >
          ← Back to {aid}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Edit manifest</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
          Update the manifest for{" "}
          <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
            {aid}
          </code>
          . Cloud-api's{" "}
          <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
            POST /v1/agents
          </code>{" "}
          is an upsert keyed on AID — this re-signs a fresh manifest with the same key you
          originally published with and replaces the registry entry.
        </p>
      </header>

      <EditManifestForm
        cloudApiBaseUrl={BASE_URL}
        bearer={session.bearer}
        initialManifest={detail.manifest}
      />
    </div>
  );
}
