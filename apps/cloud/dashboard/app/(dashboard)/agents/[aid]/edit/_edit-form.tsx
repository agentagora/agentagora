"use client";

/**
 * Edit-manifest form — Client Component.
 *
 * Thin wrapper around `<ManifestForm mode="edit">`. The Server Component
 * sibling (`page.tsx`) fetches the existing manifest, gates on owner
 * identity, and passes the manifest down here so the form pre-fills.
 * Submission goes browser → cloud-api directly; the user's private key
 * never reaches the dashboard server. See `../../_manifest-form.tsx`.
 */

import type { Manifest } from "@agentagora/protocol";
import { ManifestForm } from "../../_manifest-form";

interface Props {
  cloudApiBaseUrl: string;
  bearer: string;
  initialManifest: Manifest;
}

export function EditManifestForm({ cloudApiBaseUrl, bearer, initialManifest }: Props) {
  return (
    <ManifestForm
      mode="edit"
      cloudApiBaseUrl={cloudApiBaseUrl}
      bearer={bearer}
      initialManifest={initialManifest}
      onPublishedHref={(aid) => `/agents/${encodeURIComponent(aid)}`}
    />
  );
}
