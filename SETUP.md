# SETUP.md — Agent-guided installer for airship-kpi-monitor

> **For the agent.** This is an executable playbook, not a human checklist. When
> a user says something like *"guide me to install and setup this skill"* (often
> with the GitHub link), read this file and perform the steps below interactively
> — actually editing the user's local files for them. Ask for the values you
> need with the question tool; do not ask the user to hand-edit files unless they
> prefer to. The human, step-by-step reference is [MODOP.md](MODOP.md); this
> playbook automates the same outcome.

## What you will set up

- The skill itself, cloned to `~/.cursor/skills/airship-kpi-monitor`.
- One **Airship MCP server per client** in `~/.cursor/mcp.json` (holds the OAuth
  credentials — local only).
- The teammate's local **`clients.yml`** registry (non-secret routing).
- A **setup-tracker canvas** that visualises progress and the local file
  locations (no secrets).

## Hard rules (read before doing anything)

- **Credentials live only in `~/.cursor/mcp.json`.** Never write app keys, client
  IDs, or client secrets into the repo, into `clients.yml`, into the canvas, or
  into chat summaries. Never commit `mcp.json`.
- **Always back up `~/.cursor/mcp.json`** (timestamped copy) before editing it.
- **Never overwrite an existing `clients.yml`** — append/merge entries only.
- **Confirm before writing.** Show the user the exact entry you are about to add
  and get a yes before editing `mcp.json`.
- If anything fails (missing `uv`, MCP red, `401/403`), stop on that client,
  report it, and continue with the others — never abort the whole setup.

## Inputs to collect (per client)

Use the question tool to gather these. Collect them one client at a time.

| Field | Goes to | Notes |
|---|---|---|
| Client name | `clients.yml` `name` | shown in Slack/canvas headers |
| Brand name | `clients.yml` `brand_name` | public brand for web search; defaults to name |
| Airship region | `mcp.json` `AIRSHIP_REGION` + `clients.yml` `region` | `eu` or `us` |
| App key | `mcp.json` `AIRSHIP_APP_KEY` | **secret — mcp.json only** |
| OAuth client ID | `mcp.json` `AIRSHIP_CLIENT_ID` | **secret — mcp.json only** |
| OAuth client secret | `mcp.json` `AIRSHIP_CLIENT_SECRET` | **secret — mcp.json only** |
| Slack channel | `clients.yml` `slack_channel` | name without `#`, e.g. `cs-fr-client` |
| MCP server name | key in `mcp.json`; `clients.yml` `airship_mcp` (with `user-` prefix) | e.g. `CLIENT-A PROD` → `user-CLIENT-A PROD` |

The OAuth credentials and scopes (`rpt` + `tpl`) come from the client's Airship
project — see [MODOP.md](MODOP.md) §1.4 if the user needs to create them.

## Procedure

### Step 0 — Locate or install the skill

- If `~/.cursor/skills/airship-kpi-monitor/SKILL.md` exists, run `git -C
  ~/.cursor/skills/airship-kpi-monitor pull --ff-only` to update it.
- Otherwise clone it:
  ```bash
  git clone https://github.com/thomasfaro/airship-kpi-monitor \
    ~/.cursor/skills/airship-kpi-monitor
  ```
- Treat `~/.cursor/skills/airship-kpi-monitor` as the **skill directory** for the
  rest of this playbook.

### Step 1 — Check prerequisites

- Run `uv --version`. If missing, tell the user to `brew install uv` (or see
  docs.astral.sh/uv) and pause until installed.
- Confirm the Slack MCP plugin (`plugin-slack-slack`) is enabled in Cursor. If
  not, ask the user to enable it.
- Ask once for the **local `airship-mcp` package path** (the directory `uv run
  --directory <path> airship-mcp` launches). Store it as `airship_mcp_dir` for
  all clients this session.

### Step 2 — Create the local registry

- If `<skill dir>/clients.yml` is missing, create it (it is gitignored — never
  committed). Seed it with this routing-only template, then fill in clients in
  Step 5:
  ```yaml
  # Airship KPI Monitor — client registry (ROUTING ONLY — NO SECRETS).
  # Credentials live ONLY in ~/.cursor/mcp.json. This file just routes the skill
  # to an already-configured Airship MCP server and a Slack channel.
  slack_workspace: urbanairship   # subdomain in https://<workspace>.slack.com
  slack_team_id: T025Q1VP7        # team ID segment in the canvas URL path

  clients:
    # - name: Client A
    #   brand_name: Client A Brand Name
    #   airship_mcp: user-CLIENT-A PROD   # exact MCP server id in ~/.cursor/mcp.json
    #   slack_channel: cs-fr-client-a     # channel name without '#'
    #   slack_canvas_id:                  # leave blank on first run
    #   region: eu
    #   enabled: true
    #   # custom_thresholds:
    #   #   push_sends_drop_pct: 40
  ```
