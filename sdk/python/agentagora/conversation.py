"""Conversation types — the SDK's view of an in-flight or archived
AAP conversation.

The state machine here mirrors AAP-spec section 7. Most users do not
construct Conversation directly; it is produced by
``AgentAgoraClient.call_rich`` and ``conversations()``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any


class ConversationStatus(str, Enum):
    INITIATED = "initiated"
    ACCEPTED = "accepted"
    EXECUTING = "executing"
    COMPLETED = "completed"
    SETTLED = "settled"
    DISPUTED = "disputed"
    RESOLVED = "resolved"
    ARCHIVED = "archived"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class Progress:
    percent: int
    message: str
    checkpoint: dict[str, Any] | None = None


@dataclass
class Conversation:
    id: str
    initiator: str  # AID string
    responder: str  # AID string
    capability: str
    status: ConversationStatus
    started_at: datetime
    ended_at: datetime | None = None
    price: Decimal | None = None
    currency: str | None = None
    channel: str | None = None
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None

    async def acknowledge(self) -> None:
        raise NotImplementedError("Conversation.acknowledge — implemented in M1")

    async def dispute(
        self, reason: str, evidence_event_ids: list[str] | None = None
    ) -> Dispute:
        raise NotImplementedError("Conversation.dispute — implemented in M1")

    async def cancel(self, reason: str | None = None) -> None:
        raise NotImplementedError("Conversation.cancel — implemented in M1")


@dataclass
class Dispute:
    id: str
    conversation_id: str
    opened_by: str
    reason: str
    status: str  # "open" | "resolved"
    resolution: dict[str, Any] | None = None
