/**
 * Conversations — lookup-by-ID view.
 *
 * The cloud-api exposes `GET /v1/conversations/:id` (read one chain
 * by ID) but no owner-scoped index. Until a `published_by` join
 * lands server-side, the dashboard cannot enumerate "conversations
 * involving my agents" — so this page is intentionally a single-ID
 * lookup driven by a query param.
 *
 * TODO(cloud-api): expose `GET /v1/conversations?actor=<aid>` (or
 * `?owner=<id>`) so the dashboard can list owner-scoped chains
 * without forcing the operator to copy IDs out of audit emissions.
 * Tracked in `docs/m3-launch-checklist.md` §A.1.
 */

import Link from "next/link";
import { requireOwner } from "../../../lib/auth";
import { type ConversationEvent, getConversation } from "../../../lib/cloud-api";
import { LookupForm } from "./_lookup-form";

interface PageProps {
  searchParams: { id?: string };
}

export default async function ConversationsPage({ searchParams }: PageProps) {
  await requireOwner();
  const id = typeof searchParams.id === "string" ? searchParams.id.trim() : "";

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, marginBottom: 4 }}>Conversations</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          Look up an audit chain by <code>conversation_id</code>. Owner-scoped indexing lands once
          the cloud-api can join conversations to <code>published_by</code> via the audit log.
        </p>
      </header>

      <LookupForm initialId={id} />

      {id ? <ChainView id={id} /> : <EmptyState />}
    </div>
  );
}

async function ChainView({ id }: { id: string }) {
  const chain = await getConversation(id);

  if (!chain) {
    return (
      <div
        style={{
          border: "1px solid #f0c0c0",
          background: "#fff5f5",
          color: "#7a1f1f",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <p style={{ margin: 0 }}>
          No conversation found for <code>{id}</code>. Either the cloud-api is unreachable or no
          events have been ingested under that ID yet.
        </p>
      </div>
    );
  }

  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 16, margin: 0 }}>
          <code>{chain.conversation_id}</code>
        </h2>
        <span style={{ fontSize: 13, color: "#666" }}>
          {chain.total} event{chain.total === 1 ? "" : "s"}
        </span>
      </div>

      {chain.events.length === 0 ? (
        <p style={{ color: "#666" }}>The chain is empty (no events have been ingested yet).</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {chain.events.map((event) => (
            <EventCard key={event.event_id} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EventCard({ event }: { event: ConversationEvent }) {
  const prevHash = typeof event.previous_event_hash === "string" ? event.previous_event_hash : null;
  const ts =
    typeof event.occurred_at === "string"
      ? event.occurred_at
      : typeof event.ingested_at === "string"
        ? event.ingested_at
        : null;

  return (
    <li
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <code style={{ fontSize: 13, color: "#0366d6" }}>{event.event_id}</code>
        {ts ? <span style={{ fontSize: 12, color: "#888" }}>{ts}</span> : null}
      </div>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "4px 16px",
          fontSize: 13,
          margin: 0,
        }}
      >
        <dt style={{ color: "#666" }}>type</dt>
        <dd style={{ margin: 0 }}>
          <code>{event.type}</code>
        </dd>

        <dt style={{ color: "#666" }}>actor</dt>
        <dd style={{ margin: 0 }}>
          <code>{event.actor_aid}</code>
        </dd>

        {prevHash ? (
          <>
            <dt style={{ color: "#666" }}>prev_hash</dt>
            <dd style={{ margin: 0 }}>
              <code style={{ fontSize: 12 }} title={prevHash}>
                {truncate(prevHash, 24)}
              </code>
            </dd>
          </>
        ) : (
          <>
            <dt style={{ color: "#666" }}>prev_hash</dt>
            <dd style={{ margin: 0, color: "#999" }}>(genesis)</dd>
          </>
        )}
      </dl>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "#555" }}>view raw</summary>
        <pre
          style={{
            background: "#f8f8f8",
            border: "1px solid #eee",
            borderRadius: 6,
            padding: 10,
            fontSize: 12,
            overflowX: "auto",
            marginTop: 8,
            marginBottom: 0,
          }}
        >
          {JSON.stringify(event, null, 2)}
        </pre>
      </details>
    </li>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        border: "1px dashed #ccc",
        borderRadius: 8,
        padding: 24,
        background: "#fff",
        color: "#555",
      }}
    >
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 8 }}>
        How do I find a conversation ID?
      </h2>
      <p style={{ marginTop: 0 }}>
        Conversation IDs are emitted with every audit event your agents produce. The SDK logs them
        via its <code>auditEmit</code> hook; copy one out of your agent runtime logs and paste it
        above.
      </p>
      <p style={{ marginBottom: 0 }}>
        You can also navigate from any agent in <Link href="/agents">/agents</Link>; once an
        owner-scoped index ships, this page will list chains directly.
      </p>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}
