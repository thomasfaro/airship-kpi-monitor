---
name: airship-kpi-monitor
description: >-
  Daily Airship KPI monitoring with rolling 7-day window comparison, analysed
  per OS (iOS / Android). Detects significant variations in app opens, time in
  app, push sends/opt-outs, direct response rate (tracking-health signal),
  opt-in/opt-out ratio, email metrics (including daily spam complaint and delay
  rates), web push, SMS sends and delivery rate, and custom events. A
  multi-run confirmation gate + hysteresis + cadence-aware suppression removes
  false positives: a breach must persist across runs before it counts. Daily
  alert tracking lives in the local dashboard (candidates with a streak, confirmed
  alerts with context, a recently-resolved log) — Slack stays quiet except a rare,
  throttled critical escalation and a light weekly recap (top one-shot + unicast
  campaigns with previews, plus an aggregate in-app activity block). Maintains the
  unchanged strategic weekly Slack canvas: verbose alert analysis, an executive
  recap with brand-activity context, global opt-in/devices vs market benchmarks,
  3-month trends (app opens, sends per platform, marketing pressure, opt-in rate,
  time-in-app), 30-day email deliverability health, and top campaigns by type
  (one-shot / recurring / experiment) via the Activity Log plus a unicast estimate.
  Every analysed campaign is systematically positioned against its market benchmark
  (push → vertical direct-open band, message center → vertical read-rate band, email
  → the client's own internal baseline).
  Uses the Airship Reports API via MCP and the Slack MCP plugin. Triggered from
  Cursor chat as a one-off, or as a recurring daily loop via "run kpi daily" /
  "start the daily loop" / "lance le monitoring quotidien" (or /loop directly).
model: claude-sonnet
# Always use the latest available Claude Sonnet version in the Cursor
# Automations editor — do not pin a specific version number (e.g. 4-5, 4-6).
# When a new Sonnet version is released, simply select it in the editor;
# no change to this file is required.
---

# Airship KPI Monitor — Daily Rolling Window Check

Monitor an Airship project's key metrics daily, comparing the **last 7 complete
days (D-7 → D-1)** against the **previous 7 days (D-14 → D-8)**. App and push
KPIs are analysed **per OS (iOS / Android)** so a single-platform regression is
never masked by the other platform's volume. A breach must clear the
**confirmation gate** (persist `alert_confirm_runs` runs, Step 8a) before it
counts as a real alert — this is what removes the transient false positives. All
alert tracking (candidates, confirmed, recently resolved) lives in the **local
dashboard**; the Slack channel stays quiet, receiving only a rare **throttled
critical escalation** (Step 10) and a light **weekly recap** (Step 10b).

The **week-over-week comparison drives alerting only** — it is **not** rendered
in the Slack canvas. The canvas is a **strategic report**: open alerts (with
verbose analysis), an executive recap tied to the brand's activity, global
opt-in/devices vs market benchmarks, 3-month trends (app opens, sends per
platform, marketing pressure, opt-in rate, time-in-app), 30-day email
deliverability health, and top campaigns by type (one-shot / recurring /
experiment) plus a unicast estimate. The heavy strategic sections refresh on a
**weekly cadence** (Step 0 gate); the lighter alert + history sections update on
every run.

## Inputs (from the automation prompt)

| Parameter | Required | Example |
|---|---|---|
| `Client name` | yes | `Client A` |
| `Brand name` | no — defaults to Client name | `Client A Brand` |
| `Airship MCP server` | yes | `user-CLIENT-A PROD` |
| `Slack channel` | yes | `cs-fr-client` |
| `Slack canvas ID` | no — created on first run | `F0XXXXXXXX` |
| `Time zone` | no — defaults to `UTC` | `Europe/Paris` |
| `Industry` | no — defaults to `all_verticals` | `media` |
| `Slack workspace` | no — defaults to `urbanairship` | `urbanairship` |
| `Slack team ID` | no — defaults to `T025Q1VP7` | `T025Q1VP7` |
| `Custom thresholds` | no — overrides defaults | `push_sends_drop_pct: 40` |
| `Run scope` | no — defaults to `full` | `canvas-only` |

`Industry` is the project's **market vertical** (a benchmark vertical slug — see
`benchmarks/benchmarks.json`), used to position its push/app KPIs against Airship
market benchmarks in the canvas (Step 7b / Step 11). It is auto-deduced from
`Brand name` at setup and editable in the local dashboard. Defaults to
`all_verticals` when unknown.

`Run scope` selects how much of the workflow to execute (see **Run scopes**):
`full` (default — fetch + confirmation gate + canvas + local views + any critical
escalation / weekly recap), `canvas-only` (refresh the Slack canvas only,
including the weekly insight sections, with **no** Slack posts at all), or
`alerts-only` (the light daily run: confirmation gate + canvas KPI tables + local
dashboard, but skip the heavy weekly insight sections).

`Brand name` is the **public-facing brand** used for web searches and news
lookups in root cause analysis (Step 8b). Use the consumer-facing name rather
than the internal project code — e.g. the client's public brand name rather
than their Airship project shorthand. If omitted, falls back to `Client name`.

### Slack channel (`slack_channel`)

`clients.yml` stores the **Slack channel name** as shown in Slack, **without**
the leading `#` — e.g. `cs-fr-client-a`, `cs_fr_client_b`.

At the **start of each run** (before Step 0), resolve it to a channel ID for
`slack_send_message`:

1. Call `slack_search_channels` on the Slack MCP plugin with `query` set to the
   configured name (`channel_types`: `public_channel,private_channel`).
2. Pick the result whose `name` matches exactly (case-insensitive; ignore a
   leading `#` if present).
3. Use that channel's `id` as `channel_id` in all `slack_send_message` calls
   for this run.
4. If there is no exact match, stop the run for that client and report the
   failure — do not guess or post to a partial match.

For **single-client runs** from a chat prompt, accept `Slack channel` (name, same
format) instead of a raw `C…` ID.

**Multiple projects per channel:** several `clients.yml` entries may point to the
**same** `slack_channel` (e.g. a client monitored across several Airship
projects, or several brands routed to one CS channel). Each entry still keeps its
**own** `slack_canvas_id` (one canvas per project) — only the alert channel is
shared. Run each project independently; never merge their canvases.

### Time zone (`time_zone`)

`clients.yml` stores an **IANA time zone** for the project (e.g. `Europe/Paris`,
`Europe/Madrid`, `Europe/Rome`, `Africa/Casablanca`, `America/New_York`). It
defaults to `UTC` when omitted. The Airship Reports API always returns data in
**UTC**; `time_zone` does not change what is fetched — it changes how the agent
**delimits the local day** and how it **labels and interprets time-based
findings**:

1. **Step 0 — local day boundary.** Compute "today / yesterday" from the current
   time **in `time_zone`**, so the rolling windows align with the client's own
   calendar day (matters for runs near UTC midnight).
2. **Step 3c — hourly breakdown.** Convert each UTC hour bucket to local time and
   show a **"Hour (local · {time_zone})"** column so a TAM reads the delay/peak
   hours in the client's business hours, not UTC.
3. **Step 8b — interpretation.** Phrase every time-based hypothesis in local time
   (e.g. "delays concentrated 10:00–12:00 local"), and convert campaign
   `push_time` (UTC from the API) to local time before correlating.

Always state the time zone next to any hour you show so the value is unambiguous.

### Slack canvas link (`canvas_url`)

The two Slack posts (the critical escalation, Step 10, and the weekly recap,
Step 10b) must link to the KPI canvas with a URL that **opens the canvas in
Slack**. (There is **no** resolution post — resolutions live only in the
dashboard's recently-resolved log and the canvas Open Alerts table.) Build the
URL at the start of each run:

```
canvas_url = https://{slack_workspace}.slack.com/docs/{slack_team_id}/{canvas_id}
```

Defaults for the Airship CS workspace: `slack_workspace=urbanairship`,
`slack_team_id=T025Q1VP7`. In multi-client runs these come from the optional
top-level `slack_workspace` / `slack_team_id` keys in `clients.yml` (falling
back to the defaults above).

**Do NOT use** `https://app.slack.com/docs/{canvas_id}` (missing team ID — link
breaks). **Do NOT use** `?origin_team=` query params.

If `slack_create_canvas` returns a `canvas_url` or `permalink` in its response,
use that value instead (it is already correct). Otherwise construct with the
formula above.

To find `slack_team_id` for another workspace: open any canvas in Slack →
**Copy link** → the URL is
`https://{workspace}.slack.com/docs/{TEAM_ID}/{FILE_ID}` — extract `TEAM_ID`
(the segment starting with `T`).

**Web URL vs deep link:** the web `canvas_url` above is for links posted
**inside Slack** (alerts in Step 10, canvas content in Step 11) — clicked from
Slack it opens the canvas in-app. The **local Cursor canvas** (Step 12) instead
uses a `slack://file?team=…&id=…` deep link, because clicking a Slack web URL
from Cursor/the browser triggers a web→app redirect chain that opens several
Chrome tabs.

## Run modes

The skill supports two ways of supplying the inputs above:

1. **Single-client run** — parameters passed directly in the prompt (the
   one-off manual run). Used when the
   prompt contains a `Client name` / `Airship MCP server` block.

2. **Manual multi-client run** — parameters read from the TAM's **local**
   `clients.yml` registry (gitignored; created locally, never committed). Used
   when the prompt asks to run for "all clients", names one or more clients
   without giving their full config, or simply says "run airship-kpi-monitor"
   with no client block. This lets a TAM trigger the check for every configured
   client from a single Cursor chat message, with no additional setup required.

### Run scopes (orthogonal to single/multi-client)

A **run scope** controls how much of the workflow runs. It is independent of the
single/multi-client mode above — any scope works for one client or all of them.
Detect the scope from the prompt; default to `full`.

| Scope | Trigger words in the prompt | What runs |
|---|---|---|
| `full` (default) | normal invocation, "run airship-kpi-monitor" | Steps 0–13: fetch + weekly insights (gated, Step 7b) + confirmation gate (Step 8a) + classify (Step 9) + **critical escalation** (Step 10) + **weekly recap** (Step 10b, gated) + canvas (Step 11) + local views (Steps 12–13). |
| `canvas-only` | `canvas`, `canvas-only`, "update canvas only", "canvas refresh" | Steps 0–7 + **7b forced** + Step 8/8a alert **computation** + Step 11 (Slack canvas). **Skips** Steps 9–10b (no Slack posts of any kind) and, by default, Steps 12–13 (local views). |
| `alerts-only` | `alerts-only`, "alerts only", "light run", "skip insights" | The light daily run: Steps 0–13 **but skip Step 7b** (no heavy weekly insight sections; no weekly recap, which depends on 7b data). Keeps the canvas KPI tables, the confirmation gate, and the local dashboard current. |

**`canvas-only` behaviour (detailed):**
- Run Steps 0–7 (fetch + read canvas) and **force** the weekly insight block
  (Step 7b: 3-month history, benchmark metrics, top campaigns) regardless of the
  weekly gate — refreshing those sections is the whole point of the command.
- Run Step 8/8a to **compute** the current alert state (so the canvas "Open Alerts"
  table is accurate) but do **not** post anything: **skip Step 9** (classify),
  **Step 10** (escalation) and **Step 10b** (weekly recap). No Slack post other
  than the canvas update.
- **Skip Steps 12–13** (Cursor canvas + HTML dashboard) by default — this command
  only touches the Slack canvas. Include them only if the prompt adds `+local`.
- Read-only on mutes: use the muted state for display; do not sync mutes from the
  canvas.
- Useful as a dedicated weekly `/loop` (e.g. `/loop 7d /airship-kpi-monitor canvas`)
  decoupled from the daily alert run.

**`alerts-only`** is the symmetrical light run: identical to `full` except Step 7b
is skipped, so daily runs stay fast. `full` (default) does everything, with the
heavy sections naturally rate-limited by the weekly gate inside Step 7b.

### Daily loop shortcut

When the prompt is a bare **"run kpi daily"**, **"start the daily loop"**,
**"lance le monitoring quotidien"**, or similar (i.e. the user wants the recurring
job, not a single run), arm a 24h loop instead of running once. Use the `loop`
skill's fixed-schedule pattern:

1. First check existing terminals for an already-running
   `AGENT_LOOP_TICK_KPI_DAILY` loop; if present, report its PID and do not start a
   second one.
2. Arm one background shell loop (title `Loop every 24h: KPI daily monitoring`),
   monitoring output on `^AGENT_LOOP_TICK_KPI_DAILY`:

```bash
while true; do
  sleep 86400
  echo 'AGENT_LOOP_TICK_KPI_DAILY {"prompt":"Run airship-kpi-monitor for all clients in clients.yml, scope alerts-only, no Slack posts, regenerate the local dashboard (Step 13)."}'
done
```

3. Run the monitoring workflow **once immediately** in `alerts-only` scope for all
   clients (do not wait for the first tick).
4. On each tick, re-run the same `alerts-only` all-clients workflow and give a
   short summary of what changed. To stop, kill the loop PID and do not re-arm.

This is just a convenience wrapper around the `alerts-only` multi-client run below
plus the `loop` skill — no separate skill needed.

> **Dashboard data must stay complete on every tick.** `alerts-only` is a *Slack*
> throttle, **not** a dashboard throttle: each tick's Step 13 rewrite of
> `dashboard-data.js` MUST still emit the **full** per-project shape — `channel`,
> `canvasId`, `lastRun`, `industry`, and **one `metrics[]` entry per monitored KPI
> family on every active channel** (healthy KPIs included, `na` below min-volume),
> not only the breaching metrics. Dropping `channel` un-groups the fleet home;
> dropping healthy metrics empties the project detail pages. Never emit an
> alerts-only subset.

### Manual multi-client run — procedure

When the prompt does **not** contain a full single-client parameter block,
operate in registry mode:

1. **Read the registry**: open the local `clients.yml` in the skill folder and
   parse the `clients:` list. If the file is missing, tell the user to create it
   locally (run the agent-guided setup in `SETUP.md`, or see the template in
   `MODOP.md` §2.2) and fill in their clients, then stop. If it is empty, report
   it and stop.

2. **Select which clients to run**:
   - "all clients" / "run airship-kpi-monitor" (no name) → every entry with
     `enabled: true` (treat a missing `enabled` as `true`). Skip entries with
     `enabled: false`.
   - One or more client names given (e.g. "for Client A and Client B") →
     only the matching entries, matched case-insensitively on `name`. If a
     named client is not found in the registry, report it and continue with the
     others.

3. **Map each registry entry to the Step 0 inputs**:

   | Registry field | Skill input |
   |---|---|
   | `name` | `Client name` |
   | `brand_name` (or `name` if absent) | `Brand name` |
   | `airship_mcp` | `Airship MCP server` |
   | `slack_channel` | `Slack channel` (name — resolved to ID at run start) |
   | `slack_canvas_id` (may be blank → first run) | `Slack canvas ID` |
   | `time_zone` (IANA; defaults to `UTC`) | `Time zone` |
   | `industry` (benchmark vertical; defaults to `all_verticals`) | `Industry` |
   | `region` (informational) | Airship region of the MCP server |
   | `custom_thresholds` | overrides of the Step 8 defaults |
   | `muted_alerts` (optional list) | false-positive alert keys to suppress (see **Muting false positives**) |
   | `dismissed_suggestions` (optional list of threshold keys) | threshold-suggestion keys a TAM dismissed from the dashboard — the skill must **not** re-emit them in `thresholdSuggestions[]` (see Step 13 **Threshold suggestions**) |
   | `watched_alerts` (optional list of `{key, reason, since}`) | KPIs a TAM manually watches from the dashboard — surfaced in the dashboard even without a breach (see Step 13 **Watched KPIs**) |

   The top-level `slack_workspace` / `slack_team_id` keys in `clients.yml`
   (if present) supply the `Slack workspace` / `Slack team ID` inputs used to
   build `canvas_url`; otherwise the `urbanairship` / `T025Q1VP7` defaults apply.

   **Precedence**: if the chat prompt also specifies a parameter directly
   (e.g. a different channel or a threshold override), the prompt value wins
   for that run.

4. **Run the workflow once per selected client** (the steps included depend on
   the active **run scope** above), strictly sequentially — finish one client
   (including Slack posts and canvas update) before starting the next. Never
   interleave API calls or Slack messages between clients. Always use the
   `Airship MCP server` from that client's entry so the correct project is
   queried. For `canvas-only` runs, skip the Slack alert posts and local views as
   described in **Run scopes**.

5. **Isolate failures**: if one client errors out (MCP unavailable, scope
   issue, etc.), log the error for that client, skip it, and continue with the
   remaining clients. One client's failure must not abort the others. First
   apply the **transient-error retry policy** (see *Error handling*) — a
   `401 Expired token` / `40101` is usually a stale cached token that refreshes
   on retry, so do not skip a client on the first auth error. Only skip after
   retries are exhausted, and list skipped clients in the final roll-up so they
   can be re-run.

6. **First-run canvas IDs**: if a client's `slack_canvas_id` is blank, the
   skill creates the canvas (Step 11) and prints the new ID. Tell the TAM to
   paste each returned ID back into `clients.yml` so subsequent runs reuse it.

7. **Per-client summary**: emit the Step "Output" summary block for every
   client, then a final roll-up line:
   `[airship-kpi-monitor] multi-run — {N} clients · {posted} posted · {skipped} skipped`.

8. **Update the local views** once at the end: rewrite the Cursor canvas
   (Step 12) and the local HTML dashboard data file (Step 13), rolling up every
   processed client's confirmed alerts, candidates, recently-resolved, last-run
   time, industry, and Slack canvas link. (Skipped for `canvas-only` runs unless
   `+local` was requested.)

## Muting false positives

A TAM can mark an alert as a **false positive** so it is **no longer monitored**:
it is never posted to Slack (neither a new-alert nor a resolution message) but
stays **visible and flagged "Muted"** on the per-project Slack canvas, the
Cursor canvas, and the HTML dashboard. A mute is **permanent until unmuted**.

### Where mute state lives

The single source of truth is the per-client `muted_alerts` list in the local
`clients.yml` (routing-only, gitignored — never any secrets). Each item:

```yaml
muted_alerts:
  - key: push_sends_drop_android   # exact key, OR a family = the part before ":"
    reason: "Campaign-timing artifact, expected"
    muted_since: 2026-06-25         # optional, informational
```

**Matching.** A `muted_alerts` entry mutes a triggered alert when
`alert_key == entry.key` **OR** `alert_key.split(":")[0] == entry.key`. Email
health alerts (`email_delay_high`, `email_spam_complaint_high`) are a single key
per project, so muting one mutes that whole channel-issue for the project. The
family form still applies to keyed events, e.g. `custom_event_rise:purchase`
mutes only that one event while `custom_event_rise` mutes every custom-event rise.

### Three ways to declare a mute (all converge on `clients.yml`)

1. **Chat prompt** — recognise these canonical forms (case-insensitive, quotes
   optional) and act on them as a lightweight operation, **without** running the
   full KPI workflow unless asked:
   - Mute: `Mute airship-kpi-monitor alert "<key>" for project "<project>" (false positive). Reason: <reason>`
   - Unmute: `Unmute airship-kpi-monitor alert "<key>" for project "<project>"`
   Steps: find the matching `clients.yml` entry by `name` (or `brand_name`);
   for a mute, add/update the `key` in its `muted_alerts` (dedupe by key, keep
   the newest `reason`); for an unmute, remove that key. Then, best-effort,
   refresh that project's mute flags on the Slack canvas (Step 11 Status column),
   the Cursor canvas (Step 12), and the dashboard data (Step 13). Confirm the
   change to the user. If the project is not found, report it and stop.

2. **Dashboard "Mute" button** — the local HTML dashboard has two modes:
   - **Served** (the optional local server `dashboard/serve.py` is running, e.g.
     auto-started by the `start-dashboard.sh` hook): the Mute/Unmute buttons
     **apply directly**, writing `clients.yml` via the server (no chat round-trip).
   - **Static** (`file://`, no server): the button **copies the canonical prompt
     above**; the user pastes it into Cursor chat, which lands in case 1.

3. **Slack canvas edit** — a TAM sets an alert's **Status** to `Muted` (and may
   add a reason) directly in the per-project KPI canvas Open Alerts table. The
   skill reads this canvas every run (Step 7); on the **next run** it honours the
   Muted status and **syncs it into `clients.yml` `muted_alerts`** (union with
   existing; dedupe by key). This is not real-time — the skill is a
   Cursor-triggered agent that polls each run, not a hosted Slack bot.

### Enforcement (during a run)

In **Step 8a / Step 9**, before a breach can become a candidate/confirmed alert,
check it against the merged mute set (`clients.yml` `muted_alerts` ∪ any canvas
rows already marked `Muted`). If it matches, classify it **Muted**: it never
becomes a candidate, is never confirmed, and is never escalated to Slack; still
record it on the canvas with `last_seen` updated and `Status = 🔕 Muted`. Muted
alerts are excluded from any "worst severity" used to summarise active alerts, but
remain visible everywhere with their reason.

### Mute reasons as accumulated intelligence (later analyses)

A mute `reason` is **more than a label** — it is TAM-authored domain knowledge
about what is normal/expected for that client. On every subsequent run the agent
**reads these reasons as a prior** when analysing *non-muted* alerts (see
**Step 8b check 0**):
- a **new** alert in the same key family as a muted one inherits the muted
  reason as a strong hypothesis (e.g. a new high-volume-blast delay day is
  recognised as the same expected pattern), producing a smarter `possible_cause`;
- a muted "watch only" metric that **worsens materially** vs when it was muted is
  flagged in the canvas/dashboard trend so a human can decide to unmute (the
  alert itself still never auto-posts).

This makes the mute history compound over time: the more a TAM annotates false
positives, the more context the agent carries into future runs. Reasons are still
**never** used to auto-mute a different key, nor to change thresholds — they only
enrich the analysis and the surfaced narrative.

## Editing thresholds (per project)

Default thresholds live in **Step 8**. A TAM can override any of them **per
project** without editing this skill. Overrides live in the per-client
`custom_thresholds` map in the local `clients.yml` (routing-only, gitignored —
never secrets), and win over the Step 8 defaults for that project (Step 0
mapping). Removing a key resets it to the default.

```yaml
custom_thresholds:
  push_sends_drop_pct: 40       # any Step 8 key (see dashboard/thresholds-catalog.js)
  email_delay_rate_max: 15
```

Two ways to edit, mirroring muting:

1. **Dashboard "Thresholds" button** — opens an editor listing every threshold
   (grouped, prefilled with the effective value, with per-key reset).
   - **Served**: Save **applies directly** (POST `/api/thresholds` → `clients.yml`).
   - **Static** (`file://`): Save **copies canonical prompts** to paste into chat.
