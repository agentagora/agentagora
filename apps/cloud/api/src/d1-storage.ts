/**
 * D1-backed implementation of the Storage interface.
 *
 * Schema lives in ../migrations/0001_init.sql. Capability and accepts
 * filters use SQLite's json1 functions against the manifest column —
 * acceptable for v0 registry scale, promotable to a side table later.
 */

import type { AuditEvent, Manifest } from "@agentagora/protocol";
import type {
  AgentRecord,
  ConversationSummary,
  DisputeReason,
  DisputeRecord,
  OauthSessionRecord,
  RefundRecord,
  SearchFilter,
  Storage,
  StripeAccountRecord,
} from "./storage.js";

interface AgentRow {
  manifest: string;
  identity_jwt: string;
  published_at: string;
  published_by: string;
  pubkey: string;
}

const SELECT_COLS = "manifest, identity_jwt, published_at, published_by, pubkey";

export class D1Storage implements Storage {
  constructor(private readonly db: D1Database) {}

  async getAgent(aid: string): Promise<AgentRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT ${SELECT_COLS} FROM agents WHERE aid = ?`)
      .bind(aid)
      .first<AgentRow>();
    return row ? rowToRecord(row) : undefined;
  }

  async putAgent(record: AgentRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agents (aid, manifest, identity_jwt, published_at, published_by, pubkey)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(aid) DO UPDATE SET
           manifest     = excluded.manifest,
           identity_jwt = excluded.identity_jwt,
           published_at = excluded.published_at,
           published_by = excluded.published_by,
           pubkey       = excluded.pubkey`,
      )
      .bind(
        record.manifest.aid,
        JSON.stringify(record.manifest),
        record.identityJwt,
        record.publishedAt,
        record.publishedBy,
        record.pubkey,
      )
      .run();
  }

  async listAgents(): Promise<AgentRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT ${SELECT_COLS} FROM agents ORDER BY published_at DESC`)
      .all<AgentRow>();
    return results.map(rowToRecord);
  }

  async listAgentsByOwner(ownerId: string): Promise<AgentRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${SELECT_COLS} FROM agents
         WHERE published_by = ?
         ORDER BY published_at DESC`,
      )
      .bind(ownerId)
      .all<AgentRow>();
    return results.map(rowToRecord);
  }

  async searchAgents(filter: SearchFilter): Promise<AgentRecord[]> {
    const wheres: string[] = [];
    const binds: unknown[] = [];

    if (filter.capability) {
      wheres.push(
        `EXISTS (
          SELECT 1 FROM json_each(manifest, '$.capabilities') c
          WHERE json_extract(c.value, '$.name') = ?
        )`,
      );
      binds.push(filter.capability);
    }

    if (filter.accepts) {
      wheres.push(
        `EXISTS (
          SELECT 1 FROM json_each(manifest, '$.capabilities') c,
                       json_each(c.value, '$.accepts') a
          WHERE a.value = ?
        )`,
      );
      binds.push(filter.accepts);
    }

    if (filter.q) {
      wheres.push(
        `(LOWER(aid) LIKE ? OR LOWER(COALESCE(json_extract(manifest, '$.description'), '')) LIKE ?)`,
      );
      const like = `%${filter.q.toLowerCase()}%`;
      binds.push(like, like);
    }

    const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
    const stmt = this.db.prepare(
      `SELECT ${SELECT_COLS} FROM agents ${where} ORDER BY published_at DESC`,
    );
    const bound = binds.length ? stmt.bind(...binds) : stmt;
    const { results } = await bound.all<AgentRow>();
    return results.map(rowToRecord);
  }

  async ingestAuditEvent(event: AuditEvent, ingestedAt: string): Promise<void> {
    // Idempotent insert — duplicate event_id is silently dropped so
    // retry-on-network-blip doesn't poison the chain.
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO audit_events
           (event_id, conversation_id, actor_aid, timestamp,
            previous_event_hash, event_json, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.event_id,
        event.conversation_id,
        event.actor_aid,
        event.timestamp,
        event.previous_event_hash,
        JSON.stringify(event),
        ingestedAt,
      )
      .run();
  }

  async hasAuditEvent(eventId: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT 1 AS hit FROM audit_events WHERE event_id = ?")
      .bind(eventId)
      .first<{ hit: number }>();
    return row !== null;
  }

  async getLatestAuditEvent(conversationId: string): Promise<AuditEvent | undefined> {
    const row = await this.db
      .prepare(
        `SELECT event_json FROM audit_events
         WHERE conversation_id = ?
         ORDER BY timestamp DESC LIMIT 1`,
      )
      .bind(conversationId)
      .first<{ event_json: string }>();
    return row ? (JSON.parse(row.event_json) as AuditEvent) : undefined;
  }

  async getConversationEvents(conversationId: string): Promise<AuditEvent[]> {
    const { results } = await this.db
      .prepare(
        `SELECT event_json FROM audit_events
         WHERE conversation_id = ?
         ORDER BY timestamp ASC`,
      )
      .bind(conversationId)
      .all<{ event_json: string }>();
    return results.map((r) => JSON.parse(r.event_json) as AuditEvent);
  }

  async listConversationsByActor(actorAid: string): Promise<ConversationSummary[]> {
    // Closed-alpha approximation: pull every event the actor signed,
    // group + roll up in app code. Cheaper than the equivalent SQL
    // (correlated subqueries don't index well in SQLite/D1) and at v0
    // scale (≤ a few thousand events / actor) the wire cost is fine.
    // Promote to a server-side aggregate or materialized view if this
    // ever shows up in profiling.
    const { results } = await this.db
      .prepare(
        `SELECT conversation_id,
                json_extract(event_json, '$.type') AS type,
                timestamp
         FROM audit_events
         WHERE actor_aid = ?
         ORDER BY timestamp ASC`,
      )
      .bind(actorAid)
      .all<{ conversation_id: string; type: string; timestamp: string }>();

    const groups = new Map<
      string,
      { firstSeenAt: string; lastSeenAt: string; eventCount: number; latestType: string }
    >();
    for (const row of results) {
      const existing = groups.get(row.conversation_id);
      if (!existing) {
        groups.set(row.conversation_id, {
          firstSeenAt: row.timestamp,
          lastSeenAt: row.timestamp,
          eventCount: 1,
          latestType: row.type,
        });
        continue;
      }
      existing.eventCount++;
      // Rows arrive ASC by timestamp, so the last write wins for
      // last-seen / latest-type.
      existing.lastSeenAt = row.timestamp;
      existing.latestType = row.type;
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
    await this.db
      .prepare(
        `INSERT INTO disputes
           (dispute_id, conversation_id, filed_by, filer_aid, respondent_aid,
            reason, narrative, claimed_remedy, state, filed_at,
            resolved_at, resolution)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.disputeId,
        record.conversationId,
        record.filedBy,
        record.filerAid,
        record.respondentAid,
        record.reason,
        record.narrative ?? null,
        record.claimedRemedy ?? null,
        record.state,
        record.filedAt,
        record.resolvedAt ?? null,
        record.resolution ?? null,
      )
      .run();
  }

  async getDispute(disputeId: string): Promise<DisputeRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT dispute_id, conversation_id, filed_by, filer_aid, respondent_aid,
                reason, narrative, claimed_remedy, state, filed_at,
                resolved_at, resolution
         FROM disputes WHERE dispute_id = ?`,
      )
      .bind(disputeId)
      .first<DisputeRow>();
    return row ? rowToDispute(row) : undefined;
  }

  async getOpenDisputesByConversation(conversationId: string): Promise<DisputeRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT dispute_id, conversation_id, filed_by, filer_aid, respondent_aid,
                reason, narrative, claimed_remedy, state, filed_at,
                resolved_at, resolution
         FROM disputes
         WHERE conversation_id = ? AND state = 'open'
         ORDER BY filed_at ASC`,
      )
      .bind(conversationId)
      .all<DisputeRow>();
    return results.map(rowToDispute);
  }

  async listDisputesByFiler(filerAid: string): Promise<DisputeRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT dispute_id, conversation_id, filed_by, filer_aid, respondent_aid,
                reason, narrative, claimed_remedy, state, filed_at,
                resolved_at, resolution
         FROM disputes
         WHERE filer_aid = ?
         ORDER BY filed_at DESC`,
      )
      .bind(filerAid)
      .all<DisputeRow>();
    return results.map(rowToDispute);
  }

  async listDisputesByRespondent(respondentAid: string): Promise<DisputeRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT dispute_id, conversation_id, filed_by, filer_aid, respondent_aid,
                reason, narrative, claimed_remedy, state, filed_at,
                resolved_at, resolution
         FROM disputes
         WHERE respondent_aid = ?
         ORDER BY filed_at DESC`,
      )
      .bind(respondentAid)
      .all<DisputeRow>();
    return results.map(rowToDispute);
  }

  async resolveDispute(disputeId: string, resolution: string, resolvedAt: string): Promise<void> {
    // Bound by `state = 'open'` so re-deliveries / late refunds don't
    // overwrite a closed/rejected case file.
    await this.db
      .prepare(
        `UPDATE disputes
         SET state = 'resolved', resolution = ?, resolved_at = ?
         WHERE dispute_id = ? AND state = 'open'`,
      )
      .bind(resolution, resolvedAt, disputeId)
      .run();
  }

  async recordRefund(record: RefundRecord): Promise<void> {
    // INSERT OR IGNORE makes Stripe webhook redelivery a no-op.
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO refunds
           (refund_id, conversation_id, amount, currency, refunded_at, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.refundId,
        record.conversationId,
        record.amount,
        record.currency,
        record.refundedAt,
        record.reason ?? null,
      )
      .run();
  }

  async getRefundsByConversation(conversationId: string): Promise<RefundRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT refund_id, conversation_id, amount, currency, refunded_at, reason
         FROM refunds WHERE conversation_id = ?
         ORDER BY refunded_at DESC`,
      )
      .bind(conversationId)
      .all<RefundRow>();
    return results.map(rowToRefund);
  }

  async upsertStripeAccount(record: StripeAccountRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO stripe_accounts
           (owner_id, stripe_account_id, details_submitted, charges_enabled,
            payouts_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           stripe_account_id = excluded.stripe_account_id,
           details_submitted = excluded.details_submitted,
           charges_enabled   = excluded.charges_enabled,
           payouts_enabled   = excluded.payouts_enabled,
           updated_at        = excluded.updated_at`,
      )
      .bind(
        record.ownerId,
        record.stripeAccountId,
        record.detailsSubmitted ? 1 : 0,
        record.chargesEnabled ? 1 : 0,
        record.payoutsEnabled ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      )
      .run();
  }

  async getStripeAccountByOwner(ownerId: string): Promise<StripeAccountRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT ${STRIPE_COLS} FROM stripe_accounts WHERE owner_id = ?`)
      .bind(ownerId)
      .first<StripeAccountRow>();
    return row ? rowToStripeAccount(row) : undefined;
  }

  async getStripeAccountByStripeId(
    stripeAccountId: string,
  ): Promise<StripeAccountRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT ${STRIPE_COLS} FROM stripe_accounts WHERE stripe_account_id = ?`)
      .bind(stripeAccountId)
      .first<StripeAccountRow>();
    return row ? rowToStripeAccount(row) : undefined;
  }

  async createOauthSession(record: OauthSessionRecord): Promise<void> {
    // INSERT OR IGNORE makes a (statistically impossible) bearer
    // collision a no-op rather than a 500 to the dashboard.
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO oauth_sessions
           (bearer, owner_id, provider, provider_uid, email, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.bearer,
        record.ownerId,
        record.provider,
        record.providerUid,
        record.email ?? null,
        record.issuedAt,
        record.expiresAt,
      )
      .run();
  }

  async getOauthSession(bearer: string): Promise<OauthSessionRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT bearer, owner_id, provider, provider_uid, email, issued_at, expires_at
         FROM oauth_sessions
         WHERE bearer = ? AND expires_at > ?`,
      )
      .bind(bearer, new Date().toISOString())
      .first<OauthSessionRow>();
    return row ? rowToOauthSession(row) : undefined;
  }

  async deleteExpiredOauthSessions(now: string): Promise<number> {
    const result = await this.db
      .prepare("DELETE FROM oauth_sessions WHERE expires_at <= ?")
      .bind(now)
      .run();
    // D1's RunResult.meta.changes is the row-count when available;
    // tests under the node:sqlite shim return undefined — just report
    // 0 in that case rather than throwing.
    const meta = (result as { meta?: { changes?: number } }).meta;
    return typeof meta?.changes === "number" ? meta.changes : 0;
  }
}

