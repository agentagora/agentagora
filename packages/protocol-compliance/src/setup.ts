/**
 * Provisioner — establishes the known-state fixtures Tier 3 tests
 * need against a cloud-api candidate.
 *
 * Per F.3 decision (docs/maintainer-tasks.md), the suite uses a
 * **CLI provisioner** as the primary path: `pnpm protocol-compliance
 * --setup` generates an Ed25519 keypair, signs a minimal manifest,
 * publishes it via `POST /v1/agents`, and persists the resulting
 * fixture identifiers to a temp file. Tier 3 test runs then read
 * those fixtures via `loadFixtures()`.
 *
 * Fallback for impls that don't implement the full publish flow:
 * the `--seed-file=fixtures.json` mode of the CLI (handled in
 * `cli.ts`) bypasses provisioning and accepts a pre-built fixture
 * file from the impl's own setup. Those impls run only Tier 1 + 2
 * toward the badge.
 */

import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import canonicalize from "canonicalize";

// @noble/ed25519 v2 needs a synchronous SHA-512 implementation
// installed at module-load time. Mirrors the pattern used by
// packages/sdk/src/signing.ts and apps/cloud/api/src/_crypto.ts.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface Fixtures {
  /** Base URL of the candidate the fixtures were provisioned against. */
  baseUrl: string;
  /** Owner-id the bearer resolved to (echoed from the publish response if exposed). */
  ownerId: string;
  /** AID of the published manifest. */
  aid: string;
  /** Base64url-encoded Ed25519 32-byte public key. */
  pubkeyB64u: string;
  /** Base64url-encoded Ed25519 32-byte private key seed. */
  privkeyB64u: string;
  /** ISO-8601 timestamp when the fixtures were provisioned. */
  provisionedAt: string;
}

export interface ProvisionOpts {
  baseUrl: string;
  bearer: string;
  /** Owner namespace for the AID, e.g. `compliance-suite`. */
  ownerNamespace?: string;
  /** Agent name within the namespace, e.g. `tier3-fixture-1`. */
  agentName?: string;
}

const DEFAULT_NAMESPACE = "compliance-suite";
const DEFAULT_NAME = "tier3-fixture";

/**
 * RFC 4648 §5 base64url encode (unpadded).
 */
function b64uEncode(bytes: Uint8Array): string {
  let s = Buffer.from(bytes).toString("base64");
  s = s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return s;
}

/**
 * RFC 4648 §5 base64url decode (unpadded). Supports padded input too.
 */
export function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4;
  let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  if (pad === 2) normalized += "==";
  else if (pad === 3) normalized += "=";
  return new Uint8Array(Buffer.from(normalized, "base64"));
}

/**
 * Generate an Ed25519 keypair using @noble/ed25519. Returns the seed
 * (private key) and public key as raw 32-byte Uint8Arrays.
 */
async function generateKeypair(): Promise<{ pubkey: Uint8Array; privkey: Uint8Array }> {
  const privkey = ed.utils.randomPrivateKey();
  const pubkey = await ed.getPublicKey(privkey);
  return { pubkey, privkey };
}

/**
 * Build the smallest valid manifest a candidate's `ManifestSchema`
 * will accept. Mirrors `@agentagora/protocol`'s ManifestSchema:
 * manifest_version, aid, endpoints, capabilities (≥1).
 */
function buildMinimalManifest(aid: string): Record<string, unknown> {
  return {
    manifest_version: 1,
    aid,
    description: "AgentAgora protocol-compliance test fixture — DO NOT use for real workloads",
    endpoints: {
      rpc: "https://compliance.invalid/aap",
    },
    capabilities: [
      {
        name: "compliance_echo",
        description: "Echo capability used by the protocol-compliance suite — no real handler",
        input_schema: { type: "object" },
        output_schema: { type: "object" },
        pricing: { model: "free" },
      },
    ],
    privacy: {},
    metadata: {},
  };
}

/**
 * Sign a JSON object's canonical (RFC 8785) bytes with Ed25519.
 * Returns the 64-byte signature.
 */
