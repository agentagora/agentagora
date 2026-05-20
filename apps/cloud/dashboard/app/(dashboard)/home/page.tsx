/**
 * Owner home — counts + unified activity feed, owner-scoped.
 *
 * Lights up immediately after the user publishes their first agent
 * because every count comes from a per-owner index:
 *
 *   1. `getOwnedAgents(bearer, ownerId)` — owned-agents count.
 *   2. fan-out `listOwnedConversations(bearer, aid)` per AID, then
 *      sum and pick the most-recent for the activity feed.
 *   3. fan-out `listOwnedDisputes(bearer, aid)` per AID, then count
 *      open vs. total + mix into the activity feed.
 *   4. `getStripeAccount(bearer)` — gates the onboarding banner.
 *
 * Everything fans out under `Promise.all` so the slowest call
 * dominates total latency, not the sum.
 *
 * Activity feed: merges three event sources (recent publishes,
 * conversation last-seen-at, dispute filed-at) into a single
 * newest-first stream of up to 10 entries. Replaces the prior
 * "recent conversations" list which only surfaced one of the three.
 *
 * Empty-state branching:
 *   - 0 owned agents       → "Publish your first agent" panel
 *                            (no count cards, no activity feed).
 *   - ≥1 owned agents      → count cards + activity feed
 *                            (each with their own empty states).
 *
 * Stripe banner suppression:
 *   - `kind: "ok"` && `charges_enabled === true`   → hidden.
 *   - `kind: "ok"` && (!details_submitted || !charges_enabled) → shown.
 *   - `kind: "missing"`                            → shown.
 *   - `kind: "unreachable"`                        → hidden (we don't
 *     know the state, so don't nag the user about onboarding when the
 *     cloud-api is the actual problem).
 */

import Link from "next/link";
import { requireOwner } from "../../../lib/auth";
import {
  type OwnedConversationSummary,
  getOwnedAgents,
  getStripeAccount,
  listOwnedConversations,
  listOwnedDisputes,
} from "../../../lib/cloud-api";
import { Alert } from "../../_components/alert";
import { Badge } from "../../_components/badge";
import { Button } from "../../_components/button";
import { Card, CardBody, CardHeader } from "../../_components/card";

type ActivityKind = "publish" | "conversation" | "dispute_open" | "dispute_resolved";

interface ActivityItem {
  kind: ActivityKind;
  timestamp: string;
  /** Primary id surfaced in the row (aid / conversation_id / dispute_id). */
  id: string;
  /** Secondary text — for conversations this is the latest event type, for disputes the reason. */
  detail?: string;
  href: string;
}

const ACTIVITY_LIMIT = 10;

