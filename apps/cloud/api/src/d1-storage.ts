/**
 * D1-backed implementation of the Storage interface.
 *
 * Schema lives in ../migrations/0001_init.sql. Capability and accepts
 * filters use SQLite's json1 functions against the manifest column —
 * acceptable for v0 registry scale, promotable to a side table later.
 */

import type { Manifest } from "@agentagora/protocol";
import type { AgentRecord, SearchFilter, Storage } from "./storage.js";

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
