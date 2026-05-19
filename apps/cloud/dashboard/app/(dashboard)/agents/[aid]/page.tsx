/**
 * Agent detail page — manifest + identity JWT + recent metadata.
 *
 * The cloud-api serves `GET /v1/agents/:aid` publicly, so we don't
 * need the bearer here. We still gate the route through
 * `requireOwner()` because the dashboard is meant for owners; the
 * public catalog already lives at `/`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "../../../../lib/auth";
import { getAgent } from "../../../../lib/cloud-api";
import { Button } from "../../../_components/button";
import { Card, CardBody, CardHeader } from "../../../_components/card";

interface Params {
  aid: string;
}

export default async function AgentDetailPage(props: { params: Promise<Params> }) {
  const params = await props.params;
  await requireOwner();
  const aid = decodeURIComponent(params.aid);
  const detail = await getAgent(aid);
  if (!detail) {
    notFound();
  }

  const manifestPretty = JSON.stringify(detail.manifest, null, 2);

  return (
    <div className="flex flex-col gap-6">
      {/* TODO(delete): no DELETE /v1/agents/:aid in cloud-api — manifests are append-only. Withdrawal flow (publish a "withdrawn" stub) lands later; no Delete button until then. */}
      <header className="flex flex-col gap-3">
        <Link
          href="/agents"
          className="text-sm font-medium text-accent-600 underline-offset-2 hover:text-accent-900 hover:underline"
        >
          ← All agents
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-mono text-xl font-semibold tracking-tight text-accent-900">
            {detail.aid}
          </h1>
          <Link href={`/agents/${encodeURIComponent(detail.aid)}/edit`}>
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </Link>
        </div>
        {detail.manifest.description && (
          <p className="text-sm leading-relaxed text-accent-600">{detail.manifest.description}</p>
        )}
      </header>

      <Card>
        <CardHeader title="Registry record" />
        <CardBody>
          <dl
            className="grid items-baseline gap-x-6 gap-y-2 text-sm"
            style={{ gridTemplateColumns: "max-content 1fr" }}
          >
            <MetaRow label="Published at">
              <time className="font-mono text-xs text-accent-700">{detail.published_at}</time>
            </MetaRow>

            {detail.published_by && (
              <MetaRow label="Published by">
                <Mono>{detail.published_by}</Mono>
              </MetaRow>
            )}

            {detail.pubkey && (
              <MetaRow label="Pinned pubkey">
                <Mono breakAll>{detail.pubkey}</Mono>
              </MetaRow>
            )}

            <MetaRow label="RPC endpoint">
              <Mono breakAll>{detail.manifest.endpoints.rpc}</Mono>
            </MetaRow>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Identity JWT"
          description="Issued by cloud-api; verifiable via /.well-known/jwks.json"
        />
        <CardBody>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-accent-100 bg-accent-50/50 p-3 font-mono text-[12px] text-accent-800">
            {detail.identity_jwt}
          </pre>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Manifest" />
        <CardBody>
          <pre className="m-0 overflow-x-auto rounded-md border border-accent-100 bg-accent-50/50 p-3 font-mono text-[12px] text-accent-800">
            {manifestPretty}
          </pre>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Conversations" />
        <CardBody>
          <p className="text-sm leading-relaxed text-accent-700">
            The cloud-api indexes audit chains by{" "}
            <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
              conversation_id
            </code>
            , not by AID. To view a chain you need its conversation ID — drop it into{" "}
            <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
              /conversations/&lt;id&gt;
            </code>{" "}
            once that page is wired (M3 #A.1 backlog).
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-accent-500">{label}</dt>
      <dd className="m-0">{children}</dd>
    </>
  );
}

function Mono({ children, breakAll = false }: { children: React.ReactNode; breakAll?: boolean }) {
  return (
    <code
      className={`rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800 ${breakAll ? "break-all" : ""}`}
    >
      {children}
    </code>
  );
}
