"""AID resolver and registry client.

Per AAP-spec section 5: parse the AID, dispatch to the appropriate
registry, fetch and verify the manifest and identity certificate.
"""

from __future__ import annotations

from dataclasses import dataclass

from .identity import AID, IdentityCertificate
from .manifest import Manifest


@dataclass(frozen=True, slots=True)
class ResolvedAgent:
    aid: AID
    identity: IdentityCertificate
    manifest: Manifest

    def supports_capability(self, name: str) -> bool:
        return any(c.name == name for c in self.manifest.capabilities)


@dataclass(frozen=True, slots=True)
class AgentSummary:
    aid: str
    description: str | None
    capabilities: list[str]
    accepts: list[str]


async def resolve(aid: str | AID, *, registry_url: str | None = None) -> ResolvedAgent:
    """Resolve an AID to a verified agent.

    Implementation in M1: fetches well-known/registry endpoints,
    verifies JWT against JWKS, verifies manifest signature against
    the JWT-published public key.
    """
    raise NotImplementedError("resolve — implemented in M1")


async def search(
    *,
    capability: str | None = None,
    tags: list[str] | None = None,
    accepts: list[str] | None = None,
    max_price: str | None = None,
    registry_url: str | None = None,
) -> list[AgentSummary]:
    raise NotImplementedError("search — implemented in M1")
