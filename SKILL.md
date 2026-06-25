---
name: airship-kpi-monitor
description: >-
  Daily Airship KPI monitoring with rolling 7-day window comparison, analysed
  per OS (iOS / Android). Detects significant variations in app opens, time in
  app, push sends/opt-outs, direct response rate (tracking-health signal),
  opt-in velocity, email metrics (including daily spam complaint and delay
  rates), web push, SMS sends and delivery rate, and custom events. Posts Slack alerts to a client channel and maintains a rich,
  source-traceable weekly canvas. Uses the Airship Reports API via MCP and the
  Slack MCP plugin. Triggered from Cursor chat (one-off or /loop recurring).
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
never masked by the other platform's volume. Post a Slack alert only when a new
anomaly is detected (anti-duplication via canvas state). Always update the
weekly canvas with today's snapshot.

## Inputs (from the automation prompt)

| Parameter | Required | Example |
|---|---|---|
| `Client name` | yes | `M6` |
| `Brand name` | no — defaults to Client name | `Client A Brand` |
| `Airship MCP server` | yes | `user-CLIENT-A PROD` |
| `Slack channel` | yes | `cs-fr-client` |
| `Slack canvas ID` | no — created on first run | `F0XXXXXXXX` |
| `Time zone` | no — defaults to `UTC` | `Europe/Paris` |
| `Slack workspace` | no — defaults to `urbanairship` | `urbanairship` |
| `Slack team ID` | no — defaults to `T025Q1VP7` | `T025Q1VP7` |
| `Custom thresholds` | no — overrides defaults | `push_sends_drop_pct: 40` |

`Brand name` is the **public-facing brand** used for web searches and news
lookups in root cause analysis (Step 8b). Use the consumer-facing name rather
than the internal project code — e.g. the client's public brand name rather
than their Airship project shorthand. If omitted, falls back to `Client name`.

### Slack channel (`slack_channel`)

`clients.yml` stores the **Slack channel name** as shown in Slack, **without**
the leading `#` — e.g. `cs-fr-bpce`, `cs_fr_m6`.

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

Every alert and resolution message must link to the KPI canvas with a URL that
**opens the canvas in Slack**. Build it at the start of each run:

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
   | `region` (informational) | Airship region of the MCP server |
   | `custom_thresholds` | overrides of the Step 8 defaults |

   The top-level `slack_workspace` / `slack_team_id` keys in `clients.yml`
   (if present) supply the `Slack workspace` / `Slack team ID` inputs used to
   build `canvas_url`; otherwise the `urbanairship` / `T025Q1VP7` defaults apply.

   **Precedence**: if the chat prompt also specifies a parameter directly
   (e.g. a different channel or a threshold override), the prompt value wins
   for that run.

4. **Run the full workflow (Steps 0–11) once per selected client**, strictly
   sequentially — finish one client (including Slack posts and canvas update)
   before starting the next. Never interleave API calls or Slack messages
   between clients. Always use the `Airship MCP server` from that client's
   entry so the correct project is queried.

5. **Isolate failures**: if one client errors out (MCP unavailable, scope
   issue, etc.), log the error for that client, skip it, and continue with the
   remaining clients. One client's failure must not abort the others.

6. **First-run canvas IDs**: if a client's `slack_canvas_id` is blank, the
   skill creates the canvas (Step 11) and prints the new ID. Tell the TAM to
   paste each returned ID back into `clients.yml` so subsequent runs reuse it.

7. **Per-client summary**: emit the Step "Output" summary block for every
   client, then a final roll-up line:
   `[airship-kpi-monitor] multi-run — {N} clients · {posted} posted · {skipped} skipped`.

8. **Update the local monitoring canvas** once at the end (Step 12), rolling up
   every processed client's open alerts, last-run time, and Slack canvas link.

## Data sources (traceability reference)

Every figure shown in Slack or the canvas MUST be traceable to the endpoint
below. **Any alert flagging a problem must cite its source endpoint AND the
denominator used.**

