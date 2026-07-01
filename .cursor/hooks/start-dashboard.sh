#!/usr/bin/env bash
# Auto-start the local KPI dashboard server on session start (OPTIONAL).
# Fail-open, idempotent, and quick-returning: it never blocks the session, and
# it no-ops if uv is missing, the server file is absent, or it's already running.
# To disable auto-start, remove the matching entry in .cursor/hooks.json.
# The server is localhost-only and writes only the gitignored clients.yml — no
# secrets ever (see serve.py).
set -u

DIR=".cursor/skills/airship-kpi-monitor/dashboard"
PORT="${AIRSHIP_KPI_DASHBOARD_PORT:-8787}"
PIDFILE="$DIR/.server.pid"
LOG="$DIR/.server.log"

# Always print valid JSON for the hook runner, whatever happens below.
finish() { echo '{}'; exit 0; }

command -v uv >/dev/null 2>&1 || finish
[ -f "$DIR/serve.py" ] || finish

# Already running? (live pidfile, or the port is bound) -> no-op.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then finish; fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then finish; fi

# Start detached in the background; capture the pid; never block the session.
(
  cd "$DIR" || exit 0
  nohup uv run --with ruamel.yaml serve.py >>".server.log" 2>&1 &
  echo $! > ".server.pid"
) >/dev/null 2>&1 &

finish
