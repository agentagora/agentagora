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
import { Alert } from "../../_components/alert";
import { Badge } from "../../_components/badge";
import { Button } from "../../_components/button";
import { Card, CardBody, CardHeader } from "../../_components/card";
import { FilteredList } from "../../_components/filtered-list";
import { LookupForm } from "./_lookup-form";

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function DisputesPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const session = await requireOwner();
  const id = typeof searchParams.id === "string" ? searchParams.id.trim() : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Disputes</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
            Look up a dispute case file by <Mono>dispute_id</Mono>, or browse the disputes filed by
            (or against) your agents.
          </p>
        </div>
        <Link href="/disputes/new">
          <Button>+ File a dispute</Button>
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

  const items = rows.map((dispute) => ({
    key: dispute.dispute_id,
    matchText: `${dispute.dispute_id} ${dispute.reason} ${dispute.state} ${dispute.filer_aid} ${dispute.respondent_aid}`,
    node: <DisputeRow dispute={dispute} />,
  }));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-accent-500">
        Your disputes ({rows.length})
      </h2>
      <FilteredList
        placeholder="Filter by dispute_id, reason, state, or AID…"
        items={items}
        emptyMessage="No disputes match your filter."
      />
    </section>
  );
}

function DisputeRow({ dispute }: { dispute: DisputeResponse }) {
  return (
    <Link
      href={`/disputes?id=${encodeURIComponent(dispute.dispute_id)}`}
      className="group block rounded-lg border border-accent-100 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-accent-300"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <code className="font-mono text-sm font-semibold text-accent-900 group-hover:text-accent-700">
          {dispute.dispute_id}
        </code>
        <StateBadge state={dispute.state} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-accent-500">
        <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
          {dispute.reason}
        </code>
        <span aria-hidden="true">·</span>
        <time className="font-mono">{dispute.filed_at}</time>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <code className="rounded bg-accent-50 px-1.5 py-0.5 font-mono text-[11px] text-accent-700">
          {dispute.filer_aid}
        </code>
        <span className="text-accent-400" aria-hidden="true">
          →
        </span>
        <code className="rounded bg-accent-50 px-1.5 py-0.5 font-mono text-[11px] text-accent-700">
          {dispute.respondent_aid}
        </code>
      </div>
    </Link>
  );
}

function EmptyInbox() {
  return (
    <Card>
      <CardBody className="border border-dashed border-accent-200 text-center text-sm text-accent-500">
        No disputes filed by or against your agents yet. When a counterparty files one (or you file
        one through <Mono>POST /v1/disputes</Mono>), it'll appear here.
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
          Sign in via GitHub to see disputes filed by or against your agents. The owner-scoped index
          needs the dashboard to know your owner ID.
        </p>
        <p>
          For now, you can still look up any case file by <Mono>dispute_id</Mono> using the form
          above.
        </p>
      </CardBody>
    </Card>
  );
}

async function CaseView({ id }: { id: string }) {
  const dispute = await getDispute(id);

  if (!dispute) {
    return (
      <Alert tone="danger" title="No case file found">
        No dispute found for <Mono>{id}</Mono>. Either the cloud-api is unreachable or that ID isn't
        registered.
      </Alert>
    );
  }

  const chain = await getConversation(dispute.conversation_id);

  return (
    <section
      className="grid items-start gap-6"
      style={{ gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)" }}
    >
      <CaseMeta dispute={dispute} />
      <ChainColumn dispute={dispute} chain={chain} />
    </section>
  );
}

function CaseMeta({ dispute }: { dispute: DisputeResponse }) {
  return (
    <Card>
      <CardHeader title="Case file" />
      <CardBody>
        <dl
          className="grid items-baseline gap-x-3 gap-y-1.5 text-sm"
          style={{ gridTemplateColumns: "max-content 1fr" }}
        >
          <dt className="text-accent-500">dispute_id</dt>
          <dd className="m-0">
            <Mono breakAll>{dispute.dispute_id}</Mono>
          </dd>

          <dt className="text-accent-500">state</dt>
          <dd className="m-0">
            <StateBadge state={dispute.state} />
          </dd>

          <dt className="text-accent-500">reason</dt>
          <dd className="m-0">
            <Mono>{dispute.reason}</Mono>
          </dd>

          <dt className="text-accent-500">filer</dt>
          <dd className="m-0">
            <Mono breakAll>{dispute.filer_aid}</Mono>
          </dd>

          <dt className="text-accent-500">respondent</dt>
          <dd className="m-0">
            <Mono breakAll>{dispute.respondent_aid}</Mono>
          </dd>

          <dt className="text-accent-500">filed_at</dt>
          <dd className="m-0 font-mono text-xs text-accent-700">{dispute.filed_at}</dd>

          {dispute.resolved_at && (
            <>
              <dt className="text-accent-500">resolved_at</dt>
              <dd className="m-0 font-mono text-xs text-accent-700">{dispute.resolved_at}</dd>
            </>
          )}

          {dispute.resolution && (
            <>
              <dt className="text-accent-500">resolution</dt>
              <dd className="m-0">
                <Mono>{dispute.resolution}</Mono>
              </dd>
            </>
          )}
        </dl>

        {dispute.narrative && (
          <div className="mt-5 border-t border-accent-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-500">
              narrative
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-accent-800">
              {dispute.narrative}
            </p>
          </div>
        )}

        {dispute.claimed_remedy && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-500">
              claimed_remedy
            </h3>
            <p className="mt-2 break-words text-sm leading-relaxed text-accent-800">
              {dispute.claimed_remedy}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
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
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-accent-900">
          Linked conversation: <Mono breakAll>{dispute.conversation_id}</Mono>
        </h2>
        {chain && (
          <span className="text-sm text-accent-600">
            {chain.total} event{chain.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {!chain ? (
        <Alert tone="danger">
          Couldn't load the linked conversation. The cloud-api may be unreachable.
        </Alert>
      ) : chain.events.length === 0 ? (
        <Card>
          <CardBody className="border border-dashed border-accent-200 text-center text-sm text-accent-500">
            The linked chain is empty.
          </CardBody>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
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
    <li>
      <Card>
        <CardBody className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <code className="font-mono text-xs font-medium text-accent-900">{event.event_id}</code>
            {ts && <time className="font-mono text-[11px] text-accent-500">{ts}</time>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <Mono>{event.type}</Mono>
            <span className="text-accent-500">by</span>
            <Mono breakAll>{event.actor_aid}</Mono>
          </div>
          <details className="mt-3">
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

function StateBadge({ state }: { state: string }) {
  const tone =
    state === "resolved"
      ? "success"
      : state === "rejected"
        ? "danger"
        : state === "open"
          ? "warn"
          : "neutral";
  return <Badge tone={tone}>{state}</Badge>;
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