| KPI | Source endpoint | Denominator / note |
|---|---|---|
| App opens (per OS) | `/api/reports/opens` | raw count |
| Push sends (per OS) | `/api/reports/sends` | raw count |
| Push opt-outs (per OS) | `/api/reports/optouts` | rate = opt-outs / push sends |
| Opt-ins (per OS) | `/api/reports/optins` | raw count; net = opt-ins − opt-outs |
| Direct response rate (per OS) | `/api/reports/responses` | rate = direct / push sends |
| Time in app (per OS) | `/api/reports/timeinapp` | avg value/day returned by Airship |
| Devices snapshot (per OS) | `/api/reports/devices` | unique / opted-in / opted-out / uninstalled |
| Email injection/delivery/open/click/bounce/unsubscribe | `/api/reports/events` | per-metric denominator (see Step 8) |
| Email delay / spam complaint (daily) | `/api/reports/events` | `delay` or `spam_complaint` / `delivery` per day (`precision=DAILY`, one call per day) |
| Email delay drill-down (on alert) | `/api/reports/events`, `/api/reports/sends` | hourly `delay` / `delivery` + `email` sends (`precision=HOURLY`, one events call per hour) |
| Email campaigns (delay root cause) | `/api/reports/responses/list`, `/api/reports/events/summary/perpush/{push_id}`, `/api/reports/perpush/pushbody/{push_id}` | top sends on impacted day; per-push `delay`/`delivery`; `message_name` only |
| SMS sends | `/api/reports/sends` | raw count (field `sms`) |
| SMS delivery rate | `/api/reports/events` | `delivered` / `dispatched` SMS delivery report events |
| SMS devices snapshot | `/api/reports/devices` | `sms.unique_devices`, `sms.opted_in`, `sms.opted_out`, `sms.uninstalled` |
| Web push sends | `/api/reports/sends` | raw count (field `web`) |
| Web push devices snapshot | `/api/reports/devices` | `web.unique_devices`, `web.opted_in` |
| Custom events | `/api/reports/events` | raw count |
| Top campaigns (root cause only) | `/api/reports/responses/list` | per push |

`influenced` responses are intentionally **ignored** — only `direct` responses
are used (a collapse of the direct rate signals a tracking/SDK problem, not a
real engagement change).

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

### Step 1 — Fetch period metrics (14 days DAILY in one call each)

Call via MCP `call_airship_api` on the **Airship MCP server** specified in the
automation prompt.

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

### Step 3c — Email delay drill-down (only when `email_delay_high:{date}` fires)

Run this step **only** when at least one `email_delay_high:{date}` alert is in the
**alerts to post** list (new alert — not ongoing, not resolution). For each impacted
date `D`:

#### 3c.1 — Hourly breakdown for day `D`

`/api/reports/events` with `precision=HOURLY` over a date range returns **aggregates
for the whole range**, not per-hour rows. Issue **one call per hour** (same pattern
as Step 3b):

```
GET /api/reports/events
  params: start={D}T{h}:00:00, end={D}T{h}:59:59, precision=HOURLY, page_size=100
→ for h in 0..23
```

Also fetch email send volume by hour:

```
GET /api/reports/sends
  params: start={D}T00:00:00, end={D}T23:59:59, precision=HOURLY
→ field email per row (date = hour bucket)
```

Per hour `h`, extract from events (location=`custom`):
`injection`, `delivery`, `delay`. Compute `delay_rate_h = delay_h / delivery_h * 100`.
Mark hours with `delivery_h < min_email_delivery_day` as low volume (show counts but
flag rate as non-significant).

Convert each UTC hour bucket to the project's `time_zone` and keep both. The
Slack/canvas table shows the **local** hour (labelled `Hour (local · {time_zone})`)
so peaks read in business hours; keep the UTC hour available for cross-checking
against `push_time` (also UTC) in Step 3c.3.

Store as `delay_hourly_breakdown[D]` — sorted table used in the Slack alert.

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

