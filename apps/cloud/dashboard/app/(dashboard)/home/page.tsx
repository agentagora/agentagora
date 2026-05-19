/**
 * Owner home — "Welcome back" + counts, owner-scoped.
 *
 * Lights up immediately after the user publishes their first agent
 * because every count comes from a per-owner index:
 *
 *   1. `getOwnedAgents(bearer, ownerId)` — owned-agents count.
 *   2. fan-out `listOwnedConversations(bearer, aid)` per AID, then
 *      sum and pick the 5 most-recent for the activity feed.
 *   3. fan-out `listOwnedDisputes(bearer, aid)` per AID, then count
 *      open vs. total.
 *   4. `getStripeAccount(bearer)` — gates the onboarding banner.
 *
 * Everything fans out under a single `Promise.all` so the slowest
 * call dominates total latency, not the sum.
 *
 * Empty-state branching:
 *   - 0 owned agents       → "Publish your first agent" panel
 *                            (no count cards, no recent list).
 *   - ≥1 owned agents      → count cards + recent-conversations list
 *                            (with their own empty states).
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

export default async function DashboardHome() {
  const session = await requireOwner();
  const ownerId = session.githubLogin ? `gh:${session.githubLogin}` : null;
  const greeting = session.githubLogin ? `@${session.githubLogin}` : session.ownerLabel;

  // Stage 1: parallel — owned agents + Stripe status. We need the
  // agents list before we can fan out per-AID, so this is one round
  // trip on its own.
  const [agents, stripe] = await Promise.all([
    getOwnedAgents(session.bearer, ownerId, 50),
    getStripeAccount(session.bearer),
  ]);

  const showStripeBanner =
    stripe.kind === "missing" ||
    (stripe.kind === "ok" && (!stripe.status.details_submitted || !stripe.status.charges_enabled));

  // Empty state — no agents yet. Skip the per-AID fan-out entirely.
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
  // list per owned AID. Each helper is itself bearer-authed and the
  // cloud-api 403s on cross-owner requests, so this is safe.
  const [convResponses, dispResponses] = await Promise.all([
    Promise.all(agents.map((a) => listOwnedConversations(session.bearer, a.aid))),
    Promise.all(agents.map((a) => listOwnedDisputes(session.bearer, a.aid))),
  ]);

  // Conversations: dedup by conversation_id (a chain may surface
  // under multiple of the caller's AIDs), keep newest last_seen_at.
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
  const recentConversations = [...convById.values()]
    .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
    .slice(0, 5);

  // Disputes: dedup by dispute_id (listOwnedDisputes already merges
  // filer+respondent within a single AID, but the same case can also
  // span two of the caller's AIDs).
  const dispById = new Map<string, { state: string }>();
  for (const resp of dispResponses) {
    for (const d of resp.disputes) {
      dispById.set(d.dispute_id, { state: d.state });
    }
  }
  const disputeTotal = dispById.size;
  const disputeOpen = [...dispById.values()].filter((d) => d.state === "open").length;

  const cloudUrl = process.env.AGENTAGORA_CLOUD_URL ?? "http://localhost:8787";

  return (
    <div className="flex flex-col gap-8">
      {showStripeBanner && <StripeNudge />}

      <PageHeader greeting={greeting}>
        Cloud control plane is online. The dashboard reads from{" "}
        <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
          {cloudUrl}
        </code>
        .
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

      <RecentConversations rows={recentConversations} />
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

function RecentConversations({ rows }: { rows: OwnedConversationSummary[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-accent-900">Recent conversations</h2>
        {rows.length > 0 && (
          <Link
            href="/conversations"
            className="text-sm font-medium text-accent-700 underline-offset-2 hover:text-accent-900 hover:underline"
          >
            View all →
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-accent-200 bg-white px-5 py-8 text-center text-sm text-accent-500">
          Your agents haven't participated in any conversations yet. Once they emit signed audit
          events, the chains will surface here.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.conversation_id}>
              <Link
                href={`/conversations?id=${encodeURIComponent(row.conversation_id)}`}
                className="flex flex-col gap-1 rounded-lg border border-accent-100 bg-white px-4 py-3 transition-colors hover:border-accent-300"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <code className="font-mono text-sm font-medium text-accent-900">
                    {row.conversation_id}
                  </code>
                  <time className="font-mono text-xs text-accent-500">{row.last_seen_at}</time>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-accent-500">
                  <code className="font-mono">{row.latest_event_type}</code>
                  <span aria-hidden="true">·</span>
                  <span>
                    {row.event_count} event{row.event_count === 1 ? "" : "s"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
