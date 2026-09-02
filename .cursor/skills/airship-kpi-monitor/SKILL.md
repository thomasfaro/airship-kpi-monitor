---
name: airship-kpi-monitor
description: >-
  Airship KPI monitoring with rolling 30-day window comparison, analysed
  per OS (iOS / Android). Detects significant variations in app opens, time in
  app, push sends, direct response rate (tracking-health signal),
  opt-in/opt-out ratio, email metrics (including daily spam complaint and delay
  rates), web push, and SMS sends and delivery rate. The 30-day
  window smooths out day-level noise; fast incident checks (daily spam complaint,
  hourly email delay, absolute deliverability and bounce ceilings) stay on their
  own short cadence so a live incident is never averaged away. A
  multi-run confirmation gate + hysteresis + cadence-aware suppression removes
  false positives: a breach must persist across runs before it counts. Alert
  tracking lives in the local dashboard (candidates with a streak, confirmed
  alerts with context, a recently-resolved log) — Slack stays quiet except a rare,
  throttled critical escalation and a light weekly recap (top one-shot + unicast
  campaigns with previews). Maintains a
  short, visual per-project Slack canvas: key metrics as scannable per-section
  tables with per-OS detail and vertical benchmarks, over the same last 30 days
  against the previous 30 days that drive alerting, an email
  block with a 0-100 SparkPost-based sender score when the
  project sends email, and confirmed critical (red) alerts. The local dashboard holds the full
  picture (every KPI, candidates, watch alerts, history). Every analysed campaign
  in the weekly recap is positioned against its market benchmark (push → vertical
  direct-open band, message center → vertical read-rate band, email → the client's
  own internal baseline).
  Uses the Airship Reports API via MCP and the Slack MCP plugin. Triggered from
  Cursor chat as a one-off, or as a recurring weekly loop via "run kpi weekly" /
  "start the weekly loop" / "lance le monitoring hebdomadaire" (or /loop
  directly). Weekly is the intended cadence: on a 30-day window two consecutive
  daily runs share 29 days of data, so daily runs mostly re-read the same
  numbers.
model: claude-sonnet
# Always use the latest available Claude Sonnet version in the Cursor
# Automations editor — do not pin a specific version number (e.g. 4-5, 4-6).
# When a new Sonnet version is released, simply select it in the editor;
# no change to this file is required.
---

# Airship KPI Monitor — Rolling 30-Day Window Check

Monitor an Airship project's key metrics, comparing the **last 30 complete days
(D-30 → D-1)** against the **previous 30 days (D-60 → D-31)**. App and push
KPIs are analysed **per OS (iOS / Android)** so a single-platform regression is
never masked by the other platform's volume. A breach must clear the
**confirmation gate** (persist `alert_confirm_runs` runs, Step 8a) before it
counts as a real alert. All
alert tracking (candidates, confirmed, recently resolved) lives in the **local
dashboard**; the Slack channel stays quiet, receiving only a rare **throttled
critical escalation** (Step 10) and a light **weekly recap** (Step 10b).

**One window drives everything.** The same 30-day vs previous-30-day comparison
feeds alerting (Steps 8–10), the local dashboard (Step 13) and the client-facing
Slack canvas (Step 11), so a delta shown to a TAM and a delta shown to a client
are the same number. This is a deliberate change from the older design, where
alerting ran on a noisy 7-day window and the canvas on a separate 30-day one:
the two Δ sets could not be reconciled, and the 7-day window generated most of
the false positives the confirmation gate then had to absorb.

**Intended cadence: weekly.** A 30-day window moves slowly — two consecutive
*daily* runs share 29 of 30 days, so they re-read almost the same numbers and
the confirmation gate degenerates into a rubber stamp. Run **once a week**:
consecutive runs then share 23 of 30 days, `streak` counts weeks, and
`alert_confirm_runs: 2` means "still breaching a week later". Daily runs remain
supported and harmless, but confirm/resolve latency is then measured in days of
mostly-identical data rather than in independent evidence.

**Windowed comparisons are smoothed; incident checks are not.** The 30-day
window applies to volume and trend comparisons. Checks that exist to catch a
*live* incident — daily spam complaint rate, hourly email delay rate, and the
absolute deliverability / bounce / SMS delivery floors — keep evaluating on
their own short cadence **within** the 30-day window, so an incident still
surfaces on the next run instead of being diluted into a monthly average. See
**Fast incident checks** in Step 8.

The Slack canvas (Step 11) renders those same KPIs
as one **scannable table per section** with **per-OS detail** and
**vertical benchmarks**, plus an **email** block with a **sender score** on email
projects and
**confirmed critical (🔴) alerts only**. Candidates, watch (🟡) alerts, muted
keys, history, and weekly insights live in the **local dashboard**, not on the
client-facing canvas. The heavy Step 7b weekly insights still feed the **weekly
recap** (Step 10b) and dashboard analysis sentences — they are **not** rendered
on the Slack canvas.

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
market benchmarks in the weekly recap (Step 7b / Step 10b) and the dashboard. It
is auto-deduced from `Brand name` at setup and editable in the local dashboard.
Defaults to `all_verticals` when unknown.

`Run scope` selects how much of the workflow to execute (see **Run scopes**):
`full` (default — fetch + confirmation gate + short Slack canvas + local views +
any critical escalation / weekly recap), `canvas-only` (refresh the Slack canvas
only, with **no** Slack posts), or `alerts-only` (the light run:
confirmation gate + short canvas + local dashboard, skip the heavy weekly
insight fetch).

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
dashboard's recently-resolved log.) Build the
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
| `full` (default) | normal invocation, "run airship-kpi-monitor" | Steps 0–13: fetch + weekly insights (gated, Step 7b, for the recap + dashboard analysis) + confirmation gate (Step 8a) + classify (Step 9) + **critical escalation** (Step 10) + **weekly recap** (Step 10b, gated) + **short Slack canvas** (Step 11) + local views (Steps 12–13). |
| `canvas-only` | `canvas`, `canvas-only`, "update canvas only", "canvas refresh" | Steps 0–8a + Step 11 (short Slack canvas) + **Step 13** (dashboard data, so alert streaks persist). **Skips** Steps 9–10b (no Slack posts) and Step 12 (Cursor canvas) unless the prompt adds `+local`. Does **not** force Step 7b — the canvas no longer carries weekly insight sections. |
| `alerts-only` | `alerts-only`, "alerts only", "light run", "skip insights" | The light run: Steps 0–13 **but skip Step 7b** (no heavy weekly insight fetch; no weekly recap). Keeps the short canvas, the confirmation gate, and the local dashboard current. |

**`canvas-only` behaviour (detailed):**
- Run Steps 0–7 (fetch + read prior state) and Step 8/8a to **compute** the current
  alert state so the canvas critical-alerts table is accurate. Do **not** post
  anything: **skip Step 9** (classify), **Step 10** (escalation) and **Step 10b**
  (weekly recap). No Slack post other than the canvas update.
- **Skip Step 7b** — weekly insights feed the recap and dashboard analysis, not
  the canvas. Do **not** force them.
- **Skip Step 12** (Cursor canvas) by default. **Do run Step 13** (HTML dashboard
  data rewrite) so confirmation streaks persist — the dashboard file is the
  gate's memory (see Step 8a). Include Step 12 only if the prompt adds `+local`.
- Read-only on mutes: use the muted state for display; do not sync mutes from the
  canvas unless a shown critical row was set to `Muted`.
- Useful to rebuild a project's short snapshot without posting. Scheduled
  `alerts-only` / `full` runs already refresh the same canvas.

**`alerts-only`** is the symmetrical light run: identical to `full` except Step 7b
is skipped, so an extra ad-hoc run stays cheap. `full` (default) does everything,
with the heavy weekly fetch (and the weekly recap) naturally rate-limited by the
weekly gate inside Step 7b — which at the intended weekly cadence means `full` is
the normal scope, and `alerts-only` is for extra runs between scheduled ones.

### Weekly loop shortcut

When the prompt is a bare **"run kpi weekly"**, **"start the weekly loop"**,
**"lance le monitoring hebdomadaire"**, or similar (i.e. the user wants the recurring
job, not a single run), arm a 7-day loop instead of running once. Use the `loop`
skill's fixed-schedule pattern:

> **Why weekly and not daily.** The analysis window is 30 days, so two runs a day
> apart share 29 of those days and produce nearly identical numbers while the
> confirmation gate — which counts *runs* — burns a step on non-independent
> evidence. A 7-day interval makes each run a genuinely new measurement. Accept a
> **"run kpi daily"** prompt for backward compatibility, but arm the weekly loop
> and say why.

1. First check existing terminals for an already-running
   `AGENT_LOOP_TICK_KPI_WEEKLY` loop; if present, report its PID and do not start a
   second one.
2. Arm one background shell loop (title `Loop every 7d: KPI weekly monitoring`),
   monitoring output on `^AGENT_LOOP_TICK_KPI_WEEKLY`:

```bash
while true; do
  sleep 604800
  echo 'AGENT_LOOP_TICK_KPI_WEEKLY {"prompt":"Run airship-kpi-monitor for all clients in clients.yml, scope full, regenerate the local dashboard (Step 13)."}'
done
```

3. Run the monitoring workflow **once immediately** in `full` scope for all
   clients (do not wait for the first tick).
4. On each tick, re-run the same `full` all-clients workflow and give a
   short summary of what changed. To stop, kill the loop PID and do not re-arm.

This is just a convenience wrapper around the multi-client run below
plus the `loop` skill — no separate skill needed. `full` is the right scope at a
weekly cadence: the Step 7b weekly-insights gate opens on roughly the same rhythm,
so there is no longer a cheap-daily / expensive-weekly split to arbitrate.

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
   | `muted_alerts` (optional list) | guards turned **off for good** on this client — surfaced in the dashboard as "Alerts off" (see **Muting false positives**) |
   | `dismissed_alerts` (optional list of `{key, opened, reason, since}`) | **one-shot** acknowledgements: this *occurrence* was accepted, the guard stays on. `opened` pins the alert's `openedAt`; when that no longer matches, the alert is raised again (see **Dismissed occurrences**) |
   | `dismissed_suggestions` (optional list of threshold keys) | threshold-suggestion keys a TAM dismissed from the dashboard — the skill must **not** re-emit them in `thresholdSuggestions[]` (see Step 13 **Threshold suggestions**) |
   | `watched_alerts` (optional list of `{key, reason, since}`) | **Context**: a standing note on what a KPI means for this client, written from the dashboard and read back on every run (see Step 13 **Context notes**) |

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
   queried. For `canvas-only` runs, skip the Slack alert posts and the Cursor
   canvas (Step 12) as described in **Run scopes**; still run Step 13 so
   confirmation streaks persist.

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
   time, industry, and Slack canvas link. Step 12 is skipped for `canvas-only`
   runs unless `+local` was requested; **Step 13 always runs** (alert-state
   memory).

## Muting false positives

A TAM can mark an alert as a **false positive** so it is **no longer monitored**:
it is never posted to Slack (neither a new-alert nor a resolution message) but
stays **visible and flagged "Muted"** on the Cursor canvas and the HTML
dashboard. Confirmed critical alerts that are muted are **dropped from the Slack
canvas** (that canvas only shows active red alerts). A mute is **permanent until
unmuted**.

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
family form is retained for any key carrying a `:` suffix, and for legacy
entries: since custom events stopped being monitored no key in the current
catalogue uses one, so in practice a mute now matches a key exactly. A leftover
`custom_event_*` entry matches nothing and can be deleted.

### Dismissed occurrences — not the same thing as a mute

A mute is a decision about the **guard**: stop alerting on this KPI for this
client until someone turns it back on. A dismissal is a decision about **one
occurrence**: this particular alert has been seen and accepted — the threshold
was just retuned, the drop was expected after a migration — but the guard stays
armed. Conflating the two is how a genuine incident ends up silenced months
later by a mute somebody added to clear a one-off.

```yaml
dismissed_alerts:
  - key: email_delay_high
    opened: 2026-08-28        # the alert's openedAt — this is what pins it
    reason: "Threshold re-based to 20%; current level is expected"
    since: 2026-09-02
```

**Matching.** An entry silences an alert only while `entry.opened ==
alert.openedAt`. When the alert resolves and a *new* one opens on a later date,
the dates diverge and the alert surfaces again on its own — no cleanup needed.
An entry written by hand with no `opened` dismisses whatever is open now.
Dismissed alerts are excluded from the open-alert count and from severity, but
they are **not** resolutions: never write them to the resolved log.

**On screen.** A dismissed card returns to **OK** — a dismissal means the TAM
handled it, so leaving the card dimmed made it read as *disabled*, which is the
other action. Only `muted_alerts` dims a card ("Alerts off"). The dismissal stays
legible without the grey: the card keeps an **Undismiss** button, the cause line
still names the breach that was accepted, and the chip's tooltip says the
occurrence was acknowledged.

### Context notes (`watched_alerts`)

The dashboard's **Context** action stores a standing note about what a KPI means
for this client — "sends are seasonal, two peaks a year", "the drop in July is
the app-store migration". It is written to `watched_alerts` (the key is
historical; the UI no longer calls this "watching") and **read back on every
run**: use it when narrating that KPI rather than re-deriving the explanation,
and never overwrite or drop it. It carries no alerting semantics on its own.

### Three ways to declare a mute (all converge on `clients.yml`)

1. **Chat prompt** — recognise these canonical forms (case-insensitive, quotes
   optional) and act on them as a lightweight operation, **without** running the
   full KPI workflow unless asked:
   - Mute: `Mute airship-kpi-monitor alert "<key>" for project "<project>" (false positive). Reason: <reason>`
   - Unmute: `Unmute airship-kpi-monitor alert "<key>" for project "<project>"`
   Steps: find the matching `clients.yml` entry by `name` (or `brand_name`);
   for a mute, add/update the `key` in its `muted_alerts` (dedupe by key, keep
   the newest `reason`); for an unmute, remove that key. Then, best-effort,
   refresh that project's mute flags on the HTML dashboard (Step 13) and, if a
   confirmed critical alert was showing, drop it from the Slack canvas on the
   next Step 11 rewrite. Confirm the
   change to the user. If the project is not found, report it and stop.

2. **Dashboard "Mute" button** — the local HTML dashboard has two modes:
   - **Served** (the optional local server `dashboard/serve.py` is running, e.g.
     auto-started by the `start-dashboard.sh` hook): the Mute/Unmute buttons
     **apply directly**, writing `clients.yml` via the server (no chat round-trip).
   - **Static** (`file://`, no server): the button **copies the canonical prompt
     above**; the user pastes it into Cursor chat, which lands in case 1.

3. **Slack canvas edit** — a TAM sets a shown critical alert's **Status** to
   `Muted` (and may add a reason) directly in the per-project canvas critical-
   alerts table. The skill reads this canvas every run (Step 7); on the **next
   run** it honours the Muted status and **syncs it into `clients.yml`
   `muted_alerts`** (union with existing; dedupe by key). Watch / candidate
   mutes are declared from the dashboard or chat, not from the short canvas.
   This is not real-time — the skill is a Cursor-triggered agent that polls
   each run, not a hosted Slack bot.

### Enforcement (during a run)

In **Step 8a / Step 9**, before a breach can become a candidate/confirmed alert,
check it against the merged mute set (`clients.yml` `muted_alerts` ∪ any canvas
rows already marked `Muted`). If it matches, classify it **Muted**: it never
becomes a candidate, is never confirmed, and is never escalated to Slack; still
record it in dashboard `alertsList` with `muted: true` and **do not** list it on
the Slack canvas. Muted alerts are excluded from any "worst severity" used to
summarise active alerts, but remain visible on the dashboard with their reason.

### Mute reasons as accumulated intelligence (later analyses)

A mute `reason` is **more than a label** — it is TAM-authored domain knowledge
about what is normal/expected for that client. On every subsequent run the agent
**reads these reasons as a prior** when analysing *non-muted* alerts (see
**Step 8b check 0**):
- a **new** alert in the same key family as a muted one inherits the muted
  reason as a strong hypothesis (e.g. a new high-volume-blast delay day is
  recognised as the same expected pattern), producing a smarter `possible_cause`;
