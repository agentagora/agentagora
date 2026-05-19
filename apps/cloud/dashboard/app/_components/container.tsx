import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Width = "sm" | "md" | "lg" | "full";

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Max width: sm=480 (forms), md=720 (single-column), lg=1180 (dashboard). */
  width?: Width;
  children: ReactNode;
}

const widthStyles: Record<Width, string> = {
  sm: "max-w-[480px]",
  md: "max-w-[720px]",
  lg: "max-w-[1180px]",
  full: "max-w-none",
};

export function Container({ width = "lg", className, children, ...rest }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-6", widthStyles[width], className)} {...rest}>
      {children}
    </div>
  );
}
