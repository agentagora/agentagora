/**
 * GitHub OAuth sign-in for the cloud dashboard.
 *
 * Two-leg flow:
 *
 *   1.  GET /v1/auth/github/start
 *       Returns `{ authorize_url, state }` where state is HMAC-signed
 *       with a key derived from OIDC_SIGNING_KEY (the only signing
 *       secret already universally configured). The dashboard redirects
 *       the user's browser to authorize_url; the GitHub redirect lands
 *       on the dashboard with `?code=...&state=...`.
 *
 *   2.  POST /v1/auth/github/callback
 *       Body: `{ code, state }`. Verifies the HMAC on state, exchanges
 *       the code for an access token via GitHub's OAuth API, fetches
 *       the user's profile, mints a fresh 32-byte random bearer
 *       (base64url, never derived from anything GitHub returned), and
 *       persists a row in oauth_sessions. Returns
 *       `{ bearer, owner_id, github_login }`.
 *
 * The bearer authenticates subsequent cloud-api requests via
 * `OauthSessionAuth` chained behind `StaticOwnerAuth` — the closed-
 * alpha OWNER_TOKENS path still works for CI / integration tests.
 *
 * The GitHub access token NEVER leaves the cloud-api process. It is
 * used once to fetch the user's profile and discarded. The dashboard
 * (and the user's browser) only ever see the cloud-issued bearer.
 */

import { Hono } from "hono";
import type { OwnerAuthenticator } from "./auth.js";
import type { OauthSessionRecord, Storage } from "./storage.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

/** Default scope: just the public read needed to identify the user. */
const DEFAULT_SCOPE = "read:user";

/** 30 days in milliseconds. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Bytes of randomness in the issued bearer. base64url-encoded
 *  (≈43 chars) — see `mintBearer()`. */
const BEARER_BYTES = 32;

/** OAuth state lifetime — long enough for a slow human, short enough
 *  that a leaked state doesn't sit forever. 10 min is the GitHub OAuth
 *  app default UX. */
const STATE_TTL_MS = 10 * 60 * 1000;

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export interface GithubLike {
  /** Exchange an authorization code for an access token. Returns the
   *  raw access token string on success; throws otherwise. */
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri?: string;
  }): Promise<string>;
  /** Fetch the authenticated user's profile (id, login, optional email). */
  fetchUser(accessToken: string): Promise<GithubUser>;
}

export interface GithubUser {
  /** Numeric GitHub user id; stable across login renames. */
  id: number;
  /** Login handle; the human-readable owner label. */
  login: string;
  /** Primary email, if the granted scopes include it. */
  email?: string | null;
}

/**
 * Production GitHub client. Talks to GitHub's REST API via fetch.
 * Tests inject a `MockGithubClient` instead.
 */