- a muted "watch only" metric that **worsens materially** vs when it was muted is
  flagged in the dashboard trend so a human can decide to unmute (the
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
| Opt-in / opt-out ratio (per OS) | `/api/reports/optins` ÷ `/api/reports/optouts` | Daily opt-ins ÷ opt-outs (iOS/Android only — neither endpoint returns a web/SMS series). Both endpoints are still fetched exactly as before; they now feed this **App & engagement** ratio card instead of a standalone "Opt-in registrations" tile. Ratio > 1 = net-positive reach that day; < 1 = churn-dominant |
| Push pressure per user per 30 days (family `push_pressure_per_user`, Push section) | `/api/reports/sends` ÷ `/api/reports/devices?date=` | Window push sends (iOS+android) ÷ opted-in devices, unit `msg/user/30d`. Denominator is the opted-in base at the window end via `/api/reports/devices?date=<date>` (batched, Step 6); falls back to the current opted-in snapshot **labelled a proxy** when a dated call is unavailable. `series` is a rolling 30-day value sampled weekly. Promotes the Step 7b marketing-pressure formula to a per-project dashboard family |
| Click rate (direct responses, per OS) | `/api/reports/responses` | rate = direct / push sends (labelled "Click rate" in outputs) |
| Time in app (per OS) | `/api/reports/timeinapp` | avg value/day returned by Airship |
| Total devices evolution (family `total_devices_evolution`, Acquisition section, per OS + total) | `/api/reports/devices?date=<window start>` + `/api/reports/devices?date=<window end / today>` | `GET /api/reports/devices?date=<date-time>` counts **all device events that occurred before that date-time** and returns `total_unique_devices` + `counts.{ios,android,amazon,sms,web}.{unique_devices,opted_in,opted_out,uninstalled}` + `date_closed`/`date_computed`. Fetch it at **two dates** (window start & end) and diff: evolution = (end − start) ÷ start × 100 over the window, per OS + total. Alerts on a strong decline. **Merges** the former `installs` proxy and canvas-history-based `devices_unique` trend into one family — no canvas Devices-History dependency any more |
| Opted-in / uninstalled devices — two-date evolution (per OS) | `/api/reports/devices?date=<start>` + `/api/reports/devices?date=<end>` | Same two dated calls: Δ% = change of `counts.{os}.opted_in` / `.uninstalled` between the window-start and window-end calls (opted-in drop / uninstalls rise alert). When only ONE dated call is available, emit the **current absolute value** per OS (status `ok`, note `Evolution n/a`), never a greyed-out `na` |
| Email sends | `/api/reports/sends` | raw count (field `email`). **The only email figure Airship still provides** — a send is an Airship concept |
| Email deliverability / bounce / hard & block bounce / spam complaint / delay / open / click-to-open / unsubscribe | **SparkPost Metrics API** (Step 3e), `sending_domains=<domain>` | **Per sending domain, one call per domain**, recombined to project level from raw counts — never averaged. Denominators in Step 8. Computed on *injections*, so they deliberately do not tie out with the Airship send count |
| Email fast incident checks (daily / hourly) | **SparkPost** `/metrics/deliverability/time-series` `precision=day` | One call per domain returns the whole window's daily rows, so the per-day incident checks cost nothing extra — the old design spent 30 `events` calls per client to get the same series |
| Email campaigns (delay root cause) | `/api/reports/responses/list`, `/api/reports/perpush/pushbody/{push_id}` | top sends on the impacted day; `message_name` only. SparkPost names the receiving domain and the remote MTA's verbatim reason, which usually settles the cause before this step is needed |
| SMS sends | `/api/reports/sends` | raw count (field `sms`) |
| SMS devices snapshot | `/api/reports/devices` | `sms.unique_devices`, `sms.opted_in`, `sms.opted_out`, `sms.uninstalled` |
| Web push sends | `/api/reports/sends` | raw count (field `web`) |
| Web push devices snapshot | `/api/reports/devices` | `web.unique_devices`, `web.opted_in` |
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

- **Slack canvas — no campaign content.** The short canvas (Step 11) lists
  last-run key metrics, email health, and confirmed critical alerts only. It
  never carries campaign names, titles, bodies, or HTML.
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

current_window_start  = yesterday - 29 days  (D-30 → D-1, 30 days)
current_window_end    = yesterday

previous_window_start = yesterday - 59 days  (D-60 → D-31, 30 days)
previous_window_end   = yesterday - 30 days
```

Both windows are exactly **30 days**, back-to-back, ending yesterday — a fixed
30/30 split, not calendar months (which have unequal lengths and would make
consecutive runs incomparable). The full span fetched per run is therefore
**60 days** (`previous_window_start` … `current_window_end`).

> **Why 30 and not 7.** A 7-day window is dominated by campaign timing: one
> extra send day, a bank holiday or a weekend shift moves a KPI 20–40% with
> nothing wrong underneath. That noise was the dominant source of false
> positives. Over 30 days a single anomalous day carries ~3% of the window
> instead of ~14%, so the deltas reflect real trend rather than scheduling.
> The cost is detection latency on windowed comparisons, which is why the fast
> incident checks in Step 8 are deliberately exempt from the smoothing.

Format all dates as `YYYY-MM-DD`. Derive `today` from the **current time in the
project's `time_zone`** so the last complete day matches the client's calendar
(important when a run fires just after UTC midnight). Never include today
(partial data). Capture `run_timestamp` once at run start — it records the
**time** the run executed (not just the date) and is surfaced in the Output
summary and the local monitoring canvas (Step 12).

**Weekly-insights gate.** Step 7b (3-month history, benchmark, top campaigns)
refreshes on a **weekly cadence**, to keep any extra ad-hoc run cheap. It feeds
the **weekly recap** (Step 10b) and dashboard `analysis` sentences — **not** the
Slack canvas. Decide whether to run Step 7b now:

```
# Read the marker from the canvas footer (Step 7 reads the canvas anyway):
#   _Insights refreshed: YYYY-MM-DD_
last_insights_refresh = parse that marker (or none if absent)

run_weekly_insights =
     run_scope != "alerts-only" AND run_scope != "canvas-only" AND (
        last_insights_refresh is none                # never built yet / first run
     OR (today - last_insights_refresh) >= 7 days    # weekly cadence (robust to missed runs)
     )
```

`alerts-only` and `canvas-only` never run Step 7b. `full` runs it only when the
gate opens. When `run_weekly_insights` is false, **skip Step 7b**.

### Step 0b — Optimized fetch plan (batching, de-dup & channel gating)

The steps below are written as a numbered narrative for clarity, but many of
their MCP calls are **independent** and should be issued **in parallel** to cut
wall-clock time. This is a pure execution optimization: **no precision is lost,
no windowing/confirmation-gate/data-quality semantics change, and no step is
reordered beyond batching independent calls**. Apply these three rules:

1. **De-duplicate the 90d / 60d overlap — weekly runs only.** When
   `run_weekly_insights` is true, the Step 7b 3-month history already fetches
   `opens` / `sends` / `optins` / `optouts` over ~91 days `precision=DAILY`. The
   60-day analysis span now sits **entirely inside** that 90-day range, so on a
   weekly run **fetch each of these four series once over the 90-day range and
   slice both windows** ([`previous_window_start` … `current_window_end`])
   out of the same rows for Step 1 — do **not** issue a second 60-day call for a
   series already covered by the 90-day pull. On `alerts-only` runs
   (no Step 7b), keep the standalone 60-day Step 1 calls. `timeinapp`
   (Step 5) is exempt — its 3-month pull is `MONTHLY`, so the 60-day `DAILY`
   call stays separate.

2. **Channel-activity gating — skip unused channels.** Before fetching, decide
   which channels the project actually uses (device base or send volume in the
   window / prior state): **skip the SparkPost per-domain calls** (Step 3e, which
   also supply Step 3b's daily rows) when the project sends no email; **skip the
   web-push fetches** when web is inactive. SMS needs no gating any more — it is
   one field of the `sends` call already being made. This mirrors the Step 13
   "active channels only" coverage rule so no work is done for channels that emit
   no cards or alerts.

3. **Parallel MCP batching — batch independent GETs into parallel turns.**
   - **Batch A (period metrics, Step 1):** `sends`, `opens`, `optins`, `optouts`
     — one parallel turn (after the single cheap token-refresh probe of Step 1).
   - **Batch B (independent single-shots):** the two dated `/api/reports/devices?date=`
     calls (Step 6, window start & end), the per-week push-pressure
     `devices?date=<week end>` calls (Change 2), `responses` (Step 4),
     `timeinapp` (Step 5) — all independent of Batch A and of each other, so issue
     them **in parallel**.
   - **Email (Steps 3b + 3e): one SparkPost call set per SENDING DOMAIN**, not
     per project, and not per day. Each returns the window totals, the previous
     window, the daily series, and the provider / receiving-domain / reason
     breakdowns. **Cap SparkPost concurrency at 2** and back off exponentially on
     HTTP 429 — the account is throttled and the per-domain fan-out is already
     several calls deep.
   - This replaced a 30-call-per-client daily `events` loop plus 24 hourly calls
     per candidate day. That loop was the main cost of the 30-day switch and the
     original reason the cadence is weekly; the cadence stays weekly now for a
     different reason — the confirmation gate counts *runs*, and two runs a day
     apart share 29 of their 30 days.
   - Keep **dependent** work ordered: Step 8/8a still consume the fully-fetched
     series, and Step 3c only runs for a newly-confirmed delay alert.

The canonical per-step definitions (params, windows, precision) below are
unchanged — Step 0b only governs **how** their independent calls are grouped.

### Step 1 — Fetch period metrics (60 days DAILY in one call each)

Call via MCP `call_airship_api` on the **Airship MCP server** specified in the
automation prompt. Every call here (and in all later steps) is subject to the
**transient-error retry policy** in *Error handling* — retry `401 Expired
token` / `40101`, `429`, and `5xx` with back-off before treating them as fatal.
Make one cheap probe call first (a single-day `opens`) and let it refresh the
token before issuing the full set of Step 1 calls. Issue the four calls below as
**one parallel batch** (Step 0b, Batch A). When Step 7b runs, do **not** issue
these 60-day calls at all for `sends`/`opens`/`optins`/`optouts` — slice both
windows out of the 90-day series already fetched for Step 7b (Step 0b
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

### Step 2 — Email system events *(retired — no call)*

**`/api/reports/events` is no longer called at all.** Every email figure except
`email_sends` now comes from SparkPost, per sending domain (Step 3e), and the
last other consumer (`sms_delivery_rate`) was dropped with it.

The endpoint was the run's entire cost centre: every other Reports endpoint
answers a 60-day daily range in **4–6 s**, while `events` took **~4 s for a
single day** and **~335 s for a 30-day range**. It has no event-name filter and
pages at 100 rows, so its cost scaled with the project's *total* event volume
rather than with the handful of names actually wanted. SparkPost answers the
same questions in ~1.6 s, and adds the per-domain and per-IP split Airship never
offered.

Two reasons beyond speed, both of which held up under measurement:

- The account-wide Airship figure **hid per-domain collapses** — the exact
  failure the per-domain split exists to catch.
- Volumes reconcile well enough to trust the swap: Client Alpha matches Airship exactly,
  Client Charlie and Client Delta fall within 0.1%, Client Bravo runs ~8% under. That last
  gap is an **accepted, documented tolerance** — the two systems count at
  different stages, so do not try to reconcile them to zero.

If you are ever tempted to bring the endpoint back, budget for it explicitly:
never issue two `events` range calls concurrently for the same project, and keep
global client concurrency at 2.

### Step 3 — SMS *(volume only)*

> **Client custom events are not monitored.** App-level custom events are
> campaign- and release-driven: their names churn, they appear and vanish with
> each campaign, and their volume swings for reasons that say nothing about
> platform health. They generated alert noise that no TAM could action, so the
> whole `custom_event_*` family was removed. Do **not** emit KPIs, thresholds or
> alerts for them, and ignore any `custom_event_*` entry left over in a
> `clients.yml` `muted_alerts` list or in a stale dashboard snapshot.

SMS is now **volume only**, from `/api/reports/sends` (field `sms`).
`sms_delivery_rate` was dropped on 2026-09-01 for the same reason as custom
events: it measured **carrier** behaviour that no TAM can act on. It was also
the last consumer of `/api/reports/events`, so removing it retired the endpoint
outright. Its keys (`sms_delivery_rate_min`, `sms_delivery_rate_drop_pts`,
`min_sms_dispatched`) are gone from the catalog, and a leftover override in a
`clients.yml` now matches nothing and can be deleted.

### Step 3b — Email deliverability health, per day (from SparkPost)

**No Airship call is made here.** This step used to issue one
`/api/reports/events` call per day (30 per client) plus 24 hourly calls per
candidate day, and it was the single biggest cost in the run: `events` answers a
30-day range in ~335 s against ~1.6 s for the equivalent SparkPost pull. The
daily rows now come free with the Step 3e per-domain call
(`/metrics/deliverability/time-series`, `precision=day`), which returns the whole
window in one response **per sending domain**.

For each domain, for each date `d` in the current window:

```
deliverability_{d}      = delivered_{d}           / injected_{d}  * 100
bounce_rate_{d}         = bounce_{d}              / injected_{d}  * 100
spam_complaint_rate_{d} = spam_complaint_{d}      / delivered_{d} * 100
delay_rate_{d}          = count_delayed_first_{d} / injected_{d}  * 100
```

Skip a day if `delivered_{d} < min_email_delivery_day` (log `"skipped: low
volume"`), and skip the domain entirely if it is under `min_email_sends`.

A key fires when the **most recent `incident_days_consecutive` days** all
breach — not any day in the window. Two consequences worth stating because they
look like bugs otherwise: a KPI card can read healthy on its 30-day figure while
its alert is active on the recent days, and these keys **resolve on the tail of
the window**, where an "any breaching day" rule would pin an alert open for a
month. Scope the alert to the domain that breached (`scope: [domain]`), never to
the project.

Run this step only for projects that sent email in the window
(`email_sends_current > 0`); otherwise omit the email KPIs entirely.

### Step 3b.5 — Hourly confirmation *(retired)*

The daily rate used to be a pre-filter needing hourly confirmation across
`email_delay_min_consecutive_hours`, because the old delay ratio was built from
retry *events* against same-bucket deliveries and was unbounded and noisy. With
`count_delayed_first / injected` the daily figure is a bounded share of messages,
and `incident_days_consecutive` supplies the persistence test the hourly scan
used to provide — at 1/30th of the calls. **Do not reintroduce the hourly loop.**

If an hour-of-day pattern is ever needed for root cause (Step 3c), get it from
SparkPost with `precision=hour` on the affected day and domain, which is one call
rather than 24.

**One alert per sending domain per issue type.** Do **not** emit one alert per
day: a single `email_delay_high` fires per breaching domain, and its cause
aggregates the confirmed days (count, date range, peak rate + date). Days that
breach but fall short of `incident_days_consecutive` are **logged** in the
dashboard metric `note` / `series` with their actual rate and do not contribute
to the alert.

The domain, not the project, is the unit — a project sending on two domains can
legitimately hold one open alert and one healthy domain at the same time, and
each keeps its own confirmation streak.

### Step 3c — Email delay drill-down (only when `email_delay_high` is newly confirmed)

Run this step **only** when the single `email_delay_high` alert is **newly
confirmed** this run (`confirmed_new` from Step 8a — not ongoing). Run the
drill-down for each day in `confirmed_delay_days` (typically focus on the
**peak** day for the escalation / dashboard narrative; list the others compactly).

**The deferral MIX is the first thing to read** — `deferralClasses[]` from Step
3e already says whether this is a suspended IP, a reputation throttle, ordinary
traffic shaping or an ageing list, and those need entirely different responses.
Lead the drill-down with it, then reach for the hourly shape only if the mix does
not settle the cause.

#### 3c.1 — Hourly breakdown for day `D` (one SparkPost call, on demand)

Fetch it only when needed, scoped to the affected sending domain:

```
GET /metrics/deliverability/time-series
  params: from={D}T00:00, to={D}T23:59, precision=hour,
          sending_domains={domain}, timezone={time_zone},
          metrics=count_injected,count_delivered,count_delayed_first
→ delay_rate_h = count_delayed_first_h / count_injected_h * 100
```

That is **one** call, against the 24 the retired hourly loop issued. Mark hours
with `count_delivered_h < min_email_delivery_day` as low volume (show the counts,
flag the rate as non-significant). Hours are already local — SparkPost accepts
the `timezone` parameter, so no UTC conversion is needed, unlike the Airship
Reports API which always answers in UTC.

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
   rate on that message). Source: SparkPost /metrics/deliverability/time-series
   (precision=hour, scoped to the sending domain) + /api/reports/responses/list."`

If no campaign passes `min_email_campaign_sends`, state that delays may be
transactional/provider-wide rather than tied to a single blast.

### Step 3d — Gmail domain reputation (optional, email projects only)

Skip entirely when the project sends no email, or when this run is not
refreshing the canvas. This step is **fail-open**: any error, missing config or
missing dependency means "reputation unavailable" and the email block falls back
to the computed sender score (Step 11). Never block a run on it.

**1. Resolve the sending domain.** Prefer `clients.yml` → the client's
`email.sending_domains`. If absent, auto-detect it: take an email campaign from
the current window (Step 7b.3, or the largest `delivery.app = 0` row in
`/api/reports/activity/details`), call
`GET /api/reports/perpush/pushbody/{push_id}`, and read
`push.notification.email.sender_address` — the domain is the part after `@`.
`sender_name` and `reply_to` sit alongside it. Cache what you find back into
`clients.yml` under `email.sending_domains` with a comment naming the campaign
and date, so later runs skip the lookup.

> Unicast/transactional pushes return `{"push_body": ""}` — pick a real campaign.

**2. Fetch the reputation.** Only when the client has `email.postmaster: true`
and the global `postmaster_key_path` file exists:

```
uv run --with google-auth --with requests \
  scripts/postmaster_reputation.py --key {postmaster_key_path} \
  --domain {sending_domain} --days 30
```

Exit 0 = JSON summary on stdout. Exit 2 = no data (low Gmail volume, or the
2-3 day lag ate the window). Exit 3 = auth/access problem — surface it once in
chat so the TAM can chase the grant, then continue without it.

**3. What it means.** GPT is the **market reference for Gmail**, and only for
Gmail: it says nothing about Outlook, Yahoo or corporate MX. It grades the
**sending domain**, which is the client-specific axis — Airship delivers through
SparkPost **shared IP pools**, so IP-based scores (Validity Sender Score,
Microsoft SNDS) would grade the shared infrastructure identically for every
client and are deliberately not used here.

`domain_reputation_worst` is the worst day in the window, not an average: one
bad day is exactly what a TAM needs to see. Report the category verbatim
(`HIGH` / `MEDIUM` / `LOW` / `BAD`) — **never** convert it to a 0–100 number,
which would invent precision Google never published.

### Step 3e — SparkPost per-provider deliverability (optional, email projects only)

Same guard rails as Step 3d: skip when the project sends no email or the canvas
is not being refreshed, and **fail open** on any error. This step answers the two
questions Airship's Reports API cannot — *which mailbox provider* is degrading,
and *why* mail was delayed or bounced — because SparkPost is the infrastructure
that actually delivered it.

Run it only when the client has `email.sparkpost: true` and the global
`sparkpost_key_path` file exists.

**Loop over every domain in `email.sending_domains`, and keep the results
apart.** The domain is the unit here, not the project: a client can run a
healthy main domain next to a small one in trouble, and any average across them
buries the second. Client Echo is the worked case — 3.5% delay on
`mail.client-echo.example` against 49.6% on `tv.client-echo.example`, which carries
4% of the volume and would be invisible in a blended figure. When you need one
project number, **recombine it from the summed raw counts, never from the
per-domain rates**.

Run each domain **twice** — once for the current window, once for the previous
one — so the dashboard shows a SparkPost-to-SparkPost evolution instead of
pairing a SparkPost value with an Airship delta:

```
# current window, once per declared sending domain
uv run --with requests scripts/sparkpost_deliverability.py \
  --key-file {sparkpost_key_path} --region {client.region} \
  --sending-domain {domain} --timezone UTC --with-ips \
  --from {current_window_start}T00:00 --to {current_window_end +1d}T00:00 --limit 10

# previous window (same command, previous_window_* dates, --with-ips omitted)
```

`--with-ips` adds the per-sending-IP split and classifies each IP as shared or
dedicated by listing the *other* sending domains it served in the window. Ask
for it on the current window only — the exposure is a description of today's
setup, not a series. Two rules when reading it back:

- **A client's own other domains are not co-tenants.** Sharing an IP with
  yourself carries no reputation risk; exclude every domain declared for the
  same client before deciding an IP is shared. Skipping this makes a brand
  sending on two markets look like it is sitting in a crowd.
- **Never infer shared/dedicated from the pool name.** `<client>_mkt` and
  `<client>_tx` look conclusive and are not: 90% of Client Delta's volume runs over IPs
  that belong to no named pool at all, and `shared` carries clients that are
  perfectly healthy.

**Rate-limiting.** The per-IP fan-out multiplies calls (roughly `1 + 2 × IPs`
per domain) and SparkPost answers `429` well before the fleet is done. Keep
concurrency at 2 and retry `429` with exponential backoff — a `429` is
throttling, never a missing metric, and must never be recorded as one.

