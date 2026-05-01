# @agentagora/protocol

> Wire types and Zod schemas for the AgentAgora Protocol (AAP). Single source of truth for protocol-level definitions.

This package defines, in TypeScript, every shape that crosses the wire in AAP:

- **Identity** — `AID` URI, branded string, parser
- **Manifest** — capability declarations with pricing, SLA, privacy
- **Envelope** — JSON-RPC 2.0 + AAP signed extensions
- **Audit Event** — chained, signed log records
- **Conversation** — FSM states and legal transitions
- **Errors** — wire codes ↔ typed identifiers
- **Constants** — protocol version, method names, settlement channel IDs

It is consumed by `@agentagora/sdk`, the Cloud Platform, and the Dashboard. Other-language SDKs (e.g., the Python SDK) generate their types from the JSON Schemas this package emits.

The schemas mirror [docs/AAP-spec.md](../../docs/AAP-spec.md). When the spec moves, this package moves; the SDK and Cloud Platform follow via type errors at compile time.

## Install

```bash
pnpm add @agentagora/protocol
```

## Usage

```typescript
import { ManifestSchema, parseAid, Methods } from "@agentagora/protocol";

const manifest = ManifestSchema.parse(rawJson);
const aid = parseAid("aid:agentagora:weijt606/code-review");
console.log(Methods.Invoke); // "aap.invoke"
```

## Subpath exports

For tree-shaking, prefer subpath imports:

```typescript
import { ManifestSchema } from "@agentagora/protocol/manifest";
import { parseAid } from "@agentagora/protocol/identity";
```

## License

[Apache-2.0](../../LICENSE)
