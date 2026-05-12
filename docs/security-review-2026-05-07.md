# AgentAgora security review — 2026-05-07

> **Triage status as of 2026-05-13: H4 + H5 + M5 closed in the commit that ships this doc; M7 + M8 (M.15/M.16) + M9 + M10 + M11 + L2 + L3 + L4 remain open and scheduled per the table at the bottom.**
>
> Read-only audit performed at commit `15a1283` (post-M4-Phase-3). Companion to [`docs/security-review-2026-05.md`](security-review-2026-05.md) — that one closed in `556e766` with H1+H2+H3+M1+M2+M4+L1 fixed and M3 documented-but-unfixed. This pass looks at:
>
> 1. Is M3 still where it was? (Yes — nonce + rate-limit fail-open is still live.)
> 2. New surfaces added since `556e766` — file-dispute form (`36a7131`), edit-manifest form (`0f06022`), smoke script (`bdcd5d3`), marketing catalog fetch (`24b9535`), M4 protocol-compliance suite (`6c02fee` → `15a1283`).
> 3. Surfaces the prior pass didn't reach — CORS, dependency vulns, request-size limits, fixture-file private-key persistence, gitignore gaps for stray backups, OAuth GET /start backdoor.

## Summary

**11 findings: 0 critical, 2 high, 6 medium, 3 low.**

Densest hot-spots:
- The **OAuth GET /start path** still mints no-nonce states (H4) — the H3 fix in `556e766` made the secure path require nonce binding but didn't deprecate the legacy GET endpoint, leaving the original login-CSRF re-exploitable by any unauthenticated attacker.
- **Six stray `wrangler N.jsonc` / `.bak` backup files** sit in `apps/cloud/api/`, untracked but containing real production D1 + KV resource IDs (M5). The gitignore pattern is too narrow to catch them; one stray `git add -A` away from a credential leak.
- **CORS is undefined** on cloud-api (M6) — the dashboard's `manifest-form` and `file-dispute-form` POST directly browser → cloud-api, and a cross-origin production deploy (`dashboard.agentagora.dev` → `api.agentagora.dev`) requires CORS allow on the cloud-api side. Either CORS is being handled by Cloudflare-platform config we can't see, or both forms break in prod.
- **Production credentials in plaintext fixture file** (M9) — `protocol-compliance` writes Ed25519 private keys to `node_modules/.cache/protocol-compliance/fixtures.json` with default umask perms; a maintainer who runs `--setup` against production has now persisted a publishable signing key on disk.

The crypto primitives (Ed25519, JCS, AES-GCM cookies, Stripe HMAC, JWT EdDSA) remain sound. None of the M-class findings is a ship-blocker — most are configuration / hardening items that an alert operator would catch in the launch-runbook §2 self-test. The H4 OAuth backdoor IS a ship-blocker; recommend gating it behind a deploy flag or removing entirely before flipping the repo public.

---

## Critical

