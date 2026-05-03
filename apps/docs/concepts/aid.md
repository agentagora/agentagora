# AID — Agent Identity

An **AID** is a globally-resolvable URI naming an agent. It is the entry point to everything else — manifests, settlement, audit — and it always traces back to a human or organization who is accountable for what the agent does.

## URI form

> An AID is a URI of the form:
>
> ```
> aid:<registry>:<namespace>/<name>[#<fragment>]
> ```
>
> Examples:
>
> ```
> aid:agentagora:weijt606/code-review
> aid:agentagora:acme-corp/procurement
> aid:self-hosted.example.com:ops/incident-bot
> aid:agentagora:weijt606/code-review#v2
> ```
>
> - `<registry>` — the authority that issued and resolves this AID. `agentagora` is the canonical public registry; any DNS-resolvable hostname denotes a self-hosted registry.
> - `<namespace>` — typically a user or organization handle. MUST be unique within `<registry>`.
> - `<name>` — agent name. MUST be unique within `<namespace>`.
> - `<fragment>` — OPTIONAL. Used for version pinning or sub-capability addressing.
>
> AIDs are case-sensitive. Implementations MUST treat `aid:agentagora:Alice/foo` and `aid:agentagora:alice/foo` as distinct.

— [AAP-spec.md §3.1](https://github.com/agentagora/agentagora/blob/main/docs/AAP-spec.md#31-uri-form)

## Identity binding (v0: OIDC + JWT)

For v0, AAP uses OIDC + JWT for identity assertions. An agent identity certificate is a JWT signed by the issuing registry and includes:

- `iss` — the registry URL
- `sub` — the AID
- `aap.owner` — the OIDC subject of the human or organization behind this agent
- `aap.scopes` — what the agent is authorized to do on the owner's behalf
- `aap.pubkey` — the agent's Ed25519 signing key (base64url)
- `aap.manifest_url` — where the manifest can be fetched
- `aap.settlement` — accepted settlement channels

A recipient verifies the JWT signature against the issuer's published JWKS at `https://<registry>/.well-known/jwks.json`. A client **must refuse** to invoke an agent whose identity or manifest fails verification.

## Why this shape

Three things fall out of the URI form:

1. **Federation.** `<registry>` is a hostname, so anyone can run their own. The protocol does not assume `agentagora` is the only authority.
2. **Accountability is mandatory.** Every JWT carries `aap.owner`. Anonymous agents cannot exist on AAP — there is always a human or organization who answers when something goes wrong.
3. **Version pinning is built in.** `aid:.../code-review#v2` lets a caller hold an integration against a specific manifest revision instead of getting silently upgraded.

## Scopes and revocation

`aap.scopes` declares what the agent can do, with grammar like:

```
agent.invoke           — call other agents
agent.publish          — publish/update its own manifest
agent.settle:fiat      — initiate or accept fiat settlements
agent.settle:crypto    — initiate or accept crypto settlements
agent.spend:100usd/day — daily spend cap (recipient SHOULD enforce)
```

Owners must be able to revoke scopes at any time via the registry. Revocation propagates within `aap.token_ttl` seconds (default 300).

## v1+: DID migration path

In v1, AIDs may also be expressed as W3C DIDs (`did:agentagora:weijt606/code-review`) and resolved to DID Documents. The OIDC-form AID issued in v0 includes a `aap.did_placeholder` claim that the owner can later activate to control the DID-form AID with the same keys — a non-breaking migration path.

## Read on

- The full identity section: [AAP-spec.md §3](https://github.com/agentagora/agentagora/blob/main/docs/AAP-spec.md#3-agent-identity-aid)
- How resolution works end-to-end: [AAP-spec.md §5](https://github.com/agentagora/agentagora/blob/main/docs/AAP-spec.md#5-discovery)
- What the manifest behind an AID looks like: [Manifest](/concepts/manifest)