2. **Chat prompt** — recognise these canonical forms (case-insensitive, quotes
   optional) and act on them as a lightweight operation, **without** running the
   full KPI workflow unless asked:
   - Set: `Set airship-kpi-monitor threshold "<key>" to <value> for project "<project>"`
   - Reset: `Reset airship-kpi-monitor threshold "<key>" to default for project "<project>"`
   Steps: find the `clients.yml` entry by `name`/`brand_name`; set/merge the key
   in `custom_thresholds` (numeric value), or delete it on reset; if the map
   becomes empty, drop it. Validate `<key>` against the catalog
   (`dashboard/thresholds-catalog.js`, which mirrors Step 8). Confirm to the user.

The catalog file `dashboard/thresholds-catalog.js` is the **UI mirror of Step 8
defaults** and is read by both the browser and `serve.py`. When you change a
default in Step 8, update the catalog too (and vice-versa), or the editor will
show a stale default.

## Editing the routing registry (Setup view)

The dashboard's **Setup** view (served mode only) does CRUD on the **non-secret
routing registry** — add / edit / remove a project's `name`, `brand_name`,
`airship_mcp`, `slack_channel`, `slack_canvas_id`, `region`, `time_zone`,
`enabled` in `clients.yml`. The server **rejects any secret-shaped field**, so
credentials never land in `clients.yml`. **Credentials (`~/.cursor/mcp.json`) and
MCP smoke-tests stay agent/manual** — the browser can do neither; the Setup view
just emits copy-prompts for those (guided setup + smoke-test). In `file://` mode
the Setup view is read-only with a notice to start the server.

## Data sources (traceability reference)

Every figure shown in Slack or the canvas MUST be traceable to the endpoint
below. **Any alert flagging a problem must cite its source endpoint AND the
denominator used.**

| KPI | Source endpoint | Denominator / note |
|---|---|---|
| App opens (per OS) | `/api/reports/opens` | raw count |
| Push sends (per OS) | `/api/reports/sends` | raw count |
| Push opt-outs (per OS) | `/api/reports/optouts` | rate = opt-outs / push sends |
| Opt-in / opt-out ratio (per OS) | `/api/reports/optins` ÷ `/api/reports/optouts` | Daily opt-ins ÷ opt-outs (iOS/Android only — neither endpoint returns a web/SMS series). Both endpoints are still fetched exactly as before; they now feed this **App & engagement** ratio card instead of a standalone "Opt-in registrations" tile. Ratio > 1 = net-positive reach that day; < 1 = churn-dominant |
| Push pressure per user per week (family `push_pressure_per_user`, Push section) | `/api/reports/sends` ÷ `/api/reports/devices?date=` | Weekly push sends (iOS+android) ÷ opted-in devices, unit `msg/user/wk`. Denominator is the **per-week opted-in base** via `/api/reports/devices?date=<week end>` (batched, Step 6); falls back to the current opted-in snapshot **labelled a proxy** when a week's dated call is unavailable. `series` is the multi-week evolution. Promotes the Step 7b marketing-pressure formula to a per-project dashboard family |
| Click rate (direct responses, per OS) | `/api/reports/responses` | rate = direct / push sends (labelled "Click rate" in outputs) |
| Time in app (per OS) | `/api/reports/timeinapp` | avg value/day returned by Airship |
| Total devices evolution (family `total_devices_evolution`, Acquisition section, per OS + total) | `/api/reports/devices?date=<window start>` + `/api/reports/devices?date=<window end / today>` | `GET /api/reports/devices?date=<date-time>` counts **all device events that occurred before that date-time** and returns `total_unique_devices` + `counts.{ios,android,amazon,sms,web}.{unique_devices,opted_in,opted_out,uninstalled}` + `date_closed`/`date_computed`. Fetch it at **two dates** (window start & end) and diff: evolution = (end − start) ÷ start × 100 over the window, per OS + total. Alerts on a strong decline. **Merges** the former `installs` proxy and canvas-history-based `devices_unique` trend into one family — no canvas Devices-History dependency any more |
| Opted-in / uninstalled devices — two-date evolution (per OS) | `/api/reports/devices?date=<start>` + `/api/reports/devices?date=<end>` | Same two dated calls: Δ% = change of `counts.{os}.opted_in` / `.uninstalled` between the window-start and window-end calls (opted-in drop / uninstalls rise alert). When only ONE dated call is available, emit the **current absolute value** per OS (status `ok`, note `Evolution n/a`), never a greyed-out `na` |
| Email injection/delivery/open/click/bounce/unsubscribe | `/api/reports/events` | per-metric denominator (see Step 8) |
| Email delay / spam complaint (daily pre-filter) | `/api/reports/events` | `delay` or `spam_complaint` / `delivery` per day (`precision=DAILY`, one call per day) |
| Email delay hourly confirmation (candidate days) | `/api/reports/events`, `/api/reports/sends` | hourly `delay` / `delivery` per hour + `email` sends (`precision=HOURLY`, one events call per hour, 24 calls per candidate day) — confirms ≥ N consecutive hours above threshold before alerting |
| Email campaigns (delay root cause) | `/api/reports/responses/list`, `/api/reports/events/summary/perpush/{push_id}`, `/api/reports/perpush/pushbody/{push_id}` | top sends on impacted day; per-push `delay`/`delivery`; `message_name` only |
| SMS sends | `/api/reports/sends` | raw count (field `sms`) |
| SMS delivery rate | `/api/reports/events` | `delivered` / `dispatched` SMS delivery report events |
| SMS devices snapshot | `/api/reports/devices` | `sms.unique_devices`, `sms.opted_in`, `sms.opted_out`, `sms.uninstalled` |
| Web push sends | `/api/reports/sends` | raw count (field `web`) |
| Web push devices snapshot | `/api/reports/devices` | `web.unique_devices`, `web.opted_in` |
| Custom events | `/api/reports/events` | raw count |
| 3-month KPI history (weekly insights, Step 7b) | `/api/reports/opens`, `/api/reports/sends`, `/api/reports/optins`, `/api/reports/optouts`, `/api/reports/timeinapp` | ~91 days `precision=DAILY` (timeinapp `MONTHLY`), aggregated to 13 weekly + 3 monthly buckets; **sends kept per platform** (push iOS/Android, email, SMS, web) |
| Marketing pressure (weekly insights) | `/api/reports/sends`, `/api/reports/devices` | push sends / opted-in per OS over the bucket (sends-per-active-user proxy) |
| Time-in-app 3-month trend (weekly insights) | `/api/reports/timeinapp` | avg value/day per OS, `MONTHLY` over 3 months |
| Benchmark — opt-in rate (per device family) | `/api/reports/devices` (snapshot) + `benchmarks/benchmarks.json` | `opted_in / unique` per `ios`/`android`/`web` vs vertical p10/p50/p90 |
| Benchmark — direct & influenced open rate (per device family) | `/api/reports/responses` + `benchmarks/benchmarks.json` | `direct \| influenced / sends` per OS vs vertical percentiles |
| Benchmark — push sends/user/month (per device family) | `/api/reports/sends`, `/api/reports/devices` + `benchmarks/benchmarks.json` | 30d sends / opted-in (×4.33 if from a weekly), vs vertical percentiles |
| Top campaigns by type & platform (30d, weekly insights) | `/api/reports/activity/details` (typology: `type` PUSH = one-shot \| GROUP = recurring/automation, `experiment` flag, per-push delivery/interaction), `/api/reports/perpush/pushbody/{push_id}` (channel + metadata), `/api/reports/events/summary/perpush/{push_id}` (**email volume + open/click** — activity log often shows `delivery.app=0` for email), `/api/reports/perpush/detail/{push_id}` (push/in-app **per-platform split only** — returns `sends=0` for email) | one row per real campaign — unicast 1:1 sends excluded by the log; canvas = metadata only; weekly recap may preview hero + snippet (7b.6) |
| Unicast / transactional volume (weekly insights) | `/api/reports/sends` minus campaign delivery from `/api/reports/activity/details`; `/api/reports/perpush/pushbody/{push_id}` (empty body confirms unicast) | aggregate estimate of 1:1 API-triggered sends; content not retrievable (best-effort) |
| Brand activity context (weekly insights) | campaign `message_name` + `campaigns.categories` (pushbody) + best-effort web search on `Brand name` news | qualitative; clearly labelled best-effort, never alert |

`influenced` responses are **ignored for alerting** — only `direct` responses
drive alerts (a collapse of the direct rate signals a tracking/SDK problem, not a
real engagement change). `influenced` **is** read in the weekly benchmark section
(Step 7b) because the Airship benchmark exposes an influenced-open-rate band.

### Campaign content & privacy policy

Two different rules apply depending on where campaign content is surfaced:

- **Slack canvas — metadata only.** The canvas **🏆 Top campaigns** section stays
  strictly metadata (`message_name`, categories, `message_type`, platform, volume,
  direct-open) — **never** the alert title/body/HTML. The canvas structure is
  unchanged.
- **Weekly recap preview — text wording allowed.** The weekly recap (Step 10b)
  **may** surface a campaign **text preview**: the **title / subject / short body**
  extracted via the 7b.6 extractor (rendered as a blockquote). This is a deliberate
  relaxation of the old "metadata only" rule so the recap is useful. **No images**
  are posted. Still **never** expose recipient PII, tokens, unicast 1:1 bodies
  (empty anyway), or full raw HTML — only a truncated wording snippet, for the
  ranked one-shot shortlist only.

## Execution workflow

### Step 0 — Compute date windows

```
today         = current date in `time_zone`   (defaults to UTC if unset)
run_timestamp = current date-time in `time_zone`, formatted `YYYY-MM-DD · HH:MM <tz abbr>`
yesterday  = today - 1 day                  (last complete local day)
window_end = yesterday

current_window_start  = yesterday - 6 days   (D-7 → D-1, 7 days)
current_window_end    = yesterday

previous_window_start = yesterday - 13 days  (D-14 → D-8, 7 days)
previous_window_end   = yesterday - 7 days
```

Format all dates as `YYYY-MM-DD`. Derive `today` from the **current time in the
project's `time_zone`** so the last complete day matches the client's calendar
(important when a run fires just after UTC midnight). Never include today
(partial data). Capture `run_timestamp` once at run start — it records the
**time** the run executed (not just the date) and is surfaced in the Output
summary and the local monitoring canvas (Step 12).

**Weekly-insights gate.** The three heavy sections (3-month history, benchmark,
top campaigns — Step 7b / Step 11) refresh on a **weekly cadence**, not daily, to
keep daily runs cheap. Decide whether to run Step 7b now:

```
# Read the marker from the canvas footer (Step 7 reads the canvas anyway):
#   _Insights refreshed: YYYY-MM-DD_
last_insights_refresh = parse that marker (or none if absent)

run_weekly_insights =
     run_scope == "canvas-only"                      # always force on canvas-only
  OR run_scope != "alerts-only" AND (
        last_insights_refresh is none                # never built yet / first run
     OR any of the 3 insight sections is missing     # robust to a deleted section
     OR (today - last_insights_refresh) >= 7 days    # weekly cadence (robust to missed runs)
     )
```

`alerts-only` never runs Step 7b. `canvas-only` always does (ignoring the gate).
`full` runs it only when the gate opens. When `run_weekly_insights` is false,
**skip Step 7b** and leave the existing insight sections untouched in Step 11.

### Step 0b — Optimized fetch plan (batching, de-dup & channel gating)

The steps below are written as a numbered narrative for clarity, but many of
their MCP calls are **independent** and should be issued **in parallel** to cut
wall-clock time. This is a pure execution optimization: **no precision is lost,
no windowing/confirmation-gate/data-quality semantics change, and no step is
reordered beyond batching independent calls**. Apply these three rules:

1. **De-duplicate the 90d / 14d overlap — weekly runs only.** When
   `run_weekly_insights` is true, the Step 7b 3-month history already fetches
   `opens` / `sends` / `optins` / `optouts` over ~91 days `precision=DAILY`. On a
   weekly run, **fetch each of these four series once over the 90-day range and
   slice the 14-day window** ([`previous_window_start` … `current_window_end`])
   out of the same rows for Step 1 — do **not** issue a second 14-day call for a
   series already covered by the 90-day pull. On **daily / `alerts-only`** runs
   (no Step 7b), keep the cheaper standalone 14-day Step 1 calls. `timeinapp`
   (Step 5) is exempt — its 3-month pull is `MONTHLY`, so the 14-day `DAILY`
   call stays separate.

2. **Channel-activity gating — skip unused channels.** Before fetching, decide
   which channels the project actually uses (device base or send volume in the
   window / prior state): **explicitly skip the email fetches** (Step 2 event
   sets, Step 3b per-day deliverability, Step 3b.5 hourly) when the project sends
   no email; **skip the SMS fetches** (SMS delivery events) when SMS is inactive;
   **skip the web-push fetches** when web is inactive. This mirrors the Step 13
   "active channels only" coverage rule so no work is done for channels that emit
   no cards or alerts.

3. **Parallel MCP batching — batch independent GETs into parallel turns.**
   - **Batch A (period metrics, Step 1):** `sends`, `opens`, `optins`, `optouts`
     — one parallel turn (after the single cheap token-refresh probe of Step 1).
   - **Batch B (independent single-shots):** the two dated `/api/reports/devices?date=`
     calls (Step 6, window start & end), the per-week push-pressure
     `devices?date=<week end>` calls (Change 2), `responses` (Step 4),
     `timeinapp` (Step 5), and the two email event-set calls (Step 2) — all
     independent of Batch A and of each other, so issue them **in parallel**.
   - **Per-day loop (Step 3b):** issue the 7 per-day `events` calls **as one
     parallel batch**, not sequentially — full DAILY precision is preserved (one
     call per day, just concurrent).
   - **Per-hour loop (Step 3b.5):** for each candidate day, issue its 24 hourly
     `events` calls **as one parallel batch** — full HOURLY precision preserved.
   - Keep **dependent** work ordered: hourly confirmation (Step 3b.5) still runs
     only for the candidate days surfaced by the daily pre-filter (Step 3b); the
     delay drill-down (Step 3c) still reuses Step 3b.5's breakdown; Step 8/8a
     still consume the fully-fetched series.

The canonical per-step definitions (params, windows, precision) below are
unchanged — Step 0b only governs **how** their independent calls are grouped.

### Step 1 — Fetch period metrics (14 days DAILY in one call each)

Call via MCP `call_airship_api` on the **Airship MCP server** specified in the
automation prompt. Every call here (and in all later steps) is subject to the
**transient-error retry policy** in *Error handling* — retry `401 Expired
token` / `40101`, `429`, and `5xx` with back-off before treating them as fatal.
Make one cheap probe call first (a single-day `opens`) and let it refresh the
token before issuing the full set of Step 1 calls. Issue the four calls below as
**one parallel batch** (Step 0b, Batch A). On a **weekly** run, do **not** issue
these 14-day calls at all for `sends`/`opens`/`optins`/`optouts` — slice the
14-day window out of the 90-day series already fetched for Step 7b (Step 0b
rule 1).

```
GET /api/reports/sends
  params: start=previous_window_start, end=current_window_end, precision=DAILY

GET /api/reports/opens
  params: start=previous_window_start, end=current_window_end, precision=DAILY

GET /api/reports/optins
  params: start=previous_window_start, end=current_window_end, precision=DAILY

GET /api/reports/optouts
  params: start=previous_window_start, end=current_window_end, precision=DAILY
```

For each response, split the daily rows into two groups:
- **current**: rows where date ∈ [current_window_start, current_window_end]
- **previous**: rows where date ∈ [previous_window_start, previous_window_end]

Then sum **per platform** (`ios`, `android`, `web` where present, and `sms`
where present) for each group. Keep per-platform sums AND a total.
Opt-ins are actively used (Step 8). Note: `/api/reports/optins` and
`/api/reports/optouts` return only `ios` / `android` — there are no
per-day SMS or web opt-in/opt-out series from these endpoints.

### Step 2 — Fetch email system events (two separate 7-day calls)

```
GET /api/reports/events
  params: start=current_window_start, end=current_window_end,
          precision=MONTHLY, page_size=100
→ paginate all pages (follow next_page until exhausted)
→ store as events_current

GET /api/reports/events
  params: start=previous_window_start, end=previous_window_end,
          precision=MONTHLY, page_size=100
→ paginate all pages
→ store as events_previous
```

From each set extract the following system events (location=custom):
- `injection` → total injected (denominator for email metrics)
- `delivery` → delivered
- `open` → email opens
- `initial_open` → deduplicated opens (use for open rate)
- `click` → email clicks
- `bounce` → bounces
- `unsubscribe` → unsubscribes
- `spam_complaint` → spam complaints

Ignore events with `location` ∈ {`in_app_message`, `in_app_pager`,
`ua_mcrap`, `ua_interactive_notification`} — these are Airship UI system
events, not email or custom app events.

### Step 3 — Fetch custom events

From the same `events_current` and `events_previous` fetched in Step 2,
isolate events where `location = custom` AND name ∉ {`injection`, `delivery`,
`open`, `initial_open`, `click`, `bounce`, `unsubscribe`, `spam_complaint`,
`delay`, `media_played`}.

These are **client custom events** (app behaviour, conversions, etc.).

### Step 3b — Fetch email deliverability health events (daily, per day)

The `/api/reports/events` endpoint with `precision=DAILY` over a **date range**
returns **aggregated totals for the whole range**, not per-day rows. To get
true daily rates, issue **one call per day**.

For each date `d` in the current window
[`current_window_start` … `current_window_end`] (7 days):

```
GET /api/reports/events
  params: start={d}, end={d}, precision=DAILY, page_size=100
→ paginate if needed
→ store as email_health_daily[d]
```

From each day's response, extract (location=`custom` only):
- `delivery` → delivered count (denominator)
- `delay` → delayed deliveries
- `spam_complaint` → spam complaints

Compute per day:

```
delay_rate_{d}          = delay_{d} / delivery_{d} * 100        (%)
spam_complaint_rate_{d} = spam_complaint_{d} / delivery_{d} * 100  (%)
```

Skip a day if `delivery_{d} < min_email_delivery_day` (log `"skipped: low volume"`).

Only run this step if the project sent email in the current window
(`email_sends_current > 0` from Step 1, or `injection` > 0 in Step 2).
If no email activity, omit email health KPIs and canvas sections.

### Step 3b.5 — Hourly confirmation for candidate delay days

The daily rate (Step 3b) is a **pre-filter only**. A day where
`delay_rate_{d} > email_delay_rate_max` is a **candidate**. Before it can fire
an alert it must be confirmed at the hourly level: the high-rate periods must
span at least `email_delay_min_consecutive_hours` consecutive hours.

For each candidate day `D` (i.e. `delay_rate_{D} > email_delay_rate_max` AND
`delivery_{D} >= min_email_delivery_day`), fetch the hourly breakdown:

```
GET /api/reports/events
  params: start={D}T{h}:00:00, end={D}T{h}:59:59, precision=HOURLY, page_size=100
→ for h in 0..23
→ extract delay_{h}, delivery_{h} (location=custom)
→ skip hour if delivery_{h} < min_email_delivery_day
→ delay_rate_h = delay_{h} / delivery_{h} * 100
```

Also fetch hourly email send volume for day D (needed for Step 3c correlation):

```
GET /api/reports/sends
  params: start={D}T00:00:00, end={D}T23:59:59, precision=HOURLY
→ field email per row
```

Store as `delay_hourly_breakdown[D]` (used later in Step 3c without re-fetching).

**Consecutive-hour count**: scan hours 0–23 in order. Count the **longest run**
of consecutive hours where `delay_rate_h > email_delay_rate_max` (ignoring
low-volume hours that were skipped — do **not** break a consecutive run on a
skipped hour; treat them as gap-neutral so a brief low-volume gap between two
high-delay hours does not invalidate the sequence).

```
delay_consecutive_hours[D] = max consecutive run length where delay_rate_h > email_delay_rate_max
delay_confirmed[D]         = delay_consecutive_hours[D] >= email_delay_min_consecutive_hours
```

Collect every confirmed day into a single set:

```
confirmed_delay_days = [ D for D in current_window if delay_confirmed[D] = true ]
```

**One alert per project per issue type.** Do **not** emit one alert per day. If
`confirmed_delay_days` is non-empty, a **single** `email_delay_high` alert fires
for the project (Step 8), and its cause aggregates all confirmed days (count,
date range, peak rate + date). Days that pass the daily screen but fail the
hourly confirmation are **logged** in the canvas email health table (with their
actual delay rate) but do **not** contribute to the alert. The per-day detail
always remains visible in the `## 📧 Email deliverability health — history` table;
the Open Alerts list keeps just the one rolled-up row.

### Step 3c — Email delay drill-down (only when `email_delay_high` is newly confirmed)

Run this step **only** when the single `email_delay_high` alert is **newly
confirmed** this run (`confirmed_new` from Step 8a — not ongoing). Run the
drill-down for each day in `confirmed_delay_days` (typically focus on the
**peak** day for the canvas/escalation narrative; list the others compactly).

**The hourly breakdown was already fetched in Step 3b.5** (`delay_hourly_breakdown[D]`).
Do **not** re-fetch it. Proceed directly to Step 3c.2 (campaign correlation).

#### 3c.1 — Hourly breakdown for day `D` (already available from Step 3b.5)

`delay_hourly_breakdown[D]` was built in Step 3b.5 — do **not** re-fetch. The
table already has UTC and local hours (converted via `time_zone`), `delay_rate_h`,
raw counts, and the low-volume flags. Mark hours with
`delivery_h < min_email_delivery_day` as low volume (show counts but flag rate as
non-significant). The consecutive-hour window that triggered the alert is already
known; highlight those hours (⚠️) in the Slack/canvas table.

#### 3c.2 — Correlate with email campaigns sent on day `D`

List all sends that day and identify **email campaigns**:

```
GET /api/reports/responses/list
  params: start={D}, end={D}, limit=100
→ paginate via next_page until exhausted
```

**Email send heuristic** — treat a `responses/list` row as an email campaign when:
- `sends >= min_email_campaign_sends`, **and**
- `ios.sends + android.sends + web.sends == 0` (no mobile/web push volume on that row), **or**
- `push_type` is `SEGMENTS_PUSH` / `BROADCAST` with zero platform breakdown and high `sends`
  on a day where `/api/reports/sends` shows `email > 0`.

Sort candidates by `sends` descending. Keep the **top 5** (or fewer if none qualify).

For each retained campaign, fetch per-message deliverability events:

```
GET /api/reports/events/summary/perpush/{push_id}
→ extract delay, delivery, injection counts (location=custom)
```

Compute `delay_rate_push = delay / delivery * 100` when `delivery > 0`.

Extract a human-readable label — **do not pull full HTML**:
```
GET /api/reports/perpush/pushbody/{push_id}
→ decode push_body (base64 JSON) → push.options.message_name
   (fallback: push.options.campaigns.categories, else push_id)
```

Record `push_time` (UTC) from `responses/list` for hour-bucket correlation.

#### 3c.3 — Correlation hypothesis

Match hourly delay peaks with campaign activity:

1. Identify the hour(s) with the highest `delay_h` or `delay_rate_h` (ignore low-volume
   hours). Match campaign `push_time` against delay peaks in **UTC** (both are UTC),
   then express the conclusion in **local time** (`time_zone`) for the TAM.
2. Check whether a large campaign's `push_time` falls in the same hour or the
   **preceding 1–2 hours** (delays often lag injection).
3. If a top campaign has `delay_rate_push` above `email_delay_rate_max`, cite it as the
   primary suspect.
4. Output a `delay_campaign_correlation` string for Step 10, with hours in local
   time (and UTC in parentheses), e.g.:
   `"Delays concentrated at 10–11 local (08–09 UTC, 6.2%) coincide with campaign
   « Newsletter Juin » (push_time 09:58 local / 07:58 UTC, 42K sends, 7.1% delay
   rate on that message). Source: /api/reports/events HOURLY +
   /api/reports/responses/list + events/summary/perpush."`

If no campaign passes `min_email_campaign_sends`, state that delays may be
transactional/provider-wide rather than tied to a single blast.

### Step 4 — Fetch direct responses (per OS)

Use the aggregate daily response report (lighter than `responses/list`):

```
GET /api/reports/responses
  params: start=previous_window_start, end=current_window_end, precision=DAILY
→ each daily row has ios.{direct,influenced} and android.{direct,influenced}
```

Split into current / previous windows and sum **`direct` per OS only** for
alerting. Keep the `influenced` per-OS sums too — they are **not** used for
alerts but are read by the weekly benchmark section (Step 7b.2). Then compute,
per OS:

```
direct_response_rate_{os} = direct_{os} / push_sends_{os} * 100   (%)
```

(`push_sends_{os}` from Step 1.) Keep both windows for collapse detection in
Step 8.

### Step 5 — Fetch time in app (per OS)

```
GET /api/reports/timeinapp
  params: start=previous_window_start, end=current_window_end, precision=DAILY
→ each daily row has ios and android values
```

Split into current / previous windows. Per OS, compute the **average daily
value**: `timeinapp_avg_{os} = sum(values in window) / number_of_days`.

If the endpoint rejects `precision=DAILY` or returns 401/403, log
`"scope unavailable: /api/reports/timeinapp"` and skip time-in-app KPIs (do not
alert on missing data).

### Step 6 — Fetch devices at two dates (window start & end)

`GET /api/reports/devices` accepts a `date` param — **"all device events counted
occurred before this date-time"** — so it is NOT snapshot-only. Fetch it at the
**two window endpoints** and diff to get real growth/decline (no canvas-history
mechanism needed):

```
GET /api/reports/devices?date=<current_window_start>   # window start (yesterday − 6 days, 00:00)
GET /api/reports/devices?date=<current_window_end>      # window end (today / now)
```

Batch these two calls in parallel (Step 6 of the optimized chronology, Step 8b of
the ordering note). Each returns `total_unique_devices`, `date_closed` /
`date_computed`, and `counts.{ios,android,amazon,web,sms}.{unique_devices,
opted_in,opted_out,uninstalled}`. Extract for `ios`, `android`, `web` (if
`web.unique_devices > 0`), and `sms` (if `sms.unique_devices > 0`).

From the two dated results, Step 8 computes a two-date **evolution** (% growth/
decline) per OS + total for `total_devices_evolution`, `devices_optin`, and
`devices_uninstall` — the window **end** call also provides the current absolute
base for the canvas snapshot / benchmark opt-in rate.

**Graceful degrade:** if only ONE dated call succeeds (e.g. the window-start call
is unavailable), emit the current absolute value per OS with status `ok` and a
`note: "Evolution n/a"`; do **not** mark it `na` and do **not** trigger the
decline/rise thresholds that run.

**Per-week opted-in for push pressure (Change 2 / Step 7b):** the
`push_pressure_per_user` family needs the opted-in base at each weekly bucket end.
Batch one `GET /api/reports/devices?date=<week end>` per weekly bucket alongside
the two window calls; fall back to the current opted-in snapshot (labelled a
proxy) for any week whose dated call is unavailable.

### Step 7 — Read canvas for state (devices D-7 and open alerts)

```
slack_read_canvas(canvas_id)
```

If `canvas_id` is empty (first run), skip this step — there is no prior state.

Parse the canvas to extract:
1. **Devices snapshot from 7 days ago** — look for a row tagged with date
   `current_window_start` (= yesterday - 6 days) in the Devices History table.
   Extract `ios.unique_devices`, `ios.opted_in`, `ios.uninstalled`,
   `android.*`, `web.*`, `sms.*` (if present). NOTE (Change 1): device **alert**
   metrics no longer depend on this D-7 canvas row — they now come from the two
   dated `/api/reports/devices?date=` calls (Step 6). This row is still read to
   keep the canvas `## 📈 Devices history` table populated (display continuity),
   but a missing D-7 row no longer blocks any device metric.
2. **Currently open alerts** — list of alert keys already posted and not yet
   resolved (format: `ALERT_KEY | os | opened_date | last_seen_date | status`).
   Also read each row's **Status** (`Active` / `Muted`) and its reason. Any row
   a TAM has set to `Muted` is a **mute declared from Slack**: merge its key into
   the run's mute set and **sync it into `clients.yml` `muted_alerts`** (union;
   dedupe by key; keep any reason) so the mute persists across runs. See
   **Muting false positives**.
3. **Email deliverability health history** — rows from the
   `## 📧 Email deliverability health — history` table (date, delivered, delay,
   delay %, spam complaints, spam %). Used to avoid duplicate rows when
   re-running the same day and to preserve history beyond the 7-day API window.

A missing D-7 row no longer blocks device metrics: since Change 1 the device
evolution comes from the two dated `/api/reports/devices?date=` calls (Step 6), so
`total_devices_evolution` / `devices_optin` / `devices_uninstall` are computable
independently of canvas history. The D-7 row is only used for the canvas display
table and any non-device WoW figures that still reference it.

### Step 7b — Weekly insights (gated): 3-month history, benchmark, top campaigns, unicast

Run this step **only when `run_weekly_insights` is true** (the weekly-insights
gate in Step 0). Skipped on `alerts-only` and on `full` runs that fall inside the
weekly window; **forced** on `canvas-only`. It feeds the strategic canvas sections
(Step 11): `## 🧭 Executive recap`, `## 🌍 Global snapshot & benchmark`,
`## 📈 3-month trend`, `## 🏆 Top campaigns — last 30 days`, and
`## 📨 Unicast / transactional`. Everything here is **read-only analytics**; never
alert on it. All sub-blocks are **best-effort** — if an endpoint/scope is missing,
omit that block cleanly and keep the rest (never fail the run).

Compute the extra windows:

```
hist_start  = yesterday - 90 days      # ~13 weeks / 3 months, DAILY
camp_start  = yesterday - 29 days      # last 30 days for top campaigns
camp_end    = yesterday
```

#### 7b.1 — Three-month KPI history (13 weekly + 3 monthly buckets)

Fetch the Step 1 series over the wider 90-day window (one call each) plus
time-in-app. **De-dup (Step 0b rule 1):** on a weekly run these 90-day
`opens`/`sends`/`optins`/`optouts` pulls are the **single source** for both the
3-month history AND the Step 1 14-day window — slice the 14-day window out of
these same rows rather than issuing separate Step 1 calls. Issue the four
`DAILY` calls as one parallel batch:

```
GET /api/reports/opens     start=hist_start end=window_end precision=DAILY
GET /api/reports/sends     start=hist_start end=window_end precision=DAILY
GET /api/reports/optins    start=hist_start end=window_end precision=DAILY
GET /api/reports/optouts   start=hist_start end=window_end precision=DAILY
GET /api/reports/timeinapp start=<first-of-month 2 months back> end=window_end precision=MONTHLY
```

- Aggregate `opens`, `optins`, `optouts` into **13 weekly buckets** (Mon–Sun,
  totals; keep a per-OS split for opens) for the sparklines, plus **3 monthly
  buckets** (calendar months) for the small monthly table.
- **Sends are kept per platform**: from `/api/reports/sends`, bucket
  `ios`+`android` (= push), `email`, `sms`, `web` separately. The 3-month trend
  shows **app opens**, **sends per platform**, **opt-in rate**, **marketing
  pressure**, and **time-in-app** — one sparkline row each.
- **Marketing pressure** = push sends (`ios`+`android`) per **opted-in** device,
  per weekly bucket: `push_sends_week / opted_in_total` (use the current
  `devices` snapshot as the denominator if no historical device count exists;
  label it a proxy). Surfaces over- or under-messaging at a glance.
- **Time-in-app trend** uses the `timeinapp` MONTHLY series (avg value/day per
  OS) — 3 monthly points per OS. It is the only 3-month metric kept monthly
  (the endpoint is monthly-friendly and the value is a daily average, not a sum).
- **Opt-in rate trend** is a snapshot metric: take the `## 📈 Devices history`
  rows already in the canvas (up to 30 days) and the monthly snapshots preserved
  in this section; do not synthesize it from the daily series.
- Label **snapshot** metrics (opt-in rate, device base — from `devices`) and
  **period** metrics (opens, sends, opt-ins — summed over the bucket) distinctly.
  Time-in-app is an **average** metric — never sum it.

#### 7b.2 — Benchmark metrics vs industry (per device family)

Resolve the vertical: take the project `industry` (Step 0 input); match it to a
key in `benchmarks/benchmarks.json` directly or via each vertical's `aliases`
(e.g. telecom → `utility_productivity`, labelled as such). If nothing matches,
render the section as **"industry benchmark not available"** and skip the table —
never force a mismatched vertical.

Compute these client metrics **per device family** (`ios`, `android`, `web`),
each aligned to the benchmark's definition and denominator — **never blend OS**:

| Metric | Client value | Benchmark key |
|---|---|---|
| Push opt-in rate | `opted_in / unique` per OS (Step 6 `devices`, snapshot) | `optin_rate` |
| Direct open rate | `direct_{os} / sends_{os}` (Step 4 responses, 7-day window) | `direct_open_rate` |
| Influenced open rate | `influenced_{os} / sends_{os}` (Step 4 — read the influenced field that alerting ignores) | `influenced_open_rate` |
| Push sends/user/month | `sends_{os}` over 30d / `opted_in_{os}`; if derived from a weekly figure ×4.33 | `sends_per_user_month` |
| Message center read rate | best-effort (omit cleanly if unavailable) | `message_center_read_rate` (vertical-only) |

For each metric/OS that has both a client value and a benchmark entry, prepare:
**client value · median p50 · range [p10–p90] · gap** (in points for rates, or ×
for sends/user/month) and a **band** = `Low` (≤ p10) / `Medium` (≈ p50) / `High`
(≥ p90). Cite **source + quarter + region** (from `benchmarks.json` `meta`).
Benchmark-based reads are **capped at Medium confidence** (external/contextual).
If a specific metric or OS has no benchmark entry, show "n/a" for that cell
rather than inventing a value.

#### 7b.3 — Top campaigns by type & platform (last 30 days, via Activity Log)

Goal: surface the real top campaigns **by type** (one-shot vs recurring/automation
vs experiment) and **by platform**, with their **names and categories**, and
relate them to the brand's activity — **without** drowning in 1:1 unicast sends.

Use the **Activity Log** (`/api/reports/activity/details`) as the entry point: it
lists **one row per real campaign** (broadcast/segment/automation) and **excludes
the 1:1 unicast/triggered sends** that flood `responses/list`. This keeps
pagination tiny (typically a few rows/day) and gives the typology for free.

1. **Fetch the activity log:** `GET /api/reports/activity/details` with
   `start=camp_start end=camp_end limit=100`, following `next_page` (expect ≤ a few
   pages; if > 10 pages, cap at 10 and note "log truncated"). Each row carries:
   - `push_id`, `timestamp`
   - `type` — **`GROUP` = recurring / automation / push-to-local-time**, **`PUSH`
     = one-shot** (everything else)
   - `experiment` (bool) — **A/B test / experimentation**
   - `details.delivery.app.{alerting,silent,rich}` and `details.delivery.web.total`
     → **push/in-app/web delivery** (app = alerting+silent+rich; web = total).
     **Email blasts often show 0 here** even when they delivered — do not treat
     that as proof of a non-campaign (see step 2b).
   - `details.interaction.app.{direct,influenced}` → push engagement (`-1` = not
     measured; never treat as 0)
2. **Compute activity delivery** per row:
   `activity_delivery = app.alerting + app.silent + app.rich + web.total`.
   Rows with `activity_delivery > 0` use it as provisional `delivery` for ranking.
2b. **Email probe before dropping zeros (mandatory).** Rows with
   `activity_delivery == 0` are **not dropped yet** — they may be email (or other
   non-app) campaigns the activity log does not populate under
   `details.delivery.app`. For **each** such row only:
   - `GET /api/reports/perpush/pushbody/{push_id}` → cache decoded JSON (7b.6).
     Treat as **email** when `push.device_types` includes `"email"` **or**
     `push.notification.email` is present.
   - When email: `GET /api/reports/events/summary/perpush/{push_id}` → from the
     `events[]` list with `location=custom`, read counts by `name`:
     **`injection` → sends**, **`delivery` → delivery** (denominator for rates),
     **`open` → opens** (fallback: `initial_open`; label "(initial open)" when
     `open` absent), **`click` → clicks**. If `delivery > 0`, **retain** the row,
     set `channel = email`, and use these per-push figures for ranking and step 8.
     If `delivery == 0` after the per-push probe, drop (canceled / not yet sent).
   - When not email and `activity_delivery == 0`: drop (non-delivering schedule /
     canceled send).
   **Cost control:** `events/summary/perpush` only for rows confirmed email by
   pushbody — never for every activity row.
3. **Classify each row** into one bucket (priority order):
   `experiment` (experiment == true) → `recurring` (type == GROUP) →
   `one_shot` (type == PUSH). Optionally fold repeated one-shots sharing a
   **normalized `message_name`** into a recurring group via
   `scripts/classify_campaigns.py` (`classify_activity(activities, names)`).
4. **Rank within each bucket by delivery volume**, keep the **top 5 per bucket**.
   Aggregate occurrences sharing the same normalized name into a single entry
   (occurrences + total delivery + trend) so a journey appears once, not dozens of
   times.
5. **Resolve names + categories** only for the ranked top entries (not every row):
   reuse cached pushbody from step 2b when present; otherwise
   `GET /api/reports/perpush/pushbody/{push_id}` → base64-decode `push_body` →
   `options.message_name`, `campaigns.categories[]`, `campaigns.message_type`
   (commercial / transactional), `device_types`, and the `audience` selector.
   **Metadata only for the canvas** — never surface the alert title/body/HTML in
   the canvas top-campaigns section. (The **weekly recap** may show a text preview —
   title / subject / short body, **no images** — via the 7b.6 extractor; see the
   **Campaign content & privacy policy**.) A non-empty pushbody confirms a real
   campaign; an **empty**
   pushbody marks a unicast/triggered send (handled in 7b.4).
6. **Per-platform split** for ranked **push/in-app** entries only:
   `GET /api/reports/perpush/detail/{push_id}` → `platforms.{ios,android,web}`
   sends + direct/influenced. **Skip for email** — `/api/reports/perpush/detail`
   is mobile-centric and returns `sends=0` for email blasts; email volume and
   engagement come from step 2b / `events/summary/perpush` instead.
7. **Anti-false-positive guards:**
   - Exclude **test** sends (`options.test`).
   - Apply the per-platform floor `min_campaign_sends`; entries below it are
     ignored.
   - Mark open/CTR **non-significant ("n/s")** below the **volume floor**
     `min_campaign_sends` (default **1000** delivered) instead of a noisy rate.
   - Show a platform only if it is active for the project.
   - Require ≥ `min_recurring_occurrences` occurrences before labelling a series
     recurring; otherwise treat as one-shot.
   - For recurring, compute **volume drift** = latest occurrence vs series median;
     flag when it exceeds `recurring_drift_pct`.
