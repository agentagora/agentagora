/**
 * Storage abstraction for the Cloud API.
 *
 * The interface is intentionally minimal so the in-memory variant
 * (this file) can be swapped for a D1-backed variant in Phase 3
 * without touching route code.
 */

import type { AuditEvent, Manifest } from "@agentagora/protocol";

export interface AgentRecord {
  manifest: Manifest;
  /** Mock JWT for v0; in Phase 3 this is a real OIDC-signed token. */
  identityJwt: string;
  /** ISO 8601 timestamp of first publish (or last update). */
  publishedAt: string;
  /** Owner identifier resolved from the bearer token. */
  publishedBy: string;
  /**
   * Ed25519 public key (base64url, 32 raw bytes) bound to this AID
   * on first publish. Updates must produce a signature that verifies
   * against this key — TOFU pin defends against bearer-token leaks.
   */
  pubkey: string;
}

export interface SearchFilter {
  capability?: string;
  accepts?: string;
  q?: string;
}

export interface StripeAccountRecord {
  ownerId: string;
  stripeAccountId: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DisputeReason = "non_delivery" | "wrong_output" | "fraud" | "other";

export interface DisputeRecord {
  disputeId: string;
  conversationId: string;
  /** Owner ID resolved from the bearer at file-time. */
  filedBy: string;
  /** AID the filer is acting on behalf of (must be owned by filedBy). */
  filerAid: string;
  respondentAid: string;
  reason: DisputeReason;
  narrative?: string;
  claimedRemedy?: string;
  state: "open" | "closed" | "resolved" | "rejected";
  filedAt: string;
  resolvedAt?: string;
  resolution?: string;
}

/**
 * OAuth-issued dashboard session. Persisted by the
 * /v1/auth/github/callback handler; resolved on every authenticated
 * cloud-api request via OauthSessionAuth.
 *
 * The bearer is the table's primary key and is the value the dashboard
 * stores in its encrypted session cookie. The owner_id (`gh:<login>`)
 * is what every existing route already keys off — agents.published_by,
 * disputes.filedBy, etc. — so OAuth and OWNER_TOKENS bearers compose
 * uniformly behind the OwnerAuthenticator interface.
 */
export interface OauthSessionRecord {
  /** Opaque random bearer (32 bytes, base64url). Primary key. */
  bearer: string;
  /** Stable owner ID; "gh:<login>" today, "<provider>:<id>" later. */
  ownerId: string;
  /** Identity provider; "github" today. */
  provider: "github";
  /** Provider-side user ID (numeric for GitHub, stable across renames). */
  providerUid: string;
  /** Optional primary email when the OAuth scope returned one. */
  email?: string;
  /** ISO 8601 — when the bearer was minted. */
  issuedAt: string;
  /** ISO 8601 — issuedAt + 30d. Stale rows refuse to authenticate. */
  expiresAt: string;
}

/**
 * Auto-refund ledger entry. Written by the Stripe webhook handler on
 * `charge.refunded` events for AAP-tagged charges. Read by the dispute
 * intake route to short-circuit the human-loop case ("paid call failed
 * → refund happened → if a dispute is filed it's already resolved").
 */
export interface RefundRecord {
  /** Stripe refund id (`re_…`); primary key. */
  refundId: string;
  /** AAP conversation id from the underlying charge metadata. */
  conversationId: string;
  /** Decimal-string amount (matches the SDK's escrow shape). */
  amount: string;
  /** ISO 4217. */
  currency: string;
  /** ISO 8601 — Stripe's `created` timestamp converted. */
  refundedAt: string;
  /** Stripe-reported reason, free-form ("requested_by_customer", etc.). */
  reason?: string;
}

/**
 * Compact view of a conversation an actor participated in. Returned by
 * `listConversationsByActor` so the dashboard can render an inbox
 * without round-tripping every chain just to discover its existence.
 */
export interface ConversationSummary {
  conversationId: string;
  /** ISO 8601 — earliest event the actor signed in this conversation. */
  firstSeenAt: string;
  /** ISO 8601 — most recent event the actor signed in this conversation. */
  lastSeenAt: string;
  /** Total number of events the actor signed in this conversation. */
  eventCount: number;
  /** `type` field of the actor's most recent event. Useful for UI hints
   *  ("settlement.completed", "dispute.opened", etc.) without forcing a
   *  full chain fetch. */
  latestEventType: string;
}

export interface Storage {
  // Agents
  getAgent(aid: string): Promise<AgentRecord | undefined>;
  putAgent(record: AgentRecord): Promise<void>;
  searchAgents(filter: SearchFilter): Promise<AgentRecord[]>;
  listAgents(): Promise<AgentRecord[]>;
  /** Owner-scoped index. Used by the dashboard's "my agents" view. */
  listAgentsByOwner(ownerId: string): Promise<AgentRecord[]>;

