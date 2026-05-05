/**
 * Boundary guard — `@agentagora/protocol` is the reference TypeScript
 * impl of AAP and is committed to depending on **no AgentAgora Cloud
 * code** so the package can be lifted into its own repository at any
 * time without modification (see docs/protocol-stewardship.md §"Why
 * monorepo today").
 *
 * This test walks every TypeScript source file under `src/` and fails
 * if it imports from a forbidden surface:
 *
 *   - sibling apps (`apps/**`, `../apps/...`)
 *   - the Cloud Platform packages (`@agentagora/cloud-*`)
 *   - the SDK (`@agentagora/sdk` — protocol must not depend on its
 *     own consumers; the dependency only flows the other way)
 *   - Cloudflare Workers runtime APIs (`cloudflare:*`, `wrangler`)
 *   - any Cloud-specific runtime dep (`hono`, `stripe`)
 *
 * If you need to add a legitimate new dep, add it to
 * `packages/protocol/package.json` and update `ALLOWED_PEERS` below
 * in the same PR — that's the explicit "this is part of the protocol
 * surface" hand-shake.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));

// Patterns that must NEVER appear in a protocol-package import path.
const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /^apps\//, reason: "depends on a sibling app (apps/**)" },
  { pattern: /\.\.\/.*\/apps\//, reason: "relative import into apps/**" },
  { pattern: /^@agentagora\/cloud(-|$)/, reason: "depends on Cloud Platform packages" },
  {
    pattern: /^@agentagora\/sdk(\/|$)/,
    reason: "depends on the SDK (dep only flows the other way)",
  },
  { pattern: /^cloudflare:/, reason: "depends on Cloudflare Workers runtime APIs" },
  { pattern: /^wrangler(\/|$)/, reason: "depends on the Wrangler toolchain" },
  { pattern: /^hono(\/|$)/, reason: "depends on Hono (Cloud HTTP framework)" },
  { pattern: /^stripe(\/|$)/, reason: "depends on Stripe SDK (Cloud-only payment rail)" },
];

// Walk a directory recursively and collect *.ts (excluding *.test.ts and dist/).
function collectTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...collectTsFiles(abs));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(abs);
    }
  }
  return out;
}

// Extract every module specifier from `import ... from "..."` and
// `import("...")`. Strings are matched cheaply; we only care about
// the module specifier, not the imported binding.
function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const importFrom = /\bimport\s+[^"';]*?from\s+["']([^"']+)["']/g;
  const importBare = /\bimport\s+["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [importFrom, importBare, dynamicImport]) {
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec walking idiom
    while ((m = re.exec(source)) !== null) {
      const specifier = m[1];
      if (specifier !== undefined) specs.push(specifier);
    }
  }
  return specs;
}

describe("@agentagora/protocol boundary guard", () => {
  it("does not import any AgentAgora Cloud / Workers / SDK code", () => {
    const files = collectTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      const specifiers = extractImportSpecifiers(source);
      for (const spec of specifiers) {
        for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
          if (pattern.test(spec)) {
            violations.push(`${relative(SRC_ROOT, file)} → "${spec}" (${reason})`);
          }
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
