import { type ClassValue, clsx } from "clsx";

/**
 * `cn` — class-name composer used by every UI primitive in
 * `app/_components/`. Thin wrapper around `clsx` so call sites don't
 * have to choose between `clsx`, `classnames`, or hand-rolled string
 * concat. Returns a single space-joined string suitable for
 * `className=`.
 *
 * Examples:
 *   cn("px-3", isActive && "bg-accent-800")        // → "px-3 bg-accent-800"
 *   cn("text-sm", { "font-bold": isBold })         // → "text-sm font-bold"
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
