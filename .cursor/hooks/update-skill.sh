#!/usr/bin/env bash
# Auto-update the airship-kpi-monitor workspace skill on session start.
# Fail-open: never block the session (no network, no git, conflicts -> no-op).
# --ff-only only fast-forwards the branch; gitignored clients.yml is never touched.
set -u
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo '{}'; exit 0; }
git pull --ff-only --quiet >/dev/null 2>&1 || true
echo '{}'
exit 0
