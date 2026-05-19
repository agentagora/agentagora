import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark, Container, cn } from "../_components";

export interface NavItem {
  href: string;
  label: string;
  /** Match if `pathname === href` OR `pathname.startsWith(href + "/")`. */
}

interface DashboardShellProps {
  /** The list of left-rail nav items. Pages compute `active` against the current pathname and pass the resolved list in. */
  nav: Array<NavItem & { active: boolean }>;
  /** Display name + provider for the user — shown in the top-right corner. */
  user: { label: string; provider?: string };
  /** Optional slot to the right of the user label — typically the logout button. */
  userActions?: ReactNode;
  /** The page's main content. The shell handles outer padding + max width. */
  children: ReactNode;
}

/**
 * Layout for all authenticated dashboard pages. Provides:
 *
 *   - Topbar with brand mark + user identity + actions slot
 *   - Left rail with section navigation
 *   - Main column with consistent padding
 *
 * Pages render their own `<h1>` and content inside `children` —
 * the shell deliberately doesn't impose a page header pattern
 * because some pages want full-width tables and some want
 * single-column forms with breadcrumbs.
 */
export function DashboardShell({ nav, user, userActions, children }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-accent-50/40">
      <header className="border-b border-accent-100 bg-white">
        <Container width="full" className="flex h-14 items-center justify-between gap-4 px-6">
          <Link href="/home" className="flex items-center" aria-label="AgentAgora home">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-xs leading-tight sm:block">
              <div className="font-medium text-accent-900">{user.label}</div>
              {user.provider && <div className="text-accent-500">via {user.provider}</div>}
            </div>
            {userActions}
          </div>
        </Container>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r border-accent-100 bg-white md:block">
          <nav aria-label="Sections" className="flex flex-col gap-0.5 p-3">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  item.active
                    ? "bg-accent-100 font-medium text-accent-900"
                    : "text-accent-700 hover:bg-accent-50 hover:text-accent-900",
                )}
                aria-current={item.active ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="flex-1 py-8">
          <Container width="lg">{children}</Container>
        </main>
      </div>
    </div>
  );
}

/**
 * Mobile-friendly horizontal-scroll nav. Pages that want the
 * mobile / narrow-viewport experience can render this above
 * their content; in PR 1 we ship it but no page uses it yet.
 */
export function DashboardMobileNav({
  nav,
}: {
  nav: Array<NavItem & { active: boolean }>;
}) {
  return (
    <div className="-mx-6 mb-6 overflow-x-auto border-b border-accent-100 bg-white px-6 md:hidden">
      <nav aria-label="Sections (mobile)" className="flex gap-1 py-2">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
              item.active
                ? "bg-accent-100 font-medium text-accent-900"
                : "text-accent-600 hover:bg-accent-50 hover:text-accent-900",
            )}
            aria-current={item.active ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
