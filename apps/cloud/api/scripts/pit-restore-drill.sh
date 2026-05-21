#!/usr/bin/env bash
#
# M.11 PIT (point-in-time) restore drill — production D1.
#
# RUNBOOK §3.4 flags PIT-restore as un-rehearsed. Until this is run
# once on real prod data the durability story is theoretical. This
# script encodes the maintainer-tasks.md M.11 acceptance criteria as
# two idempotent phases so the actual wall-clock cost is bounded.
#
# What it does:
#   phase=write  → INSERT a sentinel row into production audit_events
#                  with a unique event_id, print the id, exit.
#   phase=verify → export prod D1 → create a scratch D1 → import the
#                  dump into the scratch → SELECT the sentinel id from
#                  scratch → delete the scratch DB → delete the
#                  sentinel from prod → exit 0 if the row was found.
#
# Why two phases: M.11 requires waiting ≥ 1h between write and
# verify so the export captures recent writes. Single-process would
# pin a terminal for an hour; two-phase lets you walk away.
#
# Run from repo root.
#
# Usage:
#   ./apps/cloud/api/scripts/pit-restore-drill.sh write
#   # wait ≥ 1 hour
#   ./apps/cloud/api/scripts/pit-restore-drill.sh verify pit-drill-2026-05-21T133045Z
#
# Both phases use `pnpm --filter @agentagora/cloud-api exec wrangler …`
# so the cloud-api package's pinned wrangler is the one driving prod —
# matches the RUNBOOK §1.3 / §1.4 convention.

set -euo pipefail

PHASE="${1:-}"
SENTINEL_ID="${2:-}"

WR="pnpm --filter @agentagora/cloud-api exec wrangler"
PROD_DB_BINDING="DB"
SCRATCH_DB_NAME="agentagora-cloud-pit-scratch"

usage() {
  cat <<'USAGE' >&2
M.11 PIT restore drill.

Usage:
  pit-restore-drill.sh write
  pit-restore-drill.sh verify <sentinel-id>

Phases:
  write   Insert a sentinel row into production audit_events. Prints
          the sentinel id you'll need for `verify`.
  verify  Export prod D1, restore into a scratch D1, query for the
          sentinel id, tear down the scratch DB, and delete the sentinel
          from prod. Requires the id printed by `write`.

Requires:
  - logged-in wrangler with access to the production agentagora-cloud
    D1 binding (DB)
  - jq (for safely embedding the timestamp in the JSON payload)
USAGE
  exit 1
}

ensure_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "::error::jq not found on PATH — install jq before running this drill" >&2
    exit 1
  }
}

phase_write() {
  ensure_jq
  local ts iso json
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local sentinel="pit-drill-${ts}"
  json="$(jq -nc --arg ts "$iso" --arg id "$sentinel" \
    '{drill:true,event_id:$id,written_at:$ts,purpose:"M.11 PIT restore drill"}')"

  echo "[pit-drill] inserting sentinel row id=${sentinel}"
  $WR d1 execute "$PROD_DB_BINDING" --remote --command \
    "INSERT INTO audit_events (event_id, conversation_id, actor_aid, timestamp, event_json, ingested_at) \
     VALUES ('${sentinel}', 'conv-pit-drill', 'aid:pit:drill/sentinel', '${iso}', '${json}', '${iso}');"

  cat <<NEXT

✓ Sentinel written. Wait ≥ 1 hour (per M.11 acceptance criteria), then run:

    ./apps/cloud/api/scripts/pit-restore-drill.sh verify ${sentinel}

NEXT
}

phase_verify() {
  [[ -n "$SENTINEL_ID" ]] || usage
  [[ "$SENTINEL_ID" =~ ^pit-drill-[0-9]{8}T[0-9]{6}Z$ ]] || {
    echo "::error::sentinel id '${SENTINEL_ID}' doesn't match expected shape pit-drill-YYYYMMDDTHHMMSSZ" >&2
    exit 1
  }

  local ts dump
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dump="/tmp/agentagora-pit-drill-${ts}.sql"

  echo "[pit-drill] 1/5 exporting production D1 → ${dump}"
  $WR d1 export "$PROD_DB_BINDING" --remote --output "$dump"
  echo "[pit-drill]     dump size: $(wc -c <"$dump") bytes"

  echo "[pit-drill] 2/5 creating scratch D1 ${SCRATCH_DB_NAME}"
  $WR d1 create "$SCRATCH_DB_NAME"

  echo "[pit-drill] 3/5 importing dump into scratch"
  $WR d1 execute "$SCRATCH_DB_NAME" --remote --file "$dump"

  echo "[pit-drill] 4/5 querying scratch for sentinel id=${SENTINEL_ID}"
  local found_output
  found_output="$($WR d1 execute "$SCRATCH_DB_NAME" --remote --json --command \
    "SELECT event_id, timestamp FROM audit_events WHERE event_id = '${SENTINEL_ID}';" || true)"
  echo "$found_output"

  local hit
  hit="$(echo "$found_output" | jq -r '..|objects|select(has("event_id"))|.event_id' | head -n1 || true)"

  echo "[pit-drill] 5/5 tearing down scratch + clearing prod sentinel"
  $WR d1 delete "$SCRATCH_DB_NAME" --skip-confirmation || \
    $WR d1 delete "$SCRATCH_DB_NAME"
  $WR d1 execute "$PROD_DB_BINDING" --remote --command \
    "DELETE FROM audit_events WHERE event_id = '${SENTINEL_ID}';"

  if [[ "$hit" == "$SENTINEL_ID" ]]; then
    echo
    echo "✓ DRILL PASSED — sentinel ${SENTINEL_ID} survived the export → import roundtrip."
    echo "  Update RUNBOOK §3.4: replace 'un-rehearsed' note with date + elapsed wall-clock + dump size."
    exit 0
  else
    echo
    echo "::error::DRILL FAILED — sentinel ${SENTINEL_ID} not found in restored scratch DB."
    echo "  Check the export step output above. Do NOT mark RUNBOOK §3.4 as rehearsed."
    exit 1
  fi
}

case "$PHASE" in
  write)  phase_write ;;
  verify) phase_verify ;;
  *)      usage ;;
esac