Split into current / previous windows and sum **`direct` per OS only**. Ignore
`influenced`. Then compute, per OS:

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

### Step 6 — Fetch devices snapshot

```
GET /api/reports/devices
  (no date params — always returns current snapshot)
```

Extract per platform: `unique_devices`, `opted_in`, `opted_out`, `uninstalled`
for `ios`, `android`, `web` (if `web.unique_devices > 0`), and `sms` (if
`sms.unique_devices > 0`). These are used both for the canvas snapshot and
for D-7 delta comparisons (Step 8).

### Step 7 — Read canvas for state (devices D-7 and open alerts)

```
slack_read_canvas(canvas_id)
```

If `canvas_id` is empty (first run), skip this step — there is no prior state.

Parse the canvas to extract:
1. **Devices snapshot from 7 days ago** — look for a row tagged with date
   `current_window_start` (= yesterday - 6 days) in the Devices History table.
   Extract `ios.unique_devices`, `ios.opted_in`, `ios.uninstalled`,
   `android.*`, `web.*`, `sms.*` (if present).
2. **Currently open alerts** — list of alert keys already posted and not yet
   resolved (format: `ALERT_KEY | os | opened_date | last_seen_date`).
3. **Email deliverability health history** — rows from the
   `## 📧 Email deliverability health — history` table (date, delivered, delay,
   delay %, spam complaints, spam %). Used to avoid duplicate rows when
   re-running the same day and to preserve history beyond the 7-day API window.

If no row found for D-7, device delta metrics are **not computable** — mark
them as `"n/a (canvas history pending)"` and do not trigger thresholds.

### Step 8 — Compute deltas and evaluate thresholds

#### Default thresholds (overridden by custom thresholds in the prompt)

```yaml
# App (evaluated PER OS: ios, android)
app_opens_drop_pct: 20          # drop > 20% → alert

# Engagement / time in app (PER OS)
timeinapp_drop_pct: 20          # avg time-in-app drop > 20% → alert

# Devices (vs canvas D-7 snapshot, PER OS)
devices_unique_drop_pct: 5      # drop > 5% → alert
devices_optin_drop_pct: 5       # drop > 5% → alert
devices_uninstall_rise_pct: 10  # rise > 10% → alert

# Push mobile (evaluated PER OS: ios, android)
push_sends_drop_pct: 50         # drop > 50% → alert
optouts_rise_pct: 20            # push opt-out raw count rise > 20% → alert (rate per send also shown)
direct_response_rate_min: 0.5   # rate < 0.5% → alert (absolute, current window)
direct_response_collapse_pct: 60 # WoW drop of direct response RATE ≥ 60% on an OS → likely tracking/SDK issue

# Acquisition / opt-ins (PER OS)
optins_drop_pct: 25             # new opt-ins drop > 25% → alert
# net_optin_negative: alert if net (opt-ins − opt-outs) flips from ≥0 to <0

# Email (channel-level, no OS split)
email_sends_drop_pct: 20        # drop > 20% → alert
email_deliverability_min: 95    # rate < 95% → alert (absolute)
email_open_rate_drop_pts: 5     # drop > 5 percentage points → alert
email_bounce_max: 2             # rate > 2% → alert (absolute)
email_unsubscribe_rise_pct: 30  # rise > 30% → alert
email_spam_complaint_rate_max: 1  # daily spam_complaint / delivery > 1% → alert
email_delay_rate_max: 5           # daily delay / delivery > 5% → alert

# Web push (only evaluated if web.unique_devices > 0)
web_sends_drop_pct: 30          # drop > 30% → alert
web_sends_rise_pct: 100         # rise > 100% → alert (unexpected spike)

# SMS channel (only evaluated if sms.unique_devices > 0 OR sms_sends_prev > 0)
sms_sends_drop_pct: 30          # WoW drop > 30% → alert
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
min_optins: 100                 # per OS — skip opt-in thresholds if prev 7d opt-ins < 100
min_timeinapp: 1                # skip time-in-app threshold if prev avg < 1
min_sms_sends: 100              # skip SMS sends thresholds if prev 7d SMS sends < 100
min_sms_dispatched: 50          # skip SMS delivery rate threshold if prev 7d dispatched < 50
min_web_sends: 100              # skip web push threshold if prev 7d web sends < 100
```

