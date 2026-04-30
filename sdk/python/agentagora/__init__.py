"""AgentAgora Python SDK.

The package targets AAP spec v0.1. See docs/AAP-spec.md and
docs/sdk-api.md for design details.

Anything imported from ``agentagora._internal`` is unstable and may
change without notice between minor versions.
"""

from __future__ import annotations

__version__ = "0.0.1.dev0"

from .agent import Agent, agent
from .audit import AuditEvent, AuditLog
from .capability import CapabilityDescriptor, capability
from .client import AgentAgoraClient, SpendCap
from .conversation import Conversation, ConversationStatus, Dispute, Progress
from .errors import (
    AAPError,
    EscrowFailedError,
    InputInvalidError,
    InternalError,
    ManifestMismatchError,
    PaymentRequiredError,
    RateLimitedError,
    ScopeDeniedError,
    SLABreachError,
    UnauthorizedError,
)
from .identity import AID, IdentityCertificate, KeyStore
from .manifest import (
    SLA,
    Capability,
    Endpoints,
    Manifest,
    ManifestMetadata,
    Pricing,
    Privacy,
)
from .registry import AgentSummary, ResolvedAgent, resolve, search
from .settlement import (
    EscrowHandle,
    EscrowStatus,
    SettlementChannel,
    StripeChannel,
    UsdcBaseChannel,
)
from .signing import Signature, sign_envelope, verify_envelope

__all__ = [
    "__version__",
    # core client
    "AgentAgoraClient",
    "SpendCap",
    # decorators
    "agent",
    "capability",
    "Agent",
    "CapabilityDescriptor",
    # identity
    "AID",
    "IdentityCertificate",
    "KeyStore",
    # manifest
    "Manifest",
    "Capability",
    "Endpoints",
    "ManifestMetadata",
    "Pricing",
    "Privacy",
    "SLA",
    # conversation
    "Conversation",
    "ConversationStatus",
    "Dispute",
    "Progress",
    # audit
    "AuditEvent",
    "AuditLog",
    # registry
    "ResolvedAgent",
    "AgentSummary",
    "resolve",
    "search",
    # settlement
    "SettlementChannel",
    "StripeChannel",
    "UsdcBaseChannel",
    "EscrowHandle",
    "EscrowStatus",
    # signing
    "Signature",
    "sign_envelope",
    "verify_envelope",
    # errors
    "AAPError",
    "UnauthorizedError",
    "ScopeDeniedError",
    "ManifestMismatchError",
    "InputInvalidError",
    "PaymentRequiredError",
    "EscrowFailedError",
    "SLABreachError",
    "RateLimitedError",
    "InternalError",
]
