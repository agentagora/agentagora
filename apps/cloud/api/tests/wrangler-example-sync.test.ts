/**
 * Sync guard — `wrangler.jsonc.example` resource bindings must match
 * the `Env` interface in `src/index.ts`.
 *
 * Why this exists. The real `wrangler.jsonc` is gitignored
 * (security-review-2026-05 §M1: it carries production D1 / KV resource
 * IDs). CI stages the committed `.example` file and runs the bundle-size
 * dry-run against it. That works as long as the example declares the
 * same set of resource bindings (`d1_databases[].binding`,
 * `kv_namespaces[].binding`, `r2_buckets[].binding`) that the source
 * code actually expects on `env.X`.
 *
 * The failure mode without this guard:
 *   1. Source code adds `env.NEW_KV: KVNamespace`
 *   2. Author updates the *real* `wrangler.jsonc` locally and ships
 *   3. The `.example` is forgotten
 *   4. CI dry-run still passes (binding declared in real config)
 *   5. Next operator clones, runs `cp wrangler.jsonc.example wrangler.jsonc`,
 *      and hits a mysterious runtime "env.NEW_KV is undefined" error
 *
 * This test catches drift in the same PR that introduces it.
 *
 * Secrets (string-typed Env fields like STRIPE_SECRET_KEY) are NOT
 * checked — those are set via `wrangler secret put`, not via
 * wrangler.jsonc. We only check resource bindings whose Env type
 * is one of D1Database / KVNamespace / R2Bucket.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `tests/` lives at apps/cloud/api/tests/, so the package root is one
// level up. Build paths from there to avoid coupling to a fragile
// `../../../..` walk.
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXAMPLE_PATH = resolve(PKG_ROOT, "wrangler.jsonc.example");
const INDEX_PATH = resolve(PKG_ROOT, "src/index.ts");

// JSONC = JSON with line + block comments. Strip them for JSON.parse.
function parseJsonc(source: string): unknown {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

interface WranglerJsonc {
  d1_databases?: { binding: string }[];
  kv_namespaces?: { binding: string }[];
  r2_buckets?: { binding: string }[];
}

function extractDeclaredBindings(jsonc: WranglerJsonc): string[] {
  const names: string[] = [];
  for (const arr of [jsonc.d1_databases, jsonc.kv_namespaces, jsonc.r2_buckets]) {
    if (arr) for (const b of arr) names.push(b.binding);
  }
  return names.sort();
}

// Walk `Env` interface in src/index.ts and pull every field whose
// type is a Workers resource (D1Database / KVNamespace / R2Bucket).
// Secret-typed fields (string) are intentionally ignored.
function extractResourceBindingNames(indexSource: string): string[] {
  const envBlockMatch = indexSource.match(/export interface Env\s*\{([\s\S]*?)\n\}/);
  if (!envBlockMatch || envBlockMatch[1] === undefined) {
    throw new Error("Could not locate `export interface Env {` in src/index.ts");
  }
  const body = envBlockMatch[1];

  const RESOURCE_TYPES = ["D1Database", "KVNamespace", "R2Bucket"];
  const names: string[] = [];

  // Match `NAME?: TYPE;` or `NAME: TYPE;` — TS interface field syntax.
  const fieldRe = /\b([A-Z][A-Z0-9_]*)\??\s*:\s*([A-Za-z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex-exec walking idiom
  while ((m = fieldRe.exec(body)) !== null) {
    const [, name, type] = m;
    if (name !== undefined && type !== undefined && RESOURCE_TYPES.includes(type)) {
      names.push(name);
    }
  }

  return names.sort();
}

describe("wrangler.jsonc.example ↔ src/index.ts Env sync", () => {
  it("declares the same resource bindings as the Env interface uses", () => {
    const exampleSource = readFileSync(EXAMPLE_PATH, "utf-8");
    const indexSource = readFileSync(INDEX_PATH, "utf-8");

    const declared = extractDeclaredBindings(parseJsonc(exampleSource) as WranglerJsonc);
    const used = extractResourceBindingNames(indexSource);

    expect(
      declared,
      `wrangler.jsonc.example declares [${declared.join(", ")}], but Env interface uses resource bindings [${used.join(", ")}]. Sync them: edit either the example or src/index.ts so the two sets match.`,
    ).toEqual(used);
  });

  it("example file declares no production resource IDs (all REPLACE_BEFORE_DEPLOY)", () => {
    const exampleSource = readFileSync(EXAMPLE_PATH, "utf-8");
    const config = parseJsonc(exampleSource) as {
      d1_databases?: { database_id?: string }[];
      kv_namespaces?: { id?: string }[];
    };

    const violations: string[] = [];
    for (const db of config.d1_databases ?? []) {
      if (db.database_id !== undefined && db.database_id !== "REPLACE_BEFORE_DEPLOY") {
        violations.push(`d1_databases.database_id = "${db.database_id}"`);
      }
    }
    for (const kv of config.kv_namespaces ?? []) {
      if (kv.id !== undefined && kv.id !== "REPLACE_BEFORE_DEPLOY") {
        violations.push(`kv_namespaces.id = "${kv.id}"`);
      }
    }

    expect(
      violations,
      `wrangler.jsonc.example must use REPLACE_BEFORE_DEPLOY placeholders, not real resource IDs. Found: ${violations.join("; ")}`,
    ).toEqual([]);
  });
});