#### Metric calculations (per OS where applicable)

For each `os` in {`ios`, `android`}:

```
# App opens
app_opens_{os}_current   = sum(opens.{os}) over current window
app_opens_{os}_previous  = sum(opens.{os}) over previous window
app_opens_{os}_delta_pct = (current - previous) / previous * 100
# Source: /api/reports/opens

# Push sends
push_sends_{os}_current  = sum(sends.{os}) over current window
push_sends_{os}_previous = sum(sends.{os}) over previous window
push_sends_{os}_delta_pct = (current - previous) / previous * 100
# Source: /api/reports/sends

# Push opt-outs (raw + rate vs sends)
push_optouts_{os}_current  = sum(optouts.{os}) over current window
push_optouts_{os}_previous = sum(optouts.{os}) over previous window
push_optout_rate_{os}_current  = push_optouts_{os}_current  / push_sends_{os}_current  * 100
push_optout_rate_{os}_previous = push_optouts_{os}_previous / push_sends_{os}_previous * 100
# Source: /api/reports/optouts (rate denominator = /api/reports/sends)
# (a device can opt out without opening the push → denominator is sends)

# Direct response rate (tracking-health signal)
direct_response_rate_{os}_current  = direct_{os}_current  / push_sends_{os}_current  * 100
direct_response_rate_{os}_previous = direct_{os}_previous / push_sends_{os}_previous * 100
direct_rate_drop_pct_{os} = (previous_rate - current_rate) / previous_rate * 100
# Source: /api/reports/responses (denominator = /api/reports/sends)

# Opt-ins (acquisition velocity + net balance)
optins_{os}_current   = sum(optins.{os}) over current window
optins_{os}_previous  = sum(optins.{os}) over previous window
optins_{os}_delta_pct = (current - previous) / previous * 100
net_optin_{os}_current  = optins_{os}_current  - push_optouts_{os}_current
net_optin_{os}_previous = optins_{os}_previous - push_optouts_{os}_previous
# Source: /api/reports/optins (net uses /api/reports/optouts)

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

Email deliverability health (daily, from Step 3b — per day in current window):

```
For each date d in [current_window_start, current_window_end]:
  delay_rate_{d}          = delay_{d} / delivery_{d} * 100
  spam_complaint_rate_{d} = spam_complaint_{d} / delivery_{d} * 100
