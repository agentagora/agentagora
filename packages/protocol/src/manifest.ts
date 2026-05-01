/**
 * Capability manifest — the document an agent publishes to declare
 * what it does, at what price, with what SLA.
 *
 * Mirrors AAP-spec section 4.
 */

import { z } from "zod";
import { MANIFEST_VERSION } from "./constants.js";
import { AidSchema } from "./identity.js";

/** Decimal amounts are encoded as strings (e.g., "0.50") to avoid float
 *  precision issues across language and runtime boundaries. */
const DecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'amount must match /^\\d+(\\.\\d+)?$/, e.g. "0.50"');

export const PricingModelSchema = z.enum(["free", "per_call", "per_token", "negotiated"]);

export type PricingModel = z.infer<typeof PricingModelSchema>;

export const PricingSchema = z
  .object({
    model: PricingModelSchema,
    amount: DecimalString.optional(),
    currency: z.string().min(1).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.model === "free") {
      if (p.amount !== undefined || p.currency !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "free pricing must omit amount and currency",
        });
      }
    } else if (p.amount === undefined || p.currency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${p.model} pricing requires amount and currency`,
      });
    }
  });

export type Pricing = z.infer<typeof PricingSchema>;

export const SLASchema = z.object({
  p50_ms: z.number().int().positive().optional(),
  p99_ms: z.number().int().positive().optional(),
  success_rate: z.number().min(0).max(1).optional(),
});

export type SLA = z.infer<typeof SLASchema>;

export const PrivacySchema = z.object({
  data_retention_days: z.number().int().min(0).default(7),
  pii_handling: z.enum(["store", "redact", "refuse"]).default("redact"),
  region_restriction: z.array(z.string().length(2)).default([]),
});

export type Privacy = z.infer<typeof PrivacySchema>;

/**
 * Capability input/output schemas are JSON Schema documents at the
 * wire level. We do not constrain them at the protocol layer — clients
 * use `ajv` or similar to validate.
 */
const JsonSchemaShape = z.record(z.unknown()).refine((v) => typeof v === "object" && v !== null, {
  message: "input_schema/output_schema must be a JSON Schema object",
});

export const CapabilitySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "capability name must be a valid identifier"),
    description: z.string().optional(),
    input_schema: JsonSchemaShape,
    output_schema: JsonSchemaShape,
    pricing: PricingSchema,
    sla: SLASchema.default({}),
    accepts: z.array(z.string()).default([]),
  })
  .superRefine((cap, ctx) => {
    if (cap.pricing.model !== "free" && cap.accepts.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accepts"],
        message: `paid capability ${JSON.stringify(cap.name)} must accept at least one settlement channel`,
      });
    }
  });

export type Capability = z.infer<typeof CapabilitySchema>;

export const EndpointsSchema = z.object({
  rpc: z.string().url(),
  events: z.string().url().optional(),
});

export type Endpoints = z.infer<typeof EndpointsSchema>;

export const ManifestMetadataSchema = z
  .object({
    tags: z.array(z.string()).default([]),
    languages: z.array(z.string()).default([]),
    models_used: z.array(z.string()).default([]),
  })
  .passthrough();

export type ManifestMetadata = z.infer<typeof ManifestMetadataSchema>;

export const ManifestSchema = z.object({
  manifest_version: z.literal(MANIFEST_VERSION),
  aid: AidSchema,
  description: z.string().optional(),
  homepage: z.string().url().optional(),
  contact: z.string().optional(),
  endpoints: EndpointsSchema,
  capabilities: z.array(CapabilitySchema).min(1),
  privacy: PrivacySchema.default({}),
  metadata: ManifestMetadataSchema.default({}),
});

export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Look up a capability by name. Throws if not present.
 */
export function getCapability(manifest: Manifest, name: string): Capability {
  const cap = manifest.capabilities.find((c) => c.name === name);
  if (!cap) {
    throw new Error(`capability not found: ${name}`);
  }
  return cap;
}
