---
name: airship-kpi-monitor
description: >-
  Daily Airship KPI monitoring with rolling 7-day window comparison.
  Detects significant variations in push, email, app, web push metrics and
  custom events. Posts Slack alerts to a client channel and maintains a
  weekly canvas summary. Uses the Airship Reports API via MCP and the Slack
  MCP plugin. Designed to run as a Cursor Cloud Agent automation.
---

# Airship KPI Monitor — Daily Rolling Window Check

Monitor an Airship project's key metrics daily, comparing the **last 7 complete
days (D-7 → D-1)** against the **previous 7 days (D-14 → D-8)**. Post a Slack
alert only when a new anomaly is detected (anti-duplication via canvas state).
Always update the weekly canvas with today's snapshot.

## Inputs (from the automation prompt)

| Parameter | Required | Example |
|---|---|---|
| `Client name` | yes | `M6` |
| `Airship MCP server` | yes | `user-M6 PROD` |
| `Slack channel ID` | yes | `C0XXXXXXXX` |
| `Slack canvas ID` | no — created on first run | `F0XXXXXXXX` |
| `Alert language` | no — default `en` | `en` or `fr` |
| `Custom thresholds` | no — overrides defaults | `push_sends_drop_pct: 40` |

## Execution workflow

### Step 0 — Compute date windows

```
today      = current UTC date
yesterday  = today - 1 day          (last complete day)
window_end = yesterday

current_window_start  = yesterday - 6 days   (D-7 → D-1, 7 days)
current_window_end    = yesterday

previous_window_start = yesterday - 13 days  (D-14 → D-8, 7 days)
previous_window_end   = yesterday - 7 days
```

Format all dates as `YYYY-MM-DD`. Never include today (partial data).

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

Then sum per platform for each group.

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

### Step 4 — Fetch push click rate

```
GET /api/reports/responses/list
  params: start=current_window_start, end=current_window_end, limit=100
→ follow next_page until exhausted
→ compute: total_direct_responses / total_sends
   (only count pushes with sends > 0)
```

Repeat for the previous window.

### Step 5 — Fetch devices snapshot

```
GET /api/reports/devices
  (no date params — always returns current snapshot)
```

Extract per platform: `unique_devices`, `opted_in`, `opted_out`, `uninstalled`
for `ios`, `android`, and `web` (if `web.unique_devices > 0`).

### Step 6 — Read canvas for state (devices D-7 and open alerts)

```
slack_read_canvas(canvas_id)
```

If `canvas_id` is empty (first run), skip this step — there is no prior state.

Parse the canvas to extract:
1. **Devices snapshot from 7 days ago** — look for a row tagged with date
   `current_window_start` (= yesterday - 6 days). Extract `ios.unique_devices`,
   `ios.opted_in`, `ios.uninstalled`, `android.*`, `web.*`.
2. **Currently open alerts** — list of alert keys already posted and not yet
   resolved (format: `ALERT_KEY | opened_date | last_seen_date`).

If no row found for D-7, device delta metrics are **not computable** — mark
them as `"n/a (canvas history pending)"` and do not trigger thresholds.

### Step 7 — Compute deltas and evaluate thresholds

#### Default thresholds (overridden by custom thresholds in the prompt)

```yaml
# App
app_opens_drop_pct: 20          # drop > 20% → alert

# Devices (vs canvas D-7 snapshot)
devices_unique_drop_pct: 5      # drop > 5% → alert
devices_optin_drop_pct: 5       # drop > 5% → alert
devices_uninstall_rise_pct: 10  # rise > 10% → alert

# Push mobile
push_sends_drop_pct: 30         # drop > 30% → alert
optouts_rise_pct: 20            # push opt-out raw count rise > 20% → alert (rate per send also shown)
direct_response_rate_min: 0.5   # rate < 0.5% → alert (absolute, current window)

# Email
email_sends_drop_pct: 20        # drop > 20% → alert
email_deliverability_min: 95    # rate < 95% → alert (absolute)
email_open_rate_drop_pts: 5     # drop > 5 percentage points → alert
email_bounce_max: 2             # rate > 2% → alert (absolute)
email_unsubscribe_rise_pct: 30  # rise > 30% → alert

# Web push (only evaluated if web.unique_devices > 0)
web_sends_drop_pct: 30          # drop > 30% → alert

# Custom events
custom_event_rise_pct: 50       # rise > 50% → alert
custom_event_drop_pct: 50       # drop > 50% → alert

# Minimum volumes to evaluate a threshold (anti false-positive)
min_push_sends: 1000            # skip push thresholds if prev 7d sends < 1000
min_email_sends: 500            # skip email thresholds if prev 7d emails < 500
min_custom_event_count: 200     # skip custom event threshold if prev count < 200
```