# Source: /api/reports/events (precision=DAILY, one call per day)
# Denominator: delivery (same day)
# Skip day if delivery_{d} < min_email_delivery_day
```

Devices deltas (only if D-7 canvas data available), per OS:

```
devices_{os}_unique_delta_pct    = (today - d7) / d7 * 100
devices_{os}_optin_delta_pct     = (today - d7) / d7 * 100
devices_{os}_uninstall_delta_pct = (today - d7) / d7 * 100
# Source: /api/reports/devices (today) vs canvas D-7 snapshot
```

#### Assign an alert key to each threshold breach

Each alert has a stable string key (used for deduplication). Per-OS keys use
the `{os}` suffix (`ios` / `android`; `web` for web push).

| Key | Condition |
|---|---|
| `app_opens_drop_{os}` | app_opens_{os}_delta_pct ≤ -app_opens_drop_pct |
| `timeinapp_drop_{os}` | timeinapp_{os}_delta_pct ≤ -timeinapp_drop_pct |
| `push_sends_drop_{os}` | push_sends_{os}_delta_pct ≤ -push_sends_drop_pct |
| `push_optouts_rise_{os}` | push_optouts_{os}_delta_pct ≥ optouts_rise_pct |
| `direct_response_low_{os}` | direct_response_rate_{os}_current < direct_response_rate_min |
| `direct_response_collapse_{os}` | direct_rate_drop_pct_{os} ≥ direct_response_collapse_pct |
| `optins_drop_{os}` | optins_{os}_delta_pct ≤ -optins_drop_pct |
| `net_optin_negative_{os}` | net_optin_{os}_previous ≥ 0 AND net_optin_{os}_current < 0 |
| `email_sends_drop` | email_sends_delta_pct ≤ -email_sends_drop_pct |
| `email_deliverability_low` | email_deliverability_current < email_deliverability_min |
| `email_open_rate_drop` | open_rate_drop_pts ≥ email_open_rate_drop_pts |
| `email_bounce_high` | email_bounce_rate_current > email_bounce_max |
| `email_unsubscribe_rise` | unsubscribe_delta_pct ≥ email_unsubscribe_rise_pct |
| `email_spam_complaint_high:{date}` | spam_complaint_rate_{date} > email_spam_complaint_rate_max (if delivery_{date} ≥ min_email_delivery_day) |
| `email_delay_high:{date}` | delay_rate_{date} > email_delay_rate_max (same guard) |
| `web_sends_drop` | web_sends_delta_pct ≤ -web_sends_drop_pct (if web active) |
| `web_sends_rise` | web_sends_delta_pct ≥ web_sends_rise_pct (if web active) |
| `sms_sends_drop` | sms_sends_delta_pct ≤ -sms_sends_drop_pct (if SMS active) |
| `sms_sends_rise` | sms_sends_delta_pct ≥ sms_sends_rise_pct (if SMS active) |
| `sms_delivery_rate_low` | sms_delivery_rate_current < sms_delivery_rate_min (if dispatched ≥ min_sms_dispatched) |
| `sms_delivery_rate_drop` | sms_delivery_rate_drop_pts ≥ sms_delivery_rate_drop_pts threshold (same guard) |
| `devices_{os}_unique_drop` | delta_pct ≤ -devices_unique_drop_pct |
| `devices_{os}_optin_drop` | delta_pct ≤ -devices_optin_drop_pct |
| `devices_{os}_uninstall_rise` | delta_pct ≥ devices_uninstall_rise_pct |
| `devices_web_optin_drop` | idem (if web active) |
| `custom_event_new:{name}` | event in current, absent in previous |
| `custom_event_vanished:{name}` | event in previous, count=0 in current |
| `custom_event_rise:{name}` | count delta ≥ custom_event_rise_pct |
| `custom_event_drop:{name}` | count delta ≤ -custom_event_drop_pct |

Dated email health keys (e.g. `email_spam_complaint_high:2026-06-23`) resolve
when that day's rate falls back below threshold on a later run.

Do **not** evaluate a threshold if the relevant previous-window volume is
below the minimum defined in `min_*` settings (per OS where the minimum is
per OS). Log `"skipped: low volume"`.

When both `direct_response_low_{os}` and `direct_response_collapse_{os}` fire on
the same OS, post a single alert keyed `direct_response_collapse_{os}` (it
implies the low rate).

### Step 8b — Root cause analysis (for each triggered alert)

Run this step only for **new alerts** (not ongoing ones). For each breach,
produce a short `possible_cause` string to include in the Slack message.
Work through the checks below in order and stop at the first that explains
the variation. If none applies, output `"No clear cause identified"`.

Always state the data source for the reasoning (endpoint + denominator) when
the cause concerns a problem.

#### 1. Cross-metric correlation (per OS)

Check whether the alert is mechanically explained by another metric on the
**same OS** (no extra API call needed):

| Alert | Correlation check |
|---|---|
| `app_opens_drop_{os}` | If push_sends_{os} also dropped proportionally → `"App opens drop on {os} is consistent with the -X% push send reduction on {os} (source: /api/reports/opens vs /api/reports/sends)."` |
| `timeinapp_drop_{os}` | If app_opens_{os} also dropped → engagement-wide erosion on {os}; if opens stable → deeper in-session disengagement. Cite /api/reports/timeinapp. |
| `direct_response_collapse_{os}` | **Prioritise tracking hypothesis**: `"Direct response rate on {os} collapsed from X% to Y% (direct / push sends, source /api/reports/responses) while sends stayed normal → most likely an attribution/SDK tracking issue on {os}, not a real engagement drop. Recommend checking SDK version / response tracking on {os}."` |
| `push_optouts_rise_{os}` (raw) | If push_sends_{os} rose significantly → `"Raw opt-out count increase on {os} is volume-driven (push sends +X%); opt-out rate per send actually improved/worsened (source: /api/reports/optouts ÷ /api/reports/sends)."` |
| `optins_drop_{os}` | If push_sends_{os} or app_opens_{os} also dropped → acquisition slowed alongside lower activity on {os}. Cite /api/reports/optins. |
| `net_optin_negative_{os}` | Note whether driven by fewer opt-ins or more opt-outs (compare both series, source /api/reports/optins and /api/reports/optouts). |
| `email_sends_drop` | Check day-by-day: is the drop concentrated on specific days or spread evenly? |
| `email_spam_complaint_high:{date}` | High spam rate on {date} — check if a specific campaign sent that day had list-quality or consent issues. Cite spam_complaint / delivery from /api/reports/events (DAILY). |
| `email_delay_high:{date}` | Run **Step 3c** first. High delay rate on {date} — correlate hourly delay peaks with large email blasts (`responses/list` + `events/summary/perpush`). Provider throttling/reputation if no large campaign matches. |
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

### Step 9 — Anti-duplication check

Compare the set of triggered alert keys against the **open alerts list** read
from the canvas in Step 7.

- **New alert** (key not in open list) → add to "alerts to post"
- **Resolved alert** (key was open, threshold no longer breached) → add to
  "resolutions to post"
- **Ongoing alert** (key still breached, already open) → do NOT post again,
  only update `last_seen_date` in the canvas

### Step 10 — Post Slack messages

**Only if there are new alerts or resolutions to post.**

All Slack alert and resolution messages are in **English** (labels, possible-cause
text, and footnotes).

`{canvas_url}` — computed at run start (see **Slack canvas link** above). Example:
`https://urbanairship.slack.com/docs/T025Q1VP7/F0XXXXXXXXX`

