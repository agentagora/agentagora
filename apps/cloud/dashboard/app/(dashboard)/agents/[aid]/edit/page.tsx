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
import { EditManifestForm } from "./_edit-form";

interface Params {
  aid: string;
}

export default async function EditAgentPage({ params }: { params: Params }) {
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
      <div>
        <header style={{ marginBottom: 16 }}>
          <Link
            href={`/agents/${encodeURIComponent(aid)}`}
            style={{ fontSize: 13, color: "#0366d6" }}
          >
            ← Back to {aid}
          </Link>
          <h1 style={{ marginTop: 8, marginBottom: 4 }}>Not your agent</h1>
        </header>
        <div
          role="alert"
          style={{
            border: "1px solid #d93025",
            background: "#fce8e6",
            color: "#7c0c00",
            borderRadius: 8,
            padding: 16,
            fontSize: 14,
            maxWidth: 640,
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            This AID is registered to a different owner — the cloud-api would refuse a re-publish
            from your account anyway.
          </p>
          <p style={{ margin: 0 }}>
            Pinned to: <code>{detail.published_by}</code>
            <br />
            Your session: <code>{ownerId ?? "(unknown — non-OAuth bearer)"}</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <Link
          href={`/agents/${encodeURIComponent(aid)}`}
          style={{ fontSize: 13, color: "#0366d6" }}
        >
          ← Back to {aid}
        </Link>
        <h1 style={{ marginTop: 8, marginBottom: 4 }}>Edit manifest</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          Update the manifest for <code>{aid}</code>. Cloud-api's <code>POST /v1/agents</code> is an
          upsert keyed on AID — this re-signs a fresh manifest with the same key you originally
          published with and replaces the registry entry.
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
