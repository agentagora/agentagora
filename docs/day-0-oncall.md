# Day-0 oncall playbook

> The first 24 hours after Trigger 2 (quiet launch) or Trigger 3 (public launch). Designed for "page rang at 3am, half-awake, can I diagnose this in 60 seconds?" — not for monthly maintenance. For steady-state ops, see [`apps/cloud/api/RUNBOOK.md`](../apps/cloud/api/RUNBOOK.md).
>
> **Owner: weijt606.** Single-maintainer project — the on-call rotation is "you, always."

If this is M3 launch day, **read this once before launching** so the keys-on-keyboard pattern is fresh. Don't read it for the first time at 3am.

---

## 0. The 60-second triage

Open three browser tabs, in this order:

1. **Status page** — `https://<your-status-worker-host>` — outside-vantage liveness probe of `/healthz` and a few key routes.
2. **Cloudflare dashboard → Workers → cloud-api → Logs** — live tail.
3. **GitHub Discussions / Issues** — is anyone complaining?

Then run, in your terminal:

```bash
URL=https://<your-cloud-url>
curl -i "$URL/healthz"
curl -i "$URL/.well-known/jwks.json"
pnpm --filter @agentagora/cloud-api exec wrangler tail --status error
```

If `/healthz` is 200 + JWKS responds + tail is quiet: **it's probably not on our side.** Check the user's report carefully — they might have a network issue, browser extension, or be looking at a stale page.

If any of those three are red: jump to the matching section below.

---

## 1. The five scenarios most likely on Day 0

In the order I expect them by probability:

### 1.1  5xx storm — cloud-api itself is broken

**Smell.** `/healthz` non-200, Cloudflare dashboard shows error rate spike, status page red, dashboard shows "Cloud unreachable" banner.

**60-second checks.**

```bash
# What just deployed?
pnpm --filter @agentagora/cloud-api exec wrangler deployments list | head -5

# What's actually erroring?
pnpm --filter @agentagora/cloud-api exec wrangler tail --status error
```

**Most likely cause (in order):**

1. **A deploy regression.** You shipped within the last hour. Roll back:
   ```bash
   pnpm --filter @agentagora/cloud-api exec wrangler rollback <previous-deployment-id>
   ```
2. **A Worker secret got cleared / renamed.** Output of `wrangler secret list` doesn't match the expected set (RUNBOOK §3.1 step 6). Re-run the §2 rotation procedure for the missing one.
3. **Cloudflare platform incident.** Check `https://www.cloudflarestatus.com/api/v2/status.json`. If yes — wait it out and post a heads-up to Discussions; don't fight a platform outage.
4. **D1 quota or P0 outage.** `wrangler d1 execute DB --remote --command "SELECT 1;"` returns an error. Same as platform — Cloudflare's problem, communicate, wait.

**Communicate.** If outage > 5 min, post to Discussions in the **General** category: "We're seeing issues at <your-cloud-url> since <UTC time>. Diagnosing." Update every 10 min. Close with "Resolved at <UTC time>. Cause: <one sentence>." Cheap honesty earns trust on day 1.

---

### 1.2  GitHub OAuth flow is broken — users can't sign up

**Smell.** Users in Discussions: "I click Sign in with GitHub and end up on a 503 / blank page / redirect loop." Dashboard `/login` works, but `/login/callback` 5xxs.

**60-second checks.**

```bash
# Walk the OAuth flow yourself in an Incognito window. Watch the network tab.
# Capture the request_id from any failed response — every cloud-api response
# carries `X-Request-Id: req_…` in headers AND `request_id` in the JSON body.

# Tail logs filtered to the OAuth routes.
pnpm --filter @agentagora/cloud-api exec wrangler tail --search "/v1/auth/github"

# If you have a request_id from a user's failure, use it directly:
pnpm --filter @agentagora/cloud-api exec wrangler tail --search "req=req_<id>"
```

**Most likely causes (in order):**

1. **Worker secrets cleared.** `wrangler secret list` doesn't show `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET`. Re-set per launch runbook M.5.
2. **OAuth callback URL mismatch.** GitHub OAuth app's callback URL doesn't match `https://<your-cloud-url>/v1/auth/github/callback`. Edit the OAuth app at `github.com/settings/developers`.
3. **`OAUTH_STATE_HMAC_KEY` rotation half-done.** Worker has the new key, dashboard kept the old one (or vice-versa). Both must match; redeploy with consistent values.
4. **Browser extension / third-party-cookie blocker.** If your Incognito works but the user's regular browser doesn't, ask them to retry in Incognito and report back. Document in the welcome thread on Day 1.

