"""Tests for envelope signing and verification."""

from __future__ import annotations

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agentagora import sign_envelope, verify_envelope
from agentagora._internal.jcs import canonicalize


def _make_envelope() -> dict:
    return {
        "jsonrpc": "2.0",
        "id": "req_01",
        "method": "aap.invoke",
        "params": {"capability": "review_pr", "input": {"pr": 42}},
        "aap": {
            "version": "0.1",
            "conversation_id": "conv_01",
            "timestamp": "2026-04-30T12:34:56.789Z",
            "nonce": "abc123",
            "from": "aid:agentagora:alice/orchestrator",
            "to": "aid:agentagora:bob/code-review",
        },
    }


class TestSignVerify:
    def test_roundtrip(self):
        key = Ed25519PrivateKey.generate()
        env = _make_envelope()
        sign_envelope(env, key=key, key_id="alice/orchestrator#k1")
        assert env["aap"]["signature"]["alg"] == "EdDSA"
        assert env["aap"]["signature"]["key_id"] == "alice/orchestrator#k1"
        assert env["aap"]["signature"]["value"]
        assert verify_envelope(env, public_key=key.public_key())

    def test_tamper_detection_in_params(self):
        key = Ed25519PrivateKey.generate()
        env = _make_envelope()
        sign_envelope(env, key=key, key_id="alice/orchestrator#k1")
        env["params"]["input"]["pr"] = 43
        assert not verify_envelope(env, public_key=key.public_key())

    def test_tamper_detection_in_aap_meta(self):
        key = Ed25519PrivateKey.generate()
        env = _make_envelope()
        sign_envelope(env, key=key, key_id="alice/orchestrator#k1")
        env["aap"]["from"] = "aid:agentagora:eve/orchestrator"
        assert not verify_envelope(env, public_key=key.public_key())

    def test_wrong_key_fails(self):
        key1 = Ed25519PrivateKey.generate()
        key2 = Ed25519PrivateKey.generate()
        env = _make_envelope()
        sign_envelope(env, key=key1, key_id="alice/orchestrator#k1")
        assert not verify_envelope(env, public_key=key2.public_key())


class TestJCS:
    def test_object_keys_sorted(self):
        a = canonicalize({"b": 1, "a": 2})
        b = canonicalize({"a": 2, "b": 1})
        assert a == b == b'{"a":2,"b":1}'

    def test_nested(self):
        out = canonicalize({"x": {"b": [1, 2], "a": True}})
        assert out == b'{"x":{"a":true,"b":[1,2]}}'

    def test_rejects_float(self):
        import pytest

        with pytest.raises(TypeError):
            canonicalize({"price": 0.5})

    def test_rejects_non_string_key(self):
        import pytest

        with pytest.raises(TypeError):
            canonicalize({1: "x"})