  // Audit events
  /** Idempotent insert. No-op if event_id already exists. */
  ingestAuditEvent(event: AuditEvent, ingestedAt: string): Promise<void>;
  /** True if an event with this ID has already been ingested. */
  hasAuditEvent(eventId: string): Promise<boolean>;
  /**
   * Latest event in the conversation BY THIS ACTOR, or undefined if the
   * actor has no events yet. Audit chains are per-party: initiator and
   * responder each keep their own hash chain for the same conversation
   * (both starting at previous_event_hash = null), so ingest linkage is
   * checked against the actor's own chain — never across actors.
   */
  getLatestAuditEvent(conversationId: string, actorAid: string): Promise<AuditEvent | undefined>;
  /** Full chain for a conversation, ordered by timestamp ascending. */
  getConversationEvents(conversationId: string): Promise<AuditEvent[]>;
  /**
   * Distinct conversations the actor has signed an event in, with
   * roll-up metadata. Ordered by lastSeenAt DESC so the dashboard's
   * inbox shows the freshest activity first.
   */
  listConversationsByActor(actorAid: string): Promise<ConversationSummary[]>;

  // Disputes
  /** Insert a fresh dispute. Caller pre-allocates the dispute_id. */
  createDispute(record: DisputeRecord): Promise<void>;
  /** Look up a dispute by its opaque ID. */
  getDispute(disputeId: string): Promise<DisputeRecord | undefined>;
  /**
   * Find every open dispute filed against the given conversation. Used
   * by the refund webhook to retroactively resolve disputes that were
   * filed before the refund landed.
   */
  getOpenDisputesByConversation(conversationId: string): Promise<DisputeRecord[]>;
  /** All disputes the AID filed (newest first). */
  listDisputesByFiler(filerAid: string): Promise<DisputeRecord[]>;
  /** All disputes filed against the AID (newest first). */
  listDisputesByRespondent(respondentAid: string): Promise<DisputeRecord[]>;
  /**
   * Mark a dispute as resolved. No-op if the dispute is already
   * resolved/closed/rejected — keeps webhook redelivery idempotent.
   */
  resolveDispute(disputeId: string, resolution: string, resolvedAt: string): Promise<void>;

  // Auto-refund ledger
  /** Idempotent insert by refund_id. Re-delivered webhooks are no-ops. */
  recordRefund(record: RefundRecord): Promise<void>;
  /** All refunds we know about for a conversation, newest first. */
  getRefundsByConversation(conversationId: string): Promise<RefundRecord[]>;

  // Stripe Connect accounts
  /** Insert or update the owner's Stripe Connect account record. */
  upsertStripeAccount(record: StripeAccountRecord): Promise<void>;
  /** Fetch by cloud owner ID. */
  getStripeAccountByOwner(ownerId: string): Promise<StripeAccountRecord | undefined>;
  /** Fetch by Stripe account ID (used by webhooks). */
  getStripeAccountByStripeId(stripeAccountId: string): Promise<StripeAccountRecord | undefined>;