**Don't.** Don't disable the OAuth-state nonce check (security review §H3). If state validation is failing, fix the cause; don't bypass.

---

### 1.3  Stripe webhook deliveries failing — payouts and refunds stuck

**Smell.** New users complete onboarding but never see "ready to charge" in dashboard (= `account.updated` not landing). Or auto-refund pipeline lagging beyond 5 min (`charge.refunded` not landing).

**60-second checks.**

```bash
# 1. Stripe dashboard → Developers → Webhooks → click your endpoint.
#    Look at the recent delivery list; failures are red. Click any failed
#    one to see the response body cloud-api returned (most useful debug
#    field). The Stripe dashboard also offers "Resend" — useful AFTER
#    fixing root cause to drain the backlog.

# 2. Tail the webhook handler.
pnpm --filter @agentagora/cloud-api exec wrangler tail --search "/v1/stripe/webhook"

# 3. Verify the signing secret matches what's configured.
pnpm --filter @agentagora/cloud-api exec wrangler secret list | grep STRIPE_WEBHOOK_SECRET
```

**Most likely causes (in order):**

1. **`STRIPE_WEBHOOK_SECRET` mismatch.** You rotated one side without the other. Stripe dashboard → Webhooks → "Signing secret" must equal the Worker secret. Re-run RUNBOOK §2.4 if needed.
2. **Webhook endpoint URL drift.** Endpoint URL in Stripe dashboard doesn't match `https://<your-cloud-url>/v1/stripe/webhook`. Update.
3. **Old webhook delivery from > 5 min ago.** The handler rejects timestamps outside ±5 min tolerance (Stripe replay protection). The "old delivery" failure mode is benign — Stripe retries. Don't panic from a single 400.
4. **D1 unreachable.** Webhook handler does writes; if D1 errors, webhook 500s. See §1.1.

**Manual recovery after fix.** In Stripe dashboard, replay the failed deliveries — click each red row → "Resend." Limit yourself to last 1 hour at a time; if a user's `account.updated` got missed during the gap, the dashboard will eventually re-fetch on next page load.

---

### 1.4  Marketing landing page shows empty catalog or stale data

**Smell.** Visitor lands on the marketing site, the agent catalog section says "We're spinning up — check back in a few minutes" (the empty fallback) or the cards are obviously old.

**60-second checks.**

```bash
# 1. Is /v1/agents responding from outside?
curl -s "$URL/v1/agents" | python3 -m json.tool | head -30

# 2. Is the marketing site fetching at build-time and cached, or fetching
#    fresh? Check the deploy timestamp on the static page header / view-source
#    for the build hash.

# 3. If using Cloudflare Pages: dashboard → Pages → marketing → recent
#    deploys. Trigger a fresh deploy if the catalog should have updated.
```

**Most likely causes (in order):**

1. **Build-time fetch worked but the site cached the empty result.** Re-deploy. The marketing site fetches on build, not at runtime — which means new agents don't appear without a redeploy. Document this trade-off in the welcome thread if it confuses anyone.
2. **`AGENTAGORA_CLOUD_URL` env var wrong on the marketing build.** It's pointing at staging, or `localhost`, or an old Worker subdomain. Check `apps/marketing/astro.config.mjs` env handling.
3. **Cloud-api `/v1/agents` returning empty.** D1 has zero published agents. This is the truthful answer if there really are zero — don't fight it; ship a manifest yourself or tell the user "we just launched, you'll be #1."
4. **Build-time fetch hit timeout/network error.** Marketing site renders the unreachable fallback. Re-deploy after confirming `$URL/v1/agents` works.

---

### 1.5  D1 errors / migration drift

**Smell.** Cloud-api 5xxs on writes only (reads work). Logs say `D1_ERROR` / "no such column" / "no such table".

**60-second checks.**

```bash
# 1. What's actually in D1?
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# 2. What migrations are applied?
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations list DB --remote

# 3. What does the local schema (per migrations dir) expect?
ls apps/cloud/api/migrations/
```

**Most likely cause.** A new migration shipped in the deploy but didn't get applied to remote. Apply it now:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --remote
```

**Don't.** Don't manually `ALTER TABLE` to "patch around" a missing migration. The next migration will assume the prior one ran cleanly; you'll just deepen the drift. Apply in order, or roll back the Worker.

---

## 2. The "I have no idea what's happening" recipe

When the symptom doesn't match any of §1.1–§1.5:

```bash
# 1. Capture state for later.
mkdir -p ~/incident-$(date -u +%Y%m%dT%H%M%SZ) && cd ~/incident-*

