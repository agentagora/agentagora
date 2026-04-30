"""@capability decorator and CapabilityDescriptor.

Decorating a coroutine method on an @agent-decorated class declares it
as a callable capability. Pricing, SLA, and schemas are derived from
type hints (via Pydantic) and decorator arguments.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

_CAPABILITY_ATTR = "__aap_capability__"


@dataclass
class CapabilityDescriptor:
    name: str
    func: Callable[..., Any]
    description: str | None = None
    price_amount: Decimal | None = None
    price_currency: str | None = None
    price_model: str = "per_call"  # per_call | per_token | negotiated | free
    sla_p50_ms: int | None = None
    sla_p99_ms: int | None = None
    success_rate: float | None = None
    extras: dict[str, Any] = field(default_factory=dict)


def _parse_price(price: str | Decimal | None) -> tuple[str, Decimal | None, str | None]:
    """Return (model, amount, currency)."""
    if price is None:
        return "per_call", None, None
    if isinstance(price, str):
        if price.strip().lower() == "free":
            return "free", None, None
        parts = price.strip().split()
        if len(parts) != 2:
            raise ValueError(
                f'price must be of the form "<amount> <currency>" or "free", got {price!r}'
            )
        amount_str, currency = parts
        return "per_call", Decimal(amount_str), currency.upper()
    if isinstance(price, Decimal):
        return "per_call", price, "USD"
    raise TypeError(f"unsupported price type: {type(price).__name__}")


def capability(
    *,
    name: str | None = None,
    description: str | None = None,
    price: str | Decimal | None = None,
    sla_p50_ms: int | None = None,
    sla_p99_ms: int | None = None,
    success_rate: float | None = None,
) -> Callable[[F], F]:
    """Decorator marking a method as an exposed AAP capability."""

    def wrap(func: F) -> F:
        model, amount, currency = _parse_price(price)
        desc = CapabilityDescriptor(
            name=name or func.__name__,
            func=func,
            description=description or (func.__doc__ or "").strip() or None,
            price_amount=amount,
            price_currency=currency,
            price_model=model,
            sla_p50_ms=sla_p50_ms,
            sla_p99_ms=sla_p99_ms,
            success_rate=success_rate,
        )
        setattr(func, _CAPABILITY_ATTR, desc)
        return func

    return wrap


def get_descriptor(func: Callable[..., Any]) -> CapabilityDescriptor | None:
    return getattr(func, _CAPABILITY_ATTR, None)
