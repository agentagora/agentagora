/**
 * Minimal D1Database adapter over node:sqlite.
 *
 * Implements just the subset of D1 used by D1Storage:
 *   - exec(sql)
 *   - prepare(sql).bind(...).first<T>()
 *   - prepare(sql).bind(...).all<T>()
 *   - prepare(sql).bind(...).run()
 *
 * Used only in tests; real production code calls into the genuine
 * D1Database binding from `@cloudflare/workers-types`.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Vite/Vitest's resolver rewrites `import ... from "node:sqlite"` to
// the bare specifier `sqlite` and then fails to resolve it. Loading
// via createRequire bypasses Vite entirely so Node's own loader picks
// up the built-in module.
const requireFromHere = createRequire(import.meta.url);
const { DatabaseSync } = requireFromHere("node:sqlite") as typeof import("node:sqlite");
type StatementSync = import("node:sqlite").StatementSync;
type DatabaseSyncT = import("node:sqlite").DatabaseSync;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

class MockPreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly stmt: StatementSync,
    private readonly raw: DatabaseSyncT,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): MockPreparedStatement {
    const next = new MockPreparedStatement(this.stmt, this.raw, this.sql);
    next.boundParams = params;
    return next;
  }

  async first<T>(): Promise<T | null> {
    const row = this.stmt.get(...(this.boundParams as never[]));
    return (row ?? null) as T | null;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    const rows = this.stmt.all(...(this.boundParams as never[])) as T[];
    return { results: rows, success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: Record<string, never> }> {
    this.stmt.run(...(this.boundParams as never[]));
    return { success: true, meta: {} };
  }
}

class MockD1Database {
  constructor(private readonly raw: DatabaseSyncT) {}

  prepare(sql: string): MockPreparedStatement {
    return new MockPreparedStatement(this.raw.prepare(sql), this.raw, sql);
  }

  async exec(sql: string): Promise<void> {
    this.raw.exec(sql);
  }
}

/**
 * Build a fresh in-memory D1-shaped database with every migration
 * applied in order. Returned as `D1Database` so it drops into
 * D1Storage typing with no casts at the call site.
 */
export function createMockD1(): D1Database {
  const raw = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    raw.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"));
  }
  return new MockD1Database(raw) as unknown as D1Database;
}
