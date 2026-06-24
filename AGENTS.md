# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

`airship-kpi-monitor` is a **documentation-only Cursor Skill**, not a conventional
software project. The entire deliverable is three Markdown files:

- `SKILL.md` — the core logic/playbook read by the Cursor agent at runtime.
- `MODOP.md` — step-by-step setup guide for TAMs (per-client onboarding).
- `README.md` — product overview.

There is **no source code, no package manager, no lockfile, and no
build/test/lint tooling**. There is nothing to compile or install for this repo
itself — the update script is intentionally a no-op.

### How the "application" runs

The "application" is `SKILL.md` executed by a **Cursor Cloud Agent** (model:
latest Claude Sonnet) on a daily schedule. Each run:

1. Reads `SKILL.md`.
2. Calls the **Airship Reports API** via an **Airship MCP server** (`call_airship_api`).
3. Computes rolling 7-day-window deltas and evaluates thresholds.
4. Posts Slack alerts via the **Slack MCP** (`slack_send_message`) and maintains
   a weekly **Slack canvas** (`slack_create_canvas` / `slack_update_canvas`).

The Slack canvas doubles as the database — Cloud Agents have no local storage,
so each run reads the D-7 device snapshot from the canvas and writes today's
snapshot back to it.

To "run in development": follow the manual-test prompt in `MODOP.md` Part 3 (or
the automation template in `README.md`), referencing a client's Airship MCP
server name and a Slack channel ID.

### Required external integrations (NOT installable from this repo)

Running the skill end-to-end requires two MCP servers configured in Cursor /
Cloud Agents — neither can be provisioned from this VM via shell:

- **Airship MCP** (one entry per client). Backed by the internal `airship-mcp`
  Python package launched with `uv run` (the package is internal — obtain from
  the team). Requires per-client OAuth secrets with scopes exactly `rpt` + `tpl`:
  `AIRSHIP_APP_KEY`, `AIRSHIP_CLIENT_ID`, `AIRSHIP_CLIENT_SECRET`, `AIRSHIP_REGION`
  (`us` or `eu`). See `MODOP.md` §1.5–1.6.
- **Slack MCP** (`plugin-slack-slack`) — must be authenticated/enabled in Cursor.

### Non-obvious gotchas

- The Slack MCP `slack_send_message` call requires the `message` parameter (NOT
  `text`); using `text` silently returns `no_text` and posts nothing. See
  `SKILL.md` Step 10.
- Canvas links must use `https://{workspace}.slack.com/docs/{team_id}/{canvas_id}`
  (team ID in the path) — `https://app.slack.com/docs/{canvas_id}` breaks.
- First run shows device WoW deltas as `n/a (canvas history pending)` until the
  canvas has 7 days of history; this is expected, not an error.
- Smoke-test an Airship MCP connection with: `Using MCP server user-XX PROD,
  call call_airship_api: GET /api/reports/devices` (expect `status_code: 200`).
- Changing default thresholds globally = edit `SKILL.md`, commit, push to `main`;
  live automations pick up the new version on their next run.
