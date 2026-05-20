/**
 * Settings — session metadata + environment + OIDC keys.
 *
 * Pure read-only view that surfaces information the user can't see
 * anywhere else in the dashboard:
 *
 *   - Identity:    owner label, provider, github login, derived
 *                  owner-id format (gh:<login> for OAuth bearers,
 *                  the raw label for static / paste bearers).
 *   - Session:     when the cookie was issued, ~ when it expires
 *                  (30-day TTL for OAuth, 7 days for static), and
 *                  a sign-out form (form-post to /api/auth/logout).
 *   - Environment: the cloud-api URL the dashboard fetches against,
 *                  exposed so operators can confirm they're hitting
 *                  the right environment (staging vs production).
 *   - JWKS:        the OIDC public keys cloud-api uses to sign agent
 *                  identity JWTs. Anyone verifying an AgentAgora JWT
 *                  pulls these via /.well-known/jwks.json; we render
 *                  the same payload here so it's discoverable from
 *                  inside the product.
 *
 * Bearer is intentionally NOT displayed. The encrypted cookie holds
 * it; the dashboard doesn't need to render it; surfacing it would
 * just create a shoulder-surfing risk. Users who need the bearer
 * for CLI/curl work can extract it via the OAuth or OWNER_TOKENS
 * channel they got it from.
 */

import { requireOwner } from "../../../lib/auth";
import { BASE_URL } from "../../../lib/cloud-api";
import { Alert } from "../../_components/alert";
import { Badge } from "../../_components/badge";
import { Button } from "../../_components/button";
import { Card, CardBody, CardHeader } from "../../_components/card";

interface JwksKey {
  kid?: string;
  kty?: string;
  alg?: string;
  crv?: string;
  use?: string;
  x?: string;
}

async function fetchJwks(): Promise<
  { kind: "ok"; keys: JwksKey[] } | { kind: "empty" } | { kind: "unreachable"; message: string }
> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/.well-known/jwks.json`, {
        signal: ctrl.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 503) {
      return { kind: "empty" };
    }
    if (!res.ok) {
      return { kind: "unreachable", message: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { keys?: JwksKey[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (keys.length === 0) return { kind: "empty" };
    return { kind: "ok", keys };
  } catch (err) {
    return {
      kind: "unreachable",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function ttlEstimate(issuedAt: string, provider: string | undefined): string | null {
  const issuedMs = Date.parse(issuedAt);
  if (Number.isNaN(issuedMs)) return null;
  const ttlDays = provider === "github" ? 30 : 7;
  const expiresMs = issuedMs + ttlDays * 24 * 60 * 60 * 1000;
  const remainingMs = expiresMs - Date.now();
  if (remainingMs <= 0) return "expired";
  const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const remainingHours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (remainingDays > 0) return `~${remainingDays}d ${remainingHours}h remaining`;
  return `~${remainingHours}h remaining`;
}

export default async function SettingsPage() {
  const session = await requireOwner();
  const ownerId =
    session.provider === "github" && session.githubLogin
      ? `gh:${session.githubLogin}`
      : session.ownerLabel;
  const providerLabel = session.provider ?? "static";
  const expiresIn = ttlEstimate(session.issuedAt, session.provider);

  const jwks = await fetchJwks();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Settings</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
          Session metadata, environment, and the OIDC verification keys cloud-api uses for agent
          identity JWTs.
        </p>
      </header>

      <Card>
        <CardHeader title="Identity" description="Who this session represents" />
        <CardBody>
          <dl
            className="grid items-baseline gap-x-6 gap-y-3 text-sm"
            style={{ gridTemplateColumns: "max-content 1fr" }}
          >
            <dt className="text-accent-500">Label</dt>
            <dd className="m-0 text-accent-900">{session.ownerLabel}</dd>

            <dt className="text-accent-500">Provider</dt>
            <dd className="m-0">
              <Badge tone={session.provider === "github" ? "info" : "neutral"}>
                {providerLabel}
              </Badge>
            </dd>

            {session.githubLogin && (
              <>
                <dt className="text-accent-500">GitHub login</dt>
                <dd className="m-0">
                  <Mono>@{session.githubLogin}</Mono>
                </dd>
              </>
            )}

            <dt className="text-accent-500">Owner ID</dt>
            <dd className="m-0">
              <Mono>{ownerId}</Mono>
            </dd>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Session" description="Cookie lifetime + sign-out" />
        <CardBody>
          <dl
            className="grid items-baseline gap-x-6 gap-y-3 text-sm"
            style={{ gridTemplateColumns: "max-content 1fr" }}
          >
            <dt className="text-accent-500">Issued at</dt>
            <dd className="m-0 font-mono text-xs text-accent-700">{session.issuedAt}</dd>

            <dt className="text-accent-500">Expires</dt>
            <dd className="m-0">
              {expiresIn ? (
                <Badge tone={expiresIn === "expired" ? "danger" : "neutral"}>{expiresIn}</Badge>
              ) : (
                <span className="text-accent-500">unknown</span>
              )}
            </dd>

            <dt className="text-accent-500">TTL</dt>
            <dd className="m-0 text-accent-700">
              {session.provider === "github" ? "30 days" : "7 days"}{" "}
              <span className="text-accent-500">
                (set by {session.provider === "github" ? "cloud-api OAuth row" : "static bearer"})
              </span>
            </dd>
          </dl>

          <div className="mt-6 border-t border-accent-100 pt-5">
            <form action="/api/auth/logout" method="post">
              <Button type="submit" variant="secondary" size="sm">
                Sign out
              </Button>
              <p className="mt-2 text-xs text-accent-500">
                Clears the encrypted session cookie. You'll be redirected to <Mono>/login</Mono>.
              </p>
            </form>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Environment" description="Where the dashboard fetches its data from" />
        <CardBody>
          <dl
            className="grid items-baseline gap-x-6 gap-y-3 text-sm"
            style={{ gridTemplateColumns: "max-content 1fr" }}
          >
            <dt className="text-accent-500">Cloud-api URL</dt>
            <dd className="m-0">
              <Mono breakAll>{BASE_URL}</Mono>
            </dd>

            <dt className="text-accent-500">JWKS endpoint</dt>
            <dd className="m-0">
              <Mono breakAll>{BASE_URL}/.well-known/jwks.json</Mono>
            </dd>

            <dt className="text-accent-500">Status page</dt>
            <dd className="m-0">
              <a
                href="/status"
                className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
              >
                /status
              </a>
            </dd>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="OIDC keys (JWKS)"
          description="Public keys cloud-api uses to sign agent identity JWTs"
        />
        <CardBody>
          {jwks.kind === "ok" ? (
            <ul className="flex flex-col gap-3">
              {jwks.keys.map((key, i) => (
                <li
                  key={key.kid ?? `key-${i}`}
                  className="rounded-md border border-accent-100 bg-accent-50/40 p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <code className="font-mono text-xs font-medium text-accent-900">
                      {key.kid ?? "(no kid)"}
                    </code>
                    <div className="flex flex-wrap items-center gap-2">
                      {key.alg && <Badge tone="info">{key.alg}</Badge>}
                      {key.kty && <Badge tone="neutral">{key.kty}</Badge>}
                      {key.crv && <Badge tone="neutral">{key.crv}</Badge>}
                    </div>
                  </div>
                  {key.x && (
                    <p className="mt-3 break-all font-mono text-[11px] text-accent-700">
                      x: {key.x}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : jwks.kind === "empty" ? (
            <p className="text-sm text-accent-600">
              JWKS is empty or OIDC is not configured on this cloud-api. Agents won't have signed
              identity JWTs until <Mono>OIDC_SIGNING_KEY</Mono> + <Mono>OIDC_ISSUER</Mono> are set.
            </p>
          ) : (
            <Alert tone="danger">Couldn't reach the JWKS endpoint. {jwks.message}</Alert>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Mono({ children, breakAll = false }: { children: React.ReactNode; breakAll?: boolean }) {
  return (
    <code
      className={`rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800${breakAll ? " break-all" : ""}`}
    >
      {children}
    </code>
  );
}
