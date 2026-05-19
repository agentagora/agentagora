import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "success" | "warn" | "danger";

interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: Tone;
  /** Optional short title above the message line. Overrides the native HTML `title` attr (which would render as a tooltip and is rarely useful here). */
  title?: ReactNode;
  children: ReactNode;
}

const toneStyles: Record<Tone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
};

export function Alert({ tone = "info", className, title, children, ...rest }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border px-4 py-3 text-sm leading-relaxed",
        toneStyles[tone],
        className,
      )}
      {...rest}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title ? "mt-1" : undefined)}>{children}</div>
    </div>
  );
}