const STRIPE_COLS =
  "owner_id, stripe_account_id, details_submitted, charges_enabled, payouts_enabled, created_at, updated_at";

interface StripeAccountRow {
  owner_id: string;
  stripe_account_id: string;
  details_submitted: number;
  charges_enabled: number;
  payouts_enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToStripeAccount(row: StripeAccountRow): StripeAccountRecord {
  return {
    ownerId: row.owner_id,
    stripeAccountId: row.stripe_account_id,
    detailsSubmitted: row.details_submitted === 1,
    chargesEnabled: row.charges_enabled === 1,
    payoutsEnabled: row.payouts_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface DisputeRow {
  dispute_id: string;
  conversation_id: string;
  filed_by: string;
  filer_aid: string;
  respondent_aid: string;
  reason: string;
  narrative: string | null;
  claimed_remedy: string | null;
  state: string;
  filed_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

function rowToDispute(row: DisputeRow): DisputeRecord {
  const out: DisputeRecord = {
    disputeId: row.dispute_id,
    conversationId: row.conversation_id,
    filedBy: row.filed_by,
    filerAid: row.filer_aid,
    respondentAid: row.respondent_aid,
    reason: row.reason as DisputeReason,
    state: row.state as DisputeRecord["state"],
    filedAt: row.filed_at,
  };
  if (row.narrative !== null) out.narrative = row.narrative;
  if (row.claimed_remedy !== null) out.claimedRemedy = row.claimed_remedy;
  if (row.resolved_at !== null) out.resolvedAt = row.resolved_at;
  if (row.resolution !== null) out.resolution = row.resolution;
  return out;
}

interface RefundRow {
  refund_id: string;
  conversation_id: string;
  amount: string;
  currency: string;
  refunded_at: string;
  reason: string | null;
}

function rowToRefund(row: RefundRow): RefundRecord {
  const out: RefundRecord = {
    refundId: row.refund_id,
    conversationId: row.conversation_id,
    amount: row.amount,
    currency: row.currency,
    refundedAt: row.refunded_at,
  };
  if (row.reason !== null) out.reason = row.reason;
  return out;
}

function rowToRecord(row: AgentRow): AgentRecord {
  return {
    manifest: JSON.parse(row.manifest) as Manifest,
    identityJwt: row.identity_jwt,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    pubkey: row.pubkey,
  };
}

interface OauthSessionRow {
  bearer: string;
  owner_id: string;
  provider: string;
  provider_uid: string;
  email: string | null;
  issued_at: string;
  expires_at: string;
}

function rowToOauthSession(row: OauthSessionRow): OauthSessionRecord {
  const out: OauthSessionRecord = {
    bearer: row.bearer,
    ownerId: row.owner_id,
    provider: row.provider as OauthSessionRecord["provider"],
    providerUid: row.provider_uid,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
  if (row.email !== null) out.email = row.email;
  return out;
}