  // OAuth-issued dashboard sessions
  /** Persist a freshly minted bearer → owner mapping. Idempotent on
   *  bearer primary-key collision (which is statistically impossible
   *  for 32 random bytes — collision means caller bug, log + ignore). */
  createOauthSession(record: OauthSessionRecord): Promise<void>;
  /** Look up a session by bearer. Returns undefined when missing.
   *  Implementations MAY filter rows past expires_at — the D1 path
   *  does (defense-in-depth + so stale rows can't leak side-channel
   *  metadata via a hit/miss timing distinguisher). The InMemoryStorage
   *  used by tests does not filter; the OauthSessionAuth.resolve()
   *  layer always re-checks the session row's expires_at against an
   *  injectable clock so tests can simulate time-passage without
   *  poking Date.now globally. */
  getOauthSession(bearer: string): Promise<OauthSessionRecord | undefined>;
  /** Sweeper: delete every row whose expires_at is ≤ now. Called
   *  out-of-band by an admin / cron task; safe to run any time. */
  deleteExpiredOauthSessions(now: string): Promise<number>;
}

/** In-memory storage. Per-isolate on Workers, lost on cold start.
 *  Used by tests and `wrangler dev` without D1 bindings. */
export class InMemoryStorage implements Storage {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly auditEvents = new Map<string, AuditEvent>();
  private readonly auditByConversation = new Map<string, AuditEvent[]>();
  private readonly disputes = new Map<string, DisputeRecord>();
  private readonly stripeAccounts = new Map<string, StripeAccountRecord>();
  private readonly stripeAccountsByStripeId = new Map<string, StripeAccountRecord>();
  private readonly refunds = new Map<string, RefundRecord>();
  private readonly oauthSessions = new Map<string, OauthSessionRecord>();

  async getAgent(aid: string): Promise<AgentRecord | undefined> {
    return this.agents.get(aid);
  }

  async putAgent(record: AgentRecord): Promise<void> {
    this.agents.set(record.manifest.aid, record);
  }

  async searchAgents(filter: SearchFilter): Promise<AgentRecord[]> {
    const all = [...this.agents.values()];
    return all.filter((rec) => matches(rec, filter));
  }

  async listAgents(): Promise<AgentRecord[]> {
    return [...this.agents.values()];
  }

  async listAgentsByOwner(ownerId: string): Promise<AgentRecord[]> {
    const out: AgentRecord[] = [];
    for (const rec of this.agents.values()) {
      if (rec.publishedBy === ownerId) out.push(rec);
    }
    // Mirror D1's `ORDER BY published_at DESC` so the InMemory + D1
    // paths produce the same ordering for tests asserting on shape.
    out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return out;
  }

  async ingestAuditEvent(event: AuditEvent, _ingestedAt: string): Promise<void> {
    if (this.auditEvents.has(event.event_id)) return;
    this.auditEvents.set(event.event_id, event);
    const list = this.auditByConversation.get(event.conversation_id) ?? [];
    list.push(event);
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    this.auditByConversation.set(event.conversation_id, list);
  }

  async hasAuditEvent(eventId: string): Promise<boolean> {
    return this.auditEvents.has(eventId);
  }

  async getLatestAuditEvent(
    conversationId: string,
    actorAid: string,
  ): Promise<AuditEvent | undefined> {
    const list = (this.auditByConversation.get(conversationId) ?? []).filter(
      (e) => e.actor_aid === actorAid,
    );
    return list.length > 0 ? list[list.length - 1] : undefined;
  }

  async getConversationEvents(conversationId: string): Promise<AuditEvent[]> {
    return [...(this.auditByConversation.get(conversationId) ?? [])];
  }

  async listConversationsByActor(actorAid: string): Promise<ConversationSummary[]> {
    // Closed-alpha approximation — mirrors the D1 query: pull every
    // event the actor signed, group by conversation_id, roll up
    // first/last/count + the latest event's type.
    const groups = new Map<
      string,
      {
        firstSeenAt: string;
        lastSeenAt: string;
        eventCount: number;
        latestType: string;
      }
    >();
    for (const event of this.auditEvents.values()) {
      if (event.actor_aid !== actorAid) continue;
      const existing = groups.get(event.conversation_id);
      if (!existing) {
        groups.set(event.conversation_id, {
          firstSeenAt: event.timestamp,
          lastSeenAt: event.timestamp,
          eventCount: 1,
          latestType: event.type,
        });
        continue;
      }
      existing.eventCount++;
      if (event.timestamp < existing.firstSeenAt) existing.firstSeenAt = event.timestamp;
      if (event.timestamp >= existing.lastSeenAt) {
        existing.lastSeenAt = event.timestamp;
        existing.latestType = event.type;
      }
    }
    const out: ConversationSummary[] = [];
    for (const [conversationId, g] of groups) {
      out.push({
        conversationId,
        firstSeenAt: g.firstSeenAt,
        lastSeenAt: g.lastSeenAt,
        eventCount: g.eventCount,
        latestEventType: g.latestType,
      });
    }
    out.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return out;
  }

  async createDispute(record: DisputeRecord): Promise<void> {
    if (this.disputes.has(record.disputeId)) {
      throw new Error(`dispute ${record.disputeId} already exists`);
    }
    this.disputes.set(record.disputeId, { ...record });
  }