*(none — same as 2026-05 baseline. The crypto + sig-verify primitives are still correct; nothing here is "exploitable today against a correctly-deployed instance." H4 below is a close call; promoted only if you're willing to ship the legacy GET endpoint as-is.)*

---

## High

### H4. ✅ CLOSED 2026-05-13 — OAuth `GET /v1/auth/github/start` mints states without browser-nonce binding

**What.** `apps/cloud/api/src/oauth-github.ts:218-221`. The fix for H3 in `556e766` introduced `POST /start` which embeds a browser-bound `nonceHash` into the signed state. The `/callback` route only verifies the nonce when `payload.nonceHash !== undefined` (`oauth-github.ts:245`). The legacy `GET /start` was kept "for non-browser callers (CI smoke tests, manual curl)" and intentionally produces a state with no `nonceHash`. Any state minted via GET therefore skips the nonce check on callback — exactly the behavior H3 set out to fix.

**Why it's a problem.** The H3 attack rebuilt:

1. Attacker calls `GET https://api.agentagora.dev/v1/auth/github/start` (no auth required) → gets `{ authorize_url, state }`.
2. Attacker delivers the GitHub authorize URL to a victim (phishing, IM, ad).
3. Victim consents on GitHub → GitHub redirects victim's browser to the dashboard's `/login/callback?code=…&state=<attacker_state>`.
4. Dashboard `/login/callback` POSTs `{ code, state }` to cloud-api `/v1/auth/github/callback`.
5. Callback verifies HMAC ✓; payload has no `nonceHash` so the nonce check is skipped ✓; mints session for whatever GitHub identity the victim approved.

This is the same login-CSRF / login-fixation H3 documented. The dashboard's own `/api/auth/github/start` route correctly POSTs with a nonce, but cloud-api accepts no-nonce states from any source — a third-party malicious site can call cloud-api's GET /start directly. The "CI smoke tests, manual curl" use case is a real maintenance workflow, but the trust boundary is wrong: any unauthenticated caller anywhere on the internet gets a forge-able state.

**Suggested fix.** Pick one:

- **(a)** Retire `GET /start` entirely. Smoke test + manual curl can use `POST /start` with `nonce_hash: ""` and the callback rejects empty-string nonce explicitly. One-line change to the smoke script.
- **(b)** Make the `/callback` route require `nonceHash` in payload by default; allow opt-out only when the state carries a separately-signed `cli_marker` claim that the GET endpoint can mint but POST cannot. More complex; doesn't actually buy anything (CI smoke can use POST just as easily).
- **(c)** Cheapest: have the callback reject states without nonceHash in production (`process.env.NODE_ENV === "production"`). Keep the GET-no-nonce path alive in dev only.

Recommendation: **(a)**. The "non-browser caller" use case is hypothetical — every consumer we have today (dashboard, smoke script) can post.

**Effort.** S.

**M3 launch impact.** Recommend fixing **before** flipping the repo public. A single Reddit / X post documenting the GET endpoint is enough to make this attack reproducible by anyone.

---

### H5. ✅ CLOSED 2026-05-13 — Manifest-publish + file-dispute browser forms have no documented CORS allow-list on cloud-api

**What.** `apps/cloud/dashboard/app/(dashboard)/agents/_manifest-form.tsx:204` and `apps/cloud/dashboard/app/(dashboard)/disputes/new/_file-dispute-form.tsx:104` POST `browser → cloud-api` directly with bearer + `Authorization`. The architecture requires a CORS preflight on every such request (Authorization is a non-simple header). `apps/cloud/api/src/` has no `cors`, `Access-Control`, or `OPTIONS` handler — Hono's `cors()` middleware is not imported.

**Why it's a problem.** In the prod deploy described by `docs/launch-runbook.md` §4, the dashboard runs on `dashboard.agentagora.dev` and cloud-api on `api.agentagora.dev`. The browser performs a CORS preflight `OPTIONS /v1/agents` (and `/v1/disputes`) before each POST; without `Access-Control-Allow-Origin` + `Access-Control-Allow-Headers: authorization, content-type`, the preflight 404s and the actual POST never goes out. This means either:

- The preflight is being handled by Cloudflare-platform config (a Workers-route OPTIONS rule, or CF Access policy) outside the codebase — possible but invisible to anyone reading the repo
- Both forms have not yet been tested against a real cross-origin production deploy and silently fail when an operator first tries to publish

Either way the codebase doesn't document the contract.

**Suggested fix.** Add Hono's `cors` middleware in `apps/cloud/api/src/index.ts` with an explicit allow-list:

```ts
import { cors } from "hono/cors";

app.use("/v1/*", cors({
  origin: (origin) => {
    const allow = (env.DASHBOARD_ORIGIN ?? "").split(",").filter(Boolean);
    return allow.includes(origin) ? origin : null;
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["authorization", "content-type", "x-aap-pubkey", "x-aap-signature"],
  credentials: false,
}));
```

Set `DASHBOARD_ORIGIN` as a Worker secret in production (e.g., `https://dashboard.agentagora.dev,https://agentagora.dev`). Public read paths (`GET /v1/agents`, `/healthz`, `/.well-known/jwks.json`) MAY get a wildcard `*` allow since they have no auth header anyway and the manifesto's "agent catalog readable from any browser" goal calls for it. Authenticated routes get the strict allow-list.

**Effort.** S.

**M3 launch impact.** Could be a hidden ship-blocker if cross-origin POSTs aren't actually working in the staging deploy. **Confirm by running a real publish from the deployed dashboard against the deployed cloud-api before launch** — this is exactly what M.10 in `maintainer-tasks.md` is for.

---

## Medium

### M5. ✅ CLOSED (gitignore) 2026-05-13 — Six stray `wrangler N.jsonc` / `.bak` backup files contain production D1 + KV IDs and are not gitignored

**What.** `ls apps/cloud/api/wrangler*` returns:

```
-rw-------  wrangler.jsonc            # tracked? no — gitignored
-rw-r--r--  wrangler.jsonc.example    # tracked, REPLACE_BEFORE_DEPLOY placeholders
-rw-------  wrangler 2.bak
-rw-------  wrangler 2.jsonc
-rw-------  wrangler 3.jsonc
-rw-------  wrangler 3.real-bak
-rw-------  wrangler 4.jsonc
-rw-------  wrangler 4.real-bak
```

Created by `mv` shuffles during CI testing — macOS Finder duplicates files with " 2", " 3", … suffixes. All 6 contain the same content as the real `wrangler.jsonc` (the production D1 + KV resource IDs documented under §M1 of the prior review). The `.gitignore` rule is `apps/cloud/api/wrangler.jsonc` — exact path match. None of the suffixed copies match.

**Why it's a problem.** `git add -A` (or equivalent globbing) inside `apps/cloud/api/` would stage all six files. They'd land in a commit and ship to a public repo at M3 launch. While the file modes are `0600` locally (good — single-user readable), a single accidental commit destroys the §M1 protection.

**Suggested fix.** Two complementary changes:

```
# .gitignore additions
apps/cloud/api/wrangler*.jsonc
apps/cloud/api/wrangler*.bak
apps/cloud/api/wrangler*.real-bak
```

Plus a one-time local cleanup: **the maintainer should `rm` all six files now**. They have served no purpose since the `mv` shuffles that created them; they're stale artifacts.

> **Closure note (2026-05-13).** `.gitignore` widened to `apps/cloud/api/wrangler*.{jsonc,bak,real-bak}` so future macOS Finder duplicates are caught (`git check-ignore -v` confirms). The 6 stray files **still exist locally on the maintainer's machine** — gitignore prevents them from being committed but doesn't delete them. **Maintainer action still required:**
>
> ```bash
> rm "apps/cloud/api/wrangler "{2,3,4}*
> ```

I (Claude) flagged this on commit `da3108f` and `9868a64` — it stayed unaddressed. Given the M3 launch implies flipping the repo public, this finding upgrades from "maintenance hygiene" to "must clean before flip."

**Effort.** S (rm the files + 3 .gitignore lines).

**M3 launch impact.** Block the public flip until the files are gone AND .gitignore is widened. Trigger 1 in the launch runbook explicitly checks for `git log -p | grep secret_pattern` — that catches code committed prior, not untracked-stray files.

---

### M6. (Same as H5 above — listed there as High because of impact.) — *intentionally duplicated cross-reference, ignore.*

— Skipping a number to keep the prior review's M-numbering coherent. M6 is logically the same item as H5 viewed as a config gap; M3 launch impact is what justified the H bump.

---

### M7. NONCES KV + RATE_LIMITS KV silent fallback to in-memory in production — replay protection downgrades quietly when a binding is misconfigured

**What.** `apps/cloud/api/src/index.ts:305-319`. When `env.NONCES` is unbound, the route falls back to `InMemoryNonceStore` (per-isolate). When `env.RATE_LIMITS` is unbound, the route falls back to `InMemoryRateLimiter` (per-isolate). Both emit `console.warn` once per cold start.

**Why it's a problem.** Same failure-mode class as H1 (cookie-secret ephemeral fallback). Per-isolate replay protection is functionally broken at any scale: an attacker hits the cloud-api repeatedly, hops between isolates, and replays any nonce on an isolate that hasn't seen it before. Per-isolate rate limiting is similarly broken — an attacker exceeds the limit on one isolate, then a different request lands on a fresh isolate and the counter is back at zero. Both compromise security guarantees the spec promises (§11.1 replay protection MUST), and both fail silently — the operator's logs show successful publishes and reads.

The prior review tagged this as M3 ("CloudNonceTracker fail-open by default") and explicitly called it documented-not-fixed. M3 launch is the right time to fix.

**Suggested fix.** Mirror the H1 fix: throw at module load when `process.env.NODE_ENV === "production"` AND either binding is missing. Keep the in-memory fallback for `wrangler dev` and tests. RUNBOOK §2 already documents the bindings as required for production.

**Effort.** S.

**M3 launch impact.** Could fix in the same deploy as H4 + H5 + dependency upgrades.

---

### M8. Dependency advisories: 3 highs (Next 14.x DoS × 2, Astro <5.15.8 reflected XSS) shipped to public repo

**What.** `pnpm audit --audit-level=high` reports 3 high-severity advisories — `Next.js 14.2.30` carries 2 (DoS via HTTP request deserialization, DoS via Server Components) and `Astro 4.16.18` carries 1 (reflected XSS via server islands). All three are remotely exploitable. The CI gate currently emits `::warning::` rather than failing the build (commit `9868a64`); upgrade tasks are tracked as M.15 (Next 15.5.15+) and M.16 (Astro 5.15.8+) in `maintainer-tasks.md`.

**Why it's a problem.** Same items the prior pass would have caught if `pnpm audit` was on. The prior review predates these specific CVEs (they landed after 2026-05-04). Mitigations documented in M.15 / M.16 (auth gating reduces blast radius for Next; we don't use server islands so the Astro path is unreachable) are real but not bulletproof — the Astro mitigation depends on a `grep` that any future component change could invalidate.

