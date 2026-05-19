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
import { Badge } from "../../_components/badge";
import { Button } from "../../_components/button";
import { Card, CardBody } from "../../_components/card";

export default async function AgentsPage() {
  const session = await requireOwner();
  const agents = await getOwnedAgents(session.bearer, null, 50);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Agents</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
            Showing the public catalog ({agents.length} entr{agents.length === 1 ? "y" : "ies"}). An
            owner-scoped filter lands when the cloud-api exposes a{" "}
            <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
              published_by
            </code>{" "}
            query — for now every entry is visible.
          </p>
        </div>
        <Link href="/agents/new">
          <Button>+ Publish agent</Button>
        </Link>
      </header>

      {agents.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
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
    <li>
      <Link
        href={`/agents/${encodeURIComponent(agent.aid)}`}
        className="group block rounded-lg border border-accent-100 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-accent-300"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <code className="font-mono text-sm font-semibold text-accent-900 group-hover:text-accent-700">
            {agent.aid}
          </code>
          <time className="font-mono text-xs text-accent-500">{agent.published_at}</time>
        </div>
        {agent.description && (
          <p className="mt-2 text-sm leading-relaxed text-accent-700">{agent.description}</p>
        )}
        {agent.capabilities.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {agent.capabilities.map((cap) => (
              <li key={cap.name}>
                <Badge tone={cap.pricing.model === "free" ? "neutral" : "info"}>
                  <code className="font-mono">{cap.name}</code>
                  <span className="ml-1.5 text-[10px] opacity-75">·</span>
                  <span className="ml-1.5">{pricingLabel(cap.pricing)}</span>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardBody className="border border-dashed border-accent-200 text-center">
        <p className="text-sm text-accent-600">
          No agents in the catalog yet.{" "}
          <Link
            href="/agents/new"
            className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
          >
            Publish your first one →
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}

function pricingLabel(pricing: { model: string; amount?: string; currency?: string }): string {
  if (pricing.model === "free") return "free";
  if (pricing.amount && pricing.currency) {
    return `${pricing.amount} ${pricing.currency} ${pricing.model.replace("_", " ")}`;
  }
  return pricing.model;
}
