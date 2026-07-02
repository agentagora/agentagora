/**
 * Local-first audit log.
 *
 * Each event chains via `previous_event_hash` to the previous event's
 * canonical bytes (excluding signature.value). This makes the log
 * tamper-evident: any retroactive edit invalidates every subsequent
 * hash.
 *
 * Storage of the log itself is delegated to a pluggable adapter so
 * the SDK works on Node (filesystem), Workers (KV / R2), and tests
 * (in-memory).
 */

import { Ap2, type AuditEvent, type MandatesBlock } from "@agentagora/protocol";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalizeForSigning, canonicalizeJson } from "./canonical.js";

/** Hash an event's canonical bytes (with signature.value cleared). */
export function hashEvent(event: AuditEvent): string {
  const cloned = JSON.parse(JSON.stringify(event)) as AuditEvent;
  cloned.signature = { ...cloned.signature, value: "" };
  const bytes = canonicalizeForSigning(cloned);
  const digest = sha256(bytes);
  return `sha256:${toHex(digest)}`;
}

/**
 * Hash an AP2 mandate's canonical bytes (v0.2). Recorded in audit events so
 * the tamper-evident chain proves which mandate authorized which step. Uses
 * RFC 8785 canonicalization WITHOUT the AAP float guard (mandates are opaque
 * third-party payloads whose untyped fields may carry JSON numbers), so a
 * verifier can always recompute the hash from the mandate carried on the
 * wire. Always hash the ORIGINAL wire object, never a schema-parsed copy.
 * See AAP-spec §6.5 / §9.6.
 */
export function hashMandate(mandate: unknown): string {
  const bytes = canonicalizeJson(mandate);
  const digest = sha256(bytes);
  return `sha256:${toHex(digest)}`;
}

/**
 * Canonical hashes of whichever AP2 mandates are present, keyed for an audit
 * event's `data` (`intent_mandate_hash`, `cart_mandate_hash`,
 * `payment_mandate_hash`). Shared by the initiator (client) and responder
 * (agent) so both bind the same hashes into their chains.
 */
export function mandateHashes(mandates: MandatesBlock | undefined): Record<string, string> {
  if (!mandates) return {};
  const out: Record<string, string> = {};
  const intent = mandates[Ap2.MandateKeys.Intent];
  const cart = mandates[Ap2.MandateKeys.Cart];
  const payment = mandates[Ap2.MandateKeys.Payment];
  if (intent) out.intent_mandate_hash = hashMandate(intent);
  if (cart) out.cart_mandate_hash = hashMandate(cart);
  if (payment) out.payment_mandate_hash = hashMandate(payment);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export class AuditLog {
  readonly conversationId: string;
  private readonly _events: AuditEvent[] = [];

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }

  get events(): readonly AuditEvent[] {
    return this._events;
  }

  /**
   * Append an event. Throws if it doesn't chain to the current tail
   * or if the conversation_id mismatches.
   */
  append(event: AuditEvent): void {
    if (event.conversation_id !== this.conversationId) {
      throw new Error(
        `event conversation_id ${event.conversation_id} does not match log ${this.conversationId}`,
      );
    }
    const expectedPrev =
      this._events.length === 0
        ? null
        : hashEvent(this._events[this._events.length - 1] as AuditEvent);
    if (event.previous_event_hash !== expectedPrev) {
      throw new Error(
        `event ${event.event_id} previous_event_hash mismatch: expected ${expectedPrev}, got ${event.previous_event_hash}`,
      );
    }
    this._events.push(event);
  }

  /** Verify the chain integrity end-to-end. */
  verifyChain(): boolean {
    let prev: string | null = null;
    for (const ev of this._events) {
      if (ev.previous_event_hash !== prev) return false;
      prev = hashEvent(ev);
    }
    return true;
  }
}
