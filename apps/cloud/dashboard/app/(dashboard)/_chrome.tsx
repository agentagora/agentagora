"use client";

/**
 * Client wrapper around `<DashboardShell />` — exists because the
 * shell needs the current pathname (to mark the active nav item) and
 * the only way to read that without prop-drilling through every page
 * is a Client Component using `usePathname()`. The Server Component
 * in `(dashboard)/layout.tsx` reads + decrypts the session cookie,
 * picks only the safe fields to hand down, and renders this wrapper
 * around the page outlet.
 *
 * The bearer is deliberately NOT passed through here — it stays on
 * the server boundary. The user-facing label / provider / GitHub
 * handle are serializable identity tokens, safe to ship to the
 * client side of the layout tree.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell, type NavGroup } from "../_layouts/dashboard-shell";
import { LogoutButton } from "./_logout-button";
import { NavIcon, type NavIconName } from "./_nav-icons";
import { SystemStatusPill } from "./_system-status-pill";

interface RawNavItem {
  href: string;
  label: string;
  iconName: NavIconName;
}

const NAV_GROUPS: ReadonlyArray<{ heading?: string; items: ReadonlyArray<RawNavItem> }> = [
  {
    heading: "Workspace",
    items: [
      { href: "/home", label: "Dashboard", iconName: "dashboard" },
      { href: "/agents", label: "Agents", iconName: "agents" },
      { href: "/conversations", label: "Conversations", iconName: "conversations" },
      { href: "/disputes", label: "Disputes", iconName: "disputes" },
    ],
  },
  {
    heading: "Payments",
    items: [
      { href: "/earnings", label: "Earnings", iconName: "earnings" },
      { href: "/onboarding", label: "Onboarding", iconName: "onboarding" },
    ],
  },
  {
    heading: "Account",
    items: [
      { href: "/help", label: "Help", iconName: "help" },
      { href: "/settings", label: "Settings", iconName: "settings" },
    ],
  },
];

export interface DashboardChromeUser {
  /** What the topbar displays — `@gh-login` for OAuth, raw label otherwise. */
  label: string;
  /** Sub-label under the main one. `"github"` for OAuth, undefined for bearer. */
  provider?: string;
}

interface Props {
  user: DashboardChromeUser;
  children: ReactNode;
}

export function DashboardChrome({ user, children }: Props) {
  const pathname = usePathname() ?? "";

  const nav: NavGroup[] = NAV_GROUPS.map((group) => ({
    heading: group.heading,
    items: group.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: <NavIcon name={item.iconName} />,
      active: pathname === item.href || pathname.startsWith(`${item.href}/`),
    })),
  }));

  return (
    <DashboardShell
      nav={nav}
      user={user}
      statusSlot={<SystemStatusPill />}
      userActions={<LogoutButton />}
    >
      {children}
    </DashboardShell>
  );
}