  async getDispute(disputeId: string): Promise<DisputeRecord | undefined> {
    const rec = this.disputes.get(disputeId);
    return rec ? { ...rec } : undefined;
  }

  async getOpenDisputesByConversation(conversationId: string): Promise<DisputeRecord[]> {
    const out: DisputeRecord[] = [];
    for (const rec of this.disputes.values()) {
      if (rec.conversationId === conversationId && rec.state === "open") {
        out.push({ ...rec });
      }
    }
    return out;
  }

  async listDisputesByFiler(filerAid: string): Promise<DisputeRecord[]> {
    const out: DisputeRecord[] = [];
    for (const rec of this.disputes.values()) {
      if (rec.filerAid === filerAid) out.push({ ...rec });
    }
    out.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
    return out;
  }

  async listDisputesByRespondent(respondentAid: string): Promise<DisputeRecord[]> {
    const out: DisputeRecord[] = [];
    for (const rec of this.disputes.values()) {
      if (rec.respondentAid === respondentAid) out.push({ ...rec });
    }
    out.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
    return out;
  }

  async resolveDispute(disputeId: string, resolution: string, resolvedAt: string): Promise<void> {
    const rec = this.disputes.get(disputeId);
    if (!rec) return;
    if (rec.state !== "open") return;
    this.disputes.set(disputeId, {
      ...rec,
      state: "resolved",
      resolution,
      resolvedAt,
    });
  }

  async recordRefund(record: RefundRecord): Promise<void> {
    if (this.refunds.has(record.refundId)) return;
    this.refunds.set(record.refundId, { ...record });
  }

  async getRefundsByConversation(conversationId: string): Promise<RefundRecord[]> {
    const out: RefundRecord[] = [];
    for (const rec of this.refunds.values()) {
      if (rec.conversationId === conversationId) out.push({ ...rec });
    }
    out.sort((a, b) => b.refundedAt.localeCompare(a.refundedAt));
    return out;
  }

  async upsertStripeAccount(record: StripeAccountRecord): Promise<void> {
    const copy = { ...record };
    this.stripeAccounts.set(record.ownerId, copy);
    this.stripeAccountsByStripeId.set(record.stripeAccountId, copy);
  }

  async getStripeAccountByOwner(ownerId: string): Promise<StripeAccountRecord | undefined> {
    const rec = this.stripeAccounts.get(ownerId);
    return rec ? { ...rec } : undefined;
  }

  async getStripeAccountByStripeId(
    stripeAccountId: string,
  ): Promise<StripeAccountRecord | undefined> {
    const rec = this.stripeAccountsByStripeId.get(stripeAccountId);
    return rec ? { ...rec } : undefined;
  }

  async createOauthSession(record: OauthSessionRecord): Promise<void> {
    if (this.oauthSessions.has(record.bearer)) return;
    this.oauthSessions.set(record.bearer, { ...record });
  }

  async getOauthSession(bearer: string): Promise<OauthSessionRecord | undefined> {
    const rec = this.oauthSessions.get(bearer);
    return rec ? { ...rec } : undefined;
  }

  async deleteExpiredOauthSessions(now: string): Promise<number> {
    const cutoff = new Date(now).getTime();
    let removed = 0;
    for (const [bearer, rec] of this.oauthSessions) {
      if (new Date(rec.expiresAt).getTime() <= cutoff) {
        this.oauthSessions.delete(bearer);
        removed++;
      }
    }
    return removed;
  }

  /** Test helper: drop all records. */
  clear(): void {
    this.agents.clear();
    this.auditEvents.clear();
    this.auditByConversation.clear();
    this.disputes.clear();
    this.stripeAccounts.clear();
    this.stripeAccountsByStripeId.clear();
    this.refunds.clear();
    this.oauthSessions.clear();
  }
}

function matches(rec: AgentRecord, filter: SearchFilter): boolean {
  if (filter.capability) {
    const has = rec.manifest.capabilities.some((c) => c.name === filter.capability);
    if (!has) return false;
  }
  if (filter.accepts) {
    const has = rec.manifest.capabilities.some((c) => c.accepts.includes(filter.accepts as string));
    if (!has) return false;
  }
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    const haystack = `${rec.manifest.aid} ${rec.manifest.description ?? ""}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}
