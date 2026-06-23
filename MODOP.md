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

### 1.4 Client Airship MCP — overview

Each Airship client project needs **its own MCP server entry** in Cursor — one
OAuth client, one MCP block, one name used in automations.

Workflow per client:

1. Create OAuth credentials with scopes `rpt` + `tpl` (section 1.5)
2. Add the MCP server in Cursor (section 1.6)
3. Smoke-test the connection (section 1.6)
4. Use the MCP server name in the automation prompt (Part 4), e.g.
   `Airship MCP server: user-M6 PROD`

### 1.5 Create an Airship OAuth token (per client project)

In the client's Airship project dashboard:

1. Go to **Settings → OAuth** (or **Project → Settings → OAuth**)
2. Click **Create OAuth Client** (or equivalent)
3. Give it a clear name, e.g. `Cursor KPI Monitor`
4. Under **Scopes**, enable **only** these two scopes — nothing else:
   - **`rpt`** — Reports (all KPI endpoints: sends, opens, optins, optouts,
     responses, devices, timeinapp, events, responses/list)
   - **`tpl`** — Content

   Do **not** add other scopes (`psh`, `chn`, `evt`, `nu`, etc.). They are
   not needed for KPI monitoring and widen access unnecessarily. A client
   scoped only to `psh` (Push) will **not** work — Reports requires `rpt`.
5. Save the client and copy:
   - **App Key** (project app key)
   - **Client ID**
   - **Client Secret**
6. Note the project **region** (`us` or `eu`) — it determines the API base URL

Use these values when adding the client's Airship MCP in Cursor:

| MCP env var | Value |
|---|---|
| `AIRSHIP_APP_KEY` | Project app key |
| `AIRSHIP_CLIENT_ID` | OAuth client ID |
| `AIRSHIP_CLIENT_SECRET` | OAuth client secret |
| `AIRSHIP_REGION` | `us` or `eu` |

> **Scope check**: the OAuth client must have **exactly** `rpt` + `tpl` — no
> more, no less. If API calls return `401` or `403`, verify only these two
> scopes are enabled.

### 1.6 Configure the client Airship MCP in Cursor

#### Prerequisites

- **`uv`** installed (`brew install uv` or see [docs.astral.sh/uv](https://docs.astral.sh/uv/))
- **Airship MCP package** available locally on the TAM machine (internal path
  to the `airship-mcp` project — ask your team lead if you do not have it yet)
- OAuth credentials from section 1.5 for the target client project

#### Step 1 — Choose a server name

Pick a short, unambiguous name for this client. It becomes the key in
`mcp.json` and the name you reference in automations.

| Client | Suggested MCP name | Value in automation prompt |
|---|---|---|
| M6 | `M6 PROD` | `user-M6 PROD` |
| Harmonie Mutuelle | `HM PROD` | `user-HM PROD` |
| Burger King France | `BK PROD` | `user-BK PROD` |

**Naming rule**: Cursor prefixes user MCP servers with `user-`. If the entry
in `mcp.json` is `"M6 PROD"`, the server identifier in chat and automations
is `user-M6 PROD`.

#### Step 2 — Add the MCP server

**Option A — Cursor UI (recommended)**

1. Open **Cursor → Settings → Cursor Settings → MCP**
2. Click **Add new global MCP server** (or **Edit in mcp.json**)
3. Add a block for the client (see JSON template below)
4. Save and wait for the MCP status indicator to turn **green**

**Option B — Edit `~/.cursor/mcp.json` directly**

Add one entry per client project inside `"mcpServers"`:

```json
"M6 PROD": {
  "command": "uv",
  "args": [
    "run",
    "--directory",
    "/path/to/airship-mcp",
    "airship-mcp"
  ],
  "env": {
    "AIRSHIP_APP_KEY": "<project_app_key>",
    "AIRSHIP_CLIENT_ID": "<oauth_client_id>",
    "AIRSHIP_CLIENT_SECRET": "<oauth_client_secret>",
    "AIRSHIP_REGION": "eu"
  }
}
```

Replace:

| Placeholder | Value |
|---|---|
| `"M6 PROD"` | Your chosen server name (section 1.6 Step 1) |
| `/path/to/airship-mcp` | Local path to the `airship-mcp` package on your machine |
| `<project_app_key>` | App key from the Airship project |
| `<oauth_client_id>` | OAuth Client ID (section 1.5) |
| `<oauth_client_secret>` | OAuth Client Secret (section 1.5) |
| `AIRSHIP_REGION` | `eu` for European projects, `us` for US projects |

> **Security**: `mcp.json` contains secrets — it lives only on your machine,
> never commit it to git. Do not share screenshots of this file.

`AIRSHIP_RTDS_BEARER_TOKEN` is **not required** for KPI monitoring — omit it
unless you use RTDS features on the same MCP entry.

After saving, reload MCP servers (**Settings → MCP → refresh**) or restart
Cursor if the server stays red.

#### Step 3 — Smoke-test the connection

In Cursor chat, with the new MCP server enabled:

```
Using MCP server user-M6 PROD, call call_airship_api:
GET /api/reports/devices
```

**Expected**: `status: success`, `status_code: 200`, a JSON body with
`counts.ios`, `counts.android`, etc.

**If it fails**:

| Error | Fix |
|---|---|
| MCP server red / not found | Check `mcp.json` syntax, `uv` path, and `airship-mcp` directory |
| `401` / `403` | OAuth client must have exactly `rpt` + `tpl` (Reports + Content only) |
| Wrong region | Set `AIRSHIP_REGION` to `eu` or `us` to match the project |

#### Step 4 — Enable for Cloud Agents (required for daily automations)

Local MCP configuration is not enough for scheduled Cloud Agent runs.

1. Go to [cursor.com/dashboard](https://cursor.com/dashboard?tab=cloud-agents)
2. Open the **airship-kpi-monitor** workspace
3. Under **Available MCPs**, confirm the client server appears (e.g.
   `user-M6 PROD`) alongside `plugin-slack-slack`
4. If missing, ensure the MCP is defined in your Cursor user settings and
   Cloud Agents has access to your MCP profile

The automation prompt must reference the exact server identifier:
`Airship MCP server: user-M6 PROD` (match the name from Step 1).

---

## Part 2 — Gather client info (once per client)

You need three pieces of information before setting up the automation:

| Info | How to get it |
|---|---|
| **Airship MCP server name** | Name from section 1.6 — Cursor MCP list, prefixed with `user-` (e.g. `user-HM PROD`) |
| **Slack channel ID** | Right-click the channel in Slack → **Copy link** → the ID is the last segment of the URL, starting with `C` (e.g. `C0YYYYYYYY`) |
| **Slack canvas ID** | Leave blank — the skill creates it on the first run and returns the ID |

Optional:
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
| `401 / 403` errors on Airship API | Wrong OAuth scopes (need exactly `rpt` + `tpl`) or expired credentials | In Airship **Settings → OAuth**, enable only `rpt` and `tpl`; refresh Client ID/Secret in Cursor MCP settings |
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
