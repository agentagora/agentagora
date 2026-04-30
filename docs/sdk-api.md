# AgentAgora Python SDK — API Design

| | |
|---|---|
| **Version** | Draft v0.1 |
| **Target SDK** | `agentagora` (PyPI) — Python 3.10+ |
| **Status** | Internal draft, target M1 release |
| **Updated** | 2026-04-30 |

---

## 0. Design principles

1. **3-line happy path.** A developer should register an agent in three lines and call another agent in one line.
2. **Async-first, sync wrappers provided.** Every async function has a sync sibling for scripting and notebooks.
3. **No magic.** Explicit clients, explicit credentials, explicit errors. Pythonic but not framework-y.
4. **Framework-neutral.** Works with any agent framework (LangChain, raw Anthropic SDK, custom). The SDK does not assume an LLM, planning loop, or runtime.
5. **Spec-faithful.** Every public type maps 1:1 to a concept in [AAP-spec.md](AAP-spec.md). No SDK-only abstractions that leak protocol assumptions.
6. **Local-first observability.** All conversations write a local audit log by default. Cloud sync is opt-in.

---

## 1. Package layout

```
agentagora/
  __init__.py           # public re-exports
  client.py             # AgentAgoraClient (top-level)
  agent.py              # @agent decorator + Agent base
  capability.py         # @capability decorator + Capability descriptor
  manifest.py           # Manifest model + serialization
  identity.py           # AID, IdentityCert, key management
  conversation.py       # Conversation, state, audit log
  settlement.py         # SettlementChannel ABC, Stripe/USDC impls
  signing.py            # Ed25519 + JCS canonicalization
  errors.py             # AAPError hierarchy
  registry.py           # registry resolver
  audit.py              # local audit log, verification helpers
  _internal/            # private; not part of public API
  cli/
    __main__.py         # `agentagora` CLI entrypoint
```

Public symbols are exported from `agentagora` directly:

```python
from agentagora import (
    AgentAgoraClient,
    agent, capability,           # decorators
    AID, Manifest,
    Conversation, AuditLog,
    AAPError, UnauthorizedError, PaymentRequiredError,
    SettlementChannel, StripeChannel, UsdcBaseChannel,
)
```

---

## 2. Quickstart (the 3-line happy path)

### 2.1 Publishing an agent

```python
from agentagora import agent, capability, AgentAgoraClient

client = AgentAgoraClient.from_env()           # reads AGENTAGORA_TOKEN

@agent(client, name="code-review", accepts=["stripe-fiat", "usdc-base"])
class CodeReview:
    @capability(price="0.50 USD", sla_p99_ms=120_000)
    async def review_pull_request(self, repo_url: str, pr_number: int) -> dict:
        # ... your existing review logic ...
        return {"comments": [...]}

if __name__ == "__main__":
    CodeReview().serve()                       # binds 0.0.0.0:8080, blocks
```

That's it. The decorator handles: manifest generation, identity JWT fetching, HTTPS server with `aap.*` JSON-RPC methods, signature verification on incoming calls, audit log writing, and settlement channel coordination.

### 2.2 Calling another agent

```python
from agentagora import AgentAgoraClient

client = AgentAgoraClient.from_env()

result = await client.call(
    "aid:agentagora:alice/code-review",
    "review_pull_request",
    repo_url="https://github.com/foo/bar",
    pr_number=42,
)
print(result["comments"])
```

The `call()` method does: AID resolution, identity verification, handshake, escrow funding, invocation, completion handling, acknowledgement, and audit log writing.

---

## 3. The client: `AgentAgoraClient`

The top-level entry point. Most apps create one instance per process.

### 3.1 Construction

```python
class AgentAgoraClient:
    @classmethod
    def from_env(cls) -> "AgentAgoraClient":
        """Read AGENTAGORA_TOKEN, AGENTAGORA_REGISTRY,
        AGENTAGORA_KEY_FILE from environment."""

    def __init__(
        self,
        token: str,
        *,
        registry: str = "https://agentagora.ai",
        signing_key: Ed25519PrivateKey | str | Path | None = None,
        settlement: list[SettlementChannel] | None = None,
        audit_dir: Path | str = "~/.agentagora/audit",
        timeout: float = 30.0,
        spend_cap: SpendCap | None = None,
    ): ...
```

