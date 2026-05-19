/**
 * External link surface for the marketing site.
 *
 * Today the AgentAgora repo is private. Anonymous visitors landing on
 * the marketing site can't follow GitHub links to the repo / issues /
 * docs / discussions — those all 404 without auth. Until the repo
 * flips public (planned for Trigger 2 of `docs/launch-runbook.md`)
 * we route every "GitHub-public" CTA to a mailto fallback so the
 * surface degrades gracefully instead of dead-ending.
 *
 * Flipping the switch:
 *   1. Set the env var REPO_PUBLIC=true at build time.
 *   2. The next `pnpm --filter @agentagora/marketing build` rewrites
 *      every link to its real GitHub destination.
 *   3. No code change required at the call sites.
 *
 * Set CONTACT_EMAIL to override the fallback target.
 */

const REPO_PUBLIC = process.env.REPO_PUBLIC === "true";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "hello@agentagora.dev";

const REPO = "https://github.com/agentagora/agentagora";

function mailto(subject: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`AgentAgora — ${subject}`)}`;
}

export interface MarketingLink {
  /** Display label. May change between public + private to set expectations. */
  label: string;
  /** Resolved href. */
  href: string;
}

export const links = {
  /** True iff the repo is publicly accessible. Page logic can branch on
   *  this when a "public" surface needs different copy entirely. */
  repoPublic: REPO_PUBLIC,

  /** "View on GitHub" button. Hero CTA, header nav button, footer item. */
  repo: REPO_PUBLIC
    ? { label: "View on GitHub", href: REPO }
    : { label: "Request early access", href: mailto("early access") },

  /** "GitHub" header nav (compact label variant of repo). */
  repoNav: REPO_PUBLIC
    ? { label: "GitHub", href: REPO }
    : { label: "Contact", href: mailto("hello") },

  /** Issues link (footer "Status" / "File a bug"). */
  issues: REPO_PUBLIC
    ? { label: "Issues", href: `${REPO}/issues` }
    : { label: "Reach the team", href: mailto("bug report or design critique") },

  /** Discussions. Pinned welcome thread once public. */
  discussions: REPO_PUBLIC
    ? { label: "Discussions", href: `${REPO}/discussions` }
    : { label: "Reach the team", href: mailto("question or idea") },

  /** Docs tree. */
  docs: REPO_PUBLIC
    ? { label: "Docs", href: `${REPO}/tree/main/docs` }
    : { label: "Docs (early access)", href: mailto("docs early access") },

  /** Manifesto deep link. */
  manifesto: REPO_PUBLIC
    ? { label: "Manifesto", href: `${REPO}/blob/main/docs/manifesto.md` }
    : { label: "Manifesto", href: mailto("manifesto") },
} as const satisfies Record<string, MarketingLink | boolean>;
