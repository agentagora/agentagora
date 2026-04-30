"""AAP error hierarchy.

Each subclass corresponds 1:1 to a JSON-RPC error code defined in
docs/AAP-spec.md section 6.4. The error code attribute on the class
allows dispatching from the wire format back into the typed hierarchy.
"""

from __future__ import annotations


class AAPError(Exception):
    code: int = -32099
    name: str = "aap.internal"

    def __init__(self, message: str = "", *, data: dict | None = None) -> None:
        super().__init__(message or self.name)
        self.message = message or self.name
        self.data = data or {}

    def to_jsonrpc(self) -> dict:
        out: dict = {"code": self.code, "message": self.message}
        if self.data:
            out["data"] = self.data
        return out

    @classmethod
    def from_jsonrpc(cls, error: dict) -> AAPError:
        code = error.get("code", -32099)
        message = error.get("message", "")
        data = error.get("data")
        klass = _CODE_TO_CLASS.get(code, AAPError)
        return klass(message, data=data)


class UnauthorizedError(AAPError):
    code = -32001
    name = "aap.unauthorized"


class ScopeDeniedError(AAPError):
    code = -32002
    name = "aap.scope_denied"


class ManifestMismatchError(AAPError):
    code = -32003
    name = "aap.manifest_mismatch"


class InputInvalidError(AAPError):
    code = -32004
    name = "aap.input_invalid"


class PaymentRequiredError(AAPError):
    code = -32005
    name = "aap.payment_required"

    @property
    def required_channels(self) -> list[str]:
        return list(self.data.get("required_channels", []))


class EscrowFailedError(AAPError):
    code = -32006
    name = "aap.escrow_failed"


class SLABreachError(AAPError):
    code = -32007
    name = "aap.sla_breach"


class RateLimitedError(AAPError):
    code = -32008
    name = "aap.rate_limited"


class InternalError(AAPError):
    code = -32099
    name = "aap.internal"


_CODE_TO_CLASS: dict[int, type[AAPError]] = {
    -32001: UnauthorizedError,
    -32002: ScopeDeniedError,
    -32003: ManifestMismatchError,
    -32004: InputInvalidError,
    -32005: PaymentRequiredError,
    -32006: EscrowFailedError,
    -32007: SLABreachError,
    -32008: RateLimitedError,
    -32099: InternalError,
}
