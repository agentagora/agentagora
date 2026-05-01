# agentagora — Python SDK (secondary)

[![Python SDK CI](https://github.com/agentagora/agentagora/actions/workflows/python-sdk.yml/badge.svg)](https://github.com/agentagora/agentagora/actions/workflows/python-sdk.yml)

> Python SDK for the AgentAgora interop layer. Targets [AAP spec v0.1](../../docs/AAP-spec.md).

> ⚠️ **Status: SECONDARY.** As of 2026-05-01 the project is
> TypeScript-first (see [docs/tech-stack.md](../../docs/tech-stack.md)
> §2). This Python skeleton is preserved for the working data-type
> code (AID parsing, JCS canonicalization, Ed25519 signing, Pydantic
> manifest models) and will be revived as a 1st-party SDK release
> **after M5**.
>
> **Do not invest new feature work here until the TypeScript SDK
> reaches M3.** The 33-test suite continues to run in CI to keep the
> existing code regression-free.

```bash
pip install -e .[dev]
pytest
```

## Quickstart (target API)

```python
from agentagora import agent, capability, AgentAgoraClient

client = AgentAgoraClient.from_env()

@agent(client, name="code-review", accepts=["stripe-fiat", "usdc-base"])
class CodeReview:
    @capability(price="0.50 USD", sla_p99_ms=120_000)
    async def review_pull_request(self, repo_url: str, pr_number: int) -> dict:
        return {"comments": []}

CodeReview().serve()
```

```python
result = await client.call(
    "aid:agentagora:alice/code-review",
    "review_pull_request",
    repo_url="https://github.com/foo/bar",
    pr_number=42,
)
```

The full design is in [docs/sdk-api-python.md](../../docs/sdk-api-python.md) (now marked secondary; canonical SDK design moves to TypeScript per [docs/tech-stack.md](../../docs/tech-stack.md)).

## Layout

```
agentagora/
  client.py            AgentAgoraClient — top-level entry
  agent.py             @agent class decorator + Agent base
  capability.py        @capability method decorator + descriptor
  manifest.py          Pydantic models for capability manifests
  identity.py          AID URI parsing + KeyStore (Ed25519)
  signing.py           Envelope signing (Ed25519 over JCS)
  conversation.py      Conversation FSM types
  audit.py             Local-first signed audit log
  settlement.py        SettlementChannel ABC + Stripe/USDC stubs
  registry.py          AID resolver and registry client
  errors.py            AAPError hierarchy (1:1 with spec error codes)
  cli/__main__.py      `agentagora` CLI entry
  _internal/jcs.py     JSON canonicalization (subset of RFC 8785)
```

## What's real today

| Module | Implementation |
|---|---|
| `errors` | ✅ full hierarchy with code mapping |
| `identity.AID` | ✅ parsing + serialization |
| `identity.KeyStore` | ✅ Ed25519 generate/load/persist |
| `_internal.jcs` | ✅ canonicalize() (subset; rejects floats by design) |
| `signing` | ✅ sign/verify envelopes |
| `manifest` | ✅ Pydantic models with validation |
| `conversation`, `audit` | ✅ data types; methods stubbed |
| `settlement` | 🚧 ABC; concrete channels in M2/M5 |
| `client.call`, `agent.serve` | 🚧 NotImplementedError; lands in M1 |
| `registry.resolve` | 🚧 NotImplementedError; lands in M1 |

## License

Apache-2.0 — see [/LICENSE](../../LICENSE).
