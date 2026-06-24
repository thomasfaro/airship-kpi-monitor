#!/usr/bin/env python3
"""Generate ~/.cursor/mcp.json Airship MCP entries from the client registry.

OPTIONAL convenience for setting up MANY Airship MCP servers at once. If your
MCP servers are already configured in Cursor, you do not need this script —
credentials live in ~/.cursor/mcp.json and nowhere else.

Inputs:
  - clients.yml            (committed, non-secret routing; provides region)
  - clients.secrets.yml    (gitignored; OAuth creds + airship_mcp_dir)

Behaviour:
  - For every client present in clients.secrets.yml, build an `mcpServers`
    entry (command `uv run --directory <airship_mcp_dir> airship-mcp`).
  - Merge into the existing ~/.cursor/mcp.json, preserving every server the
    script did not create (e.g. the Slack plugin). A timestamped backup is
    written to mcp.json.bak before any change.
  - Warn (never delete) when a secrets entry has no matching clients.yml route,
    or when an existing same-named server looks managed by something else.

Run with uv so PyYAML is available without a global install:

    uv run --with pyyaml scripts/generate_mcp_config.py [--dry-run] [--print]

Flags:
  --dry-run   Show the diff/result, write nothing.
  --print     Print the resulting Airship entries (creds redacted) and exit.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - guidance only
    sys.exit(
        "PyYAML is required. Run this script via:\n"
        "    uv run --with pyyaml scripts/generate_mcp_config.py"
    )

REPO_ROOT = Path(__file__).resolve().parent.parent
CLIENTS_YML = REPO_ROOT / "clients.yml"
SECRETS_YML = REPO_ROOT / "clients.secrets.yml"
MCP_JSON = Path.home() / ".cursor" / "mcp.json"

REDACTED = "***redacted***"


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def load_routes() -> dict[str, dict]:
    """Map MCP server name (without `user-` prefix) -> clients.yml entry."""
    data = load_yaml(CLIENTS_YML)
    routes: dict[str, dict] = {}
    for entry in data.get("clients", []) or []:
        mcp = (entry.get("airship_mcp") or "").strip()
        if not mcp:
            continue
        key = mcp[len("user-"):] if mcp.startswith("user-") else mcp
        routes[key] = entry
    return routes


def build_entry(airship_mcp_dir: str, app_key: str, client_id: str,
                client_secret: str, region: str) -> dict:
    return {
        "command": "uv",
        "args": ["run", "--directory", airship_mcp_dir, "airship-mcp"],
        "env": {
            "AIRSHIP_APP_KEY": app_key,
            "AIRSHIP_CLIENT_ID": client_id,
            "AIRSHIP_CLIENT_SECRET": client_secret,
            "AIRSHIP_REGION": region,
        },
    }


def is_airship_entry(entry: dict) -> bool:
    if not isinstance(entry, dict):
        return False
    args = entry.get("args") or []
    env = entry.get("env") or {}
    return "airship-mcp" in args or "AIRSHIP_APP_KEY" in env


def redact(entry: dict) -> dict:
    clone = json.loads(json.dumps(entry))
    for key in ("AIRSHIP_APP_KEY", "AIRSHIP_CLIENT_ID", "AIRSHIP_CLIENT_SECRET"):
        if key in clone.get("env", {}):
            clone["env"][key] = REDACTED
    return clone


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would change; write nothing.")
    parser.add_argument("--print", dest="print_only", action="store_true",
                        help="Print resulting Airship entries (redacted) and exit.")
    args = parser.parse_args()

    secrets_doc = load_yaml(SECRETS_YML)
    if not secrets_doc:
        sys.exit(
            f"No secrets found. Create {SECRETS_YML.name} from "
            "clients.secrets.example.yml first (this script is optional)."
        )

    settings = secrets_doc.get("settings", {}) or {}
    airship_mcp_dir = settings.get("airship_mcp_dir")
    default_region = settings.get("default_region", "eu")
    if not airship_mcp_dir:
        sys.exit("settings.airship_mcp_dir is required in clients.secrets.yml.")

    routes = load_routes()
    secrets = secrets_doc.get("secrets", {}) or {}
    if not secrets:
        sys.exit("No `secrets:` entries found in clients.secrets.yml.")

    generated: dict[str, dict] = {}
    for name, creds in secrets.items():
        missing = [k for k in ("app_key", "client_id", "client_secret")
                   if not (creds or {}).get(k)]
        if missing:
            print(f"  ! skipping '{name}': missing {', '.join(missing)}")
            continue
        route = routes.get(name)
        if route is None:
            print(f"  ! warning: '{name}' has no matching clients.yml entry "
                  "(airship_mcp: user-" + name + "); generating anyway.")
        region = (creds.get("region")
                  or (route or {}).get("region")
                  or default_region)
        generated[name] = build_entry(
            airship_mcp_dir, creds["app_key"], creds["client_id"],
            creds["client_secret"], region,
        )

    if not generated:
        sys.exit("Nothing to generate after validation.")

    if args.print_only:
        print(json.dumps({"mcpServers": {k: redact(v)
                                         for k, v in generated.items()}},
                         indent=2, ensure_ascii=False))
        return 0

    existing = {}
    if MCP_JSON.exists():
        try:
            existing = json.loads(MCP_JSON.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            sys.exit(f"Existing {MCP_JSON} is not valid JSON: {exc}")
    servers = existing.setdefault("mcpServers", {})

    created, updated = [], []
    for name, entry in generated.items():
        if name in servers:
            if not is_airship_entry(servers[name]):
                print(f"  ! warning: '{name}' already exists and does NOT look "
                      "like an Airship MCP server; overwriting per secrets file.")
            updated.append(name)
        else:
            created.append(name)
        servers[name] = entry

    print(f"\nAirship MCP dir : {airship_mcp_dir}")
    print(f"Target mcp.json : {MCP_JSON}")
    print(f"Created  ({len(created)}): {', '.join(created) or '—'}")
    print(f"Updated  ({len(updated)}): {', '.join(updated) or '—'}")
    preserved = [k for k in servers if k not in generated]
    print(f"Preserved({len(preserved)}): {', '.join(preserved) or '—'}")

    if args.dry_run:
        print("\n[dry-run] No changes written.")
        return 0

    MCP_JSON.parent.mkdir(parents=True, exist_ok=True)
    if MCP_JSON.exists():
        backup = MCP_JSON.with_suffix(
            f".json.bak.{datetime.now():%Y%m%d-%H%M%S}")
        shutil.copy2(MCP_JSON, backup)
        # Also keep a stable mcp.json.bak (gitignored) for quick rollback.
        shutil.copy2(MCP_JSON, MCP_JSON.with_name("mcp.json.bak"))
        print(f"\nBackup written  : {backup}")

    MCP_JSON.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote           : {MCP_JSON}")
    print("Reload Cursor (or toggle the MCP servers) to pick up the changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
