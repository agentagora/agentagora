#!/usr/bin/env node
/**
 * `protocol-compliance` CLI — currently exposes one subcommand:
 *
 *   protocol-compliance --setup --base-url=<URL> --bearer=<TOKEN>
 *     [--owner-namespace=<NS>] [--name=<AGENT_NAME>]
 *
 * Usage from this repo:
 *
 *   pnpm --filter @agentagora/protocol-compliance setup -- \
 *     --base-url=http://localhost:8788 \
 *     --bearer=$AAP_TEST_BEARER
 *
 * The provisioner generates an Ed25519 keypair, signs a minimal
 * manifest, publishes it to the candidate's `POST /v1/agents`, and
 * persists the resulting fixture identifiers to
 * `node_modules/.cache/protocol-compliance/fixtures.json`. Tier 3
 * tests then read those fixtures via `loadFixturesSync()`.
 *
 * Per F.3 decision (docs/maintainer-tasks.md), a `--seed-file=PATH`
 * fallback path is reserved for impls that don't yet implement the
 * publish flow — they hand-craft a fixture file matching the
 * `Fixtures` shape and the runner uses it directly. Implemented as
 * a copy-only helper here for now; the live publish path is the
 * primary one.
 */

import { copyFile } from "node:fs/promises";
import { looksLikeProductionUrl, provisionFixtures, saveFixtures } from "./setup.js";

interface ParsedArgs {
  setup: boolean;
  baseUrl?: string;
  bearer?: string;
  ownerNamespace?: string;
  agentName?: string;
  seedFile?: string;
  allowProduction: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { setup: false, help: false, allowProduction: false };
  for (const arg of argv) {
    if (arg === "--setup") out.setup = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--allow-production") out.allowProduction = true;
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--bearer=")) out.bearer = arg.slice("--bearer=".length);
    else if (arg.startsWith("--owner-namespace=")) {
      out.ownerNamespace = arg.slice("--owner-namespace=".length);
    } else if (arg.startsWith("--name=")) out.agentName = arg.slice("--name=".length);
    else if (arg.startsWith("--seed-file=")) out.seedFile = arg.slice("--seed-file=".length);
  }
  return out;
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: protocol-compliance --setup --base-url=<URL> --bearer=<TOKEN>",
      "                          [--owner-namespace=<NS>] [--name=<AGENT_NAME>]",
      "       protocol-compliance --seed-file=<PATH>",
      "",
      "  --setup              Provision Tier 3 fixtures by publishing a fresh",
      "                       manifest to the candidate cloud-api at --base-url.",
      "                       Requires a bearer the candidate accepts.",
      "  --seed-file=PATH     Copy a pre-built fixtures.json into the cache slot",
      "                       instead of provisioning. Use this if the candidate",
      "                       doesn't yet implement the full publish flow; the",
      "                       fixture file must match the `Fixtures` shape from",
      "                       packages/protocol-compliance/src/setup.ts.",
      "",
      "Tier 3 tests read fixtures from",
      "  node_modules/.cache/protocol-compliance/fixtures.json",
      "and skip if the file isn't present, so partial setup is never destructive.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.setup && !args.seedFile)) {
    printUsage();
    return args.help ? 0 : 1;
  }

  if (args.seedFile) {
    const dest = "node_modules/.cache/protocol-compliance/fixtures.json";
    await copyFile(args.seedFile, dest);
    process.stdout.write(`✓ Copied seed file to ${dest}\n`);
    return 0;
  }

  // security-review-2026-05-07 §M10: prefer bearer via env var so it
  // doesn't appear in shell history / ps. `--bearer=` flag still
  // works but emits a deprecation warning.
  const bearerFromEnv = process.env.AAP_TEST_BEARER ?? "";
  if (args.bearer && bearerFromEnv && args.bearer !== bearerFromEnv) {
    process.stderr.write(
      "✗ Conflicting bearer: --bearer flag does not match AAP_TEST_BEARER env\n",
    );
    return 1;
  }
  const effectiveBearer = args.bearer || bearerFromEnv;
  if (args.bearer && !bearerFromEnv) {
    process.stderr.write(
      "⚠ --bearer flag is visible in shell history + `ps` output. " +
        "Prefer AAP_TEST_BEARER env (security-review-2026-05-07 §M10).\n",
    );
  }

  if (!args.baseUrl || !effectiveBearer) {
    process.stderr.write(
      "--base-url and a bearer (via --bearer= or AAP_TEST_BEARER env) are required for --setup\n\n",
    );
    printUsage();
    return 1;
  }

  // security-review-2026-05-07 §M9: refuse production-shaped URLs
  // without --allow-production. `--setup` publishes a real manifest
  // and persists a private key locally; the safest default is to
  // assume the operator pointed at production by accident.
  if (!args.allowProduction && looksLikeProductionUrl(args.baseUrl)) {
    process.stderr.write(
      [
        `✗ --base-url ${args.baseUrl} looks like a production cloud-api host.`,
        "",
        "  This will publish a real manifest and persist its Ed25519 private",
        "  key to node_modules/.cache/protocol-compliance/fixtures.json on this",
        "  machine. If that's actually what you want, re-run with",
        "  --allow-production. Otherwise point at a sandbox / staging host",
        "  (localhost / 127.0.0.1 / *.workers.dev / *.local / *.test all",
        "  bypass this guard without the flag).",
        "",
        "  security-review-2026-05-07 §M9.",
        "",
      ].join("\n"),
    );
    return 1;
  }

  process.stdout.write(`→ Provisioning Tier 3 fixtures against ${args.baseUrl}…\n`);
  try {
    const fixtures = await provisionFixtures({
      baseUrl: args.baseUrl,
      bearer: effectiveBearer,
      ownerNamespace: args.ownerNamespace,
      agentName: args.agentName,
    });
    const path = await saveFixtures(fixtures);
    process.stdout.write(
      [
        `✓ Published manifest: ${fixtures.aid}`,
        `  pubkey:  ${fixtures.pubkeyB64u}`,
        `  fixtures saved to ${path}`,
        "",
        "Tier 3 tests will now run when AAP_BASE_URL + AAP_TEST_BEARER are set.",
        "",
      ].join("\n"),
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `✗ Provisioning failed:\n${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

main().then((code) => process.exit(code));
