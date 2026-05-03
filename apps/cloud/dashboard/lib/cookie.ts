/**
 * Encrypted session cookie shared between the dashboard's Server
 * Components and Route Handlers.
 *
 * The cloud-api bearer token is sensitive (anyone holding it can
 * publish agents on the user's behalf), so the cookie *encrypts* the
 * payload with AES-256-GCM rather than relying on httpOnly + a
 * detached signature. The key is derived from `DASHBOARD_COOKIE_SECRET`
 * via SHA-256, so any string ≥ 32 bytes works as a secret.
 *
 * Wire format (single base64url string, no separators):
 *
 *     base64url( iv (12B) || ciphertext (variable) || tag (16B) )
 *
 * The auth-tag is appended to the ciphertext by Web Crypto's GCM
 * implementation — we don't separate it explicitly. Decryption takes
 * the whole blob and returns the cleartext payload as JSON.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export interface SessionPayload {
  /** The cloud-api bearer token (plaintext within the cookie body —
   *  the cookie itself is encrypted). For OAuth sessions this is the
   *  opaque random bearer cloud-api minted at /v1/auth/github/callback;
   *  for static sessions it's whatever bearer the user pasted. */
  bearer: string;
  /** Display name surfaced in the UI. For OAuth sessions this is
   *  `gh:<login>`; for static / paste sessions it falls back to the
   *  user-supplied label or "owner". */
  ownerLabel: string;
  /** ISO timestamp the session was issued at (for future expiry
   *  policy; not currently enforced server-side). */
  issuedAt: string;
  /** How the session was minted. "github" for OAuth-issued bearers,
   *  "static" for the closed-alpha bearer-paste path. Optional so
   *  cookies issued before this field landed still decrypt cleanly —
   *  the layout renders an "@<login>" header only when provider is
   *  "github". */
  provider?: "github" | "static";
  /** GitHub login when `provider === "github"`. Surfaces in the
   *  sidebar header as `Signed in as @<login>`. */
  githubLogin?: string;
}

/** Cookie name. Prefixed `__Host-`-style would require Secure + Path=/
 *  + no Domain — we set those flags but keep the name plain so it
 *  works in `next dev` over http://localhost. */
export const COOKIE_NAME = "agentagora_session";

let cachedSecretWarning = false;

/**
 * Resolve a 32-byte AES key from `DASHBOARD_COOKIE_SECRET`.
 *
 * If the env var is unset we fall back to a *process-stable* random
 * value so dev sessions survive across requests within the same
 * `next dev` invocation. We log a warning the first time so the user
 * knows to set a real secret before deploying. The fallback explicitly
 * does NOT persist across restarts — that's the whole point.
 */
async function getKey(): Promise<CryptoKey> {
  const secret = resolveSecret();
  const hash = await crypto.subtle.digest("SHA-256", ENC.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

let devFallbackSecret: string | undefined;

function resolveSecret(): string {
  const fromEnv = process.env.DASHBOARD_COOKIE_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  if (!cachedSecretWarning) {
    cachedSecretWarning = true;
    if (fromEnv && fromEnv.length < 32) {
      console.warn(
        "[dashboard] DASHBOARD_COOKIE_SECRET is shorter than 32 bytes — generating an ephemeral fallback. Set a 32+ byte random value before deploying.",
      );
    } else {
      console.warn(
        "[dashboard] DASHBOARD_COOKIE_SECRET is not set — generating an ephemeral fallback for this process. Sessions will NOT survive a restart. Set a 32+ byte random value before deploying.",
      );
    }
  }

  if (!devFallbackSecret) {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    devFallbackSecret = b64uEncode(bytes);
  }
  return devFallbackSecret;
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  const key = await getKey();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cleartext = ENC.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, cleartext),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return b64uEncode(out);
}

export async function decryptSession(value: string): Promise<SessionPayload | null> {
  let raw: Uint8Array;
  try {
    raw = b64uDecode(value);
  } catch {
    return null;
  }
  if (raw.length < 12 + 16) return null; // iv + tag
  const iv = raw.slice(0, 12);
  const ciphertext = raw.slice(12);
  try {
    const key = await getKey();
    const cleartext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const json = DEC.decode(cleartext);
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as SessionPayload).bearer === "string" &&
      typeof (parsed as SessionPayload).ownerLabel === "string" &&
      typeof (parsed as SessionPayload).issuedAt === "string"
    ) {
      return parsed as SessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(value: string): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
