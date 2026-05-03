"use client";

/**
 * Publish form — Client Component.
 *
 * Why client-side:
 *   1. The user's Ed25519 *private key* must never be transmitted to
 *      the dashboard server. Signing happens entirely in this tab via
 *      `lib/sign-manifest.ts` (which loads `@noble/ed25519` in the
 *      browser bundle).
 *   2. The bearer token is read from the encrypted session cookie
 *      server-side and passed in as a prop at render time. This does
 *      put the bearer into the RSC stream / page memory — that's an
 *      accepted tradeoff for the closed-alpha placeholder. Once OIDC
 *      replaces `OWNER_TOKENS`, the signed payload will flow through
 *      a server-side proxy so the bearer stays on the server.
 *
 * The form builds a single-capability manifest (sufficient for the
 * "publish my first agent" flow), signs it, and POSTs to cloud-api.
 * Multi-capability manifests can be hand-edited via a future raw-JSON
 * mode.
 */

import { useState } from "react";
import { signManifest } from "../../../../lib/sign-manifest";

type PricingModel = "free" | "per_call";

interface Props {
  cloudApiBaseUrl: string;
  bearer: string;
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

export function PublishForm({ cloudApiBaseUrl, bearer }: Props) {
  const [aid, setAid] = useState("aid:agentagora:example/my-bot");
  const [description, setDescription] = useState("");
  const [rpcUrl, setRpcUrl] = useState("https://example.com/rpc");
  const [capName, setCapName] = useState("greet");
  const [pricingModel, setPricingModel] = useState<PricingModel>("free");
  const [amount, setAmount] = useState("0.01");
  const [currency, setCurrency] = useState("USD");
  const [accepts, setAccepts] = useState("stripe-test");
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<PublishOk | null>(null);

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
    setOk(null);

    try {
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
        throw new Error(message);
      }
      setOk(json as unknown as PublishOk);
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (ok) {
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
      <fieldset
        disabled={busy}
        style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 16, background: "#fff" }}
      >
        <legend style={{ padding: "0 6px", fontSize: 13, color: "#666" }}>Identity</legend>

        <Field label="AID">
          <input
            type="text"
            value={aid}
            onChange={(e) => setAid(e.target.value)}
            required
            placeholder="aid:agentagora:namespace/name"
            style={inputStyle("mono")}
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
        {busy ? "Signing & publishing…" : "Sign & publish"}
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
