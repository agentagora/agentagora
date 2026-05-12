/**
 * Server-side session helpers.
 *
 * `getOwnerSession()` reads + decrypts the session cookie. Returns
 * `null` if the cookie is missing or its ciphertext doesn't decrypt
 * (rotated secret, tampered value, expired format).
 *
 * `requireOwner()` is the auth gate Server Components call at the top
 * of authenticated pages — calls `redirect("/login")` when there's no
 * session, otherwise returns the payload.
 *
 * Both functions are server-only (they touch `next/headers`); they
 * must never be imported from a Client Component.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, type SessionPayload, decryptSession } from "./cookie";

export async function getOwnerSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return decryptSession(raw);
}

export async function requireOwner(): Promise<SessionPayload> {
  const session = await getOwnerSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
