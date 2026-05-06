/**
 * JSON Schema export lock for the AAP wire protocol.
 *
 * Every Zod schema exported from `@agentagora/protocol` defines a
 * shape that crosses an organizational boundary — between the
 * TypeScript SDK, the cloud-api, the dashboard, the Python SDK
 * (forthcoming), and any third-party SDK that codegens types from
 * the JSON-Schema dump.
 *
 * This test produces a JSON-Schema rendering of every public Zod
 * schema using `zod-to-json-schema` and freezes the output via
 * `toMatchInlineSnapshot()`. Any change to a schema's structure
 * (renamed field, type change, added required key, removed optional)
 * shows up as a snapshot diff in the PR — making the wire-shape
 * change explicit instead of slipping through.
 *
 * How to update a snapshot. When you intentionally change a schema:
 *   pnpm --filter @agentagora/protocol test -u
 * Inspect the snapshot diff like any other contract change. If the
 * change is breaking for downstream SDKs, bump `AAP_VERSION` in
 * `src/constants.ts` and add a CHANGELOG entry. If non-breaking
 * (additive optional field), the snapshot still must be updated.
 *
 * Why JSON Schema and not just the Zod schema directly? JSON Schema
 * is the language-neutral wire-format spec. Python SDK / Rust SDK /
 * Go SDK can all consume `zod-to-json-schema(...)` output directly.
 * Locking the JSON Schema (rather than the Zod object identity) is
 * what catches a Zod refactor that preserves TS types but changes
 * the JSON wire shape (or vice versa).
 */

import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  AapEnvelopeMetaSchema,
  AidSchema,
  AuditEventSchema,
  CapabilitySchema,
  EndpointsSchema,
  IdentityCertificateClaimsSchema,
  ManifestMetadataSchema,
  ManifestSchema,
  PricingModelSchema,
  PricingSchema,
  PrivacySchema,
  RpcErrorResponseEnvelopeSchema,
  RpcErrorSchema,
  RpcRequestEnvelopeSchema,
  RpcResponseEnvelopeSchema,
  RpcSuccessResponseEnvelopeSchema,
  SLASchema,
  SignatureSchema,
} from "../src/index.js";

// Render with `target: "jsonSchema7"` (default) and pin the dialect
// so the output is deterministic across zod-to-json-schema patch
// bumps. `name` puts the schema under `definitions.<name>` and uses
// $ref for self-references — without it the output is harder to
// diff visually.
function render(schema: Parameters<typeof zodToJsonSchema>[0], name: string): unknown {
  return zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
  });
}

