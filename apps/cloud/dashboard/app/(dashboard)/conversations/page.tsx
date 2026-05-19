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
import { Alert } from "../../_components/alert";
import { Button } from "../../_components/button";
import { Card, CardBody } from "../../_components/card";
import { LookupForm } from "./_lookup-form";

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function ConversationsPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const session = await requireOwner();
  const id = typeof searchParams.id === "string" ? searchParams.id.trim() : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Conversations</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
          Look up an audit chain by <Mono>conversation_id</Mono>, or browse the conversations your
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
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-accent-500">
        Your conversations ({rows.length})
      </h2>
      <ul className="flex flex-col gap-2">
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
    <li>
      <Link
        href={`/conversations?id=${encodeURIComponent(row.conversation_id)}`}
        className="group block rounded-lg border border-accent-100 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-accent-300"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <code className="font-mono text-sm font-semibold text-accent-900 group-hover:text-accent-700">
            {row.conversation_id}
          </code>
          <time className="font-mono text-xs text-accent-500">{row.last_seen_at}</time>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-accent-500">
          <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
            {row.latest_event_type}
          </code>
          <span aria-hidden="true">·</span>
          <span>
            {row.event_count} event{row.event_count === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex flex-wrap items-center gap-1.5">
            as
            {row.actor_aids.map((a) => (
              <code
                key={a}
                className="rounded bg-accent-50 px-1.5 py-0.5 font-mono text-[11px] text-accent-700"
              >
                {a}
              </code>
            ))}
          </span>
        </div>
      </Link>
    </li>
  );
}

function EmptyInbox() {
  return (
    <Card>
      <CardBody className="border border-dashed border-accent-200 text-center text-sm text-accent-500">
        Your agents haven't participated in any conversations yet. Once they emit signed audit
        events, the chains they appear in will show up here.
      </CardBody>
    </Card>
  );
}

function NoAgentsHint() {
  return (
    <Card>
      <CardBody className="border border-dashed border-accent-200 text-center text-sm text-accent-500">
        You haven't published any agents yet.{" "}
        <Link
          href="/agents/new"
          className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
        >
          Publish one →
        </Link>
      </CardBody>
    </Card>
  );
}

function NeedOwnerHint() {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3 border border-dashed border-accent-200 text-sm text-accent-600">
        <p>
          Sign in via GitHub to see the conversations your agents have participated in. The
          owner-scoped index needs the dashboard to know your owner ID.
        </p>
        <p>
          For now, you can still look up any chain by <Mono>conversation_id</Mono> using the form
          above.
        </p>
      </CardBody>
    </Card>
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
      <Alert tone="danger" title="No chain found">
        No conversation found for <Mono>{id}</Mono>. Either the cloud-api is unreachable or no
        events have been ingested under that ID yet.
      </Alert>
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
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-mono text-base font-semibold text-accent-900">
          {chain.conversation_id}
        </h2>
        <div className="flex flex-wrap items-baseline gap-4">
          <span className="text-sm text-accent-600">
            {chain.total} event{chain.total === 1 ? "" : "s"}
          </span>
          <Link href={fileHref}>
            <Button size="sm">File a dispute</Button>
          </Link>
        </div>
      </div>

      {chain.events.length === 0 ? (
        <Card>
          <CardBody className="border border-dashed border-accent-200 text-center text-sm text-accent-500">
            The chain is empty (no events have been ingested yet).
          </CardBody>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
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
    <li>
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <code className="font-mono text-sm font-medium text-accent-900">{event.event_id}</code>
            {ts && <time className="font-mono text-xs text-accent-500">{ts}</time>}
          </div>

          <dl
            className="mt-3 grid items-baseline gap-x-6 gap-y-1.5 text-sm"
            style={{ gridTemplateColumns: "max-content 1fr" }}
          >
            <dt className="text-accent-500">type</dt>
            <dd className="m-0">
              <Mono>{event.type}</Mono>
            </dd>

            <dt className="text-accent-500">actor</dt>
            <dd className="m-0">
              <Mono breakAll>{event.actor_aid}</Mono>
            </dd>

            <dt className="text-accent-500">prev_hash</dt>
            <dd className="m-0">
              {prevHash ? (
                <code
                  className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800"
                  title={prevHash}
                >
                  {truncate(prevHash, 24)}
                </code>
              ) : (
                <span className="font-mono text-xs text-accent-400">(genesis)</span>
              )}
            </dd>
          </dl>

          <details className="mt-4">
            <summary className="cursor-pointer select-none text-xs font-medium text-accent-600 hover:text-accent-900">
              view raw
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-md border border-accent-100 bg-accent-50/50 p-3 font-mono text-[11px] text-accent-800">
              {JSON.stringify(event, null, 2)}
            </pre>
          </details>
        </CardBody>
      </Card>
    </li>
  );
}

function Mono({ children, breakAll = false }: { children: React.ReactNode; breakAll?: boolean }) {
  return (
    <code
      className={`rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800${breakAll ? " break-all" : ""}`}
    >
      {children}
    </code>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}