**Window alignment — get this right or the numbers are not comparable.** Three
rules, each of which has silently broken a run before:

- **`--from` / `--to`, never `--days`.** `--days` counts back from *now*, so it
  straddles a day boundary and yields figures that sit beside the Airship KPIs on
  the same page without covering the same days.
- **The end bound is exclusive.** To cover `2026-08-24 → 2026-08-30` inclusive,
  pass `--to 2026-08-31T00:00`. (Verified: the 6-day and 1-day slices sum exactly
  to the equivalent full-range call.)
- **`--timezone UTC`, not the client's `time_zone`.** Airship's Reports API always
  aggregates in UTC days; `clients.yml` `time_zone` only picks *which* dates the
  window covers (Step 0), it does not shift the data. Querying SparkPost in
  `Europe/Paris` would offset every day boundary by an hour or two against the
  Airship figures shown next to it.

Exit 0 = JSON on stdout. Exit 2 = no volume in the window. Exit 3 =
auth/permission/plan problem — surface it once in chat, then continue without it.

**The sending domain is the isolation boundary.** One key covers Airship's whole
SparkPost account, so an unfiltered call would mix clients together. The script
refuses to run without `--sending-domain` for that reason. If Step 3d could not
resolve a domain, **skip this step entirely** rather than falling back to
account-wide numbers.

**Where this output goes.** The **dashboard, not the canvas.** The canvas is the
client-facing snapshot and stays synthetic: it may carry at most one clause
naming the cause ("the delay is Gmail throttling") and otherwise points to the
dashboard. Everything below is written to the project's `deliverability` block in
`dashboard-data.js` (Step 13), which is the surface built for diagnosis.

The dashboard renders it **inside the existing Email KPI panel**, not as a section
of its own: findings above the cards, provider table and reason lists below them.
So every email figure lives in one place, and the account totals are **not**
emitted as separate tiles — each already has a KPI card, and duplicating it there
is exactly what this layout exists to avoid. Put the totals on the cards instead,
via `metrics[].sources` (Step 13).

Five things, in order of value:

1. **Write the diagnosis first.** `findings[]` is what a TAM opens the page for,
   so it renders above the numbers. Each entry is `{severity, title, detail}`
   with severity `danger` | `warning` | `info` | `success`. Aim for two to four:
   what is failing, what the reasons say the cause is, and what the *absence* of
   a signal rules out. A finding that only restates a rate is worth deleting —
   every one must move the reader toward an action.
2. **Name the failing provider.** `by_mailbox_provider` carries per-provider
   `delivery_rate`, `bounce_rate`, `delay_rate` and `spam_complaint_rate`. Map it
   to `providers[]` and add `share` (provider injections ÷ total injections × 100)
   so a bad rate on 0.2% of volume is visibly not the story. Order by volume.
3. **Keep the reason strings verbatim.** `top_delay_reasons` and
   `top_bounce_reasons` return what the remote MTA actually answered
   (`421-4.7.28 …unusual rate of unsolicited mail`). Copy them into
   `delayReasons[]` / `bounceClasses[]` unedited — the SMTP code and wording are
   the evidence, and the dashboard shows the full text on hover. Paraphrase them
   in `findings[]` instead, where the interpretation belongs.
3b. **Classify every deferral, and report the mix.** A single delay rate hides
   causes that demand opposite responses, so bucket each `delayReasons[]` row and
   emit the totals as `deferralClasses[]` (id, label, severity, share, count,
   receiving domains, plain-language meaning). The buckets, matched in this
   order because the strings overlap:

   | Bucket | Matches | Severity | What it means |
   |---|---|---|---|
   | `ip_suspended` | `sending IP temporarily suspended` | danger | SparkPost paused the IP itself. Infrastructure-level, holds up everything queued for that provider. |
   | `reputation_spam` | `unsolicited`, `4.7.650`, `due to IP reputation` | danger | Rate-limited on how recipients react. Slowing down does not clear it; engagement and hygiene do. |
   | `reputation_volume` | `unusual rate of mail originating from your DKIM/SPF` | warning | Gmail saw an abrupt volume change on the authenticated domain. Steady the daily volume. |
   | `throttle_session` | `too many connections`, `too many messages`, `slow down`, `limit exceeded for the session` | info | Ordinary traffic shaping. Costs retries, not reputation. Usually needs nothing. |
   | `mailbox_full` | `out of storage`, `4.2.2`, `over quota`, `BUZON LLENO` | info | Abandoned accounts. Age them out on repeated soft bounces. |
   | `mailbox_inactive` | `mailbox is inactive`, `address rejected`, `disabled` | warning | Dormant account — suppress before it hard-bounces. |
   | `dns_unreachable` | `no mail servers for this domain could be reached` | info | Typos captured at signup (`gamail.com`, `hotlail.fr`). Fix the form, not the send. |
   | `service_refused` | `service refuse`, `try later`, `4.7.0` | warning | Generic temporary refusal; sustained against one provider it precedes a block. |

   This is what makes the delay rate readable. In the 2026-09-01 run Client Alpha's
   deferrals were **82% `ip_suspended`** while Client Bravo's were **65%
   `mailbox_full`** — nearly the same headline rate, nothing else in common.
   **Never fire a reputation finding on a trace**: require ≥ 1,000 messages and
   ≥ 5% of the domain's deferrals, or `mail.client-foxtrot.example` raises a
   danger-level alarm off 63 messages.
4. **Attach both readings to the KPI card** via `metrics[].sources` (Step 13), so
   the same KPI is never shown twice on the page. SparkPost is the **primary**
   figure on every rate it measures (deliverability, open, bounce, spam complaint,
   delay) because it is the system that actually delivered; Airship stays primary
   for `email_sends` (a send is an Airship concept) and `email_unsubscribe`.
5. **Never silently substitute one for the other.** They divide by different
   denominators — SparkPost by injections, Airship by sends — and sometimes
   measure different things outright. Two real cases from Client Bravo:
   `email_sends` 4.79M vs 3.96M injections, and `email_delay_rate` 30.4% (Airship:
   the **worst single day**) vs 13.3% (SparkPost: the **window average**). When the
   two are not strictly comparable, say so in `sources.note` rather than
   overwriting a value. The alert threshold keeps running on the Airship series
   either way — the card states this automatically.

Then use the same reasons in the alert's own analysis line (Step 8b) so
`email_delay_high` or `email_bounce_high` says *why*, not just *how much*.

**Two things are deliberately absent.** The SparkPost **Health Score** has no
public API endpoint — never claim to have fetched one; it reaches TAMs as a Slack
alert configured in the SparkPost app (MODOP §1.8). Inbox-vs-spam **placement**
requires the paid Deliverability Add-On and returns `403` without it, so the
script omits those metrics and the canvas must not promise placement data.

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

**Opted-in base for push pressure (Change 2 / Step 7b):** the
`push_pressure_per_user` family needs the opted-in base at each weekly sample date
of its rolling 30-day series. Batch one `GET /api/reports/devices?date=<sample date>`
per sample alongside the two window calls; fall back to the current opted-in
snapshot (labelled a proxy) for any sample whose dated call is unavailable.

### Step 7 — Read prior state (dashboard data + canvas)

Agents have no memory between runs. **Primary store = the local dashboard data
file**; the Slack canvas is a client-facing snapshot plus two footer markers.

1. **Dashboard data (primary — confirmation streaks).** Read
   `.cursor/skills/airship-kpi-monitor/dashboard/dashboard-data.js` if it exists
   and locate this project's entry. Parse:
   - `alertsList[]` — confirmed keys (`key`, `severity`, `openedAt`, `cause`,
     `muted`, `streak`, `clearStreak`, `lastEscalated`, `firstBreach`)
   - `candidatesList[]` — candidate keys (`key`, `severity`, `streak`, `needed`,
     `cause`, `firstBreach`)
   - `resolvedRecently[]` entries for this project (informational)
   If the file is missing, unparseable, or has no entry for this project, treat
   prior streak state as empty (first run / new project). Fail-open.

2. **Slack canvas (mutes on shown rows + throttle markers + legacy fallback).**
   ```
   slack_read_canvas(canvas_id)
   ```
   If `canvas_id` is empty (first run), skip the canvas read.

   Parse:
   - **`_Recap posted: YYYY-MM-DD`** footer — weekly recap throttle (Step 10b).
   - **`_Insights refreshed: YYYY-MM-DD`** footer — weekly-insights gate (Step 0).
   - **Critical alerts table** (new short canvas) — any row a TAM has set to
     `Muted` is a mute declared from Slack: merge its key into the run's mute
     set and **sync it into `clients.yml` `muted_alerts`**. Also parse a
     `· escalated {date}` Status suffix as `lastEscalated` (fills a gap if the
     dashboard file lacked it).
   - **Legacy `## 🚨 Open Alerts` table** — if the canvas has not been migrated
     yet, parse its rows the old way (`ALERT_KEY | os | opened | last_seen |
     status`) and use them as **fallback prior state** for keys missing from
     the dashboard file. Honour `Muted` rows as above. After this run, Step 11
     rebuilds the canvas in the short format and this fallback goes away.

Device **alert** metrics do **not** depend on a canvas D-7 row — they come from
the two dated `/api/reports/devices?date=` calls (Step 6). A missing canvas
history no longer blocks any device metric.

Merge prior state per key: dashboard file wins; canvas fills gaps (mute,
`lastEscalated`, legacy rows).

### Step 7b — Weekly insights (gated): 3-month history, benchmark, top campaigns, unicast

Run this step **only when `run_weekly_insights` is true** (the weekly-insights
gate in Step 0). Skipped on `alerts-only`, `canvas-only`, and on `full` runs that
fall inside the weekly window. It feeds the **weekly recap** (Step 10b) and
dashboard `analysis` sentences — **not** the Slack canvas. Everything here is
**read-only analytics**; never alert on it. All sub-blocks are **best-effort** —
if an endpoint/scope is missing, omit that block cleanly and keep the rest
(never fail the run).

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
3-month history AND the Step 1 60-day span — slice both 30-day windows out of
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
- **Opt-in rate trend** is a snapshot metric: use the dated
  `/api/reports/devices?date=` calls (Step 6) plus any `devices_*` series
  already in `dashboard-data.js`; do not synthesize it from the daily
  opt-in/opt-out event series, and do not depend on a canvas Devices-history
  table (that table is retired).
- Label **snapshot** metrics (opt-in rate, device base — from `devices`) and
  **period** metrics (opens, sends, opt-ins — summed over the bucket) distinctly.
  Time-in-app is an **average** metric — never sum it.

#### 7b.2 — Benchmark metrics vs industry (per device family)

Resolve the vertical: take the project `industry` (Step 0 input); match it to a
key in `benchmarks/benchmarks.json` directly or via each vertical's `aliases`
(e.g. telecom → `utility_productivity`, labelled as such). If nothing matches,
skip the benchmark read (**"industry benchmark not available"**) — never force a
mismatched vertical. These numbers feed the weekly recap and dashboard `analysis`,
not the Slack canvas.

Compute these client metrics **per device family** (`ios`, `android`, `web`),
each aligned to the benchmark's definition and denominator — **never blend OS**:

| Metric | Client value | Benchmark key |
|---|---|---|
| Push opt-in rate | `opted_in / unique` per OS (Step 6 `devices`, snapshot) | `optin_rate` |
| Direct open rate | `direct_{os} / sends_{os}` (Step 4 responses, 30-day window) | `direct_open_rate` |
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
   **Metadata only for the weekly recap ranking** — never surface the alert
   title/body/HTML except via the 7b.6 extractor for the recap preview
   (title / subject / short body, **no images**; see the **Campaign content &
   privacy policy**). A non-empty pushbody confirms a real
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
     own email average** over the same window. Compute it once per run from the
     **Step 3e SparkPost counts**, recombined across the client's sending domains
     — sum the raw counts first, then divide (never average the per-domain rates,
     see Step 3e):
     ```
     client_email_open_rate  = Σ count_unique_confirmed_opened / Σ count_delivered * 100
     client_email_click_rate = Σ count_unique_clicked          / Σ count_delivered * 100
     ```
     For each shortlisted email campaign, report its open/click **vs this baseline**
     as a signed delta in points with an arrow (**▲** above / **▼** below the
     client's own average). Skip the comparison cleanly when the baseline is
     undefined — the project sent no other email that window, or SparkPost is not
     enabled for it — and then just show the campaign's own rate.

     Note the deliberate source split: the **campaign's** own open/click come from
     `/api/reports/events/summary/perpush/{push_id}` (per-push, still live), while
     the **baseline** comes from SparkPost. They are measured at different stages,
     so treat the delta as an order-of-magnitude read, not an exact arithmetic
     identity — the same tolerance documented for volumes in Step 3e.
   - **Volume-floor honesty (`n/s`):** if `delivery < min_campaign_sends`, keep the
     **volume** but render the rate as **`n/s`** and **do not** compute a benchmark
     band. Never show a rate the volume can't support.
   - **Benchmark band (push/in-app):** compare the campaign's **direct open rate**
     against the vertical's **`direct_open_rate`** percentiles in
     `benchmarks/benchmarks.json` (the same source Step 7b.2 uses). Because a
     campaign's app delivery blends OSes, use as the reference
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
**weekly recap** (Step 10b) and dashboard `analysis` / `trend` — **not** for the
Slack canvas. Combine:

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

> **One 30-day window drives everything.** The rolling 30-day vs
> previous-30-day deltas computed here drive **all alerting** (Steps 8–10),
> everything written to the dashboard (Step 13) **and** the Slack canvas
> (Step 11). Unlike the previous design there is no second baseline: a delta is
> computed once and shown identically to the TAM and to the client. Candidates,
> watch alerts, and history stay in the dashboard.

#### Windowed comparisons vs fast incident checks

Two different kinds of threshold live below, and the 30-day window applies to
only one of them:

- **Windowed comparisons** (`*_drop_pct`, `*_rise_pct`, `*_drop_pts`, and the
  two-date device evolution keys) compare the current 30-day window against the
  previous one. These are the ones the switch smooths: a single odd day now
  carries ~3% of the window instead of ~14%, so campaign scheduling stops
  producing alerts.
- **Fast incident checks** (`email_spam_complaint_rate_max`,
  `email_delay_rate_max`, `email_deliverability_min`, `email_bounce_max`) are
  **not** averaged over 30 days. They are evaluated on the per-day rows from
  Step 3b (SparkPost daily rows, per sending domain) *inside* the current
  window, and breach when the **most recent `incident_days_consecutive` days**
  breach. A deliverability collapse therefore still surfaces on the next run
  instead of being diluted into a monthly average — which is the whole reason
  they are exempt.

Everything else is an absolute guardrail read on the current window
(`direct_response_rate_min`, `email_deliverability_min`, `push_pressure_per_user_max_30d`).

> ⚠️ **Migrating `custom_thresholds`.** Values in `clients.yml` were calibrated
> for a 7-day window and keep their old meaning against a 30-day one, which is
> almost never what you want — a `total_devices_evolution_drop_pct: 5` override
> now measures drift over a month instead of a week and will fire far more
> often. Review every per-project override against the new defaults below. The
> one key whose **unit** changed was renamed on purpose
> (`push_pressure_per_user_max` → `push_pressure_per_user_max_30d`) so stale
> overrides fall back to the new default instead of silently becoming ~4×
> stricter.

#### Default thresholds (overridden by custom thresholds in the prompt)

> These defaults are mirrored for the dashboard's per-project threshold editor in
> `dashboard/thresholds-catalog.js`. Keep the two in sync: any change here must be
> reflected there (and vice-versa). Per-project overrides live in `clients.yml`
> `custom_thresholds` (see **Editing thresholds**).

> **Calibration note.** These values were retuned for the 30-day window. The
> percentage-drop thresholds were roughly halved versus their 7-day ancestors:
> a 30-day sum carries about half the relative noise of a 7-day one, so keeping
> the old numbers would have meant only catastrophes ever fired. Conversely the
> **device-evolution** thresholds were *raised*, because they measure drift
> **across** the window — stretching that window from 7 to 30 days makes the
> same percentage far easier to reach, so unchanged values would have produced
> *more* alerts, not fewer. The `min_*` volume floors were scaled ~4× since they
> now gate a 30-day sum.

```yaml
# App (evaluated PER OS: ios, android)
app_opens_drop_pct: 25          # 30d drop > 25% on that OS → alert (was 40 on a 7d window)
app_opens_cross_os_gap_pts: 30   # OR |iOS Δ − Android Δ| > 30 pts → alert on BOTH OS

# Engagement / time in app (PER OS)
timeinapp_drop_pct: 15          # avg time-in-app drop > 15% → alert

# Acquisition — total devices evolution (per OS + total). Two-date growth/decline
# from /api/reports/devices?date=<window start> vs ?date=<window end> (Step 6).
# MERGES the former devices_unique_trend_drop_pct + installs proxy into one key.
# RAISED from 5: the window is now 30 days, so normal churn accumulates further.
total_devices_evolution_drop_pct: 10  # decline > 10% in TOTAL unique devices across the window → alert

# App engagement — opt-in / opt-out ratio (PER OS, iOS/Android only). Replaces
# the old standalone "Opt-in registrations" tile/threshold (optins_drop_pct).
optin_optout_ratio_drop_pct: 20  # avg ratio 30d drop > 20% AND within-window trend also declining → alert

# Push mobile (evaluated PER OS: ios, android)
push_sends_drop_pct: 100        # drop > 100% (i.e. zero sends) → alert
direct_response_rate_min: 0.5   # rate < 0.5% → alert (absolute, current window)
direct_response_collapse_pct: 40 # 30d drop of direct response RATE ≥ 40% on an OS → likely tracking/SDK issue

# Push pressure per user per 30 days (informational ceiling; family push_pressure_per_user).
# RENAMED from push_pressure_per_user_max (which was per WEEK) because the unit changed —
# a stale weekly override would otherwise silently become ~4x stricter.
push_pressure_per_user_max_30d: 60  # 30d push sends (iOS+Android) / opted-in devices > 60 → over-messaging ceiling (~2/day)

# Acquisition / opt-ins — device base TWO-DATE evolution (per OS), from the two
# dated /api/reports/devices?date= calls (Step 6), NOT a canvas D-7 snapshot. The
# opt-in EVENTS signal (formerly optins_drop_pct) now lives above under App
# engagement as the opt-in / opt-out ratio.
# Both RAISED from 5 / 10 for the same reason as total_devices_evolution_drop_pct.
devices_optin_drop_pct: 10      # opted-in devices drop > 10% across the window → alert
devices_uninstall_rise_pct: 25  # uninstalled devices rise > 25% across the window → alert
# net_optin_negative: alert if net (opt-ins − opt-outs) flips from ≥0 to <0

# Email — evaluated PER SENDING DOMAIN, never once per project (Step 3e).
# Every rate below comes from SparkPost; only email_sends comes from Airship.
#
# ENGAGEMENT gets RELATIVE guards, DELIVERABILITY gets ABSOLUTE ones. That split
# is deliberate: an engagement level describes what kind of programme a domain
# runs, while a deliverability level describes whether it is in trouble.
email_sends_drop_pct: 100       # drop > 100% (i.e. zero sends) → alert
email_open_rate_drop_pts: 4     # drop > 4 percentage points → alert
email_unsubscribe_rise_pct: 25  # rise > 25% → alert
email_ctor_drop_pct: 30         # click-to-open DROP > 30% vs the previous 30 days → alert.
                                #   NOT a floor. Measured across the fleet on 2026-09-01, CTOR
                                #   separates transactional mail (8–62%) from marketing broadcast
                                #   (0.2–2.4%), so any absolute floor fires on every marketing
                                #   domain at once and discriminates nothing. Apple MPP also
                                #   pre-opens messages, inflating the denominator and pushing the
                                #   whole scale below published CTOR benchmarks.

# Email FAST INCIDENT CHECKS — evaluated on per-day / per-hour rows inside the
# current window, NEVER on the 30-day average (see "Fast incident checks" above).
email_deliverability_min: 95    # per-day rate < 95% → alert (absolute)
email_bounce_max: 2             # per-day rate > 2% → alert (absolute)
email_hard_bounce_rate_max: 0.5   # hard_bounce / injected > 0.5% → alert. LIST QUALITY: the address
                                  #   does not exist, and it is the bounce type that gets a sender
                                  #   blocklisted. Split from the total because the two demand
                                  #   opposite fixes — hard means clean the list, soft means wait.
email_block_bounce_rate_max: 0.1  # block_bounce / injected > 0.1% → alert. REPUTATION: the receiver
                                  #   refused on policy, not because the address is bad.
email_unsubscribe_rate_max: 0.5   # unsubscribe / delivered > 0.5% → alert. Complements the rise key:
                                  #   a rate that is high but STABLE never triggers a rise alert.
email_spam_complaint_rate_max: 0.3  # daily spam_complaint / delivered > 0.3% → alert. Re-based from
                                    #   1% on 2026-09-01: 0.3% is what Gmail and Yahoo ENFORCE on
                                    #   bulk senders, so a 1% ceiling only fired long after the
                                    #   provider had already begun filtering. Aim for 0.1%.
email_delay_rate_max: 20          # count_delayed_first / injected > 20% → alert. Share of messages
                                  #   DEFERRED ON THEIR FIRST ATTEMPT, bounded by 100% — not the old
                                  #   events-per-delivered ratio, which counted every retry and
                                  #   routinely exceeded 100% (Client Charlie measured 485%).
email_delay_min_consecutive_hours: 2  # min consecutive hours above threshold to confirm alert
incident_days_consecutive: 2      # consecutive MOST RECENT days a per-day incident check must
                                  #   breach before it counts (single-day noise guard)

# Web push (only evaluated if web.unique_devices > 0)
web_sends_drop_pct: 100         # drop > 100% (i.e. zero sends) → alert
web_sends_rise_pct: 100         # rise > 100% → alert (unexpected spike)

# SMS channel (only evaluated if sms.unique_devices > 0 OR sms_sends_prev > 0)
sms_sends_drop_pct: 100         # 30d drop > 100% (i.e. zero sends) → alert
sms_sends_rise_pct: 100         # 30d rise > 100% → alert (unexpected spike)
# NOTE: SMS keeps VOLUME only. sms_delivery_rate was dropped on 2026-09-01: it
# measured carrier behaviour no TAM can act on, and it was the last consumer of
# /api/reports/events, which cost ~335 s per 30-day range call. Its keys
# (sms_delivery_rate_min, sms_delivery_rate_drop_pts, min_sms_dispatched) are
# gone from the catalog — a leftover override in clients.yml now matches nothing.

# Minimum volumes to evaluate a threshold (anti false-positive).
# All window-scoped floors scaled ~4x with the 7d → 30d switch.
min_push_sends: 4000            # per OS — skip push thresholds if prev 30d sends < 4000
min_email_sends: 2000           # PER SENDING DOMAIN, not per project. A domain under this floor is
                                #   reported and never judged: its rate metrics emit `na`, it gets no
                                #   sender score, and no finding is written against it. On 100
                                #   messages a single recipient moves every rate by a full point, so
                                #   a 100/100 score there would read as a fact rather than an
                                #   artefact. Relative guards additionally require the PREVIOUS
                                #   window to clear the same floor — a delta needs a baseline.
min_email_delivery_day: 100     # skip daily spam/delay/deliverability/bounce check if that day's deliveries < 100 (PER-DAY, unchanged)
min_email_campaign_sends: 5000  # min sends to include a campaign in delay correlation (per campaign, unchanged)
min_optin_optout_volume: 400     # per OS — skip the opt-in/opt-out ratio threshold if prev 30d opt-in+opt-out volume < 400
min_timeinapp: 1                # skip time-in-app threshold if prev avg < 1 (an average, unchanged)
min_sms_sends: 400              # skip SMS sends thresholds if prev 30d SMS sends < 400
min_web_sends: 400              # skip web push threshold if prev 30d web sends < 400

# Alert confirmation gate + hysteresis (anti false-positive) — see Step 8a
alert_confirm_runs: 2           # consecutive breaching runs before a breach is CONFIRMED (candidate → confirmed)
alert_resolve_runs: 2           # consecutive non-breaching runs before a CONFIRMED alert resolves (hysteresis)
alert_escalate_runs: 3          # confirmed + critical + streak ≥ this → eligible for a throttled Slack escalation (Step 10)
escalate_throttle_days: 14      # min days between two Slack escalation posts for the same key.
                                #   RAISED from 7: at the intended weekly cadence a 7-day throttle
                                #   permitted an escalation on every single run.
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
# order (the trend itself — this IS the chart, not a separate window-delta figure).
# Declining-trend guard (Step 8 alert key below) = the current window's LAST
# non-omitted daily ratio < its FIRST non-omitted daily ratio (simple start→end
# comparison, consistent with the unique-devices trend definition below).
# Source: /api/reports/optins ÷ /api/reports/optouts

# Net opt-in balance (unchanged, still computed for net_optin_negative — separate
# from the ratio above; both read the same two endpoints)
optins_{os}_current  = sum(optins.{os}) over current window
optins_{os}_previous = sum(optins.{os}) over previous window
optouts_{os}_current  = sum(optouts.{os}) over current window
optouts_{os}_previous = sum(optouts.{os}) over previous window
net_optin_{os}_current  = optins_{os}_current  - optouts_{os}_current
net_optin_{os}_previous = optins_{os}_previous - optouts_{os}_previous
# Source: /api/reports/optins (net uses /api/reports/optouts)

# Push pressure per user per 30 days (family push_pressure_per_user, Push section).
# Unit: msg/user/30d — matches the analysis window and the canvas, which already
# expresses pressure per month. The series is a ROLLING 30-day value SAMPLED
# WEEKLY: same unit as the headline (so the chart is readable) while still giving
# ~9 points instead of the 2-3 a non-overlapping monthly bucketing would yield.
push_pressure_per_user_current  = (push_sends over current window)  / optin_base_at(current_window_end)
push_pressure_per_user_previous = (push_sends over previous window) / optin_base_at(previous_window_end)
#   push_sends    = sum(sends.ios + sends.android) over the window
#   optin_base_at = counts.ios.opted_in + counts.android.opted_in
#                     from /api/reports/devices?date=<that date>     # batched, Step 6
#                     FALLBACK: current opted-in snapshot (label a proxy) when the
#                     dated call is unavailable

for each weekly sample point s (most recent N weeks, e.g. 9):
  push_pressure_per_user_s = (sum(sends.ios + sends.android) over the 30 days ending at s)
                             / optin_base_at(s)                      # msg/user/30d
# `series` for the dashboard = push_pressure_per_user_s in week order.
# Alert: push_pressure_per_user_current > push_pressure_per_user_max_30d (informational ceiling).
# Source: /api/reports/sends ÷ /api/reports/devices?date=<sample date>

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
# SMS is VOLUME ONLY. sms_delivery_rate was removed on 2026-09-01: it measured
# carrier behaviour a TAM cannot act on, and it was the last consumer of
# /api/reports/events (~335 s per 30-day range call). Do not reintroduce it.
```

Email metrics — **computed per sending domain from SparkPost**, then recombined:

```
email_sends_current = sum(sends.email) over current window     # /api/reports/sends

# For EACH domain in clients.yml email.sending_domains, one SparkPost call
# scoped with sending_domains=<domain> (Step 3e). c = its counts.
email_deliverability   = c.count_delivered        / c.count_injected  * 100
email_bounce           = c.count_bounce           / c.count_injected  * 100
email_hard_bounce_rate = c.count_hard_bounce      / c.count_injected  * 100
email_block_bounce_rate= c.count_block_bounce     / c.count_injected  * 100
email_spam_complaint   = c.count_spam_complaint   / c.count_delivered * 100
email_unsubscribe_rate = c.count_unsubscribe      / c.count_delivered * 100
email_open_rate        = c.count_unique_confirmed_opened / c.count_delivered * 100
email_ctor             = c.count_unique_clicked   / c.count_unique_confirmed_opened * 100

# CTOR reads "of the people who opened, how many clicked" — the denominator is
# OPENS, not sends, which is why it is not comparable to a click rate and why a
# transactional domain (Client Delta: 62%) and a marketing one (Client Charlie: 0.5%) sit on
# different scales. Guard it on its CHANGE only.
#
# GATE IT ON INJECTIONS, not just on its own denominator. Opens and clicks are
# events that keep arriving for mail sent BEFORE the window, so a domain that
# injected ZERO still returns a denominator: radio.client-echo.example showed 465
# opens / 19 clicks on 0 sends and produced a 4.09% CTOR out of nothing. Emit
# `ctor` (and `unsubscribes`) as `na` whenever count_injected is 0 or under
# min_email_sends — otherwise the drop guard can fire on a silent domain.

# Deferrals: the SHARE OF MESSAGES deferred on their first attempt, bounded by
# 100%. NOT count_delayed, which counts delay EVENTS — one message retried five
# times scored five, so the old ratio routinely passed 100% (Client Charlie: 485%)
# and could not be read against a ceiling. That redefinition is what allowed the
# whole cohort-mismatch workaround below to be deleted.
email_delay_rate       = c.count_delayed_first    / c.count_injected  * 100
delay_retries_per_delivered = c.count_delayed / c.count_delivered   # diagnostic only

# PROJECT ROLLUP: sum the raw counts across domains, THEN divide. Never average
# the per-domain rates — Client Echo sends 10.1M on one domain and 394k on
# another with a very different profile, and a mean erases the smaller one.
# A domain under min_email_sends contributes its counts but is itself reported
# as `na`: no rate, no score, no finding.
(repeat for the previous window, same source — never pair a SparkPost current
 value with an Airship baseline: the denominators differ and the delta would be
 an artefact)
```

Email deliverability health — fast incident checks, on the **daily rows of the
same SparkPost per-domain call** (`/time-series`, `precision=day`). One call per
domain already returns the whole window, so these cost nothing extra:

```
For each date d in [current_window_start, current_window_end], per DOMAIN:
  deliverability_{d}      = delivered_{d}            / injected_{d}  * 100
  bounce_rate_{d}         = bounce_{d}               / injected_{d}  * 100
  spam_complaint_rate_{d} = spam_complaint_{d}       / delivered_{d} * 100
  delay_rate_{d}          = count_delayed_first_{d}  / injected_{d}  * 100
# Skip a day whose delivered_{d} < min_email_delivery_day.
# Fire only when the MOST RECENT incident_days_consecutive days all breach, so a
# live incident is never diluted into the 30-day average — and so these keys
# resolve on the TAIL of the window rather than staying pinned open for a month.
```

> ✅ **The cohort-mismatch workaround is gone — do not reinstate it.** Under
> `/api/reports/events`, `delay` / `initial_open` / `spam_complaint` events
> attached to the *send that caused them*, which could predate the bucket, while
> the denominator was that bucket's own deliveries. Numerator and denominator
> described different cohorts, so the ratio could exceed 100% (observed at
> **1163%** on `email_delay_rate`), and the skill had to discard any bucket
> above 100% as unusable.
>
> SparkPost removes the cause rather than the symptom: each count is attributed
> to the message's own injection, and `count_delayed_first` counts **messages,
> not retry events**. Every rate above is now bounded by construction. If one
> ever exceeds 100% again, that is a bug in the domain scoping or the window —
> investigate it, do not filter it out, and never raise `email_delay_rate_max`
> to silence it.

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
| `app_opens_drop_{os}` | app_opens_{os}_delta_pct ≤ −app_opens_drop_pct **OR** abs(app_opens_ios_delta_pct − app_opens_android_delta_pct) > app_opens_cross_os_gap_pts — and when the gap fires, alert **only the OS with the worse delta, and only if that delta is negative** |
| `timeinapp_drop_{os}` | timeinapp_{os}_delta_pct ≤ -timeinapp_drop_pct |
| `push_sends_drop_{os}` | push_sends_{os}_delta_pct ≤ -push_sends_drop_pct |

> **`app_opens`, `timeinapp` and `push_sends` alert on a FALL only.** These three
> carry no rise guard, and none may be added: a spike in opens, session time or
> push volume is a campaign, a product launch or a news cycle — real, often worth
> a sentence in the narrative, but not a fault and not something a TAM can action.
> This is also why the cross-OS gap above may not flag the platform that grew: a
> divergence where iOS surged and Android held steady is an iOS *success*, and
> raising it as an alert on both platforms — as this table used to say — produced
> two rows nobody could act on. The dashboard enforces the same rule when it
> matches alerts to cards, so a stale snapshot cannot reintroduce a rise alert on
> these families.
| `direct_response_low_{os}` | direct_response_rate_{os}_current < direct_response_rate_min |
| `direct_response_collapse_{os}` | direct_rate_drop_pct_{os} ≥ direct_response_collapse_pct |
| `optin_optout_ratio_drop_{os}` | optin_optout_ratio_{os}_delta_pct ≤ -optin_optout_ratio_drop_pct **AND** the current window's ratio series is declining (last non-omitted daily ratio < first non-omitted daily ratio) — avoids firing on a single noisy day |
| `net_optin_negative_{os}` | net_optin_{os}_previous ≥ 0 AND net_optin_{os}_current < 0 |
| `email_sends_drop` | email_sends_delta_pct ≤ -email_sends_drop_pct |
| `email_deliverability_low` | **Fast check.** deliverability_rate_{date} < email_deliverability_min on the **last `incident_days_consecutive` days** of the window that cleared `min_email_delivery_day`. Not the 30-day average. |
| `email_open_rate_drop` | open_rate_drop_pts ≥ email_open_rate_drop_pts |
| `email_bounce_high` | **Fast check.** bounce_rate_{date} > email_bounce_max on the **last `incident_days_consecutive` days** of the window that cleared `min_email_delivery_day`. Not the 30-day average. |
| `email_hard_bounce_high` | **Fast check.** `count_hard_bounce` / `count_injected` per day > `email_hard_bounce_rate_max`, on the last `incident_days_consecutive` days. LIST QUALITY — the address does not exist, and this is the bounce type that gets a domain blocklisted. |
| `email_block_bounce_high` | **Fast check.** `count_block_bounce` / `count_injected` per day > `email_block_bounce_rate_max`, on the last `incident_days_consecutive` days. REPUTATION — the receiver refused on policy, not because the address is bad. Also raises the placement risk to `watch`. |
| `email_unsubscribe_rise` | unsubscribe_delta_pct ≥ email_unsubscribe_rise_pct |
| `email_unsubscribe_rate_high` | unsubscribe_rate > `email_unsubscribe_rate_max`. Complements the rise key: a rate that is high but STABLE never trips a rise threshold. |
| `email_ctor_drop` | CTOR drop vs the previous 30 days ≥ `email_ctor_drop_pct`. RELATIVE by design — an absolute floor fires on every marketing domain at once (see the threshold note). Requires BOTH windows to clear `min_email_sends`. |
| `email_spam_complaint_high` | **Fast check.** spam_complaint_rate_{date} > email_spam_complaint_rate_max on the **last `incident_days_consecutive` days** that cleared `min_email_delivery_day`. One alert per project; cause aggregates the affected days. |
| `email_delay_high` | **Fast check.** `count_delayed_first` / `count_injected` per day > `email_delay_rate_max`, on the **last `incident_days_consecutive` days**, per sending domain (same volume guard). **One alert per DOMAIN** — never one per day; cause aggregates the confirmed days (count, range, peak rate + date) and names the dominant `deferralClasses[]` bucket, which is what tells the TAM whether to act on infrastructure, reputation or list hygiene. |
| `web_sends_drop` | web_sends_delta_pct ≤ -web_sends_drop_pct (if web active) |
| `web_sends_rise` | web_sends_delta_pct ≥ web_sends_rise_pct (if web active) |
| `sms_sends_drop` | sms_sends_delta_pct ≤ -sms_sends_drop_pct (if SMS active) |
| `sms_sends_rise` | sms_sends_delta_pct ≥ sms_sends_rise_pct (if SMS active) |
| `total_devices_evolution_drop` (and `total_devices_evolution_drop_{os}`) | total_devices_evolution_total_delta_pct (or _{os}_delta_pct) ≤ -total_devices_evolution_drop_pct (two-date evolution from the two dated devices calls, not a D-7 snapshot) |
| `devices_{os}_optin_drop` | devices_{os}_optin_delta_pct ≤ -devices_optin_drop_pct (two-date evolution) |
| `devices_{os}_uninstall_rise` | devices_{os}_uninstall_delta_pct ≥ devices_uninstall_rise_pct (two-date evolution) |
| `devices_web_optin_drop` | idem (if web active) |
| `push_pressure_per_user_high` | push_pressure_per_user_current (over the 30-day window) > push_pressure_per_user_max_30d (informational over-messaging ceiling; never critical) |

Email health keys (`email_delay_high`, `email_spam_complaint_high`) are
**one per project, not per day**. They stay open (ongoing) while the **most
recent** `incident_days_consecutive` days still breach, and **resolve** once the
tail of the window is clean.

> 🚨 **This tail rule replaced an "any day in the window" rule, and the change
> is not cosmetic.** Under the old 7-day window, "any breaching day" meant an
> incident stayed lit for at most a week after it ended. Carried over to a
> 30-day window unchanged, a single bad afternoon would have pinned the alert
> open for a **month** and blocked resolution — turning the longer window into a
> false-positive *amplifier*, the exact opposite of the intent. Anchoring on the
> tail of the window keeps detection fast (a live incident breaches the most
> recent days) while letting a finished incident resolve within days.

The list of affected days lives in the
alert cause, not as separate alerts.

Do **not** evaluate a threshold if the relevant volume is below the minimum
defined in `min_*` settings (per OS where the minimum is per OS). Log
`"skipped: low volume"`.

> ⚠️ **Compare the minimum against `max(previous_window_volume,
> current_window_volume)` — never the previous window alone.** Gating on the
> previous window only creates two symmetrical blind spots that hide exactly the
> incidents this skill exists to catch:
>
> - **Sustained outage.** A channel that stopped sending has `previous = 0` once
>   the outage is older than the window, so the drop threshold is skipped and the
>   outage becomes invisible — after having been caught on day 1. This is worse
>   than a missed alert: `push_sends_drop_pct: 100` ("alert only when sends go to
>   zero") is precisely the case neutralised by `min_push_sends`.
> - **Fresh ramp-up.** A channel that just started has a tiny
>   `previous` and a huge `current`, so every guard on it stays unevaluated while
>   real volume flows (e.g. an email channel sending millions this window after a
>   handful last window keeps its bounce/spam ceilings switched off).
>
> With `max(previous, current)`, a zero-volume window still clears the floor
> whenever the OTHER window carried volume, so the drop is evaluated and the
> alert holds. Only a channel that is genuinely idle in **both** windows is
> skipped — the intended anti-noise behaviour.

When both `direct_response_low_{os}` and `direct_response_collapse_{os}` fire on
the same OS, post a single alert keyed `direct_response_collapse_{os}` (it
implies the low rate).

### Step 8a — Confirmation gate, hysteresis & cadence-aware suppression

A threshold breach from Step 8 is no
longer an alert on its own — it must **persist across runs** to be *confirmed*.
Blips that clear on the next run never reach Slack and never
clutter the alert tracking.

> **The gate is now the second line of defence, not the first.** When alerting
> ran on a 7-day window this gate was the main anti-false-positive mechanism,
> because the window itself was noisy. With a 30-day window most of that noise
> is gone before the gate sees it, and the gate's job narrows to catching
> borderline metrics oscillating around their threshold.
>
> **A run is a unit of evidence, and that only holds at a weekly cadence.**
> `streak` counts *runs*, not days. Two consecutive **weekly** runs share 23 of
> 30 days, so a breach surviving both is genuine new evidence, and
> `alert_confirm_runs: 2` means "still breaching a week later". Two consecutive
> **daily** runs share 29 of 30 days and are almost the same measurement, so on
> a daily cadence the gate confirms nearly everything it sees and adds latency
> without adding confidence. Run weekly; if you must run daily, treat the gate
> as decorative and rely on the window.

**Where streak state lives.** Agents have no memory between runs, so the
per-project entry in local **`dashboard-data.js`** is the source of truth (read
in Step 7, written in Step 13). The Slack canvas is a **client-facing snapshot**
and is **not** the database.

Carry on each `alertsList` / `candidatesList` item (Step 13) the fields the gate
needs next run: `state` (implied by which list), `streak`, `clearStreak`,
`openedAt`, `firstBreach`, `lastEscalated`. A compact `alertState[]` array on
the project is also fine if you prefer one list — same fields, plus
`state: candidate|confirmed|muted`.

Status vocabulary (dashboard + any canvas row still showing a critical):

- `🟠 Candidate {streak}/{N}` — breaching but not yet confirmed (**dashboard-only**, never posted/escalated, never on the Slack canvas)
- `Active` — confirmed
- `Active · clearing {k}/{M}` — confirmed but currently non-breaching, inside the resolve hysteresis
- `🔕 Muted` — muted (dashboard; dropped from the Slack canvas)
- `· escalated {YYYY-MM-DD}` suffix — Step 10 throttle marker

**Per-run algorithm** — for every threshold key evaluated in Step 8, reconcile it
against its prior record (dashboard file, else legacy canvas row):

```
confirm_runs(key) = per-metric override (below) else alert_confirm_runs   # default 2
resolve_runs      = alert_resolve_runs                                    # default 2

evaluated    = the key's threshold was actually EVALUATED this run — volume floor
               cleared AND the inputs present. A key skipped for low volume, a
               missing endpoint, or an absent denominator is NOT evidence of
               recovery.
breached_now = Step 8 condition true for key (AFTER min-volume + cadence guards)
prior        = dashboard (else legacy canvas) record for key: { state, streak, clear_streak, opened, first_breach, lastEscalated }

if not evaluated:
    # FREEZE — carry the prior state, streak and clear_streak untouched.
    state = prior.state; streak = prior.streak; clear_streak = prior.clear_streak
elif breached_now:
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

> ⚠️ **"Not evaluated" is not "recovered" — never let a skipped run resolve an
> alert.** Without the `evaluated` guard above, a key that stops being evaluated
> (volume floor, missing endpoint, absent denominator) accumulates `clear_streak`
> and silently **resolves after `alert_resolve_runs` runs**, even though the
> underlying metric never improved. Observed in practice: a project whose email
> volume fell under `min_email_sends` in the previous window had its
> `email_bounce_high` and `email_spam_complaint_high` logged as *"Back below
> threshold — 2 consecutive clean runs"* while the bounce rate was still **4.8%
> against a 2% ceiling**. A confirmed alert on an unevaluated key must stay open,
> keep its `Opened` date and streak, and must **not** be written to
> `resolvedRecently` (Step 13). Surface it as still-open with the `na` reason on
> the metric card instead.

> ⚠️ **On email, evaluate the gate per sending domain — a clear rollup does not
> resolve a breaching domain.** The project figure is recombined from summed raw
> counts, so a small domain in trouble barely moves it: Client Echo's headline
> delay reads 5.1% against a 20% ceiling while `tv.client-echo.example` alone defers
> 49.6%. Resolving on the rollup would close a live incident. So for the six
> email keys, run the gate against **each active domain**, and treat the alert as
> breaching while **any** of them breaches. When the rollup is clear but a domain
> is not, keep the alert open and record the domain(s) on the item
> (`scope: ["tv.client-echo.example"]`), so the dashboard and any escalation name the
> domain rather than the project. An alert resolves only once **every** active
> domain is clear for `alert_resolve_runs` runs. A domain that went idle is not
> clear — it is unevaluated, and the rule above applies to it.

**Per-metric `confirm_runs` overrides** (defaults — each still overridable per
project via `clients.yml` `custom_thresholds`):

- **Confirm in 1 run** (urgent, rarely a false positive — treat as confirmed as
  soon as breached): `email_deliverability_low`, `email_bounce_high`,
  `email_spam_complaint_high`, `email_delay_high`,
  `email_hard_bounce_high`, `email_block_bounce_high`,
  `direct_response_collapse_{os}`.
- **Confirm in 3 runs** (noisy / cadence-sensitive):
  `push_sends_drop_{os}`, `email_sends_drop`, `web_sends_drop`, `sms_sends_drop`,
  and `app_opens_drop_{os}` when triggered by the **cross-OS gap only**.
- **All others**: `alert_confirm_runs` (default 2).

**Cadence-aware zero-send suppression.** A `*_sends_drop` breach that is really a
**zero / near-zero send window** is checked against the channel's own cadence
**before** it can even become a candidate:

```
active_day_ratio(channel) = (days with sends > 0) / (total days), trailing 28d
   (reuse the Step 1 series; if only the current 30-day window is available, use that)

if breach is a zero/near-zero-send window AND active_day_ratio < cadence_daily_ratio:
    suppress → NOT even a candidate; log "suppressed: irregular send cadence (ratio {r})"
```

Rationale: many projects legitimately send on only a few days a week (weekly
newsletters, occasional SMS blasts, event-triggered web push). For those, a
window with no send is normal cadence, not an incident. Only a **normally-daily**
sender (`ratio ≥ cadence_daily_ratio`) going silent raises an alert, and it still
passes through the confirm-runs gate above. Note the 30-day window already makes
this suppression rarer: a project that sends even once a month now has non-zero
volume in both windows, so the zero-send branch is reached far less often than it
was on a 7-day window.

**Muted keys short-circuit the entire gate** (evaluated first, as today): a muted
key is never a candidate, never confirmed, never escalated.

**Outputs of Step 8a** (consumed by Steps 9, 10, 11, 13):
- `confirmed_new` — keys that reached `confirmed` **this** run (`opened == today`).
- `confirmed_ongoing` — already-confirmed keys still breaching or clearing.
- `candidate_alerts` — breaching, not yet confirmed (dashboard only).
- `resolved_alerts` — confirmed keys that cleared the resolve hysteresis this run.
- per-key `streak` / `clear_streak` / `opened` / `first_breach`.

### Step 8b — Root cause analysis (for each triggered alert)

Run this step only for **newly-confirmed alerts** (`confirmed_new` from Step 8a —
not candidates, not ongoing ones). For each breach, produce a short
`possible_cause` string for the dashboard (Step 13), any escalation message
(Step 10), and — if the alert is confirmed **and** critical — the one-line Note
on the Slack canvas (Step 11).
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
   days, or a `web_sends_rise` recurs), treat the muted reason as a
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
   auto-post — but the worsening is flagged in the dashboard trend so a
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
| `app_opens_drop_{os}` | If triggered by cross-OS gap only → `"App opens diverged over 30 days: iOS {ios_delta}% vs Android {android_delta}% (gap {gap} pts > {threshold} pts threshold) — investigate platform-specific tracking, SDK, or campaign mix (source: /api/reports/opens)."` If push_sends_{os} also dropped proportionally → `"App opens drop on {os} is consistent with the -X% push send reduction on {os} (source: /api/reports/opens vs /api/reports/sends)."` |
| `timeinapp_drop_{os}` | If app_opens_{os} also dropped → engagement-wide erosion on {os}; if opens stable → deeper in-session disengagement. Cite /api/reports/timeinapp. |
| `direct_response_collapse_{os}` | **Prioritise tracking hypothesis**: `"Direct response rate on {os} collapsed from X% to Y% (direct / push sends, source /api/reports/responses) while sends stayed normal → most likely an attribution/SDK tracking issue on {os}, not a real engagement drop. Recommend checking SDK version / response tracking on {os}."` |
| `optin_optout_ratio_drop_{os}` | Opt-in/opt-out **ratio** (daily opt-ins ÷ opt-outs). Check whether the drop is driven by fewer opt-ins, more opt-outs, or both (compare both series). If push_sends_{os} or app_opens_{os} also dropped → lower opted-in-device activity on {os} alongside lower overall activity; if opens/sends are stable, suspect a registration/SDK/tracking regression or a churn event. Cite /api/reports/optins ÷ /api/reports/optouts. |
| `net_optin_negative_{os}` | Note whether driven by fewer opt-ins or more opt-outs (compare both series, source /api/reports/optins and /api/reports/optouts). |
| `email_sends_drop` | Check day-by-day: is the drop concentrated on specific days or spread evenly? |
| `email_bounce_high` / `email_deliverability_low` | **If Step 3e returned data, lead with it** — `top_bounce_reasons` gives the receiving domain and the remote MTA's refusal string, which separates the two very different causes: hard bounces concentrated on one provider (a reputation or blocking problem) versus hard bounces spread evenly (list quality — stale or invalid addresses). Name the dominant bounce class (`count_hard_bounce` vs `count_block_bounce` vs `count_admin_bounce`); a block-bounce spike on one provider is a deliverability incident, not list decay. SparkPost is the only source here; if Step 3e returned nothing for the domain, emit the metric as `na` and freeze any open alert rather than reporting a bounce rate the run could not measure. |
| `email_spam_complaint_high` | High spam rate on one or more days — check whether the affected day(s)' campaigns had list-quality or consent issues. Cite `count_spam_complaint` / `count_delivered` per affected day from SparkPost, naming the sending domain. Aggregate the affected days in the cause. When Step 3e is available, say **which provider** is complaining (`by_mailbox_provider[].spam_complaint_rate`) — complaints concentrated on one provider point to reputation there rather than to the list as a whole. |
| `email_delay_high` | **If Step 3e returned data, lead with it** — `top_delay_reasons` names the receiving domain and the remote MTA's own reason string, which beats any inference (e.g. `"31% of delays are Orange returning 421 too many connections — provider throttling, not a campaign problem"`). **Lead with the deferral MIX** (`deferralClasses[]`): the same rate means opposite things — "82% sending IP suspended" is infrastructure, "65% mailbox full" is an ageing list, "80% reputation · unsolicited" will not improve by sending more slowly. Then run **Step 3c** if the mix does not settle it. SparkPost is the only source; without it emit `na` and freeze the alert. Cause aggregates all confirmed days (count, range, peak rate + date) and names the dominant bucket. |
| `web_sends_drop` | If push_sends also dropped → note correlation; if push stable → flag as specific to web channel. Check if web.unique_devices also dropped (source: /api/reports/devices). |
| `sms_sends_drop` | Check day-by-day series for gaps (no sends on a given day = no campaign). If sms.unique_devices also dropped → audience erosion. Source: /api/reports/sends field "sms". |
| `sms_sends_rise` | Unexpected spike — check day-by-day for concentration on a single day (bulk campaign or test blast). Source: /api/reports/sends field "sms". |

#### 2. Day-by-day spike/gap detection

Scan the current 30-day daily series already fetched (sends, opens, per OS) for the
relevant metric. Identify:

- **Missing days**: any day with 0 or near-0 sends in the current window
  that had normal volume in the previous window → `"No sends on {date}
  (previous equivalent day: {value}). Likely no campaign scheduled."`
- **Single-day spike in previous window**: if one day in the previous
  window accounts for > 20% of the 30-day total, the comparison is
  skewed → `"Previous window inflated by a large send on {date} ({value}).
  Comparison may overstate the drop."` (The trigger dropped from 40% to 20%
  with the window: one day out of 30 that carries a fifth of the total is
  already as distorting as one day out of 7 carrying 40%.)
- **Trend**: if the drop is gradual across the 30 days vs concentrated in
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
state so the canvas critical-alerts table is accurate.

> **Alerts no longer post to Slack on every run.** Daily new-alert and resolution
> posts are **removed** (see Step 10). All alert tracking now lives in the
> **local dashboard** (candidates with their streak, confirmed alerts with
> context, and a recently-resolved log). The Slack canvas (Step 11) shows only
> **confirmed critical (🔴) alerts**. Slack stays quiet except for a rare,
> throttled **critical escalation** (Step 10) and the **weekly recap**
> (Step 10b).

First build the **mute set** = `clients.yml` `muted_alerts` ∪ any canvas rows
already marked `Status = Muted` (Step 7). Then reconcile the Step 8a outputs
against the **prior alert state** read in Step 7:

- **Muted** (key matches the mute set — exact key OR family, the part before
  `:`) → **evaluate first**: never a candidate/confirmed/escalated. Record it in
  the dashboard with `muted: true`, its reason, and `last_seen` updated;
  exclude it from any "worst severity". **Do not** list it on the Slack canvas.
  A muted key is never posted or escalated.
- **Candidate** (`candidate_alerts`) → surface it in the dashboard
  `candidatesList` (Step 13) with `streak` / `needed`. **Never posted to Slack,
  never listed on the canvas.**
- **Confirmed — new** (`confirmed_new`) → `Opened = today`; run Step 8b (root
  cause); surface in the dashboard `alertsList`. If severity is **critical
  (🔴 / `danger`)**, list it on the canvas (Step 11). Eligible for a **critical
  escalation** only if it also passes the Step 10 gate. No ordinary Slack post.
- **Confirmed — ongoing** (`confirmed_ongoing`) → update `last_seen`; keep
  `Status = Active` (or `Active · clearing {k}/{M}` while inside the resolve
  hysteresis). Canvas: keep the row only if it is still critical and not muted.
  No repeat post.
- **Resolved** (`resolved_alerts`) → drop from the canvas (if it was showing)
  and move it to the dashboard `resolvedRecently` log (Step 13). **No Slack
  resolution post** — the channel stays quiet.

**Severity** (assign once per key, same value for dashboard / canvas / Step 10):

- **danger (🔴 critical)** — `app_opens_drop_*`, `timeinapp_drop_*`,
  `direct_response_collapse_*`, `email_deliverability_low`, `email_bounce_high`,
  `email_spam_complaint_high`,
  `total_devices_evolution_drop` (and `_*` OS variants),
  `devices_*_uninstall_rise`. These are the only keys
  that appear on the Slack canvas once confirmed and not muted.
- **warning (🟡 watch)** — every other alerting key (`*_sends_drop`,
  `email_delay_high`, `optin_optout_ratio_drop_*`, `direct_response_low_*`,
  `email_open_rate_drop`, `email_unsubscribe_rise`, `devices_*_optin_drop`,
  web/SMS send spikes, …). Dashboard only.
- **info** — `push_pressure_per_user_high` (informational ceiling). Dashboard only.

### Step 10 — Critical escalation (throttled, rare)

**Skipped on `canvas-only` runs** (see Step 9). Daily new-alert and resolution
posts are **retired** — the channel no longer gets a message on every run. The
**only** per-run Slack post is a rare, throttled **critical escalation** for a
sustained, confirmed, critical alert. Everything else lives in the local
dashboard (Step 13). The Slack canvas (Step 11) is a short snapshot of last-run
key metrics + those same confirmed critical alerts. The weekly recap is a
separate, lighter post (Step 10b).

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
   (default 14). The last escalation date is stored on the dashboard item as
   `lastEscalated` (and mirrored as a `· escalated {YYYY-MM-DD}` Status suffix
   on the canvas row if that critical alert is showing). Parse it from the
   Step 7 read and skip if `today − last_escalated < escalate_throttle_days`.

If `escalations_to_post` is empty, **post nothing this run.** When you do post,
set `lastEscalated = today` on each escalated key (Step 13) and append
`· escalated {today}` to that key's canvas Status if it is showing (Step 11) so
the throttle holds on the next run.

Use `slack_send_message` to the channel ID resolved at run start (see **Slack
channel** above).
**Important:** the Slack MCP requires the `message` parameter (not `text`) —
always pass `message: "..."` or the call will silently return `no_text`
without posting.

```
🔴 KPI Escalation — {Client name} — {current_window_start} → {current_window_end}
_Critical alert confirmed and sustained ≥ {alert_escalate_runs} runs. Snapshot: [📊 KPI Canvas]({canvas_url}). Full tracking lives in the local dashboard._

**{Section}** _(source: {endpoint})_
| Metric              | OS       | Prev 30d         | Last 30d         | Δ                |
|---------------------|----------|------------------|------------------|------------------|
| {kpi_label}         | {os}     | {prev_value}     | {curr_value}     | {delta_str}      |

> 🔍 **Possible cause:** {possible_cause}

_(Source: Airship Reports API · [📊 KPI Canvas]({canvas_url}))_
```

Include only **escalated** KPIs grouped by section (App, Engagement, Mobile Push,
Acquisition, Email, Web Push, SMS, Devices). Do not include
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

- Email spam complaint rate must appear as **"Spam complaint rate (vs
  delivered/day)"** with the date, the sending domain, raw counts
  (`count_spam_complaint` / `count_delivered`), and source **SparkPost**.

- Email delay rate must appear as **"Delay rate (first-attempt deferrals vs
  injected/day)"** with the date, the sending domain, raw counts
  (`count_delayed_first` / `count_injected`), and source **SparkPost**. Name the
  dominant deferral class from `deferralClasses[]` (Step 3e) — "82% sending IP
  suspended" and "65% mailbox full" are the same rate with opposite fixes.

  **When `email_delay_high` is escalated (or in the canvas Alert analysis)**,
  append the Step 3c drill-down
  **below** the `possible_cause` line (mandatory). Lead with the **peak confirmed
  day**; if several days are confirmed, list the others compactly (date · delay %)
  under the table rather than repeating a full breakdown per day:

  ```
  **Hourly breakdown — {peak_date}** _(source: SparkPost · precision=hour, sending domain {domain}; hours in local {time_zone})_
  | Hour (local · {time_zone}) | Email sends | Injected | Delivered | Deferred (1st) | Delay % |
  |---|---:|---:|---:|---:|---:|
  | 07:00 | … | … | … | … | … % |
  | … | (all hours 00–23 local; flag ⚠️ on hours where delay % > email_delay_rate_max) | | | | |

  **Likely campaigns on {date}** _(source: /api/reports/responses/list)_
  | Send time (local · {time_zone}) | Campaign | Sends | Delay | Delay % |
  |---|---|---:|---:|---:|
  | … | message_name | … | … | … % |

  _(If no campaign ≥ min_email_campaign_sends: write "No large blast identified —
  delays may be provider-wide or transactional.")_
  ```

