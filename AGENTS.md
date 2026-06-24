# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

`airship-kpi-monitor` is a **documentation-first Cursor Skill**, not a
conventional software project. The deliverable is a small set of Markdown files
plus a client registry:

- `SKILL.md` — the core logic/playbook read by the Cursor agent at runtime.
- `MODOP.md` — step-by-step setup guide for TAMs (per-client onboarding).
- `README.md` — product overview.
- `clients.yml` — shared, **non-secret** client registry (routing only) used for
  manual multi-client runs.

The only executable code is **one optional helper**:
`scripts/generate_mcp_config.py`. It is a convenience for bulk-creating Airship
MCP entries in `~/.cursor/mcp.json` from a gitignored `clients.secrets.yml`
(template: `clients.secrets.example.yml`). It is **not** required to run the
skill — teammates who configure their MCP servers manually in Cursor ignore it.
There is otherwise no package manager, lockfile, or build/test/lint tooling, and
the update script is intentionally a no-op.

### How the "application" runs

The "application" is `SKILL.md` executed by a **Cursor Cloud Agent** (model:
latest Claude Sonnet) on a daily schedule, or manually from Cursor chat against
the local MCP servers. Each run:

1. Reads `SKILL.md` (and `clients.yml` for multi-client runs).
2. Calls the **Airship Reports API** via an **Airship MCP server** (`call_airship_api`).
3. Computes rolling 7-day-window deltas and evaluates thresholds.
4. Posts Slack alerts via the **Slack MCP** (`slack_send_message`) and maintains
   a weekly **Slack canvas** (`slack_create_canvas` / `slack_update_canvas`).

The Slack canvas doubles as the database — Cloud Agents have no local storage,
so each run reads the D-7 device snapshot from the canvas and writes today's
snapshot back to it.

To "run in development": follow the manual-test prompt in `MODOP.md` Part 3 (or
the multi-client / `/loop` modes in `MODOP.md` §2.2), referencing a client's
Airship MCP server name and a Slack channel ID.

### Config split — credentials vs routing (important)

- **Credentials live ONLY in `~/.cursor/mcp.json`** (per-client OAuth, region).
  They are never stored in the repo.
- **`clients.yml` is routing only** (MCP server name, Slack channel, canvas ID,
  region) and is safe to commit/share.
- `scripts/generate_mcp_config.py` + `clients.secrets.yml` are the optional bulk
  path to populate `mcp.json`; `clients.secrets.yml`, `mcp.json`, and
  `mcp.json.bak` are all gitignored.

### Required external integrations (NOT installable from this repo)

Running the skill end-to-end requires two MCP servers configured in Cursor /
Cloud Agents — neither can be provisioned from this VM via shell:

- **Airship MCP** (one entry per client). Backed by the internal `airship-mcp`
  Python package launched with `uv run` (the package is internal — obtain from
  the team). Requires per-client OAuth secrets with scopes exactly `rpt` + `tpl`:
  `AIRSHIP_APP_KEY`, `AIRSHIP_CLIENT_ID`, `AIRSHIP_CLIENT_SECRET`, `AIRSHIP_REGION`
  (`us` or `eu`). See `MODOP.md` §1.5–1.6 (or §1.7 for the bulk generator).
- **Slack MCP** (`plugin-slack-slack`) — must be authenticated/enabled in Cursor.

### Non-obvious gotchas

- The Slack MCP `slack_send_message` call requires the `message` parameter (NOT
  `text`); using `text` silently returns `no_text` and posts nothing. See
  `SKILL.md` Step 10.
- Canvas links must use `https://{workspace}.slack.com/docs/{team_id}/{canvas_id}`
  (team ID in the path) — `https://app.slack.com/docs/{canvas_id}` breaks.
- Run the generator via `uv run --with pyyaml scripts/generate_mcp_config.py`
  (inline PyYAML dep; supports `--dry-run` and `--print`). It backs up
  `mcp.json` and preserves servers it did not create.
- First run shows device WoW deltas as `n/a (canvas history pending)` until the
  canvas has 7 days of history; this is expected, not an error.
- Smoke-test an Airship MCP connection with: `Using MCP server user-XX PROD,
  call call_airship_api: GET /api/reports/devices` (expect `status_code: 200`).
- Changing default thresholds globally = edit `SKILL.md`, commit, push;
  live automations pick up the new version on their next run.
