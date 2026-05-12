/**
 * Conversations — lookup-by-ID view + owner-scoped inbox.
 *
 *   `?id=<conversation_id>`  → render that chain (single GET).
 *   no query                 → list every conversation any of the
 *                              caller's AIDs has signed events in,
 *                              via `GET /v1/conversations?actor=<aid>`.
 */

import Link from "next/link";
import { requireOwner } from "../../../lib/auth";
import {
  type ConversationEvent,
  type OwnedConversationSummary,
  getConversation,
  getOwnedAgents,
  listOwnedConversations,
} from "../../../lib/cloud-api";
import { LookupForm } from "./_lookup-form";

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function ConversationsPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const session = await requireOwner();
  const id = typeof searchParams.id === "string" ? searchParams.id.trim() : "";

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, marginBottom: 4 }}>Conversations</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          Look up an audit chain by <code>conversation_id</code>, or browse the conversations your
          agents have participated in.
        </p>
      </header>

      <LookupForm initialId={id} />

      {id ? (
        <ChainView id={id} bearer={session.bearer} ownerLogin={session.githubLogin} />
      ) : (
        <OwnerInbox bearer={session.bearer} ownerLogin={session.githubLogin} />
      )}
    </div>
  );
}

/**
 * Owner-scoped inbox: enumerate the bearer's agents via the new
 * `?owner=` index, then for each AID fan out to
 * `?actor=<aid>` and merge the per-AID summaries. We dedup by
 * conversation_id (two of the bearer's AIDs in the same chain
 * collapse to one row), and order newest-active first.
 */
async function OwnerInbox({
  bearer,
  ownerLogin,
}: {
  bearer: string;
  ownerLogin: string | undefined;
}) {
  const ownerId = ownerLogin ? `gh:${ownerLogin}` : null;
  if (!ownerId) {
    // Static / paste sessions don't store an owner ID; without one we
    // can't enumerate owned AIDs to fan out from.
    return <NeedOwnerHint />;
  }
  const agents = await getOwnedAgents(bearer, ownerId, 50);
  if (agents.length === 0) {
    return <NoAgentsHint />;
  }
  const responses = await Promise.all(agents.map((a) => listOwnedConversations(bearer, a.aid)));
  // Dedup: a conversation may surface under multiple of the caller's
  // AIDs (e.g. an agent that's both buyer and seller in the same
  // chain). Keep the row whose `last_seen_at` is newest.
  const merged = new Map<string, OwnedConversationSummary & { actor_aids: string[] }>();
  responses.forEach((resp, i) => {
    const aid = agents[i]?.aid ?? "";
    for (const c of resp.conversations) {
      const existing = merged.get(c.conversation_id);
      if (!existing) {
        merged.set(c.conversation_id, { ...c, actor_aids: [aid] });
        continue;
      }
      existing.actor_aids.push(aid);
      if (c.last_seen_at > existing.last_seen_at) {
        existing.last_seen_at = c.last_seen_at;
        existing.latest_event_type = c.latest_event_type;
        existing.event_count = Math.max(existing.event_count, c.event_count);
      }
      if (c.first_seen_at < existing.first_seen_at) {
        existing.first_seen_at = c.first_seen_at;
      }
    }
  });
  const rows = [...merged.values()].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));

  if (rows.length === 0) {
    return <EmptyInbox />;
  }
  return (
    <section>
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 12 }}>
        Your conversations ({rows.length})
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((row) => (
          <ConversationRow key={row.conversation_id} row={row} />
        ))}
      </ul>
    </section>
  );
}

function ConversationRow({
  row,
}: {
  row: OwnedConversationSummary & { actor_aids: string[] };
}) {
  return (
    <li
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: 8,
        padding: 14,
        marginBottom: 10,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "baseline",
        }}
      >
        <Link
          href={`/conversations?id=${encodeURIComponent(row.conversation_id)}`}
          style={{ fontWeight: 600, color: "#0366d6", textDecoration: "none" }}
        >
          <code>{row.conversation_id}</code>
        </Link>
        <span style={{ fontSize: 12, color: "#888" }}>{row.last_seen_at}</span>
      </div>
      <div style={{ fontSize: 13, color: "#444", marginTop: 4 }}>
        <code>{row.latest_event_type}</code>
        <span style={{ color: "#888", marginLeft: 12 }}>
          {row.event_count} event{row.event_count === 1 ? "" : "s"} as{" "}
          {row.actor_aids.map((a, i) => (
            <span key={a}>
              {i > 0 ? ", " : null}
              <code>{a}</code>
            </span>
          ))}
        </span>
      </div>
    </li>
  );
}

function EmptyInbox() {
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
      <p style={{ margin: 0 }}>
        Your agents haven't participated in any conversations yet. Once they emit signed audit
        events, the chains they appear in will show up here.
      </p>
    </div>
  );
}

function NoAgentsHint() {
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
      <p style={{ margin: 0 }}>
        You haven't published any agents yet. <Link href="/agents/new">Publish one →</Link>
      </p>
    </div>
  );
}

function NeedOwnerHint() {
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
      <p style={{ marginTop: 0, marginBottom: 8 }}>
        Sign in via GitHub to see the conversations your agents have participated in. The
        owner-scoped index needs the dashboard to know your owner ID.
      </p>
      <p style={{ margin: 0 }}>
        For now, you can still look up any chain by <code>conversation_id</code> using the form
        above.
      </p>
    </div>
  );
}

async function ChainView({
  id,
  bearer,
  ownerLogin,
}: {
  id: string;
  bearer: string;
  ownerLogin: string | undefined;
}) {
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

  // Pick a likely respondent: the most-frequent actor AID in the chain
  // that is NOT one of the bearer's owned AIDs. If the bearer owns
  // every actor in the chain (self-vs-self conversation), leave the
  // respondent slot blank — the user can fill it in manually.
  const ownerId = ownerLogin ? `gh:${ownerLogin}` : null;
  const owned = ownerId ? await getOwnedAgents(bearer, ownerId, 50) : [];
  const ownedSet = new Set(owned.map((a) => a.aid));
  const counterCounts = new Map<string, number>();
  for (const ev of chain.events) {
    if (typeof ev.actor_aid !== "string") continue;
    if (ownedSet.has(ev.actor_aid)) continue;
    counterCounts.set(ev.actor_aid, (counterCounts.get(ev.actor_aid) ?? 0) + 1);
  }
  const likelyRespondent = [...counterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const fileHref = likelyRespondent
    ? `/disputes/new?conversation_id=${encodeURIComponent(chain.conversation_id)}&respondent_aid=${encodeURIComponent(likelyRespondent)}`
    : `/disputes/new?conversation_id=${encodeURIComponent(chain.conversation_id)}`;

  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 16, margin: 0 }}>
          <code>{chain.conversation_id}</code>
        </h2>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontSize: 13, color: "#666" }}>
            {chain.total} event{chain.total === 1 ? "" : "s"}
          </span>
          <Link
            href={fileHref}
            style={{
              padding: "6px 12px",
              background: "#0366d6",
              color: "#fff",
              borderRadius: 6,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 13,
              whiteSpace: "nowrap",
            }}
          >
            File a dispute
          </Link>
        </div>
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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}
