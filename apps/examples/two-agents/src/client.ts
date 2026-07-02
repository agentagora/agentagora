/**
 * Golden-path demo, initiator side ("Alice").
 *
 * The MVP loop, end to end, against a running cloud-api + demo:server:
 *
 *   1. Alice publishes her identity (so the registry pins her pubkey and
 *      the cloud accepts her audit events)
 *   2. Alice DISCOVERS Bob via the registry — pubkey verified through the
 *      registry-signed identity certificate, endpoint from his manifest
 *   3. Alice calls Bob's free `ping`; with STRIPE_SECRET_KEY set she also
 *      calls the paid `fortune` with escrow → capture on Stripe
 *   4. Alice's audit chain is pushed to the cloud; the conversation is
 *      then visible in the dashboard for both owners
 *
 * Run (with demo:server already up):
 *
 *   export AGENTAGORA_TOKEN=<owner token from local-dev seed>
 *   pnpm --filter @agentagora/example-two-agents demo:client
 */

import {
  AgentAgoraClient,
  type AidString,
  CloudAuditSink,
  HttpRegistry,
  HttpTransport,
  b64uEncode,
  cloudPayeeAccountResolver,
  createStripeChannelFromKey,
  publicKeyFrom,
  publishAgent,
} from "@agentagora/sdk";
import { CLOUD_URL, loadOrCreateKey, requireOwnerToken, sep } from "./_shared.js";

const BOB_AID = process.env.AGENTAGORA_BOB_AID ?? "aid:agentagora:bob/echo";
const ALICE_AID = "aid:agentagora:alice/orchestrator";

async function main() {
  sep("alice: identity");
  const ownerToken = requireOwnerToken();
  const aliceKey = loadOrCreateKey(new URL("../.alice.key", import.meta.url).pathname);
  console.log(`alice pubkey: ${b64uEncode(await publicKeyFrom(aliceKey)).slice(0, 12)}…`);

  // Alice publishes an identity-only manifest: she serves nothing, but the
  // registry's TOFU pubkey pin is what lets the cloud verify + accept her
  // audit events (and lets Bob verify her request signatures).
  await publishAgent({
    baseUrl: CLOUD_URL,
    ownerToken,
    privateKey: aliceKey,
    manifest: {
      manifest_version: 1,
      aid: ALICE_AID as AidString,
      description: "Initiator half of the golden-path demo (identity only, serves nothing).",
      endpoints: { rpc: "http://127.0.0.1:9/unserved" },
      capabilities: [
        {
          name: "noop",
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          pricing: { model: "free" },
          sla: {},
          accepts: [],
        },
      ],
      privacy: { data_retention_days: 7, pii_handling: "redact", region_restriction: [] },
      metadata: { tags: ["demo"], languages: ["en"], models_used: [] },
    },
  });
  console.log(`published: ${ALICE_AID}`);

  sep("alice: discover bob via registry");
  const registry = new HttpRegistry({ baseUrl: CLOUD_URL });
  const bob = await registry.resolveAgent(BOB_AID);
  console.log(`resolved ${bob.aid}`);
  console.log(`  endpoint: ${bob.endpoint}`);
  console.log(`  pubkey (JWKS-verified cert): ${b64uEncode(bob.pubkey).slice(0, 12)}…`);
  for (const cap of bob.manifest.capabilities) {
    const price =
      cap.pricing.model === "free"
        ? "free"
        : `${cap.pricing.amount} ${cap.pricing.currency} ${cap.pricing.model}`;
    console.log(`  capability: ${cap.name} (${price})`);
  }

  sep("alice: call bob");
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const settlement = stripeKey
    ? [
        await createStripeChannelFromKey({
          stripeKey,
          payeeAccountResolver: cloudPayeeAccountResolver(CLOUD_URL),
        }),
      ]
    : undefined;

  const client = new AgentAgoraClient({
    token: ownerToken,
    registry: CLOUD_URL,
    transport: new HttpTransport({ endpointResolver: registry }),
    registryResolver: registry,
    fromAid: ALICE_AID,
    signingKey: aliceKey,
    signingKeyId: `${ALICE_AID}#k1`,
    settlement,
  });

  const conv = await client.callRich(BOB_AID, "ping", { message: "hello from the MVP loop" });
  console.log(`ping → ${JSON.stringify(conv.result)}   [status: ${conv.status}]`);

  let paidConv: typeof conv | undefined;
  if (settlement) {
    paidConv = await client.callRich(
      BOB_AID,
      "fortune",
      { topic: "escrow" },
      { pay: { amount: "0.50", currency: "USD", channel: "stripe-fiat" } },
    );
    console.log(`fortune → ${JSON.stringify(paidConv.result)}   [status: ${paidConv.status}]`);
  } else {
    console.log("(STRIPE_SECRET_KEY not set — skipping the paid `fortune` call;");
    console.log(" set it to see escrow → capture with audit events on both sides)");
  }

  sep("alice: push audit chains to the cloud");
  const sink = new CloudAuditSink({ baseUrl: CLOUD_URL });
  for (const c of [conv, paidConv].filter(Boolean) as (typeof conv)[]) {
    const { pushed } = await sink.sync(c.audit);
    console.log(`conversation ${c.id}: pushed ${pushed} audit event(s)`);
    console.log(`  chain verifies locally: ${c.audit.verifyChain()}`);
    console.log(`  dashboard: <dashboard-url>/conversations/${encodeURIComponent(c.id)}`);
  }

  console.log("\ndone — both owners can now see this conversation in the dashboard.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