export class GithubHttpClient implements GithubLike {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri?: string;
  }): Promise<string> {
    const params = new URLSearchParams();
    params.set("client_id", input.clientId);
    params.set("client_secret", input.clientSecret);
    params.set("code", input.code);
    if (input.redirectUri) params.set("redirect_uri", input.redirectUri);

    const res = await this.fetchImpl(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        // GitHub requires a user agent on api.github.com calls; it's
        // good hygiene on the OAuth host as well.
        "user-agent": "agentagora-cloud-api",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`GitHub token exchange failed (${res.status})`);
    }
    const body = (await res.json()) as { access_token?: string; error?: string };
    if (!body.access_token) {
      throw new Error(
        `GitHub token exchange failed: ${body.error ?? "no access_token in response"}`,
      );
    }
    return body.access_token;
  }

  async fetchUser(accessToken: string): Promise<GithubUser> {
    const res = await this.fetchImpl(GITHUB_USER_URL, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "agentagora-cloud-api",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub /user fetch failed (${res.status})`);
    }
    const body = (await res.json()) as { id?: number; login?: string; email?: string | null };
    if (typeof body.id !== "number" || typeof body.login !== "string") {
      throw new Error("GitHub /user response missing id/login");
    }
    const out: GithubUser = { id: body.id, login: body.login };
    if (body.email !== undefined && body.email !== null) out.email = body.email;
    return out;
  }
}

export interface GithubOauthConfig {
  clientId: string;
  clientSecret: string;
  /** Where GitHub redirects back to (the dashboard's callback page).
   *  When unset GitHub uses the app's default callback URL. */
  redirectUri?: string;
  /** Override the default `read:user` scope list. */
  scope?: string;
}

interface RouterDeps {
  config: GithubOauthConfig;
  github: GithubLike;
  storage: Storage;
  /** HMAC key for signing OAuth `state`. Derived from OIDC_SIGNING_KEY
   *  in production so we don't introduce yet another secret. */
  stateSigningKey: Uint8Array;
  /** Override clock for deterministic tests. */
  now?: () => Date;
  /** Override the bearer minter for deterministic tests. */
  newBearer?: () => string;
}

/**
 * Build the /v1/auth/github router. Mounted under `/v1/auth/github`
 * (the leading segment is consumed by app.route in index.ts).
 */
export function createGithubOauthRouter({
  config,
  github,
  storage,
  stateSigningKey,
  now = () => new Date(),
  newBearer = mintBearer,
}: RouterDeps): Hono {
  const router = new Hono();

  router.get("/start", async (c) => {
    const issuedAt = now().getTime();
    const state = await signState(stateSigningKey, { issuedAt });
    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("scope", config.scope ?? DEFAULT_SCOPE);
    url.searchParams.set("state", state);
    if (config.redirectUri) url.searchParams.set("redirect_uri", config.redirectUri);
    return c.json({ authorize_url: url.toString(), state });
  });

  router.post("/callback", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return c.json({ error: "invalid_body", message: "expected JSON object" }, 400);
    }
    const code = (raw as { code?: unknown }).code;
    const stateRaw = (raw as { state?: unknown }).state;
    if (typeof code !== "string" || !code) {
      return c.json({ error: "invalid_body", message: "code is required" }, 400);
    }
    if (typeof stateRaw !== "string" || !stateRaw) {
      return c.json({ error: "invalid_body", message: "state is required" }, 400);
    }

    // Verify state (HMAC + freshness).
    const stateOk = await verifyState(stateSigningKey, stateRaw, now().getTime());
    if (!stateOk) {
      return c.json({ error: "unauthorized", message: "invalid or expired state" }, 401);
    }

    // Exchange the code with GitHub.
    let accessToken: string;
    try {
      const exchangeInput: {
        clientId: string;
        clientSecret: string;
        code: string;
        redirectUri?: string;
      } = {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
      };
      if (config.redirectUri) exchangeInput.redirectUri = config.redirectUri;
      accessToken = await github.exchangeCode(exchangeInput);
    } catch (err) {
      console.error("[oauth-github] code exchange failed", err);
      return c.json({ error: "upstream_unavailable", message: "GitHub rejected the code" }, 502);
    }

    // Fetch the user profile so we can pin a stable owner ID. The
    // access token is discarded after this call — the cloud-issued
    // bearer is what authenticates everything afterwards.
    let user: GithubUser;
    try {
      user = await github.fetchUser(accessToken);
    } catch (err) {
      console.error("[oauth-github] user fetch failed", err);
      return c.json({ error: "upstream_unavailable", message: "GitHub /user request failed" }, 502);
    }

    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);
    const bearer = newBearer();
    const ownerId = `gh:${user.login}`;

    const record: OauthSessionRecord = {
      bearer,
      ownerId,
      provider: "github",
      providerUid: String(user.id),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    if (typeof user.email === "string" && user.email.length > 0) {
      record.email = user.email;
    }

    await storage.createOauthSession(record);

    return c.json(
      {
        bearer,
        owner_id: ownerId,
        github_login: user.login,
        provider: "github",
        issued_at: record.issuedAt,
        expires_at: record.expiresAt,
      },
      201,
    );
  });

  return router;
}

/**
 * Owner-authenticator backed by oauth_sessions. Used in the
 * authenticator chain alongside StaticOwnerAuth so OAuth-issued
 * bearers and OWNER_TOKENS-issued bearers both authenticate the same
 * routes.
 */
export class OauthSessionAuth implements OwnerAuthenticator {
  constructor(
    private readonly storage: Storage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(token: string): Promise<string | undefined> {
    const session = await this.storage.getOauthSession(token);
    if (!session) return undefined;
    if (new Date(session.expiresAt).getTime() <= this.now().getTime()) return undefined;
    return session.ownerId;
  }
}

/**
 * Compose multiple OwnerAuthenticators. First match wins. Used to
 * stack StaticOwnerAuth(OWNER_TOKENS) + OauthSessionAuth(storage) so
 * both schemes coexist. Resolves are sequential (Map walk + DB hit) —
 * the OAuth path is the slow one, so it's tried second so the static
 * fast-path doesn't pay a database round-trip on every request.
 */
export class ChainOwnerAuth implements OwnerAuthenticator {
  private readonly chain: OwnerAuthenticator[];

  constructor(...chain: OwnerAuthenticator[]) {
    this.chain = chain;
  }

  async resolve(token: string): Promise<string | undefined> {
    for (const auth of this.chain) {
      const owner = await auth.resolve(token);
      if (owner) return owner;
    }
    return undefined;
  }
}

/**
 * Mint a fresh bearer: 32 random bytes, base64url-encoded. The bearer
 * is opaque to the client (cloud-api looks it up in oauth_sessions on
 * every request); deriving it from anything GitHub returned would be
 * a footgun — replay against the GH API would re-issue the same
 * bearer.
 */
export function mintBearer(): string {
  const bytes = new Uint8Array(BEARER_BYTES);
  crypto.getRandomValues(bytes);
  return b64uEncode(bytes);
}

/**
 * Derive a 32-byte HMAC key for state-signing from an OIDC_SIGNING_KEY
 * input (raw 32-byte Ed25519 secret). We don't reuse the Ed25519 key
 * directly — SHA-256 over the raw bytes + a domain-separation prefix
 * gives us an independent symmetric key, while letting the operator
 * configure exactly one signing secret.
 */
export async function deriveStateSigningKey(input: Uint8Array): Promise<Uint8Array> {
  const buf = new Uint8Array(input.length + 22);
  buf.set(ENC.encode("agentagora.oauth.state"), 0);
  buf.set(input, 22);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(digest);
}

interface StatePayload {
  /** ms since epoch when the state was issued. */
  issuedAt: number;
}

/**
 * Build a state token as `b64u(json) + "." + b64u(hmac-sha256)`.
 * Verifies via constant-time MAC comparison + freshness window.
 */
async function signState(key: Uint8Array, payload: StatePayload): Promise<string> {
  const body = b64uEncode(ENC.encode(JSON.stringify(payload)));
  const macKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", macKey, ENC.encode(body)));
  return `${body}.${b64uEncode(sig)}`;
}

async function verifyState(key: Uint8Array, value: string, nowMs: number): Promise<boolean> {
  const idx = value.indexOf(".");
  if (idx <= 0 || idx === value.length - 1) return false;
  const body = value.slice(0, idx);
  const sig = value.slice(idx + 1);

  let sigBytes: Uint8Array;
  try {
    sigBytes = b64uDecode(sig);
  } catch {
    return false;
  }
  const macKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // Web Crypto's verify is constant-time across same-length inputs;
  // mismatched lengths are rejected as `false` without timing leaks.
  const ok = await crypto.subtle.verify("HMAC", macKey, sigBytes, ENC.encode(body));
  if (!ok) return false;

  let payload: StatePayload;
  try {
    payload = JSON.parse(DEC.decode(b64uDecode(body))) as StatePayload;
  } catch {
    return false;
  }
  if (typeof payload.issuedAt !== "number") return false;
  const age = nowMs - payload.issuedAt;
  if (age < 0 || age > STATE_TTL_MS) return false;
  return true;
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