- SMS sends must appear as **"SMS sends"** with the 30-day delta and source
  `/api/reports/sends field "sms"`.

- Web push sends must appear as **"Web push sends"** with source
  `/api/reports/sends field "web"`.

#### No resolution posts

Resolutions are **not** posted to Slack any more. A resolved alert is dropped from
the canvas (if it was showing) and logged in the dashboard `resolvedRecently` list
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
- **In-app aggregate activity — retired, do not reinstate.** The recap used to
  carry a week-over-week count of `location ∈ {in_app_message, in_app_pager}`
  events. Its only source was the `/api/reports/events` payload, and that endpoint
  is no longer called (Step 2): the block cannot be produced, and bringing the
  endpoint back for a single count would cost ~335 s per project for a figure with
  no per-scene detail behind it. In-app messages still appear in the recap
  **individually**, through the activity log like any other channel — what is gone
  is only the aggregate impressions line.

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
maintain a **short, visual, client-facing snapshot**. Three blocks only:

1. **Key metrics** of this project over the **last 30 days vs the previous 30
   days**, rendered as one **table per section**.
2. **Email** — only when the project sends email: current-window volume,
   engagement and reputation signals plus a **sender score**. No history.
3. **Confirmed critical (🔴) alerts** currently open.

Nothing else. No executive recap, no 3-month trend, no top campaigns, no unicast
estimate, no devices-history table, no email-health history, no verbose alert
analysis, no candidates, no watch (🟡) alerts, no muted rows. Those live in the
**local dashboard**. Target one to one-and-a-half screens, scannable in ten
seconds: exploit the canvas's layout primitives so the report reads as a
dashboard, not as a data dump.

