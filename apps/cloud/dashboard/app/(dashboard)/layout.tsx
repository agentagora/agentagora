/**
 * Authenticated dashboard layout.
 *
 * Sidebar nav + outlet. Requires the session cookie; `requireOwner()`
 * redirects to /login if the cookie is missing, expired, or
 * tampered. The cookie content is then forwarded down to children
 * via Server-Component prop drilling — children call
 * `getOwnerSession()` themselves rather than reading from props,
 * which keeps the contract obvious and avoids accidental leakage of
 * the bearer into client bundles.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { requireOwner } from "../../lib/auth";
import { LogoutButton } from "./_logout-button";

const navItems = [
  { href: "/home", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/conversations", label: "Conversations" },
  { href: "/earnings", label: "Earnings" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/disputes", label: "Disputes" },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireOwner();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 220,
          background: "#fff",
          borderRight: "1px solid #e3e3e3",
          padding: "24px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div>
          <Link
            href="/home"
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#111",
              textDecoration: "none",
            }}
          >
            AgentAgora
          </Link>
          <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>cloud dashboard</div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                color: "#222",
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: "auto", borderTop: "1px solid #eee", paddingTop: 16 }}>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 8 }}>
            Signed in as{" "}
            <strong>
              {session.provider === "github" && session.githubLogin
                ? `@${session.githubLogin}`
                : session.ownerLabel}
            </strong>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main style={{ flex: 1, padding: "32px 40px", maxWidth: 960 }}>{children}</main>
    </div>
  );
}