- If it already exists, keep it and append to it later (Step 5).

### Step 3 — Render the setup-tracker canvas

Build the tracker canvas now (see **Setup-tracker canvas** below) so the user can
watch progress. Update it after each subsequent step.

### Step 4 — Collect one client's inputs

Ask the user for the fields in **Inputs to collect** for the next client. If the
user would rather not type secrets in chat, offer to open `~/.cursor/mcp.json`
for them to paste the three credential values directly; still write the
non-secret routing yourself.

### Step 5 — Write the Airship MCP server entry

1. Back up `~/.cursor/mcp.json` to `~/.cursor/mcp.json.bak.<YYYYMMDD-HHMMSS>`
   (create `mcp.json` with `{"mcpServers": {}}` first if it does not exist).
2. Show the user the entry you will add, then merge it into `mcpServers`
   (preserve every other server, e.g. the Slack plugin):
   ```json
   "<MCP server name>": {
     "command": "uv",
     "args": ["run", "--directory", "<airship_mcp_dir>", "airship-mcp"],
     "env": {
       "AIRSHIP_APP_KEY": "<app_key>",
       "AIRSHIP_CLIENT_ID": "<client_id>",
       "AIRSHIP_CLIENT_SECRET": "<client_secret>",
       "AIRSHIP_REGION": "<eu|us>"
     }
   }
   ```
   This matches the shape produced by `scripts/generate_mcp_config.py` and
   documented in [MODOP.md](MODOP.md) §1.5.
3. Tell the user to reload MCP servers (**Settings → MCP → refresh**) or restart
   Cursor so the new server turns green.

> **Setting up many clients at once?** Instead of repeating Steps 4–5, point the
> user to the bulk generator: fill `clients.secrets.yml` (from
> `clients.secrets.example.yml`) and run
> `uv run --with pyyaml scripts/generate_mcp_config.py`. See [MODOP.md](MODOP.md)
> §1.6.

### Step 6 — Add the routing entry to `clients.yml`

Append a **non-secret** entry to `<skill dir>/clients.yml` (no credentials):

```yaml
  - name: <Client name>
    brand_name: <Brand name>
    airship_mcp: user-<MCP server name>
    slack_channel: <channel-name>
    slack_canvas_id:            # blank on first run
    region: <eu|us>
    enabled: true
```

### Step 7 — Smoke-test the connection

Call the new MCP server: `GET /api/reports/devices` via `call_airship_api`.

- Expect `status_code: 200` with a JSON body containing `counts.ios` /
  `counts.android`.
- On `401`/`403`: the OAuth client must have exactly `rpt` + `tpl` scopes — tell
  the user to fix the scopes (MODOP §1.4) and retry.
- On MCP red / not found: re-check the `uv` path and `airship_mcp_dir`.

Update the tracker canvas with this client's result, then loop back to Step 4 for
the next client (if any).

### Step 8 — Finish

- Print the two local file locations the user now owns:
  - `~/.cursor/mcp.json` (credentials — local only)
  - `~/.cursor/skills/airship-kpi-monitor/clients.yml` (routing registry)
- Offer a first run: `Run airship-kpi-monitor for <Client name>.`
- Remind the user that the **first run returns a canvas ID** — paste it into the
  client's `slack_canvas_id` in `clients.yml` so later runs reuse the same canvas.
- Point to **run modes** (one-off / subset / `/loop`) in
  [README.md](README.md) and [MODOP.md](MODOP.md) §2.3.

## Setup-tracker canvas

Render a single canvas to visualise the setup. **Before writing it**, read
`~/.cursor/skills-cursor/canvas/SKILL.md` and the SDK declarations in
`~/.cursor/skills-cursor/canvas/sdk/` for the exact components and theme tokens.

- **Location** (generated locally, per user — never committed):
  `~/.cursor/projects/<workspace>/canvases/airship-kpi-setup.canvas.tsx`.
- **Never render secrets.** App keys, client IDs, and client secrets must not
  appear anywhere in the canvas.

Content:

1. **Local file locations** panel — the two paths the user fills/owns:
   - `~/.cursor/mcp.json`
   - `~/.cursor/skills/airship-kpi-monitor/clients.yml`
2. **Steps checklist** with done / pending status:
   prerequisites · skill installed · clients.yml created · MCP configured ·
   routing entry added · smoke test passed · first run.
3. **Per-client status table** — columns: Client, MCP server (`user-…`), Region,
   Smoke test (pass/fail/pending). Names and IDs only, never secrets.

Re-render the canvas after each step so its status reflects reality. Omit any
section that has no data yet rather than showing empty placeholders.
