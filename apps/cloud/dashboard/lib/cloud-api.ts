/**
 * Tiny client for `@agentagora/cloud-api`.
 *
 * Public read paths (catalog) plus the handful of authenticated
 * GETs the dashboard renders today. Writes that require Ed25519
 * signatures (publish, dispute) are issued from the browser; this
 * module just gives the server-rendered pages a typed view of what
 * the cloud-api will return.
 */

import type { Manifest } from "@agentagora/protocol";

export const BASE_URL = process.env.AGENTAGORA_CLOUD_URL ?? "http://localhost:8787";

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

/**
 * Detail view for a single AID. Public; no bearer required.
 */
export interface AgentDetail {
  aid: string;
  manifest: Manifest;
  identity_jwt: string;
  published_at: string;
  /** Only present on the detail response when the cloud-api is at
   *  v0.0.2+; older deployments omit it. */
  published_by?: string;
  pubkey?: string;
}

export async function getAgent(aid: string): Promise<AgentDetail | null> {
  const url = `${BASE_URL}/v1/agents/${encodeURIComponent(aid)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[cloud-api] /v1/agents/${aid} responded ${res.status}`);
      return null;
    }
    return (await res.json()) as AgentDetail;
  } catch (err) {
    console.error("[cloud-api] /v1/agents/:aid unreachable", err);
    return null;
  }
}

/**
 * Filter the public agent list down to those whose manifests look
 * like they belong to the bearer's owner. The cloud-api's list
 * endpoint doesn't expose `published_by` today, so we use a
 * best-effort heuristic: hit GET /v1/agents/:aid for each entry and
 * check `published_by` against `expectedOwner`. To bound work, we
 * only resolve the first `limit` entries; the dashboard pagination
 * lands once the cloud-api adds an owner-scoped index.
 *
 * Calling this with `expectedOwner === null` returns every public
 * entry — useful while the dashboard hasn't yet learned the owner ID
 * from a successful publish.
 */
export async function getOwnedAgents(
  bearer: string,
  expectedOwner: string | null,
  limit = 50,
): Promise<AgentListEntry[]> {
  // The bearer isn't actually needed for the list endpoint (it's
  // public), but accepting it keeps the call sites consistent and
  // lets us add owner-scoped filtering later without changing the
  // signature. Suppress the unused-var lint by reading length:
  void bearer.length;

  const { agents } = await listAgents();
  if (!expectedOwner) return agents;

  const slice = agents.slice(0, limit);
  const detailed = await Promise.all(slice.map((entry) => getAgent(entry.aid)));
  return slice.filter((_entry, i) => detailed[i]?.published_by === expectedOwner);
}

export interface ConversationEvent {
  event_id: string;
  conversation_id: string;
  actor_aid: string;
  type: string;
  occurred_at?: string;
  ingested_at?: string;
  /** The full event body is permissive at the wire level; the
   *  dashboard renders summary fields only. */
  [key: string]: unknown;
}

export interface ConversationResponse {
  conversation_id: string;
  total: number;
  events: ConversationEvent[];
}

export async function getConversation(id: string): Promise<ConversationResponse | null> {
  const url = `${BASE_URL}/v1/conversations/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[cloud-api] /v1/conversations/${id} responded ${res.status}`);
      return null;
    }
    return (await res.json()) as ConversationResponse;
  } catch (err) {
    console.error("[cloud-api] /v1/conversations/:id unreachable", err);
    return null;
  }
}

/**
 * `GET /v1/connect/account` — caller's Stripe Connect account status.
 *
 * Returns:
 *   `{ kind: "ok", ... }`         200 from cloud-api with the account record
 *   `{ kind: "missing" }`         404 — owner has no Stripe account yet
 *   `{ kind: "unreachable" }`     network error or unexpected non-2xx
 *
 * We model "no account yet" as a first-class case rather than a
 * `null` return because the page rendering distinguishes it from
 * "cloud-api is down" (different copy, different next action).
 */
export interface StripeAccountStatus {
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
}

export interface StripeAccountResponse {
  account_id: string;
  status: StripeAccountStatus;
  created_at: string;
  updated_at: string;
}

export type StripeAccountResult =
  | ({ kind: "ok" } & StripeAccountResponse)
  | { kind: "missing" }
  | { kind: "unreachable" };

export async function getStripeAccount(bearer: string): Promise<StripeAccountResult> {
  const url = `${BASE_URL}/v1/connect/account`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (res.status === 404) return { kind: "missing" };
    if (!res.ok) {
      console.error(`[cloud-api] /v1/connect/account responded ${res.status}`);
      return { kind: "unreachable" };
    }
    const body = (await res.json()) as StripeAccountResponse;
    return { kind: "ok", ...body };
  } catch (err) {
    console.error("[cloud-api] /v1/connect/account unreachable", err);
    return { kind: "unreachable" };
  }
}

/**
 * `GET /v1/disputes/:id` — public-by-ID case file read. No bearer
 * required (dispute IDs are unguessable random tokens; the cloud-api
 * deliberately leaves the read path open so adjudicators / inspectors
 * can fetch chains without coordinating credentials).
 *
 * The wire shape mirrors `disputeView()` in cloud-api's
 * `routes/disputes.ts`. Optional fields are populated only when the
 * record carries them.
 */
export interface DisputeResponse {
  dispute_id: string;
  conversation_id: string;
  filed_by: string;
  filer_aid: string;
  respondent_aid: string;
  reason: "non_delivery" | "wrong_output" | "fraud" | "other";
  state: "open" | "resolved" | "rejected" | string;
  filed_at: string;
  narrative?: string;
  claimed_remedy?: string;
  resolved_at?: string;
  resolution?: string;
}

export async function getDispute(id: string): Promise<DisputeResponse | null> {
  const url = `${BASE_URL}/v1/disputes/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[cloud-api] /v1/disputes/${id} responded ${res.status}`);
      return null;
    }
    return (await res.json()) as DisputeResponse;
  } catch (err) {
    console.error("[cloud-api] /v1/disputes/:id unreachable", err);
    return null;
  }
}

/**
 * Validate a bearer token by hitting cloud-api's healthz with the
 * Authorization header and confirming the API is reachable. The
 * cloud-api doesn't expose a `/v1/whoami`, so we can't actually
 * verify the *token* against an owner mapping from here — but we
 * can confirm the cloud-api itself is up before storing a session.
 *
 * Returns:
 *   "ok"           cloud-api is reachable; bearer is stored as-is
 *   "unreachable"  network error / non-2xx from /healthz
 */
export async function pingCloudApi(): Promise<"ok" | "unreachable"> {
  try {
    const res = await fetch(`${BASE_URL}/healthz`, { cache: "no-store" });
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}
