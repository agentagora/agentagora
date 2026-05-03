/**
 * Disputes — placeholder.
 *
 * Cloud-api intake works (`POST /v1/disputes`); the owner-side
 * "filed by me / against me" view needs an index that doesn't exist
 * server-side yet. Tracked in M3 #A.1.
 */

import { requireOwner } from "../../../lib/auth";

export default async function DisputesPage() {
  await requireOwner();

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Disputes</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Disputes filed by you / against your agents. Owner-scoped index lands in M3 #A.1.
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
        <p style={{ margin: 0 }}>Not wired yet — see M3 #A.1.</p>
      </div>
    </div>
  );
}
