/**
 * Root layout — wires the Tailwind base layer + Inter Variable into
 * every dashboard page. Page-level chrome (sidebar / topbar / auth
 * shell) lives in `app/_layouts/`; this file only owns the html / body
 * envelope and global stylesheet import.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "AgentAgora",
  description: "Cloud control plane for the AgentAgora protocol.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white font-sans text-accent-800 antialiased">
        {children}
      </body>
    </html>
  );
}
