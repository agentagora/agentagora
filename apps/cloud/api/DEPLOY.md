# Deploying `@agentagora/cloud-api`

End-to-end deploy steps for the AgentAgora Cloud control-plane Worker. Run from the repo root unless noted.

> **Audience**: anyone provisioning a fresh Cloudflare account or rotating a deploy. For day-to-day code changes the only step that matters is `pnpm --filter @agentagora/cloud-api deploy`.

---

## 0. Prerequisites

- Cloudflare account with Workers + D1 enabled
- `wrangler` authenticated locally:
  ```bash
  pnpm --filter @agentagora/cloud-api exec wrangler login
  ```
- pnpm install completed at the repo root

---

## 1. Provision the D1 database (one-time)

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 create agentagora-cloud
```

Wrangler prints a UUID. Paste it into `apps/cloud/api/wrangler.jsonc` at:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "agentagora-cloud",
    "database_id": "<paste UUID here>",
    "migrations_dir": "migrations"
  }
]
```

Commit the change. The placeholder UUID `00000000-0000-0000-0000-000000000000` in the repo is a sentinel — the real one only lives in your account.

## 2. Apply migrations

```bash
# Local SQLite under .wrangler/state, used by `wrangler dev`:
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local

# Production:
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --remote
```

Schema lives in `apps/cloud/api/migrations/`. Add new migrations as `000N_*.sql`; wrangler tracks applied versions in a metadata table.

## 3. Configure secrets

### `OWNER_TOKENS` (required)

Comma-separated owner credentials, format `<ownerId>:<token>,<ownerId>:<token>,...`. The Worker logs a warning at boot if this is unset, and every `POST /v1/agents` returns `401`.

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put OWNER_TOKENS
# When prompted, paste e.g.:  alice:tok-A1,bob:tok-B2
```

Tokens should be high-entropy random strings (≥ 32 bytes, base64url). Rotate by replacing the secret; clients re-authenticate with the new token.

### `OIDC_SIGNING_KEY` and `OIDC_ISSUER` (required for real JWTs)

When both are set, `POST /v1/agents` returns a real EdDSA-signed JWT and `GET /.well-known/jwks.json` publishes the verifying public key. When either is missing, the Worker logs a warning and falls back to a deterministic mock string (development convenience only).

Generate a fresh Ed25519 private key and base64url-encode the raw 32 bytes:

```bash
node -e '
  const { randomBytes } = require("node:crypto");
  const k = randomBytes(32);
  process.stdout.write(k.toString("base64url") + "\n");
'
```

Set both secrets:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_SIGNING_KEY
# Paste the base64url string from above.

pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_ISSUER
# Paste the Worker's public URL, e.g.:  https://agentagora-cloud-api.example.workers.dev
```

The `kid` is derived deterministically from the public key (first 16 chars of SHA-256), so JWTs and JWKS always agree without an explicit kid registry. **Rotate** by generating a new key and replacing the secret — old JWTs become invalid at next verify and consumers must refetch JWKS.

### Future secrets

| Secret | Purpose | Task |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe Connect onboarding | M2 Phase 4 |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature check | M2 Phase 4 |

Add via `wrangler secret put <NAME>` when each lands.

---

## 4. Deploy

```bash
# Sanity check — typecheck, tests, bundle dry-run:
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test
pnpm --filter @agentagora/cloud-api check

# Ship it:
pnpm --filter @agentagora/cloud-api deploy
```

The deploy output prints the production URL (`https://agentagora-cloud-api.<account>.workers.dev` by default; override with `routes` in `wrangler.jsonc` once a custom domain is bound).

---

## 5. Smoke test

```bash
URL=https://agentagora-cloud-api.<account>.workers.dev
TOKEN=<one of the tokens you put in OWNER_TOKENS>

# Liveness:
curl "$URL/healthz"

# JWKS (consumers cache this to verify identity_jwt):
curl "$URL/.well-known/jwks.json"

# Discoverability (no auth):
curl "$URL/v1/agents"

# Publish (requires OWNER_TOKENS + an Ed25519 signature over the
# RFC 8785 canonical bytes of the body):
curl -X POST "$URL/v1/agents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-AAP-Pubkey: $PUBKEY_B64URL" \
  -H "X-AAP-Signature: $SIG_B64URL" \
  -H "Content-Type: application/json" \
  --data @example-manifest.json
```

Expected: `201` with `{ aid, identity_jwt, published_at, published_by, pubkey }`.

> Generating a signature by hand is fiddly — use the SDK's `signing` helpers (or any RFC 8785 canonicalizer + Ed25519 library). The publisher's public key is bound to the AID on first publish; subsequent updates must use the same key.

---

## 6. Rolling back

D1 migrations are forward-only (no built-in down migrations). To roll back a release:

1. `git revert` the offending Worker commit
2. `pnpm --filter @agentagora/cloud-api deploy` — code reverts immediately
3. Schema rollback (if needed) is a manual SQL operation; write a compensating `000N_revert_*.sql` and apply it

D1 keeps automatic backups; `wrangler d1 backup` can restore at the row level if a migration corrupts data. Always test migrations on `--local` first.

---

## 7. Out of scope (still pending)

The deploy currently produces a registry-only Worker. Operationally still missing:
- R2 bucket for long-term audit log storage
- KV namespace for nonce tracker / hot manifest cache
- Stripe Connect onboarding endpoints
- Real OIDC issuance (replaces the mock `identity_jwt`)
- Rate limiting / Sybil resistance

See `apps/cloud/api/README.md` for the per-task tracker.
