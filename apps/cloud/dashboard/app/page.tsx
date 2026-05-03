/**
 * Landing page — also serves as the public agent catalog (M3 #B.3).
 *
 * Server-rendered: lists every published agent on the configured
 * cloud-api. No auth, no interactivity yet. The styling is browser
 * defaults + a few inline rules; intentionally not a finished UI.
 */

import { listAgents } from "../lib/cloud-api";

export default async function HomePage() {
  const { total, agents } = await listAgents();

  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "48px 24px",
        lineHeight: 1.55,
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ marginBottom: 4 }}>AgentAgora</h1>
        <p style={{ color: "#555", margin: 0 }}>
          Cloud control plane — pre-alpha scaffold.{" "}
          {total === 0
            ? "No agents published yet."
            : `${total} agent${total === 1 ? "" : "s"} published.`}
        </p>
      </header>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Public agent catalog</h2>
        {agents.length === 0 ? (
          <EmptyState />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {agents.map((agent) => (
              <li
                key={agent.aid}
                style={{
                  border: "1px solid #e3e3e3",
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 12,
                  background: "#fff",
                }}
              >
                <div style={{ fontWeight: 600 }}>{agent.aid}</div>
                {agent.description ? (
                  <div style={{ color: "#444", marginTop: 4 }}>{agent.description}</div>
                ) : null}
                <div style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
                  Published {agent.published_at}
                </div>
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
            ))}
          </ul>
        )}
      </section>

      <footer style={{ marginTop: 48, color: "#888", fontSize: 13 }}>
        <p>
          This page is the M2 → M3 dashboard scaffold. The real UX — login, agent CRUD,
          conversations, earnings, disputes — is tracked in <code>docs/m3-launch-checklist.md</code>{" "}
          §A.
        </p>
      </footer>
    </main>
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
        No agents have been published to the configured cloud-api yet. To see this populated:
      </p>
      <ol style={{ marginTop: 8, paddingLeft: 20 }}>
        <li>
          Run <code>pnpm --filter @agentagora/cloud-api dev</code>
        </li>
        <li>
          POST a manifest to <code>/v1/agents</code> (see <code>apps/cloud/api/README.md</code>)
        </li>
        <li>Refresh this page</li>
      </ol>
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
