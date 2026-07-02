/**
 * Shared helpers for the split server/client golden-path demo.
 *
 * Key persistence matters here: the registry TOFU-pins an AID's signing
 * key on first publish, so regenerating a key every run would make the
 * second `publishAgent` fail with 403. Keys live in gitignored dotfiles
 * next to this example.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { b64uDecode, b64uEncode, generatePrivateKey } from "@agentagora/sdk";

export const CLOUD_URL = process.env.AGENTAGORA_CLOUD_URL ?? "http://localhost:8787";

export function requireOwnerToken(): string {
  const token = process.env.AGENTAGORA_TOKEN;
  if (!token) {
    console.error(
      "AGENTAGORA_TOKEN is not set. Use one of the owner tokens seeded by docs/local-dev.md, e.g.:\n" +
        "  export AGENTAGORA_TOKEN=<token>",
    );
    process.exit(1);
  }
  return token;
}

/** Load an Ed25519 key from `path`, or generate + persist one (0600). */
export function loadOrCreateKey(path: string): Uint8Array {
  if (existsSync(path)) {
    return b64uDecode(readFileSync(path, "utf-8").trim());
  }
  const key = generatePrivateKey();
  writeFileSync(path, b64uEncode(key), { mode: 0o600 });
  console.log(`generated new signing key → ${path} (delete it to rotate — note the TOFU pin)`);
  return key;
}

export const sep = (label: string) =>
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length - 4))}`);
