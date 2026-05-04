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
      <div>
        {showStripeBanner ? <StripeNudge /> : null}
        <h1 style={{ marginBottom: 8 }}>Welcome back, {greeting}.</h1>
        <p style={{ color: "#555", marginTop: 0 }}>
          You haven't published any agents yet — let's fix that.
        </p>
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

  return (
    <div>
      {showStripeBanner ? <StripeNudge /> : null}
      <h1 style={{ marginBottom: 8 }}>Welcome back, {greeting}.</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Cloud control plane is online. The dashboard reads from{" "}
        <code>{process.env.AGENTAGORA_CLOUD_URL ?? "http://localhost:8787"}</code>.
      </p>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginTop: 24,
        }}
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
          hint={
            disputeTotal === 0 ? "no disputes filed" : `${disputeOpen} open · ${disputeTotal} total`
          }
        />
      </section>

      <RecentConversations rows={recentConversations} />
    </div>
  );
}

function StripeNudge() {
  return (
    <div
      style={{
        background: "#fff8e1",
        border: "1px solid #f0d480",
        color: "#5a4400",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 20,
        fontSize: 13,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>
        <strong>Stripe onboarding incomplete.</strong> You won't be paid for calls until charges are
        enabled.
      </span>
      <Link
        href="/onboarding"
        style={{
          color: "#5a4400",
          fontWeight: 600,
          textDecoration: "underline",
          whiteSpace: "nowrap",
        }}
      >
        Finish in Stripe →
      </Link>
    </div>
  );
}

function GetStartedPanel() {
  return (
    <section
      style={{
        marginTop: 24,
        border: "1px solid #e3e3e3",
        borderRadius: 12,
        padding: 28,
        background: "#fff",
      }}
    >
      <h2 style={{ fontSize: 22, margin: 0, marginBottom: 8 }}>Publish your first agent</h2>
      <p style={{ color: "#444", marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
        An <strong>agent manifest</strong> is a small JSON document describing what your agent does
        and how to reach it — capabilities, accepted input types, and pricing. AgentAgora signs it
        with your Ed25519 key in your browser and publishes it to the catalog so other agents can
        discover and call yours. See{" "}
        <a
          href="https://github.com/agentagora/agentagora/blob/main/apps/docs/quickstart.md#step-2-publish-an-agent"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#0366d6" }}
        >
          the quickstart, Step 2
        </a>{" "}
        for the manifest schema.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/agents/new"
          style={{
            background: "#0366d6",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Publish an agent →
        </Link>
        <Link
          href="/onboarding"
          style={{
            background: "#fff",
            color: "#0366d6",
            border: "1px solid #0366d6",
            padding: "10px 18px",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Connect Stripe to get paid for calls
        </Link>
      </div>
    </section>
  );
}

function CountCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number;
  hint?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        border: "1px solid #e3e3e3",
        borderRadius: 8,
        padding: 16,
        background: "#fff",
        color: "#111",
        textDecoration: "none",
      }}
    >
      <div style={{ fontSize: 13, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{hint}</div> : null}
    </Link>
  );
}

function RecentConversations({ rows }: { rows: OwnedConversationSummary[] }) {
  return (
    <section style={{ marginTop: 32 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 16, margin: 0 }}>Recent conversations</h2>
        {rows.length > 0 ? (
          <Link
            href="/conversations"
            style={{ fontSize: 13, color: "#0366d6", textDecoration: "none" }}
          >
            View all →
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            border: "1px dashed #ccc",
            borderRadius: 8,
            padding: 20,
            background: "#fff",
            color: "#666",
            fontSize: 13,
          }}
        >
          Your agents haven't participated in any conversations yet. Once they emit signed audit
          events, the chains will surface here.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row) => (
            <li
              key={row.conversation_id}
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
                }}
              >
                <Link
                  href={`/conversations?id=${encodeURIComponent(row.conversation_id)}`}
                  style={{
                    fontWeight: 600,
                    color: "#0366d6",
                    textDecoration: "none",
                    fontSize: 13,
                  }}
                >
                  <code>{row.conversation_id}</code>
                </Link>
                <span style={{ fontSize: 12, color: "#888" }}>{row.last_seen_at}</span>
              </div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                <code>{row.latest_event_type}</code>
                <span style={{ marginLeft: 12 }}>
                  {row.event_count} event{row.event_count === 1 ? "" : "s"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
