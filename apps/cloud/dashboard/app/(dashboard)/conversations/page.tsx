/**
 * Conversations list — placeholder.
 *
 * The cloud-api exposes `GET /v1/conversations/:id` (read one chain
 * by ID) but no owner-scoped index. Until that exists, the dashboard
 * cannot enumerate "conversations involving my agents" — the
 * audit ingest stream is the source of truth, and the dashboard
 * isn't subscribed yet. Tracked in `docs/m3-launch-checklist.md`
 * §A.1.
 */

import { requireOwner } from "../../../lib/auth";

export default async function ConversationsPage() {
  await requireOwner();

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Conversations</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Conversation lookup by ID. An owner-scoped index lands once the cloud-api can join
        conversations to <code>published_by</code> via the audit log.
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