#### New alerts message

Use `slack_send_message` to the channel ID resolved at run start (see **Slack
channel** above).
**Important:** the Slack MCP requires the `message` parameter (not `text`) —
always pass `message: "..."` or the call will silently return `no_text`
without posting.

```
🔴 KPI Alert — {Client name} — {current_window_start} → {current_window_end}

**{Section}** _(source: {endpoint})_
| Metric              | OS       | Prev 7d          | Last 7d          | Δ                |
|---------------------|----------|------------------|------------------|------------------|
| {kpi_label}         | {os}     | {prev_value}     | {curr_value}     | {delta_str}      |

> 🔍 **Possible cause:** {possible_cause}

_(Source: Airship Reports API · [📊 KPI Canvas]({canvas_url}))_
```

Include only triggered KPIs grouped by section (App, Engagement, Mobile Push,
Acquisition, Email, Web Push, SMS, Devices, Custom Events). Do not include
passing KPIs. **Each section header must name its source endpoint**, and each
metric row must show the OS / channel it concerns.

Each triggered KPI section must be followed by its `> 🔍 Possible cause:`
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

- Direct response must appear as **"Direct response rate (vs sends)"** with the
  denominator and source stated. When a collapse fires, add the explicit
  tracking caveat:
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

  **When `email_delay_high:{date}` is a new alert**, append the Step 3c drill-down
  **below** the `possible_cause` line (mandatory):

  ```
  **Hourly breakdown — {date}** _(source: /api/reports/events · HOURLY; hours in local {time_zone})_
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

#### Resolution message (when an alert clears)

Also use `slack_send_message` with the `message` parameter (not `text`).

```
✅ KPI Resolved — {Client name} — {today}
{kpi_label} ({os}) is back within normal range.
[📊 KPI Canvas]({canvas_url})
```

### Step 11 — Update the canvas

Use `slack_update_canvas` (or `slack_create_canvas` if no canvas ID yet) to
maintain a **rich, synthetic, source-traceable** weekly canvas. Keep it
visual and scannable: total + per-OS detail, trend arrows, and the source
endpoint named under each section.

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
   | `## 🚨 Open Alerts` | `replace` the section with the refreshed alerts table |
   | `## 📊 This week at a glance` | `replace` each `###` subsection (App, Push, Acquisition, Email, Email deliverability health — current window, Web push, SMS, Custom events) individually |
   | `## 📱 Installed base` | `replace` the section with today's snapshot table |
   | `## 📈 Devices history` | `prepend` a new row at the top of the table — **never replace the full table** |
   | `## 📧 Email deliverability health — history` | `prepend` new daily row(s) from Step 3b — **never replace the full table** unless trimming to 30 rows |

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
_Last run: {today} · Window {current_window_start}→{current_window_end} vs {previous_window_start}→{previous_window_end}_

