/**
 * Runtime config for the AAP compliance suite.
 *
 * The suite is intentionally URL-agnostic: it targets whatever cloud-api
 * candidate is reachable at `AAP_BASE_URL`. A second implementation
 * (self-host runtime, third-party registry) clones the suite, points
 * `AAP_BASE_URL` at their own deploy, and reads the pass/fail report.
 *
 * No bearer-tokens or fixtures are required for Tier 1 (read-path
 * public surface). Tier 2 / Tier 3 add `AAP_TEST_BEARER` and
 * `AAP_TEST_OWNER_AID` respectively — those tiers are out of scope
 * for this commit (see docs/m4-plan.md).
 */

export interface ComplianceConfig {
  /** Base URL of the cloud-api candidate under test. */
  baseUrl: string;
  /**
   * Bearer token for Tier 2/3 authenticated probes. Empty in Tier 1
   * runs. Tier 2/3 tests skip rather than fail when this is empty.
   */
  bearer: string;
  /**
   * AID of an agent owned by `bearer`. Required for Tier 2 owner-
   * scoped probes. Tier 1 ignores this.
   */
  testOwnerAid: string;
}

export function loadConfig(): ComplianceConfig {
  const raw = process.env.AAP_BASE_URL ?? "http://localhost:8787";
  // Strip trailing slash so callers can confidently do `${baseUrl}/healthz`.
  const baseUrl = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return {
    baseUrl,
    bearer: process.env.AAP_TEST_BEARER ?? "",
    testOwnerAid: process.env.AAP_TEST_OWNER_AID ?? "",
  };
}

/**
 * Compliance tests are *integration probes* — they need a live
 * cloud-api candidate. Plain `pnpm -r test` in CI shouldn't try to
 * run them (no candidate is reachable in CI's pure-unit-test world),
 * so we gate the suite behind an explicit opt-in: set
 * `AAP_BASE_URL` (any value), or set `AAP_RUN_COMPLIANCE=1` to
 * run against the localhost:8787 default.
 *
 * When this returns false, every test file in `tests/` short-circuits
 * via `describe.skipIf(!shouldRun)`, leaving the run green-and-skipped
 * rather than red-and-broken.
 */
export function shouldRunCompliance(): boolean {
  return process.env.AAP_BASE_URL !== undefined || process.env.AAP_RUN_COMPLIANCE === "1";
}