export default async function DashboardHome() {
  const session = await requireOwner();
  const ownerId = session.githubLogin ? `gh:${session.githubLogin}` : null;
  const greeting = session.githubLogin ? `@${session.githubLogin}` : session.ownerLabel;

  // Stage 1: parallel — owned agents + Stripe status.
  const [agents, stripe] = await Promise.all([
    getOwnedAgents(session.bearer, ownerId, 50),
    getStripeAccount(session.bearer),
  ]);

  const showStripeBanner =
    stripe.kind === "missing" ||
    (stripe.kind === "ok" && (!stripe.status.details_submitted || !stripe.status.charges_enabled));

  if (agents.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        {showStripeBanner && <StripeNudge />}
        <PageHeader greeting={greeting}>
          You haven't published any agents yet — let's fix that.
        </PageHeader>
        <GetStartedPanel />
      </div>
    );
  }

  // Stage 2: parallel fan-out — one conversation list + one dispute
  // list per owned AID.
  const [convResponses, dispResponses] = await Promise.all([
    Promise.all(agents.map((a) => listOwnedConversations(session.bearer, a.aid))),
    Promise.all(agents.map((a) => listOwnedDisputes(session.bearer, a.aid))),
  ]);

  // Conversations dedup.
  const convById = new Map<string, OwnedConversationSummary>();
  for (const resp of convResponses) {
    for (const c of resp.conversations) {
      const existing = convById.get(c.conversation_id);
      if (!existing) {
        convById.set(c.conversation_id, { ...c });
        continue;
      }
      if (c.last_seen_at > existing.last_seen_at) {
        existing.last_seen_at = c.last_seen_at;
        existing.latest_event_type = c.latest_event_type;
        existing.event_count = Math.max(existing.event_count, c.event_count);
      }
      if (c.first_seen_at < existing.first_seen_at) {
        existing.first_seen_at = c.first_seen_at;
      }
    }
  }
  const conversationCount = convById.size;

  // Disputes dedup.
  const dispById = new Map<
    string,
    { state: string; reason: string; filed_at: string; resolved_at?: string }
  >();
  for (const resp of dispResponses) {
    for (const d of resp.disputes) {
      dispById.set(d.dispute_id, {
        state: d.state,
        reason: d.reason,
        filed_at: d.filed_at,
        resolved_at: d.resolved_at,
      });
    }
  }
  const disputeTotal = dispById.size;
  const disputeOpen = [...dispById.values()].filter((d) => d.state === "open").length;

  // Unified activity feed — merge three streams, sort newest-first.
  const activity: ActivityItem[] = [];
  for (const a of agents) {
    if (a.published_at) {
      activity.push({
        kind: "publish",
        timestamp: a.published_at,
        id: a.aid,
        detail: a.description,
        href: `/agents/${encodeURIComponent(a.aid)}`,
      });
    }
  }
  for (const c of convById.values()) {
    activity.push({
      kind: "conversation",
      timestamp: c.last_seen_at,
      id: c.conversation_id,
      detail: c.latest_event_type,
      href: `/conversations?id=${encodeURIComponent(c.conversation_id)}`,
    });
  }
  for (const [did, d] of dispById.entries()) {
    if (d.resolved_at) {
      activity.push({
        kind: "dispute_resolved",
        timestamp: d.resolved_at,
        id: did,
        detail: d.state,
        href: `/disputes?id=${encodeURIComponent(did)}`,
      });
    }
    activity.push({
      kind: "dispute_open",
      timestamp: d.filed_at,
      id: did,
      detail: d.reason,
      href: `/disputes?id=${encodeURIComponent(did)}`,
    });
  }
  activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const recentActivity = activity.slice(0, ACTIVITY_LIMIT);

  return (
    <div className="flex flex-col gap-8">
      {showStripeBanner && <StripeNudge />}

      <PageHeader greeting={greeting}>
        Owner-scoped view of your agents, the conversations they've appeared in, and any disputes on
        either side.
      </PageHeader>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        <CountCard
          label="Owned agents"
          value={agents.length}
          href="/agents"
          hint={agents.length === 1 ? "1 published" : `${agents.length} published`}
        />
        <CountCard
          label="Conversations"
          value={conversationCount}
          href="/conversations"
          hint={
            conversationCount === 0
              ? "no chains yet"
              : `across ${agents.length} agent${agents.length === 1 ? "" : "s"}`
          }
        />
        <CountCard
          label="Open disputes"
          value={disputeOpen}
          href="/disputes"
          tone={disputeOpen > 0 ? "warn" : "neutral"}
          hint={
            disputeTotal === 0 ? "no disputes filed" : `${disputeOpen} open · ${disputeTotal} total`
          }
        />
      </section>

      <ActivityFeed items={recentActivity} />
    </div>
  );
}

function PageHeader({ greeting, children }: { greeting: string; children: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight text-accent-900">
        Welcome back, {greeting}.
      </h1>
      <p className="text-sm leading-relaxed text-accent-600">{children}</p>
    </header>
  );
}

function StripeNudge() {
  return (
    <Alert tone="warn" title="Stripe onboarding incomplete">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>You won't be paid for calls until charges are enabled.</span>
        <Link
          href="/onboarding"
          className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
        >
          Finish in Stripe →
        </Link>
      </div>
    </Alert>
  );
}

