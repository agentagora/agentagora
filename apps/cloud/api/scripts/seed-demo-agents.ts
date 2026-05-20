/**
 * Seed the local cloud-api with demo agents.
 *
 * Why this exists: the marketing site's "Live catalog" section pulls
 * from `GET /v1/agents` at build time. In a fresh local D1 the only
 * non-smoke-test agent is the compliance fixture, so the catalog
 * renders as a one-card lonely grid. This script publishes 6
 * realistic demo agents spanning different niches / pricing models /
 * settlement channels, so the catalog reads as a populated market
 * instead of "you're the only one here".
 *
 * Run once after `wrangler d1 migrations apply DB --local` and
 * starting `wrangler dev`:
 *
 *   pnpm --filter @agentagora/cloud-api seed:catalog
 *
 * Idempotent — re-running upserts each agent under the same AID
 * (cloud-api's `POST /v1/agents` is upsert-on-AID, gated by the
 * TOFU pin from the first publish). Re-running with different keys
 * would 403; the script generates deterministic keys from a fixed
 * seed string per AID so a second run always works.
 *
 * Data lives in `apps/cloud/api/.wrangler/state/` which is
 * gitignored. Nothing here ships to production.
 *
 * Args:
 *   --url=…       cloud-api base URL (default http://127.0.0.1:8787)
 *   --bearer=…    owner bearer (default local-dev-bearer)
 *   --reset       fail silently on the per-AID TOFU 403 and continue
 *                 (default: surface the error)
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import canonicalize from "canonicalize";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

interface DemoCapability {
  name: string;
  pricing: { model: "free" } | { model: "per_call"; amount: string; currency: string };
  accepts: string[];
}

interface DemoAgent {
  aid: string;
  description: string;
  endpoint: string;
  capabilities: DemoCapability[];
}

/**
 * Six demo agents covering free + paid, fiat + crypto, single + multi-
 * capability. Picked to render visually distinct cards on the
 * marketing catalog grid: different namespace lengths, different
 * accept-channel chip counts, different capability counts.
 */
const DEMO_AGENTS: DemoAgent[] = [
  {
    aid: "aid:agentagora:lingua/translate",
    description:
      "Polyglot translator covering 47 languages. Translates Markdown, plain text, and structured JSON in a single round-trip; preserves code fences and inline formatting.",
    endpoint: "https://lingua.example.com/aap/v1/rpc",
    capabilities: [
      {
        name: "translate",
        pricing: { model: "per_call", amount: "0.02", currency: "USD" },
        accepts: ["stripe-fiat", "usdc-base"],
      },
    ],
  },
  {
    aid: "aid:agentagora:reviewbot/code-review",
    description:
      "Reviews pull requests with structured per-file comments. Calibrated for TypeScript, Go, and Python. Always returns a JSON report — no chat prose.",
    endpoint: "https://reviewbot.example.com/aap/v1/rpc",
    capabilities: [
      {
        name: "review_pull_request",
        pricing: { model: "per_call", amount: "0.50", currency: "USD" },
        accepts: ["stripe-fiat"],
      },
      {
        name: "explain_diff",
        pricing: { model: "free" },
        accepts: [],
      },
    ],
  },
  {
    aid: "aid:agentagora:tickerwire/market-data",
    description:
      "Real-time and historical market data — equities, ETFs, FX, and the 200 largest crypto pairs. Sub-100 ms p95 from cache; falls back to provider on miss.",
    endpoint: "https://tickerwire.example.com/aap/v1/rpc",
    capabilities: [
      {
        name: "quote",
        pricing: { model: "per_call", amount: "0.001", currency: "USD" },
        accepts: ["usdc-base"],
      },
      {
        name: "ohlcv",
        pricing: { model: "per_call", amount: "0.005", currency: "USD" },
        accepts: ["usdc-base"],
      },
    ],
  },
  {
    aid: "aid:agentagora:pixelforge/image-gen",
    description:
      "Photo-realistic image generation tuned for product mockups and marketing assets. Returns PNG + WebP variants; takes a structured brief instead of a prompt blob.",
    endpoint: "https://pixelforge.example.com/aap/v1/rpc",
    capabilities: [
      {
        name: "generate",
        pricing: { model: "per_call", amount: "0.08", currency: "USD" },
        accepts: ["stripe-fiat", "usdc-base"],
      },
    ],
  },
  {
    aid: "aid:agentagora:helpdesk/support",
    description:
      "First-line customer support agent for SaaS billing questions. Handles plan changes, refund requests, and invoice lookups; escalates anything it can't resolve.",
    endpoint: "https://helpdesk.example.com/aap/v1/rpc",
    capabilities: [
      {
        name: "answer_billing",
        pricing: { model: "free" },
        accepts: [],
      },
    ],
  },
  {
    aid: "aid:agentagora:chronos/scheduler",
    description:
      "Cross-timezone meeting scheduler. Reads multiple calendars, proposes slots that respect every attendee's working hours, and writes the chosen slot back.",
    endpoint: "https://chronos.example.com/aap/v1/rpc",
    capabilities: [
      {
        name: "propose_slots",
        pricing: { model: "per_call", amount: "0.10", currency: "USD" },
        accepts: ["stripe-fiat"],
      },
      {
        name: "book_slot",
        pricing: { model: "per_call", amount: "0.10", currency: "USD" },
        accepts: ["stripe-fiat"],
      },
    ],
  },
];

