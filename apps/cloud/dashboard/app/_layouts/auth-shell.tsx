import type { ReactNode } from "react";
import { BrandMark, Container } from "../_components";

interface AuthShellProps {
  /** Page heading rendered inside the card header band. */
  title: string;
  /** Optional sub-heading line under `title`. */
  description?: ReactNode;
  /** Optional pre-card slot — error banner, callout, etc. */
  banner?: ReactNode;
  /** The form (or other primary action) for this auth flow. */
  children: ReactNode;
  /** Optional secondary call-to-action below the card — e.g. "Need an account?" */
  footer?: ReactNode;
}

/**
 * Layout shell for /login, /login/callback, and any future
 * pre-auth views. Centers a single column on a soft accent
 * backdrop; sits on top of the marketing-style brand mark so
 * the dashboard reads as one product with the marketing site.
 */
export function AuthShell({ title, description, banner, children, footer }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-accent-50">
      <Container
        width="sm"
        className="flex min-h-screen flex-col items-center justify-center py-16"
      >
        <BrandMark className="mb-10" />

        {banner && <div className="mb-4 w-full">{banner}</div>}

        <div className="w-full overflow-hidden rounded-lg border border-accent-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-accent-100 px-6 py-5">
            <h1 className="text-lg font-semibold text-accent-900">{title}</h1>
            {description && <p className="mt-1 text-sm text-accent-600">{description}</p>}
          </div>
          <div className="px-6 py-6">{children}</div>
        </div>

        {footer && <div className="mt-6 text-center text-sm text-accent-500">{footer}</div>}
      </Container>
    </main>
  );
}
