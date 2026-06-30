/**
 * API surface lock — guards the set of names re-exported from
 * `@agentagora/protocol`'s public entry point.
 *
 * Why: every export is part of the protocol package's contract,
 * relied on across the SDK, future Cloud Platform, future Dashboard,
 * and any third-party SDK. Removals/renames are breaking changes.
 *
 * How to update: when an intentional public-API change is made,
 * accept the new snapshot interactively or with
 * `pnpm --filter @agentagora/protocol test -u`. Scrutinize the
 * diff in code review like any other contract change.
 */

import { describe, expect, it } from "vitest";
import * as protocol from "../src/index.js";

describe("@agentagora/protocol public API surface", () => {
  it("exports a stable, snapshotted set of symbols", () => {
    const names = Object.keys(protocol).sort();
    expect(names).toMatchInlineSnapshot(`
      [
        "AAP_VERSION",
        "AapEnvelopeMetaSchema",
        "AidSchema",
        "AmountSchema",
        "Ap2",
        "AuditEventSchema",
        "AuditEventTypes",
        "CapabilitySchema",
        "CartMandateSchema",
        "ConversationStatuses",
        "DisplayItemSchema",
        "EndpointsSchema",
        "ErrorCodes",
        "ErrorNames",
        "IdentityCertificateClaimsSchema",
        "IntentMandateSchema",
        "LegalTransitions",
        "MANIFEST_VERSION",
        "MandatesBlockSchema",
        "ManifestMetadataSchema",
        "ManifestSchema",
        "Methods",
        "PaymentMandateSchema",
        "PaymentRequestSchema",
        "PricingModelSchema",
        "PricingSchema",
        "PrivacySchema",
        "RpcErrorResponseEnvelopeSchema",
        "RpcErrorSchema",
        "RpcRequestEnvelopeSchema",
        "RpcResponseEnvelopeSchema",
        "RpcSuccessResponseEnvelopeSchema",
        "SLASchema",
        "SUPPORTED_AAP_VERSIONS",
        "SettlementChannels",
        "SignatureSchema",
        "VcProofSchema",
        "canTransition",
        "formatAid",
        "getCapability",
        "isPublicRegistry",
        "makeRpcError",
        "parseAid",
      ]
    `);
  });
});