**Suggested fix.** Land M.15 + M.16 from `maintainer-tasks.md` before the public flip. Both are 2-6 hours of migration work each. After both, drop the audit floor back to `moderate` (M.17, also in maintainer-tasks).

**Effort.** M (per upgrade).

**M3 launch impact.** Strongly recommend before flip. A `pnpm audit` run on Day 1 of the public repo will produce the same 3-highs report we have now and someone will file an issue.

---

### M9. Compliance-suite fixture file persists Ed25519 private keys with default umask perms

**What.** `packages/protocol-compliance/src/setup.ts:204-207` writes the provisioned Ed25519 private key to `node_modules/.cache/protocol-compliance/fixtures.json` via `writeFile(..., utf-8)` — no explicit mode. The file ends up at default umask (typically `0644` on macOS, `0600` on some Linux distros). Sample content (from a local run):

```json
{
  "baseUrl": "http://127.0.0.1:8788",
  "aid": "aid:agentagora:compliance-suite/tier3-fixture",
  "pubkeyB64u": "c1Folvz26wIRk7pMJFkhpxwr7ViFUhfQD5ve1C5eDkA",
  "privkeyB64u": "Ba5S9CZJiAOV5_VD3r0I0bQbPHf-mFR_J70TyvUdNrU"
}
```

