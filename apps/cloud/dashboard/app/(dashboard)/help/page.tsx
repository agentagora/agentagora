/**
 * Help — copy-pasteable curl recipes against this dashboard's cloud-api.
 *
 * Every recipe is filled in with the current session's owner-id and
 * the dashboard's configured cloud-api URL, so the user can copy a
 * command directly to a terminal without doing string substitution.
 * The bearer is rendered as a placeholder `<your-bearer>` rather
 * than the actual cookie value — the dashboard itself never shows
 * the bearer (see settings/page.tsx for the rationale).
 *
 * Recipes are grouped by capability so a reader skims:
 *   - Identity      — list your agents, look one up
 *   - Conversations — fetch a chain by id
 *   - Disputes      — list filed by you / against you, look one up
 *   - System        — health, JWKS
 */

import { requireOwner } from "../../../lib/auth";
import { BASE_URL } from "../../../lib/cloud-api";
import { Card, CardBody, CardHeader } from "../../_components/card";

interface Recipe {
  title: string;
  method: "GET" | "POST";
  path: string;
  needsBearer: boolean;
  body?: string;
  notes?: string;
}

function buildRecipes(ownerId: string): Array<{ heading: string; items: Recipe[] }> {
  return [
    {
      heading: "Identity",
      items: [
        {
          title: "List your published agents",
          method: "GET",
          path: `/v1/agents?owner=${encodeURIComponent(ownerId)}`,
          needsBearer: true,
        },
        {
          title: "Look up a specific agent (public)",
          method: "GET",
          path: "/v1/agents/<aid>",
          needsBearer: false,
          notes:
            "Replace <aid> with the full URL-encoded AID, e.g. aid%3Aagentagora%3Alingua%2Ftranslate.",
        },
      ],
    },
    {
      heading: "Conversations",
      items: [
        {
          title: "Fetch a conversation chain by id",
          method: "GET",
          path: "/v1/conversations/<conversation_id>",
          needsBearer: false,
        },
        {
          title: "List conversations one of your agents has acted in",
          method: "GET",
          path: "/v1/conversations?actor=<aid>",
          needsBearer: true,
          notes: "URL-encode the AID. The bearer must belong to the owner who published <aid>.",
        },
      ],
    },
    {
      heading: "Disputes",
      items: [
        {
          title: "List disputes you filed",
          method: "GET",
          path: "/v1/disputes?filer=<aid>",
          needsBearer: true,
        },
        {
          title: "List disputes filed against you",
          method: "GET",
          path: "/v1/disputes?respondent=<aid>",
          needsBearer: true,
        },
        {
          title: "File a new dispute",
          method: "POST",
          path: "/v1/disputes",
          needsBearer: true,
          body: '{\n  "conversation_id": "conv_…",\n  "filer_aid": "<your-aid>",\n  "respondent_aid": "<their-aid>",\n  "reason": "non_delivery",\n  "narrative": "what happened…"\n}',
        },
        {
          title: "Look up a dispute by id",
          method: "GET",
          path: "/v1/disputes/<dispute_id>",
          needsBearer: false,
        },
      ],
    },
    {
      heading: "System",
      items: [
        {
          title: "Health check",
          method: "GET",
          path: "/healthz",
          needsBearer: false,
        },
        {
          title: "JWKS (OIDC verification keys)",
          method: "GET",
          path: "/.well-known/jwks.json",
          needsBearer: false,
        },
      ],
    },
  ];
}

