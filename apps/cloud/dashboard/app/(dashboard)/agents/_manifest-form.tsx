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
import Link from "next/link";
import { useState } from "react";
import { signManifest } from "../../../lib/sign-manifest";
import { Alert } from "../../_components/alert";
import { Button } from "../../_components/button";
import { Card, CardBody, CardHeader } from "../../_components/card";
import { Input } from "../../_components/input";
import { Field, Label } from "../../_components/label";

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
      <Card>
        <CardHeader
          title="Published"
          description="Your manifest is now in the cloud-api registry."
        />
        <CardBody>
          <p className="text-sm leading-relaxed text-accent-700">
            The cloud-api issued the identity JWT below — agents can verify it via{" "}
            <code className="rounded bg-accent-100 px-1.5 py-0.5 font-mono text-[12px] text-accent-800">
              {cloudApiBaseUrl}/.well-known/jwks.json
            </code>
            .
          </p>
          <dl
            className="mt-5 grid items-baseline gap-x-6 gap-y-3 text-sm"
            style={{ gridTemplateColumns: "max-content 1fr" }}
          >
            <dt className="font-medium text-accent-700">AID</dt>
            <dd className="m-0">
              <Link
                href={`/agents/${encodeURIComponent(ok.aid)}`}
                className="font-mono text-sm font-medium text-accent-900 underline underline-offset-2 hover:text-accent-700"
              >
                {ok.aid}
              </Link>
            </dd>
            <dt className="font-medium text-accent-700">Identity JWT</dt>
            <dd className="m-0">
              <code className="block break-all font-mono text-[12px] text-accent-800">
                {ok.identity_jwt}
              </code>
            </dd>
          </dl>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {mode === "edit" && (
        <Alert tone="warn" title="Use the same private key">
          Cloud-api pins the AID to the Ed25519 pubkey you originally published with (TOFU).
          Submitting a manifest signed by any other key will be rejected with HTTP 403 and your edit
          will be lost. The AID field is read-only — to publish a different agent, use the{" "}
          <Link
            href="/agents/new"
            className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
          >
            publish flow
          </Link>
          .
        </Alert>
      )}

      {seed.multiCapability && (
        <Alert tone="danger" title="This manifest declares more than one capability">
          The form below only edits the first capability and would drop the rest on submit —
          submission is disabled until the multi-capability editor ships. Edit raw JSON via the
          cloud-api directly in the meantime.
        </Alert>
      )}

      <FormFieldset legend="Identity" busy={busy}>
        <Field>
          <Label htmlFor="manifest-aid">
            {aidReadOnly ? "AID (read-only — keyed on this value)" : "AID"}
          </Label>
          <Input
            id="manifest-aid"
            type="text"
            value={aid}
            onChange={(e) => setAid(e.target.value)}
            required
            readOnly={aidReadOnly}
            placeholder="aid:agentagora:namespace/name"
            mono
            className={aidReadOnly ? "cursor-not-allowed bg-accent-50 text-accent-500" : undefined}
          />
        </Field>

        <Field>
          <Label htmlFor="manifest-description">Description</Label>
          <Input
            id="manifest-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
          />
        </Field>

        <Field>
          <Label htmlFor="manifest-rpc">RPC endpoint URL</Label>
          <Input
            id="manifest-rpc"
            type="url"
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
            required
            placeholder="https://example.com/rpc"
          />
        </Field>
      </FormFieldset>

      <FormFieldset legend="Capability" busy={busy}>
        <Field>
          <Label htmlFor="manifest-cap-name">Capability name</Label>
          <Input
            id="manifest-cap-name"
            type="text"
            value={capName}
            onChange={(e) => setCapName(e.target.value)}
            required
            pattern="[A-Za-z_][A-Za-z0-9_]*"
            mono
          />
        </Field>

        <Field>
          <Label htmlFor="manifest-pricing">Pricing</Label>
          <select
            id="manifest-pricing"
            value={pricingModel}
            onChange={(e) => setPricingModel(e.target.value as PricingModel)}
            className="block w-full rounded-md border border-accent-200 bg-white px-3 py-2 text-sm text-accent-900 shadow-sm transition-colors focus-visible:border-accent-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-800 focus-visible:ring-offset-1"
          >
            <option value="free">free</option>
            <option value="per_call">per call</option>
          </select>
        </Field>

        {pricingModel === "per_call" && (
          <>
            <Field>
              <Label htmlFor="manifest-amount" hint='decimal string, e.g. "0.50"'>
                Amount
              </Label>
              <Input
                id="manifest-amount"
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                pattern="\d+(\.\d+)?"
                mono
              />
            </Field>

            <Field>
              <Label htmlFor="manifest-currency">Currency</Label>
              <Input
                id="manifest-currency"
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                required
                mono
              />
            </Field>

            <Field>
              <Label htmlFor="manifest-accepts" hint="comma-separated">
                Settlement channels
              </Label>
              <Input
                id="manifest-accepts"
                type="text"
                value={accepts}
                onChange={(e) => setAccepts(e.target.value)}
                required
                placeholder="stripe-test, x402-eth-mainnet"
                mono
              />
            </Field>
          </>
        )}
      </FormFieldset>

      <FormFieldset legend="Sensitive" busy={busy} tone="danger">
        <p className="text-sm leading-relaxed text-accent-700">
          Paste your raw Ed25519 private key as base64url.{" "}
          <strong className="font-semibold">This stays in your browser</strong> — it is used to sign
          the canonical manifest bytes and then cleared from memory. The dashboard server never
          receives it.
        </p>
        <Field>
          <Label htmlFor="manifest-private-key" hint="base64url, 32-byte seed">
            Ed25519 private key
          </Label>
          {/* security-review-2026-05-07 §L2: use type=password so the
              value is masked on screen + signals "secret" to screen
              readers; explicit opt-out attrs for 1Password / LastPass /
              Bitwarden so they don't fingerprint the field by name and
              prompt to save the value. spellCheck stays off; autoComplete
              and autoCapitalize forced off (textarea defaulted them
              "off" already but inputs need it explicit). */}
          <Input
            id="manifest-private-key"
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            required
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            mono
          />
        </Field>
      </FormFieldset>

      {err && (
        <Alert tone="danger">
          <div>{err}</div>
          {errStatus === 403 && mode === "edit" && (
            <p className="mt-3 leading-relaxed text-red-900/90">
              <strong className="font-semibold">TOFU pin rejected.</strong> The cloud-api refuses
              pubkey rotations through the open POST path because it would let any valid bearer
              hijack an AID. To rotate the signing key for an AID you already own, the cloud-api
              operator must clear the pinned pubkey out of band (no self-service path today).
              Otherwise re-paste the same private key you originally published with — your form
              values above are preserved.
            </p>
          )}
        </Alert>
      )}

      <Button
        type="submit"
        disabled={busy || seed.multiCapability}
        size="md"
        className="self-start"
      >
        {busy
          ? mode === "edit"
            ? "Signing & updating…"
            : "Signing & publishing…"
          : mode === "edit"
            ? "Sign & update"
            : "Sign & publish"}
      </Button>
    </form>
  );
}

interface FormFieldsetProps {
  legend: string;
  busy: boolean;
  /** Apply the "sensitive" red border when this fieldset holds secrets. */
  tone?: "neutral" | "danger";
  children: React.ReactNode;
}

/**
 * Light wrapper around native `<fieldset>` so the `disabled` prop
 * gates every input at once (and we get the bundled a11y for free).
 * `tone="danger"` is reserved for the private-key fieldset so the
 * red chrome signals "secret zone" without us reinventing a stronger
 * Alert + form-inside-Alert pattern.
 */
function FormFieldset({ legend, busy, tone = "neutral", children }: FormFieldsetProps) {
  const borderColor = tone === "danger" ? "border-red-200" : "border-accent-100";
  const bg = tone === "danger" ? "bg-red-50/40" : "bg-white";
  const legendColor = tone === "danger" ? "text-red-800" : "text-accent-500";
  return (
    <fieldset
      disabled={busy}
      className={`rounded-lg border ${borderColor} ${bg} p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] disabled:opacity-60`}
    >
      <legend className={`px-1.5 text-xs font-medium uppercase tracking-wider ${legendColor}`}>
        {legend}
      </legend>
      <div className="mt-2 flex flex-col gap-4">{children}</div>
    </fieldset>
  );
}
