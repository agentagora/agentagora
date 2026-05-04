# AgentAgora security review — 2026-05

> Read-only audit performed on commit `2af5b8f29031c02a1b880252e5878e6e182df561`. No code changes were made.

## Summary

Eight findings: 0 critical, 3 high, 4 medium, 1 low. The dashboard's `apps/cloud/dashboard/lib/cookie.ts` is the densest single file (2 findings — ephemeral fallback + non-`__Host-` cookie name). The single highest-leverage fix is the dashboard cookie ephemeral-secret fallback (H1): a missing/short `DASHBOARD_COOKIE_SECRET` silently activates a per-process random key with only a `console.warn`, instead of failing closed. That one switch is what backs every dashboard bearer-token cookie on the platform.

The crypto primitives themselves (Ed25519 signing, JCS canonicalization, manifest sig-before-Zod ordering, AES-GCM cookie crypto with random IV per write, HMAC constant-time comparison on Stripe webhooks, replay-protection windows + per-isolate nonce TTLs) are sound. Most findings are about *how the surrounding wiring fails when an operator skips a step*.

---

## Critical

*(none — empty bucket is honest. Nothing in the code path I read constitutes "ship-blocker, exploitable today against a correctly-deployed instance".)*

---

## High

### H1. Dashboard session-cookie key has an ephemeral random fallback when `DASHBOARD_COOKIE_SECRET` is missing or short

**What.** `apps/cloud/dashboard/lib/cookie.ts:71-94` (`resolveSecret`). When `DASHBOARD_COOKIE_SECRET` is unset OR shorter than 32 bytes, the dashboard generates a per-process `Uint8Array(48)` via `crypto.getRandomValues` and uses that as the key for AES-256-GCM session cookies, logging only `console.warn(...)`.

**Why it's a problem.** A misconfigured production deploy looks healthy: the dashboard accepts logins, mints cookies, and serves authenticated routes. But (a) every replica/instance has its own key, so cookies don't survive a process restart or roll-out — users keep getting silently logged out, masking the misconfiguration; (b) operators believe their cookie key is the value in their secret store when it's actually random; (c) the warning fires once per process — easy to miss in a streaming log. RUNBOOK §2.6 even documents rotating the secret, so it's clearly meant to be persistent.

**Suggested fix.** Throw at module load if `DASHBOARD_COOKIE_SECRET` is unset or `< 32` bytes when `process.env.NODE_ENV === "production"`. Keep the dev fallback gated behind `NODE_ENV !== "production"`, and replace `console.warn` with `console.error` in dev so it's visible.

**Effort.** S.

---

### H2. Cookie name lacks the `__Host-` prefix despite carrying all the listed flags

**What.** `apps/cloud/dashboard/lib/cookie.ts:50` defines `COOKIE_NAME = "agentagora_session"`. The cookie is set with `httpOnly`, `sameSite: "lax"`, `secure` (in production), `path: "/"`, no `Domain`. The header comment (lines 47-49) explicitly explains why the prefix was skipped — to keep `next dev` over plain HTTP working.

**Why it's a problem.** Without `__Host-`, a sibling subdomain that the operator does not own (or a subdomain compromised by an attacker) can set a cookie with the same name on a parent-domain scope, which the browser then sends to the dashboard alongside the legitimate cookie. This is the textbook cookie-fixation/overwrite vector that `__Host-` was added to defeat. The leaked-bearer impact is identical to a stolen session.

**Suggested fix.** Use two names — `agentagora_session_dev` for `next dev` (`NODE_ENV !== "production"`) and `__Host-agentagora_session` in production — chosen at boot. Keeps the dev story working, eliminates the parent-domain cookie-overwrite vector in prod.

**Effort.** S.

---

### H3. OAuth `state` does not bind to a session — pre-login CSRF / login-fixation window

**What.** `apps/cloud/api/src/oauth-github.ts:178-187` (`/start`) and `:355-401` (`signState`/`verifyState`). The state token contains only `{ issuedAt }` plus an HMAC. There is no nonce stored in the user's browser (cookie or otherwise) that the `/callback` then re-checks; any unexpired state HMAC-signed by cloud-api is accepted from any browser.

**Why it's a problem.** Classical OAuth login-CSRF. An attacker calls `POST /v1/auth/github/start` (it's unauthenticated — see `index.ts:241-263`), gets a fresh signed `state`, and tricks a victim into visiting `https://github.com/...&state=<attacker_state>`. The victim consents on GitHub; GitHub redirects the *victim's* browser to the dashboard `/login/callback?code=…&state=<attacker_state>`. The HMAC verifies, the dashboard mints a session — but tied to whatever GitHub identity the victim approved. The dashboard's own `start/route.ts` does not store the `state` it received in any user-bound storage either, so there's nothing to compare on the way back. The 10-minute freshness window is the only defense, and that's a policy timer, not an identity-of-the-browser binding.

