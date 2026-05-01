/**
 * Audit event — signed, append-only records that form the
 * tamper-evident log of a conversation.
 *
 * Mirrors AAP-spec section 8.1.
 */

import { z } from "zod";
import { SignatureSchema } from "./envelope.js";
import { AidSchema } from "./identity.js";

export const AuditEventSchema = z.object({
  event_id: z.string().min(1),
  conversation_id: z.string().min(1),
  type: z.string().min(1), // one of AuditEventTypes; not constrained at wire level for forward compat
  /** ISO 8601 with millisecond precision and 'Z' suffix. */
  timestamp: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "expected ISO 8601 .NNNZ"),
  actor_aid: AidSchema,
  /** SHA-256 of the previous event's canonical bytes (excluding its
   *  signature.value). null for the first event in a conversation. */
  previous_event_hash: z.string().nullable(),
  data: z.record(z.unknown()).default({}),
  signature: SignatureSchema,
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
