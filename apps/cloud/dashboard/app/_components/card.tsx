import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-accent-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Section title — rendered as bold inside the header band. Overrides the native HTML `title` (tooltip) attr. */
  title?: ReactNode;
  /** Optional secondary line under the title. */
  description?: ReactNode;
  /** Optional right-aligned slot (button row, status pill, etc.). */
  actions?: ReactNode;
  children?: ReactNode;
}

export function CardHeader({
  className,
  title,
  description,
  actions,
  children,
  ...rest
}: CardHeaderProps) {
  if (children) {
    return (
      <div
        className={cn(
          "flex items-center justify-between border-b border-accent-100 px-5 py-4",
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-accent-100 px-5 py-4",
        className,
      )}
      {...rest}
    >
      <div className="flex flex-col gap-1">
        {title && <h2 className="text-base font-semibold text-accent-900">{title}</h2>}
        {description && <p className="text-sm text-accent-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** Drop the default p-5 — useful when wrapping a <table> that owns its own padding. */
  flush?: boolean;
  children: ReactNode;
}

export function CardBody({ className, flush = false, children, ...rest }: CardBodyProps) {
  return (
    <div className={cn(flush ? "p-0" : "p-5", className)} {...rest}>
      {children}
    </div>
  );
}

interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardFooter({ className, children, ...rest }: CardFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-accent-100 bg-accent-50/40 px-5 py-3",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
