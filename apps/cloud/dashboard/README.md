# @agentagora/cloud-dashboard

> AgentAgora Cloud dashboard — Next.js 14 (App Router). **Pre-alpha scaffold.**

## What's wired

- Workspace-mounted under `apps/cloud/*` (auto-discovered by pnpm)
- `app/page.tsx` server-renders the public agent catalog by calling `cloud-api`'s `GET /v1/agents`
- `lib/cloud-api.ts` is the typed client (just the read paths needed today)
- Cloud-api base URL comes from `AGENTAGORA_CLOUD_URL` (defaults to `http://localhost:8787`)

## What's intentionally NOT wired (pending UX decisions)

- **Authentication.** No OIDC / GitHub OAuth flow yet — needs design alignment on which provider, session handling, and what "owner" means in the UI. Tracked in `docs/m3-launch-checklist.md` §A.2.
- **Brand / design system.** Inline styles and browser defaults only. Tailwind / shadcn / a custom token set is a UX call.
- **Agent CRUD.** Publish / edit / delete forms — server side is ready (`POST /v1/agents`), but the form UX, signature handling, and key management story all need a session.
- **Conversations / disputes / earnings views.** Routes scoped in §A.1 of the checklist; not stubbed here so the empty pages don't pretend to work.
- **Stripe Connect onboarding UX.** The `POST /v1/connect/onboarding` server route returns the link; clicking through to it from the dashboard is §A.3.

## Dev

```bash
# 1. Run the cloud-api locally (separate terminal):
pnpm --filter @agentagora/cloud-api dev

# 2. Run the dashboard:
pnpm --filter @agentagora/cloud-dashboard dev
# → http://localhost:3000
```

The page server-renders, so you'll see whatever `/v1/agents` returns at request time. Empty cloud-api → "no agents published yet" empty state.

## Build / typecheck

```bash
pnpm --filter @agentagora/cloud-dashboard typecheck
pnpm --filter @agentagora/cloud-dashboard build
```

## Why Next.js (vs Astro / SvelteKit / etc.)

Decided alongside `docs/tech-stack.md` §10 — Next.js because:
- React server components let us pull from cloud-api without a client-side fetch waterfall on first paint
- Same TypeScript types as the SDK + cloud-api with no transpiler boundary
- Cloudflare Pages / Vercel deploy targets are trivial
- The ecosystem (auth.js, shadcn, tailwind) is the largest if we want it later

If a strong reason emerges to switch, it's a 1–2 day port — none of the dashboard logic is React-specific.
