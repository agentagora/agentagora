/**
 * Tiny client for `@agentagora/cloud-api`'s public read routes.
 *
 * Just the endpoints the dashboard renders today (the agent list).
 * Bearer-authed write paths and dispute / settlement reads land
 * once the auth flow is decided.
 */

import type { Manifest } from "@agentagora/protocol";

const BASE_URL = process.env.AGENTAGORA_CLOUD_URL ?? "http://localhost:8787";

export interface AgentListEntry {
  aid: string;
  description?: string;
  capabilities: Array<{
    name: string;
    pricing: Manifest["capabilities"][number]["pricing"];
    accepts: string[];
  }>;
  published_at: string;
}

export interface AgentListResponse {
  total: number;
  agents: AgentListEntry[];
}

/**
 * Fetch the public agent catalog. Returns an empty list when the
 * cloud-api is unreachable so the page can still render with a
 * "no agents yet" state instead of crashing the route.
 */
export async function listAgents(
  filter: {
    capability?: string;
    accepts?: string;
    q?: string;
  } = {},
): Promise<AgentListResponse> {
  const params = new URLSearchParams();
  if (filter.capability) params.set("capability", filter.capability);
  if (filter.accepts) params.set("accepts", filter.accepts);
  if (filter.q) params.set("q", filter.q);
  const query = params.toString();
  const url = `${BASE_URL}/v1/agents${query ? `?${query}` : ""}`;

  try {
    const res = await fetch(url, {
      // Server component fetch — cache while the page is being
      // rendered, revalidate every minute on subsequent renders.
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      console.error(`[cloud-api] /v1/agents responded ${res.status}`);
      return { total: 0, agents: [] };
    }
    return (await res.json()) as AgentListResponse;
  } catch (err) {
    console.error("[cloud-api] /v1/agents unreachable", err);
    return { total: 0, agents: [] };
  }
}
