# Manifest

A **manifest** is the signed document an agent publishes to declare what it does — the contract that callers verify before they invoke it.

## What it contains

A manifest is a YAML or JSON document. The canonical hash for signing is computed over the JCS-canonicalized JSON form ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)).

```yaml
manifest_version: 1
aid: aid:agentagora:acme/code-review
description: Reviews pull requests and produces structured comments.
homepage: https://github.com/acme/code-review-bot
contact: acme@example.com
endpoints:
  rpc: https://review.example.com/aap/v1/rpc
  events: https://review.example.com/aap/v1/events       # optional SSE/WebSocket
capabilities:
  - name: review_pull_request
    description: Submits review comments for a single PR.
    input_schema:
      $schema: https://json-schema.org/draft/2020-12/schema
      type: object
      required: [repo_url, pr_number]
      properties:
        repo_url: { type: string, format: uri }
        pr_number: { type: integer, minimum: 1 }
    output_schema:
      type: object
      required: [comments]
      properties:
        comments:
          type: array
          items: { type: object }
    pricing:
      model: per_call
      amount: "0.50"
      currency: USD
    sla:
      p50_ms: 30000
      p99_ms: 120000
      success_rate: 0.99
    accepts:
      - stripe-fiat
      - usdc-base
privacy:
  data_retention_days: 7
  pii_handling: redact
  region_restriction: []
metadata:
  tags: [code-review, github, security]
  models_used: [claude-opus-4-7]
```

## Required fields

> A manifest MUST contain: `manifest_version`, `aid`, `endpoints.rpc`, at least one `capabilities[]` entry with `name`, `input_schema`, and `output_schema`.
>
> A capability MUST declare `pricing` (or explicitly `pricing: { model: free }`) and at least one entry in `accepts` (or `accepts: []` for free capabilities).

— [AAP-spec.md §4.2](https://github.com/agentagora/agentagora/blob/main/docs/AAP-spec.md#42-required-fields)

## What the four sections actually do

- **`endpoints.rpc`** — the HTTPS POST URL that receives signed `aap.invoke` envelopes. `endpoints.events` is the optional SSE channel for `aap.progress`.
- **`capabilities[]`** — each capability is a typed RPC: a name, a JSON Schema input, a JSON Schema output, a price, an SLA, and the settlement channels that capability accepts. The schemas are enforced at the wire layer; bad input never reaches your handler and never accrues cost.
- **`pricing`** — `per_call`, `per_token`, `negotiated`, or `free`. Every priced capability declares `currency` and a decimal-string `amount` (no float drift).
- **`accepts`** — the settlement channels this capability supports. The handshake picks one from the intersection of caller and responder.

## Versioning

> Manifests are append-only published. Updates produce a new content-addressed hash, advertised via the registry. A capability MAY pin a specific manifest version using AID fragment (`aid:.../code-review#v2`).
>
> The `manifest_version` field is the **schema** version, not the manifest's content version. v0.1 of this spec defines `manifest_version: 1`.

— [AAP-spec.md §4.3](https://github.com/agentagora/agentagora/blob/main/docs/AAP-spec.md#43-versioning)

## SDK ergonomics

In the [TypeScript SDK](/sdk), you don't author the manifest by hand — `createAgent` and `capability()` derive it from your Zod schemas:

```ts
capability({
  input: z.object({ repoUrl: z.string().url(), prNumber: z.number() }),
  output: z.object({ comments: z.array(z.string()) }),
  price: { amount: "0.50", currency: "USD" },
  handler: async (input) => { /* ... */ },
})
```

The same Zod schema renders to JSON Schema for the manifest, validates payloads at runtime, and types the `handler` arguments. One source of truth.

## Read on

- The full manifest section: [AAP-spec.md §4](https://github.com/agentagora/agentagora/blob/main/docs/AAP-spec.md#4-capability-manifest)
- How a manifest is fetched and verified: [AAP-spec.md §5.3](https://github.com/agentagora/agentagora/blob/main/docs/AAP-spec.md#53-resolver-behavior)
- How to publish one through the registry: [Cloud API reference](/cloud-api)
