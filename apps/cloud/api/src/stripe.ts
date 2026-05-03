/**
 * Thin Stripe API client.
 *
 * Just the surface cloud-api needs (Connect Express onboarding +
 * account status). Talking to Stripe via fetch keeps the bundle
 * Workers-friendly — no `stripe-node` dependency.
 *
 * Tests inject a MockStripeApiClient; production wires
 * HttpStripeApiClient with the STRIPE_SECRET_KEY env / secret.
 */

export interface StripeAccountStatus {
  id: string;
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
}

export interface StripeAccountLink {
  url: string;
  expires_at: number;
}

export interface CreateExpressAccountInput {
  /** Owner's email; surfaces in the Stripe dashboard for support. */
  email?: string;
  /** Two-letter ISO country code; defaults to "US" when omitted. */
  country?: string;
}

export interface CreateAccountLinkInput {
  account: string;
  refresh_url: string;
  return_url: string;
}

export interface StripeApiClient {
  createExpressAccount(input: CreateExpressAccountInput): Promise<StripeAccountStatus>;
  createAccountLink(input: CreateAccountLinkInput): Promise<StripeAccountLink>;
  retrieveAccount(accountId: string): Promise<StripeAccountStatus>;
}

/**
 * Real Stripe API client. Uses the live REST endpoints (form-encoded
 * POST bodies + bearer secret key auth — Stripe's standard).
 */
export class HttpStripeApiClient implements StripeApiClient {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://api.stripe.com",
  ) {}

  async createExpressAccount(input: CreateExpressAccountInput): Promise<StripeAccountStatus> {
    const params = new URLSearchParams();
    params.set("type", "express");
    if (input.email) params.set("email", input.email);
    params.set("country", input.country ?? "US");
    params.append("capabilities[card_payments][requested]", "true");
    params.append("capabilities[transfers][requested]", "true");
    return this.post<StripeAccountStatus>("/v1/accounts", params);
  }

  async createAccountLink(input: CreateAccountLinkInput): Promise<StripeAccountLink> {
    const params = new URLSearchParams();
    params.set("account", input.account);
    params.set("refresh_url", input.refresh_url);
    params.set("return_url", input.return_url);
    params.set("type", "account_onboarding");
    return this.post<StripeAccountLink>("/v1/account_links", params);
  }

  async retrieveAccount(accountId: string): Promise<StripeAccountStatus> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/accounts/${accountId}`, {
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    if (!res.ok) {
      throw await stripeError("retrieveAccount", res);
    }
    return (await res.json()) as StripeAccountStatus;
  }

  private async post<T>(path: string, params: URLSearchParams): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      throw await stripeError(path, res);
    }
    return (await res.json()) as T;
  }
}

async function stripeError(op: string, res: Response): Promise<Error> {
  let body: string;
  try {
    body = await res.text();
  } catch {
    body = "<unreadable>";
  }
  return new Error(`Stripe ${op} failed (${res.status}): ${body}`);
}
