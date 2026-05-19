import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Force full-width regardless of content. Useful in narrow forms. */
  fullWidth?: boolean;
  children: ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-tight transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-800 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const variantStyles: Record<Variant, string> = {
  primary: "bg-accent-800 text-white hover:bg-accent-900 active:bg-accent-900",
  secondary:
    "border border-accent-200 bg-white text-accent-800 hover:border-accent-800 hover:text-accent-900",
  ghost: "text-accent-700 hover:bg-accent-50 hover:text-accent-900",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-700",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        base,
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
