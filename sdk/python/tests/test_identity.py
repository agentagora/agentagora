"""Tests for AID parsing and KeyStore."""

from __future__ import annotations

import pytest

from agentagora import AID, KeyStore


class TestAIDParse:
    def test_basic(self):
        aid = AID.parse("aid:agentagora:acme/code-review")
        assert aid.registry == "agentagora"
        assert aid.namespace == "acme"
        assert aid.name == "code-review"
        assert aid.fragment is None
        assert aid.is_public_registry

    def test_with_fragment(self):
        aid = AID.parse("aid:agentagora:acme/code-review#v2")
        assert aid.fragment == "v2"

    def test_self_hosted_registry(self):
        aid = AID.parse("aid:registry.example.com:ops/incident-bot")
        assert aid.registry == "registry.example.com"
        assert not aid.is_public_registry

    def test_roundtrip(self):
        s = "aid:agentagora:acme-corp/procurement#v1"
        assert str(AID.parse(s)) == s

    def test_with_fragment_method(self):
        a = AID.parse("aid:agentagora:foo/bar")
        b = a.with_fragment("v2")
        assert str(b) == "aid:agentagora:foo/bar#v2"
        assert a.fragment is None  # frozen — original unchanged

    @pytest.mark.parametrize(
        "bad",
        [
            "",
            "not-an-aid",
            "aid:registry:foo",  # missing /name
            "aid::foo/bar",  # empty registry
            "aid:registry:/bar",  # empty namespace
            "aid:registry:foo/",  # empty name
            "did:agentagora:foo/bar",  # wrong scheme
        ],
    )
    def test_invalid(self, bad):
        with pytest.raises(ValueError):
            AID.parse(bad)


class TestKeyStore:
    def test_generate_and_load(self, tmp_path):
        ks = KeyStore(base_dir=tmp_path)
        assert not ks.has("agent-1")
        key = ks.generate("agent-1")
        assert ks.has("agent-1")

        loaded = ks.load("agent-1")
        # Both should produce same public key bytes.
        assert (
            key.public_key().public_bytes_raw()
            == loaded.public_key().public_bytes_raw()
        )

    def test_load_or_generate(self, tmp_path):
        ks = KeyStore(base_dir=tmp_path)
        k1 = ks.load_or_generate("agent-2")
        k2 = ks.load_or_generate("agent-2")
        assert k1.public_key().public_bytes_raw() == k2.public_key().public_bytes_raw()

    def test_no_overwrite_by_default(self, tmp_path):
        ks = KeyStore(base_dir=tmp_path)
        ks.generate("agent-3")
        with pytest.raises(FileExistsError):
            ks.generate("agent-3")

    def test_file_mode_is_private(self, tmp_path):
        ks = KeyStore(base_dir=tmp_path)
        ks.generate("agent-4")
        path = ks._path_for("agent-4")
        # Owner read+write only (0600). Mask the file-type bits.
        assert (path.stat().st_mode & 0o777) == 0o600
