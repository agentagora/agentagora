/**
 * Agent Identity (AID).
 *
 * URI form per AAP-spec section 3.1:
 *
 *     aid:<registry>:<namespace>/<name>[#<fragment>]
 *
 * Examples:
 *   aid:agentagora:weijt606/code-review
 *   aid:agentagora:acme-corp/procurement#v2
 *   aid:registry.example.com:ops/incident-bot
 */

import { z } from "zod";

const AID_REGEX =
  /^aid:(?<registry>[A-Za-z0-9.\-]+):(?<namespace>[A-Za-z0-9_\-]+)\/(?<name>[A-Za-z0-9_\-]+)(?:#(?<fragment>[A-Za-z0-9_\-.]+))?$/;

/** Branded AID string — passes type-checking only via `parseAid`/`AidString.parse`. */
export type AidString = string & { readonly __brand: "AID" };

export interface ParsedAid {
  readonly registry: string;
  readonly namespace: string;
  readonly name: string;
  readonly fragment?: string;
}

/** Zod schema rejecting any string that isn't a syntactically valid AID. */
export const AidSchema = z
  .string()
  .regex(AID_REGEX, "invalid AID; expected aid:<registry>:<namespace>/<name>[#<fragment>]")
  .transform((s) => s as AidString);

export function parseAid(value: string): ParsedAid {
  const m = AID_REGEX.exec(value);
  if (!m?.groups) {
    throw new Error(`invalid AID: ${value}`);
  }
  const { registry, namespace, name, fragment } = m.groups as {
    registry: string;
    namespace: string;
    name: string;
    fragment?: string;
  };
  return fragment !== undefined
    ? { registry, namespace, name, fragment }
    : { registry, namespace, name };
}

export function formatAid(parsed: ParsedAid): AidString {
  const base = `aid:${parsed.registry}:${parsed.namespace}/${parsed.name}`;
  return (parsed.fragment ? `${base}#${parsed.fragment}` : base) as AidString;
}

export function isPublicRegistry(parsed: ParsedAid): boolean {
  return parsed.registry === "agentagora";
}

/**
 * Identity Certificate claims (the JWT payload issued by the registry).
 * Mirrors AAP-spec section 3.2.
 *
 * Note: signature verification of the JWT itself happens in the SDK
 * (using `jose` against the registry's JWKS). This schema validates
 * only the *decoded* payload shape.
 */
export const IdentityCertificateClaimsSchema = z.object({
  iss: z.string().url(),
  sub: AidSchema,
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  "aap.owner": z.string(),
  "aap.scopes": z.array(z.string()),
  "aap.pubkey": z.string(), // base64url-encoded Ed25519 public key
  "aap.manifest_url": z.string().url(),
  "aap.settlement": z.record(z.unknown()),
  "aap.did_placeholder": z.string().optional(),
});

export type IdentityCertificateClaims = z.infer<typeof IdentityCertificateClaimsSchema>;