const PASSTHROUGH_SCHEMA = { type: "object", additionalProperties: true };

interface Args {
  url: string;
  bearer: string;
  reset: boolean;
}

function parseArgs(argv: string[]): Args {
  let url = "http://127.0.0.1:8787";
  let bearer = "local-dev-bearer";
  let reset = false;
  for (const arg of argv) {
    if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else if (arg.startsWith("--bearer=")) bearer = arg.slice("--bearer=".length);
    else if (arg === "--reset") reset = true;
  }
  return { url, bearer, reset };
}

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Deterministic 32-byte private key from a seed string. Re-running
 * this script with the same AID produces the same key, so cloud-api's
 * TOFU pubkey pin (security-review-2026-05 §M2) doesn't reject the
 * upsert on the second run.
 */
async function deterministicKey(seed: string): Promise<Uint8Array> {
  const seedBytes = new TextEncoder().encode(`agentagora-demo-seed:${seed}`);
  const digest = sha512(seedBytes);
  return digest.slice(0, 32);
}

interface PublishResult {
  aid: string;
  status: "published" | "tofu_blocked" | "error";
  message?: string;
}

async function publishOne(args: Args, agent: DemoAgent): Promise<PublishResult> {
  const manifest = {
    manifest_version: 1,
    aid: agent.aid,
    description: agent.description,
    endpoints: { rpc: agent.endpoint },
    capabilities: agent.capabilities.map((cap) => ({
      name: cap.name,
      input_schema: PASSTHROUGH_SCHEMA,
      output_schema: PASSTHROUGH_SCHEMA,
      pricing: cap.pricing,
      accepts: cap.accepts,
    })),
  };

  const privateKey = await deterministicKey(agent.aid);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const canonical = canonicalize(manifest);
  if (canonical === undefined) {
    return { aid: agent.aid, status: "error", message: "canonicalize returned undefined" };
  }
  const sig = await ed.signAsync(new TextEncoder().encode(canonical), privateKey);

  const res = await fetch(`${args.url}/v1/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.bearer}`,
      "x-aap-pubkey": b64uEncode(publicKey),
      "x-aap-signature": b64uEncode(sig),
    },
    body: JSON.stringify(manifest),
  });

  if (res.status === 201 || res.status === 200) {
    return { aid: agent.aid, status: "published" };
  }

  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    bodyText = "(no body)";
  }

  if (res.status === 403 && args.reset) {
    return { aid: agent.aid, status: "tofu_blocked", message: bodyText };
  }
  return { aid: agent.aid, status: "error", message: `HTTP ${res.status} — ${bodyText}` };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`→ seeding ${DEMO_AGENTS.length} demo agents into ${args.url}`);
  console.log();

  const results: PublishResult[] = [];
  for (const agent of DEMO_AGENTS) {
    const result = await publishOne(args, agent);
    results.push(result);
    const icon = result.status === "published" ? "✓" : result.status === "tofu_blocked" ? "⊝" : "✗";
    console.log(`  ${icon}  ${result.aid}${result.message ? `  — ${result.message}` : ""}`);
  }

  console.log();
  const ok = results.filter((r) => r.status === "published").length;
  const skipped = results.filter((r) => r.status === "tofu_blocked").length;
  const failed = results.filter((r) => r.status === "error").length;
  console.log(`Done. ${ok} published, ${skipped} TOFU-skipped, ${failed} failed.`);
  console.log();
  console.log(`Catalog: ${args.url}/v1/agents`);
  console.log("Marketing site: rebuild / refresh to pick up the new entries.");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("seed-demo-agents failed:", err);
  process.exit(1);
});
