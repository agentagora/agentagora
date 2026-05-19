import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "./cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Apply monospace family — appropriate for keys, AIDs, bearer tokens. */
  mono?: boolean;
  /** Mark the input visually as errored. Pair with <FormError /> below it. */
  invalid?: boolean;
}

const base =
  "block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm transition-colors " +
  "placeholder:text-accent-400 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 " +
  "disabled:cursor-not-allowed disabled:bg-accent-50 disabled:text-accent-500";

const okBorder =
  "border-accent-200 text-accent-900 focus-visible:border-accent-800 focus-visible:ring-accent-800";
const errBorder =
  "border-red-500 text-red-900 focus-visible:border-red-600 focus-visible:ring-red-600";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, mono = false, invalid = false, type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(base, invalid ? errBorder : okBorder, mono && "font-mono", className)}
      {...rest}
    />
  );
});
