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
import { Alert } from "../../../_components/alert";
import { Button } from "../../../_components/button";
import { Card, CardBody } from "../../../_components/card";
import { Input } from "../../../_components/input";
import { Field, FormHint, Label } from "../../../_components/label";

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
      <Card>
        <CardBody className="border border-dashed border-accent-200 text-sm text-accent-600">
          You haven't published any agents yet, so there's no <code>filer_aid</code> you can file on
          behalf of. Publish an agent first, then come back.
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormFieldset legend="Case" busy={busy}>
        <Field>
          <Label htmlFor="dispute-convo">conversation_id</Label>
          <Input
            id="dispute-convo"
            type="text"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            required
            placeholder="conv_..."
            mono
          />
        </Field>

        <Field>
          <Label htmlFor="dispute-filer" hint="one of your agents">
            filer_aid
          </Label>
          <select
            id="dispute-filer"
            value={filerAid}
            onChange={(e) => setFilerAid(e.target.value)}
            required
            className="block w-full rounded-md border border-accent-200 bg-white px-3 py-2 font-mono text-sm text-accent-900 shadow-sm transition-colors focus-visible:border-accent-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-800 focus-visible:ring-offset-1"
          >
            {ownedAids.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>

        <Field>
          <Label htmlFor="dispute-respondent">respondent_aid</Label>
          <Input
            id="dispute-respondent"
            type="text"
            value={respondentAid}
            onChange={(e) => setRespondentAid(e.target.value)}
            required
            placeholder="aid:agentagora:namespace/name"
            mono
          />
        </Field>
      </FormFieldset>

      <FormFieldset legend="Claim" busy={busy}>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-accent-800">reason</legend>
          <div className="flex flex-col gap-1.5">
            {REASONS.map((r) => (
              <label
                key={r}
                className="flex cursor-pointer items-center gap-2.5 font-mono text-sm text-accent-800"
              >
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="h-4 w-4 cursor-pointer accent-accent-800"
                />
                {r}
              </label>
            ))}
          </div>
        </fieldset>

        <Field>
          <Label htmlFor="dispute-narrative" hint="optional">
            narrative
          </Label>
          <textarea
            id="dispute-narrative"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={6}
            maxLength={NARRATIVE_MAX}
            placeholder="What happened? Describe the failure, with timestamps and links to events if you can."
            className="block w-full resize-y rounded-md border border-accent-200 bg-white px-3 py-2 text-sm leading-relaxed text-accent-900 shadow-sm transition-colors placeholder:text-accent-400 focus-visible:border-accent-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-800 focus-visible:ring-offset-1"
          />
          <FormHint>
            {narrativeRemaining} of {NARRATIVE_MAX} chars left
          </FormHint>
        </Field>

        <Field>
          <Label htmlFor="dispute-remedy" hint={`optional, ≤ ${REMEDY_MAX} chars`}>
            claimed_remedy
          </Label>
          <Input
            id="dispute-remedy"
            type="text"
            value={claimedRemedy}
            onChange={(e) => setClaimedRemedy(e.target.value)}
            maxLength={REMEDY_MAX}
            placeholder="e.g. full refund of the call charge"
          />
        </Field>
      </FormFieldset>

      {err && <Alert tone="danger">{err}</Alert>}

      <Button type="submit" disabled={busy} size="md" className="self-start">
        {busy ? "Filing…" : "File dispute"}
      </Button>
    </form>
  );
}

interface FormFieldsetProps {
  legend: string;
  busy: boolean;
  children: React.ReactNode;
}

function FormFieldset({ legend, busy, children }: FormFieldsetProps) {
  return (
    <fieldset
      disabled={busy}
      className="rounded-lg border border-accent-100 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] disabled:opacity-60"
    >
      <legend className="px-1.5 text-xs font-medium uppercase tracking-wider text-accent-500">
        {legend}
      </legend>
      <div className="mt-2 flex flex-col gap-4">{children}</div>
    </fieldset>
  );
}
