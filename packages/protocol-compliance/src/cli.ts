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
import { provisionFixtures, saveFixtures } from "./setup.js";

interface ParsedArgs {
  setup: boolean;
  baseUrl?: string;
  bearer?: string;
  ownerNamespace?: string;
  agentName?: string;
  seedFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { setup: false, help: false };
  for (const arg of argv) {
    if (arg === "--setup") out.setup = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
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

  if (!args.baseUrl || !args.bearer) {
    process.stderr.write("--base-url and --bearer are required for --setup\n\n");
    printUsage();
    return 1;
  }

  process.stdout.write(`→ Provisioning Tier 3 fixtures against ${args.baseUrl}…\n`);
  try {
    const fixtures = await provisionFixtures({
      baseUrl: args.baseUrl,
      bearer: args.bearer,
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