pnpm --filter @agentagora/cloud-api exec wrangler tail --status error \
  > tail-error.log 2>&1 &
TAIL_PID=$!

# 2. Smoke the deployed Worker.
pnpm --filter @agentagora/cloud-api smoke -- \
  --url=$URL --bearer=$YOUR_TEST_BEARER --verbose 2>&1 | tee smoke.log

# 3. After 2 minutes of capturing, stop and dump everything.
sleep 120 && kill $TAIL_PID
pnpm --filter @agentagora/cloud-api exec wrangler deployments list \
  > deployments.txt
pnpm --filter @agentagora/cloud-api exec wrangler secret list \
  > secrets.txt 2>&1
pnpm --filter @agentagora/cloud-api exec wrangler d1 execute DB --remote \
  --command "SELECT COUNT(*) FROM agents; SELECT COUNT(*) FROM audit_events;" \
  > d1-counters.txt 2>&1

# 4. The smoke output and tail-error log are usually enough to localize.
cat smoke.log
```

If the smoke script's failing step + the tail log don't tell you what's wrong, **roll back to the previous deployment and post to Discussions** — recovery first, root cause after. `wrangler rollback` is reversible.

---

## 3. Communication template

When something is broken and users are visible, post early. The template:

> ## Status: Investigating — `<UTC HH:MM>`
>
> Some of you are seeing **[symptom]** when you **[action]**. We're investigating. If you have an `X-Request-Id` from a failed response, please paste it in this thread — that lets us pin down your request in our logs in seconds.
>
> Workarounds, if any: **[workaround]**.
>
> Updating this thread every 10 minutes until resolved.

Post in **GitHub Discussions → Q&A** with the title `[INCIDENT YYYY-MM-DD] Brief symptom`. Pin it for the duration. Unpin and edit the title to `[RESOLVED]` when done. Do **not** delete the thread post-resolution — the public history is one of the cheapest trust-building signals you have on day 1.

---

## 4. What you do NOT do on Day 0

- **Don't roll forward.** A 3am hotfix has a P0 chance of making things worse. Roll back, sleep, fix in daylight.
- **Don't schema-migrate.** Wait until after the launch window. Today's bug ≠ today's structural change.
- **Don't disable security checks** (signature verify, OAuth nonce, replay window) to "make the symptom go away." Every one of those guards exists because of a real attack vector. Find the cause; don't bypass.
- **Don't apologize-and-disappear.** A short "I'm investigating" beats silence. Even if you're not making progress.
- **Don't try to fix everything yourself.** If a friend with experience is online and offering help, take it. The hubris-to-cost ratio at 3am is bad.

---

## 5. After-action

Within 48 hours of any non-trivial incident (anything that warranted a Discussions post):

1. Append a short post-mortem to `apps/cloud/api/RUNBOOK.md` §3 — the section that matches the failure mode, with date + cause + fix.
2. If a new failure mode wasn't covered here, **add a §1.6 to this playbook**. The playbook compounds in value as it covers what you've actually seen.
3. If an external user reported the issue, follow up in their thread thanking them by name. They are the most valuable users you have on day 1.

---

## 6. Reference cards (keep these in your head)

| URL pattern | What it does |
|---|---|
| `$URL/healthz` | Liveness — should be 200 with `{ ok: true }` |
| `$URL/.well-known/jwks.json` | OIDC public keys — at least one Ed25519 entry |
| `$URL/v1/agents` | Public catalog — array of manifests |
| `$URL/v1/conversations/<id>` | Audit log read — public |
| `$URL/v1/stripe/webhook` | Stripe POST endpoint — only Stripe should hit this |
| `$STATUS_URL/status.json` | Outside-vantage probe report |

| Wrangler one-liner | Use case |
|---|---|
| `wrangler tail` | Live log stream |
| `wrangler tail --status error` | Errors only |
| `wrangler tail --search "req=req_<id>"` | One specific failed request |
| `wrangler deployments list` | "What just deployed?" |
| `wrangler rollback <id>` | Roll back to a known-good deploy |
| `wrangler secret list` | Confirm secrets are present |
| `wrangler d1 execute DB --remote --command "<sql>"` | Read prod D1 |
| `wrangler d1 migrations list DB --remote` | Migration drift check |