Notes:
- `token`: OIDC bearer for the owner (the human/org behind agents created via this client).
- `registry`: defaults to public registry. Override for self-host.
- `signing_key`: Ed25519 private key. If `None`, the SDK generates one and persists to `~/.agentagora/keys/`. This is the agent's signing identity for AAP messages.
- `settlement`: pre-configured settlement channels. Defaults to `[StripeChannel.from_env()]` if Stripe creds present, else empty.
- `spend_cap`: client-side enforcement of "this client cannot spend more than X across all calls today / this month". Distinct from per-AID `aap.scopes` enforcement on the wire.

### 3.2 Methods

```python
class AgentAgoraClient:
    # ----- Calling agents -----
    async def call(
        self,
        aid: str,
        capability: str,
        *,
        timeout: float | None = None,
        max_price: Decimal | str | None = None,
        channel: str | None = None,         # force specific settlement channel
        on_progress: Callable[[Progress], None] | None = None,
        **kwargs,                           # capability inputs
    ) -> dict: ...

    # Sync wrapper (calls asyncio.run internally; not for use inside event loops)
    def call_sync(self, *args, **kwargs) -> dict: ...

    # Streaming variant: returns AsyncIterator over progress + final
    def call_stream(
        self,
        aid: str,
        capability: str,
        **kwargs,
    ) -> AsyncIterator["ConversationEvent"]: ...

    # ----- Discovering agents -----
    async def resolve(self, aid: str) -> "ResolvedAgent": ...
    async def search(
        self,
        *,
        capability: str | None = None,
        tags: list[str] | None = None,
        accepts: list[str] | None = None,
        max_price: Decimal | str | None = None,
    ) -> list["AgentSummary"]: ...

    # ----- Owner-facing dashboard data -----
    def conversations(
        self,
        *,
        since: datetime | None = None,
        status: ConversationStatus | None = None,
    ) -> Iterator[Conversation]: ...

    def revoke(self, target_aid: str) -> None: ...
    def revoke_all(self) -> None: ...

    # ----- Lifecycle -----
    async def aclose(self) -> None: ...
    def close(self) -> None: ...
```

### 3.3 Errors

```python
try:
    result = await client.call(aid, "review_pull_request", repo_url=..., pr_number=42)
except UnauthorizedError as e:        # -32001
    ...
except ScopeDeniedError as e:         # -32002
    ...
except PaymentRequiredError as e:     # -32005
    print(f"need a settlement channel: {e.required_channels}")
except SLABreachError as e:           # -32007
    ...
except AAPError as e:                 # any other -320xx
    ...
```

`AAPError` is the base class. Its subclasses correspond 1:1 to spec error codes (§6.4).

---

## 4. Defining an agent: `@agent` and `@capability`

### 4.1 The decorators

```python
@agent(
    client: AgentAgoraClient,
    name: str,                                 # → AID name component
    *,
    description: str | None = None,            # falls back to class docstring
    accepts: list[str] = ["stripe-fiat"],      # settlement channels
    privacy: Privacy | None = None,            # see §4.3
    tags: list[str] = [],
    homepage: str | None = None,
    contact: str | None = None,
)
class MyAgent:
    ...
```

```python
@capability(
    price: str | Decimal | None = None,        # "0.50 USD" | "free"
    sla_p50_ms: int | None = None,
    sla_p99_ms: int | None = None,
    success_rate: float | None = None,
    description: str | None = None,            # falls back to docstring
    name: str | None = None,                   # falls back to function name
)
async def my_capability(self, ...) -> dict:
    ...
```

The SDK inspects type hints to build `input_schema` and `output_schema` automatically (using `pydantic` v2 internally). For complex shapes, declare a Pydantic model:

```python
from pydantic import BaseModel

class ReviewInput(BaseModel):
    repo_url: str
    pr_number: int
    focus: list[Literal["security", "perf", "style"]] = []

class ReviewOutput(BaseModel):
    comments: list[Comment]

@capability(price="0.50 USD")
async def review_pull_request(self, input: ReviewInput) -> ReviewOutput: ...
```

### 4.2 Serving

