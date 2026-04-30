"""Settlement channel abstraction and built-in implementations.

A settlement channel handles escrow, capture, and refund for
conversations. The two built-in channels in v0.1 are stubs; concrete
implementations land in M2 (Stripe) and M5 (USDC on Base) per the
PRD roadmap.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from typing import Any


@dataclass(frozen=True, slots=True)
class EscrowHandle:
    channel_id: str
    escrow_id: str
    payer_aid: str
    payee_aid: str
    amount: Decimal
    currency: str
    conversation_id: str
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class EscrowStatus:
    state: str  # "funded" | "captured" | "refunded" | "frozen"
    amount: Decimal
    currency: str
    last_event_at: str  # ISO 8601


class SettlementChannel(ABC):
    id: str  # set by subclass

    @abstractmethod
    async def escrow(
        self,
        payer_aid: str,
        payee_aid: str,
        amount: Decimal,
        currency: str,
        conversation_id: str,
    ) -> EscrowHandle: ...

    @abstractmethod
    async def capture(
        self,
        escrow: EscrowHandle,
        split: dict[str, Decimal] | None = None,
    ) -> str:
        """Release funds. Returns transaction id."""

    @abstractmethod
    async def refund(
        self,
        escrow: EscrowHandle,
        amount: Decimal | None = None,
    ) -> str:
        """Refund (partial allowed). Returns transaction id."""

    @abstractmethod
    async def status(self, escrow: EscrowHandle) -> EscrowStatus: ...


class StripeChannel(SettlementChannel):
    id = "stripe-fiat"

    def __init__(
        self,
        *,
        stripe_key: str,
        connect_account: str | None = None,
        currency: str = "USD",
    ) -> None:
        self.stripe_key = stripe_key
        self.connect_account = connect_account
        self.default_currency = currency

    @classmethod
    def from_env(cls) -> StripeChannel | None:
        import os

        key = os.environ.get("STRIPE_SECRET_KEY")
        if not key:
            return None
        return cls(
            stripe_key=key,
            connect_account=os.environ.get("STRIPE_CONNECT_ACCOUNT"),
            currency=os.environ.get("STRIPE_CURRENCY", "USD"),
        )

    async def escrow(self, *args: Any, **kwargs: Any) -> EscrowHandle:
        raise NotImplementedError("StripeChannel.escrow — implemented in M2")

    async def capture(self, *args: Any, **kwargs: Any) -> str:
        raise NotImplementedError("StripeChannel.capture — implemented in M2")

    async def refund(self, *args: Any, **kwargs: Any) -> str:
        raise NotImplementedError("StripeChannel.refund — implemented in M2")

    async def status(self, *args: Any, **kwargs: Any) -> EscrowStatus:
        raise NotImplementedError("StripeChannel.status — implemented in M2")


class UsdcBaseChannel(SettlementChannel):
    id = "usdc-base"

    def __init__(
        self,
        *,
        rpc_url: str,
        wallet_private_key: str,
        escrow_contract: str,
    ) -> None:
        self.rpc_url = rpc_url
        # NB: do not log this. Held in memory only.
        self._wallet_private_key = wallet_private_key
        self.escrow_contract = escrow_contract

    async def escrow(self, *args: Any, **kwargs: Any) -> EscrowHandle:
        raise NotImplementedError("UsdcBaseChannel.escrow — implemented in M5")

    async def capture(self, *args: Any, **kwargs: Any) -> str:
        raise NotImplementedError("UsdcBaseChannel.capture — implemented in M5")

    async def refund(self, *args: Any, **kwargs: Any) -> str:
        raise NotImplementedError("UsdcBaseChannel.refund — implemented in M5")

    async def status(self, *args: Any, **kwargs: Any) -> EscrowStatus:
        raise NotImplementedError("UsdcBaseChannel.status — implemented in M5")
