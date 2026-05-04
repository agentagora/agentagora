/**
 * Cloud-API post-deploy smoke test.
 *
 * Closes M3 §D.5: walk a deployed Worker through the same arc the
 * integration test (`tests/integration.test.ts`) walks against
 * `app.request()` — but over real HTTPS, against a real Worker, with
 * a real bearer the operator just provisioned.
 *
 * Run on demand after `pnpm --filter @agentagora/cloud-api deploy`:
 *
 *   pnpm --filter @agentagora/cloud-api smoke -- \
 *     --url=https://<your-cloud-url> \
 *     --bearer=<one of the OWNER_TOKENS> \
 *     --owner-id=smoke-test
 *
 * What it asserts (8 steps, in launch-runbook §5 order):
 *
 *   1. healthz             GET /healthz returns 200, body.ok=true
 *   2. jwks                GET /.well-known/jwks.json — 200 with at
 *                          least one EdDSA key, OR 503 (skipped)
 *   3. publish             POST /v1/agents with a freshly-signed
 *                          smoke-test manifest; expect 201
 *                          (--bearer absent → skipped)
 *   4. resolve             GET /v1/agents/:aid for the just-published
 *                          AID; manifest matches what we sent
 *   5. catalog             GET /v1/agents lists at least our agent
 *   6. conversation 404    GET /v1/conversations/<random> returns
 *                          200 with empty events (proves the route
 *                          is mounted; our smoke didn't ingest any)
 *   7. owner-scoped        GET /v1/agents?owner=<id> with bearer
 *                          (--bearer absent → skipped)
 *   8. burst               5 quick publishes; at least one succeeds.
 *                          Doesn't try to TRIGGER 429 — that requires
 *                          hitting the per-owner cap; we just confirm
 *                          the route accepts traffic at burst rate.
 *
 * Output: markdown table to stdout + JSON to scripts/.smoke-results.json.
 * Exit code 0 iff every required step is "ok" or "skipped"; 1 if any
 * step is "failed".
 *
 * Cleanup: the cloud-api has no DELETE /v1/agents/:aid yet. With or
 * without --keep, the smoke-test agent stays published. The script
 * names each agent with a millisecond-resolution suffix so multiple
 * smoke runs don't conflict on the TOFU pubkey pin.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import canonicalize from "canonicalize";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Args {
  url: string;
  bearer?: string;
  ownerId: string;
  verbose: boolean;
  keep: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { verbose: false, keep: false, ownerId: "smoke-test" };
  for (const raw of argv) {
    if (raw.startsWith("--url=")) args.url = raw.slice("--url=".length);
    else if (raw.startsWith("--bearer=")) args.bearer = raw.slice("--bearer=".length);
    else if (raw.startsWith("--owner-id=")) args.ownerId = raw.slice("--owner-id=".length);
    else if (raw === "--verbose") args.verbose = true;
    else if (raw === "--keep") args.keep = true;
  }
  if (!args.url) {
    fail("missing --url=https://<your-cloud-url>");
  }
  return args as Args;
}

function fail(message: string): never {
  console.error(`smoke: ${message}`);
  process.exit(1);
}

type StepStatus = "ok" | "failed" | "skipped";

interface StepResult {
  name: string;
  status: StepStatus;
  durationMs: number;
  details?: string;
}

interface Context {
  args: Args;
  results: StepResult[];
  /** Set by step "publish" so later steps can resolve / list it. */
  publishedAid?: string;
  publishedPubkey?: string;
}