**Suggested fix.** When the dashboard's `/api/auth/github/start` redirects the user to `authorize_url`, have it also `Set-Cookie` an `oauth_state` cookie (httpOnly, SameSite=Lax, short-lived) containing either the full state string or its hash. The callback page re-reads that cookie and aborts unless the cookie value matches `state`. Cloud-api does not need to change.

**Effort.** S.

---

## Medium

### M1. `wrangler.jsonc` ships sentinel UUIDs for D1 and KV namespaces

**What.** `apps/cloud/api/wrangler.jsonc:17` (`"database_id": "00000000-0000-0000-0000-000000000000"`), `:27` and `:31` (KV namespace ids `00000000000000000000000000000000` / `0…01`). DEPLOY.md §1 calls them out as sentinels meant to be replaced.

**Why it's a problem.** A `wrangler deploy` run from a freshly-cloned repo without manual edits will succeed against placeholder bindings. Workers won't catch this at boot — `env.DB` will simply throw at first query, and `env.NONCES` falls back to in-memory (which is the documented behavior — see `index.ts:296-299`). The risk is that an operator believes prod is wired correctly when it's actually fronting an empty placeholder DB or running with per-isolate nonce dedup. This is exactly the "fail-open by default" footgun the RUNBOOK warns about.

**Suggested fix.** Either (a) replace the sentinels with the literal string `REPLACE_BEFORE_DEPLOY` so wrangler's config validator rejects the file, or (b) move the bindings into a CI-substituted template (`wrangler.template.jsonc` → `wrangler.jsonc` via deploy-time codegen), with the placeholder explicitly outside the schema's `[a-f0-9-]` UUID regex.

**Effort.** S.

---

### M2. TOFU pubkey pin can be bypassed for legacy agent rows whose `pubkey` column is the empty default

**What.** `apps/cloud/api/migrations/0002_pubkey.sql:8` adds the column as `pubkey TEXT NOT NULL DEFAULT ''`. The publish-route check at `apps/cloud/api/src/routes/agents.ts:126` is `if (existing.pubkey && existing.pubkey !== pubkeyHeader)`. The `existing.pubkey &&` truthy guard short-circuits when the value is the empty string.

**Why it's a problem.** Any row written before migration `0002` (and never updated since) has `pubkey === ""`. A bearer that controls that owner can publish a *new* signing key against the existing AID and pass the TOFU check, because the comparison is skipped. In fresh deploys this never fires (every published row will have a non-empty pubkey), but for any existing production where the migration ran against rows with old data, the empty-pubkey rows are walking past the pin.

**Suggested fix.** Drop the `existing.pubkey &&` guard — once the pubkey is non-null, the comparison is safe; once empty, the comparison should *fail closed* (an explicit "this AID has no pinned key, refuse update until ops resets it" branch). Or write a one-shot migration that backfills empty-pubkey rows from the manifest's signature key and then `ALTER TABLE … DROP DEFAULT`.

**Effort.** S.

---

### M3. CloudNonceTracker fails open by default — cloud-api outage downgrades to per-isolate replay protection

**What.** `packages/sdk/src/cloud-nonce-tracker.ts:71-91`. When `/v1/nonces/check` returns an unexpected status or the fetch throws, the tracker falls back to an `InMemoryNonceTracker`. This is documented in the JSDoc, but it is the *default* behaviour.

**Why it's a problem.** During a cloud-api incident, a coordinated replay attacker can land replay traffic across multiple isolates while the fallback's per-isolate state can't see them. The `console.warn` fires per-call but doesn't change the verdict. The tradeoff is intentional — the doc-string explicitly mentions "agents stay available during outages" — but the default is the un-safe one for any agent that already opted into cloud-backed dedup.

**Suggested fix.** Flip the default: when an operator passes a `CloudNonceTracker`, default the fallback to a tracker that returns `false` (replay-rejected) on cloud failure, and require an explicit `fallback: new InMemoryNonceTracker()` to opt back into fail-open. Failing open on replay protection should be a deliberate decision, not the path of least resistance.

**Effort.** S.

---

### M4. `/api/auth/github/start` blindly trusts cloud-api's `authorize_url` as the redirect target

**What.** `apps/cloud/dashboard/app/api/auth/github/start/route.ts:73`: `return NextResponse.redirect(body.authorize_url, { status: 303 });`. The only validation is `if (!body.authorize_url)` — no check that the host is `github.com`.

**Why it's a problem.** If the cloud-api response is ever spoofed or compromised (DNS, mis-issued cert, MITM in dev/preview deploys, regression that returns an attacker URL), the dashboard becomes an unauthenticated open-redirector at `/api/auth/github/start`. Phishing kits love endpoints on a trusted domain that 303 to anywhere.

**Suggested fix.** After parsing `body.authorize_url`, do `const target = new URL(body.authorize_url); if (target.host !== "github.com") return redirect("/login?error=github_start_failed")`. Constant-time on a single string compare; cheap.

