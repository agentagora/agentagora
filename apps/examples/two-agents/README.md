# two-agents — end-to-end AAP demo

A minimal runnable demo showing two agents — owned by separate clients — communicating over real HTTP using `@agentagora/sdk`.

## What it proves

- ✅ An agent can be hosted behind any web-standard fetch handler (here: `@hono/node-server`).
- ✅ A client can call that agent over real HTTP via `HttpTransport`.
- ✅ Every message in both directions is Ed25519-signed and verified.
- ✅ Both sides write a chained, signed audit log; both chains verify after the call.

## Run

From the repo root:

```bash
pnpm install
pnpm --filter @agentagora/example-two-agents demo
```

Expected output:

```
── setup ──────────────────────────────────────────
bob serving at http://127.0.0.1:54321/
bob aid:       aid:agentagora:bob/echo
alice aid:     aid:agentagora:alice/orchestrator

── call ───────────────────────────────────────────
status:         archived
result:         { reply: 'pong: hello from alice', echoedMessage: 'hello from alice' }

── audit ──────────────────────────────────────────
initiator events (alice, 3):
  2026-05-01T...  aap.conversation.opened       by aid:agentagora:alice/orchestrator
  2026-05-01T...  aap.acknowledged              by aid:agentagora:alice/orchestrator
  2026-05-01T...  aap.conversation.archived     by aid:agentagora:alice/orchestrator
initiator chain verifies: true

responder events (bob, 2):
  2026-05-01T...  aap.invocation.started        by aid:agentagora:bob/echo
  2026-05-01T...  aap.invocation.completed      by aid:agentagora:bob/echo
responder chain verifies: true

── done ───────────────────────────────────────────
if you reached here, the SDK is working end-to-end over HTTP.
```

## What's intentionally missing

This demo is a single Node process that runs both sides. In production you'd:

- Run the responder behind a long-lived process (Node, Cloudflare Workers, Bun, Deno…)
- Resolve endpoints via the AgentAgora registry instead of `StaticEndpointResolver`
- Persist audit logs to disk / R2 / KV instead of in-memory

Multi-process and Cloudflare Workers variants land in subsequent examples.
