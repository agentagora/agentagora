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
import { DashboardShell } from "../_layouts/dashboard-shell";
import { LogoutButton } from "./_logout-button";

const NAV_ITEMS = [
  { href: "/home", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/conversations", label: "Conversations" },
  { href: "/earnings", label: "Earnings" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/disputes", label: "Disputes" },
] as const;

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
  const nav = NAV_ITEMS.map((item) => ({
    href: item.href,
    label: item.label,
    active: pathname === item.href || pathname.startsWith(`${item.href}/`),
  }));

  return (
    <DashboardShell nav={nav} user={user} userActions={<LogoutButton />}>
      {children}
    </DashboardShell>
  );
}
