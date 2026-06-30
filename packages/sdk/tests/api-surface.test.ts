/**
 * API surface lock — guards the set of names re-exported from
 * `@agentagora/sdk`'s public entry point.
 *
 * Why: it's easy to accidentally remove or rename a public export
 * (a single deleted line in src/index.ts) and not notice. Public
 * exports are part of the package's contract — every removal /
 * rename is a breaking change that needs to land in CHANGELOG.md
 * with a major version bump.
 *
 * How to update: when an intentional public-API change is made,
 * run `pnpm --filter @agentagora/sdk test --update` (or interactively
 * accept the snapshot). The diff in the snapshot file should be
 * scrutinized in code review like any other contract change.
 */

import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";

describe("@agentagora/sdk public API surface", () => {
  it("exports a stable, snapshotted set of symbols", () => {
    const names = Object.keys(sdk).sort();
    expect(names).toMatchInlineSnapshot(`
      [
        "AAPError",
        "AAP_VERSION",
        "AgentAgoraClient",
        "AuditEventTypes",
        "AuditLog",
        "CallRefundedError",
        "CloudNonceTracker",
        "ConversationStatuses",
        "ErrorCodes",
        "EscrowFailedError",
        "HttpTransport",
        "InMemoryNonceTracker",
        "InMemoryRegistry",
        "InputInvalidError",
        "ManifestMismatchError",
        "ManifestSchema",
        "Methods",
        "MockTransport",
        "PaymentRequiredError",
        "RateLimitedError",
        "SLABreachError",
        "ScopeDeniedError",
        "SettlementChannels",
        "StaticEndpointResolver",
        "StripeChannel",
        "UnauthorizedError",
        "UsdcBaseChannel",
        "X402Channel",
        "b64uDecode",
        "b64uEncode",
        "canonicalizeForSigning",
        "capability",
        "cloudPayeeAccountResolver",
        "createAgent",
        "createStripeChannelFromKey",
        "formatAid",
        "generatePrivateKey",
        "hashEvent",
        "parseAid",
        "publicKeyFrom",
        "signAuditEvent",
        "signEnvelope",
        "stripeChannelFromEnv",
        "verifyAuditEvent",
        "verifyEnvelope",
      ]
    `);
  });
});
