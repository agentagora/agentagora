"""Agent Identity (AID) and key management.

AID URI form per AAP-spec section 3.1:

    aid:<registry>:<namespace>/<name>[#<fragment>]
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
    load_pem_private_key,
)

_AID_RE = re.compile(
    r"^aid:(?P<registry>[A-Za-z0-9.\-]+):(?P<namespace>[A-Za-z0-9_\-]+)/(?P<name>[A-Za-z0-9_\-]+)(?:#(?P<fragment>[A-Za-z0-9_\-.]+))?$"
)


@dataclass(frozen=True, slots=True)
class AID:
    registry: str
    namespace: str
    name: str
    fragment: str | None = None

    @classmethod
    def parse(cls, value: str) -> AID:
        m = _AID_RE.match(value)
        if not m:
            raise ValueError(f"invalid AID: {value!r}")
        return cls(
            registry=m["registry"],
            namespace=m["namespace"],
            name=m["name"],
            fragment=m["fragment"],
        )

    def __str__(self) -> str:
        base = f"aid:{self.registry}:{self.namespace}/{self.name}"
        return f"{base}#{self.fragment}" if self.fragment else base

    @property
    def is_public_registry(self) -> bool:
        return self.registry == "agentagora"

    def with_fragment(self, fragment: str | None) -> AID:
        return AID(self.registry, self.namespace, self.name, fragment)


@dataclass
class IdentityCertificate:
    """An OIDC-issued JWT asserting an agent's identity, public key,
    scopes, and accepted settlement channels."""

    aid: AID
    owner: str
    public_key: Ed25519PublicKey
    scopes: list[str]
    manifest_url: str
    settlement: dict
    issued_at: int
    expires_at: int
    raw_jwt: str

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes


class KeyStore:
    """File-backed Ed25519 keystore.

    Keys are stored at ``<base_dir>/<safe_name>.pem`` with mode 0600.
    Private key material is never logged or transmitted.
    """

    def __init__(self, base_dir: Path | str | None = None) -> None:
        self.base_dir = Path(base_dir or "~/.agentagora/keys").expanduser()

    @classmethod
    def default(cls) -> KeyStore:
        return cls()

    def _path_for(self, name: str) -> Path:
        safe = name.replace("/", "_").replace(":", "_")
        return self.base_dir / f"{safe}.pem"

    def has(self, name: str) -> bool:
        return self._path_for(name).exists()

    def load(self, name: str) -> Ed25519PrivateKey:
        path = self._path_for(name)
        if not path.exists():
            raise FileNotFoundError(f"no key for {name!r} at {path}")
        data = path.read_bytes()
        key = load_pem_private_key(data, password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError(f"key at {path} is not Ed25519")
        return key

    def generate(self, name: str, *, overwrite: bool = False) -> Ed25519PrivateKey:
        path = self._path_for(name)
        if path.exists() and not overwrite:
            raise FileExistsError(f"key for {name!r} already exists at {path}")
        self.base_dir.mkdir(parents=True, exist_ok=True)
        key = Ed25519PrivateKey.generate()
        pem = key.private_bytes(
            encoding=Encoding.PEM,
            format=PrivateFormat.PKCS8,
            encryption_algorithm=NoEncryption(),
        )
        path.write_bytes(pem)
        path.chmod(0o600)
        return key

    def load_or_generate(self, name: str) -> Ed25519PrivateKey:
        if self.has(name):
            return self.load(name)
        return self.generate(name)

    def public_key_bytes(self, name: str) -> bytes:
        priv = self.load(name)
        pub = priv.public_key()
        return pub.public_bytes(
            encoding=Encoding.Raw,
            format=PublicFormat.Raw,
        )