#### Comparison window — 30 days vs the previous 30 days

The canvas uses **the same window as alerting and the dashboard** — the
`current_window` / `previous_window` pair from Step 0:

- **current window** = the last **30 complete days** (ending yesterday), against
- **previous window** = the **30 days immediately before it**.

So on 1 Sep 2026: current `2 Aug → 31 Aug`, previous `3 Jul → 1 Aug`. Two
adjacent 30-day blocks, no gap and no overlap.

Thirty days holds roughly four of each weekday, so day-of-week seasonality
cancels out on both sides and no weekday-alignment trick is needed. It also
absorbs the campaign spikes that make a short window lie: Client Bravo's push
volume read **+78%** on a 7-day window and **−23%** on 30 days — the 7-day
figure was one heavy campaign week, not a trend. That example is also why
alerting itself moved to 30 days.

No separate fetch is needed: Steps 1–3 already cover both windows, plus
`/api/reports/devices?date=` at the **start of each window** for the
opted-in-device baselines.

> ✅ **Reuse, don't recompute.** The canvas Δ and the dashboard Δ are now the
> **same number**, so take `metrics[].deltaPct` / `deltaPts` straight from
> Step 13 rather than recomputing against a second baseline. Any disagreement
> between the two surfaces is a bug, not a design choice — that divergence was
> the reason the previous dual-window design was abandoned. The header line must
> still spell out both date ranges so the client can audit the comparison.

#### What counts as a red alert (canvas list)

List a key **only when all of the following hold**:

- Step 8a `state` is `confirmed` (including `Active · clearing {k}/{M}` — still
  open, inside hysteresis).
- Severity is **critical** (`danger` / 🔴). Use the same severity already assigned
  for the dashboard / Step 10 escalation gate.
- It is **not muted**.

Drop the row as soon as it resolves, is muted, or is only a candidate / watch.

#### Canvas update procedure (MANDATORY — short rebuild)

The canvas is **not** a history store. Device evolution comes from dated
`/api/reports/devices?date=` calls (Step 6); confirmation streaks live in
`dashboard-data.js` (Step 7 / 13). **Rebuilding the body is expected** — including
on projects that still have the old long strategic canvas.

**Do NOT call `slack_update_canvas` with `action=replace` and no `section_id`.**
The Slack MCP requires a `section_id` for replace. Rebuild like this:

1. **`slack_read_canvas(canvas_id)`** — already done in Step 7. Reuse the
   `section_id_mapping`. Identify the **title** section (the first section).

2. **Delete every non-title section.** For each `section_id` that is not the
   title, emit `edit_type: delete`. This wipes the old strategic / history /
   Open-Alerts sections in one atomic `sections` batch (max 100 ops).

3. **Append the short content** after the title (`edit_type: append` on the
   title `section_id`, `content` = the markdown below, **without** repeating the
   `#` title line — the title stays in the title section).

4. **First run (no canvas ID) or `slack_read_canvas` failed:**
   - Call `slack_create_canvas` with the full initial content below (including
     the `#` title).
   - Return the canvas ID **and** the full `canvas_url` so the TAM can copy both
     into `clients.yml`.

If a delete+append batch would exceed 100 operations, delete in two batches
(read again between them — section IDs change after every update), then append.

#### Visual rules — use the canvas's layout primitives

The canvas is a **visual report**, not a data dump. Use these, and only these:

- **One table per section** carries the KPIs — this is the backbone of the page.
  Tables beat three-column tiles here because they **align the numbers into
  columns**: a reader scans the whole Δ column in one movement instead of
  hunting the same line inside three separate boxes. Same five columns every
  time, so the eye learns the shape once:

  ```
  |Metric|Last 30 d|Δ vs prev. 30 d|iOS|Android|
  |  ---  |  ---  |  ---  |  ---  |  ---  |
  |{emoji} {KPI name}|**{value}**|{↗|↘|→} {Δ}|{value} · {Δ}|{value} · {Δ}|
  ```

  Rules for the cells:
  - The **Metric** cell opens with an emoji — it is the row's visual anchor.
  - The **value** is bold; nothing else in the row is.
  - The **Δ arrow** states direction only (`↗` up, `↘` down, `→` flat). It never
    means "good" or "bad" — bounce falling is `↘` and excellent. Judgement is
    carried by a status pill (🟢/🟡/🔴) placed next to the value it grades, or by
    the email `Score` column.
  - The **per-OS columns** carry the current value **and its own Δ**. The OS
    split is where most regressions actually live (an iOS-only tracking break is
    invisible in the total), so never collapse it. For a rate whose OS reading
    is judged against a benchmark, put the pill in the OS cell (`0.48% 🔴`)
    rather than a separate line.
  - Channel-wide KPIs with no OS split (email, SMS, web) use the **email table
    shape** instead: `|Signal|Last 30 d|Δ|Guardrail|Score|`. Never write `—`
    into an iOS/Android column just to fill it.
  - Omit a row when its channel is unused (volume = 0 in both windows); omit the
    whole section when none of its rows survive.
- **One 🎯 Market line per section**, immediately under the table, as a single
  short paragraph: `🎯 **Market** — {KPI} against {vertical} {percentile}: {one
  clause}.` It exists because a benchmark needs a sentence to mean anything, and
  a sentence does not belong in a cell. Skip it entirely when the section has no
  benchmarked KPI.
- **Gauges** are ten block characters, `█` filled / `░` empty, in inline code
  (`` `█████████░` ``). Use them only for a bounded measure: the sender score
  (scale 0–100), or a rate against its guardrail (scale the axis from
  `floor − 5 pts` to 100 for a floor, or 0 to `ceiling × 2` for a ceiling, so a
  value sitting exactly on its guardrail reads as half full). The canvas holds
  **no history**, so **never** draw a sparkline: there is no series behind it.
- **Callouts (`::: {.callout}`)** — at most three, in this order:
  1. **The status callout at the top** — the five-second read, and the only part
     many readers will finish. A bold verdict line (`🟢 No confirmed critical
     alert` / `🔴 {N} critical`), then **one short paragraph per active channel**,
     each opening with the channel emoji in bold: what moved, and whether it
     matters. Blank line between paragraphs. No paragraph runs past two
     sentences, and none repeats a number the tables already show unless that
     number *is* the story.
  2. The Gmail-reputation callout in the email section (only when Step 3d
     returned data).
  3. The sender-score callout.
- **Dividers (`---`)** only above the footer.
- **Exactly one footnote**, at the very bottom, after the divider. Older versions
  carried a footnote per section; that pushed methodology between the sections a
  reader is trying to compare. One block covers windows, sources, the
  Airship/SparkPost split, benchmark provenance and the alerting caveat.
- Format numbers as k/M with one decimal; percentages with one decimal, or two
  when the value is under 1%. All prose in **English**.

> ⚠️ **Canvas nesting limits.** Tables and callouts do **not** nest inside
> `::: {.layout}` columns, and tables do not nest inside callouts. Since the KPI
> blocks are tables, do **not** reintroduce `{.layout}` tiles around them — keep
> every table and callout at top level.

#### Vertical benchmarks on the KPI tables

Load `benchmarks/benchmarks.json` and pick the vertical from the project's
`industry` in `clients.yml` (match the key or any `aliases` entry; fall back to
`all_verticals` when unset or unmatched). Percentiles for **rate** metrics are
stored as **fractions** — `0.022` means 2.2%, so multiply by 100 before display.
`sends_per_user_month` is already an absolute count **per month**.

Only three displayed KPIs have a vertical benchmark. They feed the section's
single `🎯 Market` line (and a status pill in the OS cells) and **no others** —
never invent a band for app opens, time in app, opt-in ÷ opt-out, or any email
KPI:

| Row | Benchmark key | Client-side value |
|---|---|---|
| Opt-in rate | `optin_rate` | `opted_in ÷ unique_devices` per OS, current snapshot |
| Direct response rate | `direct_open_rate` | `direct ÷ push sends` per OS, current window |
| Pressure (msg/user/mo) | `sends_per_user_month` | `push sends ÷ opted_in` per OS — the 30-day window **is** a month, so do **not** apply the ×4.33 weekly extrapolation |

Position wording from the p10/p50/p90 band: `top decile` (≥ p90),
`above median` (≥ p50), `below median` (≥ p10), `bottom decile` (< p10). On
`sends_per_user_month` **high is not good** — label ≥ p90 as `⚠️ above p90`
(marketing pressure), never "top decile".

Keep it to one line, both OS on the same line, e.g.
`🎯 F&D p50 2.2% iOS · 2.5% And — 🔴 iOS bottom decile`. Name the source in the
section footnote: Airship User Engagement benchmarks, the vertical label, and
the quarter from `benchmarks.json` `meta.published`.

#### Email health & sender score

Render this section **only** when the project sent email in either window
(`email_sends` > 0) and the current window cleared `min_email_sends`. It is a
**current-window snapshot** — never a per-day history table.

Up to three signals sit here, and they are **complementary, not redundant** —
show each one that exists:

1. **Gmail domain reputation** (Step 3d) — the *market reference*, straight from
   Google Postmaster Tools. Authoritative, but **Gmail-only** and lagging 2-3
   days. Render the category verbatim with a pill (🟢 `HIGH`, 🟡 `MEDIUM`,
   🟠 `LOW`, 🔴 `BAD`), plus the user-reported spam ratio and the SPF/DKIM/DMARC
   pass rates. Name the domain it grades. Never turn the category into a number.
