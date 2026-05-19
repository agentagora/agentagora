/**
 * Logout button — Server Component that renders a form posting to the
 * `/api/auth/logout` Route Handler. Form-based logout keeps the
 * dashboard layout fully server-rendered (no `"use client"`,
 * no `useState`) and works without JS.
 *
 * The button uses the design-system `<Button variant="secondary" />`
 * primitive so the styling lives in one place — change the secondary
 * variant once and every "secondary" surface in the dashboard
 * updates with it.
 */

import { Button } from "../_components/button";

export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post" className="m-0">
      <Button type="submit" variant="secondary" size="sm">
        Sign out
      </Button>
    </form>
  );
}