**Why it's a problem.** A maintainer who naively runs `pnpm protocol-compliance compliance:setup -- --setup --base-url=https://api.agentagora.dev --bearer=$PROD_BEARER` provisions a real production agent (`aid:agentagora:compliance-suite/tier3-fixture` becomes published to the live registry). The signing key for that agent is now persisted on disk in plaintext, world-readable on macOS by default. Any process / user / malware on the maintainer's machine that can read `node_modules/.cache/` can impersonate the test fixture's AID — sign manifests, audit events, disputes — for as long as the production registry trusts the pinned key.

Threat model is mostly self-inflicted (operator error), but the footgun is sharp: the README explicitly documents `--setup --base-url=` as the primary path and doesn't warn against pointing at production.

**Suggested fix.** Three layered mitigations:

1. **`setup.ts` writes with mode `0600`** — `writeFile(path, data, { mode: 0o600 })` so future malware-on-machine has to run as the same user.
2. **CLI refuses production-shaped URLs unless `--allow-production` is passed** — refuse if base-url contains `agentagora.dev`, `agentagora.io`, or any host without `localhost` / `127.` / `.workers.dev` (sandbox-shaped). The flag is a deliberate "I know what I'm doing" gate.
3. **README.md adds a "do NOT run --setup against production" warning at the top of the Quick start section.**