## 🚨 Open Alerts
| Alert key | OS | Opened | Last seen | Possible cause |
|---|---|---|---|---|
| push_sends_drop_ios | iOS | 2026-06-15 | 2026-06-22 | No campaign Jun 17 |

_(No open alerts → write "No open alerts this week.")_

## 📊 This week at a glance

### App & Engagement  _(source: /api/reports/opens, /api/reports/timeinapp)_
| KPI | OS | Prev 7d | Last 7d | Δ |
|---|---|---|---|---|
| App opens | iOS | … | … | ⬆︎/⬇︎ X% |
| App opens | Android | … | … | … |
| App opens | Total | … | … | … |
| Avg time in app /day | iOS | … | … | … |
| Avg time in app /day | Android | … | … | … |

### Push  _(source: /api/reports/sends, /api/reports/optouts, /api/reports/responses)_
| KPI | OS | Prev 7d | Last 7d | Δ |
|---|---|---|---|---|
| Sends | iOS | … | … | … |
| Sends | Android | … | … | … |
| Opt-outs (vs sends) | iOS | … (… %) | … (… %) | … |
| Opt-outs (vs sends) | Android | … (… %) | … (… %) | … |
| Direct response rate (vs sends) | iOS | … % | … % | … |
| Direct response rate (vs sends) | Android | … % | … % | … |

### Acquisition  _(source: /api/reports/optins + /api/reports/optouts)_
| KPI | OS | Prev 7d | Last 7d | Δ |
|---|---|---|---|---|
| New opt-ins | iOS | … | … | … |
| New opt-ins | Android | … | … | … |
| Net opt-in (opt-ins − opt-outs) | iOS | … | … | … |
| Net opt-in (opt-ins − opt-outs) | Android | … | … | … |

### Email  _(source: /api/reports/events + /api/reports/sends)_
| KPI | Prev 7d | Last 7d | Δ |
|---|---|---|---|
| Sends | … | … | … |
| Deliverability (delivery/injection) | … % | … % | … |
| Open rate (vs delivered) | … % | … % | … |
| Bounce rate (vs injection) | … % | … % | … |
| Unsubscribes (vs delivered) | … (… %) | … (… %) | … |

_(Omit the Email section entirely if the client sends no email.)_

### Email deliverability health — current window  _(source: /api/reports/events · DAILY)_
| Date | Delivered | Delay | Delay % | Spam complaints | Spam % |
|---|---|---|---|---|---|
| 2026-06-23 | … | … | … % | … | … % |
| … | (one row per day in the 7-day window) | | | | |

_(Omit this subsection if the client sends no email.)_
_(Flag rows where Delay % > 5% or Spam % > 1% with ⚠️ inline on the rate cells.)_

### Web push  _(source: /api/reports/sends · only if web active)_
| KPI | Prev 7d | Last 7d | Δ |
|---|---|---|---|
| Web sends | … | … | … |

_(Omit the Web push section entirely if web.unique_devices = 0 and web_sends_prev = 0.)_

