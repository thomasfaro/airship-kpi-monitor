# airship-kpi-monitor

Daily KPI monitoring for Airship projects — posts Slack alerts when significant
metric variations are detected, and maintains a weekly canvas summary.

Built as a [Cursor Skill](https://cursor.com). All runs are **local**: the
Airship MCP server runs on your machine via `uv`, so analyses are triggered
directly from Cursor chat using your local MCP servers.

---

## What it monitors

| Category | KPIs |
|---|---|
| **App** | Mobile app opens (per OS) |
| **Engagement** | Avg time in app /day (per OS) |
| **Devices** | Installed base, opted-in, uninstalls (iOS, Android, Web) |
| **Mobile push** | Sends, opt-outs, direct response rate (per OS — direct rate collapse flags a tracking/SDK issue) |
| **Acquisition** | New opt-ins + net opt-in balance (opt-ins − opt-outs), per OS |
| **Email** | Sends, deliverability, open rate, bounce rate, unsubscribes, daily spam complaint rate, daily delay rate |
| **Web push** | Sends (if channel active) |
| **SMS** | Sends, delivery rate (delivered/dispatched), device base (if channel active) |
| **Custom events** | New events, strong rises, strong drops, vanished events |

App, push, engagement and acquisition KPIs are analysed **per OS (iOS /
Android)** so a single-platform regression is never masked by the other
platform's volume.

All comparisons use **rolling 7-day windows**: last 7 complete days vs the
7 days before that. This eliminates daily noise and weekly seasonality.

Every figure (Slack + canvas) is **source-traceable** — each section names the
Airship Reports endpoint it comes from, and any problem alert states the source
endpoint and the denominator used.

**Email delay alerts** include an hourly breakdown for the impacted day and
attempt to correlate delays with large email campaigns (`responses/list` +
`events/summary/perpush`).

---

## How it works

```
Triggered from Cursor chat (manual or /loop)
  → reads clients.yml to select which clients to run
  → calls Airship Reports API via local MCP server (14 days DAILY per endpoint)
  → reads canvas for D-7 device snapshot + open alert state
  → computes deltas and evaluates thresholds
  → posts Slack alert only for NEW anomalies (anti-duplication)
  → updates canvas: devices history + email health history + open alerts table
```

Device WoW comparison uses the **Slack canvas as persistent memory** — there is
no local storage between runs, so each run writes today's snapshot to the canvas
and reads the D-7 value from it on the next run.

---

## Automated setup (agent-guided) — recommended

This is a **workspace skill**: clone the repo, open it in Cursor, and the skill
at `.cursor/skills/airship-kpi-monitor/` is auto-discovered — no
`~/.cursor/skills` install. A bundled session-start hook
(`.cursor/hooks/update-skill.sh`) keeps it up to date with `git pull --ff-only`.

The fastest way to configure everything is to let the Cursor agent do it for you.
With the repo open in Cursor, paste in chat:

```
Follow .cursor/skills/airship-kpi-monitor/SETUP.md to configure this skill
locally (Airship MCP servers + my clients.yml). Ask me for the values you need.
```

The agent reads [SETUP.md](SETUP.md) and walks you through it interactively: it
checks prerequisites, asks you for each client's OAuth credentials and Slack
channel, writes the Airship MCP server into your local `~/.cursor/mcp.json`
(backed up first), creates your local `clients.yml`, smoke-tests the connection,
and shows a local monitoring canvas with the file locations and progress (the
skill later reuses it as a run dashboard with open alerts and links to each
Slack KPI canvas).

Credentials are written only to your local `~/.cursor/mcp.json` — never to the
repo, `clients.yml`, or the canvas.

**Split of responsibilities.** Two things genuinely need the agent / terminal:
the **credentials** in `~/.cursor/mcp.json` and the **MCP smoke-tests** (the
browser can do neither). Everything else — adding / editing / removing projects,
muting, threshold tuning — you can do later from the **Setup** and **Monitor**
tabs of the [local dashboard](#local-dashboard--the-primary-surface) once the
server is running.

---

## Manual installation (alternative)

Prefer to do it by hand? Clone the repo and open it in Cursor:

```bash
git clone https://github.com/thomasfaro/airship-kpi-monitor
# open the airship-kpi-monitor folder as your workspace in Cursor
```

The skill lives in the repo at `.cursor/skills/airship-kpi-monitor/`, so it is
available as soon as the workspace is open. To update later, just `git pull` the
repo (the bundled session-start hook does this automatically).

Create your own **local, gitignored** `clients.yml` in the skill folder (it
stays on your machine and is never pushed — see the template in the "Client
registry" section below):

```bash
cd .cursor/skills/airship-kpi-monitor
$EDITOR clients.yml   # create it with the template below
```

Then follow [MODOP.md](MODOP.md) to configure each client's Airship MCP server
in Cursor and add the client to your local `clients.yml`.

---

## Run modes

All run modes work from **Cursor chat** with the relevant MCP servers enabled.

### One-off (all clients, a subset, or a single client)

```
# All enabled clients
Run airship-kpi-monitor for all clients in clients.yml using rolling 7-day windows.

# A subset
Run airship-kpi-monitor for Client A and Client B.

# A single client
Run airship-kpi-monitor for Client A.
```

### Recurring — `/loop` (no hosting needed)

```
/loop 1d Run airship-kpi-monitor for all clients in clients.yml.
```

Runs immediately, then every 24 h. Requires Cursor to stay open; uses your
local MCP servers.

---

## Local dashboard — the primary surface

A richly-designed local web page is the main way to **watch** the latest run and
**manage** your config (mute false positives, tune thresholds, edit routing) —
without leaving anything secret on disk. It comes in two modes:

### Served mode (recommended) — edit directly from the page

Run the bundled local server and the page can **write back** to your local
`clients.yml` with one click — no copy-paste:

- **Auto-start**: a session-start hook (`.cursor/hooks/start-dashboard.sh`)
  launches it in the background when you open the workspace in Cursor (fail-open,
  idempotent). Then just open **`http://127.0.0.1:8787`**.
- **Manual**: double-click `.cursor/skills/airship-kpi-monitor/dashboard/serve.command`
  (macOS), or run `uv run --with ruamel.yaml serve.py` in the `dashboard/` folder.

In served mode you can, from the page:
- **Mute / Unmute** alerts directly,
- edit **per-project thresholds** (every threshold, prefilled, with reset),
- manage the **routing registry** in the **Setup** tab — add / edit / remove
  projects (name, brand, MCP server, Slack channel, canvas ID, region, time zone,
  enabled).

The server is **localhost-only** (binds `127.0.0.1`, same-origin checks), edits
**only** the gitignored `clients.yml`, and **rejects any secret-shaped field** —
credentials (`~/.cursor/mcp.json`) and MCP smoke-tests stay with the agent (the
Setup tab gives you ready-to-paste prompts for those). To disable auto-start,
remove the `start-dashboard.sh` entry in `.cursor/hooks.json`.

### Static mode (no server) — read-only + copy-prompts

You can always open the page directly, with no server and without Cursor — handy
for a teammate's machine:

```bash
open .cursor/skills/airship-kpi-monitor/dashboard/index.html
```

Here the page is read-only: Mute / threshold / setup actions **copy a
ready-to-paste prompt** for Cursor chat instead of writing files.

The dashboard **app** (`index.html`, `styles.css`, `app.js`,
`dashboard-data.sample.js`, `thresholds-catalog.js`, `serve.py`, `serve.command`)
is **committed** and contains **no client data** — everyone gets it on clone. The
real data lives in `dashboard-data.js`, a **local, gitignored** file the skill
rewrites each run (SKILL.md Step 13). Until the first run writes it, the page
shows clearly-labelled sample data. A **Cursor canvas** roll-up is also rendered
beside the chat (`~/.cursor/projects/<workspace>/canvases/airship-kpi-monitor.canvas.tsx`,
SKILL.md Step 12).

## Muting false positives

If an alert is a false positive, mute it so it is **no longer monitored** — never
posted to Slack (no new-alert or resolution message) — while staying **visible
and flagged "Muted"** on the Slack canvas, the Cursor canvas, and the HTML
dashboard. Mutes are **permanent until you unmute**. State lives in the
per-client `muted_alerts` list in your local `clients.yml` (routing-only,
gitignored — never any secrets).

Three ways to mute (all converge on `clients.yml`):

1. **From the dashboard** — click **Mute** / **Unmute** next to an alert. In
   **served mode** it applies immediately; in **static mode** the page copies the
   ready-to-paste prompt for chat.
2. **By prompt** in Cursor chat:
   - `Mute airship-kpi-monitor alert "<key>" for project "<project>" (false positive). Reason: <reason>`
   - `Unmute airship-kpi-monitor alert "<key>" for project "<project>"`
3. **From Slack** — set an alert's **Status** to `Muted` in the per-project KPI
   canvas Open Alerts table. The skill reads it on the **next run** and syncs it
   into `clients.yml` (not real-time — it polls each run).

A `muted_alerts` key matches an alert exactly, or as a **family** (the part
before `:`): e.g. `email_delay_high` mutes every dated `email_delay_high:{date}`.
Muted alerts are excluded from severity counts but keep their reason.

## Editing thresholds (per project)

Tune any alert threshold for a single project — no skill edit needed. Overrides
live in the per-client `custom_thresholds` map in your local `clients.yml`;
removing a key resets it to the default.

- **From the dashboard** — the per-project **Thresholds** button opens an editor
  with every threshold (grouped, prefilled, per-key reset). Served mode **saves
  directly**; static mode **copies prompts**.
- **By prompt**:
  - `Set airship-kpi-monitor threshold "<key>" to <value> for project "<project>"`
  - `Reset airship-kpi-monitor threshold "<key>" to default for project "<project>"`

The editor's catalog (`dashboard/thresholds-catalog.js`) mirrors the
[Default thresholds](#default-thresholds) below.

---

## Client registry — local `clients.yml`

`clients.yml` is **local and gitignored** — the repo never ships or commits it.
Create your own in the skill folder (`.cursor/skills/airship-kpi-monitor/`)
using the template below and keep your own clients there. The agent reads your
local `clients.yml` and runs the full workflow once per selected client,
sequentially. Your client list never leaves your machine — the repo only
contains the skill.

> **Credentials vs routing**: `clients.yml` holds **no secrets** — only routing
> (MCP server name, Slack channel, region, time zone). OAuth credentials live solely in
> your local `~/.cursor/mcp.json`, configured once per client (see
> [MODOP.md](MODOP.md) §1.5). Setting up many clients at once? An optional
> generator (`scripts/generate_mcp_config.py` + a gitignored
> `clients.secrets.yml`) can create the `mcp.json` entries in bulk — see
> MODOP §1.6. Skip it if your MCPs are already configured.

Registry format (routing only — no secrets; see [MODOP.md](MODOP.md) §2.2 for
the full field reference):

```yaml
# ROUTING ONLY — NO SECRETS. Credentials live in ~/.cursor/mcp.json.
slack_workspace: urbanairship      # subdomain in https://<workspace>.slack.com
slack_team_id: T025Q1VP7           # team ID segment in the canvas URL path

clients:
  - name: Client A
    brand_name: Client A Brand Name
    airship_mcp: user-CLIENT-A PROD    # MCP server name from ~/.cursor/mcp.json
    slack_channel: cs-fr-client-a      # channel name without '#'
    slack_canvas_id: F0XXXXXXXX        # leave blank on first run
    region: eu
    time_zone: Europe/Paris            # IANA tz — local day + hourly interpretation
    enabled: true
    # custom_thresholds:
    #   push_sends_drop_pct: 40
```

Several entries may share the **same** `slack_channel` (e.g. multiple Airship
projects for one client) — give each its own `slack_canvas_id` (one canvas per
project; only the alert channel is shared).

On a client's **first** run, leave `slack_canvas_id` blank — the skill creates
the canvas and prints the new ID. Paste it back into your local `clients.yml`
so the next run reuses the same canvas (the canvas is the persistent memory for
D-7 device deltas).

---

## Default thresholds

All thresholds can be overridden per client via `custom_thresholds` in `clients.yml`.

Thresholds tagged "per OS" are evaluated independently for iOS and Android.

| Key | Default | Meaning |
|---|---|---|
| `app_opens_drop_pct` | 20 | App opens drop > 20% → alert (per OS) |
| `timeinapp_drop_pct` | 20 | Avg time in app drop > 20% → alert (per OS) |
| `devices_unique_drop_pct` | 5 | Installed base drop > 5% → alert (per OS) |
| `devices_optin_drop_pct` | 5 | Opted-in drop > 5% → alert (per OS) |
| `devices_uninstall_rise_pct` | 10 | Uninstall count rise > 10% → alert (per OS) |
| `push_sends_drop_pct` | 50 | Push sends drop > 50% → alert (per OS) |
| `optouts_rise_pct` | 20 | Opt-outs rise > 20% → alert (per OS) |
| `direct_response_rate_min` | 0.5 | Direct response rate < 0.5% → alert (per OS) |
| `direct_response_collapse_pct` | 60 | Direct response rate WoW drop ≥ 60% on an OS → likely tracking/SDK issue |
| `optins_drop_pct` | 25 | New opt-ins drop > 25% → alert (per OS) |
| `email_sends_drop_pct` | 20 | Email sends drop > 20% → alert |
| `email_deliverability_min` | 95 | Deliverability < 95% → alert |
| `email_open_rate_drop_pts` | 5 | Open rate drop > 5 pts → alert |
| `email_bounce_max` | 2 | Bounce rate > 2% → alert |
| `email_unsubscribe_rise_pct` | 30 | Unsubscribes rise > 30% → alert |
| `email_spam_complaint_rate_max` | 1 | Daily spam complaint rate > 1% of deliveries → alert |
| `email_delay_rate_max` | 10 | Daily delay rate > 10% of deliveries → alert |
| `web_sends_drop_pct` | 30 | Web push sends drop > 30% → alert |
| `web_sends_rise_pct` | 100 | Web push sends rise > 100% → alert (spike) |
| `sms_sends_drop_pct` | 30 | SMS sends drop > 30% → alert |
| `sms_sends_rise_pct` | 100 | SMS sends rise > 100% → alert (spike) |
| `sms_delivery_rate_min` | 85 | SMS delivery rate < 85% → alert |
| `sms_delivery_rate_drop_pts` | 10 | SMS delivery rate drop > 10 pts → alert |
| `custom_event_rise_pct` | 50 | Custom event rise > 50% → alert |
| `custom_event_drop_pct` | 50 | Custom event drop > 50% → alert |

`net_optin_negative` (no numeric threshold): alerts when the net balance
(opt-ins − opt-outs) flips from ≥ 0 to < 0 on an OS.

Minimum volumes (thresholds skipped if previous window is below these):

| Key | Default |
|---|---|
| `min_push_sends` | 1000 (per OS) |
| `min_email_sends` | 500 |
| `min_email_delivery_day` | 100 (per day, for spam/delay alerts) |
| `min_email_campaign_sends` | 5000 (min blast size for delay campaign correlation) |
| `min_custom_event_count` | 200 |
| `min_optins` | 100 (per OS) |
| `min_timeinapp` | 1 |
| `min_sms_sends` | 100 |
| `min_sms_dispatched` | 50 |
| `min_web_sends` | 100 |

---

## Changing default thresholds globally

Edit `.cursor/skills/airship-kpi-monitor/SKILL.md` under `Default thresholds`,
**and** mirror the same change in `dashboard/thresholds-catalog.js` (the editor's
catalog), then commit and push. Anyone who pulls the repo (the bundled
session-start hook pulls automatically) picks up the new defaults on their next
run. Per-project overrides stay in each TAM's local `clients.yml`.

---

## Repository structure

```
airship-kpi-monitor/
├── .cursor/
│   ├── hooks.json                       ← registers auto-update + dashboard auto-start hooks
│   ├── hooks/
│   │   ├── update-skill.sh              ← session-start: git pull --ff-only
│   │   └── start-dashboard.sh          ← session-start: launch dashboard server (fail-open)
│   └── skills/
│       └── airship-kpi-monitor/
│           ├── SKILL.md                 ← core logic (read by Cursor agents)
│           ├── clients.secrets.example.yml  ← template for the optional MCP generator
│           ├── dashboard/               ← local dashboard (committed app, no data)
│           │   ├── index.html           ← open in any browser (no server)
│           │   ├── styles.css
│           │   ├── app.js
│           │   ├── dashboard-data.sample.js  ← sample data; real dashboard-data.js is local/gitignored
│           │   ├── thresholds-catalog.js     ← threshold catalog (mirrors SKILL.md Step 8)
│           │   ├── serve.py             ← optional local server (mute / thresholds / routing CRUD)
│           │   └── serve.command        ← macOS one-click launcher for serve.py
│           └── scripts/
│               └── generate_mcp_config.py   ← optional: bulk-build ~/.cursor/mcp.json
├── SETUP.md                     ← agent-guided installer playbook
├── MODOP.md                     ← manual step-by-step setup guide for TAMs
├── AGENTS.md                    ← architecture notes for coding agents
└── README.md                    ← this file
```

The skill is a **workspace skill** under `.cursor/skills/` — cloning + opening
the repo in Cursor makes it available, with no `~/.cursor/skills` install.

`clients.yml` is **not** in the repo — it is created locally by each TAM (in
`.cursor/skills/airship-kpi-monitor/`) and is gitignored (it holds your client
routing, never committed).

---

## Requirements

- Cursor IDE
- `uv` installed (`brew install uv`)
- Airship MCP package available locally (internal — ask your team lead)
- Airship OAuth credentials per client (scopes: `rpt` + `tpl`)
- Slack MCP plugin enabled and authenticated in Cursor
