/**
 * Authenticated dashboard layout.
 *
 * Server-only: reads + decrypts the session cookie via `requireOwner()`
 * (redirects to /login on miss) and hands the user-display fields to
 * the client-side `<DashboardChrome />` wrapper. The bearer never
 * crosses the server → client boundary here — pages that need it
 * call `getOwnerSession()` themselves, same pattern as the original
 * scaffold.
 */

import type { ReactNode } from "react";
import { requireOwner } from "../../lib/auth";
import { DashboardChrome } from "./_chrome";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireOwner();

  const label =
    session.provider === "github" && session.githubLogin
      ? `@${session.githubLogin}`
      : session.ownerLabel;
  const provider = session.provider === "github" ? "github" : undefined;

  return <DashboardChrome user={{ label, provider }}>{children}</DashboardChrome>;
}
