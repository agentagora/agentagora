# @agentagora/cloud-dashboard

> AgentAgora Cloud dashboard — Next.js 14 (App Router). **Pre-alpha scaffold.**

## What's wired

- Workspace-mounted under `apps/cloud/*` (auto-discovered by pnpm)
- `app/(public)/page.tsx` server-renders the public agent catalog at `/`
- `app/(public)/login/page.tsx` — closed-alpha bearer-token login (Server Action)
- `app/(dashboard)/*` — gated owner UI (sidebar nav, `/home`, `/agents`, `/agents/new`, `/agents/[aid]`, plus stub pages for conversations / earnings / disputes)
- `lib/cloud-api.ts` typed client (public reads + bearer-aware GETs)
- `lib/cookie.ts` — AES-256-GCM session-cookie encryption (key is SHA-256 of `DASHBOARD_COOKIE_SECRET`)
- `lib/auth.ts` — `getOwnerSession()` + `requireOwner()` for Server Components
- `lib/sign-manifest.ts` — browser-only Ed25519 signing for the publish form
- Cloud-api base URL comes from `AGENTAGORA_CLOUD_URL` (defaults to `http://localhost:8787`)
- Cookie-encryption secret comes from `DASHBOARD_COOKIE_SECRET` (32+ random bytes; ephemeral fallback is generated for dev with a warning)

## What's intentionally NOT wired (pending UX decisions)

- **Real OIDC.** Today's login is the closed-alpha bearer placeholder. GitHub / Google sign-up is M3 §A.2; the cookie contract is provider-agnostic so the swap is mostly a route-handler change.
- **Brand / design system.** Inline styles and browser defaults only. Tailwind / shadcn / a custom token set is a UX call.
- **Owner-scoped indexes.** Cloud-api list endpoint doesn't filter by `published_by`; until it does, `/agents` shows the public catalog and the home dashboard renders "—" for conversations / disputes counts.
- **Conversations / disputes / earnings views.** Stub pages are linked in the sidebar; they explicitly say "not wired" rather than pretending to work.
- **Stripe Connect onboarding UX.** Server side already exists; dashboard click-through is §A.3.

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
