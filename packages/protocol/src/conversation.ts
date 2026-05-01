/**
 * Conversation FSM states. Mirrors AAP-spec section 7.
 *
 * Implementations are responsible for enforcing legal transitions;
 * the protocol package only declares the type space.
 */

export const ConversationStatuses = {
  Initiated: "initiated",
  Accepted: "accepted",
  Executing: "executing",
  Completed: "completed",
  Settled: "settled",
  Disputed: "disputed",
  Resolved: "resolved",
  Archived: "archived",
  Cancelled: "cancelled",
} as const;

export type ConversationStatus = (typeof ConversationStatuses)[keyof typeof ConversationStatuses];

/** Legal transitions per spec section 7. Used by validators. */
export const LegalTransitions: Record<ConversationStatus, readonly ConversationStatus[]> = {
  initiated: ["accepted", "cancelled"],
  accepted: ["executing", "cancelled", "disputed"],
  executing: ["completed", "disputed"],
  completed: ["settled", "disputed"],
  settled: ["archived"],
  disputed: ["resolved"],
  resolved: ["archived"],
  archived: [],
  cancelled: ["archived"],
};

export function canTransition(from: ConversationStatus, to: ConversationStatus): boolean {
  return LegalTransitions[from].includes(to);
}