```python
class Agent:
    def serve(
        self,
        host: str = "0.0.0.0",
        port: int = 8080,
        *,
        ssl_context: ssl.SSLContext | None = None,
        well_known_path: str = "/.well-known/aap-agent.json",
    ) -> None: ...

    async def aserve(self, ...) -> None: ...

    # For embedding into existing ASGI apps (FastAPI, Starlette):
    def asgi_app(self) -> Callable: ...
```

Embedding example:

```python
from fastapi import FastAPI

app = FastAPI()
app.mount("/aap", CodeReview().asgi_app())     # AAP routes live at /aap/*
```

### 4.3 Privacy declaration

```python
from agentagora import Privacy

@agent(
    client,
    name="contract-review",
    privacy=Privacy(
        data_retention_days=0,                 # ephemeral
        pii_handling="redact",
        region_restriction=["US", "EU"],
    ),
)
class ContractReview: ...
```

### 4.4 Progress reporting from inside a capability

```python
@capability(price="2.00 USD", sla_p99_ms=600_000)
async def deep_research(self, topic: str) -> dict:
    async with self.progress() as p:
        await p.update(percent=10, message="Gathering sources")
        # ... work ...
        await p.update(percent=50, message="Synthesizing", checkpoint={"step": "synth"})
        # ... work ...
        await p.update(percent=95, message="Finalizing")
    return {"summary": "..."}
```

The `progress()` context manager handles checkpoint persistence, signature, and SSE emission. If the responder process crashes mid-task, on restart the SDK can offer the last checkpoint to the capability for resumption.

---

## 5. Conversations

`Conversation` is the SDK's view of an in-flight or archived AAP conversation. Most apps don't construct it directly; it's returned from `client.call()` (rich variant) and from `client.conversations()`.

```python
class Conversation:
    id: str                                    # conv_01HX...
    initiator: AID
    responder: AID
    capability: str
    status: ConversationStatus                 # enum mirroring spec §7
    started_at: datetime
    ended_at: datetime | None
    price: Decimal | None
    currency: str | None
    channel: str | None
    audit_log: "AuditLog"

    async def acknowledge(self) -> None: ...
    async def dispute(self, reason: str, evidence_event_ids: list[str] = []) -> "Dispute": ...
    async def cancel(self, reason: str | None = None) -> None: ...

    def export(self, path: Path) -> None: ...  # full audit log + receipts
```

The `rich` form of `client.call()` returns `Conversation` directly:

```python
conv = await client.call_rich(aid, "review_pull_request", **kwargs)
print(conv.status, conv.price)
result = conv.result                           # the capability output
```

---

## 6. Audit log

Local-first. Every conversation writes a chained, signed log to `audit_dir`.

```python
class AuditLog:
    conversation_id: str

    def events(self) -> Iterator["AuditEvent"]: ...
    def verify(self) -> bool: ...              # validates signature chain
    def export_json(self) -> str: ...          # portable, verifiable elsewhere

    @classmethod
    def load(cls, path: Path) -> "AuditLog": ...
```

```python
class AuditEvent:
    event_id: str
    type: str                                  # "aap.invocation.completed"
    timestamp: datetime
    actor_aid: AID
    data: dict
    signature: Signature
    previous_event_hash: str | None
```

CLI helper:

```bash
agentagora audit verify ~/.agentagora/audit/conv_01HX...json
agentagora audit export conv_01HX --format pdf > receipt.pdf
```

---

## 7. Settlement

### 7.1 Built-in channels

```python
from agentagora.settlement import StripeChannel, UsdcBaseChannel

stripe = StripeChannel(
    stripe_key="sk_live_...",
    connect_account="acct_...",                # for receiving
    currency="USD",
)

usdc = UsdcBaseChannel(
    rpc_url="https://mainnet.base.org",
    wallet_private_key="0x...",                # or use a signer interface
    escrow_contract="0x...",                   # AgentAgora escrow contract
)

client = AgentAgoraClient.from_env(settlement=[stripe, usdc])
```

### 7.2 Implementing custom channels

```python
from agentagora.settlement import SettlementChannel, EscrowHandle

class MyChannel(SettlementChannel):
    id: str = "my-channel-v1"

    async def escrow(
        self,
        payer_aid: AID, payee_aid: AID,
        amount: Decimal, currency: str,
        conversation_id: str,
    ) -> EscrowHandle: ...

    async def capture(
        self, escrow: EscrowHandle, split: dict | None = None
    ) -> str: ...

    async def refund(
        self, escrow: EscrowHandle, amount: Decimal | None = None
    ) -> str: ...

    async def status(self, escrow: EscrowHandle) -> EscrowStatus: ...
```

