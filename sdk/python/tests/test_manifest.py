"""Tests for capability manifest model validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agentagora import (
    Capability,
    Endpoints,
    Manifest,
    Pricing,
)


def _basic_capability(**overrides) -> Capability:
    base = dict(
        name="review_pull_request",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        pricing=Pricing(model="per_call", amount="0.50", currency="USD"),
        accepts=["stripe-fiat"],
    )
    base.update(overrides)
    return Capability(**base)


class TestPricing:
    def test_paid_requires_amount_and_currency(self):
        with pytest.raises(ValidationError):
            Pricing(model="per_call")

    def test_free_rejects_amount(self):
        with pytest.raises(ValidationError):
            Pricing(model="free", amount="1.00", currency="USD")

    def test_free_ok(self):
        p = Pricing(model="free")
        assert p.amount is None


class TestCapability:
    def test_paid_requires_settlement_channel(self):
        with pytest.raises(ValidationError):
            Capability(
                name="x",
                input_schema={"type": "object"},
                output_schema={"type": "object"},
                pricing=Pricing(model="per_call", amount="1.00", currency="USD"),
                accepts=[],
            )

    def test_free_capability_ok_without_channel(self):
        cap = Capability(
            name="ping",
            input_schema={"type": "object"},
            output_schema={"type": "object"},
            pricing=Pricing(model="free"),
            accepts=[],
        )
        assert cap.pricing.model == "free"


class TestManifest:
    def test_minimal_manifest(self):
        m = Manifest(
            aid="aid:agentagora:acme/code-review",
            endpoints=Endpoints(rpc="https://example.com/aap/v1/rpc"),
            capabilities=[_basic_capability()],
        )
        assert m.manifest_version == 1
        assert m.capability("review_pull_request").name == "review_pull_request"

    def test_capability_lookup_missing(self):
        m = Manifest(
            aid="aid:agentagora:acme/code-review",
            endpoints=Endpoints(rpc="https://example.com/aap/v1/rpc"),
            capabilities=[_basic_capability()],
        )
        with pytest.raises(KeyError):
            m.capability("does_not_exist")

    def test_canonical_bytes_stable(self):
        m = Manifest(
            aid="aid:agentagora:acme/code-review",
            endpoints=Endpoints(rpc="https://example.com/aap/v1/rpc"),
            capabilities=[_basic_capability()],
        )
        a = m.to_canonical_bytes()
        b = m.to_canonical_bytes()
        assert a == b

    def test_must_have_at_least_one_capability(self):
        with pytest.raises(ValidationError):
            Manifest(
                aid="aid:agentagora:acme/code-review",
                endpoints=Endpoints(rpc="https://example.com/aap/v1/rpc"),
                capabilities=[],
            )
