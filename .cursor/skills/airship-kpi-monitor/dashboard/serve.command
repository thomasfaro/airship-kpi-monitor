#!/usr/bin/env bash
# One-click launcher for the airship-kpi-monitor local dashboard server (macOS:
# double-click in Finder). Starts serve.py and opens the page in your browser.
# OPTIONAL — the dashboard also works offline from file:// (read-only).
#
# Requires `uv` (https://docs.astral.sh/uv/). ruamel.yaml is pulled inline.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${AIRSHIP_KPI_DASHBOARD_PORT:-8787}"
URL="http://127.0.0.1:${PORT}"

cd "$DIR" || exit 1

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. Install it from https://docs.astral.sh/uv/ then re-run." >&2
  echo "Meanwhile you can still open the dashboard read-only: open \"$DIR/index.html\"" >&2
  read -r -p "Press Return to close…" _ || true
  exit 1
fi

# Open the browser shortly after the server starts (server keeps this shell busy).
( sleep 1; (command -v open >/dev/null 2>&1 && open "$URL") || true ) &

echo "Starting dashboard server on $URL  (close this window or press Ctrl-C to stop)"
exec uv run --with ruamel.yaml "$DIR/serve.py"
