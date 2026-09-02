# airship-kpi-monitor

Weekly KPI monitoring for Airship projects. A **multi-run confirmation gate**
removes false positives (a breach must persist across runs before it counts), so
**alert tracking lives in the local dashboard** — Slack stays quiet
except a rare, throttled **critical escalation** and a light **weekly recap** (top
one-shot + unicast campaigns with previews). It
also maintains a **short, visual per-project Slack canvas**: key metrics over the
**last 30 days vs the previous 30**, as one scannable table per section, an email
block with a 0–100 sender score on email projects, and confirmed critical (red)
alerts.

Built as a [Cursor Skill](https://cursor.com). All runs are **local**: the
Airship MCP server runs on your machine via `uv`, so analyses are triggered
directly from Cursor chat using your local MCP servers.

---

## What it monitors

| Category | KPIs |
|---|---|
| **App** | Mobile app opens (per OS), unique devices as a within-window start→end **period trend** (per OS, from two dated `/api/reports/devices` calls at the window bounds — that endpoint has no date-range support), opt-in / opt-out ratio (per OS) |
| **Engagement** | Avg time in app /day (per OS) |
| **Mobile push** | Sends, direct response rate (per OS — direct rate collapse flags a tracking/SDK issue) |
| **Acquisition** | Opted-in / uninstalled device base (iOS, Android, Web) — current snapshot always shown; Δ across the window from two dated `/api/reports/devices` calls (else "Evolution n/a" when only one dated call succeeded) + net opt-in balance (opt-ins − opt-outs), per OS |
| **Email** | Sends, deliverability, bounce rate, **hard** and **block** bounce rate, spam complaint rate, unsubscribe rate, first-attempt delay rate, open rate, click-to-open — **tracked per sending domain**, so a small domain in trouble is not buried in the client average. Each domain also gets its own sender score (0–100) and an **inbox placement risk**, which the score alone cannot express |
| **Web push** | Sends (if channel active) |
| **SMS** | Sends, device base (if channel active) |

Client **custom events are deliberately not monitored**: their names churn with
each campaign and their volume swings for reasons unrelated to platform health,
so they produced alerts no TAM could act on. **SMS delivery rate** was dropped
for the same reason — it measured carrier behaviour a TAM cannot act on — so SMS
now carries volume only.

Together those two removals retired `/api/reports/events` entirely, which was the
run's whole cost centre: it answered a 30-day range in ~335 s where every other
Reports endpoint answers 60 days in 4–6 s. **Every email rate now comes from the
SparkPost Metrics API, per sending domain**, in ~1.6 s — with a per-domain and
per-IP split Airship never offered. Only `email_sends` still comes from Airship.

App, push, engagement and acquisition KPIs are analysed **per OS (iOS /
Android)** so a single-platform regression is never masked by the other
platform's volume.

All comparisons use **rolling 30-day windows**: the last 30 complete days vs the
30 days before that. Thirty days holds about four of each weekday, so
day-of-week seasonality cancels out on both sides, and a single anomalous day
carries ~3% of the window instead of the ~14% it carried on the old 7-day
window — which is where most false positives came from. The same window feeds
alerting, the local dashboard and the client-facing Slack canvas, so a delta
shown to a TAM and a delta shown to a client are the same number.

The exception is the **email fast incident checks** (spam complaint rate, delay
rate, deliverability floor, bounce ceiling). Averaging those over a month would
hide a live deliverability incident for weeks, so they keep evaluating per day
(per hour for delay) inside the window. A KPI card can therefore look healthy on
its 30-day figure while its alert is active on the last few days.

Because the window moves slowly, the intended cadence is **weekly**: two runs a
day apart share 29 of 30 days and mostly re-read the same numbers.

Every figure (Slack + canvas) is **source-traceable** — each section names the
Airship Reports endpoint it comes from, and any problem alert states the source
endpoint and the denominator used.

**Email delay alerts** include an hourly breakdown for the impacted day and
attempt to correlate delays with large email campaigns (`responses/list` +
`events/summary/perpush`).

### Slack canvas (client-facing snapshot)

The canvas is a **short** snapshot the client can open in Slack — not a strategic
report and not the operational database (that's the local dashboard):

- **📊 Key metrics** — last 30 complete days vs the previous 30, for the channels
  the project actually uses (app opens, time in app, push sends, direct response
  rate, opt-in/opt-out ratio, opted-in devices, plus email / SMS / web when
  active). Per-OS Δ where it applies.
- **🔴 Critical alerts** — **confirmed** critical (red) alerts currently open.
  One row per key (opened date, one-line cause). Candidates, watch (yellow)
  alerts, muted keys, and history stay in the dashboard.

Every run rebuilds this snapshot. The project's **industry** is auto-deduced from
its brand at setup and still powers the weekly recap benchmarks and the dashboard.

---

## How it works

```
Triggered from Cursor chat (manual or /loop)
  → reads clients.yml to select which clients to run
  → calls Airship Reports API via local MCP server (60 days DAILY per endpoint,
    covering the two adjacent 30-day windows)
  → reads canvas footer markers + local dashboard-data.js for alert streaks
  → computes deltas and evaluates thresholds
  → confirmation gate (Step 8a): a breach becomes a "candidate" and must persist
    N runs to be confirmed; hysteresis + cadence-aware zero-send suppression
  → tracks candidates / confirmed / recently-resolved in the local dashboard
  → Slack: posts ONLY a throttled critical escalation (confirmed + critical +
    sustained) + a weekly recap of top campaigns — no daily alert/resolution spam
  → updates the short Slack canvas: key-metric tables + email block & sender
    score + confirmed critical alerts
```

Alert state (including per-breach confirmation streaks) uses the **local
dashboard data file** as persistent memory — each run writes today's snapshot and
streak state to `dashboard-data.js` and reads them back on the next run. The Slack
canvas is the client-facing snapshot, not the database.

### Fewer false positives, quieter channel

- **Confirmation gate + hysteresis** — a threshold breach is a *candidate* first;
  it must breach for `alert_confirm_runs` consecutive runs (default **2**) to
  become a *confirmed* alert, and must clear for `alert_resolve_runs` runs to
  resolve. A few keys override that default per metric: the email fast incident
  checks confirm in **1** run, cadence-sensitive `*_sends_drop` keys in **3**.
  Breaches that clear before the gate closes are suppressed; the 30-day window
  itself already absorbs most day-level noise, which is why the gate is now the
  second line of defence rather than the first.
- **Cadence-aware suppression** — a zero-send window on a channel that only sends
  a few days a week is expected cadence, not an incident, and is suppressed.
- **Alerts live in the dashboard** — candidates (with a streak chip), confirmed
  alerts (with context + age graph), and a recently-resolved log are all in the
  local HTML dashboard. Slack only gets rare critical escalations + the weekly recap.
- **Weekly recap** — one friendly Slack post per week: top **one-shot + unicast**
  campaigns (push / email / message center / SMS) with **text wording previews**
  (title / subject / short body — no images). Each campaign carries its **volume + engagement** (push direct/influenced
  open, email open/click) and, for push, a **benchmark band** (🔴 Low ≤ p10 · 🟡 Med
  ≈ p50 · 🟢 High ≥ p90) vs the industry `direct_open_rate`; **email** is compared to
  the client's own average instead. Below the volume floor the rate reads `n/s`. All
  reports are written in **English**.

---

## Install in 3 steps

1. **Clone + open in Cursor.** The skill lives in the repo at
   `.cursor/skills/airship-kpi-monitor/`, so opening the folder as your workspace
   auto-discovers it — no `~/.cursor/skills` install.
2. **Configure the MCP servers** (the only real friction, unchanged): add each
   project's Airship MCP server to `~/.cursor/mcp.json` and enable the Slack MCP —
   let the agent do it via [SETUP.md](SETUP.md), or bulk-generate with the optional
   `scripts/generate_mcp_config.py`.
3. **Open the dashboard.** The session-start hook auto-starts the local server —
   just open **`http://127.0.0.1:8787`** (served mode = recommended, edits apply
   directly). No server? Open `dashboard/index.html` in read-only mode. Then run
   the skill from chat to populate your real data.

Everything else — projects, channels, thresholds, suggestions, mutes, industry —
is managed from the dashboard. No secrets ever touch the repo, `clients.yml`, or
the dashboard.

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
Run airship-kpi-monitor for all clients in clients.yml using rolling 30-day windows.

# A subset
Run airship-kpi-monitor for Client A and Client B.

# A single client
Run airship-kpi-monitor for Client A.
```

### Recurring — `/loop` (no hosting needed)

```
/loop 7d Run airship-kpi-monitor for all clients in clients.yml.
```

Runs immediately, then every 7 days. Requires Cursor to stay open; uses your
local MCP servers. Weekly is the right interval on a 30-day window: consecutive
daily runs would share 29 of 30 days, so they add API cost without adding
information — and the confirmation gate counts *runs*, so it needs each run to be
genuinely new evidence.

### Canvas-only / alerts-only (run scopes)

```
# Refresh the short Slack canvas — no alert posts
Run airship-kpi-monitor canvas for all clients.

# Light run — skip the heavy weekly insight fetch
Run airship-kpi-monitor alerts-only for all clients.
```

`canvas` (aliases: "update canvas only", "canvas refresh") rebuilds each project's
**short** Slack canvas (key-metric tables + email block + confirmed critical alerts) while
**skipping** all Slack posts (escalations and the weekly recap) and the Cursor
canvas. It still rewrites the local dashboard data file so confirmation streaks
persist. `alerts-only` is the symmetrical light run (skips Step 7b), useful for an
extra run between scheduled ones; the
default `full` does everything and is the normal scope at a weekly cadence.

---

## Local dashboard — the primary surface

A richly-designed local web page is the main way to **watch** the latest run and
**manage** your config (mute false positives, tune thresholds, edit routing) —
without leaving anything secret on disk. It comes in two modes:

### Served mode (recommended) — edit directly from the page

Run the bundled local server and the page can **write back** to your local
`clients.yml` with one click — no copy-paste:

- **Always-on (recommended, macOS)**: install it as a `launchd` user agent once —
  it then starts at login and relaunches automatically if it ever stops, so the
  page is never down when you go to it:

  ```bash
  cd .cursor/skills/airship-kpi-monitor/dashboard && ./service.sh install
  ```

  `./service.sh status | restart | logs | uninstall` manage it afterwards.
- **Auto-start**: a session-start hook (`.cursor/hooks/start-dashboard.sh`)
  launches it in the background when you open the workspace in Cursor (fail-open,
  idempotent). Then just open **`http://127.0.0.1:8787`**. Convenient, but the
  server dies with the Cursor session — prefer the agent above to keep it up.
- **Manual**: double-click `.cursor/skills/airship-kpi-monitor/dashboard/serve.command`
  (macOS), or run `uv run --with ruamel.yaml serve.py` in the `dashboard/` folder.

The dashboard has two views: **Monitor** and **Setup** (routing registry —
read-only under `file://`, full CRUD in served mode). Monitor is now a
**two-level** surface:

- **Fleet list** (`#/`) — projects are **grouped by Slack channel**: clients
  that share a channel (e.g. Client A · Client B · Client C → `#cs_fr_shared`) appear under a
  single collapsible card, with the combined client names and a clickable channel
  link in the header. Each project inside the card shows severity, open-alert /
  watching / muted badges, its **worst headroom** (the KPI closest to breaching),
  a micro-sparkline, and an **Open details →** affordance.
- **Deep project page** (`#/project/<name>`, shareable deep link with browser
  back) —   the centralized view of one project: **every monitored KPI on its active
  channels, healthy ones included** (not just problems) — **one card per KPI
  family** (app opens, time in app, unique-devices trend, opt-in/opt-out ratio,
  push sends, click rate, total devices evolution, opted-in/uninstalled devices, the
  full email family, web, SMS). At-a-glance
  tiles; **per-channel KPI cards** (current vs previous 30 days, delta, iOS/Android split, a
  mini-sparkline history and a **headroom gauge** showing the margin to the alert
  threshold, plus a status chip: OK / Watching / Confirmed / Muted / n/a) — each
  card also carries a **one-line analysis** contextualized to the client (value +
  evolution, benchmark position, whether it's a concern) and its **alert threshold
  inline** (an editable value under the gauge, right next to the live result and the
  trend, with Set / Reset and an inline Apply for any skill suggestion). KPIs under
  their min-volume floor show as **n/a**; unused channels are hidden. Plus an
  **Alerts & timeline** section (confirmed alerts with age graph, candidates with
  streaks, recently resolved).

In served mode you can, from the page:
- **Mute / Unmute** alerts directly,
- edit **per-project thresholds inline** — every KPI card has an editable
  threshold (Set / Reset) so you tune it right where you read the value; a
  **⚙ Edit all thresholds** link still opens the bulk editor (every threshold,
  incl. the confirmation-gate tunables `alert_confirm_runs` / `alert_resolve_runs`),
- **apply skill-computed threshold suggestions** — each KPI card shows its
  suggestion (loosen/tighten, from observed volatility, muted/resolved false
  positives, or chronic headroom) with a rationale and confidence; **Apply** it
  inline in one click (a suggestion with no card that run falls back to a small
  "Other threshold suggestions" panel),
- manage the **routing registry** in the **Setup** tab — add / edit / remove
  projects (name, brand, MCP server, Slack channel, canvas ID, region, time zone,
  industry, enabled), and set each project's **industry** (benchmark vertical) from
  its per-project chip.

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
`dashboard-data.sample.js`, `thresholds-catalog.js`, `serve.py`, `serve.command`,
`service.sh`) is **committed** and contains **no client data** — everyone gets it on clone. The
real data lives in `dashboard-data.js` (each run, SKILL.md Step 13) — a **local,
gitignored** file the skill rewrites. Until the first run writes it, the page shows
clearly-labelled sample data. A **Cursor canvas** roll-up is
also rendered beside the chat
(`~/.cursor/projects/<workspace>/canvases/airship-kpi-monitor.canvas.tsx`,
SKILL.md Step 12).

## Muting false positives

If an alert is a false positive, mute it so it is **no longer monitored** — never
escalated to Slack — while staying **visible and flagged "Muted"** on the
Cursor canvas and the HTML dashboard (confirmed critical alerts that are muted
are dropped from the Slack canvas). (Note: with the confirmation
gate, most transient false positives never confirm in the first place; muting is
for persistent breaches you've deliberately judged expected.) Mutes are **permanent until you unmute**. State lives in the
per-client `muted_alerts` list in your local `clients.yml` (routing-only,
gitignored — never any secrets).

Three ways to mute (all converge on `clients.yml`):

1. **From the dashboard** — click **Mute** / **Unmute** next to an alert. In
   **served mode** it applies immediately; in **static mode** the page copies the
   ready-to-paste prompt for chat.
2. **By prompt** in Cursor chat:
   - `Mute airship-kpi-monitor alert "<key>" for project "<project>" (false positive). Reason: <reason>`
   - `Unmute airship-kpi-monitor alert "<key>" for project "<project>"`
3. **From Slack** — set a shown **critical** alert's **Status** to `Muted` in
   the per-project canvas. The skill reads it on the **next run** and syncs it
   into `clients.yml` (not real-time — it polls each run). Watch / candidate
   mutes are declared from the dashboard or chat.

A `muted_alerts` key matches an alert exactly, or as a **family** (the part
before `:`): e.g. `email_delay_high` mutes every dated `email_delay_high:{date}`.
Muted alerts are excluded from severity counts but keep their reason.

**Mute reasons are accumulated intelligence.** A `reason` is not just a label:
on later runs the agent reads it as TAM-authored domain knowledge and uses it
to enrich the analysis of *non-muted* alerts. A new alert in the same key family
inherits the muted reason as a strong hypothesis (smarter root-cause narrative),
and a "watch only" metric that worsens materially since it was muted is flagged
in the trend so you can decide whether to unmute. Reasons never auto-mute a
different key or change thresholds — they only make future analyses sharper. The
more you annotate false positives, the more context the agent carries forward.

## Editing thresholds (per project)

Tune any alert threshold for a single project — no skill edit needed. Overrides
live in the per-client `custom_thresholds` map in your local `clients.yml`;
removing a key resets it to the default.

- **From the dashboard (inline)** — on a project's deep page each KPI card shows
  its alert threshold under the headroom gauge with **Set / Reset**; edit it right
  where you read the value (blank or the default value clears the override). A
  **⚙ Edit all thresholds** link still opens the bulk editor (every threshold,
  grouped, prefilled, per-key reset). Served mode **saves directly**; static mode
  **copies prompts**.
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
> (MCP server name, Slack channel, region, time zone, industry). OAuth credentials live solely in
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
    industry: retail                   # benchmark vertical — auto-deduced from brand_name
    enabled: true
    # custom_thresholds:
    #   push_sends_drop_pct: 40
```

Several entries may share the **same** `slack_channel` (e.g. multiple Airship
projects for one client) — give each its own `slack_canvas_id` (one canvas per
project; only the alert channel is shared).

On a client's **first** run, leave `slack_canvas_id` blank — the skill creates
the canvas and prints the new ID. Paste it back into your local `clients.yml`
so the next run reuses the same canvas.

---

## Default thresholds

All thresholds can be overridden per client via `custom_thresholds` in `clients.yml`.

Thresholds tagged "per OS" are evaluated independently for iOS and Android.

| Key | Default | Meaning |
|---|---|---|
| `app_opens_drop_pct` | 25 | App opens 30-day drop > 25% on that OS → alert (per OS) |
| `app_opens_cross_os_gap_pts` | 30 | **Or** \|iOS Δ − Android Δ\| > 30 pts → alert on **both** OS |
| `timeinapp_drop_pct` | 15 | Avg time in app drop > 15% → alert (per OS) |
| `total_devices_evolution_drop_pct` | 10 | Total unique devices decline > 10% across the window → alert (per OS + total) |
| `devices_optin_drop_pct` | 10 | Opted-in drop > 10% across the window (two dated `devices` calls) → alert (per OS) |
| `devices_uninstall_rise_pct` | 25 | Uninstall count rise > 25% across the window → alert (per OS) |
| `push_sends_drop_pct` | 100 | Push sends drop > 100% (zero sends) → alert (per OS) |
| `push_pressure_per_user_max_30d` | 60 | 30-day push sends ÷ opted-in devices > 60 → over-messaging ceiling (informational) |
| `direct_response_rate_min` | 0.5 | Direct response rate < 0.5% → alert (per OS) |
| `direct_response_collapse_pct` | 40 | Direct response rate 30-day drop ≥ 40% on an OS → likely tracking/SDK issue |
| `optin_optout_ratio_drop_pct` | 20 | Opt-in/opt-out ratio 30-day drop > 20% **and** a declining within-window trend → alert (per OS) |
| `email_sends_drop_pct` | 100 | Email sends drop > 100% (zero sends) → alert |
| `email_open_rate_drop_pts` | 4 | Open rate drop > 4 pts → alert |
| `email_unsubscribe_rise_pct` | 25 | Unsubscribes rise > 25% → alert |

**Email fast incident checks** — these are *not* averaged over the 30-day window.
They run on the per-day (per-hour for delay) rows inside it and fire on the most
recent `incident_days_consecutive` days, so a live incident still surfaces on the
next run instead of being diluted into a monthly average:

| Key | Default | Meaning |
|---|---|---|
| `email_deliverability_min` | 95 | Per-day deliverability < 95% → alert |
| `email_bounce_max` | 2 | Per-day bounce rate > 2% → alert |
| `email_spam_complaint_rate_max` | 1 | Daily spam complaint rate > 1% of deliveries → alert |
| `email_delay_rate_max` | 10 | Hourly delay / delivery > 10% threshold (used in both pre-filter and per-hour check) |
| `email_delay_min_consecutive_hours` | 2 | Min consecutive hours above the delay ceiling before the delay alert fires |
| `incident_days_consecutive` | 2 | Consecutive most-recent days a per-day check must breach |
| `web_sends_drop_pct` | 100 | Web push sends drop > 100% (zero sends) → alert |
| `web_sends_rise_pct` | 100 | Web push sends rise > 100% → alert (spike) |
| `sms_sends_drop_pct` | 100 | SMS sends drop > 100% (zero sends) → alert |
| `sms_sends_rise_pct` | 100 | SMS sends rise > 100% → alert (spike) |
`net_optin_negative` (no numeric threshold): alerts when the net balance
(opt-ins − opt-outs) flips from ≥ 0 to < 0 on an OS.

Minimum volumes (thresholds skipped if the window is below these). All
window-scoped floors were scaled ~4× when the window went from 7 to 30 days:

| Key | Default |
|---|---|
| `min_push_sends` | 4000 (per OS, over 30 days) |
| `min_email_sends` | 2000 (over 30 days) |
| `min_email_delivery_day` | 100 (per day, for the fast incident checks — unchanged) |
| `min_email_campaign_sends` | 5000 (min blast size for delay campaign correlation) |
| `min_optin_optout_volume` | 400 (per OS, opt-in + opt-out volume) |
| `min_timeinapp` | 1 (an average — unchanged) |
| `min_sms_sends` | 400 |
| `min_web_sends` | 400 |

Confirmation gate (anti false-positive), counted in **runs**, not days — so they
only mean anything at the weekly cadence:

| Key | Default |
|---|---|
| `alert_confirm_runs` | 2 (breaching runs before a candidate becomes a confirmed alert) |
| `alert_resolve_runs` | 2 (clean runs before a confirmed alert resolves — hysteresis) |
| `alert_escalate_runs` | 3 (breaching runs before a critical alert may escalate to Slack) |
| `escalate_throttle_days` | 14 (min days between two escalation posts for the same key) |

Weekly insights — top campaigns (analytics only, never alert):

| Key | Default |
|---|---|
| `min_campaign_sends` | 1000 (ignore a campaign identity below this over 30d) |
| `min_recurring_occurrences` | 3 (min occurrences to treat a series as recurring) |
| `recurring_drift_pct` | 50 (flag a recurring series deviating > 50% from its median) |

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
│           ├── benchmarks/              ← committed market benchmarks (no secrets)
│           │   ├── benchmarks.json      ← Airship UA Benchmarks (read at runtime)
│           │   ├── benchmarks.md        ← human-readable rendering
│           │   └── README.md            ← provenance + refresh instructions
│           ├── dashboard/               ← local dashboard (committed app, no data)
│           │   ├── index.html           ← open in any browser (no server)
│           │   ├── styles.css
│           │   ├── app.js
│           │   ├── dashboard-data.sample.js  ← sample data; real dashboard-data.js is local/gitignored
│           │   ├── thresholds-catalog.js     ← threshold catalog (mirrors SKILL.md Step 8)
│           │   ├── serve.py             ← optional local server (mute / thresholds / routing CRUD)
│           │   ├── serve.command        ← macOS one-click launcher for serve.py
│           │   └── service.sh           ← keep serve.py always up (launchd agent: install/status/restart/logs)
│           └── scripts/
│               ├── generate_mcp_config.py   ← optional: bulk-build ~/.cursor/mcp.json
│               ├── import_benchmarks.py      ← regenerate benchmarks.json from a quarterly xlsx
│               └── classify_campaigns.py     ← one-shot vs recurring campaign classifier
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
