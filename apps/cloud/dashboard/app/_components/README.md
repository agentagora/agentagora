# Dashboard design system

Source of truth for the AgentAgora dashboard's visual identity.
Mirrors the marketing site (graphite accent palette + Inter
Variable + system mono) so the two surfaces read as one product.

## Tokens

| Token | Value | Where it comes from |
|---|---|---|
| Accent palette | `accent.{50…900}` graphite | `tailwind.config.ts` — mirrors `apps/marketing/tailwind.config.mjs` |
| Sans font | `'Inter Variable'`, then `Inter`, then system fallbacks | Loaded via `@fontsource-variable/inter` in `app/globals.css` |
| Mono font | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Tailwind `font-mono` |
| Body color | `bg-white text-accent-800` | `@layer base body` |
| Selection | `bg-accent-800 text-white` | `@layer base ::selection` |

## Primitives (`app/_components/`)

| Component | Purpose | Props of note |
|---|---|---|
| `Button` | All action triggers | `variant: primary \| secondary \| ghost \| danger`, `size: sm \| md \| lg`, `fullWidth` |
| `Input` | Text / number / password fields | `mono` for keys/AIDs, `invalid` to mark errored |
| `Label` | Field label | **`htmlFor` is required** (the id of the control); `hint` for muted "(optional)" suffix |
| `Field` | Vertical stack of label + input + hint/error | Optional convenience wrapper; pages can compose by hand |
| `FormError` | Below-input error line | — |
| `FormHint` | Below-input help line | — |
| `Card` + `CardHeader` + `CardBody` + `CardFooter` | Section container | `CardBody flush` removes padding (for tables) |
| `Badge` | Inline status pill | `tone: neutral \| success \| warn \| danger \| info` |
| `Alert` | Page-level banner | `tone`, `title` |
| `Container` | Page max-width wrapper | `width: sm (480) \| md (720) \| lg (1180) \| full` |
| `BrandMark` | The geometric AgentAgora mark | `withWordmark` |

## Layouts (`app/_layouts/`)

| Layout | Purpose |
|---|---|
| `AuthShell` | Pre-auth views (`/login`, `/login/callback`) — centered card on accent gradient, brand mark above |
| `DashboardShell` | Authed views — topbar (brand + user + actions), left rail nav, padded main column |
| `DashboardMobileNav` | Horizontal-scroll nav for narrow viewports (sits above content inside `DashboardShell`) |

## Conventions

- **Never use inline `style={{...}}` for new code.** Existing pages still do; PRs 2-4 migrate them.
- **Compose with `cn(...)`** — wrapper around `clsx`. Don't reach for `classnames` or string concat.
- **Class order:** layout → spacing → color → typography → interactive states. Biome doesn't enforce this; keep it consistent by convention.
- **Aria-current on active nav** is the source of truth for "you are here" — the visual style is derived from it, not the other way around.
- **Mobile breakpoints:** components are mobile-first; `md:` is the sidebar threshold (768px), `sm:` is the user-label-shows threshold (640px).

## What's NOT here yet (deferred)

- **Toast / notification stack** — none of the current dashboard flows need them.
- **Dialog / drawer** — added if/when a page needs modal flow.
- **Data table primitive** — PR 3 (agents list) will introduce a `Table` primitive once the actual columns are settled.
- **Dark mode** — `color-scheme: light` is locked for now; opt-in dark mode is a follow-up if the project adopts one across marketing + dashboard.
