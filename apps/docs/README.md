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