#### Metric calculations

```
push_sends_current  = sum(sends.ios + sends.android) over current window
push_sends_previous = sum(sends.ios + sends.android) over previous window
push_sends_delta_pct = (current - previous) / previous * 100

app_opens_current  = sum(opens.ios + opens.android) over current window
app_opens_previous = sum(opens.ios + opens.android) over previous window

push_optouts_current  = sum(optouts.ios + optouts.android) over current window
push_optouts_previous = sum(optouts.ios + optouts.android) over previous window

# Always compute the opt-out rate per send alongside the raw count:
push_optout_rate_current  = push_optouts_current  / push_sends_current  * 100  (%)
push_optout_rate_previous = push_optouts_previous / push_sends_previous * 100  (%)
# (denominator = total push sends, not opens — a device can opt out
#  without opening the push; this is the industry-standard denominator)
#
# Email unsubscribes are tracked separately under Email (events["unsubscribe"])
# and are NOT included in optouts_current.

email_sends_current   = sum(sends.email) over current window
injection_current     = events_current["injection"].count
delivery_current      = events_current["delivery"].count
open_current          = events_current["initial_open"].count  (unique opens)
bounce_current        = events_current["bounce"].count
unsubscribe_current   = events_current["unsubscribe"].count

email_deliverability_current  = delivery_current / injection_current * 100
email_open_rate_current       = open_current / delivery_current * 100
email_bounce_rate_current     = bounce_current / injection_current * 100

(repeat for previous window)

direct_response_rate_current = total_direct / total_sends (from responses/list)

# Devices deltas (only if D-7 canvas data available)
devices_ios_unique_delta_pct  = (today - d7) / d7 * 100
devices_ios_optin_delta_pct   = (today - d7) / d7 * 100
devices_ios_uninstall_delta_pct = (today - d7) / d7 * 100
(same for android, web)
```

#### Assign an alert key to each threshold breach

Each alert has a stable string key (used for deduplication):

| Key | Condition |
|---|---|
| `push_sends_drop` | push_sends_delta_pct ≤ -push_sends_drop_pct |
| `app_opens_drop` | app_opens_delta_pct ≤ -app_opens_drop_pct |
| `push_optouts_rise` | push_optouts_delta_pct ≥ optouts_rise_pct |
| `direct_response_low` | direct_response_rate_current < direct_response_rate_min |
| `email_sends_drop` | email_sends_delta_pct ≤ -email_sends_drop_pct |
| `email_deliverability_low` | email_deliverability_current < email_deliverability_min |
| `email_open_rate_drop` | open_rate_drop_pts ≥ email_open_rate_drop_pts |
| `email_bounce_high` | email_bounce_rate_current > email_bounce_max |
| `email_unsubscribe_rise` | unsubscribe_delta_pct ≥ email_unsubscribe_rise_pct |
| `web_sends_drop` | web_sends_delta_pct ≤ -web_sends_drop_pct (if web active) |
| `devices_ios_unique_drop` | delta_pct ≤ -devices_unique_drop_pct |
| `devices_ios_optin_drop` | delta_pct ≤ -devices_optin_drop_pct |
| `devices_ios_uninstall_rise` | delta_pct ≥ devices_uninstall_rise_pct |
| `devices_android_unique_drop` | idem |
| `devices_android_optin_drop` | idem |
| `devices_android_uninstall_rise` | idem |
| `devices_web_optin_drop` | idem (if web active) |
| `custom_event_new:{name}` | event in current, absent in previous |
| `custom_event_vanished:{name}` | event in previous, count=0 in current |
| `custom_event_rise:{name}` | count delta ≥ custom_event_rise_pct |
| `custom_event_drop:{name}` | count delta ≤ -custom_event_drop_pct |

