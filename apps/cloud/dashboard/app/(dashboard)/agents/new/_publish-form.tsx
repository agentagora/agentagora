"use client";

/**
 * Publish form — Client Component.
 *
 * Thin wrapper around `<ManifestForm mode="publish">` (the shared
 * publish/edit form one directory up). All of the field shape, the
 * Ed25519 in-browser signing, and the upsert POST live there; this
 * file only exists so existing imports of `<PublishForm>` keep working
 * and so the publish page can stay focused on its own copy.
 *
 * See `../_manifest-form.tsx` for the security model — in short: the
 * private key never reaches the dashboard server.
 */

import { ManifestForm } from "../_manifest-form";

interface Props {
  cloudApiBaseUrl: string;
  bearer: string;
}

export function PublishForm({ cloudApiBaseUrl, bearer }: Props) {
  return <ManifestForm mode="publish" cloudApiBaseUrl={cloudApiBaseUrl} bearer={bearer} />;
}
