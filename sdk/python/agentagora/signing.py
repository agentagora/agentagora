"""Ed25519 signing and verification of AAP envelopes.

The signing surface here covers the wire-level signing of JSON-RPC
envelopes (AAP-spec section 6.2) and audit events (section 8.1).
JWT issuance and verification (identity certificates) live in
``identity`` and use PyJWT, not this module.
"""

from __future__ import annotations

import base64
import copy
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from ._internal.jcs import canonicalize


@dataclass(frozen=True, slots=True)
class Signature:
    alg: str  # "EdDSA"
    key_id: str  # e.g., "acme/orchestrator#k1"
    value: str  # base64url-encoded signature bytes

    def to_dict(self) -> dict:
        return {"alg": self.alg, "key_id": self.key_id, "value": self.value}

    @classmethod
    def from_dict(cls, d: dict) -> Signature:
        return cls(alg=d["alg"], key_id=d["key_id"], value=d["value"])


def _b64u_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64u_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def sign_envelope(
    envelope: dict[str, Any],
    *,
    key: Ed25519PrivateKey,
    key_id: str,
) -> dict[str, Any]:
    """Sign an AAP envelope in place.

    Computes the signature over the JCS canonicalization of the
    envelope with ``aap.signature.value`` removed, then writes the
    signature back into ``aap.signature``.
    """
    if "aap" not in envelope:
        raise ValueError("envelope missing required 'aap' field")

    payload = copy.deepcopy(envelope)
    aap = payload["aap"]
    sig_block = aap.setdefault("signature", {})
    sig_block["alg"] = "EdDSA"
    sig_block["key_id"] = key_id
    sig_block["value"] = ""

    raw = canonicalize(payload)
    sig_bytes = key.sign(raw)
    sig_b64 = _b64u_encode(sig_bytes)

    envelope.setdefault("aap", {}).setdefault("signature", {})
    envelope["aap"]["signature"] = {
        "alg": "EdDSA",
        "key_id": key_id,
        "value": sig_b64,
    }
    return envelope


def verify_envelope(
    envelope: dict[str, Any],
    *,
    public_key: Ed25519PublicKey,
) -> bool:
    """Verify an AAP envelope's signature.

    Returns True if the signature is valid; False otherwise.
    Raises ``ValueError`` if the envelope is structurally invalid.
    """
    aap = envelope.get("aap")
    if not aap or "signature" not in aap:
        raise ValueError("envelope missing 'aap.signature'")
    sig_block = aap["signature"]
    sig_bytes = _b64u_decode(sig_block["value"])

    payload = copy.deepcopy(envelope)
    payload["aap"]["signature"] = {
        "alg": sig_block.get("alg", "EdDSA"),
        "key_id": sig_block.get("key_id", ""),
        "value": "",
    }
    raw = canonicalize(payload)

    try:
        public_key.verify(sig_bytes, raw)
    except InvalidSignature:
        return False
    return True