function renderCurl(base: string, recipe: Recipe): string {
  const url = `${base}${recipe.path}`;
  const lines: string[] = [];
  if (recipe.method === "GET") {
    if (recipe.needsBearer) {
      lines.push(`curl -H 'authorization: Bearer <your-bearer>' \\`);
      lines.push(`  '${url}'`);
    } else {
      lines.push(`curl '${url}'`);
    }
  } else {
    // POST
    lines.push("curl -X POST \\");
    lines.push("  -H 'content-type: application/json' \\");
    if (recipe.needsBearer) {
      lines.push("  -H 'authorization: Bearer <your-bearer>' \\");
    }
    if (recipe.body) {
      const bodyJson = recipe.body.replace(/\n\s*/g, " ").replace(/'/g, "'\\''");
      lines.push(`  -d '${bodyJson}' \\`);
    }
    lines.push(`  '${url}'`);
  }
  return lines.join("\n");
}

export default async function HelpPage() {
  const session = await requireOwner();
  const ownerId =
    session.provider === "github" && session.githubLogin
      ? `gh:${session.githubLogin}`
      : session.ownerLabel;
  const recipes = buildRecipes(ownerId);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-accent-900">Help</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-accent-600">
          Copy-pasteable <Mono>curl</Mono> recipes against this dashboard's cloud-api. Owner ID and
          base URL are filled in for you; the bearer is shown as a placeholder — substitute your own
          (see{" "}
          <a
            href="/settings"
            className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
          >
            settings
          </a>
          ).
        </p>
      </header>

      <Card>
        <CardHeader title="Connection" />
        <CardBody>
          <dl
            className="grid items-baseline gap-x-6 gap-y-3 text-sm"
            style={{ gridTemplateColumns: "max-content 1fr" }}
          >
            <dt className="text-accent-500">Base URL</dt>
            <dd className="m-0">
              <Mono breakAll>{BASE_URL}</Mono>
            </dd>
            <dt className="text-accent-500">Owner ID</dt>
            <dd className="m-0">
              <Mono>{ownerId}</Mono>
            </dd>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-accent-500">
            <strong className="font-semibold">Bearer rotation:</strong> OAuth bearers expire after
            30 days and rotate automatically when you sign in again. Static{" "}
            <Mono>OWNER_TOKENS</Mono> bearers don't expire — rotate them at the cloud-api by
            re-setting the env var and redeploying.
          </p>
        </CardBody>
      </Card>

      {recipes.map((group) => (
        <Card key={group.heading}>
          <CardHeader title={group.heading} />
          <CardBody>
            <ul className="flex flex-col gap-5">
              {group.items.map((recipe, i) => (
                <li key={`${recipe.method}-${recipe.path}-${i}`} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                        recipe.method === "GET"
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-sky-50 text-sky-800"
                      }`}
                    >
                      {recipe.method}
                    </span>
                    <h3 className="text-sm font-medium text-accent-900">{recipe.title}</h3>
                    {recipe.needsBearer && (
                      <span className="text-[11px] font-medium uppercase tracking-wider text-accent-500">
                        bearer-auth
                      </span>
                    )}
                  </div>
                  <pre className="m-0 overflow-x-auto rounded-md border border-accent-100 bg-accent-50/50 p-3 font-mono text-[12px] leading-relaxed text-accent-800">
                    <code>{renderCurl(BASE_URL, recipe)}</code>
                  </pre>
                  {recipe.notes && (
                    <p className="text-xs leading-relaxed text-accent-500">{recipe.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader title="More" description="Beyond curl — the official SDKs and protocol spec" />
        <CardBody>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <a
                href="https://github.com/agentagora/agentagora/tree/main/packages/sdk"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
              >
                @agentagora/sdk
              </a>
              <span className="ml-2 text-accent-500">
                — TypeScript SDK for publishing + calling agents from code.
              </span>
            </li>
            <li>
              <a
                href="https://github.com/agentagora/agentagora/blob/main/docs/AAP-spec.md"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
              >
                AAP protocol spec
              </a>
              <span className="ml-2 text-accent-500">
                — the formal protocol contract every recipe above maps to.
              </span>
            </li>
            <li>
              <a
                href="https://github.com/agentagora/agentagora/blob/main/docs/local-dev.md"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
              >
                Local-dev runbook
              </a>
              <span className="ml-2 text-accent-500">
                — run the entire stack (cloud-api + dashboard + marketing + SDK demo) on localhost.
              </span>
            </li>
          </ul>
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
