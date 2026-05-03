"use client";

/**
 * Onboarding form — Client Component.
 *
 * The Server Component reads the encrypted session cookie and passes
 * the bearer in as a render-time prop (same pattern as the publish
 * form). The bearer never travels through the URL or response body
 * here — only this single in-memory prop, and only for the duration
 * the user is on this page.
 *
 * On submit, the form POSTs directly browser→cloud-api at
 * `${cloudApiBaseUrl}/v1/connect/onboarding`. The cloud-api responds
 * 201 with `{ onboarding_url, account_id, ... }`; we then redirect via
 * `window.location.href = onboarding_url` so the user lands on Stripe.
 *
 * `return_url` and `refresh_url` are derived from the current origin —
 * Stripe will send the user back to /onboarding/return on success or
 * /onboarding/refresh if the link expires.
 */

import { useState } from "react";

interface Props {
  cloudApiBaseUrl: string;
  bearer: string;
  defaultEmail?: string;
  /** Label shown on the submit button. Defaults to the create-account
   *  copy; pass "Resume onboarding" / "Get a fresh link" for the
   *  resume + refresh code paths. */
  submitLabel?: string;
}

interface OnboardingOk {
  account_id: string;
  onboarding_url: string;
  expires_at: string;
}

export function OnboardingForm({
  cloudApiBaseUrl,
  bearer,
  defaultEmail,
  submitLabel = "Start Stripe onboarding",
}: Props) {
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [country, setCountry] = useState("US");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    try {
      const origin = window.location.origin;
      const body: Record<string, string> = {
        return_url: `${origin}/onboarding/return`,
        refresh_url: `${origin}/onboarding/refresh`,
      };
      if (email.trim().length > 0) body.email = email.trim();
      if (country.trim().length > 0) body.country = country.trim().toUpperCase();

      const res = await fetch(`${cloudApiBaseUrl}/v1/connect/onboarding`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status !== 201) {
        const message =
          typeof json.message === "string"
            ? json.message
            : typeof json.error === "string"
              ? json.error
              : `HTTP ${res.status}`;
        const field = typeof json.field === "string" ? ` (${json.field})` : "";
        throw new Error(`${message}${field}`);
      }
      const ok = json as unknown as OnboardingOk;
      if (typeof ok.onboarding_url !== "string") {
        throw new Error("cloud-api returned no onboarding_url");
      }
      // Hand off to Stripe. We don't `setBusy(false)` because the
      // page is about to unload anyway.
      window.location.href = ok.onboarding_url;
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}
    >
      <fieldset
        disabled={busy}
        style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 16, background: "#fff" }}
      >
        <legend style={{ padding: "0 6px", fontSize: 13, color: "#666" }}>Stripe account</legend>

        <Field label="Email (optional — prefills your Stripe account)">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            style={inputStyle()}
          />
        </Field>

        <Field label="Country (2-letter ISO code)">
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            required
            pattern="[A-Z]{2}"
            maxLength={2}
            style={inputStyle("mono")}
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
        {busy ? "Contacting Stripe…" : submitLabel}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: <label> wraps `children` which is always an input; biome can't see through React.ReactNode.
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
