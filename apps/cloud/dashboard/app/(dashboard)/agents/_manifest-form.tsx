"use client";

/**
 * Shared manifest form — Client Component.
 *
 * Backs both `/agents/new` (mode="publish") and `/agents/[aid]/edit`
 * (mode="edit"). The two flows hit the same `POST /v1/agents` endpoint
 * — cloud-api's publish handler is an upsert keyed on `manifest.aid`,
 * gated by:
 *   - the bearer's resolved owner matching the existing record's
 *     `published_by`, and
 *   - the presented Ed25519 pubkey matching the existing record's
 *     pinned `pubkey` (TOFU pin; security-review-2026-05 §M2).
 *
 * That means the only meaningful difference between the two modes from
 * the wire's perspective is the *initial state* of the form. We model
 * that with a `mode` discriminator + `initialManifest` prop:
 *
 *   - mode="publish": defaults that walk a first-time user through
 *     building a single-capability manifest from scratch.
 *   - mode="edit":    pre-filled from the existing manifest. The AID
 *     field is read-only because the route is keyed on it (changing
 *     it would publish a *different* AID, not edit this one). A
 *     prominent banner explains the TOFU rotation rule.
 *
 * Why client-side (same reasoning as the original publish form):
 *   1. The user's Ed25519 *private key* must never be transmitted to
 *      the dashboard server. Signing happens entirely in this tab via
 *      `lib/sign-manifest.ts`.
 *   2. The bearer is read from the encrypted session cookie
 *      server-side and passed in as a prop at render time.
 *
 * Multi-capability manifests are deliberately out of scope here —
 * editing one through this form would clobber the extra capabilities.
 * A `multiCapabilityWarning` is shown in edit mode when the loaded
 * manifest has > 1 capability, and the form refuses to submit.
 */

import type { Manifest } from "@agentagora/protocol";
import { useState } from "react";
import { signManifest } from "../../../lib/sign-manifest";

type PricingModel = "free" | "per_call";

export type ManifestFormMode = "publish" | "edit";

interface Props {
  mode: ManifestFormMode;
  cloudApiBaseUrl: string;
  bearer: string;
  /** Required in edit mode; ignored in publish mode. */
  initialManifest?: Manifest;
  /** Optional override for the post-success redirect target. Defaults
   *  to no redirect (publish mode keeps the legacy "show JWT" panel)
   *  or to `/agents/<aid>` (edit mode). */
  onPublishedHref?: (aid: string) => string;
}

interface PublishOk {
  aid: string;
  identity_jwt: string;
  published_at: string;
  published_by?: string;
  pubkey?: string;
}

const PASSTHROUGH_INPUT_SCHEMA = { type: "object", additionalProperties: true };
const PASSTHROUGH_OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

interface InitialState {
  aid: string;
  description: string;
  rpcUrl: string;
  capName: string;
  pricingModel: PricingModel;
  amount: string;
  currency: string;
  accepts: string;
  /** True when the loaded manifest has more than one capability — the
   *  simple form shape can't round-trip those, so we refuse to submit. */
  multiCapability: boolean;
}

function publishDefaults(): InitialState {
  return {
    aid: "aid:agentagora:example/my-bot",
    description: "",
    rpcUrl: "https://example.com/rpc",
    capName: "greet",
    pricingModel: "free",
    amount: "0.01",
    currency: "USD",
    accepts: "stripe-test",
    multiCapability: false,
  };
}

function fromManifest(m: Manifest): InitialState {
  // Edit mode renders the first capability; the form intentionally
  // doesn't expose multi-capability editing. `multiCapability` flips
  // a guard banner in the form body. The cap-0 access is guarded by
  // `ManifestSchema`'s `.min(1)` constraint on `capabilities`, but
  // `noUncheckedIndexedAccess` doesn't see through Zod — so we narrow
  // explicitly with a fallback to the publish defaults if the array is
  // somehow empty (cloud-api would have rejected the upsert in that
  // case, but defensive code is cheap).
  const cap = m.capabilities[0];
  if (!cap) {
    const fallback = publishDefaults();
    return { ...fallback, aid: m.aid, description: m.description ?? "", rpcUrl: m.endpoints.rpc };
  }
  const pricingModel: PricingModel = cap.pricing.model === "free" ? "free" : "per_call";
  return {
    aid: m.aid,
    description: m.description ?? "",
    rpcUrl: m.endpoints.rpc,
    capName: cap.name,
    pricingModel,
    amount: cap.pricing.amount ?? "0.01",
    currency: cap.pricing.currency ?? "USD",
    accepts: cap.accepts.join(", "),
    multiCapability: m.capabilities.length > 1,
  };
}

