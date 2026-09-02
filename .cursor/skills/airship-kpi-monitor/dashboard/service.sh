#!/usr/bin/env bash
# Keep the airship-kpi-monitor local dashboard server always up (macOS).
#
# serve.command / `uv run serve.py` tie the server to the terminal (or Cursor
# session) that launched it, so it dies whenever that window closes. This wraps
# serve.py in a launchd **user agent** instead: it starts at login, restarts
# automatically if it ever exits, and survives reboots.
#
# OPTIONAL, and strictly local: the agent only ever binds 127.0.0.1 and touches
# no credentials. Nothing here is written to the repo.
#
#   ./service.sh install     # install + start (idempotent)
#   ./service.sh status      # is it loaded / responding?
#   ./service.sh restart     # bounce it (e.g. after editing serve.py)
#   ./service.sh logs        # follow the server log
#   ./service.sh uninstall   # stop + remove the agent
#
# Requires `uv` (https://docs.astral.sh/uv/); ruamel.yaml is pulled inline.
set -euo pipefail

LABEL="com.airship.kpi-monitor.dashboard"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${AIRSHIP_KPI_DASHBOARD_PORT:-8787}"
URL="http://127.0.0.1:${PORT}"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
# launchd opens the log (and chdir's) BEFORE exec'ing, as a process with no TCC
# grants. If the repo lives under a protected folder (~/Documents, ~/Desktop,
# iCloud Drive…) that pre-exec open is denied and the job dies with EX_CONFIG,
# logging nothing. ~/Library/Logs is never protected, so the agent logs there.
LOG="$HOME/Library/Logs/${LABEL}.log"
DOMAIN="gui/$(id -u)"

die() { echo "error: $*" >&2; exit 1; }

# launchd starts agents with a minimal PATH, so the plist needs uv's real path.
resolve_uv() {
  local uv
  uv="$(command -v uv 2>/dev/null || true)"
  [ -n "$uv" ] || for c in "$HOME/.local/bin/uv" /opt/homebrew/bin/uv /usr/local/bin/uv; do
    [ -x "$c" ] && uv="$c" && break
  done
  [ -n "$uv" ] || die "uv not found. Install it from https://docs.astral.sh/uv/ then re-run."
  printf '%s' "$uv"
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

probe() { curl -fsS -o /dev/null --max-time 3 "$URL" 2>/dev/null; }

is_loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

# Anything already holding the port would make the agent exit-and-retry forever
# (serve.py refuses to bind twice), so clear a foreign listener before starting.
stop_foreign_listener() {
  local pids
  pids="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  [ -n "$pids" ] || return 0
  echo "→ stopping process(es) already listening on :$PORT ($(echo "$pids" | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    probe || break
    sleep 0.5
  done
}

write_plist() {
  local uv dir_esc uv_esc log_esc
  uv="$(resolve_uv)"
  uv_esc="$(xml_escape "$uv")"
  dir_esc="$(xml_escape "$DIR")"
  log_esc="$(xml_escape "$LOG")"
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${uv_esc}</string>
        <string>run</string>
        <string>--with</string>
        <string>ruamel.yaml</string>
        <string>${dir_esc}/serve.py</string>
    </array>

    <!-- Deliberately \$HOME, not the repo: launchd chdir's before exec and a
         protected repo path would fail the same way the log path does.
         serve.py resolves everything from its own __file__, so cwd is free. -->
    <key>WorkingDirectory</key>
    <string>${HOME}</string>

    <!-- Start at login and keep it up: launchd relaunches the server whenever
         it exits, for any reason. ThrottleInterval caps the retry rate so a
         persistent failure cannot spin. -->
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${log_esc}</string>
    <key>StandardErrorPath</key>
    <string>${log_esc}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>AIRSHIP_KPI_DASHBOARD_PORT</key>
        <string>${PORT}</string>
    </dict>
</dict>
</plist>
PLIST_EOF
}

cmd_install() {
  [ -f "$DIR/serve.py" ] || die "serve.py not found next to this script."
  # Replace any previous registration so install is safely repeatable.
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  stop_foreign_listener
  write_plist
  echo "→ wrote $PLIST"
  launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null ||
    launchctl load -w "$PLIST" 2>/dev/null ||
    die "launchctl could not load the agent. Check $LOG"
  launchctl enable "$DOMAIN/$LABEL" >/dev/null 2>&1 || true

  for _ in $(seq 1 30); do
    probe && break
    sleep 0.5
  done
  if probe; then
    echo "✓ dashboard server is up at $URL and will restart automatically (login + on exit)."
  else
    echo "✗ agent installed but $URL is not answering yet — first run may still be" >&2
    echo "  resolving dependencies. Check: ./service.sh logs" >&2
    exit 1
  fi
}

cmd_uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 ||
    launchctl unload -w "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "✓ agent stopped and removed ($PLIST)."
  echo "  The dashboard still works offline: open $DIR/index.html"
}

cmd_restart() {
  is_loaded || die "agent is not installed. Run: ./service.sh install"
  launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || die "could not restart the agent."
  for _ in $(seq 1 30); do
    probe && break
    sleep 0.5
  done
  probe && echo "✓ restarted — $URL is answering." || die "restarted but $URL is silent. See ./service.sh logs"
}

cmd_status() {
  if is_loaded; then
    local pid
    pid="$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null | awk '/^[[:space:]]*pid = /{print $3; exit}')"
    if [ -n "$pid" ]; then
      echo "agent:  installed, running (pid $pid)"
    else
      echo "agent:  installed but not running — launchd will retry; see logs"
    fi
  else
    echo "agent:  NOT installed  → ./service.sh install"
  fi
  probe && echo "http:   $URL responding ✓" || echo "http:   $URL not responding ✗"
  echo "plist:  $PLIST"
  echo "log:    $LOG"
}

cmd_logs() { touch "$LOG"; tail -n 40 -f "$LOG"; }

case "${1:-status}" in
  install) cmd_install ;;
  uninstall|remove) cmd_uninstall ;;
  restart|reload) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  *) echo "usage: $0 {install|status|restart|logs|uninstall}" >&2; exit 2 ;;
esac
