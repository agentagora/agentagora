/**
 * In-memory MockStripeApiClient.
 *
 * Implements the same surface as HttpStripeApiClient without going
 * over the wire. Tracks created accounts + issued links so tests
 * can assert exact bodies and simulate failures.
 */

import type {
  CreateAccountLinkInput,
  CreateExpressAccountInput,
  StripeAccountLink,
  StripeAccountStatus,
  StripeApiClient,
} from "../src/stripe.js";

export interface MockStripeOptions {
  /** When set, the next createExpressAccount call rejects with this error. */
  failNextCreateAccount?: Error;
  /** When set, the next createAccountLink call rejects with this error. */
  failNextCreateLink?: Error;
}

export class MockStripeApiClient implements StripeApiClient {
  private nextAccountId = 1;
  readonly accounts = new Map<string, StripeAccountStatus>();
  readonly createAccountCalls: CreateExpressAccountInput[] = [];
  readonly createLinkCalls: CreateAccountLinkInput[] = [];

  constructor(private readonly options: MockStripeOptions = {}) {}

  async createExpressAccount(input: CreateExpressAccountInput): Promise<StripeAccountStatus> {
    if (this.options.failNextCreateAccount) {
      const err = this.options.failNextCreateAccount;
      this.options.failNextCreateAccount = undefined;
      throw err;
    }
    this.createAccountCalls.push({ ...input });
    const id = `acct_test_${this.nextAccountId++}`;
    const status: StripeAccountStatus = {
      id,
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
    };
    this.accounts.set(id, status);
    return status;
  }

  async createAccountLink(input: CreateAccountLinkInput): Promise<StripeAccountLink> {
    if (this.options.failNextCreateLink) {
      const err = this.options.failNextCreateLink;
      this.options.failNextCreateLink = undefined;
      throw err;
    }
    this.createLinkCalls.push({ ...input });
    return {
      url: `https://stripe.test/onboard/${input.account}`,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    };
  }

  async retrieveAccount(accountId: string): Promise<StripeAccountStatus> {
    const stored = this.accounts.get(accountId);
    if (!stored) throw new Error(`unknown account ${accountId}`);
    return { ...stored };
  }

  /** Test helper — flip the boolean flags as if onboarding completed. */
  markOnboarded(accountId: string): void {
    const stored = this.accounts.get(accountId);
    if (!stored) throw new Error(`unknown account ${accountId}`);
    this.accounts.set(accountId, {
      ...stored,
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
    });
  }
}
