# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

`airship-kpi-monitor` is a **documentation-first Cursor Skill**, not a
conventional software project. It is packaged as a **workspace skill**: the skill
itself lives in the repo at `.cursor/skills/airship-kpi-monitor/`, so cloning and
opening the repo in Cursor makes it available with no `~/.cursor/skills` install.
A session-start hook (`.cursor/hooks.json` → `.cursor/hooks/update-skill.sh`)
runs `git pull --ff-only` to keep the skill current. The deliverable is a small
set of Markdown files plus a client registry:

- `.cursor/skills/airship-kpi-monitor/SKILL.md` — the core logic/playbook read by
  the Cursor agent at runtime.
- `SETUP.md` — agent-executable installer playbook (at repo root). When a user
  asks to "setup this skill", read it and perform the steps: the skill is already
  present in the workspace, so just collect each client's inputs via the question
  tool, edit `~/.cursor/mcp.json` (creds — backed up first), create the local
  `clients.yml`, and smoke-test. It
  also specs a **local-only, secret-free monitoring canvas**
 (`~/.cursor/projects/<workspace>/canvases/airship-kpi-monitor.canvas.tsx`, never
 committed). It tracks setup progress, then the skill rewrites it as a run
 dashboard (open alerts, last-run times, links to each Slack KPI canvas) on each
 run (SKILL.md Step 12). Credentials are never written to the repo, `clients.yml`,
 the canvas, or the HTML dashboard.
- `MODOP.md` — manual step-by-step setup guide for TAMs (fallback for SETUP.md).
- `README.md` — product overview.
- `.cursor/skills/airship-kpi-monitor/dashboard/` — a **local HTML dashboard**
  openable in any browser with no server (`index.html`). It has two views:
  **Monitor** and **Setup** (routing registry: per-project industry, editable when
  the local server runs). Monitor is a **hash-routed two-level** SPA: a **fleet
  list** (`#/`) where projects are **grouped by Slack channel** (clients sharing a
  channel appear in one collapsible card; the header shows combined client names +
  a clickable `#channel` link); each project row shows severity, badges, worst
 headroom, micro-sparkline, "Open details →"; and a **deep project page**
 (`#/project/<name>`) that centralizes **every monitored KPI on the project's
 active channels (healthy ones included, not just problems)** as per-channel KPI
 cards (current/previous, WoW delta, iOS/Android split, mini-sparkline history,
 headroom gauge, status chip, a **one-line client-contextualized analysis**, and an
 **inline editable alert threshold** under each card's gauge — Set/Reset plus an
 Apply for any skill suggestion; KPIs under their min-volume floor show as `na`,
 unused channels are hidden), an alerts & timeline section, and a fallback "Other
 threshold suggestions" panel for suggestions with no KPI card that run.
  The **app** (`index.html`, `styles.css`, `app.js`, `dashboard-data.sample.js`,
  `thresholds-catalog.js`) is **committed and data-free**; the real data is
  `dashboard-data.js` (each run, Step 13), a **local + gitignored** file the skill
  rewrites. Each project carries `metrics[]` (per-KPI depth incl. `threshold.headroom`
  and a bounded `series`) and `thresholdSuggestions[]` (skill-computed tuning hints);
  the deep page degrades gracefully when a snapshot predates these fields. Browsers
  can't `fetch()` over `file://`, so data is loaded as a `<script>` that sets
  `window.AIRSHIP_KPI_DATA`. No secrets ever live here.
- `.cursor/skills/airship-kpi-monitor/clients.yml` — **non-secret** client
  registry. It is **local + gitignored**: the repo never ships or commits it. Each
  TAM creates their own (template lives in `MODOP.md` §2.2 / `SETUP.md`) and fills
  in their own clients. No real client data is ever committed.

The only executable code is **one optional helper**:
`.cursor/skills/airship-kpi-monitor/scripts/generate_mcp_config.py`. It is a
convenience for bulk-creating Airship MCP entries in `~/.cursor/mcp.json` from a
gitignored `clients.secrets.yml` (template: `clients.secrets.example.yml`,
alongside the script). It is **not** required to run the skill — teammates who
configure their MCP servers manually in Cursor ignore it. There is otherwise no
package manager, lockfile, or build/test/lint tooling.

### How the "application" runs

The "application" is `SKILL.md` executed by a **Cursor agent** (model: latest
Claude Sonnet) triggered from Cursor chat — one-off or recurring via `/loop`.
Each run:

1. Reads `SKILL.md` (and the TAM's local `clients.yml` for multi-client runs).
2. Calls the **Airship Reports API** via an **Airship MCP server** (`call_airship_api`).
3. Computes rolling 7-day-window deltas and evaluates thresholds, then runs the
   **confirmation gate** (Step 8a): a breach is a *candidate* until it persists
   `alert_confirm_runs` runs (hysteresis on resolve; cadence-aware zero-send
   suppression). This is what removes false positives.
4. Tracks candidates / confirmed / recently-resolved in the **local dashboard**
   (Step 13) and maintains the weekly **Slack canvas** (`slack_create_canvas` /
   `slack_update_canvas`). Slack messages via `slack_send_message` are now **rare**:
   only a throttled **critical escalation** (Step 10 — confirmed + critical +
   sustained) and a light **weekly recap** (Step 10b). Daily new-alert/resolution
   posts are retired.

The Slack canvas doubles as the database — agents have no local storage between
runs, so each run reads the D-7 device snapshot **and each alert's confirmation
streak/state** (from the Open Alerts `Status` column) from the canvas and writes
today's snapshot + streaks back to it.

To "run in development": follow the manual-test prompt in `MODOP.md` Part 3 (or
the multi-client / `/loop` modes in `MODOP.md` §2.2), referencing a client's
Airship MCP server name and a Slack channel name.

### Config split — credentials vs routing (important)

- **Credentials live ONLY in `~/.cursor/mcp.json`** (per-client OAuth, region).
  They are never stored in the repo.
- **`clients.yml` is routing only** (MCP server name, Slack channel, canvas ID,
  region, `time_zone`, `industry`) and is **local + gitignored** — created by each
  TAM, never
  committed. Several entries may share one Slack channel (multiple projects per
  client), each keeping its own canvas ID. Real client data is never committed;
  the repo ships no client registry.
- `scripts/generate_mcp_config.py` + `clients.secrets.yml` are the optional bulk
  path to populate `mcp.json`; `clients.yml`, `clients.secrets.yml`, `mcp.json`,
  and `mcp.json.bak` are all gitignored.

### Required external integrations (NOT installable from this repo)

Running the skill end-to-end requires two MCP servers configured in Cursor /
Cursor agents — neither can be provisioned from this VM via shell:

- **Airship MCP** (one entry per client). Backed by the internal `airship-mcp`
  Python package launched with `uv run` (the package is internal — obtain from
  the team). Requires per-client OAuth secrets with scopes exactly `rpt` + `tpl`:
  `AIRSHIP_APP_KEY`, `AIRSHIP_CLIENT_ID`, `AIRSHIP_CLIENT_SECRET`, `AIRSHIP_REGION`
  (`us` or `eu`). See `MODOP.md` §1.5 (or §1.6 for the optional bulk generator).
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
- The Reports API always returns **UTC**. `clients.yml` `time_zone` (IANA, e.g.
  `Europe/Paris`) does not change what is fetched — it only sets the local-day
  boundary (Step 0) and how hourly delay peaks / campaign times are labelled and
  interpreted in local time (Step 3c / 8b). Defaults to UTC.
- First run shows device WoW deltas as `n/a (canvas history pending)` until the
  canvas has 7 days of history; this is expected, not an error.
- Smoke-test an Airship MCP connection with: `Using MCP server user-XX PROD,
  call call_airship_api: GET /api/reports/opens` (expect `status_code: 200`).
  Prefer `opens` over `devices` — `devices` can `404` on email-only projects
  (no mobile device base), a false negative.
- The skill is a **workspace skill** under `.cursor/skills/airship-kpi-monitor/`;
  edits to `SKILL.md` there are versioned with the repo. The `.cursor/hooks/`
  auto-update hook (`git pull --ff-only` on session start) is fail-open and never
  touches the gitignored `clients.yml`.
- The HTML dashboard app is committed but its data file
  (`dashboard/dashboard-data.js`) is gitignored — a run writes **only** that data
  file (Step 13), never the committed app. It is fail-open (skips on missing folder
  / write error) and shares
  the canvas's Slack **deep links** (`slack://file?team=…&id=…` for canvases,
  `…/app_redirect?channel=…` for channels) so clicks open the Slack app instead of
  spawning browser redirect tabs.
- **False-positive gate (Step 8a).** A threshold breach must persist
  `alert_confirm_runs` consecutive runs to *confirm* (candidates live only in the
  dashboard); confirmed alerts need `alert_resolve_runs` clean runs to resolve
  (hysteresis); zero-send windows on non-daily channels are suppressed. Streak
  state persists in the canvas Open Alerts `Status` column (no new columns).
- **Slack is quiet by design.** Daily new-alert/resolution posts are retired.
  Slack only receives a throttled **critical escalation** (Step 10 — confirmed +
  critical + sustained, ≥7-day throttle stored as a `· escalated {date}` Status
  suffix) and a light **weekly recap** (Step 10b — top one-shot + unicast campaigns
  with hosted-image previews + aggregate in-app WoW; throttled via a
  `_Recap posted:_` canvas footer marker). Everything else is in the dashboard.
- Changing default thresholds globally = edit
  `.cursor/skills/airship-kpi-monitor/SKILL.md`, commit, push; teammates pick up
  the new version on their next pull (the hook pulls automatically), applied on
  their next run.