**Effort.** S.

---

## Low / informational

### L1. Stripe API error messages are forwarded into the API's 502 response body

**What.** `apps/cloud/api/src/routes/connect.ts:221-225` (`stripeFailure`) returns `c.json({ error: "stripe_unavailable", op, message }, 502)` where `message` is the raw `err.message`. `apps/cloud/api/src/stripe.ts:99-107` builds that message by concatenating `res.status` and the response body text.

**Why it's a problem.** Stripe error bodies sometimes echo the request shape back (PaymentIntent IDs, Connect account IDs, parameter names). Surfacing them to the publishable HTTP response trades operator debuggability for a tiny info-leak vector.

**Suggested fix.** Log the verbose form via `console.error` (already happens) but return only `{ error: "stripe_unavailable", op }` to the client. Owners can correlate via the cloud-api log timestamp.

**Effort.** S.

---

## Out of scope / not findings

These were considered and ruled out — listed so future readers don't re-discover them:

- **Manifest signature is verified BEFORE Zod parse.** `routes/agents.ts:99-112` canonicalizes the raw JSON the client posted and verifies the signature against those exact bytes, then runs `ManifestSchema.safeParse(raw)`. Correct ordering.
- **Stripe webhook HMAC uses constant-time string compare** (`stripe-webhook.ts:112-119`). 5-minute timestamp window matches Stripe's library default.
- **OAuth state HMAC verify uses Web Crypto's `subtle.verify`** which the doc-comment correctly notes is constant-time for same-length inputs (`oauth-github.ts:386-389`).
- **AES-GCM IV is freshly random for every cookie write** (`cookie.ts:98-99`). No IV reuse.
- **GitHub access token is discarded after one `/user` fetch** and never reaches the browser (`oauth-github.ts:230-238`). The cloud-issued opaque bearer is a fresh 32 bytes, not derived from anything GitHub returned.
- **D1 queries use `.bind(...)` parameterization throughout** — no string concatenation into SQL anywhere in `d1-storage.ts`. The `LIKE` filter on `searchAgents` builds the `%…%` pattern in code and binds it; safe.
- **Bearer tokens are not logged.** No `console.*` site I read includes a token, secret, or bearer.
- **Disputes GET-by-ID is intentionally unauthenticated** — dispute IDs are 128 bits of `crypto.getRandomValues` (`routes/disputes.ts:324-330`) and the route is documented as public-precedent reading. Flagging the design choice, not the implementation.
- **Audit-event ingest is intentionally unauthenticated** — the actor's signature on each event is the auth, validated against the pinned pubkey in `routes/audit.ts:244`. Documented in the file's header.
- **Owner-scoping on disputes/conversations/agents** does the ownership re-check explicitly via `agent.publishedBy !== ownerId` (`routes/disputes.ts:166`, `:252`; `routes/audit.ts:145`; `routes/agents.ts:193`). Cross-tenant path-traversal-style queries return 403, including the "AID-existence oracle" guard at disputes line 248-261.
- **Replay-protection timestamp window** (`agent.ts:166-167`) is asymmetric — 5 min past, 30 s future — which is correct for clock-skew tolerance.
- **`canonicalizeForSigning` rejects floats** (`canonical.ts:28-52` SDK side; `_crypto.ts:100-122` cloud side) so manifest decimals can't drift across runtimes.
- **The narrative field on disputes** (free text, ≤ 8192 chars) is rendered through React text children in `disputes/page.tsx:317`, which auto-escapes — no `dangerouslySetInnerHTML` anywhere in the dashboard tree (verified by grep).
- **`glob@10.5.0` deprecation warning** during install is from a transitive dependency. It is not used by any first-party code on the runtime path; only relevant if it ever ends up in the Worker bundle, which the bundle-size guard would catch.
- **`stripe@^17.5.0` is in the SDK's deps** but the `createStripeChannelFromKey` path imports it via a dynamic `await import("stripe")` (`settlement/stripe.ts:178`), and the doc-string explicitly tells edge runtimes to pass `Stripe.createFetchHttpClient()`. Workers-incompatible only if the host doesn't follow that. Cloud-api itself avoids the package entirely (`stripe.ts` hand-rolls fetch).
- **`AID_REGEX`** (`identity.ts:16-17`) is anchored at both ends, so prototype-pollution-style payloads (`__proto__/foo`) cannot pass as AIDs.
- **JWT issuance** (`oidc.ts`): `alg: "EdDSA"` is hard-coded both in issue and in the JWKS document; no `alg: "none"` confusion is reachable. The kid is a deterministic 16-char prefix of `sha256(pubkey)`, so per-key uniqueness is automatic. Token TTL defaults to 3600 s and is enforced via `exp`.
- **Cookie `secure` flag** is only set in `NODE_ENV === "production"`. Same dev-localhost concession as the `__Host-` prefix omission.
