"use client";

/**
 * File-a-dispute form — Client Component.
 *
 * Why client-side:
 *   The bearer is read from the encrypted session cookie server-side
 *   and passed in as a prop at render time, then the form POSTs
 *   directly browser → cloud-api at `${cloudApiBaseUrl}/v1/disputes`.
 *   This mirrors `_publish-form.tsx`: keep the bearer out of any
 *   Server Action / Route Handler round-trip, surface the cloud-api's
 *   error response inline without losing form state.
 *
 * Validation rules below mirror `parseFilingBody` in cloud-api's
 * `routes/disputes.ts`:
 *   - conversation_id, filer_aid, respondent_aid: non-empty strings
 *   - reason ∈ {non_delivery, wrong_output, fraud, other}
 *   - narrative ≤ 8192 chars (optional)
 *   - claimed_remedy ≤ 256 chars (optional)
 */

import { useMemo, useState } from "react";

type Reason = "non_delivery" | "wrong_output" | "fraud" | "other";

const REASONS: Reason[] = ["non_delivery", "wrong_output", "fraud", "other"];
const NARRATIVE_MAX = 8192;
const REMEDY_MAX = 256;

interface Props {
  cloudApiBaseUrl: string;
  bearer: string;
  ownedAids: string[];
  prefillConvo?: string;
  prefillRespondent?: string;
}

interface FiledOk {
  dispute_id: string;
}

export function FileDisputeForm({
  cloudApiBaseUrl,
  bearer,
  ownedAids,
  prefillConvo,
  prefillRespondent,
}: Props) {
  const [conversationId, setConversationId] = useState(prefillConvo ?? "");
  const [filerAid, setFilerAid] = useState(ownedAids[0] ?? "");
  const [respondentAid, setRespondentAid] = useState(prefillRespondent ?? "");
  const [reason, setReason] = useState<Reason>("non_delivery");
  const [narrative, setNarrative] = useState("");
  const [claimedRemedy, setClaimedRemedy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const narrativeRemaining = useMemo(() => NARRATIVE_MAX - narrative.length, [narrative]);

  function validate(): string | null {
    if (conversationId.trim().length === 0) {
      return "conversation_id must be a non-empty string";
    }
    if (filerAid.trim().length === 0) {
      return "filer_aid must be a non-empty string";
    }
    if (!ownedAids.includes(filerAid)) {
      return "filer_aid must be one of your published agents";
    }
    if (respondentAid.trim().length === 0) {
      return "respondent_aid must be a non-empty string";
    }
    if (!REASONS.includes(reason)) {
      return `reason must be one of: ${REASONS.join(", ")}`;
    }
    if (narrative.length > NARRATIVE_MAX) {
      return `narrative must be a string ≤ ${NARRATIVE_MAX} chars`;
    }
    if (claimedRemedy.length > REMEDY_MAX) {
      return `claimed_remedy must be a string ≤ ${REMEDY_MAX} chars`;
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const clientErr = validate();
    if (clientErr) {
      setErr(clientErr);
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        conversation_id: conversationId.trim(),
        filer_aid: filerAid,
        respondent_aid: respondentAid.trim(),
        reason,
      };
      if (narrative.length > 0) body.narrative = narrative;
      if (claimedRemedy.length > 0) body.claimed_remedy = claimedRemedy;

      const res = await fetch(`${cloudApiBaseUrl}/v1/disputes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 201) {
        const ok = json as unknown as FiledOk;
        // Land on the new case file in the inbox view.
        window.location.href = `/disputes?id=${encodeURIComponent(ok.dispute_id)}`;
        return;
      }

      // 400 / 403 / 404 — surface the cloud's response inline; keep
      // the form state intact so the user can fix and retry.
      const message = typeof json.message === "string" ? json.message : `HTTP ${res.status}`;
      const field = typeof json.field === "string" ? ` (${json.field})` : "";
      const errorCode = typeof json.error === "string" ? json.error : `http_${res.status}`;
      setErr(`${errorCode}${field}: ${message}`);
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (ownedAids.length === 0) {
    return (
      <div
        style={{
          border: "1px dashed #ccc",
          borderRadius: 8,
          padding: 24,
          background: "#fff",
          color: "#555",
          marginTop: 24,
        }}
      >
        <p style={{ margin: 0 }}>
          You haven't published any agents yet, so there's no <code>filer_aid</code> you can file on
          behalf of. Publish an agent first, then come back.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <fieldset
        disabled={busy}
        style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 16, background: "#fff" }}
      >
        <legend style={{ padding: "0 6px", fontSize: 13, color: "#666" }}>Case</legend>

        <Field label="conversation_id">
          <input
            type="text"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            required
            placeholder="conv_..."
            style={inputStyle("mono")}
          />
        </Field>

        <Field label="filer_aid (one of your agents)">
          <select
            value={filerAid}
            onChange={(e) => setFilerAid(e.target.value)}
            required
            style={inputStyle("mono")}
          >
            {ownedAids.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>

        <Field label="respondent_aid">
          <input
            type="text"
            value={respondentAid}
            onChange={(e) => setRespondentAid(e.target.value)}
            required
            placeholder="aid:agentagora:namespace/name"
            style={inputStyle("mono")}
          />
        </Field>
      </fieldset>

      <fieldset
        disabled={busy}
        style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 16, background: "#fff" }}
      >
        <legend style={{ padding: "0 6px", fontSize: 13, color: "#666" }}>Claim</legend>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: "#333" }}>reason</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {REASONS.map((r) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: <label> wraps the radio input.
              <label
                key={r}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                {r}
              </label>
            ))}
          </div>
        </div>

        <Field label={`narrative (optional, ${narrativeRemaining} of ${NARRATIVE_MAX} chars left)`}>
          <textarea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={6}
            maxLength={NARRATIVE_MAX}
            placeholder="What happened? Describe the failure, with timestamps and links to events if you can."
            style={{ ...inputStyle(), resize: "vertical" }}
          />
        </Field>

        <Field label={`claimed_remedy (optional, max ${REMEDY_MAX} chars)`}>
          <input
            type="text"
            value={claimedRemedy}
            onChange={(e) => setClaimedRemedy(e.target.value)}
            maxLength={REMEDY_MAX}
            placeholder="e.g. full refund of the call charge"
            style={inputStyle()}
          />
        </Field>
      </fieldset>

      {err ? (
        <div
          role="alert"
          style={{
            border: "1px solid #d93025",
            background: "#fce8e6",
            color: "#7c0c00",
            borderRadius: 8,
            padding: 12,
            fontSize: 14,
          }}
        >
          {err}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        style={{
          padding: "10px 16px",
          background: busy ? "#9ec5fe" : "#0366d6",
          color: "#fff",
          border: 0,
          borderRadius: 6,
          fontWeight: 600,
          cursor: busy ? "wait" : "pointer",
          alignSelf: "flex-start",
        }}
      >
        {busy ? "Filing…" : "File dispute"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: <label> wraps `children` which is always an input/select/textarea; biome can't see through React.ReactNode but native HTML associates them correctly.
    <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: "#333" }}>{label}</span>
      {children}
    </label>
  );
}

function inputStyle(variant?: "mono"): React.CSSProperties {
  return {
    padding: "8px 10px",
    border: "1px solid #ccc",
    borderRadius: 6,
    fontSize: 14,
    fontFamily: variant === "mono" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
}
