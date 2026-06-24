# airship-kpi-monitor

Daily KPI monitoring for Airship projects — posts Slack alerts when significant
metric variations are detected, and maintains a weekly canvas summary.

Built as a [Cursor Skill](https://cursor.com) running on **Cloud Agents** (no
server required). One automation per client, deployed in minutes by any TAM.

---

## What it monitors

| Category | KPIs |
|---|---|
| **App** | Mobile app opens (per OS) |
| **Engagement** | Avg time in app /day (per OS) |
| **Devices** | Installed base, opted-in, uninstalls (iOS, Android, Web) |
| **Mobile push** | Sends, opt-outs, direct response rate (per OS — direct rate collapse flags a tracking/SDK issue) |
| **Acquisition** | New opt-ins + net opt-in balance (opt-ins − opt-outs), per OS |
| **Email** | Sends, deliverability, open rate, bounce rate, unsubscribes |
| **Web push** | Sends (if channel active) |
| **Custom events** | New events, strong rises, strong drops, vanished events |

App, push, engagement and acquisition KPIs are analysed **per OS (iOS /
Android)** so a single-platform regression is never masked by the other
platform's volume.

All comparisons use **rolling 7-day windows**: last 7 complete days vs the
7 days before that. This eliminates daily noise and weekly seasonality.

Every figure (Slack + canvas) is **source-traceable** — each section names the
Airship Reports endpoint it comes from, and any problem alert states the source
endpoint and the denominator used.

---

## How it works

```
Daily cron (Cloud Agent, 07:00 UTC)
  → calls Airship Reports API (14 days DAILY in one fetch per endpoint)
  → reads canvas for D-7 device snapshot + open alert state
  → computes deltas and evaluates thresholds
  → posts Slack alert only for NEW anomalies (anti-duplication)
  → updates canvas: devices history + open alerts table
```

Device WoW comparison uses the **Slack canvas as persistent memory** — Cloud
Agents have no local storage, so each run writes today's snapshot to the
canvas and reads the D-7 value from it.

---

## Installation (TAMs)

### Install the skill (once)

```bash
git clone https://github.com/thomasfaro/airship-kpi-monitor \
  ~/.cursor/skills/airship-kpi-monitor
```

### Update the skill

```bash
cd ~/.cursor/skills/airship-kpi-monitor && git pull
```

Cloud Agent automations always use the latest version from the repo —
no action needed for them after a `git push` to `main`.

---

## Setup per client

See [MODOP.md](MODOP.md) for the full step-by-step guide.

Quick summary:
1. Run the skill manually once in Cursor chat to create the canvas
2. Create a Cloud Agent automation (daily, 07:00, this repo as workspace)
3. Paste the canvas ID returned by step 1 into the automation prompt

---

## Automation prompt template

```
Client name: {Client name}
Brand name: {Public brand name for web search — e.g. "Banque Populaire" not "BP PROD"}
Airship MCP server: {user-XX PROD}
Slack channel ID: {C0XXXXXXXX}
Slack canvas ID: {F0XXXXXXXXX}
Alert language: en
Custom thresholds (leave blank for defaults):
  push_sends_drop_pct: 40

Follow SKILL.md (airship-kpi-monitor) to run the daily KPI check
using rolling 7-day windows.
```

---

## Default thresholds

All thresholds can be overridden per client in the automation prompt.

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
| `web_sends_drop_pct` | 30 | Web push sends drop > 30% → alert |
| `custom_event_rise_pct` | 50 | Custom event rise > 50% → alert |
| `custom_event_drop_pct` | 50 | Custom event drop > 50% → alert |

`net_optin_negative` (no numeric threshold): alerts when the net balance
(opt-ins − opt-outs) flips from ≥ 0 to < 0 on an OS.

Minimum volumes (thresholds skipped if previous window is below these):

| Key | Default |
|---|---|
| `min_push_sends` | 1000 (per OS) |
| `min_email_sends` | 500 |
| `min_custom_event_count` | 200 |
| `min_optins` | 100 (per OS) |
| `min_timeinapp` | 1 |

---

## Changing default thresholds globally

Edit `SKILL.md` under `Default thresholds`, commit and push to `main`. All
Cloud Agent automations pick up the change on their next run.

---

## Repository structure

```
airship-kpi-monitor/
├── SKILL.md    ← core logic (read by Cursor agents)
├── MODOP.md    ← step-by-step setup guide for TAMs
└── README.md   ← this file
```

---

## Requirements

- Cursor with Cloud Agents enabled
- Airship MCP configured per client (app key + OAuth credentials)
- Slack MCP plugin enabled
- `gh` CLI (optional — only needed to create/manage this repo)