Do **not** evaluate a threshold if the relevant previous-window volume is
below the minimum defined in `min_*` settings. Log `"skipped: low volume"`.

### Step 7b — Root cause analysis (for each triggered alert)

Run this step only for **new alerts** (not ongoing ones). For each breach,
produce a short `possible_cause` string to include in the Slack message.
Work through the checks below in order and stop at the first that explains
the variation. If none applies, output `"No clear cause identified"`.

#### 1. Cross-metric correlation

Check whether the alert is mechanically explained by another metric
already in the dataset (no extra API call needed):

| Alert | Correlation check |
|---|---|
| `app_opens_drop` | If push_sends also dropped proportionally → `"App opens drop is consistent with the -X% push send volume reduction in the same period."` |
| `push_optouts_rise` (raw) | If push_sends rose significantly → `"Raw opt-out count increase is volume-driven (push sends +X%); opt-out rate per send actually improved/worsened."` |
| `web_sends_drop` | If push_sends also dropped → note correlation; if push stable → flag as specific to web channel |
| `email_sends_drop` | Check day-by-day: is the drop concentrated on specific days or spread evenly? |

#### 2. Day-by-day spike/gap detection

Scan the 14-day daily series already fetched (sends, opens) for the
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

#### 3. Top-campaign identification (push alerts only)

Use the `responses/list` data already fetched in Step 4 (paginate one
more page if needed). For each window, identify the **top 3 pushes by
sends**. Compare:

- If a recurring large campaign (similar `group_id` or send pattern)
  is present in the previous window but absent in the current →
  `"A large recurring campaign (~{sends} sends) present in the previous
  period was not sent in the current period."`
- If a new large campaign appeared in the current window → note it as
  context (may explain an unrelated rise).

Limit to pushes with `sends > 100,000` to avoid noise from small
targeted pushes.

#### 4. External context search (best-effort)

Perform a web search for recent news about the client that could explain
the variation. Use search queries such as:
- `"{Client name}" app push notification {current_window_start} to {current_window_end}`
- `"{Client name}" actualité {month} {year}` (or in English for non-French clients)

Extract up to 2 relevant headlines or events. If nothing relevant is
found, skip this check silently.

Possible causes to flag:
- App store outage or OS update affecting push delivery
- Major news event driving unusual app opens (spike in previous window)
- Client-side campaign pause or scheduling issue
- Public incident (app crash, data breach) that may have driven opt-outs

#### 5. Hypothesis output format

For each triggered alert, produce:

```
possible_cause: "Short plain-language hypothesis (1–2 sentences).
  Source: [cross-metric | day analysis | campaign data | web search | none]"
```

Example outputs:
- `"App opens drop is consistent with the -38% push send reduction. No sends on Jun 17 (previous Jun 10: 671K).  Source: cross-metric + day analysis"`
- `"A large campaign (~2.8M sends) present Jun 9–11 was not replicated in the current period. Source: campaign data"`
- `"No clear cause identified from available data. Recommend checking campaign calendar."`

### Step 8 — Anti-duplication check

Compare the set of triggered alert keys against the **open alerts list** read
from the canvas in Step 6.

- **New alert** (key not in open list) → add to "alerts to post"
- **Resolved alert** (key was open, threshold no longer breached) → add to
  "resolutions to post"
- **Ongoing alert** (key still breached, already open) → do NOT post again,
  only update `last_seen_date` in the canvas

### Step 9 — Post Slack messages

**Only if there are new alerts or resolutions to post.**

`{canvas_url}` is the Slack canvas URL derived from the canvas ID in the
automation prompt: `https://app.slack.com/docs/{canvas_id}` — or use the
URL returned by `slack_create_canvas` / `slack_update_canvas`.

#### New alerts message

Use `slack_send_message` to the channel from the automation prompt.

```
🔴 KPI Alert — {Client name} — {current_window_start} → {current_window_end}

**{Section}**
| Metric              | Prev 7d          | Last 7d          | Δ                |
|---------------------|------------------|------------------|------------------|
| {kpi_label}         | {prev_value}     | {curr_value}     | {delta_str}      |

> 🔍 **Possible cause:** {possible_cause}

_(Source: Airship Reports API — period data · [📊 KPI Canvas]({canvas_url}))_
```