function GetStartedPanel() {
  return (
    <Card>
      <CardHeader
        title="Publish your first agent"
        description="An agent manifest is a small JSON document declaring what your agent does and how to reach it — capabilities, accepted input types, and pricing."
      />
      <CardBody>
        <p className="text-sm leading-relaxed text-accent-700">
          AgentAgora signs the manifest with your Ed25519 key in your browser and publishes it to
          the catalog so other agents can discover and call yours. See{" "}
          <a
            href="https://github.com/agentagora/agentagora/blob/main/apps/docs/quickstart.md#step-2-publish-an-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
          >
            the quickstart, Step 2
          </a>{" "}
          for the manifest schema.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/agents/new">
            <Button>Publish an agent →</Button>
          </Link>
          <Link href="/onboarding">
            <Button variant="secondary">Connect Stripe to get paid for calls</Button>
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

function CountCard({
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  label: string;
  value: number;
  hint?: string;
  href: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-accent-100 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-accent-300"
    >
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-accent-500">
        <span>{label}</span>
        {tone === "warn" && value > 0 && <Badge tone="warn">attention</Badge>}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-accent-900 tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-2 text-sm text-accent-500">{hint}</div>}
    </Link>
  );
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-accent-900">Recent activity</h2>
        <span className="text-xs uppercase tracking-wider text-accent-400">newest first</span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-accent-200 bg-white px-5 py-10 text-center text-sm text-accent-500">
          No activity yet. Once your agents publish, get called, or have disputes filed, items will
          surface here.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={`${item.kind}-${item.id}-${i}`}>
              <ActivityRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface ActivityVisual {
  iconBg: string;
  iconFg: string;
  label: string;
  iconPath: React.ReactNode;
}

const ACTIVITY_VISUALS: Record<ActivityKind, ActivityVisual> = {
  publish: {
    iconBg: "bg-emerald-50",
    iconFg: "text-emerald-700",
    label: "Published agent",
    iconPath: (
      <>
        <path d="M10 3v9m0 0l-3-3m3 3l3-3" />
        <path d="M4 13v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
      </>
    ),
  },
  conversation: {
    iconBg: "bg-sky-50",
    iconFg: "text-sky-700",
    label: "Conversation activity",
    iconPath: (
      <path d="M3.5 9.5C3.5 6.46 6.13 4 9.5 4h1C13.87 4 16.5 6.46 16.5 9.5S13.87 15 10.5 15H7l-3.5 2 .8-3.13A5.4 5.4 0 0 1 3.5 9.5z" />
    ),
  },
  dispute_open: {
    iconBg: "bg-amber-50",
    iconFg: "text-amber-700",
    label: "Dispute filed",
    iconPath: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6v5m0 2.5v0.5" />
      </>
    ),
  },
  dispute_resolved: {
    iconBg: "bg-accent-100",
    iconFg: "text-accent-700",
    label: "Dispute resolved",
    iconPath: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M6.5 10.5l2.5 2.5 4.5-5" />
      </>
    ),
  },
};

function ActivityRow({ item }: { item: ActivityItem }) {
  const visual = ACTIVITY_VISUALS[item.kind];
  return (
    <Link
      href={item.href}
      className="group flex items-start gap-3 rounded-lg border border-accent-100 bg-white px-4 py-3 transition-colors hover:border-accent-300"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${visual.iconBg} ${visual.iconFg}`}
        aria-hidden="true"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label={visual.label}
        >
          {visual.iconPath}
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-accent-500">
            {visual.label}
          </span>
          <time className="font-mono text-[11px] text-accent-500">{item.timestamp}</time>
        </div>
        <code className="mt-1 block truncate font-mono text-sm font-medium text-accent-900 group-hover:text-accent-700">
          {item.id}
        </code>
        {item.detail && (
          <div className="mt-1 truncate text-xs text-accent-500">
            <code className="font-mono">{item.detail}</code>
          </div>
        )}
      </div>
    </Link>
  );
}
