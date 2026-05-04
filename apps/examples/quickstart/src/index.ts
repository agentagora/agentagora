/**
 * Your first AgentAgora agent — minimal end-to-end demo.
 *
 * One greeter agent, one caller, one process, no network. Run with:
 *
 *   pnpm --filter @agentagora/example-quickstart demo
 *
 * For a real HTTP listener instead of MockTransport, see
 * apps/examples/two-agents. For Cloudflare Workers, see
 * apps/examples/worker-agent.
 */

// ── Imports ────────────────────────────────────────────────────────────
import { AgentAgoraClient } from "@agentagora/sdk"; // outbound caller (signs requests)
import { InMemoryRegistry } from "@agentagora/sdk"; // AID → Ed25519 public key map
import { MockTransport } from "@agentagora/sdk"; // in-process transport (no HTTP)
import { b64uEncode } from "@agentagora/sdk"; // base64url for printing keys
import { capability, createAgent } from "@agentagora/sdk"; // define agent + capabilities
import { generatePrivateKey, publicKeyFrom } from "@agentagora/sdk"; // Ed25519 keygen
import { AAPError } from "@agentagora/sdk"; // typed error class for the failure demo
import { z } from "zod"; // input/output schemas, validated at runtime

const trunc = (s: string) => `${s.slice(0, 12)}…${s.slice(-6)}`;
const sep = (label: string) => console.log(`\n── ${label} ${"─".repeat(50 - label.length)}`);

async function main() {
  // ── Section 1: Define the greeter ───────────────────────────────────
  // createAgent returns an Agent with a stable AID built from namespace + name.
  // Each capability is a Zod-validated input/output pair plus a handler.
  const greeter = createAgent({
    name: "greeter",
    namespace: "demo",
    description: "Says hello to whoever asks.",
    capabilities: {
      greet: capability({
        input: z.object({ name: z.string() }),
        output: z.object({ message: z.string() }),
        price: { model: "free" },
        handler: ({ name }) => ({ message: `Hello, ${name}!` }),
      }),
    },
  });

  // ── Section 2: Generate signing keys ────────────────────────────────
  // Every AAP envelope is Ed25519-signed. The greeter signs responses;
  // the caller signs requests. The registry maps each AID to its pubkey.
  const greeterKey = generatePrivateKey();
  const greeterPub = await publicKeyFrom(greeterKey);
  sep("identity");
  console.log(`greeter aid:    ${greeter.aid}`);
  console.log(`greeter pubkey: ${trunc(b64uEncode(greeterPub))} (base64url, truncated)`);

  // ── Section 3: Wire the in-process transport ────────────────────────
  // MockTransport routes envelopes by AID inside this Node process —
  // identical sign/verify pipeline as HttpTransport, just no socket.
  const transport = new MockTransport();
  const registry = new InMemoryRegistry();
  registry.register(greeter.aid, greeterPub);
  await greeter.serve({
    transport,
    registry,
    signingKey: greeterKey,
    signingKeyId: `${greeter.aid}#k1`,
  });

  // ── Section 4: Build a client and call greet() ──────────────────────
  // The caller is itself an AID-bearing party. Its key is registered so
  // the greeter can verify its inbound request signature.
  const callerAid = "aid:agentagora:demo/caller";
  const callerKey = generatePrivateKey();
  registry.register(callerAid, await publicKeyFrom(callerKey));
  const client = new AgentAgoraClient({
    token: "demo",
    transport,
    registryResolver: registry,
    fromAid: callerAid,
    signingKey: callerKey,
    signingKeyId: `${callerAid}#k1`,
  });

  sep("call");
  const conv = await client.callRich(greeter.aid, "greet", { name: "world" });
  console.log(`status:          ${conv.status}`);
  console.log(`result:          ${JSON.stringify(conv.result)}`);
  console.log(`conversation_id: ${conv.id}`);

  // ── Section 5: Failure path — signature verification ────────────────
  // Build a second client whose registry has a *wrong* pubkey for the
  // greeter. The greeter still signs with its real key, so the client's
  // response-signature check trips and throws AAPError(Unauthorized).
  // This is the property the audit chain ultimately rests on.
  sep("signature failure demo");
  const liarRegistry = new InMemoryRegistry();
  liarRegistry.register(greeter.aid, await publicKeyFrom(generatePrivateKey())); // wrong key on purpose
  liarRegistry.register(callerAid, await publicKeyFrom(callerKey));
  const skepticalClient = new AgentAgoraClient({
    token: "demo",
    transport,
    registryResolver: liarRegistry,
    fromAid: callerAid,
    signingKey: callerKey,
    signingKeyId: `${callerAid}#k1`,
  });
  try {
    await skepticalClient.call(greeter.aid, "greet", { name: "world" });
    console.log("unexpected: call succeeded with a wrong pubkey");
  } catch (err) {
    if (err instanceof AAPError) {
      console.log(`rejected as expected: ${err.code} — ${err.message}`);
    } else {
      throw err;
    }
  }

  sep("done");
  process.exit(0);
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
