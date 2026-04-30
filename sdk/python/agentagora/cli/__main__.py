"""agentagora CLI entry point.

Subcommands per docs/sdk-api.md section 9. v0.0.1 wires up the
argparse skeleton and routes to handlers; concrete implementations
land alongside the corresponding SDK methods.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from .. import __version__


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agentagora",
        description="AgentAgora — agent interop CLI",
    )
    parser.add_argument("--version", action="version", version=f"agentagora {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("login", help="Interactive OIDC login flow")
    sub.add_parser("whoami", help="Show current owner and registered agents")

    agents = sub.add_parser("agents", help="Manage agents").add_subparsers(
        dest="agents_cmd", required=True
    )
    agents.add_parser("list", help="List my agents")
    publish = agents.add_parser("publish", help="Publish or update an agent manifest")
    publish.add_argument("manifest", help="Path to manifest.yaml or manifest.json")

    call = sub.add_parser("call", help="Call a capability on an agent")
    call.add_argument("aid", help="Target AID")
    call.add_argument("capability", help="Capability name")
    call.add_argument("--json", help="Inputs as JSON string", default="{}")

    convs = sub.add_parser("conversations", help="List conversations").add_subparsers(
        dest="conv_cmd", required=True
    )
    list_cmd = convs.add_parser("list")
    list_cmd.add_argument("--since", help="e.g. 7d, 24h")

    audit = sub.add_parser("audit", help="Audit log helpers").add_subparsers(
        dest="audit_cmd", required=True
    )
    verify = audit.add_parser("verify", help="Verify a local audit log")
    verify.add_argument("path", help="Path to audit log JSONL")

    keys = sub.add_parser("keys", help="Key management").add_subparsers(
        dest="keys_cmd", required=True
    )
    rotate = keys.add_parser("rotate", help="Rotate an agent's signing key")
    rotate.add_argument("agent_name")

    revoke = sub.add_parser("revoke", help="Revoke external access for a target AID")
    revoke.add_argument("target_aid")

    sub.add_parser(
        "config",
        help="Show resolved configuration (with source of each value)",
    ).set_defaults(command="config")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    print(f"agentagora {__version__}: command {args.command!r} is not yet implemented")
    print("See docs/sdk-api.md for the planned CLI surface.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
