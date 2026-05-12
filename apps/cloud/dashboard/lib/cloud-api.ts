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

/**
 * Format a fetch failure for human-readable logs without dumping the
 * raw error object. Node's `AggregateError` (e.g., ECONNREFUSED on a
 * dual-stack host) renders as `[ [Error], [Error] ]` — and GitHub
 * Actions's log annotator sees those `[Error]` substrings and lights
 * up every build with red error annotations even when the build
 * itself succeeded. Stringifying to a single line via this helper
 * keeps the log informative while suppressing the annotator's
 * false-positive surface.
 */
function fmtErr(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "code" in cause) {
      return `${err.message} (${(cause as { code: string }).code})`;
    }
    return err.message;
  }
  return String(err);
}

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
      console.warn(`[cloud-api] /v1/agents responded ${res.status}`);
      return { total: 0, agents: [] };
    }
    return (await res.json()) as AgentListResponse;
  } catch (err) {
    console.warn(`[cloud-api] /v1/agents unreachable: ${fmtErr(err)}`);
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
      console.warn(`[cloud-api] /v1/agents/${aid} responded ${res.status}`);
      return null;
    }
    return (await res.json()) as AgentDetail;
  } catch (err) {
    console.warn(`[cloud-api] /v1/agents/:aid unreachable: ${fmtErr(err)}`);
    return null;
  }
}

/**
 * List the agents owned by `expectedOwner` via the cloud-api's
 * `GET /v1/agents?owner=<id>` endpoint (Bearer-authed; the cloud-api
 * checks that the bearer's resolved owner matches).
 *
 * `limit` is preserved for backwards compatibility with the previous
 * detail-fetch heuristic but no longer applied — the cloud-api
 * returns the full owner-scoped list in one round trip. Calling with
 * `expectedOwner === null` returns the public catalog (useful while
 * the dashboard hasn't yet learned the owner ID from publish).
 */
export async function getOwnedAgents(
  bearer: string,
  expectedOwner: string | null,
  _limit = 50,
): Promise<AgentListEntry[]> {
  if (!expectedOwner) {
    const { agents } = await listAgents();
    return agents;
  }
  const url = `${BASE_URL}/v1/agents?owner=${encodeURIComponent(expectedOwner)}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) {
      console.warn(`[cloud-api] /v1/agents?owner= responded ${res.status}`);
      return [];
    }
    const body = (await res.json()) as AgentListResponse;
    return body.agents;
  } catch (err) {
    console.warn(`[cloud-api] /v1/agents?owner= unreachable: ${fmtErr(err)}`);
    return [];
  }
}

/**
 * `GET /v1/conversations?actor=<aid>` — distinct conversations the
 * AID has signed an event in, with roll-up metadata. Bearer-authed;
 * the cloud-api 403s if the bearer doesn't own the AID.
 */
export interface OwnedConversationSummary {
  conversation_id: string;
  first_seen_at: string;
  last_seen_at: string;
  event_count: number;
  latest_event_type: string;
}

export interface OwnedConversationsResponse {
  total: number;
  conversations: OwnedConversationSummary[];
}

export async function listOwnedConversations(
  bearer: string,
  aid: string,
): Promise<OwnedConversationsResponse> {
  const url = `${BASE_URL}/v1/conversations?actor=${encodeURIComponent(aid)}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) {
      console.warn(`[cloud-api] /v1/conversations?actor= responded ${res.status}`);
      return { total: 0, conversations: [] };
    }
    return (await res.json()) as OwnedConversationsResponse;
  } catch (err) {
    console.warn(`[cloud-api] /v1/conversations?actor= unreachable: ${fmtErr(err)}`);
    return { total: 0, conversations: [] };
  }
}

/**
 * `GET /v1/disputes?filer=<aid>` + `?respondent=<aid>` — disputes the
 * bearer's AID is on either side of. Bearer-authed; the cloud-api
 * 403s on cross-owner queries. Two calls because the endpoint ANDs
 * filer+respondent when both are present, but we want the union.
 */
export interface OwnedDisputeListResponse {
  total: number;
  disputes: DisputeResponse[];
}

