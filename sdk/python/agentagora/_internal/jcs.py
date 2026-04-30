"""Canonical JSON serialization for signing.

This is a pragmatic subset of RFC 8785 (JSON Canonicalization Scheme)
sufficient for AAP envelopes, which use only:

  - Objects with string keys
  - Arrays
  - Strings
  - Integers (decimals are encoded as strings in AAP, not JSON numbers)
  - Booleans and null

Restrictions enforced:

  - Floating-point numbers are rejected. AAP carries decimal amounts
    as strings (e.g., "0.50") to avoid float precision issues.
  - All keys must be strings and finite.

When the wire format expands to include floats, swap this module for a
full RFC 8785 implementation (e.g., the ``rfc8785`` package).
"""

from __future__ import annotations

import json
from typing import Any


def canonicalize(obj: Any) -> bytes:
    """Return the canonical JSON byte sequence for ``obj``.

    Raises ``TypeError`` if ``obj`` contains floats or non-string keys.
    """
    _validate(obj)
    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _validate(obj: Any) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not isinstance(k, str):
                raise TypeError(f"JCS object key must be str, got {type(k).__name__}")
            _validate(v)
    elif isinstance(obj, list):
        for item in obj:
            _validate(item)
    elif isinstance(obj, float):
        raise TypeError(
            "float values are not permitted in AAP signed envelopes; "
            "encode decimals as strings"
        )
    elif obj is None or isinstance(obj, (str, int, bool)):
        return
    else:
        raise TypeError(f"unsupported type for JCS: {type(obj).__name__}")
