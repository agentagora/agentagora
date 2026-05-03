/**
 * Owner-scoped agent list.
 *
 * The cloud-api's `GET /v1/agents` doesn't expose `published_by` in
 * the list response and there's no per-owner filter, so this page
 * fetches the public catalog and shows it as-is. The brief asks for
 * client-side filtering on `published_by`, but that field is only
 * present on the *detail* response — `getOwnedAgents` walks the list
 * and probes each detail endpoint to filter, which is fine at alpha
 * scale (≤ 50 agents). Once the cloud-api exposes an owner index
 * this page becomes a single GET with a query param.
 */

import Link from "next/link";
import { requireOwner } from "../../../lib/auth";
import { type AgentListEntry, getOwnedAgents } from "../../../lib/cloud-api";

export default async function AgentsPage() {
  const session = await requireOwner();
  const agents = await getOwnedAgents(session.bearer, null, 50);

  return (
    <div>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0 }}>Agents</h1>
        <Link
          href="/agents/new"
          style={{
            padding: "8px 14px",
            background: "#0366d6",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Publish agent
        </Link>
      </header>

      <p style={{ color: "#555", marginTop: 0 }}>
        Showing the public catalog ({agents.length} entr{agents.length === 1 ? "y" : "ies"}). An
        owner-scoped filter lands when the cloud-api exposes a <code>published_by</code> query — for
        now every entry is visible.
      </p>

      {agents.length === 0 ? (
        <EmptyState />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {agents.map((agent) => (
            <AgentRow key={agent.aid} agent={agent} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentListEntry }) {
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <Link
          href={`/agents/${encodeURIComponent(agent.aid)}`}
          style={{ fontWeight: 600, color: "#0366d6", textDecoration: "none" }}
        >
          {agent.aid}
        </Link>
        <span style={{ fontSize: 12, color: "#888" }}>{agent.published_at}</span>
      </div>
      {agent.description ? (
        <div style={{ color: "#444", marginTop: 4 }}>{agent.description}</div>
      ) : null}
      <ul
        style={{
          fontSize: 13,
          color: "#444",
          paddingLeft: 16,
          marginTop: 8,
          marginBottom: 0,
        }}
      >
        {agent.capabilities.map((cap) => (
          <li key={cap.name}>
            <code>{cap.name}</code> · {pricingLabel(cap.pricing)}
          </li>
        ))}
      </ul>
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
        color: "#666",
      }}
    >
      <p style={{ margin: 0 }}>
        No agents in the catalog yet. <Link href="/agents/new">Publish your first one →</Link>
      </p>
    </div>
  );
}

function pricingLabel(pricing: { model: string; amount?: string; currency?: string }): string {
  if (pricing.model === "free") return "free";
  if (pricing.amount && pricing.currency) {
    return `${pricing.amount} ${pricing.currency} ${pricing.model.replace("_", " ")}`;
  }
  return pricing.model;
}
