import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /**
   * Required: the id of the control this label describes. Without it
   * we'd have an orphan `<label>` and assistive tech wouldn't bridge
   * the label text to the input. The matching `id={...}` goes on the
   * <Input /> beside this Label.
   */
  htmlFor: string;
  /** Short hint rendered to the right in muted text — e.g. "(optional)". */
  hint?: string;
  children: ReactNode;
}

export function Label({ className, hint, children, htmlFor, ...rest }: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("flex items-baseline gap-2 text-sm text-accent-800", className)}
      {...rest}
    >
      <span className="font-medium">{children}</span>
      {hint && <span className="text-xs text-accent-500">{hint}</span>}
    </label>
  );
}

interface FieldProps {
  /** Vertical stack of `<Label>` + `<Input>` + optional hint/error. */
  children: ReactNode;
  className?: string;
}

/**
 * Optional convenience wrapper — stack a `<Label htmlFor="x" />`,
 * `<Input id="x" />`, and any number of `<FormHint />` / `<FormError />`
 * with consistent vertical spacing. Pages that want a custom layout
 * can ignore this and compose by hand.
 */
export function Field({ children, className }: FieldProps) {
  return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

interface FormErrorProps {
  /** Inline error message rendered below an Input/Textarea. */
  children: ReactNode;
}

export function FormError({ children }: FormErrorProps) {
  return (
    <p role="alert" className="text-xs text-red-700">
      {children}
    </p>
  );
}

interface FormHintProps {
  children: ReactNode;
}

export function FormHint({ children }: FormHintProps) {
  return <p className="text-xs leading-relaxed text-accent-500">{children}</p>;
}
