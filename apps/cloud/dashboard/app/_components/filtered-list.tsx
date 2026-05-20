"use client";

/**
 * Generic client-side filterable list — feed it pre-rendered rows
 * plus a per-row `matchText` and the input pane handles the rest.
 *
 * Used by the three list pages (/agents, /conversations, /disputes)
 * to add an instant search box on top of the existing server-fetched
 * data without round-tripping to the cloud-api for every keystroke.
 * The server stays in charge of fetching + initial rendering; the
 * client only filters which already-rendered row is visible.
 *
 *   <FilteredList
 *     placeholder="Filter agents…"
 *     items={agents.map((a) => ({
 *       key: a.aid,
 *       matchText: `${a.aid} ${a.description ?? ""}`,
 *       node: <AgentRow agent={a} />,
 *     }))}
 *     emptyMessage="No matches."
 *   />
 *
 * matchText is lowercased once at mount and the query is lowercased
 * on every keystroke — small enough that even a 1000-row list filters
 * inside a single frame. If we ever need more, swap to a useMemo'd
 * index, but not before.
 */

import { type ReactNode, useMemo, useState } from "react";
import { Input } from "./input";

export interface FilteredListItem {
  /** Stable key for React reconciliation. Typically the row's id / aid. */
  key: string;
  /** Single space-separated string the filter substring-matches against. */
  matchText: string;
  /** The pre-rendered row element. */
  node: ReactNode;
}

interface Props {
  /** Search-box placeholder. */
  placeholder: string;
  /** Pre-rendered rows + their match text. */
  items: FilteredListItem[];
  /** Shown when the user's query matches zero rows. */
  emptyMessage?: ReactNode;
  /** Optional `<ul>` className. Defaults to `flex flex-col gap-2`. */
  listClassName?: string;
}

export function FilteredList({ placeholder, items, emptyMessage, listClassName }: Props) {
  const [query, setQuery] = useState("");

  // Lowercase once so the filter loop doesn't re-lowercase the same
  // matchText on every keystroke.
  const lowerItems = useMemo(
    () => items.map((item) => ({ ...item, _lower: item.matchText.toLowerCase() })),
    [items],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return lowerItems;
    return lowerItems.filter((item) => item._lower.includes(q));
  }, [lowerItems, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md flex-1"
          aria-label="Filter list"
        />
        {query.length > 0 && (
          <span className="text-xs text-accent-500">
            {visible.length === 0 ? "no matches" : `${visible.length} of ${items.length} shown`}
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-accent-200 bg-white px-5 py-8 text-center text-sm text-accent-500">
          {emptyMessage ?? `Nothing matches "${query}".`}
        </div>
      ) : (
        <ul className={listClassName ?? "flex flex-col gap-2"}>
          {visible.map((item) => (
            <li key={item.key}>{item.node}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