describe("@agentagora/protocol JSON Schema wire-shape lock", () => {
  // ── Identity ──────────────────────────────────────────────────────

  it("AidSchema (the AID URI shape)", () => {
    expect(render(AidSchema, "Aid")).toMatchInlineSnapshot(`
      {
        "$ref": "#/definitions/Aid",
        "$schema": "http://json-schema.org/draft-07/schema#",
        "definitions": {
          "Aid": {
            "pattern": "^aid:(?<registry>[A-Za-z0-9.\\-]+):(?<namespace>[A-Za-z0-9_\\-]+)\\/(?<name>[A-Za-z0-9_\\-]+)(?:#(?<fragment>[A-Za-z0-9_\\-.]+))?$",
            "type": "string",
          },
        },
      }
    `);
  });

  it("IdentityCertificateClaimsSchema (the OIDC certificate claim set)", () => {
    expect(
      render(IdentityCertificateClaimsSchema, "IdentityCertificateClaims"),
    ).toMatchInlineSnapshot(`
      {
        "$ref": "#/definitions/IdentityCertificateClaims",
        "$schema": "http://json-schema.org/draft-07/schema#",
        "definitions": {
          "IdentityCertificateClaims": {
            "additionalProperties": false,
            "properties": {
              "aap.did_placeholder": {
                "type": "string",
              },
              "aap.manifest_url": {
                "format": "uri",
                "type": "string",
              },
              "aap.owner": {
                "type": "string",
              },
              "aap.pubkey": {
                "type": "string",
              },
              "aap.scopes": {
                "items": {
                  "type": "string",
                },
                "type": "array",
              },
              "aap.settlement": {
                "additionalProperties": {},
                "type": "object",
              },
              "aud": {
                "type": "string",
              },
              "exp": {
                "type": "integer",
              },
              "iat": {
                "type": "integer",
              },
              "iss": {
                "format": "uri",
                "type": "string",
              },
              "sub": {
                "pattern": "^aid:(?<registry>[A-Za-z0-9.\\-]+):(?<namespace>[A-Za-z0-9_\\-]+)\\/(?<name>[A-Za-z0-9_\\-]+)(?:#(?<fragment>[A-Za-z0-9_\\-.]+))?$",
                "type": "string",
              },
            },
            "required": [
              "iss",
              "sub",
              "aud",
              "iat",
              "exp",
              "aap.owner",
              "aap.scopes",
              "aap.pubkey",
              "aap.manifest_url",
              "aap.settlement",
            ],
            "type": "object",
          },
        },
      }
    `);
  });

  // ── Manifest ──────────────────────────────────────────────────────

  it("ManifestSchema (top-level capability declaration)", () => {
    // The full manifest snapshot is large — we keep it inline so
    // diffs surface in PRs, but if the test file becomes unwieldy
    // we can move this to `__snapshots__/manifest.json` instead.
    expect(render(ManifestSchema, "Manifest")).toMatchSnapshot();
  });

  it("ManifestMetadataSchema (manifest envelope metadata)", () => {
    expect(render(ManifestMetadataSchema, "ManifestMetadata")).toMatchSnapshot();
  });

  it("CapabilitySchema (one capability entry)", () => {
    expect(render(CapabilitySchema, "Capability")).toMatchSnapshot();
  });

  it("EndpointsSchema (transport endpoints declaration)", () => {
    expect(render(EndpointsSchema, "Endpoints")).toMatchSnapshot();
  });

  it("PricingSchema (per-capability pricing block)", () => {
    expect(render(PricingSchema, "Pricing")).toMatchSnapshot();
  });

  it("PricingModelSchema (the discriminated-union of pricing flavours)", () => {
    expect(render(PricingModelSchema, "PricingModel")).toMatchSnapshot();
  });

  it("SLASchema (per-capability SLA declaration)", () => {
    expect(render(SLASchema, "SLA")).toMatchSnapshot();
  });

  it("PrivacySchema (privacy class)", () => {
    expect(render(PrivacySchema, "Privacy")).toMatchSnapshot();
  });

  it("SignatureSchema (detached signature shape)", () => {
    expect(render(SignatureSchema, "Signature")).toMatchSnapshot();
  });

  // ── Wire envelope ─────────────────────────────────────────────────

  it("AapEnvelopeMetaSchema (AAP-specific extension on JSON-RPC 2.0)", () => {
    expect(render(AapEnvelopeMetaSchema, "AapEnvelopeMeta")).toMatchSnapshot();
  });

  it("RpcRequestEnvelopeSchema (JSON-RPC 2.0 request)", () => {
    expect(render(RpcRequestEnvelopeSchema, "RpcRequestEnvelope")).toMatchSnapshot();
  });

  it("RpcResponseEnvelopeSchema (JSON-RPC 2.0 response, success | error)", () => {
    expect(render(RpcResponseEnvelopeSchema, "RpcResponseEnvelope")).toMatchSnapshot();
  });

  it("RpcSuccessResponseEnvelopeSchema (the success arm)", () => {
    expect(
      render(RpcSuccessResponseEnvelopeSchema, "RpcSuccessResponseEnvelope"),
    ).toMatchSnapshot();
  });

  it("RpcErrorResponseEnvelopeSchema (the error arm)", () => {
    expect(render(RpcErrorResponseEnvelopeSchema, "RpcErrorResponseEnvelope")).toMatchSnapshot();
  });

  it("RpcErrorSchema (the inner error object)", () => {
    expect(render(RpcErrorSchema, "RpcError")).toMatchSnapshot();
  });

  // ── Audit ─────────────────────────────────────────────────────────

  it("AuditEventSchema (one chained, signed audit log entry)", () => {
    expect(render(AuditEventSchema, "AuditEvent")).toMatchSnapshot();
  });
});