**Effort.** S (chmod + 30-line CLI guard + README note).

**M3 launch impact.** Soft block. The flag should land before any third-party implementer reads the README and copies the wrong invocation.

---

### M10. Bearer + private key passed via `--bearer=` CLI flag — appears in shell history and `ps` output

**What.** `apps/cloud/api/scripts/smoke.ts:72` and `packages/protocol-compliance/src/cli.ts:47` both accept `--bearer=<TOKEN>` on argv. argv is visible to any process running as the same user (`ps -ef` / `lsof -p`) and is recorded by every interactive shell with history (bash, zsh) by default.

**Why it's a problem.** A bearer that resolves to a real owner is, for cloud-api purposes, a session token. Leaking it via shell history or `ps` output adds a passive credential-exposure vector in a multi-user dev box, and any monitoring agent on the host (e.g., a corporate EDR, a leaked CI runner image) can scrape it.

**Suggested fix.** Accept the bearer via env var (`AAP_TEST_BEARER` for compliance, `SMOKE_BEARER` for smoke) only — drop the CLI flag, or read from stdin with `--bearer-from-stdin`. Env vars also leak via `ps -e` if not careful but are cleaner: shells don't echo them by default, and the maintainer can `set +o history` or use `direnv` to scope them.

**Effort.** S.

**M3 launch impact.** Low. Single-maintainer project; the dev box is the maintainer's own laptop. Worth fixing for hygiene before any external contributor hits these scripts.

---

### M11. No request-body size limits on cloud-api routes

**What.** `apps/cloud/api/src/routes/*.ts` calls `c.req.json()` directly without a `Content-Length` cap. Cloudflare Workers' default body limit is 100 MB; a misbehaving (or hostile) client can send a 99 MB JSON body that the Worker spends CPU + memory parsing before the schema validator rejects it. Audit-ingest is the most exposed (it's intentionally unauthenticated — see Tier 3 finding in `aap-traceability.md` §8).

**Why it's a problem.** A trivial DoS vector. Send 1000 concurrent 99 MB JSON bodies to `/v1/audit/ingest` and the Worker burns through CPU-time-per-request budget for that owner's tenant. Cloudflare's CPU-time limit (50 ms default for Workers) gives some inherent protection, but parsing JSON at 100 MB is rarely under 50 ms.

**Suggested fix.** Add a request-size middleware that rejects `Content-Length > 1 MB` (manifest is the largest legitimate body — typical < 4 KB) with `413 Payload Too Large`. Hono has `bodyLimit()` helper.

**Effort.** S.

**M3 launch impact.** Low. The audit-ingest endpoint is the most exposed and intentionally takes large(ish) batches; a 1 MB cap is generous (~20 events × 50 KB each). M3 launch traffic is unlikely to trigger this — fix before public reaches non-trivial volume.

---

## Low / informational

### L2. Dashboard manifest-form keeps the operator's Ed25519 private key in React state until `setPrivateKey("")`

