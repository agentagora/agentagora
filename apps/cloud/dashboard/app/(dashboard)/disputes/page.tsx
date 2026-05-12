/**
 * Disputes — case-file lookup by ID + owner-scoped inbox.
 *
 *   `?id=disp_<...>` → render that case file (single GET).
 *   no query         → list every dispute the caller's AIDs are on
 *                      either side of, via `GET /v1/disputes?filer=<aid>`
 *                      and `GET /v1/disputes?respondent=<aid>`.
 *
 * Single-case layout is two columns:
 *   - left  : case meta (filer, respondent, reason, state, etc.)
 *   - right : the linked conversation chain via `getConversation`
 */

import Link from "next/link";
import { requireOwner } from "../../../lib/auth";
import {
  type ConversationEvent,
  type DisputeResponse,
  getConversation,
  getDispute,
  getOwnedAgents,
  listOwnedDisputes,
} from "../../../lib/cloud-api";
import { LookupForm } from "./_lookup-form";

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function DisputesPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const session = await requireOwner();
  const id = typeof searchParams.id === "string" ? searchParams.id.trim() : "";

  return (
    <div>
      <header
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, marginBottom: 4 }}>Disputes</h1>
          <p style={{ color: "#555", marginTop: 0 }}>
            Look up a dispute case file by <code>dispute_id</code>, or browse the disputes filed by
            (or against) your agents.
          </p>
        </div>
        <Link
          href="/disputes/new"
          style={{
            padding: "8px 14px",
            background: "#0366d6",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 14,
            whiteSpace: "nowrap",
          }}
        >
          File a dispute
        </Link>
      </header>

      <LookupForm initialId={id} />

      {id ? (
        <CaseView id={id} />
      ) : (
        <OwnerInbox bearer={session.bearer} ownerLogin={session.githubLogin} />
      )}
    </div>
  );
}

/**
 * Owner-scoped inbox: pull the bearer's agents from the new
 * `/v1/agents?owner=` index, fan out per AID through
 * `listOwnedDisputes` (which itself unions ?filer=…+?respondent=…),
 * and collapse to a single newest-first table. Dedup by dispute_id —
 * a self-vs-self filing would otherwise double-count.
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
    return <NeedOwnerHint />;
  }
  const agents = await getOwnedAgents(bearer, ownerId, 50);
  if (agents.length === 0) {
    return <NoAgentsHint />;
  }
  const responses = await Promise.all(agents.map((a) => listOwnedDisputes(bearer, a.aid)));
  const byId = new Map<string, DisputeResponse>();
  for (const r of responses) {
    for (const d of r.disputes) byId.set(d.dispute_id, d);
  }
  const rows = [...byId.values()].sort((a, b) => b.filed_at.localeCompare(a.filed_at));

  if (rows.length === 0) {
    return <EmptyInbox />;
  }
  return (
    <section>
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 12 }}>
        Your disputes ({rows.length})
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((dispute) => (
          <DisputeRow key={dispute.dispute_id} dispute={dispute} />
        ))}
      </ul>
    </section>
  );
}

function DisputeRow({ dispute }: { dispute: DisputeResponse }) {
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
          marginBottom: 6,
        }}
      >
        <Link
          href={`/disputes?id=${encodeURIComponent(dispute.dispute_id)}`}
          style={{ fontWeight: 600, color: "#0366d6", textDecoration: "none" }}
        >
          <code>{dispute.dispute_id}</code>
        </Link>
        <StateBadge state={dispute.state} />
      </div>
      <div style={{ fontSize: 13, color: "#444" }}>
        <code>{dispute.reason}</code>
        <span style={{ color: "#888", marginLeft: 12 }}>{dispute.filed_at}</span>
      </div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
        <code>{dispute.filer_aid}</code> → <code>{dispute.respondent_aid}</code>
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
        No disputes filed by or against your agents yet. When a counterparty files one (or you file
        one through <code>POST /v1/disputes</code>), it'll appear here.
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
        Sign in via GitHub to see disputes filed by or against your agents. The owner-scoped index
        needs the dashboard to know your owner ID.
      </p>
      <p style={{ margin: 0 }}>
        For now, you can still look up any case file by <code>dispute_id</code> using the form
        above.
      </p>
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
