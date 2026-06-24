# MODOP — Airship KPI Monitor Setup Guide for TAMs

> **Audience**: Technical Account Managers setting up the daily KPI monitoring
> for a new client.  
> **Time**: ~15 minutes per client (after the one-time prerequisites).

> **Prefer a guided setup?** Let the Cursor agent do it for you: paste the
> agent-guided prompt from the [README](README.md#automated-setup-agent-guided),
> which runs the [SETUP.md](SETUP.md) playbook (it asks for your values, edits
> `~/.cursor/mcp.json`, creates `clients.yml`, and smoke-tests). This MODOP is
> the **manual reference / fallback** for doing the same steps by hand.

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

### 1.3 Client Airship MCP — overview

Each Airship client project needs **its own MCP server entry** in Cursor — one
OAuth client, one MCP block, one name used in chat commands.

Workflow per client:

1. Create OAuth credentials with scopes `rpt` + `tpl` (section 1.4)
2. Add the MCP server in Cursor (section 1.5)
3. Smoke-test the connection (section 1.5 Step 3)
4. Register the client in your local `clients.yml` (Part 2)

### 1.4 Create an Airship OAuth token (per client project)

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

### 1.5 Configure the client Airship MCP in Cursor

#### Prerequisites

- **`uv`** installed (`brew install uv` or see [docs.astral.sh/uv](https://docs.astral.sh/uv/))
- **Airship MCP package** available locally on the TAM machine (internal path
  to the `airship-mcp` project — ask your team lead if you do not have it yet)
- OAuth credentials from section 1.4 for the target client project

#### Step 1 — Choose a server name

Pick a short, unambiguous name for this client. It becomes the key in
`mcp.json` and the identifier you use in Cursor chat.

| Example client | Suggested MCP name | Identifier in chat |
|---|---|---|
| Client A | `CLIENT-A PROD` | `user-CLIENT-A PROD` |
| Client B | `CLIENT-B PROD` | `user-CLIENT-B PROD` |

**Naming rule**: Cursor prefixes user MCP servers with `user-`. If the entry
in `mcp.json` is `"CLIENT-A PROD"`, the server identifier in chat is
`user-CLIENT-A PROD`.

#### Step 2 — Add the MCP server

**Option A — Cursor UI (recommended)**

1. Open **Cursor → Settings → Cursor Settings → MCP**
2. Click **Add new global MCP server** (or **Edit in mcp.json**)
3. Add a block for the client (see JSON template below)
4. Save and wait for the MCP status indicator to turn **green**

**Option B — Edit `~/.cursor/mcp.json` directly**

Add one entry per client project inside `"mcpServers"`:

```json
"CLIENT-A PROD": {
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
| `"CLIENT-A PROD"` | Your chosen server name (Step 1 above) |
| `/path/to/airship-mcp` | Local path to the `airship-mcp` package on your machine |
| `<project_app_key>` | App key from the Airship project |
| `<oauth_client_id>` | OAuth Client ID (section 1.4) |
| `<oauth_client_secret>` | OAuth Client Secret (section 1.4) |
| `AIRSHIP_REGION` | `eu` for European projects, `us` for US projects |

> **Security**: `mcp.json` contains secrets — it lives only on your machine,
> never commit it to git. Do not share screenshots of this file.
>
> **Where credentials live**: OAuth credentials are stored **only** here, in
> `~/.cursor/mcp.json`. The shared `clients.yml` registry (Part 2) holds **no
> secrets** — it only routes the skill to an MCP server already configured in
> Cursor (by name) and to a Slack channel. This keeps credentials local and the
> registry safe to commit and share.

`AIRSHIP_RTDS_BEARER_TOKEN` is **not required** for KPI monitoring — omit it
unless you use RTDS features on the same MCP entry.

After saving, reload MCP servers (**Settings → MCP → refresh**) or restart
Cursor if the server stays red.

#### Step 3 — Smoke-test the connection

In Cursor chat, with the new MCP server enabled:

```
Using MCP server user-CLIENT-A PROD, call call_airship_api:
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

### 1.6 (Optional) Bulk-configure many clients with the generator

> **Skip this entire section** if you configured your MCP servers manually in
> 1.5 — it is a convenience for setting up **many** clients from scratch, not a
> requirement. It produces the same `mcp.json` entries as 1.5, just in bulk.

The repo ships an optional helper, `scripts/generate_mcp_config.py`, that writes
Airship MCP entries into `~/.cursor/mcp.json` from a local secrets file.

1. Copy the template (the copy is gitignored — it holds secrets):

   ```bash
   cp clients.secrets.example.yml clients.secrets.yml
   ```

2. Edit `clients.secrets.yml`:
   - Set `settings.airship_mcp_dir` to the local path of the `airship-mcp`
     package (same path used in 1.5).
   - Under `secrets:`, add one block per client keyed by the MCP server name
     **without** the `user-` prefix (e.g. `CLIENT-A PROD`), with the `app_key`,
     `client_id`, `client_secret` from section 1.4.

3. Preview, then apply:

   ```bash
   uv run --with pyyaml scripts/generate_mcp_config.py --dry-run   # preview
   uv run --with pyyaml scripts/generate_mcp_config.py             # write
   ```

   The script backs up `~/.cursor/mcp.json` before writing, preserves every
   server it did not create (e.g. the Slack plugin), and only touches the
   Airship entries listed in your secrets file. Use `--print` to dump the
   resulting entries with credentials redacted.

4. Reload MCP servers in Cursor (or restart) and smoke-test as in 1.5 Step 3.

> `clients.secrets.yml`, `mcp.json`, and `mcp.json.bak` are all gitignored —
> they never leave your machine.

---

## Part 2 — Register the client (once per client)

### 2.1 Gather client info

You need the following before running the skill for a client:

| Info | How to get it |
|---|---|
| **Airship MCP server name** | Name from section 1.5 — prefixed with `user-` (e.g. `user-CLIENT-A PROD`) |
| **Slack channel** | Channel name as shown in Slack, without `#` (e.g. `cs-fr-client`) — the skill resolves it to an ID at run time via the Slack MCP |
| **Slack canvas ID** | Leave blank on first run — the skill creates it and returns the ID |
| **Slack team ID** | Default `T025Q1VP7` (Airship CS workspace) — change only if the channel lives on a different Slack workspace |

Optional:
- **Custom thresholds**: any threshold from the default list you want to
  override for this client (e.g. `push_sends_drop_pct: 40`)

### 2.2 Add the client to your local `clients.yml`

`clients.yml` is your own **local, gitignored** registry — the repo never ships
or commits it. On first setup, create it yourself in the skill folder
(`~/.cursor/skills/airship-kpi-monitor/clients.yml`) with the template below.
It is a **non-secret** registry that lets you run the skill for several clients
from a single Cursor chat message. Each TAM maintains their own version
locally — **client data never goes to git**.

Create `clients.yml` with this structure and add one entry per client (no
credentials — those stay in `mcp.json`):

```yaml
# ROUTING ONLY — NO SECRETS. Credentials live in ~/.cursor/mcp.json.
slack_workspace: urbanairship   # subdomain in https://<workspace>.slack.com
slack_team_id: T025Q1VP7        # team ID segment in the canvas URL path

clients:
  - name: Client A
    brand_name: Client A Public Brand Name
    airship_mcp: user-CLIENT-A PROD      # the MCP server name from 1.5
    slack_channel: cs-fr-client-a        # channel name without '#'
    slack_canvas_id: F0XXXXXXXX          # leave blank on first run
    region: eu
    enabled: true
    # custom_thresholds:
    #   push_sends_drop_pct: 40
```

> `brand_name` is the **public-facing brand** used for web searches in root
> cause analysis — use the consumer name rather than the internal project code
> (e.g. the client's actual brand name, not their Airship project shorthand).
> Defaults to `name` if omitted.

Top-level `slack_workspace` / `slack_team_id` keys (already set in the template)
build the clickable canvas link — change them only if your Slack channels live on
a different workspace. After a first run, paste the returned canvas ID back into
the entry so later runs reuse the same canvas.

### 2.3 Run modes

Once MCPs are configured (1.5) and clients are registered (2.2), trigger runs
from Cursor chat with the relevant MCP servers enabled:

- **All clients**:
  `Run airship-kpi-monitor for all clients in clients.yml using rolling 7-day windows.`
- **A subset**:
  `Run airship-kpi-monitor for Client A and Client B.`
- **A single client**:
  `Run airship-kpi-monitor for Client A.`
- **Recurring in an open session** (via the `loop` skill):
  `/loop 1d Run airship-kpi-monitor for all clients in clients.yml` — runs
  immediately, then every 24h. Requires Cursor to stay open; uses your local
  MCP servers (no hosting needed).

---

## Part 3 — First run (5 min)

Before running regularly, validate the skill works for this client.

**In Cursor chat**, with the client's MCP server enabled:

```
Run airship-kpi-monitor for client {Client name}.
Brand name: {Client's public brand name}
Airship MCP server: {user-CLIENT-A PROD}
Slack channel: {cs-fr-client}

Follow SKILL.md (airship-kpi-monitor) to run the daily KPI check
using rolling 7-day windows.
```

Replace `{...}` with actual values. Press Enter and let the agent run.

**What to verify:**
- [ ] Agent completes without errors
- [ ] A Slack message appears in the client channel (or "no alerts" if
  everything is within thresholds)
- [ ] The canvas is created — the agent prints `Canvas ID: F0XXXXXXXXX`
- [ ] Copy the canvas ID and paste it into your local `clients.yml` entry

> **First run note**: Device delta metrics will show `n/a (canvas history
> pending)` because the D-7 snapshot does not exist yet. This is expected.
> After 7 daily runs, full device WoW comparison will be operational.

---

## Part 4 — Adjusting thresholds for a client

To override a threshold for one client, add it to `custom_thresholds` in your
local `clients.yml`:

```yaml
custom_thresholds:
  push_sends_drop_pct: 40
  email_bounce_max: 3
```

Full list of available threshold keys: see `SKILL.md → Default thresholds`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 / 403` errors on Airship API | Wrong OAuth scopes (need exactly `rpt` + `tpl`) or expired credentials | In Airship **Settings → OAuth**, enable only `rpt` and `tpl`; refresh Client ID/Secret in Cursor MCP settings |
| MCP server stays red | Wrong `uv` path or `airship-mcp` directory | Check `mcp.json` syntax; confirm `uv` and `airship-mcp` path are correct |
| No Slack message posted | Volume below minimums, or no anomaly | Check agent log — it prints `New alerts: 0` |
| Canvas link in alerts is broken | URL missing team ID in path | Build URL as `https://{workspace}.slack.com/docs/{team_id}/{canvas_id}` — see SKILL.md |
| Canvas not found | Wrong canvas ID in `clients.yml` | Re-run Part 3 to get the correct ID |
| Device delta shows `n/a` | Less than 7 daily runs completed | Expected — fills automatically after 7 days |

---

## Updating the skill / thresholds globally

All TAMs share the same skill from the GitHub repo. To update the logic or
default thresholds:

1. Edit `SKILL.md` in the repo
2. Commit and push
3. Each TAM runs `git pull` in `~/.cursor/skills/airship-kpi-monitor` to get
   the latest version
