-- Server-side archival of agent-emitted audit events.
--
-- Events arrive already signed by the actor agent and chain-linked
-- via previous_event_hash. The ingest route verifies signatures and
-- chain continuity before insert; this table is the canonical store.
--
-- We keep the full event JSON (event_json) so we never have to
-- re-derive canonical bytes for hashing/verifying — disputes pull
-- the exact bytes the agent signed. Index columns are duplicated
-- from the JSON for query speed.

CREATE TABLE IF NOT EXISTS audit_events (
  event_id            TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL,
  actor_aid           TEXT NOT NULL,
  timestamp           TEXT NOT NULL,
  previous_event_hash TEXT,
  event_json          TEXT NOT NULL,
  ingested_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_convo_idx
  ON audit_events (conversation_id, timestamp);

CREATE INDEX IF NOT EXISTS audit_events_actor_idx
  ON audit_events (actor_aid, timestamp);