### SMS  _(source: /api/reports/sends + /api/reports/events · only if SMS active)_
| KPI | Prev 7d | Last 7d | Δ |
|---|---|---|---|
| SMS sends | … | … | … |
| SMS delivery rate (delivered/dispatched) | … % | … % | … |
| SMS delivered | … | … | … |
| SMS dispatched | … | … | … |
| SMS failed + expired | … | … | … |

_(Omit the SMS section entirely if sms.unique_devices = 0 and sms_sends_prev = 0.)_
_(Omit the delivery rate row if dispatched < min_sms_dispatched.)_

### Custom events  _(source: /api/reports/events)_
| Event | Prev 7d | Last 7d | Δ |
|---|---|---|---|
| {name} | … | … | … |

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

## 📧 Email deliverability health — history (last 30 days)  _(source: /api/reports/events · DAILY)_
| Date | Delivered | Delay | Delay % | Spam complaints | Spam % |
|---|---|---|---|---|---|
| 2026-06-23 | … | … | … % | … | … % |

_(Omit this section entirely if the client sends no email.)_
_(Keep last 30 rows. Prepend new days from Step 3b; do not duplicate a date already present — replace that row if re-running the same day.)_
```

**Section content rules (apply when replacing each section):**
1. "This week at a glance" subsections — replace with current window values.
   Add / remove Web push and SMS subsections based on channel activity.
2. Devices History — **prepend** new row only (never full replace unless trimming to 30 rows).
   Add SMS columns on first SMS-active run; Web opted-in column when web active.
3. Email deliverability health history — **prepend** daily rows from Step 3b
   (30 rows max; replace row if date already exists).
4. Installed base — replace with today's snapshot (add/remove SMS and Web rows as needed).
5. Open Alerts — replace with updated table: add new alerts, remove resolved, update `last_seen`.
6. Last run line — replace the paragraph with the new date and window.
7. Keep source endpoint labels under every section header.

**If `slack_read_canvas` fails** (canvas not found, empty, or first run):
- Fall back to `slack_create_canvas` with the full initial content
- Return the canvas ID **and** the full `canvas_url` so the TAM can copy both
  into the automation prompt (or `clients.yml`)

### Step 12 — Update the local monitoring canvas (optional, local-only)

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
   - **Summary stats**: projects monitored, projects in alert, total open
     alerts, resolutions today, Slack channels.
   - **Open alerts table** (the primary content): one row per open alert across
     all projects — project · severity · `alert key` · scope (OS/Email/SMS/Web)
     · opened · possible cause. Sort by severity.
   - **Per-project status table**: project · Slack channel · last run (use
     `run_timestamp` for clients processed this run) · open-alert count · a
     `Link` to that project's Slack KPI canvas
     (`canvas_url = https://{slack_workspace}.slack.com/docs/{slack_team_id}/{slack_canvas_id}`).
   - **Setup section** (collapsed): local file locations
     (`~/.cursor/mcp.json`, `clients.yml`) and the install checklist.
4. **Never embed secrets** (app keys, client IDs, client secrets). Use only
   names, channels, and canvas IDs from `clients.yml`.
5. **Write all canvas content in English** (labels, alert causes, callouts).
6. If the canvas tooling is unavailable, skip this step and log a warning — it
   never blocks the Slack alerts or per-project canvases.

## Output

After each run, print a summary to the agent log:

```
[airship-kpi-monitor] {Client name} — run {run_timestamp}
  Windows: {current_window_start}→{current_window_end} vs {previous_window_start}→{previous_window_end}
  New alerts: {count} | Resolutions: {count} | Ongoing: {count}
  Canvas updated: {canvas_id}
  Slack message posted: {yes/no}
```

After a multi-client run, the local monitoring canvas (Step 12) is rewritten
once with the roll-up of all processed clients.

## Error handling

- If an API call returns 401/403, log `"scope unavailable: {endpoint}"` and
  skip the related KPIs (do not alert on missing data).
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
