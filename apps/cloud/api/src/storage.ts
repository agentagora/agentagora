/**
 * Storage abstraction for the Cloud API.
 *
 * The interface is intentionally minimal so the in-memory variant
 * (this file) can be swapped for a D1-backed variant in Phase 3
 * without touching route code.
 */

import type { Manifest } from "@agentagora/protocol";

export interface AgentRecord {
  manifest: Manifest;
  /** Mock JWT for v0; in Phase 3 this is a real OIDC-signed token. */
  identityJwt: string;
  /** ISO 8601 timestamp of first publish (or last update). */
  publishedAt: string;
  /** Owner identifier. Mock for v0; real OIDC subject in Phase 3. */
  publishedBy: string;
}

export interface SearchFilter {
  capability?: string;
  accepts?: string;
  q?: string;
}

export interface Storage {
  getAgent(aid: string): Promise<AgentRecord | undefined>;
  putAgent(record: AgentRecord): Promise<void>;
  searchAgents(filter: SearchFilter): Promise<AgentRecord[]>;
  listAgents(): Promise<AgentRecord[]>;
}

/** In-memory storage. Per-isolate on Workers, lost on cold start.
 *  Replace with D1Storage in Phase 3. */
export class InMemoryStorage implements Storage {
  private readonly agents = new Map<string, AgentRecord>();

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

  /** Test helper: drop all records. */
  clear(): void {
    this.agents.clear();
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