2. **The cause behind a degraded signal** (Step 3e) — from SparkPost, the ESP
   that actually delivered. Its per-provider detail is the *diagnostic* layer and
   it belongs in the **local dashboard**, not here: this section gets **one
   clause at most**, naming the provider and the mechanism ("the delay is Gmail
   throttling"), and only when an email signal is actually degraded. **No table,
   no reason strings, no provider list on the canvas** — a client reading it
   needs to know email is being handled, not to debug SMTP. Point at the
   dashboard in the footnote and stop there.
3. **Sender score** (below) — computed by this skill from Airship's own delivery
   events. Covers **every** mailbox provider and has no lag, but it is our
   metric, not an industry one.

When a signal returned nothing (not configured, no grant, no data), say **why**
in one short clause — "Gmail reputation not available: domain not yet shared
with us in Postmaster Tools" — so the gap reads as a setup task, not as a
healthy signal. The sender score alone is a valid section; the other two are
enrichment.

**Never blend the sources.** Airship owns the KPI values and the thresholds;
SparkPost explains them. SparkPost counts *injections* where Airship counts
*sends*, so the totals legitimately differ — never restate an Airship KPI with a
SparkPost number, and flag a divergence beyond a few points as a caveat instead
of silently choosing one.

The **sender score** is a 0–100 composite of measured reputation signals for the
current window, computed **per sending domain** from SparkPost and rolled up to
the project from **raw counts, never by averaging the domain scores**.

`/api/reports/events` is no longer read at all, so there is no Airship fallback:
a project with no SparkPost domain configured has **no score**, and says so.
Score **both windows** so the callout can state where the score stood a month
ago. A domain under `min_email_sends` gets **no score at all** rather than a
flattering one computed on a handful of messages.

**The score measures acceptance, not placement — and the difference matters.**
It answers "did the receiver take the mail". It cannot answer "did the mail
reach the inbox or the spam folder", because inbox placement has no API without
SparkPost's paid Deliverability Add-On. Reporting the score alone is therefore
misleading precisely when things are worst: Client Alpha scored **100/100** in the
2026-09-01 run while its open rate fell 21.8 points with delivery steady at
99.7% and its sending IP suspended for 6.25M messages — accepted everywhere,
seen nowhere.

So always emit a **placement risk** beside the score, at both domain and project
level (`none` / `watch` / `high`, worst domain wins — a project is as exposed as
its most exposed sender). Raise it on:

- an **open-rate fall with delivery unchanged** (≥ 10 pts → `high`, ≥ 5 pts →
  `watch`). The gap between "delivered" and "opened" is the classic signature of
  filtering to spam, and it is invisible to every delivery-rate metric.
- a **suspended sending IP** (≥ 1,000 messages and ≥ 5% of deferrals) → `high`.
- a **complaint rate above 0.1%** → `watch`, even though 0.3% is the line Gmail
  and Yahoo enforce.
- **block bounces above their ceiling** → `watch`.

Never fold these into the score itself. The score's definition stays narrow and
auditable; the risk flag carries the ambiguity explicitly, where a reader can
weigh it.

Sub-scores interpolate linearly between these anchors, clamped to 0–100:

| Signal | Formula | Anchors (value → sub-score) | Weight |
|---|---|---|---|
| Deliverability | delivery ÷ injection | ≤ 90% → 0 · 95% → 60 · ≥ 99% → 100 | 0.30 |
| Bounce rate | bounce ÷ injection | ≤ 0.5% → 100 · 2% → 50 · ≥ 5% → 0 | 0.25 |
| Spam complaints | spam_complaint ÷ delivery | ≤ 0.02% → 100 · 0.1% → 50 · ≥ 0.3% → 0 | 0.25 |
| Unsubscribe rate | unsubscribe ÷ delivery | ≤ 0.2% → 100 · 0.5% → 50 · ≥ 1% → 0 | 0.10 |
| Delivery delay | delay ÷ delivery | ≤ 2% → 100 · 10% → 50 · ≥ 25% → 0 | 0.10 |

`sender_score = Σ (sub_score × weight)`, rounded to the nearest integer. Bands:
**≥ 90 Excellent · 75–89 Good · 60–74 Fair · < 60 At risk**.

Anchors and weights are **fixed**. Never retune them per client — a score that
moves with its own scale is not comparable across runs or projects.

**Cite the source on the canvas.** The client must be able to audit the number,
so the section footnote states all three of:

1. **Data** — the SparkPost Metrics API, scoped to each named sending domain
   (Step 3e), over the current 30-day window. There is no Airship fallback:
   `/api/reports/events` is not called, so a project with no configured domain
   simply has no email rates. State that the rates are computed on
   **injections** and therefore differ slightly from the Airship send volume —
   the
   two are **not meant to tie out**, and a client who compares them must find
   that stated rather than infer a bug.
2. **Computation** — the composite is calculated by this skill. Neither Airship
   nor SparkPost exposes a sender-score field (SparkPost's own **Health Score**
   has no public API), so **never** present it as a vendor metric, and never as
   Validity Sender Score or any other third-party reputation score.
3. **Anchors** — the spam-complaint band follows the Gmail/Yahoo bulk-sender
   requirements (stay under 0.1%, hard ceiling 0.3%); the others are this
   skill's email guardrails. The spam anchor is deliberately stricter than the
   `email_spam_complaint_rate_max` alerting threshold, which exists to catch
   outright incidents rather than to grade reputation.

Render the five sub-scores as the last column of the reputation table rather
than hiding them: that makes the composite reproducible from the canvas alone.

#### Never print a signed zero

A delta that rounds away to nothing must render as **`flat`**, never as `−0%` or
`−0 pts`. A signed zero reads as a truncated number and invites "minus zero
what?" — exactly the doubt a client-facing KPI table cannot afford. Apply this to
the per-OS columns as well as the totals: round first, then decide, so a value
whose *rounded* magnitude is zero never keeps its sign.

#### Level shifts — say when a drop is a stop

A 30-day delta cannot distinguish "the programme ended on a date" from "the
channel is degrading", and the two demand opposite responses. Before narrating
any volume fall, scan the daily series for a **step**: for each candidate split
point (leaving ≥ 10 days either side), compare the **median** before against the
median of everything after. Report it only when **all** of these hold, then name
the last normal day and the first day of the new level:

- the median falls by **> 60%**, and
- the **peak** after the split is **< 50%** of the peak before it.

Both tests are needed, and medians rather than means throughout. Client Bravo
alternates ~3.5M send days with ~200K ones, so a change in the *mix* moves the
median while nothing has stopped — its post-break peak is still 3.7M, and the
peak test is what rejects it. In the 2026-09-01 run the rule fired on exactly
two projects: Client Alpha (−81%, the day after a major sports final) and Client Charlie
(push reaching zero). Without it, Client Alpha's canvas opened on an alarming collapse
that was in fact a sports calendar ending on schedule.

Canvas format (first-run creation **and** the body appended after the title):

```
# KPI Monitor — {Client name}

_Last 30 days: **{curr_start} → {curr_end}** · vs the previous 30 days: **{prev_start} → {prev_end}** · run {run_timestamp}_

::: {.callout}
{Either: 🟢 **No confirmed critical alert**
 Or: 🔴 **{N} critical** — **{key}** ({OS}) open since {opened}{; plus any others, names only}}

📱 **App** — opens −2.3%, time in app −4.4%. A slow drift, nothing broken.

🔔 **Push** — volume cut by a quarter, which brought marketing pressure back from 17.3 to 13.1 msg/user/month. Response rate held.

📧 **Email** — delivery delay halved (16.8% → 9.0%) and the sender score rose to 90/100.
:::

## 📱 App & audience

| Metric | Last 30 d | Δ vs prev. 30 d | iOS | Android |
|---|---|---|---|---|
| 📱 App opens | **13.65M** | ↘ −2.3% | 7.87M · −1.7% | 5.77M · −3.1% |
| ⏱️ Time in app / day | **219.2k** | ↘ −4.4% | 147.9k · −6.4% | 71.3k · +0.1% |
| 📲 Opted-in devices | **3.65M** | ↗ +1.2% | 2.13M · +0.1% | 1.52M · +2.7% |
| ✅ Opt-in rate | **52.7%** | ↗ +0.5 pts | 53.6% 🟡 | 51.5% 🟡 |

🎯 **Market** — opt-in rate against the {vertical label} median (59.0% iOS · 54.6% Android): below median on both, but far above the 10th percentile (~30%).

## 🔔 Push

| Metric | Last 30 d | Δ vs prev. 30 d | iOS | Android |
|---|---|---|---|---|
| 🔔 Push sends | **47.88M** | ↘ −23.2% | 27.88M · −23.4% | 20.00M · −23.1% |
| 👆 Direct response rate | **0.89%** | ↗ +0.02 pts | 0.48% 🔴 | 1.46% 🟡 |
| ⚖️ Opt-in ÷ opt-out | **3.15** | ↗ +1.0% | 3.91 · −8.7% | 2.45 · +9.6% |
| 📊 Pressure (msg/user/mo) | **13.1** | ↘ −4.2 | 13.1 🟡 | 13.1 🔴 |

🎯 **Market** — direct response against the {vertical label} median (2.2% iOS · 2.5% Android): iOS sits in the bottom decile, Android below median. Pressure against p90 (15.7 iOS · 12.4 Android): iOS is back under the ceiling this month, Android is still above it.

📅 **The drop is a stop, not a slide.** Push ran at a typical 1.10M/day through **19 Jul 2026**, then dropped to 88.5K/day from **20 Jul 2026** and stayed there. The whole window-over-window delta comes from that single step, so read it as a campaign calendar that ended rather than a channel that is degrading — the two need very different responses.

## 📧 Email

| Signal | Last 30 d | Δ vs prev. 30 d | Guardrail | Status |
|---|---|---|---|---|
| 📨 Emails sent | **12.03M** | ↘ −53.8% | — | — |
| ✅ Deliverability | **99.20%** | ↗ +0.28 pts | ≥ 95% | 🟢 |
| ↩️ Bounce rate | **0.93%** | ↘ −0.18 pts | < 2% | 🟢 |
| 🧹 Hard bounces | **0.412%** | ↘ −0.03 pts | < 0.5% | 🟡 |
| ⛔ Block bounces | **0.004%** | → flat | < 0.1% | 🟢 |
| 🚫 Spam complaints | **0.002%** | → flat | < 0.3% | 🟢 |
| 🔕 Unsubscribe rate | **0.34%** | ↗ +0.19 pts | < 0.5% | 🟡 |
| 🕒 Delivery delay | **8.99%** | ↘ −7.85 pts | < 20% | 🟢 |
| 👀 Open rate | **51.50%** | ↗ +8.80 pts | drop < 4 pts | 🟢 |
| 👉 Click-to-open | **1.87%** | ↘ −12.4% | drop < 30% | 🟢 |

**Per sending domain** — scored on its own raw counts, never averaged.

| Domain | Score | Volume | Placement | Weakest signal |
|---|---|---|---|---|
| `mail.example.fr` | 🟢 **93** Excellent | 11.6M | 🟢 clear | Hard bounces 0.41% |
| `re.example.fr` | 🔴 **41** Poor | 402.4K | 🔴 at risk | Deliverability 88.10% — past guardrail |
| `tx.example.fr` | ⚪ `na` | 1.2K | ⚪ `na` | _under the 2,000-message floor — reported, not judged_ |

⚠️ **Sending IP suspended** — on `re.example.fr`. 82% of deferrals are SparkPost holding the IP; 6.25M messages affected.

Two rules that this table exists to enforce. **Never average a rate across a
client's domains** — recombine from raw counts, or Client Echo's 394K domain
disappears behind its 10.1M one. And a **declared domain that sent nothing in
the window is `na`, never `ok`**: list the idle domains under the table so a
silent sender is visibly silent rather than absent.

The **status chip** compares headroom against the *room the guardrail leaves*,
not against its raw value: 🔴 past it, 🟡 under 30% of the room left, 🟢
otherwise. Dividing by the raw threshold instead would rank a 99.2%
deliverability against a 95% floor as the weakest thing on the domain.

::: {.callout}
📮 **Gmail reputation — `email.example.com`: 🟢 HIGH**

User-reported spam 0.03% (peak 0.05%) · SPF 99.8% · DKIM 99.9% · DMARC 99.7% ·
Google Postmaster Tools, 30 days to {last_day}. *(Omit this whole callout when
Step 3d returned nothing, and add the reason to the footnote instead.)*
:::

::: {.callout}
🛡️ **Sender score 90 / 100 · Excellent** `█████████░`

Up from **87** over the previous 30 days: the delivery delay halved and bounces
fell, while a rising unsubscribe rate is the one signal moving the wrong way.
Weighted from the five reputation signals above (deliverability 30% · bounce
25% · spam 25% · unsubscribe 10% · delay 10%), measured by SparkPost on
`{sending domain}`.
:::

**Per sending domain** — emit this table **only when the project declares more
than one domain** in `clients.yml` `email.sending_domains`. With a single domain
the callout above already says everything and a one-row table is noise.

| Domain | Score | Volume | Weakest signal |
|---|---|---|---|
| `email.example.com` | 🟢 **96** Excellent | 10.8M | — |
| `email.example.re` | 🟡 **84** Good | 258K | Bounce 1.97% (ceiling 2%) |
| `mail.dormant.com` | ⚪️ **na** | — | No traffic in the window |

_(One row per declared domain, ordered by volume. **Score each domain on its own
raw counts and never average the rows** — the project score in the callout is
recombined from the summed counts, so a domain carrying 2% of the volume moves
it barely at all while its own row can still read 71. That gap is the reason
this table exists: Client Echo's headline delay is 5.1% while
`tv.client-echo.example` alone defers 49.6%. Weakest signal = the one reputation
signal with the least headroom, or "—" when every signal is clear. A domain
configured on SparkPost with no traffic in the window is **`na`, never `ok`** —
it was not measured, which is not the same as healthy.)_

Add one line under the table **only when a domain sends over shared IPs**:

> 🔗 `email.example.com` sends 90% of its volume on shared IPs alongside up to
> 18 other senders, so part of its reputation is inherited rather than earned.

_(State the exposure; do not editorialise on it. Shared is not automatically
worse — Client Delta's shared IPs deliver at ~97% while its own dedicated IP delivers at
35.8%. Omit the line entirely for a project on dedicated IPs, and never write a
reassuring "dedicated IPs" line: absence of the warning is the signal.)_

## 🔴 Critical alerts

| Alert | OS | Opened | Status | Note |
|---|---|---|---|---|
| app_opens_drop_ios | iOS | 2026-06-15 | Active | No campaign Jun 17–20 |

_(Only **confirmed + critical (🔴) + not muted**. Status is `Active` or
`Active · clearing {k}/{M}`; add ` · escalated {date}` when Step 10 fired on
this key. Note = one-line `possible_cause` from Step 8b, or "—" if none.
A TAM can set Status to `Muted` here — honoured next run, then the row
disappears. No open critical → write 🟢 **None confirmed.** and skip the table.)_

---

_(Window: the last 30 complete days vs the 30 immediately before — a full month
absorbs the campaign spikes that a shorter window turns into false trends. Δ is
shown on the total and on each OS. App, push, email volume and open rate come
from the Airship Reports API; opted-in devices from two dated
`/api/reports/devices` calls. {When Step 3e ran: The five email reputation
signals and the sender score come from the SparkPost Metrics API for {domain} —
they are computed on injections, so they deliberately do not tie out with the
Airship send-based figures above. | Otherwise: The email reputation signals come
from SparkPost per declared sending domain; the project figure is recombined
from the summed raw counts, never averaged across domains.} The score is
computed by this monitor, not a vendor field: SparkPost's own Health Score has
no public API. Guardrails are its 50-point anchors, the spam ceiling following
Gmail/Yahoo bulk-sender requirements. {Gmail reputation from Google Postmaster
Tools, Gmail traffic only, 2-3 day lag | Gmail domain reputation is not
connected on this project.} Benchmarks: Airship User Engagement {quarter},
{vertical label}, p10/p50/p90. {Unused channels} are unused on this project.
Alerting uses this same 30-day window, so the deltas here match the ones the
Airship team monitors; {when a signal is degraded and Step 3e returned data: name
the cause in one clause — "the delay is driven by Gmail throttling" —}
per-provider deliverability and the delay/bounce reasons sit in the local
monitoring dashboard. Never put the provider table or the reason strings on the
canvas.)_

_Insights refreshed: {date of the last weekly-insights fetch, or omit if never}_
_Recap posted: {date of the last weekly recap Slack post, or omit if never}_
```

On first-run creation, include the `#` title in `slack_create_canvas`. When
appending after a kept title, **do not** repeat the `#` line.

Keep the `_Insights refreshed:_` and `_Recap posted:_` footers (carry the dates
read in Step 7; update `_Insights refreshed` to `today` only when Step 7b ran
this run; update `_Recap posted` to `today` only when Step 10b posted this run).
They are throttle markers, not client content — keep them to one line each at
the very bottom.

**Section content rules:**

1. **KPI tables** — one row per KPI family in use this run, over the same two
   30-day windows as `metrics[]` (which they may now be read straight from).
   Do not invent. Fixed section and row order, skipping unused channels:
   - `## 📱 App & audience` — `app_opens`, `timeinapp`, `devices_optin`
     (window-end snapshot), `optin_rate`.
   - `## 🔔 Push` — `push_sends`, `direct_response_rate`, `optin_optout_ratio`,
     `push_pressure_per_user` (expressed per **month**, which the 30-day window
     gives directly — no ×4.33 extrapolation any more). Skip the whole section
     when push is unused (email-only projects).
   - `## 💬 SMS & web` — `sms_sends`, `web_sends`. Emit
     this section only when at least one is active.
   - Email has its own section and never appears in these tables.
2. **Email** — one table, then the sender-score callout. The table opens with
   the two **volume/engagement** rows (emails sent, open rate — Airship, no
   guardrail, `—` in the Score column) and continues with the five **reputation
   signals** that make up the score. It doubles as the **sender-score
   breakdown**: one row per signal, its current and previous rate, the **50-point
   anchor** as the guardrail, and the sub-score with a pill (🟢 inside the
   guardrail, 🟡 just outside, 🟠 well outside). Do **not** use 🔴 here — on this
   canvas red is reserved for confirmed critical alerts. Omit the whole section
   when the project sends no email.
3. **Critical alerts** — confirmed + `danger` + not muted only. One row per key.
   No analysis bullets. No candidate / watch / muted / info rows.
4. **Last-run line** — always `{run_timestamp}` (date **and** time).
5. **Do not recreate** retired sections (`🧭 Executive recap`, `🌍 Global
   snapshot`, `📈 3-month trend`, `🏆 Top campaigns`, `📨 Unicast`, `📱 Installed
   base`, `📈 Devices history`, `📧 Email deliverability health` as a dated
   table, the old verbose `🚨 Open Alerts` / Alert analysis block, and any
   flat `📊 Key metrics` table from the first short-canvas revision). Delete
   them if still present (step 2 of the procedure). This now also covers the
   **three-column `{.layout}` tiles** of the previous short-canvas revision and
   its **per-section italic footnotes** — replace them with the KPI tables and
   the single bottom footnote.

**If `slack_read_canvas` fails** (canvas not found, empty, or first run):
- Fall back to `slack_create_canvas` with the full initial content
- Return the canvas ID **and** the full `canvas_url` so the TAM can copy both
  into the automation prompt (or `clients.yml`)

### Step 12 — Update the local monitoring canvas (optional, local-only)

**Skipped on `canvas-only` runs** unless the prompt added `+local`.
(`canvas-only` still runs Step 13 so confirmation streaks persist.) Otherwise:

After finishing the run — in a **multi-client run, once all selected clients
have been processed**; in a single-client run, after that client — rewrite the
local Cursor canvas so the TAM has a roll-up dashboard of the latest run beside
the chat. This canvas is **local-only, gitignored, and never contains secrets**.
It is a convenience snapshot, not the source of truth: the local HTML dashboard
(Step 13) is the live operational record; the per-project Slack canvas (Step 11)
is the short client-facing snapshot. A canvas cannot fetch, so
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

**Always run** — including on `canvas-only`. This file is the confirmation-gate
memory (Step 7 / 8a). Step 12 (Cursor canvas) is the one skipped on
`canvas-only` unless `+local` was requested.

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

1. **Read-merge-write history — append TODAY'S point to EVERY series (MANDATORY,
   every run).** Before writing, read the existing `dashboard-data.js` if present
   and reuse its `history` array, each project's `alertHistory`, and **each
   metric's `series`**. Then, on **every** run (`full`, `alerts-only`, or
   `canvas-only` — whatever the cadence):
   - Append one point to the top-level `history`
     (`{ts, openAlerts, projectsInAlert}`).
   - For **EVERY** metric family emitted in `metrics[]` — **not only** the device
     snapshots — append this run's daily point `{ t: "<current_window_end>",
     v: <value> }` to that family's `series`, using the SAME value convention the
     family already uses (per the coverage map below):
       - `app_opens` / `push_sends` / `email_sends` / `web_sends` / `sms_sends` /
         `timeinapp` → that day's **total** (ios+android[+web/sms] as applicable);
       - `optin_optout_ratio` → that day's **optins ÷ optouts**;
       - `direct_response_rate` → that day's **direct ÷ sends × 100**;
       - `email_*` rate families → that day's rate;
       - `total_devices_evolution` / `devices_*` → the dated snapshot value;
       - `push_pressure_per_user` → this run's rolling 30-day value (the series
         samples that rolling figure weekly, so points share the headline unit).
   - **Backfill gaps.** If more than one new daily row is available since the last
     stored point (e.g. runs were missed), append **one point per missing day** so
     the series never develops a gap — do not jump straight to today.
   - Keep the **last ~14** `history` entries and the **last ~12** points per metric
     `series` (drop the oldest beyond that), then rewrite the whole file.

   > ⚠️ **Common failure to avoid (regression seen in practice).** Refreshing only
   > the headline `current` / `previous` / `deltaPct` / `status` / `threshold` and
   > the device series while leaving the app/push/engagement `series` untouched
   > freezes every history chart on the last full run. A patch that appends to a
   > *hand-picked list* of families is the usual cause — **iterate over ALL
   > families instead.**
   >
   > ✅ **Self-check before writing the file:** the newest `t` in **every** non-`na`
   > family's `series` MUST equal `current_window_end` (or the latest day actually
   > available). If any family's series still ends on an earlier date, its point was
   > not appended — fix it before writing.

   If the old file is missing or unparseable, start fresh (fail-open). On a
   **weekly run** (Step 7b open), you may seed a longer `series` from the 3-month
   history already fetched instead of only appending.

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
                          cause: "<short cause>", muted: <true|false>, reason: "<why muted, if muted>",
                          streak: <consecutive breaching runs>,
                          clearStreak: <consecutive clean runs while confirmed, else 0>,
                          lastEscalated: "<YYYY-MM-DD>|omit",
                          firstBreach: "<YYYY-MM-DD>|omit" }, … ],
           // Candidate breaches (Step 8a) — breaching but NOT yet confirmed.
           // Dashboard-only, never posted to Slack, never listed on the canvas.
           // Shows a streak chip (streak/needed). REQUIRED for the next run's gate.
           candidatesList: [ { key: "<alert_key>", severity: "danger|warning|info",
                          streak: <consecutive breaching runs>, needed: <confirm_runs for this key>,
                          cause: "<short cause>", firstBreach: "<YYYY-MM-DD>|omit" }, … ],
           // Per-KPI depth for the project detail page (Monitor → Open details).
           // One entry per evaluated metric; powers the KPI cards, headroom gauges
           // and mini-series. Optional but strongly recommended.
           // CANONICAL NAMING (see "Metric family naming" below): `key` is the KPI
           // FAMILY name (app_opens, timeinapp, optin_optout_ratio,
           // push_sends, push_pressure_per_user, direct_response_rate,
           // total_devices_evolution, devices_optin,
           // devices_uninstall, email_sends, email_deliverability, email_open_rate,
           // email_bounce, email_unsubscribe, email_spam_complaint_rate,
           // email_delay_rate, web_sends, sms_sends).
           // ONE metric per family — NEVER bake the OS or direction into the key
           // (no `app_opens_ios`/`time_in_app`); the per-OS split lives in the `os`
           // OBJECT below. `threshold.key` is the exact catalog key (thresholds-catalog.js).
           metrics: [ { key: "<KPI family key — see the coverage map below>", label: "<human label>",
                          group: "app|push|acquisition|email|web|sms",
                          channel: "app|push|email|web|sms",
                          unit: "%|pts|count|min|x",
                          current: <number>, previous: <number>,          // window totals/rates
                          deltaPct: <n|omit>, deltaPts: <n|omit>,          // 30d vs previous 30d change (pick the one that fits the metric); omit both when not computable (e.g. device snapshot with only one dated call, or a unique-devices trend with <2 stored snapshots)
                          // Per-OS split — an OBJECT (NOT a scalar, NOT baked into `key`).
                          // REQUIRED on every family that has per-OS data: app_opens,
           // timeinapp, optin_optout_ratio, push_sends,
           // direct_response_rate, total_devices_evolution,
           // devices_*. The card
                          // renders the split ONLY from this object: it shows each OS's
                          // `deltaPct` chip when present, else its absolute `value`. Use
                          // `deltaPct` for 30-day rate/volume KPIs (incl. rate KPIs like
                          // direct_response_rate and optin_optout_ratio — per-OS deltaPct,
                          // and the two-date device evolution families — per-OS deltaPct),
                          // `value` for device snapshots with only one dated call.
                          // Include `web` when that channel is active. Omit/null ONLY for
                          // genuinely channel-wide metrics with no OS breakdown (e.g.
                          // email/sms/web/custom).
                          os: { ios: { deltaPct: <n> | value: <n> }, android: { … }, web: { … } } | null,
                          // Optional per-send RATE object for any raw-count metric that also tracks a rate. Omit if n/a.
                          rate: { current: <n>, previous: <n>, deltaPct: <n> } | { note: "<qualitative>" } | omit,
                          // Cross-source figures (email projects with SparkPost). Present ONLY when
                          // two systems measure this KPI. The card headlines `sources[primary]`
                          // (value, previous AND delta all from that one source, never mixed) and
                          // keeps the other visible underneath, so the KPI appears once on the page.
                          // SparkPost is primary on every rate it measures; Airship stays primary on
                          // email_sends and email_unsubscribe. Use `note` whenever the two are not
                          // strictly comparable. Omit entirely for single-source KPIs — the card then
                          // shows an "Airship" chip and behaves exactly as before.
                          sources: { primary: "sparkpost|airship",
                                     airship:   { current: <n>, previous: <n>, deltaPct|deltaPts: <n> },
                                     sparkpost: { current: <n>, previous: <n>, deltaPct|deltaPts: <n> },
                                     note: "<why the two differ, when they are not comparable>" } | omit,
                          note: "<one-line caption, e.g. why a rise was suppressed>" | omit,
                          analysis: "<one client-contextualized sentence: reads the value + 30-day evolution, position vs benchmark when relevant, brief brand/activity context, and whether it is a concern>" | omit,
                          threshold: { key: "<threshold key>", value: <effective number>,
                                       kind: "drop|rise|floor|ceiling|gap",
                                       headroom: <number|omit>,            // distance to breach (see below); omit if not computable
                                       breaching: <true|false> },
                          status: "ok|candidate|confirmed|muted|na",       // na = below min volume
                          series: [ { t: "<YYYY-MM-DD>", v: <number> }, … ] }, … ],  // newest last, ≤12
           // SparkPost email drill-down (Step 3e). Email projects with
           // `email.sparkpost: true` only — OMIT the whole key otherwise, the panel
           // then does not render. This is where the deep email analysis lives; the
           // Slack canvas stays synthetic and points here.
           deliverability: {
             source: "SparkPost Metrics API", sendingDomain: "<domain scoping the call>",
             window: "<curr_start> → <curr_end> (<tz>)", fetchedAt: "<run_timestamp>",
             // Account-wide totals for the window. Denominators are INJECTIONS.
             totals: { injected, delivered, deliveryRate, delayRate, bounceRate, spamRate, openRate },
             // The diagnosis — rendered ABOVE the numbers. 2–4 entries; each must
             // move the reader toward an action, not restate a rate.
             findings: [ { severity: "danger|warning|info|success",
                           title: "<the conclusion, not the metric>",
                           detail: "<2–3 sentences: evidence, then what it means>" }, … ],
             // Ordered by volume. `share` = provider injections ÷ total × 100.
             providers: [ { name, share, injected, deliveryRate, delayRate, bounceRate, openRate }, … ],
             // Raw MTA response strings — copy VERBATIM, never paraphrase here.
             delayReasons: [ { domain, count, reason }, … ],
             bounceClasses: [ { name, category: "Soft|Hard|Block", count }, … ],
             // Step 3d's result, or why it is missing.
             gmailReputation: { reputation: "<HIGH|MEDIUM|LOW|BAD>", lastDay: "<YYYY-MM-DD>" }
                              | { reason: "<why unavailable>" } | omit,
           },
           // One entry per DECLARED sending domain, ordered by volume. This is the
           // level a per-domain collapse is visible at; the project `metrics[]`
           // above are recombined from the summed raw counts and will understate it.
           // Omit the whole key on projects with no SparkPost domain.
           emailDomains: [
             { domain: "<sending domain>",
               // false when the domain is declared but sent nothing in the window.
               // Such a domain is `na` everywhere — never `ok`. It was not measured.
               active: <bool>,
               rates: { injected, delivered, delivery_rate, bounce_rate, hard_bounce_rate,
                        block_bounce_rate, spam_complaint_rate, delay_rate,
                        // Retry pressure, diagnostic only: delay EVENTS per delivered
                        // message, so it is unbounded and is NOT a percentage.
                        delay_retries_per_delivered, open_rate, click_rate, unsubscribes },
               previousRates: { … same shape, previous 30 days … },
               senderScore: <0–100 | null>, senderGrade: "excellent|good|fair|poor|critical|na",
               // Same six email keys as the project, evaluated on THIS domain, with
               // their own threshold + headroom + status. A domain may breach while
               // the project rollup is clear — that alert stays open, scoped to the
               // domain (Step 8a), and must not resolve on the rollup.
               metrics: [ { key, label, group: "email", channel: "email", unit,
                            source: "SparkPost Metrics API", domain, current, previous,
                            deltaPts | deltaPct, threshold, status, series } , … ],
               ipExposure: { ip_count, shared_ip_count, shared_volume_pct,
                             worst_co_tenant_count } | null,
               // `shared` counts only co-tenants OUTSIDE this client's own domains.
               sendingIps: [ { ip, injected, deliveryRate, bounceRate,
                               shared: <bool>, coTenantCount, coTenants: [ "<domain>", … ] }, … ],
               analysis: "<one line: volume, rates, score, and IP exposure>" },
             …
           ],
           // Project rollup. `rates` here are recombined from SUMMED RAW COUNTS
           // across the domains — never the mean of the per-domain rates.
           emailSummary: { source: "SparkPost Metrics API", domainCount, activeDomainCount,
                           senderScore, senderGrade, rates: { … },
                           worstDomain: "<lowest-scoring active domain>",
                           sharedIpVolumePct: <volume-weighted % on shared IPs | null> },
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
     `muted` flag (+ `reason` when muted). **Also persist `streak`, `clearStreak`,
     `lastEscalated`, `firstBreach`** — Step 7 reads them back as the confirmation
     gate's memory. The dashboard renders a per-alert Mute button (or Unmute + a
     "Muted" pill for already-muted ones). Muted entries are de-emphasised and
     excluded from `worstSeverity`.
   - **`candidatesList`** (optional): one entry per **candidate** breach (Step 8a —
     breaching but not yet confirmed). Include `key`, `severity`, `streak`
     (consecutive breaching runs), `needed` (`confirm_runs` for that key), a
     short `cause`, and `firstBreach`. The dashboard shows these under a "Watching · not yet confirmed"
     sub-list with a `streak/needed` chip and a `🔎 N watching` badge. Candidates
     are **never** counted in `alerts.count`, **never** posted to Slack, and
     **never** listed on the Slack canvas. **Do not omit this list** — without it
     the next run cannot continue a candidate's streak.
   - **`deliverability`** (email projects with SparkPost only): the drill-down
     from Step 3e. It renders **inside the Email KPI panel** — findings above the
     cards, provider table and reason lists below — so a TAM reads one email
     section rather than hunting across two. It exists because the two surfaces
     have different jobs: the Slack canvas answers *"is email healthy?"* for the
     client, this answers *"what exactly is wrong and what do we do?"* for the TAM.
     Three rules:
       - **No duplicate tiles.** Do not emit the account totals as their own
         tiles — every one of them belongs on its KPI card via `sources`. The
         panel contributes only what has no card: the diagnosis, the provider
         split, and the reason strings.
       - **Never reconcile it with `metrics`.** SparkPost divides by injections and
         Airship by sends, so the same KPI legitimately differs (Client Bravo:
         12.7% vs 13.3% delay). Do not adjust either side to make them agree.
       - **`findings[]` carries the interpretation, the reason strings carry the
         evidence.** Copy `delayReasons` / `bounceClasses` verbatim from the API and
         put every conclusion in `findings[]`. A finding built on a rate the panel
         already shows, with nothing added, should be dropped.
   - **`metrics`** (strongly recommended): the per-KPI depth shown on the
     **project detail page** (`Monitor → Open details →`) — the centralized view of
     **every monitored KPI**, its evolution and any problem. Emit **one entry per
     monitored KPI on every channel the project actually uses — including the
     healthy ones**, not only breaching KPIs (app opens, time in app, push sends,
     click rate, opt-in velocity, devices, the email family, web push,
     SMS). Coverage rules:
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
         window** (the trend itself, not a separate window-delta figure) — omit any day
         whose opt-out count was 0 (undefined ratio) rather than inventing a spike.
         `unit: "x"`. Its `analysis` must interpret whether the ratio is above/below
         1 and its direction (> 1 = net-positive reach; < 1 = churn-dominant). This
         replaces the old standalone "Opt-in registrations" tile/family (`optins`) —
         the underlying `/api/reports/optins` / `/api/reports/optouts` fetches are
         unchanged, only their KPI-card usage moved.
       - **Push — push pressure per user per 30 days.** Emit a `push_pressure_per_user`
         card (label **"Push pressure / user / 30d"**, `group: "push"`, `unit: "x"`):
         `current`/`previous` = the current / previous 30-day window value (window push sends
         iOS+Android ÷ opted-in devices), `threshold.key: "push_pressure_per_user_max_30d"`
         (ceiling, informational), and `series` = the **rolling 30-day value sampled
         weekly**. Denominator is the opted-in base at each sample date via
         `/api/reports/devices?date=<sample date>` (Step 6); when a dated call is
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
       - **The card MUST measure what the alert measures.** A card carries one
         `threshold` block, so `current`, `threshold.headroom` and
         `threshold.breaching` have to describe the **same guard that decided the
         status** — otherwise the card contradicts itself. Two rules:
         - **Per-day guards → emit the worst day, not a window aggregate.**
           `email_delay_rate` and `email_spam_complaint_rate` alert on "≥ 1 day
           above the ceiling in the current window", so `current` MUST be the
           **peak usable daily rate inside the current window** (usable = ≤ 100%,
           above the min-delivery floor), with the peak's date in `note`. Emitting
           an average or an out-of-window value produces the observed
           contradiction: a card reading *3.2% · 6.8 pts of headroom · healthy*
           while carrying a confirmed `email_delay_high`, its series holding **no
           point at all inside the current window** and its peak dating from a
           month earlier.
         - **Dual-guard families → emit the guard that fired.** Several families
           are watched by two thresholds while the card shows one:
           `web_sends` / `sms_sends` (drop **and** rise),
           `direct_response_rate` (floor **and** collapse),
           `app_opens` (drop **and** cross-OS gap). When
           the guard that fired is not the one the card carries by default, emit
           **that** guard's `key`/`value`/`kind`/`headroom`/`breaching` instead, so
           a rise-driven alert never renders as a healthy drop gauge. Real cases
           where the card's guard was not the firing one: `web_sends_rise`,
           `sms_sends_rise`. `net_optin_negative_{os}`
           has no catalog threshold at all — emit it with the `key` omitted rather
           than borrowing an unrelated threshold.
     - **Metric family naming (canonical — no exceptions).** `metrics[].key` is the
       KPI **family** name, identical to the `KPI_META` key in `app.js` and resolving
       to the catalog thresholds. Emit **exactly one metric per family**; carry the OS
       breakdown in the `os` OBJECT, **never** in the key.        Do **not** emit
       `app_opens_ios`/`app_opens_android`, `time_in_app`,
       `email_bounce_rate`, `web_push_sends`, `email_spam_rate`, or any OS/direction
       suffix — the correct families are:
       `app_opens`, `timeinapp`, `optin_optout_ratio`, `push_sends`,
       `push_pressure_per_user`, `direct_response_rate`,
       `total_devices_evolution`, `devices_optin`,
       `devices_uninstall`, `email_sends`, `email_deliverability`, `email_open_rate`,
       `email_bounce`, `email_unsubscribe`, `email_spam_complaint_rate`,
       `email_delay_rate`, `web_sends`, `sms_sends`.
       Each metric's `threshold.key` is the exact key from
       `dashboard/thresholds-catalog.js` (e.g. family `timeinapp` → `timeinapp_drop_pct`;
       `push_pressure_per_user` → `push_pressure_per_user_max_30d`;
       `total_devices_evolution` → `total_devices_evolution_drop_pct`;
       `optin_optout_ratio` → `optin_optout_ratio_drop_pct`; `email_bounce` →
       `email_bounce_max`; `email_spam_complaint_rate` → `email_spam_complaint_rate_max`).
     - **Coverage map (catalog group → families → section).** For **every actively-used
       channel**, emit **all** its families (healthy = `status:"ok"`, below the
       `min_*` floor = `status:"na"`), each with an `os` object where noted:
       | Section (`group`) | Families to emit (per active channel) | Per-OS `os` object? |
       |---|---|---|
       | `app` | `app_opens`, `timeinapp`, `optin_optout_ratio` | yes (iOS/Android) |
       | `push` | `push_sends`, `push_pressure_per_user`, `direct_response_rate` | **yes for sends/click rate;** `push_pressure_per_user` is a per-project 30-day figure (no OS object) |
       | `acquisition` | `total_devices_evolution`, `devices_optin`, `devices_uninstall` | yes (per-OS `deltaPct` from the two dated calls; `value` when only one dated call; +`web`/`sms` when active) |
       | `email` | `email_sends`, `email_deliverability`, `email_open_rate`, `email_bounce`, `email_unsubscribe`, `email_spam_complaint_rate`, `email_delay_rate` | no (channel-wide) |
       | `web` | `web_sends` | no |
       | `sms` | `sms_sends` | no |
       (There is no longer a `custom` group — client custom events are not
       monitored, see Step 3. There is no longer a `devices` group — it was reventilated: the merged
       `total_devices_evolution` and `devices_optin`/`devices_uninstall` all sit in
       `acquisition`; the former `installs` and `devices_unique` families are gone.)
       Min-volume gates map per family: `min_push_sends`→push; `min_optin_optout_volume`→
       `optin_optout_ratio`; `min_timeinapp`→timeinapp; `min_email_sends`→email family
       (`min_email_delivery_day` gates spam/delay);
       `min_sms_sends`→sms_sends;
       `min_web_sends`→web_sends. `total_devices_evolution`/`devices_optin`/
       `devices_uninstall`/`push_pressure_per_user` have no min-volume gate (device
       snapshots are never volume-gated; push pressure is informational).
     For each entry: a human `label`; a `group`/`channel` so the page can bucket
     cards by channel (App & engagement, Push, Acquisition & opt-ins, Email, Web
     push, SMS); the `current` and `previous` window values
     with the 30-day change as `deltaPct` **or** `deltaPts` (points for rate metrics
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
     Three hard constraints on it:
     - **Clamp it to the threshold magnitude.** For a `drop` or `rise` guard, a
       metric that moved the *safe* way is simply at full margin — cap
       `headroom` at `|threshold.value|` instead of letting the favourable delta
       inflate it (a `+443%` email-sends week yielded `543.7`, a `+189%` app-opens
       week `229.5`). An unbounded headroom makes the "worst headroom" ranking and
       the near-breach colouring meaningless.
     - **Sign must agree with `breaching`.** `breaching: true` requires a negative
       `headroom` and vice-versa. If the alert comes from a guard the card does not
       carry, emit *that* guard (see "The card MUST measure what the alert
       measures" above) rather than pairing `breaching: true` with a positive
       margin — the gauge then prints a nonsensical "Breaching by −6.8".
     - **`kind` is a closed set:** `drop` | `rise` | `floor` | `ceiling` | `gap`.
       Nothing else (`droppts` has been emitted and renders raw on the card).
     > The dashboard ranks a project's weakest KPI on the **relative** margin
     > (`headroom ÷ |threshold|`), because headroom is expressed in each metric's
     > own unit against thresholds spanning 0.5 to 100 and is therefore not
     > comparable raw. Keep that in mind when choosing a threshold's unit.
   - **`metrics[].analysis`** (recommended): **one client-contextualized sentence
     per KPI**, in English, shown on the card under the values. It should read the
     current value and its 30-day evolution, position it **vs the market/internal
     benchmark when relevant** (reuse Step 7b.2 bands for push/app KPIs), add a
     brief best-effort **brand/activity context**, and state **whether it is a
     concern** or healthy. Keep it to a single, scannable sentence — never a
     paragraph, never fabricated numbers.
     - **Cadence (cost control).** Author `analysis` with the model **only when
       `run_weekly_insights` is true** (the weekly gate, Step 0/7b). On lighter
       `alerts-only` runs, **reuse** each KPI's previous `analysis` from the existing
       `dashboard-data.js` (same read-merge-write pattern as `series`/`history`),
       refreshing only a KPI whose status changed materially (e.g. crossed into
       `candidate`/`confirmed` or resolved).
     - **Deterministic fallback.** If no prior `analysis` exists and it is not a
       weekly run, emit a short factual sentence built from the numbers you already
       have (direction + magnitude of the 30-day change, and the headroom / breach
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
     from the prior `alertsList[].openedAt` (or a legacy canvas `Opened` column
     on first migration). For an **aggregated** `email_delay_high` / `email_spam_complaint_high`
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
   this step and log a warning — it never blocks Slack alerts or per-project
   canvases. **Do log it clearly**: without this file the next run has no
   confirmation-streak memory (first-run empty state).

#### Threshold suggestions (how to fill `thresholdSuggestions`)

For each project, look at the thresholds you actually evaluated and propose an
adjustment **only when the data clearly supports it** — an empty array is a valid,
common result. Never invent numbers; base every suggestion on observed behaviour
from this run's `metrics.series`, the confirmation gate (Step 8a), and the
project's mute/resolve history. Emit at most a handful per project (the noisiest
first). Each suggestion has three possible bases:

- **`volatility`** → *loosen.* When a metric's normal window-to-window swing (spread of its
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