Include only triggered KPIs grouped by section (App, Mobile Push, Email,
Web Push, Devices, Custom Events). Do not include passing KPIs.

Each triggered KPI section must be followed by its `> 🔍 Possible cause:`
line. If multiple alerts share the same root cause, merge them into one
cause line at the bottom of the message. If no cause was identified, write:
`> 🔍 Possible cause: No clear cause identified from available data. Recommend checking campaign calendar.`

**Labeling rules (mandatory):**

- Push opt-outs must appear as **"Push opt-outs (vs sends)"** — never just
  "Opt-outs". Always show both the raw count AND the opt-out rate per send on
  the same row:

  ```
  | Push opt-outs (vs sends) | 1.68M (7.7%) | 2.44M (5.7%) | ⬆️ +45% raw / ⬇️ -2.1 pts rate |
  ```

  Add a footnote line under the table when the raw count rose but the rate
  *improved*:
  `> ℹ️ Raw count increase is volume-driven (push sends also +98%); opt-out rate per send improved.`

- Email unsubscribes (tracked under **Email**, not Push) must appear as
  **"Email unsubscribes (vs delivered)"** and show the rate = unsubscribes /
  delivered * 100.

- Direct response rate must appear as **"Direct click rate (vs sends)"**.

- Email open rate must appear as **"Email open rate (vs delivered)"** — the
  denominator is delivered, not injected, not total sends.

- Email deliverability must appear as **"Email deliverability (delivery / injection)"**.

- Email bounce rate must appear as **"Email bounce rate (vs injection)"**.

If `alert_language: fr`, translate all labels and section names to French,
keeping the denominator clarification in parentheses.

#### Resolution message (when an alert clears)

```
✅ KPI Resolved — {Client name} — {today}
{kpi_label} is back within normal range.
[📊 KPI Canvas]({canvas_url})
```

### Step 10 — Update the canvas

Use `slack_update_canvas` (or `slack_create_canvas` if no canvas ID yet) to
maintain the weekly state canvas. The canvas format:

```
# KPI Monitor — {Client name}

## Open Alerts
| Alert key              | Opened     | Last seen  |
|------------------------|------------|------------|
| push_sends_drop        | 2026-06-15 | 2026-06-22 |

## Devices History (daily snapshot)
| Date       | iOS devices | iOS opted-in | iOS uninstalled | Android devices | Android opted-in | Android uninstalled | Web opted-in |
|------------|-------------|--------------|-----------------|-----------------|------------------|---------------------|--------------|
| 2026-06-22 | 5,173,277   | 967,720      | 10,040,083      | 3,574,033       | 1,522,285        | 8,964,751           | 0            |
| 2026-06-21 | ...         |              |                 |                 |                  |                     |              |

## Last run
{today} {current_window_start}→{current_window_end} vs {previous_window_start}→{previous_window_end}
```

Update rules:
1. Prepend a new row to the Devices History table (keep last 30 rows max)
2. Add new open alerts to the Open Alerts table
3. Remove resolved alerts from the Open Alerts table
4. Update the Last run line

**If no canvas ID was provided** (first run):
- Call `slack_create_canvas` with the initial content above
- Return the canvas ID so the TAM can copy it into the automation prompt

## Output

After each run, print a summary to the agent log:

```
[airship-kpi-monitor] {Client name} — run {today}
  Windows: {current_window_start}→{current_window_end} vs {previous_window_start}→{previous_window_end}
  New alerts: {count} | Resolutions: {count} | Ongoing: {count}
  Canvas updated: {canvas_id}
  Slack message posted: {yes/no}
```

## Error handling

- If an API call returns 401/403, log `"scope unavailable: {endpoint}"` and
  skip the related KPIs (do not alert on missing data).
- If `events` pages exceed 20 pages for one window, log a warning and
  continue (do not abort).
- If `slack_read_canvas` fails (canvas not found or empty), treat as first run.
- If `slack_create_canvas` is unavailable, skip canvas creation and log a
  warning — still post Slack alerts if thresholds are breached.