async function signCanonical(value: unknown, privkey: Uint8Array): Promise<Uint8Array> {
  const text = canonicalize(value);
  if (text === undefined) {
    throw new TypeError("canonicalize returned undefined; manifest contains an unsupported value");
  }
  const bytes = new TextEncoder().encode(text);
  return ed.sign(bytes, privkey);
}

/**
 * Publish a manifest via `POST /v1/agents`. Returns the parsed
 * response body on 201; throws on any other status with a descriptive
 * error so the CLI can surface the candidate's response.
 */
async function publishManifest(
  baseUrl: string,
  bearer: string,
  manifest: Record<string, unknown>,
  pubkey: Uint8Array,
  signature: Uint8Array,
): Promise<{ aid: string; identity_jwt: string; published_at: string }> {
  const res = await fetch(`${baseUrl}/v1/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
      "x-aap-pubkey": b64uEncode(pubkey),
      "x-aap-signature": b64uEncode(signature),
    },
    // IMPORTANT: send the EXACT canonical JSON we signed, not
    // JSON.stringify(manifest) — otherwise key order may differ and
    // the candidate's signature verify will fail.
    body: canonicalize(manifest),
  });
  const text = await res.text();
  if (res.status !== 201) {
    throw new Error(`publish failed: ${res.status} ${res.statusText}\n${text || "<empty body>"}`);
  }
  return JSON.parse(text) as { aid: string; identity_jwt: string; published_at: string };
}

/**
 * Provision Tier 3 fixtures. End-to-end:
 *   1. Generate Ed25519 keypair
 *   2. Build a minimal manifest with AID
 *      `aid:agentagora:<namespace>/<name>`
 *   3. Sign canonical bytes with the private key
 *   4. POST to candidate's /v1/agents with bearer + headers
 *   5. Return Fixtures object for caller to persist
 */
export async function provisionFixtures(opts: ProvisionOpts): Promise<Fixtures> {
  const { baseUrl, bearer } = opts;
  const namespace = opts.ownerNamespace ?? DEFAULT_NAMESPACE;
  const name = opts.agentName ?? DEFAULT_NAME;
  const aid = `aid:agentagora:${namespace}/${name}`;

  const { pubkey, privkey } = await generateKeypair();
  const manifest = buildMinimalManifest(aid);
  const signature = await signCanonical(manifest, privkey);

  // The publish call surfaces candidate-side errors verbatim — let the
  // CLI catch + print rather than swallowing them here.
  const published = await publishManifest(baseUrl, bearer, manifest, pubkey, signature);

  return {
    baseUrl,
    ownerId: "", // not exposed in the publish response; tests don't need it
    aid: published.aid,
    pubkeyB64u: b64uEncode(pubkey),
    privkeyB64u: b64uEncode(privkey),
    provisionedAt: new Date().toISOString(),
  };
}

// ── Persistence ─────────────────────────────────────────────────────

/**
 * Where the provisioner writes its fixture file and where the test
 * runner reads it from. Under `node_modules/.cache/` because that's
 * gitignored by every standard pnpm setup and survives across test
 * runs without polluting the repo.
 */
const FIXTURE_PATH = "node_modules/.cache/protocol-compliance/fixtures.json";

export async function saveFixtures(fixtures: Fixtures): Promise<string> {
  await mkdir(dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, JSON.stringify(fixtures, null, 2), "utf-8");
  return FIXTURE_PATH;
}

export async function loadFixtures(): Promise<Fixtures | null> {
  try {
    const text = await readFile(FIXTURE_PATH, "utf-8");
    return JSON.parse(text) as Fixtures;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Synchronous fixture loader — vitest's `describe.skipIf(...)` runs
 * at module-eval time before any async hooks fire, so async loaders
 * don't help there. We accept a small duplication: `loadFixturesSync`
 * for the gating decision, async `loadFixtures` for tests that want
 * to defer the read.
 */
export function loadFixturesSync(): Fixtures | null {
  try {
    const text = readFileSync(FIXTURE_PATH, "utf-8");
    return JSON.parse(text) as Fixtures;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
