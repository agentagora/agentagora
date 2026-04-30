"""Top-level client.

A single AgentAgoraClient instance is the SDK entry point: it owns
the owner OIDC token, the agent signing key, the registry pointer, the
configured settlement channels, and the local audit directory.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .conversation import Conversation, ConversationStatus, Progress
from .identity import KeyStore
from .registry import AgentSummary, ResolvedAgent
from .settlement import SettlementChannel


@dataclass
class SpendCap:
    daily_usd: Decimal | None = None
    monthly_usd: Decimal | None = None


class AgentAgoraClient:
    """Client for calling and exposing AAP agents.

    Most apps construct one instance per process via ``from_env()``.
    """

    def __init__(
        self,
        token: str,
        *,
        registry: str = "https://agentagora.ai",
        signing_key: Ed25519PrivateKey | str | Path | None = None,
        settlement: list[SettlementChannel] | None = None,
        audit_dir: Path | str = "~/.agentagora/audit",
        timeout: float = 30.0,
        spend_cap: SpendCap | None = None,
    ) -> None:
        self._token = token
        self.registry = registry.rstrip("/")
        self.audit_dir = Path(audit_dir).expanduser()
        self.timeout = timeout
        self.spend_cap = spend_cap or SpendCap()
        self.settlement: list[SettlementChannel] = list(settlement) if settlement else []
        self._signing_key = self._coerce_key(signing_key)

    @staticmethod
    def _coerce_key(
        key: Ed25519PrivateKey | str | Path | None,
    ) -> Ed25519PrivateKey | None:
        if key is None:
            return None
        if isinstance(key, Ed25519PrivateKey):
            return key
        if isinstance(key, (str, Path)):
            return KeyStore().load(str(key))
        raise TypeError(f"unsupported signing_key type: {type(key).__name__}")

    @classmethod
    def from_env(cls) -> AgentAgoraClient:
        """Construct from environment variables.

        Recognized vars:
          AGENTAGORA_TOKEN     — OIDC bearer for the owner (required)
          AGENTAGORA_REGISTRY  — registry base URL
          AGENTAGORA_AUDIT_DIR — local audit log directory
        """
        token = os.environ.get("AGENTAGORA_TOKEN")
        if not token:
            raise RuntimeError(
                "AGENTAGORA_TOKEN is not set. Run `agentagora login` or set it explicitly."
            )
        kwargs: dict[str, Any] = {"token": token}
        if reg := os.environ.get("AGENTAGORA_REGISTRY"):
            kwargs["registry"] = reg
        if audit := os.environ.get("AGENTAGORA_AUDIT_DIR"):
            kwargs["audit_dir"] = audit
        return cls(**kwargs)

    # ----- Calling agents -----

    async def call(
        self,
        aid: str,
        capability: str,
        *,
        timeout: float | None = None,
        max_price: Decimal | str | None = None,
        channel: str | None = None,
        on_progress: Callable[[Progress], None] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        raise NotImplementedError("AgentAgoraClient.call — implemented in M1")

    def call_sync(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        import asyncio

        return asyncio.run(self.call(*args, **kwargs))

    async def call_rich(
        self, aid: str, capability: str, **kwargs: Any
    ) -> Conversation:
        raise NotImplementedError("AgentAgoraClient.call_rich — implemented in M1")

    def call_stream(
        self, aid: str, capability: str, **kwargs: Any
    ) -> AsyncIterator[Any]:
        raise NotImplementedError("AgentAgoraClient.call_stream — implemented in M1")

    # ----- Discovery -----

    async def resolve(self, aid: str) -> ResolvedAgent:
        from . import registry

        return await registry.resolve(aid, registry_url=self.registry)

    async def search(
        self,
        *,
        capability: str | None = None,
        tags: list[str] | None = None,
        accepts: list[str] | None = None,
        max_price: Decimal | str | None = None,
    ) -> list[AgentSummary]:
        from . import registry

        return await registry.search(
            capability=capability,
            tags=tags,
            accepts=accepts,
            max_price=str(max_price) if max_price is not None else None,
            registry_url=self.registry,
        )

    # ----- Owner-facing -----

    def conversations(
        self,
        *,
        since: datetime | None = None,
        status: ConversationStatus | None = None,
    ) -> Iterator[Conversation]:
        raise NotImplementedError("AgentAgoraClient.conversations — implemented in M1")

    def revoke(self, target_aid: str) -> None:
        raise NotImplementedError("AgentAgoraClient.revoke — implemented in M1")

    def revoke_all(self) -> None:
        raise NotImplementedError("AgentAgoraClient.revoke_all — implemented in M1")

    def rotate_key(self, agent_name: str) -> None:
        raise NotImplementedError("AgentAgoraClient.rotate_key — implemented in M1")

    # ----- Lifecycle -----

    async def aclose(self) -> None:
        return None

    def close(self) -> None:
        return None
