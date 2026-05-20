/**
 * Inline SVG icon set for the sidebar nav. Kept as named constants in
 * one file so the chrome doesn't ship a half-megabyte icon library
 * for 8 small marks. Heroicons-style stroke shapes, 20 × 20 viewBox,
 * stroke-width 1.5.
 *
 * Adding a new icon: define a `<path>` (or group of paths) constant
 * below and add it to `ICONS`. The `<NavIcon name="…" />` component
 * picks the matching SVG.
 */

import type { ReactNode } from "react";

export type NavIconName =
  | "dashboard"
  | "agents"
  | "conversations"
  | "disputes"
  | "earnings"
  | "onboarding"
  | "help"
  | "settings";

const PATHS: Record<NavIconName, ReactNode> = {
  // grid 2x2 (dashboard)
  dashboard: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </>
  ),
  // hexagon — agents (nod to honeycomb + composability)
  agents: (
    <path d="M10 2.5l6.5 3.75v7.5L10 17.5 3.5 13.75v-7.5L10 2.5zm0 4.5v6m-3-4.5l6 3m-6 0l6-3" />
  ),
  // speech bubble — conversations
  conversations: (
    <>
      <path d="M3.5 9.5C3.5 6.46 6.13 4 9.5 4h1C13.87 4 16.5 6.46 16.5 9.5S13.87 15 10.5 15H7l-3.5 2 .8-3.13A5.4 5.4 0 0 1 3.5 9.5z" />
      <circle cx="7.5" cy="9.5" r="0.6" fill="currentColor" />
      <circle cx="10" cy="9.5" r="0.6" fill="currentColor" />
      <circle cx="12.5" cy="9.5" r="0.6" fill="currentColor" />
    </>
  ),
  // gavel + line — disputes
  disputes: (
    <>
      <path d="M4 12.5l4.5-4.5m0 0L11.5 11M8.5 8L11 5.5M11.5 11L14 8.5m-2.5 2.5L14 13.5" />
      <path d="M3 17h7" />
    </>
  ),
  // line-chart upward — earnings
  earnings: (
    <>
      <path d="M3 16V4m0 12h14" />
      <path d="M6.5 13l3-3 3 2 3.5-4.5" />
      <circle cx="6.5" cy="13" r="0.8" fill="currentColor" />
      <circle cx="9.5" cy="10" r="0.8" fill="currentColor" />
      <circle cx="12.5" cy="12" r="0.8" fill="currentColor" />
      <circle cx="16" cy="7.5" r="0.8" fill="currentColor" />
    </>
  ),
  // up-arrow into a tray — onboarding (Stripe handoff)
  onboarding: (
    <>
      <path d="M10 3v9m0 0l-3-3m3 3l3-3" />
      <path d="M4 13v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
    </>
  ),
  // question mark in a circle — help
  help: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M8 8a2 2 0 0 1 4 .5c0 1-1 1.5-2 2v1" />
      <circle cx="10" cy="14" r="0.6" fill="currentColor" />
    </>
  ),
  // gear — settings
  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.5 4.5l1.4 1.4m8.2 8.2l1.4 1.4m0-11l-1.4 1.4M5.9 14.1l-1.4 1.4" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {PATHS[name]}
    </svg>
  );
}
