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

export interface Storage {
  // Agents
  getAgent(aid: string): Promise<AgentRecord | undefined>;
  putAgent(record: AgentRecord): Promise<void>;
  searchAgents(filter: SearchFilter): Promise<AgentRecord[]>;
  listAgents(): Promise<AgentRecord[]>;

  // Audit events
  /** Idempotent insert. No-op if event_id already exists. */
  ingestAuditEvent(event: AuditEvent, ingestedAt: string): Promise<void>;
  /** True if an event with this ID has already been ingested. */
  hasAuditEvent(eventId: string): Promise<boolean>;
  /** Latest event in the conversation by timestamp, or undefined if empty. */
  getLatestAuditEvent(conversationId: string): Promise<AuditEvent | undefined>;
  /** Full chain for a conversation, ordered by timestamp ascending. */
  getConversationEvents(conversationId: string): Promise<AuditEvent[]>;

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

  async getLatestAuditEvent(conversationId: string): Promise<AuditEvent | undefined> {
    const list = this.auditByConversation.get(conversationId);
    return list && list.length > 0 ? list[list.length - 1] : undefined;
  }

  async getConversationEvents(conversationId: string): Promise<AuditEvent[]> {
    return [...(this.auditByConversation.get(conversationId) ?? [])];
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

  /** Test helper: drop all records. */
  clear(): void {
    this.agents.clear();
    this.auditEvents.clear();
    this.auditByConversation.clear();
    this.disputes.clear();
    this.stripeAccounts.clear();
    this.stripeAccountsByStripeId.clear();
    this.refunds.clear();
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
