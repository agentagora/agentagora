"""@agent class decorator and Agent base.

Decorating a class produces an Agent factory that, when instantiated
and ``serve()``-d, exposes its @capability methods over AAP.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, TypeVar

from .capability import CapabilityDescriptor, get_descriptor
from .manifest import Privacy

if TYPE_CHECKING:
    from .client import AgentAgoraClient

T = TypeVar("T", bound=type)


@dataclass
class _AgentConfig:
    name: str
    accepts: list[str]
    description: str | None
    privacy: Privacy
    tags: list[str]
    homepage: str | None
    contact: str | None
    capabilities: list[CapabilityDescriptor] = field(default_factory=list)


_AGENT_CONFIG_ATTR = "__aap_agent__"


def agent(
    client: AgentAgoraClient,
    *,
    name: str,
    description: str | None = None,
    accepts: list[str] | None = None,
    privacy: Privacy | None = None,
    tags: list[str] | None = None,
    homepage: str | None = None,
    contact: str | None = None,
) -> Callable[[T], T]:
    """Decorate a class to register it as an AAP agent.

    The decorated class gains a ``serve()`` and ``aserve()`` method
    via mixin into the Agent base. ``@capability`` methods on the
    class become callable AAP capabilities.
    """

    def wrap(cls: T) -> T:
        cfg = _AgentConfig(
            name=name,
            accepts=list(accepts) if accepts else ["stripe-fiat"],
            description=description or (cls.__doc__ or "").strip() or None,
            privacy=privacy or Privacy(),
            tags=list(tags) if tags else [],
            homepage=homepage,
            contact=contact,
        )
        for attr in dir(cls):
            if attr.startswith("_"):
                continue
            value = getattr(cls, attr)
            desc = get_descriptor(value)
            if desc is not None:
                cfg.capabilities.append(desc)
        if not cfg.capabilities:
            raise ValueError(
                f"class {cls.__name__!r} decorated with @agent has no @capability methods"
            )
        setattr(cls, _AGENT_CONFIG_ATTR, cfg)
        cls._aap_client = client
        if not issubclass(cls, Agent):
            cls = type(cls.__name__, (cls, Agent), {})  # type: ignore[assignment]
        return cls

    return wrap


class Agent:
    """Base behavior added to @agent-decorated classes."""

    _aap_client: AgentAgoraClient

    def serve(
        self,
        host: str = "0.0.0.0",
        port: int = 8080,
        **kwargs: Any,
    ) -> None:
        raise NotImplementedError("Agent.serve — implemented in M1")

    async def aserve(
        self,
        host: str = "0.0.0.0",
        port: int = 8080,
        **kwargs: Any,
    ) -> None:
        raise NotImplementedError("Agent.aserve — implemented in M1")

    def asgi_app(self) -> Callable[..., Any]:
        raise NotImplementedError("Agent.asgi_app — implemented in M1")

    def progress(self) -> Any:
        """Returns an async context manager for emitting progress events
        from inside a capability."""
        raise NotImplementedError("Agent.progress — implemented in M1")
