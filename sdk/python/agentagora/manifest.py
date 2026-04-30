"""Capability manifest models.

These Pydantic models mirror the wire format defined in AAP-spec
section 4. The SDK uses them both for outbound publication
(serializing decorated agents into manifests) and inbound consumption
(parsing manifests fetched during AID resolution).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Pricing(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: Literal["free", "per_call", "per_token", "negotiated"] = "per_call"
    amount: str | None = Field(
        default=None,
        description='Decimal amount as string, e.g. "0.50". Required unless model="free".',
    )
    currency: str | None = Field(default=None, description='ISO 4217 or "USDC"')

    @model_validator(mode="after")
    def _validate(self) -> Pricing:
        if self.model == "free":
            if self.amount or self.currency:
                raise ValueError("free pricing must omit amount and currency")
        else:
            if not self.amount or not self.currency:
                raise ValueError(f"{self.model} pricing requires amount and currency")
        return self


class SLA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p50_ms: int | None = None
    p99_ms: int | None = None
    success_rate: float | None = Field(default=None, ge=0.0, le=1.0)


class Privacy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data_retention_days: int = Field(default=7, ge=0)
    pii_handling: Literal["store", "redact", "refuse"] = "redact"
    region_restriction: list[str] = Field(
        default_factory=list,
        description="ISO 3166-1 alpha-2 country codes; empty = unrestricted",
    )


class Capability(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str | None = None
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    pricing: Pricing
    sla: SLA = Field(default_factory=SLA)
    accepts: list[str] = Field(
        default_factory=list,
        description="Settlement channel IDs accepted for this capability.",
    )

    @model_validator(mode="after")
    def _validate(self) -> Capability:
        if self.pricing.model != "free" and not self.accepts:
            raise ValueError(
                f"capability {self.name!r}: paid capabilities must accept at least one settlement channel"
            )
        return self


class Endpoints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rpc: str
    events: str | None = None


class ManifestMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    tags: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    models_used: list[str] = Field(default_factory=list)


class Manifest(BaseModel):
    """A capability manifest.

    The wire form is YAML or JSON. The canonical hash for signing is
    computed over the JCS canonicalization of the JSON form.
    """

    model_config = ConfigDict(extra="forbid")

    manifest_version: Literal[1] = 1
    aid: str
    description: str | None = None
    homepage: str | None = None
    contact: str | None = None
    endpoints: Endpoints
    capabilities: list[Capability] = Field(min_length=1)
    privacy: Privacy = Field(default_factory=Privacy)
    metadata: ManifestMetadata = Field(default_factory=ManifestMetadata)

    def capability(self, name: str) -> Capability:
        for cap in self.capabilities:
            if cap.name == name:
                return cap
        raise KeyError(name)

    def to_canonical_bytes(self) -> bytes:
        from ._internal.jcs import canonicalize

        return canonicalize(self.model_dump(mode="json"))
