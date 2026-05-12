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
    <div>
      <header style={{ marginBottom: 16 }}>
        <Link href="/agents" style={{ fontSize: 13, color: "#0366d6" }}>
          ← All agents
        </Link>
        {/* TODO(delete): no DELETE /v1/agents/:aid in cloud-api — manifests are append-only. Withdrawal flow (publish a "withdrawn" stub) lands later; no Delete button until then. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 16,
            marginTop: 8,
          }}
        >
          <h1 style={{ margin: 0 }}>{detail.aid}</h1>
          <Link
            href={`/agents/${encodeURIComponent(detail.aid)}/edit`}
            style={{
              fontSize: 13,
              color: "#0366d6",
              textDecoration: "none",
              border: "1px solid #0366d6",
              padding: "4px 10px",
              borderRadius: 6,
            }}
          >
            Edit
          </Link>
        </div>
        {detail.manifest.description ? (
          <p style={{ color: "#555", marginTop: 4 }}>{detail.manifest.description}</p>
        ) : null}
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "8px 16px",
          fontSize: 14,
          marginBottom: 24,
        }}
      >
        <span style={{ color: "#666" }}>Published at</span>
        <span>{detail.published_at}</span>

        {detail.published_by ? (
          <>
            <span style={{ color: "#666" }}>Published by</span>
            <code>{detail.published_by}</code>
          </>
        ) : null}

        {detail.pubkey ? (
          <>
            <span style={{ color: "#666" }}>Pinned pubkey</span>
            <code style={{ wordBreak: "break-all", fontSize: 12 }}>{detail.pubkey}</code>
          </>
        ) : null}

        <span style={{ color: "#666" }}>RPC endpoint</span>
        <code style={{ wordBreak: "break-all" }}>{detail.manifest.endpoints.rpc}</code>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Identity JWT</h2>
        <pre
          style={{
            background: "#fff",
            border: "1px solid #e3e3e3",
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            overflowX: "auto",
            margin: 0,
            wordBreak: "break-all",
            whiteSpace: "pre-wrap",
          }}
        >
          {detail.identity_jwt}
        </pre>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Manifest</h2>
        <pre
          style={{
            background: "#fff",
            border: "1px solid #e3e3e3",
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            overflowX: "auto",
            margin: 0,
          }}
        >
          {manifestPretty}
        </pre>
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Conversations</h2>
        <p style={{ color: "#555", fontSize: 14 }}>
          The cloud-api indexes audit chains by <code>conversation_id</code>, not by AID. To view a
          chain you need its conversation ID — drop it into <code>/conversations/&lt;id&gt;</code>{" "}
          once that page is wired (M3 #A.1 backlog).
        </p>
      </section>
    </div>
  );
}