**What.** `apps/cloud/dashboard/app/(dashboard)/agents/_manifest-form.tsx:144,202`. The user pastes their private key into a textarea (`useState`); after signing, `setPrivateKey("")` wipes the React state. The textarea's DOM `value` is cleared by re-render. `autocomplete="off"` is not set on the textarea.

**Why it's a problem.** Defense-in-depth concerns:
- A browser extension that snoops `<textarea>` content captures the key (the comment block on line 199-201 acknowledges this is best-effort).
- Without `autocomplete="off"`, a password manager may fingerprint the form field by name and prompt to save the value — landing the key in the password manager's vault.
- React state lives across re-renders; the key may persist in JS heap longer than expected.

**Suggested fix.**

- Add `autocomplete="off" data-1p-ignore="true" data-lpignore="true"` to the textarea.
- Change the input to `<input type="password">` with a `type="text"` toggle button — at least password managers would treat it as a sensitive credential.
- Document that the form is the wrong tool for high-value keys (a separate "use the SDK CLI" path is more honest).

**Effort.** S.

**M3 launch impact.** Low. Most M3 publishers are the maintainer themselves; external users reading manifests is M5+ pattern.

### L3. Bearer-paste login (`/api/auth/login`) accepts any string + cloud-api liveness as "valid"

**What.** `apps/cloud/dashboard/app/api/auth/login/route.ts:60-70`. The route validates that `body.token` is a non-empty string, pings cloud-api `/healthz` (no auth), then encrypts the token into the session cookie. Garbage tokens succeed the login flow; the user gets 401s on every subsequent dashboard fetch.

**Why it's a problem.** Not a security issue per se, but the UX gap looks like an auth bug. A user pastes a typo'd token, lands on the dashboard, every page fails to load, no obvious "your token is invalid" message — they think the dashboard is broken.

**Suggested fix.** Have the route hit `GET /v1/agents?owner=ANY_OWNER_ID` with the bearer; any 200/403 means cloud-api accepts the bearer (403 = bearer valid, owner mismatch). 401 means the bearer is invalid → return 401 from the dashboard's login route.

**Effort.** S.

**M3 launch impact.** None on security. Cosmetic UX.

### L4. Stripe Connect short-circuits to 503 BEFORE checking auth — Tier 2 compliance test had to widen its assertion

**What.** Documented in `packages/protocol-compliance/tests/tier2-auth.test.ts` ("Note on 503 acceptance"). When `STRIPE_SECRET_KEY` is unset, `/v1/connect/*` returns `503 not_configured` regardless of bearer presence. The Tier 2 compliance test accepts both 401 (proper auth gating, prod) and 503 (dev fallback).

**Why it's a problem.** Order-of-operations smell: a service-unavailable signal preempts an auth check. In prod (Stripe configured), the order is irrelevant. In dev, an attacker can probe `/v1/connect/account` without auth and confirm the candidate is a cloud-api by the 503 envelope shape — minor information disclosure (an attacker can already guess this from `/healthz` returning 200 with `{ ok: true, version: "0.0.1" }`).

**Suggested fix.** Re-order checks: auth first, service-availability second. Same one-liner in both `/v1/connect/onboarding` and `/v1/connect/account`. Lets the Tier 2 test tighten back to "MUST 401 on missing bearer."

**Effort.** S (≤5 lines).

**M3 launch impact.** None.

---

## Out of scope / not findings

