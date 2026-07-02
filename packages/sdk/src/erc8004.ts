/**
 * ERC-8004 reputation bridge (M7-lite, write path) — see
 * `docs/AAP-interop-positioning.md` §3.
 *
 * Builds the OFF-CHAIN feedback file for ERC-8004's Reputation Registry
 * `giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint,
 * feedbackURI, feedbackHash)`, embedding AAP's audit evidence: the
 * conversation id, the initiator chain's head hash, any mandate hashes,
 * and an optional settlement proof. ERC-8004's off-chain schema already
 * reserves fields for A2A task ids and x402 `proofOfPayment`, so AAP
 * evidence slots in natively — star ratings backed by cryptographic
 * receipts.
 *
 * Deliberately NO chain client here: this module produces the file, its
 * keccak-256 `feedbackHash`, and the suggested on-chain call args. The
 * caller hosts the file (the `feedbackURI`) and submits the transaction
 * with their own wallet tooling. Submit from the INITIATOR's address —
 * ERC-8004 forbids feedback from the agent's own owner/operator.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { type AuditLog, hashEvent } from "./audit.js";

export interface Erc8004FeedbackOptions {
  /** The initiator's local audit log for the settled conversation. */
  log: AuditLog;
  /** The responder's ERC-8004 agentId (from its Identity Registry entry). */
  agentId: bigint | number | string;
  /** Score 0–100 (mirrors `aap.feedback.recorded`'s score). */
  score: number;
  /** The initiator's address that will submit `giveFeedback`. */
  clientAddress: string;
  /** Identity Registry ref, e.g. "eip155:1:0x…". */
  agentRegistry?: string;
  /** Capability name — becomes `tag1`. */
  capability?: string;
  tag2?: string;
  /** The responder's AAP RPC endpoint (ERC-8004 `endpoint` arg). */
  endpoint?: string;
  /** e.g. an x402/onchain settlement tx reference. */
  proofOfPayment?: Record<string, unknown>;
  /** ISO 8601; defaults to now. */
  createdAt?: string;
}

export interface Erc8004Feedback {
  /** The off-chain feedback JSON to host at your `feedbackURI`. */
  file: Record<string, unknown>;
  /** keccak-256 of the canonical file bytes — the `feedbackHash` call arg. */
  feedbackHashHex: `0x${string}`;
  /** Suggested args for `giveFeedback` (fill in `feedbackURI` after hosting the file). */
  suggestedArgs: {
    agentId: string;
    value: number;
    valueDecimals: 0;
    tag1: string;
    tag2: string;
    endpoint: string;
  };
}

/** Build the ERC-8004 off-chain feedback file from an AAP conversation. */
export function buildErc8004Feedback(options: Erc8004FeedbackOptions): Erc8004Feedback {
  if (!Number.isInteger(options.score) || options.score < 0 || options.score > 100) {
    throw new Error("buildErc8004Feedback: score must be an integer 0–100");
  }
  const events = options.log.events;
  if (events.length === 0) {
    throw new Error("buildErc8004Feedback: audit log is empty");
  }
  const head = events[events.length - 1] as NonNullable<(typeof events)[number]>;

  // Collect the evidence the chain already carries.
  const mandateHashes: Record<string, string> = {};
  for (const ev of events) {
    for (const k of ["intent_mandate_hash", "cart_mandate_hash", "payment_mandate_hash"]) {
      const v = ev.data[k];
      if (typeof v === "string") mandateHashes[k] = v;
    }
  }

  const file: Record<string, unknown> = {
    // ERC-8004 off-chain schema, mandatory fields.
    ...(options.agentRegistry ? { agentRegistry: options.agentRegistry } : {}),
    agentId: String(options.agentId),
    clientAddress: options.clientAddress,
    createdAt: options.createdAt ?? new Date().toISOString(),
    value: options.score,
    valueDecimals: 0,
    // AAP evidence — verifiable against the ingested audit chain.
    aap: {
      conversation_id: options.log.conversationId,
      chain_head_hash: hashEvent(head),
      event_count: events.length,
      actor_aid: head.actor_aid,
      ...(Object.keys(mandateHashes).length > 0 ? { mandate_hashes: mandateHashes } : {}),
    },
    ...(options.proofOfPayment ? { proofOfPayment: options.proofOfPayment } : {}),
  };

  const bytes = new TextEncoder().encode(JSON.stringify(file));
  const feedbackHashHex = `0x${toHex(keccak_256(bytes))}` as const;

  return {
    file,
    feedbackHashHex,
    suggestedArgs: {
      agentId: String(options.agentId),
      value: options.score,
      valueDecimals: 0,
      tag1: options.capability ?? "",
      tag2: options.tag2 ?? "",
      endpoint: options.endpoint ?? "",
    },
  };
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