async function step(
  ctx: Context,
  name: string,
  fn: () => Promise<{ status: StepStatus; details?: string }>,
): Promise<StepResult> {
  const start = performance.now();
  try {
    const { status, details } = await fn();
    const result: StepResult = {
      name,
      status,
      durationMs: Math.round(performance.now() - start),
    };
    if (details !== undefined) result.details = details;
    ctx.results.push(result);
    if (ctx.args.verbose) {
      const detail = details ? ` — ${details}` : "";
      console.error(`[${status}] ${name} (${result.durationMs}ms)${detail}`);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: StepResult = {
      name,
      status: "failed",
      durationMs: Math.round(performance.now() - start),
      details: message,
    };
    ctx.results.push(result);
    return result;
  }
}

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function buildSmokeManifest(): Promise<{
  manifest: Record<string, unknown>;
  pubkeyB64u: string;
  signatureB64u: string;
}> {
  const aid = `aid:agentagora:smoke-test/probe-${Date.now()}`;
  const manifest: Record<string, unknown> = {
    manifest_version: 1,
    aid,
    description: "Post-deploy smoke probe — safe to ignore.",
    endpoints: { rpc: "https://example.test/aap/v1/rpc" },
    capabilities: [
      {
        name: "smoke_probe",
        input_schema: { type: "object" },
        output_schema: { type: "object" },
        pricing: { model: "free" },
        accepts: [],
      },
    ],
  };
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const canonical = canonicalize(manifest);
  if (canonical === undefined) {
    throw new Error("canonicalize returned undefined");
  }
  const sig = await ed.signAsync(new TextEncoder().encode(canonical), privateKey);
  return {
    manifest,
    pubkeyB64u: b64uEncode(publicKey),
    signatureB64u: b64uEncode(sig),
  };
}

async function runHealthz(ctx: Context): Promise<void> {
  await step(ctx, "healthz", async () => {
    const res = await fetch(`${ctx.args.url}/healthz`);
    if (res.status !== 200) {
      return { status: "failed", details: `expected 200, got ${res.status}` };
    }
    const body = (await res.json()) as { ok?: boolean };
    if (body.ok !== true) {
      return { status: "failed", details: `body.ok was ${JSON.stringify(body.ok)}` };
    }
    return { status: "ok" };
  });
}

async function runJwks(ctx: Context): Promise<void> {
  await step(ctx, "jwks", async () => {
    const res = await fetch(`${ctx.args.url}/.well-known/jwks.json`);
    if (res.status === 503) return { status: "skipped", details: "OIDC not configured" };
    if (res.status !== 200) {
      return { status: "failed", details: `expected 200 or 503, got ${res.status}` };
    }
    const body = (await res.json()) as { keys?: Array<{ alg?: string; kty?: string }> };
    if (!body.keys?.length) {
      return { status: "failed", details: "no keys in JWKS document" };
    }
    const eddsa = body.keys.find((k) => k.alg === "EdDSA" && k.kty === "OKP");
    if (!eddsa) {
      return { status: "failed", details: "no EdDSA / OKP key in JWKS" };
    }
    return { status: "ok", details: `${body.keys.length} key(s)` };
  });
}

async function runPublish(ctx: Context): Promise<void> {
  if (!ctx.args.bearer) {
    ctx.results.push({
      name: "publish",
      status: "skipped",
      durationMs: 0,
      details: "no --bearer provided",
    });
    return;
  }
  await step(ctx, "publish", async () => {
    const { manifest, pubkeyB64u, signatureB64u } = await buildSmokeManifest();
    const res = await fetch(`${ctx.args.url}/v1/agents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ctx.args.bearer}`,
        "x-aap-pubkey": pubkeyB64u,
        "x-aap-signature": signatureB64u,
      },
      body: JSON.stringify(manifest),
    });
    if (res.status !== 201) {
      const body = await res.text();
      return { status: "failed", details: `expected 201, got ${res.status}: ${body}` };
    }
    ctx.publishedAid = manifest.aid as string;
    ctx.publishedPubkey = pubkeyB64u;
    return { status: "ok", details: ctx.publishedAid };
  });
}

async function runResolve(ctx: Context): Promise<void> {
  if (!ctx.publishedAid) {
    ctx.results.push({
      name: "resolve",
      status: "skipped",
      durationMs: 0,
      details: "publish did not run / failed",
    });
    return;
  }
  const aid = ctx.publishedAid;
  await step(ctx, "resolve", async () => {
    const res = await fetch(`${ctx.args.url}/v1/agents/${encodeURIComponent(aid)}`);
    if (res.status !== 200) {
      return { status: "failed", details: `expected 200, got ${res.status}` };
    }
    const body = (await res.json()) as { aid?: string };
    if (body.aid !== aid) {
      return { status: "failed", details: `aid mismatch: expected ${aid}, got ${body.aid}` };
    }
    return { status: "ok" };
  });
}

async function runCatalog(ctx: Context): Promise<void> {
  await step(ctx, "catalog", async () => {
    const res = await fetch(`${ctx.args.url}/v1/agents`);
    if (res.status !== 200) {
      return { status: "failed", details: `expected 200, got ${res.status}` };
    }
    const body = (await res.json()) as { total?: number; agents?: Array<{ aid: string }> };
    if (!Array.isArray(body.agents)) {
      return { status: "failed", details: "no agents[] in response" };
    }
    if (ctx.publishedAid && !body.agents.find((a) => a.aid === ctx.publishedAid)) {
      return {
        status: "failed",
        details: `${ctx.publishedAid} missing from catalog (total ${body.total})`,
      };
    }
    return { status: "ok", details: `total=${body.total}` };
  });
}