export function ManifestForm({
  mode,
  cloudApiBaseUrl,
  bearer,
  initialManifest,
  onPublishedHref,
}: Props) {
  const seed =
    mode === "edit" && initialManifest ? fromManifest(initialManifest) : publishDefaults();

  const [aid, setAid] = useState(seed.aid);
  const [description, setDescription] = useState(seed.description);
  const [rpcUrl, setRpcUrl] = useState(seed.rpcUrl);
  const [capName, setCapName] = useState(seed.capName);
  const [pricingModel, setPricingModel] = useState<PricingModel>(seed.pricingModel);
  const [amount, setAmount] = useState(seed.amount);
  const [currency, setCurrency] = useState(seed.currency);
  const [accepts, setAccepts] = useState(seed.accepts);
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errStatus, setErrStatus] = useState<number | null>(null);
  const [ok, setOk] = useState<PublishOk | null>(null);

  const aidReadOnly = mode === "edit";

  function buildManifest(): Record<string, unknown> {
    const acceptsList =
      pricingModel === "free"
        ? []
        : accepts
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

    const pricing =
      pricingModel === "free"
        ? { model: "free" as const }
        : { model: "per_call" as const, amount, currency };

    return {
      manifest_version: 1,
      aid,
      description: description || undefined,
      endpoints: { rpc: rpcUrl },
      capabilities: [
        {
          name: capName,
          input_schema: PASSTHROUGH_INPUT_SCHEMA,
          output_schema: PASSTHROUGH_OUTPUT_SCHEMA,
          pricing,
          accepts: acceptsList,
        },
      ],
    };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setErrStatus(null);
    setOk(null);

    try {
      if (seed.multiCapability) {
        throw new Error(
          "this manifest declares more than one capability — editing through this form would clobber the extras. Edit raw JSON via the cloud-api directly until the multi-capability editor lands.",
        );
      }
      const manifest = buildManifest();
      const signed = await signManifest(manifest, privateKey);

      // Wipe the private key out of state immediately after use.
      // The DOM textarea's `value` is also rebound below; this is
      // best-effort defence-in-depth, not a real secure-erase.
      setPrivateKey("");

      const res = await fetch(`${cloudApiBaseUrl}/v1/agents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
          "x-aap-pubkey": signed.pubkey,
          "x-aap-signature": signed.signature,
        },
        body: signed.body,
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const message = typeof json.message === "string" ? json.message : `HTTP ${res.status}`;
        setErrStatus(res.status);
        throw new Error(message);
      }
      const result = json as unknown as PublishOk;
      setOk(result);

      // Edit mode: redirect on success straight to the read view (the
      // "JWT panel" success card is overkill for an in-place edit).
      if (mode === "edit" && onPublishedHref) {
        window.location.href = onPublishedHref(result.aid);
      }
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  // Publish mode: render the legacy success card with the issued JWT
  // once the round-trip completes. Edit mode redirects via
  // `window.location` above and never reaches this branch — but keep
  // the guard inclusive in case the redirect fails.
  if (ok && mode === "publish") {
    return (
      <div
        style={{
          border: "1px solid #6f42c1",
          borderRadius: 8,
          padding: 24,
          background: "#fff",
          marginTop: 24,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Published.</h2>
        <p style={{ color: "#555" }}>
          Your manifest is now in the cloud-api registry. The cloud-api issued the identity JWT
          below — agents can verify it via <code>{cloudApiBaseUrl}/.well-known/jwks.json</code>.
        </p>
        <dl style={{ fontSize: 14 }}>
          <dt style={{ fontWeight: 600 }}>AID</dt>
          <dd>
            <a href={`/agents/${encodeURIComponent(ok.aid)}`} style={{ color: "#0366d6" }}>
              {ok.aid}
            </a>
          </dd>
          <dt style={{ fontWeight: 600, marginTop: 8 }}>Identity JWT</dt>
          <dd>
            <code style={{ wordBreak: "break-all", fontSize: 12 }}>{ok.identity_jwt}</code>
          </dd>
        </dl>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}
    >
      {mode === "edit" ? (
        <div
          role="note"
          style={{
            border: "1px solid #b58105",
            background: "#fff8e1",
            color: "#5b3b00",
            borderRadius: 8,
            padding: 12,
            fontSize: 14,
          }}
        >
          <strong>Use the same private key.</strong> Cloud-api pins the AID to the Ed25519 pubkey
          you originally published with (TOFU). Submitting a manifest signed by any other key will
          be rejected with HTTP 403 and your edit will be lost. The AID field is read-only — to
          publish a different agent, use the{" "}
          <a href="/agents/new" style={{ color: "#0366d6" }}>
            publish flow
          </a>
          .
        </div>
      ) : null}

      {seed.multiCapability ? (
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
          <strong>This manifest declares more than one capability.</strong> The form below only
          edits the first capability and would drop the rest on submit — submission is disabled
          until the multi-capability editor ships. Edit raw JSON via the cloud-api directly in the
          meantime.
        </div>
      ) : null}

      <fieldset
        disabled={busy}
        style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 16, background: "#fff" }}
      >
        <legend style={{ padding: "0 6px", fontSize: 13, color: "#666" }}>Identity</legend>

        <Field label={aidReadOnly ? "AID (read-only — keyed on this value)" : "AID"}>
          <input
            type="text"
            value={aid}
            onChange={(e) => setAid(e.target.value)}
            required
            readOnly={aidReadOnly}
            placeholder="aid:agentagora:namespace/name"
            style={{
              ...inputStyle("mono"),
              background: aidReadOnly ? "#f4f4f4" : undefined,
              color: aidReadOnly ? "#555" : undefined,
              cursor: aidReadOnly ? "not-allowed" : undefined,
            }}
          />
        </Field>

        <Field label="Description">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
            style={inputStyle()}
          />
        </Field>

        <Field label="RPC endpoint URL">
          <input
            type="url"
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
            required
            placeholder="https://example.com/rpc"
            style={inputStyle()}
          />
        </Field>
      </fieldset>

      <fieldset
        disabled={busy}
        style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 16, background: "#fff" }}
      >
        <legend style={{ padding: "0 6px", fontSize: 13, color: "#666" }}>Capability</legend>

        <Field label="Capability name">
          <input
            type="text"
            value={capName}
            onChange={(e) => setCapName(e.target.value)}
            required
            pattern="[A-Za-z_][A-Za-z0-9_]*"
            style={inputStyle("mono")}
          />
        </Field>

        <Field label="Pricing">
          <select
            value={pricingModel}
            onChange={(e) => setPricingModel(e.target.value as PricingModel)}
            style={inputStyle()}
          >
            <option value="free">free</option>
            <option value="per_call">per call</option>
          </select>
        </Field>

        {pricingModel === "per_call" ? (
          <>
            <Field label='Amount (decimal string, e.g. "0.50")'>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                pattern="\d+(\.\d+)?"
                style={inputStyle("mono")}
              />
            </Field>

            <Field label="Currency">
              <input
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                required
                style={inputStyle("mono")}
              />
            </Field>

            <Field label="Settlement channels (comma-separated)">
              <input
                type="text"
                value={accepts}
                onChange={(e) => setAccepts(e.target.value)}
                required
                placeholder="stripe-test, x402-eth-mainnet"
                style={inputStyle("mono")}
              />
            </Field>
          </>
        ) : null}
      </fieldset>

      <fieldset
        disabled={busy}
        style={{
          border: "1px solid #d93025",
          borderRadius: 8,
          padding: 16,
          background: "#fff7f6",
        }}
      >
        <legend style={{ padding: "0 6px", fontSize: 13, color: "#7c0c00" }}>Sensitive</legend>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#444" }}>
          Paste your raw Ed25519 private key as base64url.{" "}
          <strong>This stays in your browser</strong> — it is used to sign the canonical manifest
          bytes and then cleared from memory. The dashboard server never receives it.
        </p>
        <Field label="Ed25519 private key (base64url, 32-byte seed)">
          <textarea
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            required
            rows={3}
            spellCheck={false}
            autoComplete="off"
            style={{ ...inputStyle("mono"), resize: "vertical" }}
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
          <div>{err}</div>
          {errStatus === 403 && mode === "edit" ? (
            <div style={{ marginTop: 8, fontSize: 13, color: "#5a0a00" }}>
              <strong>TOFU pin rejected.</strong> The cloud-api refuses pubkey rotations through the
              open POST path because it would let any valid bearer hijack an AID. To rotate the
              signing key for an AID you already own, the cloud-api operator must clear the pinned
              pubkey out of band (no self-service path today). Otherwise re-paste the same private
              key you originally published with — your form values above are preserved.
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy || seed.multiCapability}
        style={{
          padding: "10px 16px",
          background: busy || seed.multiCapability ? "#9ec5fe" : "#0366d6",
          color: "#fff",
          border: 0,
          borderRadius: 6,
          fontWeight: 600,
          cursor: busy ? "wait" : seed.multiCapability ? "not-allowed" : "pointer",
          alignSelf: "flex-start",
        }}
      >
        {busy
          ? mode === "edit"
            ? "Signing & updating…"
            : "Signing & publishing…"
          : mode === "edit"
            ? "Sign & update"
            : "Sign & publish"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: <label> wraps `children` which is always an input/select; biome can't see through React.ReactNode but native HTML associates them correctly.
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
