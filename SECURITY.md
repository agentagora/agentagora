# Security Policy

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Two private channels:

1. **GitHub Security Advisories** (preferred): https://github.com/agentagora/agentagora/security/advisories/new
   — Submits a private report visible only to maintainers.

2. **Email**: `security@agentagora.dev` with subject prefix `[security] AgentAgora:`
   — Use this if you cannot access GitHub Security Advisories.

Please include:

- A description of the vulnerability and its potential impact
- Reproduction steps or proof-of-concept (where safe to share)
- Affected version, commit SHA, or environment
- Whether you've discussed it elsewhere (we'd like to know)

## Response timeline

This is a pre-alpha project with a single maintainer. Realistic expectations:

| Stage | Target |
|---|---|
| Acknowledgement | within 5 business days |
| Triage and severity assessment | within 14 days |
| Fix or coordinated disclosure plan | depends on severity |

Once production users exist (after M3 public beta), this policy will tighten.

## Scope

In scope:
- The AAP protocol design itself (cryptographic, semantic, or economic flaws)
- `@agentagora/protocol` and `@agentagora/sdk` packages
- The `agentagora/agentagora` repository's CI / build pipeline
- AgentAgora Cloud (when it goes live in M2; not yet deployed)
- Self-host runtime when published (M9)

Out of scope:
- Bugs in third-party dependencies (please report upstream first; we'll coordinate)
- Findings in the Python SDK (`sdk/python/`) — currently frozen, will be revisited at M5
- Issues in example apps (`apps/examples/`) unless they reflect an SDK or protocol flaw

## Disclosure preference

We prefer **coordinated disclosure** with at least 30 days for users to update before public release of a fix. We will credit reporters in the changelog and security advisory unless they request anonymity.

## Cryptographic assumptions

The current AAP cryptography stack:

- **Ed25519** signatures via `@noble/ed25519` (audited)
- **JCS** canonicalization (RFC 8785) via the `canonicalize` package
- **SHA-256** for audit chain hashes via `@noble/hashes`

If you find a way to forge envelopes, replay messages successfully, break the audit chain, or extract keys from a properly-deployed agent — that is in scope and high-priority.

## Hall of fame

(none yet)
