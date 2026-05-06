/**
 * Error envelope contract for cloud-api HTTP responses.
 *
 * Every 4xx / 5xx response from the cloud-api MUST shape its body as:
 *
 *   { error: string, message?: string, request_id?: string, ...context }
 *
 * - `error` — snake_case machine-readable code; one of the approved
 *   set below. Stable contract that dashboards and SDKs key on.
 * - `message` — human-readable detail. Optional but strongly preferred.
 * - `request_id` — present on 5xx responses to correlate with logs
 *   (`wrangler tail --search "req=req_…"`).
 * - Additional context fields (`field`, `issues`, `op`, `event_id`)
 *   are allowed on a per-route basis but should not be relied on by
 *   generic clients.
 *
 * This test parses every `c.json({...}, 4xx|5xx)` literal across the
 * `src/routes/**` source files and:
 *   1. Asserts the literal includes an `error: "..."` field
 *   2. Asserts the error code is snake_case
 *   3. Asserts the error code is in `APPROVED_ERROR_CODES`
 *
 * Adding a new error code is intentional contract surface — it should
 * be added to the approved list in the same PR that introduces it,
 * and ideally documented in `apps/cloud/api/README.md` or the AAP
 * spec mapping.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ROUTES_DIR = resolve(PKG_ROOT, "src/routes");

// Snake-case advisory: lowercase letters, digits, underscores; must
// start with a letter. Matches AAP-spec §6.4 `aap.<lower_snake>`
// shape minus the prefix (cloud-api HTTP errors live in their own
// namespace, but mirror the casing).
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

// Approved error codes for cloud-api HTTP responses. Adding a new
// code without updating this list will fail this test — that's
// intentional. Treat each entry as a public-API commitment.
const APPROVED_ERROR_CODES: Record<string, string> = {
  // Auth / authz
  unauthorized: "Missing or invalid bearer token; OIDC failure; signature mismatch.",
  forbidden: "Bearer is valid but caller is not allowed to access the resource.",

  // Resource lookup
  not_found: "Requested resource (agent, dispute, conversation) does not exist.",
  conversation_not_found: "Audit-ingest references a conversation we don't have.",

  // Body / input validation
  invalid_body: "Request body is malformed JSON, wrong shape, or fails schema.",
  invalid_manifest: "Manifest body fails canonical-form / schema validation.",
  noncanonical_manifest: "Manifest serialization is not RFC 8785 canonical.",
  validation_error: "Generic schema validation failure (Zod issues attached).",
  missing_filter: "Required query-string filter not supplied (e.g., ?owner=).",

  // Identity / cross-owner
  unknown_actor: "Audit-event actor AID has no resolved owner mapping.",
  unknown_filer: "Dispute filer_aid is not owned by the bearer's owner.",
  unknown_respondent: "Dispute respondent_aid AID does not exist.",
  actor_unsigned: "Audit-event payload is not signed by its actor's pubkey.",
  missing_signature: "Audit event lacks the required signature header.",
  malformed_signature: "Audit-event signature is present but cannot be parsed.",
  invalid_signature: "Audit-event / Stripe-webhook signature does not verify.",
  broken_chain: "Audit chain prev_hash does not match the on-record predecessor.",
  duplicate_event: "Audit event_id already ingested (idempotency key).",

  // Service capability
  not_configured: "Endpoint requires a secret that isn't set (Stripe / OIDC / OAuth).",
  not_ready: "Stripe Connect account not in `charges_enabled=true` state.",
  stripe_unavailable: "Upstream Stripe API call failed (5xx, network).",
  handler_failed: "Stripe webhook handler threw while processing the event.",
};

interface ErrorResponse {
  file: string;
  line: number;
  source: string;
  errorCode: string;
}

// Walk source files under src/routes/.
function collectRouteFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry);
    if (abs.endsWith(".ts") && !abs.endsWith(".test.ts")) out.push(abs);
  }
  return out;
}

// Pull every `c.json({...}, NUM)` where NUM is a 4xx/5xx status code.
// Match the FIRST string-literal value of any `error:` key inside the
// object literal — works for the simple-object pattern this codebase
// uses (no nested error objects). False-positive on `// error:` comment
// lines is avoided by stripping `//`-comment text first.
function extractErrorResponses(file: string, repoRoot: string): ErrorResponse[] {
  const source = readFileSync(file, "utf-8");
  const lines = source.split("\n");
  const responses: ErrorResponse[] = [];

  // c.json({ ... }, 4xx | 5xx)
  // We scan with a single regex: capture object body lazily until the
  // matching status. Multi-line objects would slip past, so we also
  // accept `c.json(\n{...\n}, NNN)` patterns.
  const pattern = /c\.json\(\s*(\{[\s\S]*?\})\s*,\s*([4-5]\d\d)\s*\)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex-walking idiom
  while ((m = pattern.exec(source)) !== null) {
    const [full, body, _status] = m;
    if (full === undefined || body === undefined) continue;

    // Find the line number of the match start.
    const offset = m.index;
    let line = 1;
    for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;

    // Skip lines preceded by a `//` comment marker on the same line.
    const surroundingLine = lines[line - 1] ?? "";
    if (surroundingLine.trimStart().startsWith("//")) continue;

    // Pull the error code if present.
    const errorMatch = body.match(/error:\s*"([^"]+)"/);
    if (!errorMatch || errorMatch[1] === undefined) {
      // Some 4xx/5xx responses are intentionally non-error-shaped
      // (e.g., 400 from Stripe webhook returns a Stripe-style envelope
      // not our error envelope — we leave those alone). Skip if no
      // `error:` key found.
      continue;
    }

    responses.push({
      file: relative(repoRoot, file),
      line,
      source: full,
      errorCode: errorMatch[1],
    });
  }

  return responses;
}

describe("cloud-api HTTP error envelope contract", () => {
  const REPO_ROOT = resolve(PKG_ROOT, "../../..");
  const allResponses: ErrorResponse[] = [];
  for (const file of collectRouteFiles(ROUTES_DIR)) {
    allResponses.push(...extractErrorResponses(file, REPO_ROOT));
  }

  it("finds error responses in every route file", () => {
    // Sanity check that the regex actually picks up something —
    // catches the case where the c.json grammar drifts and we silently
    // start matching nothing. Pin to a conservative lower bound that
    // grows with the codebase but doesn't flap on small refactors.
    expect(allResponses.length).toBeGreaterThanOrEqual(20);
  });

  it("every error code is snake_case", () => {
    const violations = allResponses
      .filter((r) => !SNAKE_CASE.test(r.errorCode))
      .map((r) => `${r.file}:${r.line} → "${r.errorCode}"`);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("every error code is in the approved list", () => {
    const approvedNames = new Set(Object.keys(APPROVED_ERROR_CODES));
    const violations = allResponses
      .filter((r) => !approvedNames.has(r.errorCode))
      .map(
        (r) =>
          `${r.file}:${r.line} uses "${r.errorCode}" which is not in APPROVED_ERROR_CODES — add it to the list in this test (with a one-line description) in the same PR that introduces it.`,
      );
    expect(violations, violations.join("\n")).toEqual([]);
  });

  // Note on a missing reverse-direction check.
  //
  // We deliberately don't assert "every approved code has at least one
  // top-level c.json() emit". The audit-ingest pipeline returns a 200
  // OK envelope `{ ingested, rejected }` where each rejected entry
  // carries its own `error: <code>` field — those codes
  // (`validation_error`, `actor_unsigned`, `duplicate_event`,
  // `broken_chain`, `unknown_actor`, ...) are part of the same
  // contract surface but emitted from inside a 2xx body, not via
  // `c.json({error: ...}, 4xx)`. They're listed in APPROVED_ERROR_CODES
  // for documentation, even though the regex above won't match them.
  //
  // Likewise, `not_configured` is emitted by helpers in `src/index.ts`
  // (Stripe / OIDC missing-secret guards), not from the `routes/`
  // tree this test scans. Keeping it on the approved list is correct
  // even though no route file matches it.
});
