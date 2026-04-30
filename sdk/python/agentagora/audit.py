"""Audit log — local-first, signed, append-only records.

Each event chains via ``previous_event_hash`` to make the log
tamper-evident. The SDK stores logs under the configured ``audit_dir``
in JSON form; verification can run offline without contacting any
server.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ._internal.jcs import canonicalize
from .signing import Signature


@dataclass(frozen=True, slots=True)
class AuditEvent:
    event_id: str
    conversation_id: str
    type: str  # e.g., "aap.invocation.completed"
    timestamp: datetime
    actor_aid: str
    data: dict[str, Any]
    previous_event_hash: str | None
    signature: Signature

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "conversation_id": self.conversation_id,
            "type": self.type,
            "timestamp": self.timestamp.astimezone(timezone.utc).isoformat(
                timespec="milliseconds"
            ).replace("+00:00", "Z"),
            "actor_aid": self.actor_aid,
            "data": self.data,
            "previous_event_hash": self.previous_event_hash,
            "signature": self.signature.to_dict(),
        }

    def hash(self) -> str:
        """Content hash of the event (excluding signature value).

        Used as the ``previous_event_hash`` value of the next event.
        """
        d = self.to_dict()
        d["signature"] = {**d["signature"], "value": ""}
        return "sha256:" + hashlib.sha256(canonicalize(d)).hexdigest()


@dataclass
class AuditLog:
    conversation_id: str
    events: list[AuditEvent] = field(default_factory=list)

    def append(self, event: AuditEvent) -> None:
        if self.events and event.previous_event_hash != self.events[-1].hash():
            raise ValueError(
                f"event {event.event_id} previous_event_hash does not match log tail"
            )
        if self.events and event.conversation_id != self.conversation_id:
            raise ValueError("event conversation_id does not match log")
        self.events.append(event)

    def verify_chain(self) -> bool:
        prev: str | None = None
        for ev in self.events:
            if ev.previous_event_hash != prev:
                return False
            prev = ev.hash()
        return True

    def __iter__(self) -> Iterator[AuditEvent]:
        return iter(self.events)

    def write_jsonl(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            for ev in self.events:
                f.write(json.dumps(ev.to_dict(), ensure_ascii=False))
                f.write("\n")