8. **Per-campaign volume, engagement & benchmark band** (computed for the ranked
   **top one-shot** entries only — the shortlist reused by Step 10b / Step 11;
   never for every row).
   **Market-benchmark comparison is mandatory: every analysed campaign must be
   positioned against its market reference** whenever its engagement is real. The
   reference depends on the channel — **push/in-app → the vertical `direct_open_rate`
   band**, **message center → the vertical `message_center_read_rate` band**,
   **email → the client's own internal baseline** (Airship publishes no email
   benchmark) — and is resolved from `benchmarks/benchmarks.json` for the project's
   `industry` (else `all_verticals`). A campaign engagement number is **never shown
   on its own**: it is always paired with its benchmark band (▰▱▱▱▱ Low/Med/High) or,
   for email, its ▲/▼ delta vs the client average. The comparison is only omitted
   when the underlying engagement is genuinely unavailable (delivery `< min_campaign_sends`,
   metric not measured, or the resolved vertical has no entry for that metric) — in
   which case say so explicitly (`n/s` / `n/a` / "no benchmark"), never a bare rate.
   For each shortlisted campaign, derive:
   - **Volume** — `sends` (audience targeted) and `delivery`. For **push/in-app**,
     `delivery = details.delivery.app.alerting` from `/api/reports/activity/details`
     (the denominator for all push rates); per-platform delivery/interaction from
     `/api/reports/perpush/detail/{push_id}` when an OS split is needed.
     For **email**, **`/api/reports/perpush/detail` is not used** — take
     `sends = injection` and `delivery = delivery` from the step **2b**
     `events/summary/perpush` response (already fetched for probed rows; fetch
     now for any ranked email row not probed earlier).
   - **Engagement, per channel** — only when the numbers are real:
     - **Push / in-app:** `direct_open_rate = interaction.app.direct / delivery`
       and `influenced_open_rate = interaction.app.influenced / delivery` (both
       already fetched per push; `-1` = not measured → treat as unavailable, never 0).
     - **Email:** `open_rate = open / delivery * 100` and
       `click_rate = click / delivery * 100` from **`/api/reports/events/summary/perpush/{push_id}`**
       (mandatory for email — never infer from activity log or `perpush/detail`).
       Prefer `open`; if absent use `initial_open` and note "(initial open)".
       If `delivery < min_campaign_sends`, show volume but rate `n/s`. Email is also
       compared to the **internal email baseline** (see the dedicated bullet below).
     - **Message center:** `read_rate = reads / sends` (or the resolvable read
       count / delivery) when available — compared to the vertical
       **`message_center_read_rate`** benchmark (see the band bullet below). Mark
       engagement `n/a` only when no read data is resolvable.
     - **SMS:** whatever is resolvable (often only sends); mark engagement `n/a`
       when not available. SMS has no Airship benchmark.
   - **Internal email baseline (email's "benchmark").** There is **no Airship email
     open/click benchmark**, so email campaigns are judged **against the client's
     own email average** over the same window. Compute once per run from the Step 2
     `events_current` email system events (`location=custom`):
     ```
     client_email_open_rate  = Σ open  / Σ delivery * 100
     client_email_click_rate = Σ click / Σ delivery * 100
     ```
     (use `initial_open` for the numerator if `open` is absent, consistently for
     both the baseline and the per-campaign rate). For each shortlisted email
     campaign, report its open/click **vs this baseline** as a signed delta in
     points with an arrow (**▲** above / **▼** below the client's own average). Skip
     the comparison cleanly if the project sent no other email that window
     (baseline undefined) — then just show the campaign's own rate.
   - **Volume-floor honesty (`n/s`):** if `delivery < min_campaign_sends`, keep the
     **volume** but render the rate as **`n/s`** and **do not** compute a benchmark
     band. Never show a rate the volume can't support.
   - **Benchmark band (push/in-app):** compare the campaign's **direct open rate**
     against the vertical's **`direct_open_rate`** percentiles in
     `benchmarks/benchmarks.json` (the same source the canvas benchmark table cites,
     Step 7b.2). Because a campaign's app delivery blends OSes, use as the reference
     the **delivery-weighted blend of the per-OS `p10`/`p50`/`p90`** (weight each
     OS's percentiles by that OS's share of the campaign's app delivery from
     `perpush/detail`; when only one OS is active it is simply that OS's band — this
     matches the campaign's real audience mix without blending *client* metrics
     across OSes in the canvas table). Resolve the vertical exactly as Step 7b.2
     (project `industry`, else `all_verticals`). Band = **`low` (≤ p10) /
     `med` (≈ p50) / `high` (≥ p90)** — the same convention used everywhere:
     **🔴 Low ≤ p10 · 🟡 Medium ≈ p50 · 🟢 High ≥ p90**. Benchmark reads are
     **Medium confidence** at most.
   - **Benchmark band (message center):** compare the campaign's **read rate**
     against the vertical's **`message_center_read_rate`** percentiles (this metric
     is **vertical-only** — no OS split, so no per-OS blend). Same
     🔴/🟡/🟢 band convention and Medium-confidence cap. Only when a read rate is
     resolvable; otherwise "no data".
   - **No market benchmark for a channel:** **email** uses the **internal baseline**
     above (▲/▼ vs the client's own average), not a push band. **SMS** has no Airship
     benchmark at all — show the engagement value (when real) labelled
     **"no benchmark"**; never borrow another channel's band or invent one. If the
     resolved vertical has no entry for the relevant metric (`direct_open_rate` for
     push, `message_center_read_rate` for MC), treat that campaign the same way
     (value shown, "no benchmark").
   - **Be honest / degrade gracefully:** engagement and the band appear **only when
     the underlying numbers are real** (delivery ≥ floor, metric measured, benchmark
     present). Otherwise show the volume and `n/s` / `n/a` / "no benchmark" as
     appropriate — never a fabricated rate or band.

New tunable thresholds (defaults below; overridable in `clients.yml`
`custom_thresholds` and mirrored in `dashboard/thresholds-catalog.js`):
`min_campaign_sends`, `min_recurring_occurrences`, `recurring_drift_pct`.

#### 7b.4 — Unicast / transactional volume (best-effort)

Many projects (especially media/retail) send a large stream of **1:1 unicast /
triggered** pushes (single-device API sends). These are **excluded** from the
Activity Log, so estimate them rather than list them:

```
unicast_estimate_30d = total_push_sends_30d (ios+android, from /api/reports/sends)
                     − Σ campaign app delivery from /api/reports/activity/details
```

- Report it as an **aggregate** ("≈ N unicast/triggered sends over 30 days,
  ~N/day"), with its **share of total push volume**.
- **Understanding the content is best-effort only**: unicast pushbodies come back
  **empty** from `perpush/pushbody`, so the exact message cannot be retrieved.
  Describe them qualitatively (likely transactional / event-triggered — e.g. "new
  episode available", "order update") from project context and the presence of
  automations, and say so explicitly. Never fabricate the content.

#### 7b.5 — Executive recap & brand-activity context (best-effort)

Synthesize a short **narrative** (3–6 sentences, bold key numbers) for the
`## 🧭 Executive recap` section, combining:

- **Project health**: open alerts (count + worst), global opt-in/device trend,
  benchmark position, marketing-pressure direction.
- **Activity read**: what the project has been doing (top campaign **names** and
  **categories** from 7b.3 — e.g. a programme launch, an editorial push).
- **Brand-activity link** (best-effort, `data + web`): first use the campaign
  **names/categories** themselves (they often name the programme/offer); then run
  **one or two web searches** on `Brand name` + recent dates for notable news /
  launches that could explain spikes (e.g. a show premiere driving app opens).
  Label it **"contextual — best-effort"**, cap any causal claim at **Medium
  confidence**, and clearly separate measured data from inferred context. Never
  block or fail the run if web search is unavailable — omit the link cleanly.

#### 7b.6 — Campaign content extractor (optimized, shortlist-only)

The weekly recap (Step 10b) shows a small **text preview** of the top campaigns
(title / subject / body — **no images**). Campaign `push_body` payloads are
**base64-encoded JSON** and can be large (a full HTML email is easily > 100 KB), so
extraction must be **cheap and channel-aware**. This subsection is the single,
reusable extractor Step 10b calls. The extractor can also return a `hero_image`,
but the Slack recap is **text-only** and does not use it — surface `title`, the
email `subject`, and the `snippet`/`body` text.

**Cost controls (mandatory):**
- **Shortlist only.** Fetch `perpush/pushbody` **only** for the ranked entries
  that will actually be shown (the top one-shot + unicast previews in Step 10b —
  typically ≤ 6 campaigns), never for every campaign.
- **Decode once, cache per run.** Keep a `pushbody_cache[push_id] → decoded JSON`
  and a `perpush_events_cache[push_id] → events/summary/perpush response` for the
  whole run so 7b.3 and 10b never re-fetch or re-decode the same id.
- **Bounded HTML parse.** For HTML bodies, **strip `<head>`, `<style>`,
  `<script>`, and comments first**, then scan the **cleaned body** for the hero
  image and the text snippet. (Scanning only the raw first ~8 KB fails on real
  emails whose leading `<style>` block pushes the first `<img>` past the window —
  this was observed live on a media client's emails.)

**Decode:** `decoded = json.loads(base64decode(push_body))`. Then branch on the
channel. Field paths below are **validated live** (a retail client push+MC, a
telco client SMS + in-app scene, a media client email + push + in-app automation):

| Channel | Hero media | Text snippet |
|---|---|---|
| **Push** | iOS `notification.ios.media_attachment.url`; Android `notification.android.style.big_picture`; Web `notification.web.image` / `notification.web.icon` | `notification.alert` (or per-platform `notification.{ios,android}.alert`) |
| **Email** | first `<img src>` (or CSS `background-image:url(...)`) in the **cleaned** HTML under `push.message.body` **or** `push.notification.email.template.fields.html_body` | `push.message.subject` **or** `push.notification.email.template.fields.subject`, else first ~200 chars of cleaned HTML text |
| **Message center** | inbox icon `message.icons.list_icon`; hero = first `<img>` in cleaned `message.template.fields.html_body` (or `message.body`) | `message.title` + first ~200 chars of cleaned body text |
| **SMS** | none | `notification.sms.template.fields.alert` — **multilingual Handlebars** (`{{#eq language "fr"}}…{{/eq}}`); resolve the default / `fr` branch and strip the Handlebars tags |
| **In-app modal** (legacy) | `in_app_message.message.display.media.url` | `in_app_message.message.display.body.text` + `display.buttons[].label.text` |
| **In-app scene / layout** | recursive collector: first node with `type ∈ {"media","image"}` → its `url` (resolving any `references` block that stores the actual URL) | first `type:"text"` node's `text`; `reporting_context.content_types` is typically `["scene","branching"]` |

**Channel detection:** infer from which block is present — `push.device_types`
includes `"email"` or `push.notification.email` → email; `in_app_message` or a
`layout`/scene structure → in-app; `notification.sms` → SMS;
`message.template`/`message.icons` → message center; `push.message.body` (HTML) →
email (legacy path); otherwise `notification.{ios,android,web}` → push. A single
campaign can carry several (e.g. push + message center) — extract each present
channel. When both activity delivery and push/in-app blocks are absent but email
is detected, the row is still a valid campaign (volume from
`events/summary/perpush`, step 2b).

**Recursive media collector** (for scenes and nested layouts): walk the decoded
object; collect any string value under a key in {`url`, `media_url`,
`background_image`, `image`, `src`} that looks like an `https://` media URL, plus
resolve `references`/`content` id→url maps. Return the first usable image.

**Privacy:** text previews (title / subject / short snippet) **are** allowed for
the recap (see the relaxed policy in **Data sources** / Step 10b). **No images are
posted** — the extractor may still compute `hero_image`, but the recap ignores it.
Never expose raw recipient data, tokens, or unicast 1:1 bodies (those come back
empty anyway).

**Optional helper:** `scripts/extract_pushbody.py` implements exactly this
(decode + channel-aware extraction + bounded HTML parse) as a reusable convenience
— agents may call it or inline the logic. It is **not** required to run the skill.

### Step 8 — Compute deltas and evaluate thresholds

> **Week-over-week is internal-only.** The rolling 7-day vs previous-7-day deltas
> computed here still drive **all alerting** (Steps 8–10). They are **no longer
> rendered in the canvas** — the canvas is now a strategic, global + 3-month-trend
> report (Step 11). Keep computing WoW for alerts; just don't build WoW tables for
> the canvas.

#### Default thresholds (overridden by custom thresholds in the prompt)

> These defaults are mirrored for the dashboard's per-project threshold editor in
> `dashboard/thresholds-catalog.js`. Keep the two in sync: any change here must be
> reflected there (and vice-versa). Per-project overrides live in `clients.yml`
> `custom_thresholds` (see **Editing thresholds**).

```yaml
# App (evaluated PER OS: ios, android)
app_opens_drop_pct: 40          # WoW drop > 40% on that OS → alert
app_opens_cross_os_gap_pts: 50   # OR |iOS WoW − Android WoW| > 50 pts → alert on BOTH OS

# Engagement / time in app (PER OS)
timeinapp_drop_pct: 20          # avg time-in-app drop > 20% → alert

# Acquisition — total devices evolution (per OS + total). Two-date growth/decline
# from /api/reports/devices?date=<window start> vs ?date=<window end> (Step 6).
# MERGES the former devices_unique_trend_drop_pct + installs proxy into one key.
total_devices_evolution_drop_pct: 5  # decline > 5% in TOTAL unique devices across the window → alert

# App engagement — opt-in / opt-out ratio (PER OS, iOS/Android only). Replaces
# the old standalone "Opt-in registrations" tile/threshold (optins_drop_pct).
optin_optout_ratio_drop_pct: 30  # avg ratio WoW drop > 30% AND within-window trend also declining → alert

# Push mobile (evaluated PER OS: ios, android)
push_sends_drop_pct: 100        # drop > 100% (i.e. zero sends) → alert
optouts_rise_pct: 20            # push opt-out RAW COUNT rise > 20% → magnitude pre-filter (necessary, not sufficient)
optout_rate_rise_pct: 15        # AND the opt-out RATE per send must rise ≥ 15% WoW → alert. If the raw count
                                #   grows because sends/audience grew (rate flat or down), it is volume-driven → NO alert
direct_response_rate_min: 0.5   # rate < 0.5% → alert (absolute, current window)
direct_response_collapse_pct: 60 # WoW drop of direct response RATE ≥ 60% on an OS → likely tracking/SDK issue

# Push pressure per user per week (informational ceiling; family push_pressure_per_user)
push_pressure_per_user_max: 14  # weekly push sends (iOS+Android) / opted-in devices > 14 → over-messaging ceiling (~2/day)

# Acquisition / opt-ins — device base TWO-DATE evolution (per OS), from the two
# dated /api/reports/devices?date= calls (Step 6), NOT a canvas D-7 snapshot. The
# opt-in EVENTS signal (formerly optins_drop_pct) now lives above under App
# engagement as the opt-in / opt-out ratio.
devices_optin_drop_pct: 5       # opted-in devices drop > 5% across the window → alert
devices_uninstall_rise_pct: 10  # uninstalled devices rise > 10% across the window → alert
# net_optin_negative: alert if net (opt-ins − opt-outs) flips from ≥0 to <0

# Email (channel-level, no OS split)
email_sends_drop_pct: 100       # drop > 100% (i.e. zero sends) → alert
email_deliverability_min: 95    # rate < 95% → alert (absolute)
email_open_rate_drop_pts: 5     # drop > 5 percentage points → alert
email_bounce_max: 2             # rate > 2% → alert (absolute)
email_unsubscribe_rise_pct: 30  # rise > 30% → alert
email_spam_complaint_rate_max: 1  # daily spam_complaint / delivery > 1% → alert
email_delay_rate_max: 10          # hourly delay / delivery > 10% threshold (per hour)
email_delay_min_consecutive_hours: 2  # min consecutive hours above threshold to confirm alert

# Web push (only evaluated if web.unique_devices > 0)
web_sends_drop_pct: 100         # drop > 100% (i.e. zero sends) → alert
web_sends_rise_pct: 100         # rise > 100% → alert (unexpected spike)

# SMS channel (only evaluated if sms.unique_devices > 0 OR sms_sends_prev > 0)
sms_sends_drop_pct: 100         # WoW drop > 100% (i.e. zero sends) → alert
sms_sends_rise_pct: 100         # WoW rise > 100% → alert (unexpected spike)
sms_delivery_rate_min: 85       # delivery rate (delivered/dispatched) < 85% → alert
sms_delivery_rate_drop_pts: 10  # delivery rate drops > 10 percentage points → alert

# Custom events
custom_event_rise_pct: 50       # rise > 50% → alert
custom_event_drop_pct: 50       # drop > 50% → alert

# Minimum volumes to evaluate a threshold (anti false-positive)
min_push_sends: 1000            # per OS — skip push thresholds if prev 7d sends < 1000
min_email_sends: 500            # skip email thresholds if prev 7d emails < 500
min_email_delivery_day: 100     # skip daily spam/delay check if that day's deliveries < 100
min_email_campaign_sends: 5000  # min sends to include a campaign in delay correlation
min_custom_event_count: 200     # skip custom event threshold if prev count < 200
min_optin_optout_volume: 100     # per OS — skip the opt-in/opt-out ratio threshold if prev 7d opt-in+opt-out volume < 100
min_timeinapp: 1                # skip time-in-app threshold if prev avg < 1
min_sms_sends: 100              # skip SMS sends thresholds if prev 7d SMS sends < 100
min_sms_dispatched: 50          # skip SMS delivery rate threshold if prev 7d dispatched < 50
min_web_sends: 100              # skip web push threshold if prev 7d web sends < 100

# Alert confirmation gate + hysteresis (anti false-positive) — see Step 8a
alert_confirm_runs: 2           # consecutive breaching runs before a breach is CONFIRMED (candidate → confirmed)
alert_resolve_runs: 2           # consecutive non-breaching runs before a CONFIRMED alert resolves (hysteresis)
alert_escalate_runs: 3          # confirmed + critical + streak ≥ this → eligible for a throttled Slack escalation (Step 10)
escalate_throttle_days: 7       # min days between two Slack escalation posts for the same key
cadence_daily_ratio: 0.6        # min active-send-day ratio (trailing 28d) to treat a channel as a daily sender;
                                #   below this a zero-send window is expected cadence → zero-send drop is suppressed

# Weekly insights — top campaigns (Step 7b.3; analytics only, never alert)
min_campaign_sends: 1000        # ignore a campaign identity below this many sends over 30d
min_recurring_occurrences: 3    # min occurrences to treat a series as automated/recurring
recurring_drift_pct: 50         # flag a recurring series whose latest volume deviates > 50% from its median
```

#### Metric calculations (per OS where applicable)

For each `os` in {`ios`, `android`}:

```
# App opens
app_opens_{os}_current   = sum(opens.{os}) over current window
app_opens_{os}_previous  = sum(opens.{os}) over previous window
app_opens_{os}_delta_pct = (current - previous) / previous * 100
app_opens_cross_os_gap_pts = abs(app_opens_ios_delta_pct - app_opens_android_delta_pct)
# Source: /api/reports/opens

# Push sends
push_sends_{os}_current  = sum(sends.{os}) over current window
push_sends_{os}_previous = sum(sends.{os}) over previous window
push_sends_{os}_delta_pct = (current - previous) / previous * 100
# Source: /api/reports/sends

# Push opt-outs (raw + rate vs sends)
push_optouts_{os}_current  = sum(optouts.{os}) over current window
push_optouts_{os}_previous = sum(optouts.{os}) over previous window
push_optouts_{os}_delta_pct = (push_optouts_{os}_current - push_optouts_{os}_previous) / push_optouts_{os}_previous * 100
push_optout_rate_{os}_current  = push_optouts_{os}_current  / push_sends_{os}_current  * 100
push_optout_rate_{os}_previous = push_optouts_{os}_previous / push_sends_{os}_previous * 100
push_optout_rate_{os}_delta_pct = (push_optout_rate_{os}_current - push_optout_rate_{os}_previous) / push_optout_rate_{os}_previous * 100
# Source: /api/reports/optouts (rate denominator = /api/reports/sends)
# (a device can opt out without opening the push → denominator is sends)
# The alert correlates BOTH: the raw count must rise materially AND the per-send rate
# must worsen. When sends grow proportionally (rate flat/down), the rise is volume-driven → suppressed.

# Direct response rate (tracking-health signal)
direct_response_rate_{os}_current  = direct_{os}_current  / push_sends_{os}_current  * 100
direct_response_rate_{os}_previous = direct_{os}_previous / push_sends_{os}_previous * 100
direct_rate_drop_pct_{os} = (previous_rate - current_rate) / previous_rate * 100
# Source: /api/reports/responses (denominator = /api/reports/sends)

# Opt-in / opt-out ratio (per OS) — App & engagement card. Replaces the old
# standalone "Opt-in registrations" tile; the underlying fetches are unchanged.
# /api/reports/optins and /api/reports/optouts each return per-day iOS/Android
# counts only (no web/SMS series). {os} ∈ {ios, android}.
for each day d in the current window (and, separately, the previous window):
  optin_optout_ratio_{os}_{d} = optins.{os}_{d} / optouts.{os}_{d}   if optouts.{os}_{d} > 0
                               = OMIT d from the average/series        if optouts.{os}_{d} == 0
  # Divide-by-zero guard: a zero-opt-out day has an undefined ratio, not an
  # artificial spike — exclude it from the trend/average rather than capping it.
optin_optout_ratio_{os}_current  = mean(optin_optout_ratio_{os}_d for d in current window,  d not omitted)
optin_optout_ratio_{os}_previous = mean(optin_optout_ratio_{os}_d for d in previous window, d not omitted)
optin_optout_ratio_{os}_delta_pct = (current - previous) / previous * 100
# `series` for the dashboard = the daily ratio across the CURRENT window in date
# order (the trend itself — this IS the chart, not a separate WoW-only figure).
# Declining-trend guard (Step 8 alert key below) = the current window's LAST
# non-omitted daily ratio < its FIRST non-omitted daily ratio (simple start→end
# comparison, consistent with the unique-devices trend definition below).
# Source: /api/reports/optins ÷ /api/reports/optouts

# Net opt-in balance (unchanged, still computed for net_optin_negative — separate
# from the ratio above; both read the same two endpoints)
optins_{os}_current  = sum(optins.{os}) over current window
optins_{os}_previous = sum(optins.{os}) over previous window
net_optin_{os}_current  = optins_{os}_current  - push_optouts_{os}_current
net_optin_{os}_previous = optins_{os}_previous - push_optouts_{os}_previous
# Source: /api/reports/optins (net uses /api/reports/optouts)

# Push pressure per user per week (family push_pressure_per_user, Push section).
# Promotes the Step 7b marketing-pressure formula to a per-project dashboard
# family with a MULTI-WEEK evolution series. Unit: msg/user/wk.
for each weekly bucket w (most recent N weeks, e.g. 9):
  push_sends_w      = sum(sends.ios + sends.android) over week w
  optin_base_w      = counts.ios.opted_in + counts.android.opted_in
                        from /api/reports/devices?date=<week w end>   # batched, Step 6
                        FALLBACK: current opted-in snapshot (label a proxy) if that
                        week's dated call is unavailable
  push_pressure_per_user_w = push_sends_w / optin_base_w              # msg/user/wk
push_pressure_per_user_current  = push_pressure_per_user_w[last]
push_pressure_per_user_previous = push_pressure_per_user_w[last-1]
# `series` for the dashboard = push_pressure_per_user_w in week order (the evolution).
# Alert: push_pressure_per_user_current > push_pressure_per_user_max (informational ceiling).
# Source: /api/reports/sends ÷ /api/reports/devices?date=<week end>

# Time in app
timeinapp_{os}_current   = avg daily value over current window
timeinapp_{os}_previous  = avg daily value over previous window
timeinapp_{os}_delta_pct = (current - previous) / previous * 100
# Source: /api/reports/timeinapp
```

Totals (for context display only — thresholds are evaluated per OS):

```
push_sends_total = push_sends_ios + push_sends_android
app_opens_total  = app_opens_ios + app_opens_android
(etc.)
```

Web push metrics (channel-level; only evaluated if web.unique_devices > 0 OR
web_sends_prev > 0):

```
web_sends_current  = sum(sends.web) over current window   # /api/reports/sends
web_sends_previous = sum(sends.web) over previous window
web_sends_delta_pct = (current - previous) / previous * 100
# Source: /api/reports/sends field "web"
```

SMS metrics (channel-level; only evaluated if sms.unique_devices > 0 OR
sms_sends_previous > 0):

```
sms_sends_current  = sum(sends.sms) over current window   # /api/reports/sends
sms_sends_previous = sum(sends.sms) over previous window
sms_sends_delta_pct = (current - previous) / previous * 100
# Source: /api/reports/sends field "sms"

# SMS delivery rate — from SMS Delivery Report custom events (if present)
# These events are fired by the SMS provider and flow through /api/reports/events
sms_dispatched_current  = events_current["dispatched"].count  (where location=custom)
sms_delivered_current   = events_current["delivered"].count
sms_failed_current      = events_current["failed"].count
sms_expired_current     = events_current["expired"].count
sms_dispatched_previous = events_previous["dispatched"].count
sms_delivered_previous  = events_previous["delivered"].count

sms_delivery_rate_current  = sms_delivered_current  / sms_dispatched_current  * 100
sms_delivery_rate_previous = sms_delivered_previous / sms_dispatched_previous * 100
sms_delivery_rate_drop_pts = sms_delivery_rate_previous - sms_delivery_rate_current
# Source: /api/reports/events (SMS Delivery Report events, location=custom)
# Note: only compute delivery rate if sms_dispatched_current >= min_sms_dispatched
# Note: "dispatched", "delivered", "failed" etc. events are SMS-specific only when
#       the project uses the SMS channel; they will be absent or near-zero otherwise.
#       If a project also has other custom events with these names, use context (volume,
#       correlation with sms_sends) to confirm they are SMS delivery events.
```

Email metrics (channel-level, unchanged):

```
email_sends_current   = sum(sends.email) over current window      # /api/reports/sends
injection_current     = events_current["injection"].count          # /api/reports/events
delivery_current      = events_current["delivery"].count
open_current          = events_current["initial_open"].count       (unique opens)
bounce_current        = events_current["bounce"].count
unsubscribe_current   = events_current["unsubscribe"].count

email_deliverability_current = delivery_current / injection_current * 100
email_open_rate_current      = open_current / delivery_current * 100
email_bounce_rate_current    = bounce_current / injection_current * 100
(repeat for previous window)
```

Email deliverability health (daily pre-filter from Step 3b, hourly confirmation from Step 3b.5):

```
For each date d in [current_window_start, current_window_end]:
  delay_rate_{d}               = delay_{d} / delivery_{d} * 100        (daily aggregate — pre-filter only)
  spam_complaint_rate_{d}      = spam_complaint_{d} / delivery_{d} * 100
  delay_consecutive_hours[d]   = max consecutive run of hours where delay_rate_h > email_delay_rate_max
  delay_confirmed[d]           = delay_consecutive_hours[d] >= email_delay_min_consecutive_hours
# Source: /api/reports/events DAILY (one call per day) + HOURLY (one call per hour, only for candidate days)
# Denominator: delivery (same day / same hour)
# Skip day if delivery_{d} < min_email_delivery_day
```

Total devices evolution — TWO-DATE evolution (per OS + total), Acquisition card.
`/api/reports/devices?date=<date-time>` counts all device events before that
date-time, so the two window endpoints are read directly from the API (Step 6) —
no canvas-history mechanism. This single family MERGES the former `installs` proxy
and canvas-history `devices_unique` trend:

```
# From the two dated calls of Step 6 (start = ?date=<window start>, end = ?date=<window end/today>):
total_devices_evolution_total_delta_pct = (end.total_unique_devices - start.total_unique_devices)
                                            / start.total_unique_devices * 100
for {os} ∈ {ios, android, web, sms}:
  total_devices_evolution_{os}_delta_pct = (end.counts.{os}.unique_devices - start.counts.{os}.unique_devices)
                                            / start.counts.{os}.unique_devices * 100
# Alert: decline (delta_pct ≤ -total_devices_evolution_drop_pct) on total (or an OS).
# GRACEFUL: if only ONE dated call succeeded, emit the current absolute base per OS
# (status "ok", note "Evolution n/a"), NO deltaPct/threshold.breaching — the
# dashboard shows its "History building…" placeholder, never a greyed-out "na".
# Source: /api/reports/devices?date=<start> + /api/reports/devices?date=<end> (Step 6)
```

Opted-in / uninstalled devices — SAME two-date evolution (per OS), Acquisition
cards. No canvas D-7 dependency any more:

```
devices_{os}_optin_delta_pct     = (end.counts.{os}.opted_in    - start.counts.{os}.opted_in)    / start.counts.{os}.opted_in    * 100
devices_{os}_uninstall_delta_pct = (end.counts.{os}.uninstalled - start.counts.{os}.uninstalled) / start.counts.{os}.uninstalled * 100
# Alert: devices_optin_drop_pct (opted-in decline) / devices_uninstall_rise_pct (uninstalls rise).
# Source: /api/reports/devices?date=<start> + /api/reports/devices?date=<end> (Step 6)
```

The per-OS **absolute snapshot** values (`devices_{os}_opted_in`,
`devices_{os}_uninstalled`) are **always available** from the window-end call of
Step 6 — the delta needs both dated calls. So a run with only one dated call
**still emits each device KPI's current value** to the dashboard
(Step 13): do **not** mark these `na` just because the delta is missing. Emit
`status: "ok"`, the absolute `current` + per-OS `os.{os}.value`, omit `deltaPct`/
`headroom`/`breaching`, and add `note: "Evolution n/a"`. Only use `na` when the
snapshot itself is unavailable. The threshold (two-date evolution) is simply
**not evaluated** for alerting when only one dated call is available.

#### Assign an alert key to each threshold breach

Each alert has a stable string key (used for deduplication). Per-OS keys use
the `{os}` suffix (`ios` / `android`; `web` for web push).

| Key | Condition |
|---|---|
| `app_opens_drop_{os}` | app_opens_{os}_delta_pct ≤ −app_opens_drop_pct **OR** abs(app_opens_ios_delta_pct − app_opens_android_delta_pct) > app_opens_cross_os_gap_pts (when the gap fires, alert **both** iOS and Android) |
| `timeinapp_drop_{os}` | timeinapp_{os}_delta_pct ≤ -timeinapp_drop_pct |
| `push_sends_drop_{os}` | push_sends_{os}_delta_pct ≤ -push_sends_drop_pct |
| `push_optouts_rise_{os}` | push_optouts_{os}_delta_pct ≥ optouts_rise_pct **AND** push_optout_rate_{os}_delta_pct ≥ optout_rate_rise_pct (raw-count rise correlated with a real per-send rate worsening; a volume-driven rise where the rate is flat/down is **suppressed**) |
| `direct_response_low_{os}` | direct_response_rate_{os}_current < direct_response_rate_min |
| `direct_response_collapse_{os}` | direct_rate_drop_pct_{os} ≥ direct_response_collapse_pct |
| `optin_optout_ratio_drop_{os}` | optin_optout_ratio_{os}_delta_pct ≤ -optin_optout_ratio_drop_pct **AND** the current window's ratio series is declining (last non-omitted daily ratio < first non-omitted daily ratio) — avoids firing on a single noisy day |
| `net_optin_negative_{os}` | net_optin_{os}_previous ≥ 0 AND net_optin_{os}_current < 0 |
| `email_sends_drop` | email_sends_delta_pct ≤ -email_sends_drop_pct |
| `email_deliverability_low` | email_deliverability_current < email_deliverability_min |
| `email_open_rate_drop` | open_rate_drop_pts ≥ email_open_rate_drop_pts |
| `email_bounce_high` | email_bounce_rate_current > email_bounce_max |
| `email_unsubscribe_rise` | unsubscribe_delta_pct ≥ email_unsubscribe_rise_pct |
| `email_spam_complaint_high` | spam_complaint_rate_{date} > email_spam_complaint_rate_max on **≥ 1 day** in the current window (each day guarded by delivery_{date} ≥ min_email_delivery_day). One alert per project; cause aggregates the affected days. |
| `email_delay_high` | delay_rate_{date} > email_delay_rate_max (daily pre-filter, same volume guard) **AND** delay_confirmed[date] = true (≥ email_delay_min_consecutive_hours consecutive hours, Step 3b.5) on **≥ 1 day** in the current window. **One alert per project** — never one per day; cause aggregates all confirmed days (count, range, peak rate + date). |
| `web_sends_drop` | web_sends_delta_pct ≤ -web_sends_drop_pct (if web active) |
| `web_sends_rise` | web_sends_delta_pct ≥ web_sends_rise_pct (if web active) |
| `sms_sends_drop` | sms_sends_delta_pct ≤ -sms_sends_drop_pct (if SMS active) |
| `sms_sends_rise` | sms_sends_delta_pct ≥ sms_sends_rise_pct (if SMS active) |
| `sms_delivery_rate_low` | sms_delivery_rate_current < sms_delivery_rate_min (if dispatched ≥ min_sms_dispatched) |
| `sms_delivery_rate_drop` | sms_delivery_rate_drop_pts ≥ sms_delivery_rate_drop_pts threshold (same guard) |
| `total_devices_evolution_drop` (and `total_devices_evolution_drop_{os}`) | total_devices_evolution_total_delta_pct (or _{os}_delta_pct) ≤ -total_devices_evolution_drop_pct (two-date evolution from the two dated devices calls, not a D-7 snapshot) |
| `devices_{os}_optin_drop` | devices_{os}_optin_delta_pct ≤ -devices_optin_drop_pct (two-date evolution) |
| `devices_{os}_uninstall_rise` | devices_{os}_uninstall_delta_pct ≥ devices_uninstall_rise_pct (two-date evolution) |
| `devices_web_optin_drop` | idem (if web active) |
| `push_pressure_per_user_high` | push_pressure_per_user_current > push_pressure_per_user_max (informational over-messaging ceiling; never critical) |
| `custom_event_new:{name}` | event in current, absent in previous |
| `custom_event_vanished:{name}` | event in previous, count=0 in current |
| `custom_event_rise:{name}` | count delta ≥ custom_event_rise_pct |
| `custom_event_drop:{name}` | count delta ≤ -custom_event_drop_pct |

Email health keys (`email_delay_high`, `email_spam_complaint_high`) are
**one per project, not per day**. They stay open (ongoing) while **any** day in
the current window still breaches, and **resolve** only when **no** day in the
current window breaches on a later run. The list of affected days lives in the
alert cause and in the canvas email-health history table, not as separate alerts.

Do **not** evaluate a threshold if the relevant previous-window volume is
below the minimum defined in `min_*` settings (per OS where the minimum is
per OS). Log `"skipped: low volume"`.

When both `direct_response_low_{os}` and `direct_response_collapse_{os}` fire on
the same OS, post a single alert keyed `direct_response_collapse_{os}` (it
implies the low rate).

### Step 8a — Confirmation gate, hysteresis & cadence-aware suppression

**This is the core false-positive fix.** A threshold breach from Step 8 is no
longer an alert on its own — it must **persist across runs** to be *confirmed*.
Transient one-day blips that clear on the next run never reach Slack and never
clutter the alert tracking.

**Where streak state lives.** Agents have no memory between runs, so the
per-project **Slack canvas Open Alerts table is the source of truth** (read in
Step 7). The gate stores its counters inside the **existing `Status` column** —
**no new columns or sections; the canvas structure is unchanged.** Only the
`Status` vocabulary is extended:

- `🟠 Candidate {streak}/{N}` — breaching but not yet confirmed (**dashboard-only**, never posted/escalated)
- `Active` — confirmed (unchanged)
- `Active · clearing {k}/{M}` — confirmed but currently non-breaching, inside the resolve hysteresis
- `🔕 Muted` — unchanged

**Per-run algorithm** — for every threshold key evaluated in Step 8, reconcile it
against its canvas row (if any):

```
confirm_runs(key) = per-metric override (below) else alert_confirm_runs   # default 2
resolve_runs      = alert_resolve_runs                                    # default 2

breached_now = Step 8 condition true for key (AFTER min-volume + cadence guards)
prior        = canvas row for key: { state, streak, clear_streak, opened, first_breach }

if breached_now:
    streak       = (prior.streak or 0) + 1
    clear_streak = 0
    if prior.state == "confirmed" OR streak >= confirm_runs(key):
        state = "confirmed"            # stays / becomes Active
        opened = prior.opened or today # first run it reached confirmed
    else:
        state = "candidate"            # Status "🟠 Candidate {streak}/{confirm_runs}"
else:                                   # not breaching this run
    clear_streak = (prior.clear_streak or 0) + 1
    if   prior.state == "candidate": state = "cleared"   # candidates drop immediately — never lingered, never posted
    elif prior.state == "confirmed": state = clear_streak >= resolve_runs ? "resolved" : "confirmed"  # hysteresis
    else:                            state = "cleared"
```

Track `first_breach` = the first candidate run for the key (drives the dashboard
streak display); `opened` = first run it reached `confirmed` (drives the canvas
`Opened` column and the dashboard age graph).

**Per-metric `confirm_runs` overrides** (defaults — each still overridable per
project via `clients.yml` `custom_thresholds`):

- **Confirm in 1 run** (urgent, rarely a false positive — treat as confirmed as
  soon as breached): `email_deliverability_low`, `email_bounce_high`,
  `email_spam_complaint_high`, `email_delay_high` (already hour-confirmed in
  Step 3b.5), `sms_delivery_rate_low`, `direct_response_collapse_{os}`.
- **Confirm in 3 runs** (noisy / cadence-sensitive):
  `push_sends_drop_{os}`, `email_sends_drop`, `web_sends_drop`, `sms_sends_drop`,
  `custom_event_rise:{name}`, `custom_event_drop:{name}`, and
  `app_opens_drop_{os}` when triggered by the **cross-OS gap only**.
- **All others**: `alert_confirm_runs` (default 2).

**Cadence-aware zero-send suppression.** A `*_sends_drop` breach that is really a
**zero / near-zero send window** is checked against the channel's own cadence
**before** it can even become a candidate:

```
active_day_ratio(channel) = (days with sends > 0) / (total days), trailing 28d
   (reuse the Step 1 series; if only the 14-day window is available, use that)

if breach is a zero/near-zero-send window AND active_day_ratio < cadence_daily_ratio:
    suppress → NOT even a candidate; log "suppressed: irregular send cadence (ratio {r})"
```

Rationale: many projects legitimately send on only a few days a week (weekly
newsletters, occasional SMS blasts, event-triggered web push). For those, a 7-day
window with no send is normal cadence, not an incident. Only a **normally-daily**
sender (`ratio ≥ cadence_daily_ratio`) going silent raises an alert, and it still
passes through the confirm-runs gate above.

**Volume-driven opt-out suppression.** A `push_optouts_rise_{os}` breach is
correlated with the per-send RATE **before** it can become a candidate:

```
rate_delta = push_optout_rate_{os}_delta_pct   # (rate_current - rate_previous) / rate_previous * 100

if push_optouts_{os}_delta_pct ≥ optouts_rise_pct AND rate_delta < optout_rate_rise_pct:
    suppress → NOT even a candidate; log "suppressed: volume-driven opt-outs
    (raw +{raw}%, rate {rate_prev}%→{rate_cur}% = {rate_delta}%, sends {+/-S}%)"
```

Rationale: when the audience grows and send volume rises, the absolute opt-out
count rises mechanically. If the **rate per send** stays flat or falls, engagement
is not degrading — this is expected and must not alert (e.g. a broadcaster doing
seasonal blasts). Only a breach where the raw count rose **and** the per-send rate
also worsened (`rate_delta ≥ optout_rate_rise_pct`) becomes a candidate and passes
through the confirm-runs gate.

**Muted keys short-circuit the entire gate** (evaluated first, as today): a muted
key is never a candidate, never confirmed, never escalated.

**Outputs of Step 8a** (consumed by Steps 9, 10, 11, 13):
- `confirmed_new` — keys that reached `confirmed` **this** run (`opened == today`).
- `confirmed_ongoing` — already-confirmed keys still breaching or clearing.
- `candidate_alerts` — breaching, not yet confirmed (dashboard + canvas Status only).
- `resolved_alerts` — confirmed keys that cleared the resolve hysteresis this run.
- per-key `streak` / `clear_streak` / `opened` / `first_breach`.

### Step 8b — Root cause analysis (for each triggered alert)

Run this step only for **newly-confirmed alerts** (`confirmed_new` from Step 8a —
not candidates, not ongoing ones). For each breach, produce a short
`possible_cause` string for the canvas alert analysis (Step 11), the dashboard
(Step 13), and any escalation message (Step 10).
Work through the checks below in order and stop at the first that explains
the variation. If none applies, output `"No clear cause identified"`.

Always state the data source for the reasoning (endpoint + denominator) when
the cause concerns a problem.

#### 0. Known false-positive context (mute reasons as accumulated intelligence)

Before any other check, consult the project's **mute knowledge base** = the
`reason` (and `muted_since`) of every entry in `clients.yml` `muted_alerts` for
this project, plus any `Muted` row reasons read from the canvas in Step 7.
These reasons are TAM-authored domain knowledge about what is normal or
expected for this client — use them to add intelligence to the current analysis:

1. **Recurrence of a previously-muted pattern** — if the new alert shares a key
   with a muted entry's family/name but represents a *new occurrence* (e.g. the
   project's `email_delay_high` resolved earlier and now fires again on fresh
   days, or a `custom_event_rise:{name}` recurs), treat the muted reason as a
   strong prior. Example: `email_delay_high` fires on new days while a prior mute
   reason said "expected delay profile of high-volume blasts" → check whether the
   newly-confirmed days are **also** high-volume blast days (Step 3c). If yes,
   lead `possible_cause` with that pattern: `"Consistent with a previously-noted
   false-positive pattern for this client (mute reason: '{reason}'). The confirmed
   days are also ~{sends} blast days → likely the same expected transient delay.
   Source: Step 3c + clients.yml mute history."`
2. **Related metric, same root cause** — if a muted reason names a recurring
   cause (e.g. "irregular SMS activity is normal for them", "campaign-timing
   artifact from monthly blast") and the new alert is mechanically tied to that
   same behaviour, cite it as context so the TAM sees the link rather than
   re-investigating from scratch.
3. **Contradiction / escalation** — if a metric was muted as "watch only / let's
   see if it climbs" and the current value is now **materially worse** than when
   it was muted, surface that explicitly: `"Note: {key} was muted on {muted_since}
   with reason '{reason}', but the value has worsened from ~X% to Y% since — worth
   re-evaluating whether the mute still holds."` (The alert stays muted — never
   auto-post — but the worsening is flagged in the canvas/dashboard trend so a
   human can decide to unmute.)

Only use a muted reason when it is *genuinely* relevant to the current breach;
do not force a connection. When you do, name the muted key and quote its reason
so the reasoning is auditable. This check produces **context**, not a mute: a
non-muted new alert still posts to Slack — but with a smarter, history-aware
`possible_cause`.

#### 1. Cross-metric correlation (per OS)

Check whether the alert is mechanically explained by another metric on the
**same OS** (no extra API call needed):

| Alert | Correlation check |
|---|---|
| `app_opens_drop_{os}` | If triggered by cross-OS gap only → `"App opens WoW diverged: iOS {ios_delta}% vs Android {android_delta}% (gap {gap} pts > {threshold} pts threshold) — investigate platform-specific tracking, SDK, or campaign mix (source: /api/reports/opens)."` If push_sends_{os} also dropped proportionally → `"App opens drop on {os} is consistent with the -X% push send reduction on {os} (source: /api/reports/opens vs /api/reports/sends)."` |
| `timeinapp_drop_{os}` | If app_opens_{os} also dropped → engagement-wide erosion on {os}; if opens stable → deeper in-session disengagement. Cite /api/reports/timeinapp. |
| `direct_response_collapse_{os}` | **Prioritise tracking hypothesis**: `"Direct response rate on {os} collapsed from X% to Y% (direct / push sends, source /api/reports/responses) while sends stayed normal → most likely an attribution/SDK tracking issue on {os}, not a real engagement drop. Recommend checking SDK version / response tracking on {os}."` |
| `push_optouts_rise_{os}` | This alert now fires ONLY when the per-send RATE also worsened (volume-driven rises are suppressed by the gate). Cause must state both: `"Opt-outs on {os} +X% WoW AND the opt-out RATE per send rose from Y% to Z% (+P% WoW) despite sends {+/-S}% → genuine engagement/deliverability concern, not volume-driven (source: /api/reports/optouts ÷ /api/reports/sends)."` |
| `optin_optout_ratio_drop_{os}` | Opt-in/opt-out **ratio** (daily opt-ins ÷ opt-outs). Check whether the drop is driven by fewer opt-ins, more opt-outs, or both (compare both series). If push_sends_{os} or app_opens_{os} also dropped → lower opted-in-device activity on {os} alongside lower overall activity; if opens/sends are stable, suspect a registration/SDK/tracking regression or a churn event. Cite /api/reports/optins ÷ /api/reports/optouts. |
| `net_optin_negative_{os}` | Note whether driven by fewer opt-ins or more opt-outs (compare both series, source /api/reports/optins and /api/reports/optouts). |
| `email_sends_drop` | Check day-by-day: is the drop concentrated on specific days or spread evenly? |
| `email_spam_complaint_high` | High spam rate on one or more days — check whether the affected day(s)' campaigns had list-quality or consent issues. Cite spam_complaint / delivery per affected day from /api/reports/events (DAILY). Aggregate the affected days in the cause. |
| `email_delay_high` | Run **Step 3c** first (for each confirmed day, focus narrative on the peak day). Correlate hourly delay peaks with large email blasts (`responses/list` + `events/summary/perpush`). Provider throttling/reputation if no large campaign matches. Cause aggregates all confirmed days (count, range, peak rate + date). |
| `web_sends_drop` | If push_sends also dropped → note correlation; if push stable → flag as specific to web channel. Check if web.unique_devices also dropped (source: /api/reports/devices). |
| `sms_sends_drop` | Check day-by-day series for gaps (no sends on a given day = no campaign). If sms.unique_devices also dropped → audience erosion. Source: /api/reports/sends field "sms". |
| `sms_sends_rise` | Unexpected spike — check day-by-day for concentration on a single day (bulk campaign or test blast). Source: /api/reports/sends field "sms". |
| `sms_delivery_rate_low` | High `failed` + `expired` counts vs `dispatched` → carrier/network issues or invalid MSISDNs. `failed` + `expired` / `dispatched` cited. Source: /api/reports/events SMS Delivery Report events. |
| `sms_delivery_rate_drop` | WoW degradation of delivery rate — check whether `failed` or `expired` events rose. Source: /api/reports/events SMS Delivery Report events. |

#### 2. Day-by-day spike/gap detection

Scan the 14-day daily series already fetched (sends, opens, per OS) for the
relevant metric. Identify:

- **Missing days**: any day with 0 or near-0 sends in the current window
  that had normal volume in the previous window → `"No sends on {date}
  (previous equivalent day: {value}). Likely no campaign scheduled."`
- **Single-day spike in previous window**: if one day in the previous
  window accounts for > 40% of the 7-day total, the WoW comparison is
  skewed → `"Previous window inflated by a large send on {date} ({value}).
  Comparison may overstate the drop."`
- **Trend**: if the drop is gradual across all 7 days vs concentrated in
  1–2 days, note it.

#### 3. Top-campaign identification (push alerts and email delay alerts)

**Push alerts** — use `/api/reports/responses/list` (paginate as needed) to identify,
for each window, the **top 3 pushes by sends** (iOS/Android/web). Compare:

- If a recurring large campaign (similar `group_id` or send pattern)
  is present in the previous window but absent in the current →
  `"A large recurring campaign (~{sends} sends) present in the previous
  period was not sent in the current period."`
- If a new large campaign appeared in the current window → note it as
  context (may explain an unrelated rise).

Limit to pushes with `sends > 100,000` to avoid noise from small
targeted pushes.

**Email delay alerts** — use the output of **Step 3c** (`delay_hourly_breakdown` +
`delay_campaign_correlation`). Do not re-fetch; incorporate the hourly table and
top campaigns into `possible_cause`.

#### 4. External context search (best-effort)

Use `brand_name` (or `client_name` if not set) for all web searches —
**never use the internal MCP server name** (e.g. search for the client's
public brand name, not their Airship project shorthand).

Perform web searches to find recent news that could explain the variation:
- `"{brand_name}" mobile app news {month} {year}`
- `"{brand_name}" push notification issue {month} {year}`
- `"{brand_name}" outage incident {month} {year}` (if sudden drop)

Extract up to 2 relevant headlines or events. If nothing relevant is
found, skip this check silently.

Possible causes to flag:
- App store outage or OS update affecting push delivery on one OS
- Major news event driving unusual app opens (spike in previous window)
- Client-side campaign pause or scheduling issue
- SDK/tracking regression on one OS (direct response collapse)
- Public incident (app crash, data breach, store removal) that may have
  driven opt-outs or opens drop
- Seasonal event or product launch that drove a spike in the previous window

#### 5. Hypothesis output format

For each triggered alert, produce:

```
possible_cause: "Short plain-language hypothesis (1–2 sentences).
  Source: [endpoint(s) + denominator | cross-metric | day analysis | campaign data | web search | none]"
```

Example outputs:
- `"App opens drop on iOS is consistent with the -38% push send reduction on iOS. No sends on Jun 17 (previous Jun 10: 671K). Source: /api/reports/opens vs /api/reports/sends + day analysis"`
- `"Direct response rate on Android collapsed 4.1% → 0.2% (direct / push sends) while sends were normal → likely attribution/SDK tracking issue on Android. Source: /api/reports/responses ÷ /api/reports/sends"`
- `"Email delay rate on 2026-06-23 was 6.8% (delay/delivery). Hourly peak 10–11 local / 08–09 UTC at 9.2% aligned with campaign « Newsletter » (78K sends, push_time 09:55 local / 07:55 UTC). Source: Step 3c hourly + responses/list + events/summary/perpush"`
- `"No clear cause identified from available data. Recommend checking campaign calendar."`

### Step 9 — Classify & reconcile (dashboard-first)

**Skip Steps 9 and 10 entirely on a `canvas-only` run** — that scope posts
nothing to Slack except the canvas update (Step 11). Still compute the Step 8/8a
state so the canvas "Open Alerts" table is accurate.

> **Alerts no longer post to Slack on every run.** Daily new-alert and resolution
> posts are **removed** (see Step 10). All alert tracking now lives in the
> per-project **canvas Open Alerts table** (confirmed alerts, with the Step 8a
> `Status`) **plus the local dashboard** (candidates with their streak, confirmed
> alerts with context, and a recently-resolved log). Slack stays quiet except for
> a rare, throttled **critical escalation** (Step 10) and the **weekly recap**
> (Step 10b).

First build the **mute set** = `clients.yml` `muted_alerts` ∪ any canvas rows
already marked `Status = Muted` (Step 7). Then reconcile the Step 8a outputs
against the **open alerts list** read from the canvas in Step 7:

- **Muted** (key matches the mute set — exact key OR family, the part before
  `:`) → **evaluate first**: never a candidate/confirmed/escalated. Record it on
  the canvas with `Status = 🔕 Muted`, its reason, and `last_seen` updated;
  exclude it from any "worst severity". A muted key is never posted or escalated.
- **Candidate** (`candidate_alerts`) → record on the canvas with
  `Status = 🟠 Candidate {streak}/{N}` and surface it in the dashboard
  `candidatesList` (Step 13). **Never posted to Slack.**
- **Confirmed — new** (`confirmed_new`) → canvas `Status = Active`,
  `Opened = today`; run Step 8b (root cause); surface in the dashboard
  `alertsList`. Eligible for a **critical escalation** only if it also passes the
  Step 10 gate. No ordinary Slack post.
- **Confirmed — ongoing** (`confirmed_ongoing`) → update `last_seen`; keep
  `Status = Active` (or `Active · clearing {k}/{M}` while inside the resolve
  hysteresis). No repeat post.
- **Resolved** (`resolved_alerts`) → remove from the canvas Open Alerts table and
  move it to the dashboard `resolvedRecently` log (Step 13). **No Slack
  resolution post** — the channel stays quiet.

### Step 10 — Critical escalation (throttled, rare)

**Skipped on `canvas-only` runs** (see Step 9). Daily new-alert and resolution
posts are **retired** — the channel no longer gets a message on every run. The
**only** per-run Slack post is a rare, throttled **critical escalation** for a
sustained, confirmed, critical alert. Everything else lives in the per-project
canvas Open Alerts table (Step 11) and the local dashboard (Step 13). The weekly
recap is a separate, lighter post (Step 10b).

All escalation text is in **English** (labels, possible-cause, footnotes).
`{canvas_url}` — computed at run start (see **Slack canvas link** above). Example:
`https://urbanairship.slack.com/docs/T025Q1VP7/F0XXXXXXXXX`

#### Escalation gate (ALL must hold)

Add an alert key to `escalations_to_post` only when **every** condition holds:

1. The key is **confirmed** (Step 8a) — never a candidate.
2. Its severity is **critical** (🔴 / `danger`).
3. It is **sustained**: `streak >= alert_escalate_runs` (default 3 breaching runs).
4. It is **not muted**.
5. **Throttle**: no escalation for this key in the last `escalate_throttle_days`
   (default 7). The last escalation date is stored in the canvas Open Alerts
   `Status` cell as a `· escalated {YYYY-MM-DD}` suffix (**no new column**); parse
   it from the Step 7 read and skip if `today − last_escalated < escalate_throttle_days`.

If `escalations_to_post` is empty, **post nothing this run.** When you do post,
append `· escalated {today}` to each escalated key's canvas `Status` (Step 11) so
the throttle holds on the next run.

Use `slack_send_message` to the channel ID resolved at run start (see **Slack
channel** above).
**Important:** the Slack MCP requires the `message` parameter (not `text`) —
always pass `message: "..."` or the call will silently return `no_text`
without posting.

```
🔴 KPI Escalation — {Client name} — {current_window_start} → {current_window_end}
_Critical alert confirmed and sustained ≥ {alert_escalate_runs} runs. Full alert tracking (candidates, history, resolutions) lives in the [📊 KPI Canvas]({canvas_url}) and the local dashboard._

**{Section}** _(source: {endpoint})_
| Metric              | OS       | Prev 7d          | Last 7d          | Δ                |
|---------------------|----------|------------------|------------------|------------------|
| {kpi_label}         | {os}     | {prev_value}     | {curr_value}     | {delta_str}      |

> 🔍 **Possible cause:** {possible_cause}

_(Source: Airship Reports API · [📊 KPI Canvas]({canvas_url}))_
```

Include only **escalated** KPIs grouped by section (App, Engagement, Mobile Push,
Acquisition, Email, Web Push, SMS, Devices, Custom Events). Do not include
passing or non-escalated KPIs. **Each section header must name its source
endpoint**, and each metric row must show the OS / channel it concerns.

Each escalated KPI section must be followed by its `> 🔍 Possible cause:`
line. If multiple alerts share the same root cause, merge them into one
cause line at the bottom of the message. If no cause was identified, write:
`> 🔍 Possible cause: No clear cause identified from available data. Recommend checking campaign calendar.`

**Labeling rules (mandatory):**

- Always show the **OS** for app/push/engagement/acquisition KPIs. When a
  metric is breached on one OS only, show that OS row plus the other OS for
  context.

- Push opt-outs must appear as **"Push opt-outs (vs sends)"** — never just
  "Opt-outs". Always show both the raw count AND the opt-out rate per send on
  the same row:

  ```
  | Push opt-outs (vs sends) | iOS | 1.68M (7.7%) | 2.44M (5.7%) | ⬆️ +45% raw / ⬇️ -2.1 pts rate |
  ```

  Add a footnote line under the table when the raw count rose but the rate
  *improved*:
  `> ℹ️ Raw count increase is volume-driven (push sends also +98%); opt-out rate per send improved.`

- Direct response must appear as **"Click rate (vs sends)"** (direct responses =
  push clicks) with the denominator and source stated. When a collapse fires, add
  the explicit tracking caveat:
  `> ⚠️ Likely a tracking/SDK issue on {os}, not a real engagement drop (direct / push sends, source /api/reports/responses).`

- Time in app must appear as **"Avg time in app /day"** with OS and source
  `/api/reports/timeinapp`.

- Opt-ins must appear as **"New opt-ins"** and, when relevant, the net balance
  as **"Net opt-in (opt-ins − opt-outs)"**, citing `/api/reports/optins` and
  `/api/reports/optouts`.

- Email unsubscribes (tracked under **Email**, not Push) must appear as
  **"Email unsubscribes (vs delivered)"** and show the rate = unsubscribes /
  delivered * 100.

- Email open rate must appear as **"Email open rate (vs delivered)"** — the
  denominator is delivered, not injected, not total sends.

- Email deliverability must appear as **"Email deliverability (delivery / injection)"**.

- Email bounce rate must appear as **"Email bounce rate (vs injection)"**.

- Email spam complaint rate must appear as **"Spam complaint rate (vs delivered/day)"**
  with the date, raw counts (`spam_complaint` / `delivery`), and source
  `/api/reports/events` (DAILY).

- Email delay rate must appear as **"Delay rate (vs delivered/day)"** with the
  date, raw counts (`delay` / `delivery`), and source `/api/reports/events`
  (DAILY).

  **When `email_delay_high` is escalated (or in the canvas Alert analysis)**,
  append the Step 3c drill-down
  **below** the `possible_cause` line (mandatory). Lead with the **peak confirmed
  day**; if several days are confirmed, list the others compactly (date · delay %)
  under the table rather than repeating a full breakdown per day:

  ```
  **Hourly breakdown — {peak_date}** _(source: /api/reports/events · HOURLY; hours in local {time_zone})_
  | Hour (local · {time_zone}) | Email sends | Injection | Delivered | Delay | Delay % |
  |---|---:|---:|---:|---:|---:|
  | 07:00 | … | … | … | … | … % |
  | … | (all hours 00–23 local; flag ⚠️ on hours where delay % > email_delay_rate_max) | | | | |

  **Likely campaigns on {date}** _(source: /api/reports/responses/list · events/summary/perpush)_
  | Send time (local · {time_zone}) | Campaign | Sends | Delay | Delay % |
  |---|---|---:|---:|---:|
  | … | message_name | … | … | … % |

  _(If no campaign ≥ min_email_campaign_sends: write "No large blast identified —
  delays may be provider-wide or transactional.")_
  ```

- SMS sends must appear as **"SMS sends"** with the WoW delta and source
  `/api/reports/sends field "sms"`.

- SMS delivery rate must appear as **"SMS delivery rate (delivered/dispatched)"**
  and always show `delivered` count, `dispatched` count, `failed + expired`
  count, and the rate. Source: `/api/reports/events` (SMS Delivery Report).

- Web push sends must appear as **"Web push sends"** with source
  `/api/reports/sends field "web"`.

#### No resolution posts

Resolutions are **not** posted to Slack any more. A resolved alert is removed from
the canvas Open Alerts table and logged in the dashboard `resolvedRecently` list
(Step 13). If a TAM wants a heads-up that things recovered, it shows in the weekly
recap (Step 10b) and the local dashboard — not as a channel message.

### Step 10b — Weekly recap (light, activity-focused)

Purpose: a single friendly weekly Slack post celebrating **last week's activity** —
the opposite of an alert. It replaces channel clutter with one useful summary.

**Skipped on `canvas-only` runs** (that scope posts nothing to Slack).

**Cadence & throttle.** Post at most **once per 7 days**. Read the
`_Recap posted: {date}_` marker from the canvas footer (Step 7); post only if the
marker is absent or `today − last_recap >= 7 days`. After posting, set the marker
to `today` (Step 11). This aligns naturally with the weekly-insights cadence but is
tracked independently so the two can drift without double-posting.

**Scope — one-shot + unicast only.** Highlight deliberate, notable sends:
**one-shot campaigns (`type=PUSH`) and the unicast/transactional aggregate**.
**Exclude** recurring/automation (`type=GROUP`) — background journeys don't belong
in a highlights post.

**Data (reuse what Step 7b already fetched — minimal new calls):**
- **Top one-shots, grouped by channel:** take the ranked `one_shot` entries from
  7b.3 and bucket them by their **7b.6-detected channel** (push / email / message
  center / SMS). Within each channel present, keep the **top ~3 by delivery**.
  **Skip any channel with no one-shot campaign** in the window — never invent an
  empty section. Email one-shots that show `delivery.app=0` in the activity log
  are still included when step **2b** confirms them via
  `events/summary/perpush`. If a channel truly has no qualifying one-shots after
  that probe (and pagination was not truncated), say so rather than implying it
  was idle.
- **Per-campaign volume + engagement + benchmark:** reuse the **7b.3 step 8**
  figures already computed for each shortlisted one-shot — `sends`/`delivery`, the
  channel-appropriate engagement rate (push/in-app direct open %, email open/click
  %, MC read rate when resolvable, SMS often none). For engagement context:
  - **Push / in-app:** the **direct-open benchmark band** vs the vertical (Step
    7b.2), as before.
  - **Email:** there is **no Airship email benchmark**, so compare each email to
    **the client's own emails** instead — the **internal email baseline**
    (`client_email_open_rate` / `client_email_click_rate`, defined in 7b.3 §8).
    Show the campaign's open/click **vs that average** as a signed delta in points
    with an arrow (▲ above / ▼ below the client's own average).
  - **Message center:** when a **read rate** is resolvable, compare it to the
    vertical **`message_center_read_rate`** band (7b.2); otherwise volume only →
    engagement `n/a`.
  - **SMS:** usually volume only → engagement `n/a` (no Airship benchmark).
  Follow the honesty rules: below-floor delivery → rate `n/s` and no comparison;
  missing metric → `n/a`. Show at most **one extra data line per campaign**; omit
  fields that are n/a.
- **Content preview (text only — no images in Slack):** for each top one-shot, run
  the **7b.6 extractor** on its cached pushbody → `title` + `snippet` (and, for
  email, the `subject`). **Do not post image URLs** in the Slack recap — hero-image
  links clutter the post and hurt readability. Instead show the **message wording**
  as a Slack **blockquote** (`>`) so it reads like the real message: push quotes the
  *title + body*, email quotes the *subject*, SMS the message, message center the
  *title + body*.
- **Per-channel synthesis (the point of the recap).** After listing a channel's
  messages, add **one channel-level synthesis** — not per message — with three short
  labelled lines so the reader goes from *what was sent* to *so what*:
  - 🎯 **Bench** — **always present** where the channel's campaigns sit vs their
    reference: push = the vertical **direct-open band** (with a small `▰▱▱▱▱` gauge
    + Low/Med/High); message center = the vertical **`message_center_read_rate` band**
    (same gauge) when a read rate is resolvable, else "no data"; email = the
    **internal** comparison to the client's own average (7b.3 §8); SMS = "no
    benchmark". 1–2 sentences explaining the read (e.g. live-alert
    direct taps low but influenced open strong; big blast dilutes open but keeps the
    best CTR). Cap at **Medium confidence**.
  - 💡 **Reco** — **one** concrete, numbers-grounded action (e.g. replicate the
    winning subject, add an explicit CTA, segment the low-open blast). Never generic
    filler; omit if nothing honest to say.
  - 🧭 **Context** — best-effort brand/activity context for these messages (reuse
    7b.5 names/categories + optional web check), clearly flagged best-effort.
- **Unicast:** reuse the 7b.4 aggregate estimate — **one line**, never a per-message
  list (unicast bodies are empty / not retrievable).
- **In-app activity — aggregated block only.** No Airship API lists scenes by
  impressions, so do **not** attempt a per-scene breakdown. From the
  `events_current` / `events_previous` payloads already fetched in Step 2 (which
  Step 2 *discards* for email/custom purposes but which still contain them), sum
  the events with `location ∈ {in_app_message, in_app_pager}` for each 7-day
  window and show the **week-over-week** total. That is the whole in-app section.

**Message format (markdown — no images, no file upload).** Make it **airy and
visual**: one **`### {emoji} {Channel}`** section per channel, each listing its
messages, then the **channel-level synthesis** (Bench → Reco → Context). Separate
sections with `---` dividers. Use the markdown the Slack MCP renders: `##`/`###`
headers, `>` **blockquotes** for message wording, `` `code` `` for volume + the
`▰▱▱▱▱` gauge, **bold**, and dividers. Per channel the flow is **messages + wording
→ performance → benchmark analysis → recommendation → context**.

```
## 📊 Weekly Recap — {Client name}
🗓️ **{current_window_start} → {current_window_end}** · one-shot campaigns, by channel

---

### 📣 Push — {n} messages · {Σ delivery} delivered

**{emoji} {short title}** · {date}
> {message wording — title + body, plain text}

`{delivery} delivered` · direct open **{direct_open}%**

_(repeat per message — top ~3 by delivery. Below the volume floor → "direct open n/s".)_

🎯 **Bench** · {vertical} {os} → `▰▱▱▱▱` **{Low/Med/High}** _(p10 {p10}% · p50 {p50}%)_
{1–2 sentences: where these sit vs the band and why (e.g. live-alert direct taps low,
 influenced open strong).}

💡 **Reco** · {one concrete, numbers-grounded action.}

🧭 **Context** · {best-effort brand/activity context — Medium confidence.}

---

### ✉️ Email — {n} messages · {Σ sends} sent · client avg {client_avg}% open

**{emoji} {short subject}** · {date}
> {email subject}

`{sends} sent` · open **{open_rate}%** · click {click_rate}% · vs client `{▲/▼}{Δ} pts` {🟢/🟡/🔴}

_(repeat per message)_

🎯 **Bench** · no Airship email benchmark → **internal** (client avg {client_avg}% open · {client_click_avg}% click)
{1–2 sentences comparing the emails to the client's own average / to each other.}

💡 **Reco** · {one concrete action.}

🧭 **Context** · {editorial/brand context.}

---

### 📱 In-app — {in_app_total} interactions · {wow_arrow} {wow_delta}% WoW
_in_app_message + in_app_pager · aggregate, no per-scene detail_

---

📊 **Full analysis** → [KPI Canvas]({canvas_url})
```

_(All labels and prose above are written in **English**.)_

- **Message center** follows the **same section shape** (header → per-message
  wording + volume → synthesis). When a **read rate** is resolvable, its Bench reads
  the vertical **`message_center_read_rate` band** (`▰▱▱▱▱` gauge + Low/Med/High);
  otherwise Bench reads "no data".
- **SMS** follows the same section shape but has no Airship benchmark, so Bench
  reads "no benchmark" and the synthesis is lighter (Reco/Context only when there is
  something honest to say).
- **Unicast / transactional** stays a **single line** — either under the Push
  section or its own `### 📨 Unicast` line: `≈ {unicast_estimate} sends ({share}% of
  push volume)`.
- **Gauge** `▰▱▱▱▱` = 5 blocks filled to where the rate sits in the band
  (≈ Low → 1, Med → 3, High → 5); it is a visual aid for the same band, never a new
  metric.

Skip any section with no data (no one-shots in a channel → omit that channel; no
in-app → omit that line). **Never post image URLs.** Never fabricate content: if the
extractor returns no wording, drop the `>` line rather than inventing one; omit a
Reco/Context you cannot ground. Never fabricate an engagement rate or a band — show
`n/s` below the volume floor, `n/a` when unmeasured. Push uses the vertical
direct-open band; **message center uses the vertical read-rate band** (when a read
rate is resolvable); **email uses the client's own average**; SMS shows volume only.
All prose (headers, wording labels, Bench/Reco/Context) is written in **English**.

### Step 11 — Update the canvas

Use `slack_update_canvas` (or `slack_create_canvas` if no canvas ID yet) to
maintain a **rich, synthetic, source-traceable** weekly canvas. Keep it
visual and scannable: total + per-OS detail, trend arrows, and the source
endpoint named under each section.

#### Visual design principles (exploit the canvas markdown)

The Slack canvas supports markdown tables, callouts (`::: {.callout}`), up to
3-column layouts (`::: {.layout}` / `::: {.column}`), emojis, and links — but the
Slack MCP has **no image upload**, so "more visual" means **unicode + emoji +
layout**, never PNG charts. Apply these consistently (new and existing sections):

- **Bold-summary callouts.** Open each major section with a `::: {.callout}` of
  2–3 sentences stating the essentials, with the key facts in **bold** — e.g.
  "**Opt-in iOS 38%** is **below** the Media median (49%); **app opens +12%** WoW;
  **1 recurring campaign** drifting on volume." This is the readability win the
  reference `airship-engagement-review` skill relies on.
- **Status pills** in the first column of tables (🟢 ok / 🟡 watch / 🔴 critical)
  instead of long words; homogeneous Δ arrows (⬆︎/⬇︎) elsewhere.
- **Sparklines** (unicode `▁▂▃▄▅▆▇█`) for trends, **gauges** (`███▓░░`) for a
  position-vs-benchmark bar, **dots/pills** (🟢🟡🔴) for status.
- **Columns** (`::: {.layout}` → `::: {.column}`, max 3) for KPI cards side by
  side; format numbers (k/M, %, one decimal) and use `<br>` for multi-line cells.
- **Canvas limitation:** do **not** put tables or callouts *inside* a layout —
  cards inside columns are text + sparkline only; keep tables outside layouts.

To build a sparkline from a numeric series, map each value to a block by its
rank between the series min and max (`▁`=min … `█`=max). For a gauge, fill
`█` proportionally to where the client value sits in the `[p10–p90]` band, pad
with `░` (e.g. value at p50 → about half filled).

#### Canvas update procedure (MANDATORY — preserves history)

**Do NOT call `slack_update_canvas` with `action=replace` and no `section_id`.**
That would overwrite the entire canvas and destroy the Devices History table
(which is the persistent memory used for D-7 comparisons).

Instead, follow this section-by-section workflow every run:

1. **`slack_read_canvas(canvas_id)`** — already done in Step 7. Reuse the
   `section_id_mapping` returned. Each section header (`##`, `###`) and
   content block has its own `section_id`.

2. **Update each section individually** using
   `slack_update_canvas(canvas_id, action="replace", section_id=<id>, content=<new_content>)`:

   | Section to update | How |
   |---|---|
   | `_Last run:` line | `replace` the paragraph section_id with the new date line |
   | `## 🚨 Open Alerts` | `replace` with the refreshed **verbose** alerts table **plus** the per-alert "Alert analysis" block. Lead with a 🟢/🟡/🔴 **Status** pill column. The Step 8a state is carried in the existing `Status` cell (no new columns): `🟠 Candidate {streak}/{N}` for candidates, `Active` for confirmed, `Active · clearing {k}/{M}` while resolving, `🔕 Muted` for mutes, and a `· escalated {date}` suffix when Step 10 escalated the key (the throttle marker). Carry `🔕 Muted` and candidate rows over; never drop a muted key just because it's silent. |
   | `## 🧭 Executive recap` | **weekly insights** — `replace` with the rebuilt narrative callout (project health + activity read + best-effort brand-activity link). Only when `run_weekly_insights` (Step 0); otherwise leave untouched. |
   | `## 🌍 Global snapshot & benchmark` | **weekly insights** — `replace` with the rebuilt global opt-in/devices snapshot + benchmark table. Only when `run_weekly_insights`. |
   | `## 📈 3-month trend` | **weekly insights** — `replace` with the rebuilt sparkline cards + monthly table (app opens, sends per platform, marketing pressure, opt-in rate, time-in-app). Only when `run_weekly_insights`. |
   | `## 🏆 Top campaigns — last 30 days` | **weekly insights** — `replace` with the rebuilt rankings **by type** (one-shot / recurring / experiment) **and platform**. Only when `run_weekly_insights`. |
   | `## 📨 Unicast / transactional` | **weekly insights** — `replace` with the unicast aggregate estimate. Only when `run_weekly_insights`. |
   | `## 📱 Installed base` | `replace` the section with today's snapshot table |
   | `## 📈 Devices history` | `prepend` a new row at the top of the table — **never replace the full table** |
   | `## 📧 Email deliverability health — last 30 days` | `prepend` new daily row(s) from Step 3b — **never replace the full table** unless trimming to 30 rows |
   | `_Insights refreshed: {date}_` footer marker | when `run_weekly_insights`, `replace` it with today's date (this is the gate marker read in Step 0). Leave it untouched otherwise. |
   | `_Recap posted: {date}_` footer marker | when a weekly recap was posted this run (Step 10b), `replace` it with today's date (the recap throttle marker). Leave it untouched otherwise. |

   **Weekly-insight sections** (`🧭 Executive recap`, `🌍 Global snapshot &
   benchmark`, `📈 3-month trend`, `🏆 Top campaigns`, `📨 Unicast /
   transactional`) are only rebuilt when `run_weekly_insights` is true (weekly
   cadence, or forced by `canvas-only`). On a daily run that skips Step 7b, leave
   them **exactly as they are** and do not touch the `_Insights refreshed:_`
   marker. If a weekly-insight section is **missing** on a run where
   `run_weekly_insights` is true, create it (insert in the order above, after Open
   Alerts) rather than replacing. The **week-over-week tables are gone** — the
   canvas is global + 3-month-trend only; WoW lives in the alert engine (Step 8).

3. **Devices History — prepend only:**
   - Identify the `section_id` of the `## 📈 Devices history` header or its table.
   - Use `action="prepend"` on that section to insert the new row at the top.
   - This preserves all existing rows (up to 30; trim the oldest row if the
     table already has 30 rows by replacing the full section at that point only).

4. **Email deliverability health history — prepend only:**
   - Same rules as Devices History: prepend rows for each day in Step 3b not
     already in the canvas table; update in place if the date exists.
   - Keep last **30 rows** max (trim oldest when exceeded).

5. **First run (no canvas ID):**
   - Call `slack_create_canvas` with the full initial content below.
   - Return the canvas ID **and** the full `canvas_url` so the TAM can copy both
     into the automation prompt (or `clients.yml`).
   - On the very next run, the section-by-section workflow applies.

Canvas format (used for first-run creation and as section content reference):

```
# KPI Monitor — {Client name}
_Last run: {today} · Insights: 3 months / last 30 days · Alerts: rolling 7-day (internal)_

## 🚨 Open Alerts

::: {.callout}
📌 **Priority focus.** {1–2 sentences naming the most severe open alert(s) in
**bold**, the OS, and how long they've been open — or "**All clear** — no open
alerts this week." when there are none.}
:::

| S | Alert key | OS | Opened | Last seen | Status | Possible cause |
|---|---|---|---|---|---|---|
| 🔴 | push_sends_drop_ios | iOS | 2026-06-15 | 2026-06-22 | Active | No campaign Jun 17 |
| 🔕 | push_sends_drop_android | Android | 2026-06-15 | 2026-06-22 | 🔕 Muted | Campaign-timing artifact (false positive) |
| 🟡 | email_delay_high | — | 2026-06-22 | 2026-06-28 | Active | 6 days confirmed (Jun 22–28), peak 98.5% on Jun 22 — Jun 20–21 bulk backlog + Jun 26 blast throttling (one alert per project; per-day detail in Email health history) |

_(Status pill **S**: 🔴 critical · 🟡 watch · 🟢 ok · 🔕 muted. Map severity →
pill: danger=🔴, warning=🟡, info/ok=🟢, muted=🔕.)_
_(No open alerts → write "No open alerts this week." and set the callout to "All clear".)_
_(**Status**: `Active` or `🔕 Muted`. A TAM can mute a false positive by setting
this cell to `Muted` — the skill reads it next run, stops posting it to Slack,
and syncs it into `clients.yml` `muted_alerts`. See **Muting false positives**.
Muted rows stay listed but are never re-posted and don't count toward severity.)_

**Alert analysis** _(one bullet per active, non-muted alert — verbose)_
- 🔴 **{alert_key}** ({OS}, open since {opened}) — {2–3 sentences: what moved and
  by how much vs the prior 7-day window (cite metric + denominator), the most
  likely **cause(s)** (campaign gap, SDK/tracking, deliverability, seasonality…),
  and a **suggested check**.}
- 🟡 **{alert_key}** (open since {opened}) — {same structure}.

_(No active alerts → "No active alerts to analyse." Skip muted rows here. Keep
each bullet specific and data-grounded; this verbose tracking replaces the old
week-over-week tables.)_

## 🧭 Executive recap  _(weekly · synthesis of alerts + trend + campaigns + brand activity)_

::: {.callout}
🧭 **Read of the project.** {3–6 sentences, key numbers in **bold**: overall
health (alerts, opt-in/devices direction, benchmark position, marketing-pressure
direction); what the project has been **doing** (top campaign **names** /
**categories** from below); and a best-effort **link to the brand's activity /
news** that could explain the period — clearly flagged "**contextual —
best-effort**" and capped at Medium confidence.}
:::

_(Weekly section. Separate measured data from inferred context. Never fail the run
if the web lookup is unavailable — drop the brand-activity sentence cleanly.)_

## 🌍 Global snapshot & benchmark  _(weekly · source: /api/reports/devices, /responses + benchmarks/benchmarks.json)_

::: {.callout}
🌍 **Where the project stands.** {2–3 sentences in **bold**: total opted-in base,
opt-in rate per OS, and position vs the {industry} median — e.g. "**Opt-in iOS
38%** sits **below** the Media median (49%); **direct open rate** is **above** p90
on Android." Compare per device family, never blended.}
:::

| OS | Opted-in | Opt-in rate | Δ 30d | Benchmark p50 | Band |
|---|---|---|---|---|---|
| iOS | … | … % | ⬆︎/⬇︎ … pts | … % | `███▓░` High/Med/Low |
| Android | … | … % | … | … % | … |
| Web | … | … % | … | … % | … |

| S | Benchmark metric | OS | Client | Median p50 | Range p10–p90 | Gap | Band |
|---|---|---|---|---|---|---|---|
| 🟢 | Push opt-in rate | iOS | … % | … % | …–… % | +… pts | `███▓░` High |
| 🔴 | Push opt-in rate | Android | … % | … % | …–… % | −… pts | `█░░░░` Low |
| 🟡 | Direct open rate | iOS | … % | … % | …–… % | ≈ p50 | `███░░` Med |
| 🟡 | Influenced open rate | iOS | … % | … % | …–… % | … | `███░░` Med |
| 🟡 | Push sends/user/month | iOS | … | … | …–… | ×… | `███░░` Med |

_(Band: 🔴 Low ≤ p10 · 🟡 Medium ≈ p50 · 🟢 High ≥ p90. Cite Airship UA Benchmarks
{quarter} · {region}. If the industry has no benchmark, write "industry benchmark
not available". Show "n/a" for any metric/OS with no benchmark entry — never
invent. Benchmark reads are **Medium confidence** at most. Weekly section.)_

## 📈 3-month trend  _(weekly · source: /api/reports/opens, /sends, /optins, /devices, /timeinapp)_

::: {.callout}
📈 **3-month read.** {2–3 sentences in **bold**: the dominant trends — app opens,
sends per platform, marketing pressure, opt-in rate, time-in-app. Separate
**period** metrics (opens/sends/opt-ins — summed) from **average/snapshot**
metrics (opt-in rate, time-in-app).}
:::

::: {.layout}
::: {.column}
**App opens** (13 wk)<br>**{latest}**<br>`{sparkline}`
:::
::: {.column}
**Push sends** (13 wk)<br>**{latest}**<br>`{sparkline}`
:::
::: {.column}
**Opt-in rate** (snapshot)<br>**{latest}%**<br>`{sparkline}`
:::
:::

::: {.layout}
::: {.column}
**Mktg pressure** (push/opted-in)<br>**{latest}**<br>`{sparkline}`
:::
::: {.column}
**Time in app** /day (iOS·And)<br>**{ios} · {and}**<br>`{sparkline}`
:::
::: {.column}
**Email · SMS · Web** sends<br>**{e} · {s} · {w}**<br>`{sparkline}`
:::
:::

| Month | App opens | Push sends | Email | SMS | New opt-ins | Opt-in rate (end) | Mktg pressure | Time in app (iOS/And) |
|---|---|---|---|---|---|---|---|---|
| {M-2} | … | … | … | … | … | … % | … | … / … |
| {M-1} | … | … | … | … | … | … % | … | … / … |
| {M-0} | … | … | … | … | … | … % | … | … / … |

_(Sends split per platform; push = iOS+Android. Marketing pressure = push sends /
opted-in (proxy). Time-in-app is an average (MONTHLY) — never summed. Omit
Email/SMS/Web columns the project never uses. Weekly section.)_

## 🏆 Top campaigns — last 30 days  _(weekly · source: /api/reports/activity/details, /events/summary/perpush, /perpush/detail, /perpush/pushbody)_

::: {.callout}
🏆 **Highlights.** {2–3 sentences in **bold**: the single biggest campaign and its
**category**, the mix of one-shot vs recurring vs experiment, any recurring series
flagged for **volume drift**, and (best-effort) how the top sends map to the
**brand's activity**.}
:::

**One-shot** _(type=PUSH)_
| Message name | Category | Platform | Date | Sends | Delivery | Direct open | Bench |
|---|---|---|---|---|---|---|---|
| {name} | {category} | iOS+And | {date} | … | … | … % | `███▓░` 🟢 High |
| {name} | {category} | Email | {date} | … | … | open … % · click … % | ▲ +… pts vs client avg |
| {name} | {category} | MC | {date} | … | … | read … % | `██▓░░` 🟡 Medium |
| {name} | {category} | SMS | {date} | … | … | n/a | no benchmark |

**Recurring / automation** _(type=GROUP)_
| Message name | Category | Platform | Occurrences | Sends (Σ) | Vol. drift |
|---|---|---|---|---|---|
| {name} | {category} | iOS+And | … | … | ⬆︎ +…% |

**Experiments** _(A/B)_
| Message name | Platform | Date | Sends | Winner / read |
|---|---|---|---|---|
| {name} | iOS+And | {date} | … | {variant or n/s} |

_(Names + categories from pushbody metadata only — never the message body/HTML.
**Delivery** = app alerting (push) / **`delivery` from `/events/summary/perpush`**
(email); the denominator for rates. **Direct open** = `interaction.app.direct /
delivery` for push; email shows **open/click from `/events/summary/perpush`**
(mandatory — activity log and `perpush/detail` do not carry email volume).
**Bench** for **push** is a `███▓░` gauge filled to where the campaign's direct
open rate sits in the vertical's `direct_open_rate` `[p10–p90]` band
(delivery-weighted per-OS blend, Step 7b.3 §8) with a 🔴 Low ≤ p10 · 🟡 Medium ≈
p50 · 🟢 High ≥ p90 pill. **Message center** uses the same gauge against the
vertical **`message_center_read_rate`** band (vertical-only, no OS blend) when a read
rate is resolvable, else "no data". **Email** has no Airship benchmark, so its Bench
cell shows the **internal comparison** — ▲/▼ open vs the **client's own email
average** that window (`client_email_open_rate`, 7b.3 §8). Rates below the volume
floor show "n/s" (no gauge); **SMS** and verticals with no entry for the relevant
metric show "no benchmark" — never a borrowed or invented band. Exclude test sends.
Show a platform only if active. Empty-body pushes are unicast (see next section).
Weekly section.)_

## 📨 Unicast / transactional — last 30 days  _(weekly · source: /api/reports/sends − /activity/details delivery)_

::: {.callout}
📨 **1:1 stream.** {1–2 sentences in **bold**: estimated unicast/triggered volume
and its **share** of total push — e.g. "**≈ 2.1M** unicast sends (≈ 70k/day),
**62%** of push volume." Note these are API-triggered 1:1 sends excluded from the
activity log; their content is **not retrievable** (best-effort description).}
:::

_(Estimate = total push sends − Σ campaign app delivery. Describe likely nature
(transactional / event-triggered) from project context; never fabricate content.
Weekly section.)_

## 📱 Installed base — snapshot {today}  _(source: /api/reports/devices)_
| OS | Unique | Opted-in | Opted-out | Uninstalled |
|---|---|---|---|---|
| iOS | … | … | … | … |
| Android | … | … | … | … |
| Web | … | … | … | — |
| SMS | … | … | … | … |

_(Omit Web row if web.unique_devices = 0. Omit SMS row if sms.unique_devices = 0.)_

## 📈 Devices history (last 30 days)  _(source: /api/reports/devices)_
| Date | iOS unique | iOS opted-in | iOS uninstalled | Android unique | Android opted-in | Android uninstalled | Web opted-in | SMS unique | SMS opted-in |
|---|---|---|---|---|---|---|---|---|---|
| 2026-06-22 | … | … | … | … | … | … | … | … | … |

_(Omit Web opted-in column if web never active. Omit SMS columns if sms never active.)_

## 📧 Email deliverability health — last 30 days  _(source: /api/reports/events · DAILY, one row per day)_
| Date | Delivered | Delay | Delay % | Spam complaints | Spam % |
|---|---|---|---|---|---|
| 2026-06-23 | … | … | … % | … | … % |

_(Omit this section entirely if the client sends no email.)_
_(Keep last 30 rows. Prepend new days from Step 3b; do not duplicate a date already present — replace that row if re-running the same day.)_

---
_Insights refreshed: {date of the last weekly-insights rebuild}_
_Recap posted: {date of the last weekly recap Slack post}_
```

The `_Insights refreshed:_` footer is the **weekly-insights gate marker** read in
Step 0. On first-run creation, set it to `today` only if Step 7b actually ran this
run (e.g. on a `canvas-only` first build); otherwise omit it so the next run
treats the insight sections as pending and builds them.

The `_Recap posted:_` footer is the **weekly recap throttle marker** read in
Step 10b — post the recap only when it is absent or ≥ 7 days old, and update it to
`today` after posting. Omit it on first-run creation until a recap actually posts.

**Section content rules (apply when replacing each section):**
1. Open Alerts — replace with the updated table **and** the verbose **Alert
   analysis** bullets: lead with the 🔴/🟡/🟢/🔕 status pill, add new alerts, remove
   resolved, update `last_seen`, set each row's `Status` (`Active` / `🔕 Muted`),
   and write one analysis bullet per active (non-muted) alert (what moved, likely
   cause, suggested check). Refresh the **Priority focus** callout. Keep muted rows
   even though they are never posted to Slack.
2. Devices History — **prepend** new row only (never full replace unless trimming to 30 rows).
   Add SMS columns on first SMS-active run; Web opted-in column when web active.
3. Email deliverability health (last 30 days) — **prepend** daily rows from Step 3b
   (30 rows max; replace row if date already exists). This per-day table is the
   email-health view (no separate 7-day current-window table any more).
4. Installed base — replace with today's snapshot (add/remove SMS and Web rows as needed).
5. Last run line — replace the paragraph with the new date line.
6. Keep source endpoint labels under every section header.
7. **No week-over-week tables** in the canvas — that view is retired; WoW now lives
   only in the alert engine (Step 8).
8. Weekly-insight sections (`🧭 Executive recap`, `🌍 Global snapshot & benchmark`,
   `📈 3-month trend`, `🏆 Top campaigns`, `📨 Unicast / transactional`) and the
   `_Insights refreshed:_` marker — rebuild **only** when `run_weekly_insights` is
   true (Step 0 gate; forced by `canvas-only`). Otherwise leave them and the marker
   untouched. When rebuilt, set the marker to `today`. Use the visual design
   principles (callout summaries in **bold**, sparklines, gauges, columns).

**If `slack_read_canvas` fails** (canvas not found, empty, or first run):
- Fall back to `slack_create_canvas` with the full initial content
- Return the canvas ID **and** the full `canvas_url` so the TAM can copy both
  into the automation prompt (or `clients.yml`)

### Step 12 — Update the local monitoring canvas (optional, local-only)

**Skipped on `canvas-only` runs** (that scope only touches the Slack canvas)
unless the prompt added `+local`. Otherwise:

After finishing the run — in a **multi-client run, once all selected clients
have been processed**; in a single-client run, after that client — rewrite the
local Cursor canvas so the TAM has a roll-up dashboard of the latest run beside
the chat. This canvas is **local-only, gitignored, and never contains secrets**.
It is a convenience snapshot, not the source of truth: the per-project Slack KPI
canvases (Step 11) remain the live, shareable record. A canvas cannot fetch, so
the data is embedded inline and only reflects this run.

1. **Before writing**, read `~/.cursor/skills-cursor/canvas/SKILL.md` and the SDK
   declarations in `~/.cursor/skills-cursor/canvas/sdk/` for the exact components
   and theme tokens.
2. **Location**: `~/.cursor/projects/<workspace>/canvases/airship-kpi-monitor.canvas.tsx`
   (overwrite in place; this single file serves both the run dashboard and the
   setup view).
3. **Content** (run dashboard on top, setup section collapsed at the bottom):
   - **Header** with the global `run_timestamp` (date **and** time) and the run
     window.
   - **Summary stats**: clients, projects monitored, projects in alert, total
     open alerts, resolutions today.
   - **One card per client, grouped by client** (a client can own several
     projects), sorted by open-alert count. Each card holds a single merged
     table — one row per project — with: project · Slack channel · last run
     (use `run_timestamp`, with **time**, for clients processed this run) ·
     alerts (count + worst severity) · **a concise trend summary of recent
     runs** · a `Link` to that project's Slack KPI canvas.
     Color each row by its worst severity (`rowTone`). **Muted** alerts are
     excluded from the row's worst severity (so muting calms the color) but a
     muted count is still shown (e.g. `2 Critical · 1 muted`) so the false
     positive stays visible.
   - **Setup section** (collapsed): local file locations
     (`~/.cursor/mcp.json`, `clients.yml`) and the install checklist.
4. **Links must be clickable `Link` components, NOT markdown** — markdown is not
   parsed inside table cells (it renders as raw text). To avoid the browser
   redirect-tab chain that Slack web URLs trigger when clicked from the Cursor
   canvas, use **deep links that open the Slack desktop app directly**:
   - KPI canvas → `slack://file?team={slack_team_id}&id={slack_canvas_id}`
   - Slack channel → `https://{slack_workspace}.slack.com/app_redirect?channel={channel}`
   (These deep links are for the **local Cursor canvas only**. Links posted
   *inside* Slack — Steps 10/11 — keep the web `canvas_url`, which opens
   correctly in-app there.)
5. **Never embed secrets** (app keys, client IDs, client secrets). Use only
   names, channels, and canvas IDs from `clients.yml`.
6. **Write all canvas content in English** (labels, alert causes, callouts).
7. If the canvas tooling is unavailable, skip this step and log a warning — it
   never blocks the Slack alerts or per-project canvases.

> **Output language.** All generated reports — the Slack weekly recap (Step 10b),
> the canvas (Step 11), and the dashboard `trend` strings (Step 13) — are written
> in **English**. Do not localize into other languages.

### Step 13 — Update the local HTML dashboard (optional, local-only)

**Skipped on `canvas-only` runs** (unless `+local` was requested), like Step 12.

In addition to the Cursor canvas (Step 12), refresh the **browser dashboard**:
a richly-designed, dependency-free local web page a TAM can open in any browser
(double-click `index.html`) **without Cursor and without any server** — useful
for sharing the view on a teammate's machine. Run it at the **same time as Step
12** (once at the end of a multi-client run; after the client in a single-client
run).

The dashboard **app** is committed in the repo and contains **no data**:
`.cursor/skills/airship-kpi-monitor/dashboard/{index.html,styles.css,app.js,dashboard-data.sample.js,thresholds-catalog.js,serve.py,serve.command}`.
**Never edit those committed files in a run.** A run writes **only** the data
file:

> **Optional local server.** `dashboard/serve.py` (auto-started by the
> `start-dashboard.sh` hook, or launched manually via `serve.command` /
> `uv run --with ruamel.yaml serve.py`, at `http://127.0.0.1:8787`) upgrades the
> page from read-only to direct editing of `clients.yml` (mutes, per-project
> thresholds, routing CRUD). It is **localhost-only**, **never** touches secrets,
> and does **not** write `dashboard-data.js` — only this run rewrites that file.
> The data-file contract below is unchanged whether or not the server runs.

- **Write to**: `.cursor/skills/airship-kpi-monitor/dashboard/dashboard-data.js`
  (this path is **gitignored** — local only). Browsers cannot `fetch()` over
  `file://`, so the data is a JS file that assigns a global which `index.html`
  loads via a `<script>` tag.

1. **Read-merge-write history.** Before writing, read the existing
   `dashboard-data.js` if present and reuse its `history` array (and each
   project's `alertHistory`, and **each metric's `series`** — see `metrics`
   below). Append this run's point to each, keep the **last ~14** `history`
   entries and the **last ~12** points per metric `series`, then rewrite the
   whole file. If the old file is missing or unparseable, start fresh
   (fail-open). On a **weekly run** (Step 7b open), you may seed a longer
   `series` from the 3-month history already fetched instead of only appending.

2. **File shape** (exact global; values from this run and `clients.yml` —
   **no secrets**):

   ```js
   window.AIRSHIP_KPI_DATA = {
     generatedAt: "<run_timestamp>",            // date AND time, e.g. "2026-06-24 · 20:23 CEST"
     window: "<curr_start> → <curr_end> vs <prev_start> → <prev_end>",
     slackWorkspace: "<slack_workspace>",       // for channel/canvas deep links
     slackTeamId: "<slack_team_id>",
     priority: "<1–2 sentence priority focus, or omit>",
     stats: { clients, projects, projectsInAlert, openAlerts, resolutions },
     history: [ { ts: "<date>", openAlerts: <n>, projectsInAlert: <n> }, … ], // newest last, ≤14
     // Alerts that cleared the resolve hysteresis recently (Step 9). No Slack post
     // fires for these — the dashboard is where recoveries are tracked. Optional.
     resolvedRecently: [ { key: "<alert_key>", project: "<project>",
                           resolvedAt: "<YYYY-MM-DD>", cause: "<short note>" }, … ],
     clients: [
       { name: "<client>", projects: [
         { name: "<project>", channel: "<slack_channel>", canvasId: "<slack_canvas_id>",
           industry: "<benchmark vertical slug from clients.yml>",   // REQUIRED — see below
           lastRun: "<run_timestamp>",
           alerts: { count: <active count>, worstSeverity: "danger|warning|info|null", mutedCount: <n> },
           // Optional per-alert detail — enables the dashboard Mute/Unmute buttons
           // and the per-alert age graph (openedAt). CONFIRMED alerts only.
           alertsList: [ { key: "<alert_key>", severity: "danger|warning|info",
                          openedAt: "<YYYY-MM-DD first-seen date>",
                          cause: "<short cause>", muted: <true|false>, reason: "<why muted, if muted>" }, … ],
           // Candidate breaches (Step 8a) — breaching but NOT yet confirmed.
           // Dashboard-only, never posted to Slack. Shows a streak chip (streak/needed).
           candidatesList: [ { key: "<alert_key>", severity: "danger|warning|info",
                          streak: <consecutive breaching runs>, needed: <confirm_runs for this key>,
                          cause: "<short cause>" }, … ],
           // Per-KPI depth for the project detail page (Monitor → Open details).
           // One entry per evaluated metric; powers the KPI cards, headroom gauges
           // and mini-series. Optional but strongly recommended.
           // CANONICAL NAMING (see "Metric family naming" below): `key` is the KPI
           // FAMILY name (app_opens, timeinapp, optin_optout_ratio,
           // push_sends, push_pressure_per_user, optouts, direct_response_rate,
           // total_devices_evolution, devices_optin,
           // devices_uninstall, email_sends, email_deliverability, email_open_rate,
           // email_bounce, email_unsubscribe, email_spam_complaint_rate,
           // email_delay_rate, web_sends, sms_sends, sms_delivery_rate, custom_event).
           // ONE metric per family — NEVER bake the OS or direction into the key
           // (no `optouts_ios`/`time_in_app`); the per-OS split lives in the `os`
           // OBJECT below. `threshold.key` is the exact catalog key (thresholds-catalog.js).
           metrics: [ { key: "<KPI family key — see the coverage map below>", label: "<human label>",
                          group: "app|push|acquisition|email|web|sms|custom",
                          channel: "app|push|email|web|sms|custom",
                          unit: "%|pts|count|min|x",
                          current: <number>, previous: <number>,          // window totals/rates
                          deltaPct: <n|omit>, deltaPts: <n|omit>,          // WoW change (pick the one that fits the metric); omit both when not computable (e.g. device snapshot with no D-7, or a unique-devices trend with <2 stored snapshots)
                          // Per-OS split — an OBJECT (NOT a scalar, NOT baked into `key`).
                          // REQUIRED on every family that has per-OS data: app_opens,
                          // timeinapp, optin_optout_ratio, push_sends,
                          // optouts, direct_response_rate, total_devices_evolution,
                          // devices_*. The card
                          // renders the split ONLY from this object: it shows each OS's
                          // `deltaPct` chip when present, else its absolute `value`. Use
                          // `deltaPct` for WoW rate/volume KPIs (incl. rate KPIs like
                          // direct_response_rate and optin_optout_ratio — per-OS deltaPct,
                          // and the two-date device evolution families — per-OS deltaPct),
                          // `value` for device snapshots with only one dated call.
                          // Include `web` when that channel is active. Omit/null ONLY for
                          // genuinely channel-wide metrics with no OS breakdown (e.g.
                          // email/sms/web/custom).
                          os: { ios: { deltaPct: <n> | value: <n> }, android: { … }, web: { … } } | null,
                          // For opt-outs (and any raw count with a correlated ratio): the per-send RATE.
                          // The opt-out alert fires only when BOTH the raw count and this rate rise;
                          // a volume-driven rise (rate flat/down) is suppressed (Step 8a). Omit if n/a.
                          rate: { current: <n>, previous: <n>, deltaPct: <n> } | { note: "<qualitative>" } | omit,
                          note: "<one-line caption, e.g. why a rise was suppressed>" | omit,
                          analysis: "<one client-contextualized sentence: reads the value + WoW evolution, position vs benchmark when relevant, brief brand/activity context, and whether it is a concern>" | omit,
                          threshold: { key: "<threshold key>", value: <effective number>,
                                       kind: "drop|rise|floor|ceiling|gap",
                                       headroom: <number|omit>,            // distance to breach (see below); omit if not computable
                                       breaching: <true|false> },
                          status: "ok|candidate|confirmed|muted|na",       // na = below min volume
                          series: [ { t: "<YYYY-MM-DD>", v: <number> }, … ] }, … ],  // newest last, ≤12
           // Per-project threshold-tuning suggestions (see "Threshold suggestions" below).
           thresholdSuggestions: [ { key: "<threshold key>", current: <effective value>,
                          suggested: <number>, direction: "loosen|tighten",
                          basis: "volatility|false_positives|headroom",
                          rationale: "<one short sentence>", confidence: "low|med|high" }, … ],
           // Manually-watched KPIs (clients.yml `watched_alerts`) — surfaced in the
           // dashboard even without a breach. Echo the list verbatim (Watched KPIs below).
           watchedAlerts: [ { key: "<threshold key>", reason: "<why>", since: "<YYYY-MM-DD>" }, … ],
           trend: <"string" | ["bullet", "bullet", …]>, alertHistory: [ <n>, … ] }  // newest last
       ] }
     ],
     setup: {
       files: [ { label, path, note } ],          // ~/.cursor/mcp.json + clients.yml (paths only)
       checklist: [ { content, done } ]
     }
   };
   ```

   - Group `clients` by client (a client can own several projects), mirroring
     Step 12. `worstSeverity` is the most severe **non-muted** open alert on that
     project (`danger` > `warning` > `info`; `null` when none or all muted).
     `alerts.count` counts **active (non-muted)** alerts; `mutedCount` counts the
     muted ones separately so they stay visible without inflating severity.
   - **`alertsList`** (optional but recommended when there are open alerts): one
     entry per **confirmed** alert with its `key`, `severity`, short `cause`, and
     `muted` flag (+ `reason` when muted). The dashboard renders a per-alert Mute
     button (or Unmute + a "Muted" pill for already-muted ones). Muted entries are
     de-emphasised and excluded from `worstSeverity`.
   - **`candidatesList`** (optional): one entry per **candidate** breach (Step 8a —
     breaching but not yet confirmed). Include `key`, `severity`, `streak`
     (consecutive breaching runs), `needed` (`confirm_runs` for that key), and a
     short `cause`. The dashboard shows these under a "Watching · not yet confirmed"
     sub-list with a `streak/needed` chip and a `🔎 N watching` badge. Candidates
     are **never** counted in `alerts.count` and **never** posted to Slack.
   - **`metrics`** (strongly recommended): the per-KPI depth shown on the
     **project detail page** (`Monitor → Open details →`) — the centralized view of
     **every monitored KPI**, its evolution and any problem. Emit **one entry per
     monitored KPI on every channel the project actually uses — including the
     healthy ones**, not only breaching KPIs (app opens, time in app, push sends,
     opt-outs, click rate, opt-in velocity, devices, the email family, web push,
     SMS, each custom event). Coverage rules:
       - **Active channels only.** If a channel is not used by the project (e.g. no
         SMS or no web push at all — zero base/sends across the window), **omit its
         KPIs entirely** (the page hides empty channels). A channel counts as active
         when it has any device base or send volume.
       - **Healthy KPIs included.** A KPI with no alert still gets a card
         (`status: "ok"`) so the page is a complete dashboard, not just a problem
         list.
       - **Below-min-volume → `na`.** When an active-channel KPI is skipped because
         it is under its `min_*` floor, still emit it with `status: "na"` and a
         short `note` (e.g. "below the minimum-volume floor — not evaluated") so it
         is visible but clearly not assessed. Use `—`-friendly values (omit numbers
         you cannot compute).
       - **App & engagement — opt-in/opt-out ratio.** Emit the ratio KPI as **one
         card, per OS** (family key `optin_optout_ratio`, label **"Opt-in / opt-out
         ratio"**, `group: "app"`): `current`/`previous` = the window's **average
         daily ratio** with `os: { ios: { deltaPct }, android: { deltaPct } }`
         (iOS/Android only — neither `/api/reports/optins` nor `/api/reports/optouts`
         has a web/SMS series). `series` is the **daily ratio across the current
         window** (the trend itself, not a separate WoW-only figure) — omit any day
         whose opt-out count was 0 (undefined ratio) rather than inventing a spike.
         `unit: "x"`. Its `analysis` must interpret whether the ratio is above/below
         1 and its direction (> 1 = net-positive reach; < 1 = churn-dominant). This
         replaces the old standalone "Opt-in registrations" tile/family (`optins`) —
         the underlying `/api/reports/optins` / `/api/reports/optouts` fetches are
         unchanged, only their KPI-card usage moved.
       - **Push — push pressure per user per week.** Emit a `push_pressure_per_user`
         card (label **"Push pressure / user / wk"**, `group: "push"`, `unit: "x"`):
         `current`/`previous` = the latest / prior weekly value (weekly push sends
         iOS+Android ÷ opted-in devices), `threshold.key: "push_pressure_per_user_max"`
         (ceiling, informational), and `series` = the **multi-week** evolution (one
         point per ISO week). Denominator is the per-week opted-in base via
         `/api/reports/devices?date=<week end>` (Step 6); when a week's dated call is
         unavailable, fall back to the current opted-in snapshot and add a
         `note` labelling it a proxy. Omit the card only when push is not an active
         channel.
       - **Acquisition & opt-ins — total devices evolution (merged).** Emit ONE
         `total_devices_evolution` card (label **"Total devices evolution"**,
         `group: "acquisition"`, `unit: "count"` — the headline is the absolute
         device **volume**; the evolution is carried by `deltaPct`, never as the
         headline unit) that **merges** the former `installs`
         proxy and `devices_unique` trend: `current`/`previous` = the window
         end/start TOTAL unique-device counts, `deltaPct` = the two-date evolution %,
         `os: { ios: { deltaPct }, android: { deltaPct } }` (+`web`/`sms` when active),
         `threshold.key: "total_devices_evolution_drop_pct"`, and `series` = the
         window's stored daily snapshots (display only). Computed from the two dated
         `/api/reports/devices?date=` calls (Step 6) — no canvas-history dependency.
         When only ONE dated call is available, **omit**
         `deltaPct`/`threshold.headroom`/`threshold.breaching`, keep `status: "ok"`
         with the current absolute base and `note: "Evolution n/a"` — the dashboard's
         `series.length < 2` "History building…" placeholder covers a short series.
       - **Acquisition & opt-ins — opted-in / uninstalled degrade gracefully.** For
         `devices_optin`, `devices_uninstall` (`group: "acquisition"`,
         `unit: "count"` — headline is the absolute device **volume**, evolution via
         `deltaPct`, not the headline unit):
         emit the two-date evolution `deltaPct` per OS (`os: { ios: { deltaPct }, … }`)
         from the same two dated calls. **Always emit the current absolute snapshot**
         (total in `current`, per-OS in `os.{os}.value`, include `web` when active)
         with `status: "ok"` when at least the window-end call is present. When only
         one dated call is available, **omit** `deltaPct`/`threshold.headroom`/
         `threshold.breaching`, keep `threshold.key`, and add `note: "Evolution n/a"`.
         Do **not** emit these as fully `na` — a greyed card with no value is the
         reported bug.
     - **Metric family naming (canonical — no exceptions).** `metrics[].key` is the
       KPI **family** name, identical to the `KPI_META` key in `app.js` and resolving
       to the catalog thresholds. Emit **exactly one metric per family**; carry the OS
       breakdown in the `os` OBJECT, **never** in the key. Do **not** emit
       `optouts_ios`/`optouts_android`, `time_in_app`, `custom_events`,
       `email_bounce_rate`, `web_push_sends`, `email_spam_rate`, or any OS/direction
       suffix — the correct families are:
       `app_opens`, `timeinapp`, `optin_optout_ratio`, `push_sends`,
       `push_pressure_per_user`, `optouts`, `direct_response_rate`,
       `total_devices_evolution`, `devices_optin`,
       `devices_uninstall`, `email_sends`, `email_deliverability`, `email_open_rate`,
       `email_bounce`, `email_unsubscribe`, `email_spam_complaint_rate`,
       `email_delay_rate`, `web_sends`, `sms_sends`, `sms_delivery_rate`,
       `custom_event`. Each metric's `threshold.key` is the exact key from
       `dashboard/thresholds-catalog.js` (e.g. family `timeinapp` → `timeinapp_drop_pct`;
       `optouts` → `optout_rate_rise_pct`; `push_pressure_per_user` → `push_pressure_per_user_max`;
       `total_devices_evolution` → `total_devices_evolution_drop_pct`;
       `optin_optout_ratio` → `optin_optout_ratio_drop_pct`; `email_bounce` →
       `email_bounce_max`; `email_spam_complaint_rate` → `email_spam_complaint_rate_max`;
       `custom_event` → `custom_event_drop_pct`).
     - **Coverage map (catalog group → families → section).** For **every actively-used
       channel**, emit **all** its families (healthy = `status:"ok"`, below the
       `min_*` floor = `status:"na"`), each with an `os` object where noted:
       | Section (`group`) | Families to emit (per active channel) | Per-OS `os` object? |
       |---|---|---|
       | `app` | `app_opens`, `timeinapp`, `optin_optout_ratio` | yes (iOS/Android) |
       | `push` | `push_sends`, `push_pressure_per_user`, `optouts`, `direct_response_rate` | **yes for sends/opt-outs/click rate;** `push_pressure_per_user` is a per-project weekly figure (no OS object) |
       | `acquisition` | `total_devices_evolution`, `devices_optin`, `devices_uninstall` | yes (per-OS `deltaPct` from the two dated calls; `value` when only one dated call; +`web`/`sms` when active) |
       | `email` | `email_sends`, `email_deliverability`, `email_open_rate`, `email_bounce`, `email_unsubscribe`, `email_spam_complaint_rate`, `email_delay_rate` | no (channel-wide) |
       | `web` | `web_sends` | no |
       | `sms` | `sms_sends`, `sms_delivery_rate` | no |
       | `custom` | `custom_event` (one per tracked event, sharing the family) | no |
       (There is no longer a `devices` group — it was reventilated: the merged
       `total_devices_evolution` and `devices_optin`/`devices_uninstall` all sit in
       `acquisition`; the former `installs` and `devices_unique` families are gone.)
       Min-volume gates map per family: `min_push_sends`→push; `min_optin_optout_volume`→
       `optin_optout_ratio`; `min_timeinapp`→timeinapp; `min_email_sends`→email family
       (`min_email_delivery_day` gates spam/delay); `min_custom_event_count`→custom_event;
       `min_sms_sends`→sms_sends, `min_sms_dispatched`→sms_delivery_rate;
       `min_web_sends`→web_sends. `total_devices_evolution`/`devices_optin`/
       `devices_uninstall`/`push_pressure_per_user` have no min-volume gate (device
       snapshots are never volume-gated; push pressure is informational).
     For each entry: a human `label`; a `group`/`channel` so the page can bucket
     cards by channel (App & engagement, Push, Acquisition & opt-ins, Email, Web
     push, SMS, Custom events); the `current` and `previous` window values
     with the WoW change as `deltaPct` **or** `deltaPts` (points for rate metrics
     like open/delivery rate, percent for volumes); an `os` split when per-OS (else
     `null`); a `threshold` block; the confirmation `status` (`ok` / `candidate` /
     `confirmed` / `muted` / `na`); and — **always, for every KPI** — a bounded
     `series` (newest last, ≤12 points) reused/extended from the previous
     `dashboard-data.js` (seed a longer series from the 3-month history on a weekly
     run). The `series` powers the per-card history chart, so write it for healthy
     KPIs too, not only breaching ones.
     **`threshold.headroom`** is the signed distance to the breach in the metric's
     own unit — **positive = safe margin, negative = breaching** (e.g. a drop
     threshold at −100% with an actual −17.9% has headroom `82.1`; a floor metric
     3 pts above its floor has headroom `3`). The detail page draws a gauge from
     it, so keep the sign convention consistent. Omit `metrics` entirely on old
     snapshots — the page degrades to the summary it already shows.
   - **`metrics[].analysis`** (recommended): **one client-contextualized sentence
     per KPI**, in English, shown on the card under the values. It should read the
     current value and its WoW evolution, position it **vs the market/internal
     benchmark when relevant** (reuse Step 7b.2 bands for push/app KPIs), add a
     brief best-effort **brand/activity context**, and state **whether it is a
     concern** or healthy. Keep it to a single, scannable sentence — never a
     paragraph, never fabricated numbers.
     - **Cadence (cost control).** Author `analysis` with the model **only when
       `run_weekly_insights` is true** (the weekly gate, Step 0/7b). On the lighter
       daily runs, **reuse** each KPI's previous `analysis` from the existing
       `dashboard-data.js` (same read-merge-write pattern as `series`/`history`),
       refreshing only a KPI whose status changed materially (e.g. crossed into
       `candidate`/`confirmed` or resolved).
     - **Deterministic fallback.** If no prior `analysis` exists and it is not a
       weekly run, emit a short factual sentence built from the numbers you already
       have (direction + magnitude of the WoW change, and the headroom / breach
       state) so every card still carries a one-line read. The dashboard also has
       its own client-side fallback, so `analysis` may be omitted safely.
   - **`thresholdSuggestions`** (optional): skill-computed tuning hints for the
     project's thresholds. On the detail page each KPI card shows its alert
     threshold **inline** (an editable value under the headroom gauge, next to the
     live result and its trend chart) with **Set / Reset**, and — when a suggestion
     exists for that threshold — an inline **Apply** with the suggested value,
     direction, confidence and rationale. A suggestion whose threshold has no KPI
     card this run falls back to a small "Other threshold suggestions" panel. All
     edits write the same way (served mode POSTs `/api/thresholds`; `file://` copies
     a prompt). See **Threshold suggestions** below for how to derive `suggested`,
     `direction`, `basis`, `rationale`, and `confidence`.
   - **`resolvedRecently`** (optional, top-level): alerts that cleared the resolve
     hysteresis recently — `key`, `project`, `resolvedAt`, short `cause`. Rendered
     as a "✅ Recently resolved" log so recoveries stay visible without a Slack post.
   - **`openedAt`** (recommended): the date the alert **first fired** — read it
     from the `Opened` column of the per-project canvas Open Alerts table
     (Step 11). For an **aggregated** `email_delay_high` / `email_spam_complaint_high`
     (one per project), use the **earliest confirmed day still in the current
     window**. The dashboard uses `openedAt` to draw a small **age graph** (a
     horizontal duration bar) on any alert that was already present at the
     previous run — so ongoing issues read as "open for N days" rather than
     looking brand-new — and a `🆕 new` chip when the alert first fired this run
     (`openedAt` == this run's date). Omit `openedAt` only when you cannot
     determine it; the dashboard then shows no age graph.
   - **`trend` format:** for projects in **watch or alert** (`worstSeverity`
     `warning` or `danger`), write `trend` as an **array of short bullet
     strings** — one driver per line (e.g. each impacted metric, the cause, the
     expected resolution). The dashboard renders an array as a bullet list. For
     **stable** projects (no open alert) use a single plain **string** (e.g.
     `"Stable — no significant variations"`). Keep each bullet concise.
   - **`industry`** (**required** — always write it): the project's benchmark
     vertical read from `clients.yml` (default `all_verticals` when the client has
     no `industry` set). The dashboard shows it as an editable per-project chip and
     in the Setup registry; **do not omit it** — omitting makes the Setup tab fall
     back to displaying `all_verticals` for every project (the reported bug).
   - Do **not** set `isSample`. Omit fields you cannot compute rather than
     inventing values.

3. **No secrets, English only.** Use only names, channels, and canvas IDs from
   `clients.yml`. Never write app keys, client IDs, or client secrets. All strings
   (trends, priority) in English.

4. **Fail-open.** If the dashboard folder is missing or the write fails, skip
   this step and log a warning — it never blocks Slack alerts, per-project
   canvases, or Step 12.

#### Threshold suggestions (how to fill `thresholdSuggestions`)

For each project, look at the thresholds you actually evaluated and propose an
adjustment **only when the data clearly supports it** — an empty array is a valid,
common result. Never invent numbers; base every suggestion on observed behaviour
from this run's `metrics.series`, the confirmation gate (Step 8a), and the
project's mute/resolve history. Emit at most a handful per project (the noisiest
first). Each suggestion has three possible bases:

- **`volatility`** → *loosen.* When a metric's normal WoW swing (spread of its
  `series`) regularly approaches or exceeds its threshold **without a real
  incident** (breaches that stayed candidates and cleared, or resolved cleanly),
  the threshold is too tight for that project's natural noise. Suggest a looser
  value roughly at the observed swing plus a margin (e.g. typical ±6 pts → suggest
  8 pts), or alternatively a higher `alert_confirm_runs`. Confidence `med` with
  ≥6–8 `series` points, else `low`.
- **`false_positives`** → *loosen.* When a key has been **muted** as a declared
  false positive, or has repeatedly gone candidate→cleared / confirmed→resolved
  in a few runs with no operational impact, suggest loosening it (or raising its
  confirm-runs). Confidence scales with how many times it recurred.
- **`headroom`** → *tighten.* When a metric sits **chronically very far** from its
  threshold across the whole `series` and has never come close to breaching, the
  threshold may be too loose to ever catch a real regression. Suggest a tighter
  value closer to the observed range. Always **low** confidence — tightening risks
  new noise, so it is advisory only.

Output per suggestion: `key`, the `current` effective value (default or the
project's `custom_thresholds` override), the `suggested` value, `direction`
(`loosen`/`tighten`), `basis`, a one-sentence `rationale` naming the evidence, and
`confidence` (`low`/`med`/`high`). Applying a suggestion just writes the project's
`custom_thresholds[key]` in `clients.yml` — the same field the detail page's
Apply/Edit and the served `/api/thresholds` endpoint already manage. No new
config or `serve.py` change is required.

**Dismissed suggestions (honour `dismissed_suggestions`).** Before emitting
`thresholdSuggestions[]`, read the project's `clients.yml` `dismissed_suggestions`
list (threshold keys a TAM dismissed from the dashboard — via the served
`/api/dismiss-suggestion` endpoint or the `file://` copy-prompt) and **drop any
suggestion whose `key` is in that list**. Do **not** re-emit a dismissed
suggestion on subsequent runs; a TAM re-surfaces it explicitly (un-dismiss via
`/api/undismiss-suggestion`). This keeps the suggestions panel free of hints the
TAM already judged and rejected. The dashboard also filters the dismissed set
client-side (belt-and-braces), but the skill should not write them in the first
place.

#### Watched KPIs (honour `watched_alerts`)

A TAM can **manually watch** any KPI from the dashboard — even one that is not
breaching — capturing a short reason (served: `/api/watch`; `file://`:
copy-prompt). This writes `watched_alerts: [{key, reason, since}]` in
`clients.yml`. On each run the skill must:

- read the project's `watched_alerts`, and
- **echo them into `dashboard-data.js`** as a top-level-per-project
  `watchedAlerts: [{key, reason, since}]` array so the dashboard keeps surfacing
  each watched KPI (a "👁 Watching" chip on its tile and a **Watched KPIs · manual**
  block in the project timeline) **regardless of breach state**.

Watching is purely a visibility aid — it does **not** change thresholds, the
confirmation gate, or what is posted to Slack. A watched KPI that also breaches is
still evaluated and alerted normally. Un-watching (`/api/unwatch`) removes the
entry. Fail-open: if `watched_alerts` is absent, emit no `watchedAlerts` array.

## Output

After each run, print a summary to the agent log:

```
[airship-kpi-monitor] {Client name} — run {run_timestamp}
  Windows: {current_window_start}→{current_window_end} vs {previous_window_start}→{previous_window_end}
  Candidates: {count} | Confirmed (new): {count} | Confirmed (ongoing): {count} | Resolved: {count}
  Escalations posted: {count} | Weekly recap posted: {yes/no}
  Canvas updated: {canvas_id}
```

After a multi-client run, the local monitoring canvas (Step 12) and the local
HTML dashboard data file (Step 13) are both rewritten once with the roll-up of
all processed clients.

## Error handling

### Transient-error retry policy (apply to every `call_airship_api` call)

The Airship MCP server can return **transient failures** — most commonly a
`401` with `error_code: 40101` / `"Unauthorized: Expired token"` (or
`authentication_failed` / `"API credentials are invalid or expired"`) when its
cached OAuth token has lapsed but not yet refreshed. These are **not** a real
credential problem: the next call usually triggers a token refresh and
succeeds. Network blips and `429` / `5xx` responses are transient too.

Before treating any failure as fatal, **retry the same call** with this policy:

1. **Retry up to 3 times** (4 attempts total) on a transient failure:
   - `401` with `error_code: 40101`, message containing `Expired token`, or
     `authentication_failed` / `credentials are invalid or expired`;
   - `429` (rate limited);
   - `5xx` (server error) or a network/timeout error.
2. **Back off between attempts**: wait ~2s, then ~5s, then ~10s. (A token
   refresh often lands within the first retry.)
3. **Distinguish transient from permanent.** Only the patterns above are
   retryable. A `401`/`403` that persists **after all retries**, or a clearly
   permission-scoped error, is treated as a genuine scope failure (next bullet).
   A `404` on a valid endpoint is **not** an auth failure — it means the path is
   wrong or the resource doesn't exist (do not retry as auth).
4. **Per-client, before fetching.** At the start of a client's run, make one
   cheap probe call (e.g. `GET /api/reports/opens` for a single day). If it
   returns a transient auth error, run the retry/back-off loop until it succeeds
   **before** issuing the full set of Step 1 calls. This avoids fetching half a
   client's data with a stale token.
5. **Only after retries are exhausted** do you skip the client / KPI. When you
   do skip, record it as `"transient auth failure after N retries: {client}"`
   so a multi-client run can surface it in the final roll-up (and the operator
   can simply re-run that client) rather than silently dropping it.

### Other errors

- If an API call returns a **persistent** `401`/`403` (after the retry policy
  above), log `"scope unavailable: {endpoint}"` and skip the related KPIs
  (do not alert on missing data).
- If `/api/reports/timeinapp` or `/api/reports/responses` rejects
  `precision=DAILY`, log a warning and skip those KPIs for the run.
- If `events` pages exceed 20 pages for one window, log a warning and
  continue (do not abort).
- If `slack_read_canvas` fails (canvas not found or empty), treat as first run.
- If `slack_create_canvas` is unavailable, skip canvas creation and log a
  warning — still post Slack alerts if thresholds are breached.
- If **Step 3c** fails partially (hourly events, `responses/list`, or
  `perpush` unavailable), still post the daily delay alert; omit the failed
  subsection and note `"hourly/campaign drill-down unavailable: {reason}"` in
  the Slack message.
