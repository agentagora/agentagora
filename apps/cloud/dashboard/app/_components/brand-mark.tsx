import { cn } from "./cn";

interface BrandMarkProps {
  /** Render the wordmark next to the geometric mark. Default true. */
  withWordmark?: boolean;
  className?: string;
}

/**
 * The geometric AgentAgora mark — graphite square with an inset ring.
 * Same recipe used by the marketing site header, kept here as a
 * components-level primitive so it shares one styling source of truth
 * across nav, login, and empty states.
 */
export function BrandMark({ withWordmark = true, className }: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent-800"
        aria-hidden="true"
      >
        <span className="block h-2.5 w-2.5 rounded-full border-2 border-white" />
      </span>
      {withWordmark && (
        <span className="text-sm font-semibold tracking-tight text-accent-900">AgentAgora</span>
      )}
    </span>
  );
}