export async function listOwnedDisputes(
  bearer: string,
  aid: string,
): Promise<OwnedDisputeListResponse> {
  const queries: ("filer" | "respondent")[] = ["filer", "respondent"];
  try {
    const responses = await Promise.all(
      queries.map(async (role) => {
        const url = `${BASE_URL}/v1/disputes?${role}=${encodeURIComponent(aid)}`;
        const res = await fetch(url, {
          cache: "no-store",
          headers: { authorization: `Bearer ${bearer}` },
        });
        if (!res.ok) {
          console.warn(`[cloud-api] /v1/disputes?${role}= responded ${res.status}`);
          return { total: 0, disputes: [] } as OwnedDisputeListResponse;
        }
        return (await res.json()) as OwnedDisputeListResponse;
      }),
    );
    // Merge + dedup by dispute_id (a dispute where filer===respondent
    // would otherwise show up twice — vanishingly rare but cheap to
    // guard against).
    const byId = new Map<string, DisputeResponse>();
    for (const r of responses) {
      for (const d of r.disputes) byId.set(d.dispute_id, d);
    }
    const disputes = [...byId.values()].sort((a, b) => b.filed_at.localeCompare(a.filed_at));
    return { total: disputes.length, disputes };
  } catch (err) {
    console.warn(`[cloud-api] /v1/disputes?filer/respondent unreachable: ${fmtErr(err)}`);
    return { total: 0, disputes: [] };
  }
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
      console.warn(`[cloud-api] /v1/conversations/${id} responded ${res.status}`);
      return null;
    }
    return (await res.json()) as ConversationResponse;
  } catch (err) {
    console.warn(`[cloud-api] /v1/conversations/:id unreachable: ${fmtErr(err)}`);
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
      console.warn(`[cloud-api] /v1/connect/account responded ${res.status}`);
      return { kind: "unreachable" };
    }
    const body = (await res.json()) as StripeAccountResponse;
    return { kind: "ok", ...body };
  } catch (err) {
    console.warn(`[cloud-api] /v1/connect/account unreachable: ${fmtErr(err)}`);
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
      console.warn(`[cloud-api] /v1/disputes/${id} responded ${res.status}`);
      return null;
    }
    return (await res.json()) as DisputeResponse;
  } catch (err) {
    console.warn(`[cloud-api] /v1/disputes/:id unreachable: ${fmtErr(err)}`);
    return null;
  }
}

/**
 * `POST /v1/disputes` — file a dispute. Bearer-authed; the caller must
 * own `filer_aid`. Provided here for completeness / typed-client parity
 * with the read paths; the dashboard's file-dispute form posts directly
 * browser → cloud-api so the bearer never round-trips through the
 * Next.js server (same security pattern as the publish form).
 */
export interface FileDisputeBody {
  conversation_id: string;
  filer_aid: string;
  respondent_aid: string;
  reason: "non_delivery" | "wrong_output" | "fraud" | "other";
  narrative?: string;
  claimed_remedy?: string;
}

export type FileDisputeResult =
  | { kind: "ok"; dispute: DisputeResponse }
  | { kind: "error"; status: number; error: string; message: string; field?: string };

export async function fileDispute(
  bearer: string,
  body: FileDisputeBody,
): Promise<FileDisputeResult> {
  const url = `${BASE_URL}/v1/disputes`;
  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 201) {
      return { kind: "ok", dispute: json as unknown as DisputeResponse };
    }
    return {
      kind: "error",
      status: res.status,
      error: typeof json.error === "string" ? json.error : `http_${res.status}`,
      message: typeof json.message === "string" ? json.message : `HTTP ${res.status}`,
      field: typeof json.field === "string" ? json.field : undefined,
    };
  } catch (err) {
    return {
      kind: "error",
      status: 0,
      error: "unreachable",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Liveness probe — does the cloud-api respond to `/healthz`? No auth
 * involved; used as a fast pre-check before doing anything more
 * expensive (e.g., validating a bearer).
 */
export async function pingCloudApi(): Promise<"ok" | "unreachable"> {
  try {
    const res = await fetch(`${BASE_URL}/healthz`, { cache: "no-store" });
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

/**
 * Validate a bearer token against the cloud-api. We don't have a
 * `/v1/whoami` endpoint, so we instead make an authenticated request
 * to `GET /v1/agents?owner=<deliberately-improbable>`:
 *
 *   - 401 → bearer is missing or unknown to the candidate
 *   - 403 → bearer is valid but the resolved owner doesn't match the
 *           query, which is exactly what we expect for an improbable
 *           owner-id (the §3 cross-owner rejection path in
 *           apps/cloud/api/src/routes/agents.ts)
 *   - 200 → bearer is valid AND its resolved owner happens to literally
 *           equal the improbable string (vanishingly rare; still accept)
 *   - other → cloud-api itself is misbehaving — treat as unreachable
 *
 * security-review-2026-05-07 §L3: this replaces the prior login-route
 * behavior of accepting ANY non-empty string + a /healthz ping.
 */
export type BearerValidation = "ok" | "invalid" | "unreachable";

export async function validateBearer(bearer: string): Promise<BearerValidation> {
  // Use a string that is grammatically a valid owner-id but is overwhelmingly
  // unlikely to be a real one (>64 chars + reserved-looking prefix).
  const sentinel = "__compliance_validate_invalid_owner_id__sentinel";
  try {
    const res = await fetch(`${BASE_URL}/v1/agents?owner=${encodeURIComponent(sentinel)}`, {
      method: "GET",
      cache: "no-store",
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (res.status === 401) return "invalid";
    if (res.status === 200 || res.status === 403) return "ok";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}
