/**
 * Stripe webhook signature verification.
 *
 * Stripe signs every webhook delivery with HMAC-SHA256 over
 * `${timestamp}.${rawBody}` using the endpoint secret. Header format:
 *
 *   Stripe-Signature: t=1700000000,v1=<hex>,v0=<hex>
 *
 * We verify the v1 signature plus a 5-minute timestamp window to
 * prevent replay. Stripe-node's library does the same; we hand-roll
 * with Web Crypto so the bundle stays Workers-friendly.
 */

const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  livemode: boolean;
  created: number;
}

export interface WebhookVerifier {
  /**
   * Verify the signature header against the raw request body and
   * return the parsed Stripe event. Throws on any failure (missing
   * header, malformed signature, expired timestamp, mismatched HMAC,
   * unparseable body) — callers turn that into HTTP 400/401.
   */
  verify(rawBody: string, signatureHeader: string | undefined): Promise<StripeEvent>;
}

export class HmacWebhookVerifier implements WebhookVerifier {
  constructor(
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verify(rawBody: string, signatureHeader: string | undefined): Promise<StripeEvent> {
    if (!signatureHeader) {
      throw new Error("missing Stripe-Signature header");
    }
    const parts = parseSignatureHeader(signatureHeader);
    if (parts.t === undefined) {
      throw new Error("malformed Stripe-Signature: missing t");
    }
    if (parts.v1.length === 0) {
      throw new Error("malformed Stripe-Signature: no v1 signatures");
    }

    const tsMs = parts.t * 1000;
    const nowMs = this.now().getTime();
    if (Math.abs(nowMs - tsMs) > SIGNATURE_TOLERANCE_MS) {
      throw new Error("Stripe webhook timestamp outside 5-minute tolerance");
    }

    const expected = await hmacSha256Hex(this.secret, `${parts.t}.${rawBody}`);
    const matched = parts.v1.some((sig) => constantTimeEqual(sig, expected));
    if (!matched) {
      throw new Error("Stripe webhook signature did not verify");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error("Stripe webhook body is not valid JSON");
    }
    if (!isStripeEvent(parsed)) {
      throw new Error("Stripe webhook body does not look like an Event");
    }
    return parsed;
  }
}

interface ParsedSignatureHeader {
  t?: number;
  v1: string[];
}

function parseSignatureHeader(header: string): ParsedSignatureHeader {
  const out: ParsedSignatureHeader = { v1: [] };
  for (const piece of header.split(",")) {
    const idx = piece.indexOf("=");
    if (idx <= 0) continue;
    const key = piece.slice(0, idx).trim();
    const value = piece.slice(idx + 1).trim();
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) out.t = n;
    } else if (key === "v1") {
      out.v1.push(value);
    }
  }
  return out;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isStripeEvent(value: unknown): value is StripeEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.type === "string" &&
    typeof v.created === "number" &&
    typeof v.livemode === "boolean" &&
    !!v.data &&
    typeof v.data === "object" &&
    !!(v.data as Record<string, unknown>).object &&
    typeof (v.data as Record<string, unknown>).object === "object"
  );
}
