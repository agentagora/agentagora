/**
 * Owner home — "Welcome back" + counts.
 *
 * Counts are best-effort from the data the cloud-api currently
 * exposes:
 *   - Agents owned: filtered from `GET /v1/agents` (uses
 *     `getOwnedAgents` which probes /v1/agents/:aid for
 *     `published_by`). Until the cloud-api exposes a whoami, we
 *     show "—" for the agent count if we don't yet know an owner ID.
 *   - Conversations: not exposed as an owner-scoped index yet.
 *   - Open disputes: same.
 *
 * Render placeholders rather than fake numbers — empty UI is
 * truthful UI when the index doesn't exist.
 */

import Link from "next/link";
import { requireOwner } from "../../../lib/auth";
import { getOwnedAgents } from "../../../lib/cloud-api";

export default async function DashboardHome() {
  const session = await requireOwner();

  // We don't know the owner ID yet (no whoami) — pass `null` so the
  // helper returns the public catalog. Once the user has published
  // at least once, a future iteration can stash `published_by` on
  // the session cookie and pass it here.
  const owned = await getOwnedAgents(session.bearer, null, 50);

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Welcome back, {session.ownerLabel}.</h1>
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
        <Card label="Agents in catalog" value={owned.length} hint="public list" />
        <Card label="Conversations" value="—" hint="owner-index pending" />
        <Card label="Open disputes" value="—" hint="owner-index pending" />
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>Get started</h2>
        <ul style={{ paddingLeft: 18, color: "#333" }}>
          <li>
            <Link href="/agents/new">Publish a new agent</Link> — paste a manifest and your signing
            key (signed in-browser).
          </li>
          <li>
            <Link href="/agents">Browse the catalog</Link> — currently public; an owner-scoped view
            lands once the cloud-api exposes a filter.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: 8,
        padding: 16,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 13, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}
