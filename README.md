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

## Installation (once per TAM workstation)

```bash
git clone https://github.com/thomasfaro/airship-kpi-monitor \
  ~/.cursor/skills/airship-kpi-monitor
```

To update later:

```bash
cd ~/.cursor/skills/airship-kpi-monitor && git pull
```

Then follow [MODOP.md](MODOP.md) to configure each client's Airship MCP server
in Cursor and register the client in your local `clients.yml`.

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

## Client registry — `clients.yml`

Keep every client in [`clients.yml`](clients.yml), then trigger the check from
Cursor chat. The agent reads the registry and runs the full workflow once per
selected client, sequentially.

> **Credentials vs routing**: `clients.yml` holds **no secrets** — only routing
> (MCP server name, Slack channel, region). OAuth credentials live solely in
> your local `~/.cursor/mcp.json`, configured once per client (see
> [MODOP.md](MODOP.md) §1.6). Setting up many clients at once? An optional
> generator (`scripts/generate_mcp_config.py` + a gitignored
> `clients.secrets.yml`) can create the `mcp.json` entries in bulk — see
> MODOP §1.7. Skip it if your MCPs are already configured.

Registry entry format (see [`clients.yml`](clients.yml) for the full reference):

```yaml
clients:
  - name: Client A
    brand_name: Client A Brand Name
    airship_mcp: user-CLIENT-A PROD    # MCP server name from ~/.cursor/mcp.json
    slack_channel_id: C0XXXXXXXX
    slack_canvas_id: F0XXXXXXXX        # leave blank on first run
    region: eu
    alert_language: fr
    enabled: true
    # custom_thresholds:
    #   push_sends_drop_pct: 40
```

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
| `email_delay_rate_max` | 5 | Daily delay rate > 5% of deliveries → alert |
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
| `min_email_delivery_day` | 100 (per day, for spam/delay alerts) |
| `min_email_campaign_sends` | 5000 (min blast size for delay campaign correlation) |
| `min_custom_event_count` | 200 |
| `min_optins` | 100 (per OS) |
| `min_timeinapp` | 1 |

---

## Changing default thresholds globally

Edit `SKILL.md` under `Default thresholds`, commit and push. Anyone who pulls
the latest version picks up the new defaults on their next run.

---

## Repository structure

```
airship-kpi-monitor/
├── SKILL.md                     ← core logic (read by Cursor agents)
├── clients.yml                  ← client registry template (non-secret routing)
├── clients.secrets.example.yml  ← template for the optional MCP generator
├── scripts/
│   └── generate_mcp_config.py   ← optional: bulk-build ~/.cursor/mcp.json
├── MODOP.md                     ← step-by-step setup guide for TAMs
└── README.md                    ← this file
```

---

## Requirements

- Cursor IDE
- `uv` installed (`brew install uv`)
- Airship MCP package available locally (internal — ask your team lead)
- Airship OAuth credentials per client (scopes: `rpt` + `tpl`)
- Slack MCP plugin enabled and authenticated in Cursor