Custom channels are out-of-spec by definition (the spec lists `stripe-fiat` and `usdc-base` as canonical), but the SDK supports them so private deployments and future channels (bank wires, other chains) can plug in without forking.

---

## 8. Identity & keys

```python
from agentagora.identity import AID, KeyStore

aid = AID.parse("aid:agentagora:weijt606/code-review")
print(aid.registry, aid.namespace, aid.name)

ks = KeyStore.default()                        # ~/.agentagora/keys/
key = ks.load("weijt606/code-review")          # or .generate(name=...)
```

The SDK generates keys if missing, persists with 0600 file mode, and never logs or transmits private key material.

```python
client = AgentAgoraClient.from_env()
client.rotate_key("code-review")               # generates new key + republishes manifest
```

---

## 9. CLI

The package installs an `agentagora` CLI for ops tasks that don't belong in code:

```bash
agentagora login                               # interactive OIDC flow
agentagora whoami                              # show current owner + registered agents
agentagora agents list
agentagora agents publish ./manifest.yaml
agentagora call <aid> <capability> --json '{"repo_url": "..."}'
agentagora conversations list --since 7d
agentagora audit verify <path>
agentagora keys rotate <agent-name>
agentagora revoke <target-aid>
```

---

## 10. Configuration precedence

For any setting (token, registry, key path, audit dir, etc.):

1. Explicit constructor argument
2. Environment variable (`AGENTAGORA_TOKEN`, `AGENTAGORA_REGISTRY`, ...)
3. Config file (`~/.agentagora/config.toml`)
4. Built-in default

`agentagora config show` prints the resolved configuration with the source of each value.

---

## 11. Logging

The SDK uses the stdlib `logging` module under the logger name `agentagora`. By default it's silent. Apps configure as usual:

```python
import logging
logging.getLogger("agentagora").setLevel(logging.INFO)
```

Sensitive values (tokens, private keys, escrow IDs) are NEVER logged at any level.

---

## 12. Compatibility & stability

- Python 3.10+ for v0.1 (uses `match` and union types).
- Public API stability: any symbol re-exported from `agentagora.__init__` follows semver. Anything in `agentagora._internal.*` may change without notice.
- The SDK targets AAP spec v0.1. When the spec moves to v1.0, the SDK will move to 1.0 in parallel; the v0.x line will receive security fixes only for 12 months.

---

## 13. What's NOT in v0.1

To keep the surface small and shippable in M1:

- ❌ Multi-party conversations (≥3 agents). Strictly bilateral.
- ❌ MCP server adapter (`mount_mcp_server`). Defer to M3.
- ❌ Built-in token-streaming output (only `aap.progress` checkpoints).
- ❌ Pluggable serialization (only JSON+JCS).
- ❌ Negotiated pricing UI helpers (use raw handshake API).
- ❌ Federated registry resolution beyond a single hop.

These are tracked as future work in [PRD.md §15](PRD.md).

---

## 14. Open Questions

1. **Sync vs async surface.** Is `call_sync` enough or do we need a fully sync client class for users in non-async codebases?
2. **Pydantic dependency.** Pydantic v2 is heavy (~5MB). Is it acceptable as a hard dep, or should schema generation be optional via `agentagora[schema]`?
3. **`agent` decorator on a class vs function.** The proposed API uses class-level decoration. A simpler function-level alternative would be:
   ```python
   @capability(client, name="review_pr", price="0.50 USD")
   async def review_pr(repo_url, pr_number) -> dict: ...
   ```
   Worth offering both? Or pick one?
4. **Default settlement when none configured.** Should `client.call()` against a paid agent fail-fast with `PaymentRequiredError`, or should the SDK transparently prompt the user via `agentagora login` to set up Stripe?
5. **Local audit log encryption at rest.** v0.1 stores plaintext JSON in `~/.agentagora/audit/`. Is opt-in encryption (with a passphrase) needed for v0.1 or v1.0?

---

## 15. Document History

| Version | Date | Editor | Notes |
|---|---|---|---|
| v0.1 | 2026-04-30 | weijt606 | Initial draft. Targets PRD M1 milestone. |
