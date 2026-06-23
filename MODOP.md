# MODOP — Airship KPI Monitor Setup Guide for TAMs

> **Audience**: Technical Account Managers setting up the daily KPI alert
> automation for a new client.  
> **Time**: ~15 minutes per client (after the one-time prerequisites).

---

## Part 1 — Prerequisites (once per TAM workstation)

### 1.1 Install the skill

Clone this repository into your Cursor skills folder:

```bash
git clone https://github.com/thomasfaro/airship-kpi-monitor \
  ~/.cursor/skills/airship-kpi-monitor
```

Verify:

```bash
ls ~/.cursor/skills/airship-kpi-monitor/SKILL.md
```

### 1.2 Enable the Slack MCP plugin

In Cursor, open **Settings → MCP** (or the MCP panel) and confirm the Slack
plugin is enabled. It should appear in the list as `plugin-slack-slack` (or
similar). If not, install it from the Cursor MCP marketplace.

### 1.3 Enable Cloud Agents on cursor.com

1. Go to [cursor.com/dashboard](https://cursor.com/dashboard?tab=cloud-agents)
2. Under **Cloud Agents**, add `thomasfaro/airship-kpi-monitor` as a workspace
3. Confirm the Slack MCP and the client Airship MCP appear under **Available
   MCPs** for that workspace

### 1.4 Client Airship MCP

The Airship MCP for the client must already be configured in Cursor (e.g.,
`user-M6 PROD`). If not, add it via **Settings → MCP** with the client's
app key and OAuth credentials.

---

## Part 2 — Gather client info (once per client)

You need three pieces of information before setting up the automation:

| Info | How to get it |
|---|---|
| **Airship MCP server name** | Check Cursor MCP list (e.g. `user-HM PROD`) |
| **Slack channel ID** | Right-click the channel in Slack → **Copy link** → the ID is the last segment of the URL, starting with `C` (e.g. `C0YYYYYYYY`) |
| **Slack canvas ID** | Leave blank — the skill creates it on the first run and returns the ID |

Optional:
- **Alert language**: `en` (default) or `fr` for French-language alerts
- **Custom thresholds**: any threshold from the default list you want to
  override for this client (e.g. `push_sends_drop_pct: 40`)

---

## Part 3 — Manual test run (5 min)

Before creating the scheduled automation, validate the skill works for this
client.

**In Cursor chat**, type:

```
Run airship-kpi-monitor for client {Client name}.
Brand name: {Public brand name — e.g. "Burger King France", "Banque Populaire"}
Airship MCP server: {user-XX PROD}
Slack channel ID: {C0XXXXXXXX}
Alert language: en

Follow SKILL.md (airship-kpi-monitor) to run the daily KPI check
using rolling 7-day windows.
```

Replace `{...}` with actual values. Press Enter and let the agent run.

**What to verify:**
- [ ] Agent completes without errors
- [ ] A Slack message appears in the client channel (or "no alerts" if
  everything is within thresholds)
- [ ] The canvas is created — the agent prints `Canvas created: F0XXXXXXXXX`
- [ ] Copy the canvas ID — you will need it for the automation

> **First run note**: Device delta metrics will show `n/a (canvas history
> pending)` because the D-7 snapshot does not exist yet. This is expected.
> After 7 daily runs, full device WoW comparison will be operational.

---

## Part 4 — Create the daily Cloud Agent automation (10 min)

**In Cursor chat**, type:

```
Create a daily Cloud Agent automation at 7:00 AM that runs
airship-kpi-monitor for client {Client name} using rolling 7-day windows.

Client name: {Client name}
Brand name: {Public brand name — e.g. "Burger King France", "Banque Populaire"}
Airship MCP server: {user-XX PROD}
Slack channel ID: {C0XXXXXXXX}
Slack canvas ID: {F0XXXXXXXXX}
Alert language: en

Follow SKILL.md (airship-kpi-monitor) to run the daily KPI check.
```

The agent will open the Automations editor with the prefilled draft.

**In the Automations editor, verify:**
- [ ] Schedule: `daily` (every day, 07:00)
- [ ] Execution mode: `Cloud` (not Local)
- [ ] Workspace: `thomasfaro/airship-kpi-monitor`
- [ ] MCPs listed: Airship client MCP + Slack MCP
- [ ] Model: **claude-sonnet — always pick the latest version available** in the dropdown (do NOT pin a specific version number, do NOT enable extended thinking / reasoning mode). When a new Sonnet version appears in the list, switch to it — no other change needed.
- [ ] Prompt contains the correct client config

Click **Save**.

---

## Part 5 — Validation run (2 min)

1. In the Automations editor, click **Run** (manual trigger) on the automation
   you just saved
2. Wait for the run to complete (~1–2 minutes)
3. Check:
   - [ ] Slack channel: message posted (or "no alerts today" if within range)
   - [ ] Slack canvas: row added to Devices History table, Last run updated

The automation is live. It will run every morning at 07:00 UTC.

---

## Part 6 — Adjusting thresholds for a client

To override a threshold for one client, add it to the automation prompt under
`Custom thresholds`:

```
Custom thresholds:
  push_sends_drop_pct: 40
  email_bounce_max: 3
```

Full list of available threshold keys: see `SKILL.md → Default thresholds`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 / 403` errors on Airship API | MCP credentials expired | Refresh OAuth token in Cursor MCP settings |
| No Slack message posted | Volume below minimums, or no anomaly | Check agent log — it prints `New alerts: 0` |
| Canvas not found | Wrong canvas ID in prompt | Re-run manual test to get correct ID |
| Device delta shows `n/a` | Less than 7 daily runs completed | Wait — fills automatically after 7 days |
| Automation didn't fire | Cloud Agents quota or workspace issue | Check [cursor.com/dashboard](https://cursor.com/dashboard?tab=cloud-agents) |

---

## Updating the skill / thresholds globally

All TAMs share the same skill from the GitHub repo. To update the logic or
default thresholds:

1. Edit `SKILL.md` in the repo
2. Commit and push to `main`
3. Cloud Agent automations pick up the new version on the next run
4. TAMs using local testing run `git pull` in
   `~/.cursor/skills/airship-kpi-monitor`