- **`docs/AAP-spec.md` §11.6 PII handling** — protocol-layer aspirational; tested at SDK / responder, not cloud-api. Already documented in `aap-traceability.md` as "not yet tested at protocol layer."
- **`docs/AAP-spec.md` §11.5 Sybil resistance** — explicitly delegated to Cloud policy (KYC, deposit) and not protocol-enforceable. Same.
- **Dashboard Server Components rendering** — Next.js auto-escapes JSX; no `dangerouslySetInnerHTML` use found. Marketing site (Astro) similarly checks clean.
- **D1 SQL injection** — all user-controlled values bind via `?` placeholders; the only template-string interpolations into SQL are static column names + composed WHERE-fragments built from a fixed set. `apps/cloud/api/src/d1-storage.ts` audited for §M3 launch.
- **Stripe webhook timestamp window + HMAC verify** — `apps/cloud/api/src/stripe-webhook.ts` is correct (5-min window, constant-time compare).
- **Audit chain integrity** — `apps/cloud/api/src/routes/audit.ts` correctly verifies (a) per-event signature against the actor's pinned pubkey, (b) `previous_event_hash === expectedPrev`, (c) idempotency on `event_id`. No findings.
- **JCS canonicalization order** — manifest-publish verifies signature against pre-Zod canonical bytes (`apps/cloud/api/src/routes/agents.ts:98-107`), preventing the schema-poisoning class.

---

## Summary table — recommended ordering for fixes

| # | Finding | Severity | Effort | Status | M3-launch order |
|---|---|---|---|---|---|
| H4 | OAuth GET /start nonce backdoor | High | S | ✅ closed 2026-05-13 | Done |
| H5 | Cloud-api CORS allow-list missing | High | S | ✅ closed 2026-05-13 | Done |
| M5 | Stray `wrangler N.jsonc` backups + gitignore | Medium | S | ✅ gitignore closed; maintainer `rm` still required | Pending local cleanup |
| M9 | Fixture file private-key perms + production guard | Medium | S | ✅ closed 2026-05-13 (0o600 + --allow-production gate) | Done |
| M7 | NONCES + RATE_LIMITS production fail-closed | Medium | S | ✅ closed 2026-05-13 (AAP_ENV=production throws at boot) | Done |
| M8 | Next 15.5.16+ / Astro 5.15.8+ upgrades (M.15 / M.16) | Medium | M each | ✅ closed 2026-05-13 (Astro 5.18.1 + Next 15.5.18) | Done |
| M10 | Bearer via env var instead of CLI flag | Medium | S | ✅ closed 2026-05-13 (AAP_TEST_BEARER + SMOKE_BEARER env, --bearer flag deprecated) | Done |
| M11 | Request-body size limits | Medium | S | ✅ closed 2026-05-13 (per-route bodyLimit; 1 MB audit-ingest / 64 KB publish / 16 KB others) | Done |
| L2 | manifest-form private-key DOM hygiene | Low | S | ⬜ open | Cosmetic |
| L3 | Bearer-paste login validates token | Low | S | ⬜ open | UX |
| L4 | /v1/connect auth order before 503 | Low | S | ✅ closed 2026-05-13 (auth check precedes 503 short-circuit) | Done |

**Remaining public-flip blockers**: just **the maintainer's local `rm` of the 6 wrangler backup files** (gitignore closed M5 against future drift, but the files still exist locally). As of 2026-05-13:

- **Closed**: H4 + H5 + M5 (gitignore) + M.15 + M.16 + M8 + M7 + M9 + M10 + M11 + L4. 9 of 11 findings shipped fixes.
- **Open**: L2 (manifest-form DOM hygiene), L3 (bearer-paste validation) — both cosmetic / UX, not security ship-blockers.
- `pnpm audit --prod --audit-level=high` is **0 highs / 0 criticals**.

---

## Cross-references

- Prior pass: [`docs/security-review-2026-05.md`](security-review-2026-05.md)
- Manifesto / governance — protocol vs cloud boundary: [`docs/protocol-stewardship.md`](protocol-stewardship.md)
- Maintainer launch tasks: [`docs/maintainer-tasks.md`](maintainer-tasks.md) (M.15 + M.16 are the dep-upgrade tasks closing M8 here)
- Day-0 oncall surfaces: [`docs/day-0-oncall.md`](day-0-oncall.md)
- Compliance suite: [`packages/protocol-compliance/`](../packages/protocol-compliance/)

---

*This document is read-only audit output. No fixes applied. Maintainer triage required — see "M3-launch order" column above.*
