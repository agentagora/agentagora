/**
 * /v1/connect — Stripe Connect Express onboarding.
 *
 *   POST /v1/connect/onboarding   create or refresh an onboarding link  [Bearer]
 *   GET  /v1/connect/account      read the caller's account status       [Bearer]
 *
 * Each cloud owner has exactly one Stripe Connect account. First call
 * to /onboarding creates it; subsequent calls return the existing
 * account ID with a fresh account_link (Stripe links expire). This
 * makes the route idempotent for resume-after-bounce flows.
 *
 * The route never returns the Stripe secret key; only account IDs +
 * URLs the owner already needs to see.
 */

import { type Context, Hono } from "hono";
import type { OwnerAuthenticator } from "../auth.js";
import type { Storage, StripeAccountRecord } from "../storage.js";
import type { StripeApiClient } from "../stripe.js";

interface RouterDeps {
  storage: Storage;
  ownerAuth: OwnerAuthenticator;
  stripe: StripeApiClient;
  /** Override the wall clock for deterministic tests. */
  now?: () => Date;
}

interface OnboardingBody {
  return_url: string;
  refresh_url: string;
  email?: string;
  country?: string;
}

interface OnboardingValidationFailure {
  ok: false;
  field: string;
  message: string;
}

function parseOnboardingBody(
  raw: unknown,
): { ok: true; value: OnboardingBody } | OnboardingValidationFailure {
  if (!raw || typeof raw !== "object") {
    return { ok: false, field: "$", message: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  const url = (key: string): string | OnboardingValidationFailure => {
    const v = r[key];
    if (typeof v !== "string" || v.length === 0) {
      return { ok: false, field: key, message: `${key} must be a non-empty string` };
    }
    if (!/^https?:\/\//.test(v)) {
      return { ok: false, field: key, message: `${key} must be an http(s) URL` };
    }
    return v;
  };
  const ret = url("return_url");
  if (typeof ret !== "string") return ret;
  const ref = url("refresh_url");
  if (typeof ref !== "string") return ref;

  const out: OnboardingBody = { return_url: ret, refresh_url: ref };
  if (r.email !== undefined) {
    if (typeof r.email !== "string" || r.email.length === 0) {
      return { ok: false, field: "email", message: "email must be a non-empty string" };
    }
    out.email = r.email;
  }
  if (r.country !== undefined) {
    if (typeof r.country !== "string" || !/^[A-Z]{2}$/.test(r.country)) {
      return {
        ok: false,
        field: "country",
        message: "country must be a 2-letter ISO code (e.g. US)",
      };
    }
    out.country = r.country;
  }
  return { ok: true, value: out };
}

export function createConnectRouter({
  storage,
  ownerAuth,
  stripe,
  now = () => new Date(),
}: RouterDeps): Hono {
  const router = new Hono();

  router.post("/onboarding", async (c) => {
    const ownerId = await authorize(c.req.header("authorization"), ownerAuth);
    if (typeof ownerId !== "string") return ownerId;

    const parsed = parseOnboardingBody(await c.req.json().catch(() => null));
    if (!parsed.ok) {
      return c.json({ error: "invalid_body", field: parsed.field, message: parsed.message }, 400);
    }
    const body = parsed.value;

    let record = await storage.getStripeAccountByOwner(ownerId);
    const ts = now().toISOString();

    if (!record) {
      const acctInput: { email?: string; country?: string } = {};
      if (body.email !== undefined) acctInput.email = body.email;
      if (body.country !== undefined) acctInput.country = body.country;
      let created: Awaited<ReturnType<StripeApiClient["createExpressAccount"]>>;
      try {
        created = await stripe.createExpressAccount(acctInput);
      } catch (err) {
        return stripeFailure(c, "createExpressAccount", err);
      }
      record = {
        ownerId,
        stripeAccountId: created.id,
        detailsSubmitted: created.details_submitted,
        chargesEnabled: created.charges_enabled,
        payoutsEnabled: created.payouts_enabled,
        createdAt: ts,
        updatedAt: ts,
      };
      await storage.upsertStripeAccount(record);
    }

    let link: Awaited<ReturnType<StripeApiClient["createAccountLink"]>>;
    try {
      link = await stripe.createAccountLink({
        account: record.stripeAccountId,
        return_url: body.return_url,
        refresh_url: body.refresh_url,
      });
    } catch (err) {
      return stripeFailure(c, "createAccountLink", err);
    }

    return c.json(
      {
        account_id: record.stripeAccountId,
        onboarding_url: link.url,
        expires_at: new Date(link.expires_at * 1000).toISOString(),
        status: viewStatus(record),
      },
      201,
    );
  });

  router.get("/account", async (c) => {
    const ownerId = await authorize(c.req.header("authorization"), ownerAuth);
    if (typeof ownerId !== "string") return ownerId;

    const record = await storage.getStripeAccountByOwner(ownerId);
    if (!record) {
      return c.json({ error: "not_found", message: "no Stripe account for this owner" }, 404);
    }
    return c.json({
      account_id: record.stripeAccountId,
      status: viewStatus(record),
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  });

  return router;
}

async function authorize(
  header: string | undefined,
  ownerAuth: OwnerAuthenticator,
): Promise<string | Response> {
  const token = extractBearer(header);
  if (!token) {
    return jsonResponse({ error: "unauthorized", message: "missing bearer token" }, 401);
  }
  const ownerId = await ownerAuth.resolve(token);
  if (!ownerId) {
    return jsonResponse({ error: "unauthorized", message: "invalid bearer token" }, 401);
  }
  return ownerId;
}

function viewStatus(record: StripeAccountRecord): {
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
} {
  return {
    details_submitted: record.detailsSubmitted,
    charges_enabled: record.chargesEnabled,
    payouts_enabled: record.payoutsEnabled,
  };
}

function stripeFailure(c: Context, op: string, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[connect] Stripe ${op} failed`, err);
  return c.json({ error: "stripe_unavailable", op, message }, 502);
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