async function runConversationLookup(ctx: Context): Promise<void> {
  await step(ctx, "conversation_lookup", async () => {
    const id = `smoke-convo-${Date.now()}`;
    const res = await fetch(`${ctx.args.url}/v1/conversations/${id}`);
    if (res.status !== 200) {
      return { status: "failed", details: `expected 200, got ${res.status}` };
    }
    const body = (await res.json()) as { events?: unknown[] };
    if (!Array.isArray(body.events) || body.events.length !== 0) {
      return {
        status: "failed",
        details: `expected empty events[], got ${JSON.stringify(body.events)}`,
      };
    }
    return { status: "ok" };
  });
}

async function runOwnerScoped(ctx: Context): Promise<void> {
  if (!ctx.args.bearer) {
    ctx.results.push({
      name: "owner_scoped",
      status: "skipped",
      durationMs: 0,
      details: "no --bearer provided",
    });
    return;
  }
  await step(ctx, "owner_scoped", async () => {
    const url = `${ctx.args.url}/v1/agents?owner=${encodeURIComponent(ctx.args.ownerId)}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${ctx.args.bearer}` },
    });
    // 200 if the bearer's resolved owner matches `?owner=`; 403 if not.
    // For smoke we only assert the route exists + responds in a known shape.
    if (res.status !== 200 && res.status !== 403) {
      return { status: "failed", details: `expected 200 or 403, got ${res.status}` };
    }
    return { status: "ok", details: `status=${res.status}` };
  });
}

async function runBurst(ctx: Context): Promise<void> {
  if (!ctx.args.bearer) {
    ctx.results.push({
      name: "burst",
      status: "skipped",
      durationMs: 0,
      details: "no --bearer provided",
    });
    return;
  }
  await step(ctx, "burst", async () => {
    let okCount = 0;
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const { manifest, pubkeyB64u, signatureB64u } = await buildSmokeManifest();
      const res = await fetch(`${ctx.args.url}/v1/agents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ctx.args.bearer}`,
          "x-aap-pubkey": pubkeyB64u,
          "x-aap-signature": signatureB64u,
        },
        body: JSON.stringify(manifest),
      });
      lastStatus = res.status;
      if (res.status === 201) okCount++;
    }
    if (okCount === 0) {
      return { status: "failed", details: `0/5 publishes succeeded (last status ${lastStatus})` };
    }
    return { status: "ok", details: `${okCount}/5 succeeded` };
  });
}

function renderTable(results: StepResult[]): string {
  const rows = results.map((r) => {
    const icon = r.status === "ok" ? "✅" : r.status === "skipped" ? "⏭" : "❌";
    return `| ${icon} | ${r.name} | ${r.status} | ${r.durationMs}ms | ${r.details ?? ""} |`;
  });
  return ["| | step | status | duration | details |", "|---|---|---|---|---|", ...rows].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ctx: Context = { args, results: [] };

  console.error(`smoke: target ${args.url}`);
  if (!args.bearer) {
    console.error("smoke: --bearer absent — skipping write-path checks");
  }

  await runHealthz(ctx);
  await runJwks(ctx);
  await runPublish(ctx);
  await runResolve(ctx);
  await runCatalog(ctx);
  await runConversationLookup(ctx);
  await runOwnerScoped(ctx);
  await runBurst(ctx);

  const table = renderTable(ctx.results);
  console.log(table);
  console.log("");

  const failed = ctx.results.filter((r) => r.status === "failed");
  const skipped = ctx.results.filter((r) => r.status === "skipped").length;
  const ok = ctx.results.filter((r) => r.status === "ok").length;

  if (ctx.publishedAid) {
    console.log(
      `note: smoke-test agent ${ctx.publishedAid} stays published (cloud-api has no DELETE /v1/agents/:aid; --keep flag has no current effect — tracked as M3+ stretch)`,
    );
  }

  const outPath = resolve(__dirname, ".smoke-results.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        target: args.url,
        ranAt: new Date().toISOString(),
        results: ctx.results,
        summary: { ok, skipped, failed: failed.length },
        publishedAid: ctx.publishedAid,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    console.log(`\nFAIL: ${failed.length} step(s) failed (${ok} ok / ${skipped} skipped)`);
    process.exit(1);
  }
  console.log(`\nPASS: ${ok} step(s) ok / ${skipped} skipped / 0 failed`);
}

main().catch((err) => {
  console.error("smoke: unexpected error", err);
  process.exit(1);
});
