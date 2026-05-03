# @agentagora/marketing

The AgentAgora marketing site. Single landing page, Astro 4 + Tailwind, static-first.

## What's here

- `src/pages/index.astro` — the landing page (hero, problem, how-it-works, why-now, footer)
- `src/styles/global.css` — Tailwind directives + light reset
- `tailwind.config.mjs` — graphite accent palette, Inter font stack
- `public/favicon.svg` — geometric favicon mark

Copy is sourced from `docs/manifesto.md` and `docs/one-pager.md` in the repo root.

## Develop

From the monorepo root (after `pnpm install`):

```sh
pnpm --filter @agentagora/marketing dev
```

Or from this directory:

```sh
pnpm dev        # astro dev
pnpm build      # astro build → ./dist
pnpm preview    # astro preview
pnpm typecheck  # astro check
```

## Deploy (Cloudflare Pages)

The build output is fully static (`./dist`). To deploy on Cloudflare Pages:

- **Build command**: `pnpm --filter @agentagora/marketing build`
- **Build output directory**: `apps/marketing/dist`
- **Root directory** (advanced): repository root — Pages needs to see the workspace
- **Node version**: 24+ (matches monorepo `engines`)

No SSR, no edge functions, no environment variables required for the current page.

## Constraints

- Single page only — no extra routes, no 404, no blog.
- No framework integrations beyond Tailwind.
- No gradients; one accent color (graphite).
- Update copy by editing `src/pages/index.astro` directly. If the manifesto narrative shifts, re-pull from `docs/manifesto.md`.
