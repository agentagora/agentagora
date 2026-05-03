/**
 * Earnings + Stripe Connect — placeholder.
 *
 * Wired in M3 #A.3 once the dashboard owns the Stripe onboarding UX.
 * The cloud-api exposes `POST /v1/connect/onboarding` and
 * `GET /v1/connect/account` already — just the UX is pending.
 */

import { requireOwner } from "../../../lib/auth";

export default async function EarningsPage() {
  await requireOwner();

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Earnings</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Stripe Connect onboarding + payout status. Server side is wired in cloud-api; the UI lands
        in M3 #A.3.
      </p>

      <div
        style={{
          border: "1px dashed #ccc",
          borderRadius: 8,
          padding: 24,
          background: "#fff",
          color: "#666",
        }}
      >
        <p style={{ margin: 0 }}>Not wired yet — see M3 #A.3.</p>
      </div>
    </div>
  );
}
