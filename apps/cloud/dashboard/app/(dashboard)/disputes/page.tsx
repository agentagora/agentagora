/**
 * Disputes — case-file lookup by ID.
 *
 * Cloud-api intake works (`POST /v1/disputes`) and the public-by-ID
 * read works (`GET /v1/disputes/:id`), but there's no
 * `GET /v1/disputes` listing endpoint scoped to "filed by me / against
 * my agents". So this page mirrors `/conversations` — accept a
 * `?id=disp_...` query param and render that single case file.
 *
 * Layout is two columns:
 *   - left  : case meta (filer, respondent, reason, state, etc.)
 *   - right : the linked conversation chain via `getConversation`
 *
 * TODO(cloud-api): expose `GET /v1/disputes?owner=<id>` (or
 * `?filer_aid=<aid>` / `?respondent_aid=<aid>`) so the dashboard can
 * render an inbox without forcing operators to keep dispute IDs in a
 * spreadsheet. Tracked in `docs/m3-launch-checklist.md` §A.1.
 */

import { requireOwner } from "../../../lib/auth";
import {
  type ConversationEvent,
  type DisputeResponse,
  getConversation,
  getDispute,
} from "../../../lib/cloud-api";
import { LookupForm } from "./_lookup-form";

interface PageProps {
  searchParams: { id?: string };
}

export default async function DisputesPage({ searchParams }: PageProps) {
  await requireOwner();
  const id = typeof searchParams.id === "string" ? searchParams.id.trim() : "";

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, marginBottom: 4 }}>Disputes</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          Look up a dispute case file by <code>dispute_id</code>. An owner-scoped inbox lands once
          the cloud-api can list disputes by filer / respondent owner.
        </p>
      </header>

      <LookupForm initialId={id} />

      {id ? <CaseView id={id} /> : <EmptyState />}
    </div>
  );
}

async function CaseView({ id }: { id: string }) {
  const dispute = await getDispute(id);

  if (!dispute) {
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
          No dispute found for <code>{id}</code>. Either the cloud-api is unreachable or that ID
          isn't registered.
        </p>
      </div>
    );
  }

  const chain = await getConversation(dispute.conversation_id);

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)",
        gap: 24,
        alignItems: "start",
      }}
    >
      <CaseMeta dispute={dispute} />
      <ChainColumn dispute={dispute} chain={chain} />
    </section>
  );
}

function CaseMeta({ dispute }: { dispute: DisputeResponse }) {
  return (
    <aside
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: 8,
        padding: 16,
        background: "#fff",
      }}
    >
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 12 }}>Case file</h2>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "6px 12px",
          fontSize: 13,
          margin: 0,
        }}
      >
        <dt style={{ color: "#666" }}>dispute_id</dt>
        <dd style={{ margin: 0 }}>
          <code style={{ wordBreak: "break-all" }}>{dispute.dispute_id}</code>
        </dd>

        <dt style={{ color: "#666" }}>state</dt>
        <dd style={{ margin: 0 }}>
          <StateBadge state={dispute.state} />
        </dd>

        <dt style={{ color: "#666" }}>reason</dt>
        <dd style={{ margin: 0 }}>
          <code>{dispute.reason}</code>
        </dd>

        <dt style={{ color: "#666" }}>filer</dt>
        <dd style={{ margin: 0 }}>
          <code style={{ wordBreak: "break-all" }}>{dispute.filer_aid}</code>
        </dd>

        <dt style={{ color: "#666" }}>respondent</dt>
        <dd style={{ margin: 0 }}>
          <code style={{ wordBreak: "break-all" }}>{dispute.respondent_aid}</code>
        </dd>

        <dt style={{ color: "#666" }}>filed_at</dt>
        <dd style={{ margin: 0 }}>{dispute.filed_at}</dd>

        {dispute.resolved_at ? (
          <>
            <dt style={{ color: "#666" }}>resolved_at</dt>
            <dd style={{ margin: 0 }}>{dispute.resolved_at}</dd>
          </>
        ) : null}

        {dispute.resolution ? (
          <>
            <dt style={{ color: "#666" }}>resolution</dt>
            <dd style={{ margin: 0 }}>
              <code>{dispute.resolution}</code>
            </dd>
          </>
        ) : null}
      </dl>

      {dispute.narrative ? (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, color: "#666", margin: 0, marginBottom: 4 }}>narrative</h3>
          <p
            style={{
              fontSize: 13,
              color: "#222",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {dispute.narrative}
          </p>
        </div>
      ) : null}

      {dispute.claimed_remedy ? (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 13, color: "#666", margin: 0, marginBottom: 4 }}>
            claimed_remedy
          </h3>
          <p style={{ fontSize: 13, color: "#222", margin: 0, wordBreak: "break-word" }}>
            {dispute.claimed_remedy}
          </p>
        </div>
      ) : null}
    </aside>
  );
}

function ChainColumn({
  dispute,
  chain,
}: {
  dispute: DisputeResponse;
  chain: Awaited<ReturnType<typeof getConversation>>;
}) {
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
        <h2 style={{ fontSize: 15, margin: 0 }}>
          Linked conversation: <code>{dispute.conversation_id}</code>
        </h2>
        {chain ? (
          <span style={{ fontSize: 13, color: "#666" }}>
            {chain.total} event{chain.total === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {!chain ? (
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
            Couldn't load the linked conversation. The cloud-api may be unreachable.
          </p>
        </div>
      ) : chain.events.length === 0 ? (
        <p style={{ color: "#666" }}>The linked chain is empty.</p>
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
        padding: 12,
        marginBottom: 8,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <code style={{ fontSize: 12, color: "#0366d6" }}>{event.event_id}</code>
        {ts ? <span style={{ fontSize: 11, color: "#888" }}>{ts}</span> : null}
      </div>
      <div style={{ fontSize: 13 }}>
        <code>{event.type}</code>{" "}
        <span style={{ color: "#666" }}>
          by <code>{event.actor_aid}</code>
        </span>
      </div>
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "#555" }}>view raw</summary>
        <pre
          style={{
            background: "#f8f8f8",
            border: "1px solid #eee",
            borderRadius: 6,
            padding: 8,
            fontSize: 11,
            overflowX: "auto",
            marginTop: 6,
            marginBottom: 0,
          }}
        >
          {JSON.stringify(event, null, 2)}
        </pre>
      </details>
    </li>
  );
}

function StateBadge({ state }: { state: string }) {
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    open: { bg: "#fff8e8", fg: "#5a4400", border: "#e3a23a" },
    resolved: { bg: "#f3fbf3", fg: "#1f5a1f", border: "#c3e6c3" },
    rejected: { bg: "#fff5f5", fg: "#7a1f1f", border: "#f0c0c0" },
  };
  const colors = palette[state] ?? { bg: "#f4f4f4", fg: "#333", border: "#ccc" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {state}
    </span>
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
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 8 }}>How do I find a dispute ID?</h2>
      <p style={{ marginTop: 0 }}>
        Dispute IDs are returned by <code>POST /v1/disputes</code> at filing time. They look like{" "}
        <code>disp_…</code> — copy one out of your filing tool's output and paste it above.
      </p>
      <p style={{ marginBottom: 0 }}>
        An owner-scoped inbox (filed by you / against your agents) lands once the cloud-api adds a
        listing endpoint.
      </p>
    </div>
  );
}
