/**
 * Root layout. Intentionally bare — fonts, theme, navigation chrome
 * are UX decisions that haven't been made yet. See README for what
 * the scaffold deliberately leaves to a follow-up session.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "AgentAgora",
  description: "Cloud control plane for the AgentAgora protocol.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#111",
          background: "#fafafa",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
