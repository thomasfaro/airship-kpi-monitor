# airship-kpi-monitor

Daily KPI monitoring for Airship projects — posts Slack alerts when significant
metric variations are detected, and maintains a weekly canvas summary.

Built as a [Cursor Skill](https://cursor.com) running on **Cloud Agents** (no
server required). One automation per client, deployed in minutes by any TAM.

---

## What it monitors

| Category | KPIs |
|---|---|
| **App** | Mobile app opens |
| **Devices** | Installed base, opted-in, uninstalls (iOS, Android, Web) |
| **Mobile push** | Sends, opt-outs, direct response rate |
| **Email** | Sends, deliverability, open rate, bounce rate, unsubscribes |
| **Web push** | Sends (if channel active) |
| **Custom events** | New events, strong rises, strong drops, vanished events |

All comparisons use **rolling 7-day windows**: last 7 complete days vs the
7 days before that. This eliminates daily noise and weekly seasonality.

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

| Key | Default | Meaning |
|---|---|---|
| `app_opens_drop_pct` | 20 | App opens drop > 20% → alert |
| `devices_unique_drop_pct` | 5 | Installed base drop > 5% → alert |
| `devices_optin_drop_pct` | 5 | Opted-in drop > 5% → alert |
| `devices_uninstall_rise_pct` | 10 | Uninstall count rise > 10% → alert |
| `push_sends_drop_pct` | 30 | Push sends drop > 30% → alert |
| `optouts_rise_pct` | 20 | Opt-outs rise > 20% → alert |
| `direct_response_rate_min` | 0.5 | Direct click rate < 0.5% → alert |
| `email_sends_drop_pct` | 20 | Email sends drop > 20% → alert |
| `email_deliverability_min` | 95 | Deliverability < 95% → alert |
| `email_open_rate_drop_pts` | 5 | Open rate drop > 5 pts → alert |
| `email_bounce_max` | 2 | Bounce rate > 2% → alert |
| `email_unsubscribe_rise_pct` | 30 | Unsubscribes rise > 30% → alert |
| `web_sends_drop_pct` | 30 | Web push sends drop > 30% → alert |
| `custom_event_rise_pct` | 50 | Custom event rise > 50% → alert |
| `custom_event_drop_pct` | 50 | Custom event drop > 50% → alert |

Minimum volumes (thresholds skipped if previous window is below these):

| Key | Default |
|---|---|
| `min_push_sends` | 1000 |
| `min_email_sends` | 500 |
| `min_custom_event_count` | 200 |

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
