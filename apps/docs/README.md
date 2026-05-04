# @agentagora/docs

VitePress documentation site for AgentAgora. Static-first; deploys to Cloudflare Pages.

## What's here

```
apps/docs/
├── .vitepress/config.ts   # site config: title, sidebar, theme
├── index.md               # landing page (home layout)
├── intro.md               # narrative introduction
├── quickstart.md          # define + serve + call an agent
├── concepts/
│   ├── aid.md             # Agent Identity
│   ├── manifest.md        # Capability manifest
│   ├── audit.md           # Signed, hash-linked audit chain
│   └── disputes.md        # Council-resolved disputes
├── protocol.md            # link out to docs/AAP-spec.md
├── sdk.md                 # SDK reference (placeholder until M3)
├── cloud-api.md           # link out to apps/cloud/api/README.md
└── self-host.md           # placeholder until M9
```

Concept pages quote 2-3 paragraphs from the spec verbatim and link to the canonical source. They are not the source of truth — `docs/AAP-spec.md` is.

## Dev

```bash
pnpm install
pnpm --filter @agentagora/docs dev        # local dev server (default :5173)
pnpm --filter @agentagora/docs build      # static site → .vitepress/dist
pnpm --filter @agentagora/docs preview    # preview production build
pnpm --filter @agentagora/docs typecheck  # tsc --noEmit
```

## Conventions

- **Default VitePress theme only.** No custom CSS, no component overrides.
- **Each page ≤ 600 words.** Concept pages may quote spec excerpts plus their own framing.
- **Stub pages must say what's coming and link to the canonical source.** No fake-detailed content.
- **Edit the source, not the doc.** When the AAP spec, the SDK README, or the Cloud API README change, refresh the relevant excerpts here.

## When to deploy this

Wait until the repo is public — see [`docs/launch-runbook.md`](../../docs/launch-runbook.md) for the trigger framework.

Most pages link to source files at `https://github.com/agentagora/agentagora/blob/...`. While the repo is private, every "Lifted from `apps/examples/two-agents/...`" reference 404s for anonymous visitors. Unlike the marketing site (which has been hardened with a `REPO_PUBLIC` env-var flag and mailto fallbacks at `apps/marketing/src/lib/links.ts`), the docs site's value proposition **is** the source-link density. Replacing those with mailtos would degrade the read experience worse than just deferring deploy.

The TypeDoc-generated `sdk-reference/` block emits the same shape: every type and method links back to `packages/sdk/src/...` on GitHub. That's a feature when the repo is public; a footgun before.

The simple deploy story:

1. Don't deploy the docs site until Trigger 2 of the launch runbook (= repo flips public).
2. Deploy on the same day you flip — pages live, links live, you're done.
3. Until then, `pnpm dev` locally if you want to read.
