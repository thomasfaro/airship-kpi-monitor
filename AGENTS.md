# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

`airship-kpi-monitor` is a **documentation-first Cursor Skill**, not a
conventional software project. It is packaged as a **workspace skill**: the skill
itself lives in the repo at `.cursor/skills/airship-kpi-monitor/`, so cloning and
opening the repo in Cursor makes it available with no `~/.cursor/skills` install.
A session-start hook (`.cursor/hooks.json` → `.cursor/hooks/update-skill.sh`)
runs `git pull --ff-only` to keep the skill current. The deliverable is a small
set of Markdown files plus a client registry:

- `.cursor/skills/airship-kpi-monitor/SKILL.md` — the core logic/playbook read by
  the Cursor agent at runtime.
- `SETUP.md` — agent-executable installer playbook (at repo root). When a user
  asks to "setup this skill", read it and perform the steps: the skill is already
  present in the workspace, so just collect each client's inputs via the question
  tool, edit `~/.cursor/mcp.json` (creds — backed up first), create the local
  `clients.yml`, and smoke-test. It
  also specs a **local-only, secret-free monitoring canvas**
 (`~/.cursor/projects/<workspace>/canvases/airship-kpi-monitor.canvas.tsx`, never
 committed). It tracks setup progress, then the skill rewrites it as a run
 dashboard (open alerts, last-run times, links to each Slack KPI canvas) on each
 run (SKILL.md Step 12). Credentials are never written to the repo, `clients.yml`,
 the canvas, or the HTML dashboard.
- `MODOP.md` — manual step-by-step setup guide for TAMs (fallback for SETUP.md).
- `README.md` — product overview.
- `.cursor/skills/airship-kpi-monitor/dashboard/` — a **local HTML dashboard**
  openable in any browser with no server (`index.html`). It has two views:
  **Monitor** and **Setup** (routing registry: per-project industry, editable when
  the local server runs). Monitor is a **hash-routed two-level** SPA: a **fleet
  list** (`#/`) where projects are **grouped by Slack channel** (clients sharing a
  channel appear in one collapsible card; the header shows combined client names +
  a clickable `#channel` link); each project row shows severity, badges, worst
 headroom, micro-sparkline, "Open details →"; and a **deep project page**
 (`#/project/<name>`) that centralizes **every monitored KPI on the project's
 active channels (healthy ones included, not just problems)** as per-channel KPI
 cards (current/previous over 30 days, delta vs the previous 30, iOS/Android split, mini-sparkline history,
 headroom gauge, status chip, a **one-line client-contextualized analysis**, and an
 **inline editable alert threshold** under each card's gauge — Set/Reset plus an
 Apply for any skill suggestion; KPIs under their min-volume floor show as `na`,
 unused channels are hidden), an alerts & timeline section, and a fallback "Other
 threshold suggestions" panel for suggestions with no KPI card that run.
  The **app** (`index.html`, `styles.css`, `app.js`, `dashboard-data.sample.js`,
 `thresholds-catalog.js`, `serve.py`, `serve.command`, `service.sh`) is
 **committed and data-free**; the real data is
  `dashboard-data.js` (each run, Step 13), a **local + gitignored** file the skill
  rewrites. Each project carries `metrics[]` (per-KPI depth incl. `threshold.headroom`
 and a bounded `series`), `thresholdSuggestions[]` (skill-computed tuning hints),
 and — on email projects with SparkPost enabled — `deliverability`, the
 per-mailbox-provider drill-down (skill-authored `findings[]` first, then provider
 rates, then the verbatim MTA delay/bounce reason strings). That block is the
 **division of labour between the two surfaces**: the Slack canvas answers "is
 email healthy?" in one clause for the client, the dashboard answers "what exactly
 is wrong and what do we do?" for the TAM. Its rates are computed on injections
 where Airship counts sends, so they deliberately do NOT tie out with the email
 KPIs on the same page — never reconcile them. The deep page degrades gracefully
 when a snapshot predates any of these fields. Browsers
  can't `fetch()` over `file://`, so data is loaded as a `<script>` that sets
  `window.AIRSHIP_KPI_DATA`. No secrets ever live here.
- `.cursor/skills/airship-kpi-monitor/clients.yml` — **non-secret** client
  registry. It is **local + gitignored**: the repo never ships or commits it. Each
  TAM creates their own (template lives in `MODOP.md` §2.2 / `SETUP.md`) and fills
  in their own clients. No real client data is ever committed.

The only executable code is **one optional helper**:
`.cursor/skills/airship-kpi-monitor/scripts/generate_mcp_config.py`. It is a
convenience for bulk-creating Airship MCP entries in `~/.cursor/mcp.json` from a
gitignored `clients.secrets.yml` (template: `clients.secrets.example.yml`,
alongside the script). It is **not** required to run the skill — teammates who
configure their MCP servers manually in Cursor ignore it. There is otherwise no
package manager, lockfile, or build/test/lint tooling.

### How the "application" runs

The "application" is `SKILL.md` executed by a **Cursor agent** (model: latest
Claude Sonnet) triggered from Cursor chat — one-off or recurring via `/loop`.
The intended cadence is **weekly**: the analysis window is 30 days, so two runs a
day apart share 29 of those days and the confirmation gate (which counts *runs*)
would be spending its steps on non-independent evidence. Each run:

1. Reads `SKILL.md` (and the TAM's local `clients.yml` for multi-client runs).
2. Calls the **Airship Reports API** via an **Airship MCP server** (`call_airship_api`).
3. Computes rolling **30-day-window** deltas (last 30 complete days vs the 30
   before) and evaluates thresholds, then runs the
   **confirmation gate** (Step 8a): a breach is a *candidate* until it persists
   `alert_confirm_runs` runs (hysteresis on resolve; cadence-aware zero-send
   suppression).
4. Tracks candidates / confirmed / recently-resolved in the **local dashboard**
   (Step 13) and maintains a **short Slack canvas** (`slack_create_canvas` /
   `slack_update_canvas`): key metrics as one scannable table per section, with
   per-OS detail and vertical benchmarks, over that **same** 30-day window,
   an email block with a 0–100 SparkPost-based sender score on email
   projects, and confirmed critical alerts.
   Slack messages via `slack_send_message` are now **rare**:
   only a throttled **critical escalation** (Step 10 — confirmed + critical +
   sustained) and a light **weekly recap** (Step 10b). Daily new-alert/resolution
   posts are retired.

The local `dashboard-data.js` is the confirmation-gate memory — each run reads
prior streaks from it (and canvas footer markers / any TAM mute on a shown
critical row) and writes today's snapshot + streaks back. The Slack canvas is
the client-facing snapshot, not the database.

To "run in development": follow the manual-test prompt in `MODOP.md` Part 3 (or
the multi-client / `/loop` modes in `MODOP.md` §2.2), referencing a client's
Airship MCP server name and a Slack channel name.

### Config split — credentials vs routing (important)

- **Credentials live ONLY in `~/.cursor/mcp.json`** (per-client OAuth, region).
  They are never stored in the repo.
- **`clients.yml` is routing only** (MCP server name, Slack channel, canvas ID,
  region, `time_zone`, `industry`) and is **local + gitignored** — created by each
  TAM, never
  committed. Several entries may share one Slack channel (multiple projects per
  client), each keeping its own canvas ID. Real client data is never committed;
  the repo ships no client registry.
- `scripts/generate_mcp_config.py` + `clients.secrets.yml` are the optional bulk
  path to populate `mcp.json`; `clients.yml`, `clients.secrets.yml`, `mcp.json`,
  and `mcp.json.bak` are all gitignored.

### Required external integrations (NOT installable from this repo)

Running the skill end-to-end requires two MCP servers configured in Cursor /
Cursor agents — neither can be provisioned from this VM via shell:

- **Airship MCP** (one entry per client). Backed by the internal `airship-mcp`
  Python package launched with `uv run` (the package is internal — obtain from
  the team). Requires per-client OAuth secrets with scopes exactly `rpt` + `tpl`:
  `AIRSHIP_APP_KEY`, `AIRSHIP_CLIENT_ID`, `AIRSHIP_CLIENT_SECRET`, `AIRSHIP_REGION`
  (`us` or `eu`). See `MODOP.md` §1.5 (or §1.6 for the optional bulk generator).
- **Slack MCP** (`plugin-slack-slack`) — must be authenticated/enabled in Cursor.

**Optional, email projects only** — two independent enrichments, both fail-open,
both keyed off the sending domain the skill auto-detects from an email campaign
payload (`sender_address`). Without either, the canvas still shows the skill's
own computed sender score.

- **SparkPost Metrics API** (`scripts/sparkpost_deliverability.py`, MODOP §1.8,
  SKILL Step 3e) — per-mailbox-provider deliverability plus the *reasons* behind
  delays and bounces, which Airship's Reports API does not expose. Needs **one
  read-only key** (`Metrics: Read`) for Airship's whole SparkPost account:
  `clients.yml` `sparkpost_key_path` + `email.sparkpost: true`, nothing asked of
  the client. Because that key sees every client, the script **refuses to run
  without `--sending-domain`**. Two SparkPost features are out of reach: the
  **Health Score** has no public API (it reaches TAMs as a Slack alert configured
  in the SparkPost app), and inbox/spam **placement** needs the paid
  Deliverability Add-On.
- **Google Postmaster Tools** for real Gmail domain reputation
  (`scripts/postmaster_reputation.py`, MODOP §1.7). Needs a GCP service-account
  key (path in `clients.yml` `postmaster_key_path`, key kept outside the repo)
  plus, per client, the *client* verifying their sending domain and granting that
  service account read access. Gmail traffic only, 2-3 day lag.

IP-based scores (Validity Sender Score, Microsoft SNDS) are deliberately **not**
used — Airship sends via SparkPost shared IP pools, so they grade the shared
infrastructure rather than the client. The sending **domain** is the only
client-specific axis, which is why both integrations key off it.

### Non-obvious gotchas

- The Slack MCP `slack_send_message` call requires the `message` parameter (NOT
  `text`); using `text` silently returns `no_text` and posts nothing. See
  `SKILL.md` Step 10.
- Canvas links must use `https://{workspace}.slack.com/docs/{team_id}/{canvas_id}`
  (team ID in the path) — `https://app.slack.com/docs/{canvas_id}` breaks.
- Run the generator via `uv run --with pyyaml scripts/generate_mcp_config.py`
  (inline PyYAML dep; supports `--dry-run` and `--print`). It backs up
  `mcp.json` and preserves servers it did not create.
- The Reports API always returns **UTC**. `clients.yml` `time_zone` (IANA, e.g.
  `Europe/Paris`) does not change what is fetched — it only sets the local-day
  boundary (Step 0) and how hourly delay peaks / campaign times are labelled and
  interpreted in local time (Step 3c / 8b). Defaults to UTC.
- First run may show device evolution as `n/a` if only one dated
  `/api/reports/devices` call succeeded; the snapshot still shows. Confirmation
  streaks start empty until a later run.
- Smoke-test an Airship MCP connection with: `Using MCP server user-XX PROD,
  call call_airship_api: GET /api/reports/opens` (expect `status_code: 200`).
  Prefer `opens` over `devices` — `devices` can `404` on email-only projects
  (no mobile device base), a false negative.
- The skill is a **workspace skill** under `.cursor/skills/airship-kpi-monitor/`;
  edits to `SKILL.md` there are versioned with the repo. The `.cursor/hooks/`
  auto-update hook (`git pull --ff-only` on session start) is fail-open and never
  touches the gitignored `clients.yml`.
- The dashboard server started by `.cursor/hooks/start-dashboard.sh` is a child of
  the Cursor session and **dies with it** — that hook is convenience, not uptime.
  `dashboard/service.sh install` registers a `launchd` user agent
  (`com.airship.kpi-monitor.dashboard`) with `RunAtLoad` + `KeepAlive` instead; the
  hook then no-ops because the port is already bound. **Gotcha:** launchd opens
  `StandardOutPath`/`StandardErrorPath` and `chdir`s to `WorkingDirectory` *before*
  exec, as a process with no TCC grants — pointing either at a protected folder
  (`~/Documents`, `~/Desktop`, iCloud Drive) makes the job fail with
  `EX_CONFIG` (78) and log **nothing**. Hence the log lives in `~/Library/Logs/`
  and the working directory is `$HOME`, never the repo.
- The HTML dashboard app is committed but its data file
  (`dashboard/dashboard-data.js`) is gitignored — a run writes **only** that data
  file (Step 13), never the committed app. It is fail-open (skips on missing folder
  / write error) and shares
  the canvas's Slack **deep links** (`slack://file?team=…&id=…` for canvases,
  `…/app_redirect?channel=…` for channels) so clicks open the Slack app instead of
  spawning browser redirect tabs.
- **SparkPost is now the alerting source for email — and the unit is the sending
  domain, not the project.** This reversed the earlier "SparkPost is
  diagnostic-only" rule on 2026-09-01, for two reasons that both held up under
  measurement: `/api/reports/events` cost ~335 s per 30-day range call against
  ~1.6 s for the equivalent SparkPost pull, and the account-wide Airship figure
  was hiding per-domain collapses. Volumes reconcile well enough to trust
  (Client Alpha matches Airship exactly; Client Charlie and Client Delta within 0.1 %; Client Bravo
  runs ~8 % under, an accepted, documented tolerance — do **not** try to
  reconcile the two to zero, they count at different stages).
  Consequences to respect:
  - **Never average rates across a client's domains.** Recombine them from raw
    counts. Client Echo sends 10.1 M on one domain and 394 k on another with a
    very different profile; a mean would erase the smaller one.
  - Each declared domain in `clients.yml` `email.sending_domains` gets its own
    KPI card, its own threshold evaluation and its own streak state. A domain
    configured but idle in the window is `na`, never `ok`.
  - `email_sends` still comes from Airship `/api/reports/sends`; every rate comes
    from SparkPost. They sit on the same card with different sources by design.
- **`delay_rate` was redefined — the old number was not a percentage.** It used
  to be `count_delayed / delivered`, where `count_delayed` counts delay *events*:
  one message retried five times scored five, so the ratio routinely passed 100 %
  (Client Charlie measured 485 %) and was meaningless against a ceiling. It is now
  `count_delayed_first / injected` — the share of messages deferred on their
  first attempt, bounded by 100 % — and the ceiling was re-based from 10 to 20
  with it. The retry-pressure figure survives as `delay_retries_per_delivered`,
  diagnostic only.
- **The sender score grades acceptance; inbox placement needs its own flag.**
  The score answers "did the receiver take the mail", which is not "did the mail
  reach the inbox". Client Alpha is the case that proves the gap: **100/100** on the
  2026-09-01 run, delivery 99.7%, open rate down **21.8 points**, sending IP
  suspended for 6.25M messages — accepted everywhere, seen nowhere. So every
  domain and project also carries a **placement risk** (`none`/`watch`/`high`,
  worst domain wins), raised by an open-rate fall with delivery unchanged
  (≥ 10 pts high, ≥ 5 pts watch), a suspended IP, complaints over 0.1%, or block
  bounces past their ceiling. Do **not** fold these into the score: its
  definition stays narrow and auditable, and the ambiguity stays visible.
- **A deferral rate without its cause mix is unreadable.** Every
  `delayReasons[]` row is bucketed into `deferralClasses[]` — `ip_suspended`,
  `reputation_spam`, `reputation_volume`, `throttle_session`, `mailbox_full`,
  `mailbox_inactive`, `dns_unreachable`, `service_refused` — because the same
  headline rate demands opposite responses. In the 2026-09-01 run Client Alpha's deferrals
  were 82% `ip_suspended` (infrastructure) while Client Bravo's were 65%
  `mailbox_full` (list ageing). Match the buckets in the documented order, the
  strings overlap. And **gate reputation findings on ≥ 1,000 messages and ≥ 5%
  of the domain's deferrals** — otherwise `mail.client-foxtrot.example` raises
  a danger-level alarm off 63 messages.
- **CTOR is guarded on its change, not on a floor.** `email_ctor_min` was
  replaced by `email_ctor_drop_pct` (30%) after the fleet measurement of
  2026-09-01: CTOR separates transactional mail (8–62%) from marketing broadcast
  (0.2–2.4%), so any absolute floor fires on every marketing domain at once and
  discriminates nothing. Apple MPP pre-opens messages, inflating the denominator,
  which is also why published CTOR benchmarks do not transfer here.
- **`min_email_sends` is per sending domain, and it withholds the score too.**
  A domain under the 2,000-message floor emits `na` rates, **no** sender score
  and no findings — on 100 messages one recipient moves every rate by a point,
  and a 100/100 there would read as a fact rather than an artefact. Harmonie
  Mutuelle's low-volume domain is the case that forced it (a spurious CTOR
  breach). Surfaces must say *why* the cell is empty: the canvas prints "under
  the 2,000-message floor — reported, not judged" rather than leaving a blank
  that reads as "nothing to report".
- **Rounding is a measurement claim — scale the decimals to the magnitude.** The
  dashboard rounded every rate to one decimal, which broke the email cards in both
  directions: a 0.083% block-bounce headroom printed as `0.1` beside a `0.1`
  threshold, so a healthy margin read as an exhausted one, and 99.973% delivery
  printed as `100%`, claiming a perfection it had not reached and hiding 27
  failures per 100,000. The data was right in every case; only the display lied.
  `fmtPrec()` now scales precision to the value (3 decimals under 1, 2 under 10,
  1 above) and treats **100 as a boundary like 0** — a rate that would round *onto*
  the ceiling gains a decimal instead. Per-domain table cells keep the decimals
  they ask for rather than being trimmed, so a column of delivery rates does not
  mix `98%` with `99.97%` as if they were measured differently. Only an exact
  zero collapses to `0%`, and rounding may never manufacture a whole number out
  of a measured one — a 29.983% open rate gains a decimal rather than printing
  `30%` and contradicting the analysis text beside it.
- **`status` has two spellings too — and a green fallback made it dangerous.** A
  run writes `status: "breach"` on a metric; the dashboard's vocabulary is
  `ok`/`candidate`/`confirmed`/`na`, and `MSTATUS[s] || MSTATUS.ok` turned every
  word it did not recognise into a green **OK**. 22 breaching metrics advertised
  themselves as healthy, Client Alpha's email open rate among them: `headroom −17.8`, chip
  "OK". Unknown statuses now resolve to *alerting*, never to healthy — a status we
  cannot read is not evidence of health. This is the third instance of the same
  class of bug (see `unit` above): a lookup with a benign default hides the
  mismatch instead of surfacing it.
- **The fleet list and the project banner show confirmed alerts only.** Both read
 from `alertingMetrics()`, which drops anything the confirmation gate (Step 8a)
 has not accepted. Listing candidates there undid the gate on screen: 21
 "Watching" cards were rendering as rows under a heading that reads as critical,
 and the row severity came from a separate path (`projAlerts()`) that saw the
 snapshot's own `muted` flag but not the TAM's `clients.yml` mutes — so a project
 could be painted red while displaying no alert. Candidates keep their own card
 status and the separate "N watching" count. Expect the displayed total to be
 **lower than the raw `alertsList` count**: several per-OS alerts collapse onto
 one card (Client Alpha's four `direct_response_*` alerts are one "Click rate" row). The
 invariant to test is that the banner lists exactly the cards whose chip says
 *Alert* — not that it matches `alertsList.length`.
- **Turning a guard off and accepting one occurrence are different acts.**
  `muted_alerts` disables the guard on a client until someone re-enables it;
  `dismissed_alerts` accepts the alert in front of you and pins `opened` to its
  `openedAt`, so a later re-opening is raised again with no cleanup. Offering only
 the first is how a real incident ends up silenced months later by a mute added
 to clear a one-off. Neither is a resolution: dismissed alerts never go to the
 resolved log. And a muted KPI is a **setting, not a state** — it must not appear
 as a status chip, a severity, or a dot on the fleet list. The two also *look*
 different: a dismissed card returns to **OK**, only a muted one stays dimmed.
 Sharing the grey `muted` style made "handled" read as "disabled" — the trace of
 the dismissal is the Undismiss button and the cause line, not the greying.
- **`unit` has two spellings, and the mismatch fails silently.** A run writes
  `unit: "pct"` on each metric while `thresholds-catalog.js` spells the same unit
  `"%"`. `fmtVal()` only knew `"%"`, so every `pct` metric fell through to the
  *count* formatter: the whole email family (70 metrics across the fleet) printed
  99.726% as a bare `100` and 0.303% as `0`, with no `%` sign. Nothing threw —
  the wrong branch is a valid branch. The gauge caption looked right only because
  it reads its unit from the catalog instead of the metric. Read units through
  `normUnit()` and never compare `m.unit` to a literal.
- **CTOR needs an injection gate, not just a denominator.** Opens and clicks keep
  arriving for mail sent *before* the window, so a domain that injected **zero**
  still returns a denominator and yields a rate out of nothing:
  `radio.client-echo.example` produced a 4.09% CTOR from 465 opens and 19 clicks on
  0 sends. Since `email_ctor` carries a drop guard, that phantom rate can fire an
  alert on a silent domain. Emit `ctor` **and** `unsubscribes` as `na` whenever
  injections are 0 or under `min_email_sends`. Note the asymmetry with the other
  rates, which divide by an in-window denominator and therefore gate themselves.
- **Say when a drop is a stop.** Before narrating any volume fall, scan the daily
  series for a level shift: median before vs median of everything after, at every
  split leaving ≥ 10 days each side. Report only if the median falls > 60% **and**
  the post-split peak is < 50% of the pre-split peak. Both tests are load-bearing
  — Client Bravo alternates ~3.5M and ~200K send days, so a change in the *mix*
  moves the median while nothing stopped, and only the peak test rejects it. On
  2026-09-01 it fired on exactly two projects: Client Alpha (−81%, the day after the World
  Cup final) and Client Charlie. Without it Client Alpha's canvas opened on a collapse that
  was a sports calendar ending on schedule.
- **A shared IP is diagnosed by its co-tenants, never by its pool name.** Pool
  naming (`shared`, `<client>_mkt`, `<client>_tx`) is a convention that misleads
  twice over: `client-bravo_mkt` carries two markets of one brand and is
  effectively dedicated, while 90 % of Client Delta's volume runs over IPs belonging to no
  named pool at all. `--with-ips` settles it empirically by asking which other
  sending domains each IP served in the window. **Do not assume shared means
  worse** — Client Delta is the counter-example that matters: its two shared IPs deliver
  at ~97 % while its own dedicated IP delivers at 35.8 %, which is what drags the
  domain to 91.3 %. The aggregate hid both facts.
- **`/api/reports/events` is no longer called at all.** The two families that
  still read it were retired on 2026-09-01: the email rates moved to SparkPost
  (above) and `sms_delivery_rate` was dropped outright — like custom events, it
  measured carrier behaviour the TAM could not act on, and it was the last
  consumer of the endpoint. Its keys (`sms_delivery_rate_min`,
  `sms_delivery_rate_drop_pts`, `min_sms_dispatched`) are gone from the catalog;
  SMS keeps `sms_sends` only. The cost note below is kept because it is the
  reason for both decisions, and because anyone tempted to reintroduce the
  endpoint needs to know what it costs.
- **`/api/reports/events` was the run's cost centre — budget for it explicitly
  if you ever bring it back.**
  Measured across this 18-project fleet: every other Reports endpoint answers a
  60-day daily range in **4–6 s**, while `events` takes **~4 s for a single day**
  and **~335 s for a 30-day range** (timeout plus retries once two are in
  flight). It has no event-name filter and pages at 100 rows, so cost scales
  with the project's total event volume, not with the handful of names actually
  wanted. Consequences: never issue two `events` range calls concurrently for
  the same project, keep global client concurrency at 2, and treat the Step 3b
  per-day loop (30 calls/client) as the single biggest lever on wall-clock time.
  That cost is what retired the endpoint: SparkPost answers the same email
  questions in ~1.6 s, with a per-domain and per-IP split Airship never offered.
- **A family that could not be measured is `na`, and its open alerts freeze.**
  Whenever a source is unavailable — a skipped fetch, a dead integration, a
  domain with no traffic — emit the metric as `na` rather than carrying the last
  value forward, and leave any alert already open on it **frozen, never
  resolved**: a measurement that was not taken is not evidence of recovery.
- **A delta needs a baseline — check the previous window is populated.** Airship
  returns `404 No optin data found` for dates before a project's history starts,
  and empty (not absent) series elsewhere. Client Golf is the worked
  example: no opt-in/opt-out rows and no device snapshot before 2026-08-17, so
  every 30-day comparison was measured against a fabricated zero, producing a
  spurious "net opt-ins turned negative" on both platforms. Gate relative guards
  on the **previous** window clearing its `min_*` floor, and mark the metric
  `na` with a note rather than reporting a delta against nothing.
- **Cross-OS divergence indicts one platform, not both.** The
  `app_opens_cross_os_gap_pts` guard must fire only on the OS that diverged
  (the worse delta); firing both keys flags a healthy platform and produces an
  alert no TAM can action. Likewise a relative guard breaches at **`headroom
  <= 0`**, not `< 0` — a channel that stopped dead is exactly −100 % against a
  100 % drop threshold and would otherwise read as healthy.
- **Client custom events are not monitored — do not re-add them.** The whole
  `custom_event_*` family (rise / drop / new / vanished, plus
  `min_custom_event_count`) was removed: event names are campaign identifiers, so
  they appear and vanish with each campaign and their volume swings for reasons
  that say nothing about platform health. Client Hotel's standing mute was exactly
  that argument, and it was the general case rather than one client's quirk.
  Consequence: there is no longer a `custom` group in
  `dashboard/thresholds-catalog.js` or in the dashboard's channel list, and a
  leftover `custom_event_*` entry in a `clients.yml` `muted_alerts` list now
  matches nothing and can be deleted. Dropping this family also removed one of
  the three reasons to call `/api/reports/events`; the email rates moved to
  SparkPost and `sms_delivery_rate` was dropped, which retired the endpoint
  outright (see below).
- **False-positive gate (Step 8a).** A threshold breach must persist
  `alert_confirm_runs` consecutive runs to *confirm* (candidates live only in the
  dashboard); confirmed alerts need `alert_resolve_runs` clean runs to resolve
  (hysteresis); zero-send windows on non-daily channels are suppressed. Streak
  state persists in local `dashboard-data.js` (`alertsList` / `candidatesList`
  streak fields), read at the start of the next run. Since the move to a 30-day
  window the gate is the **second** line of defence, not the first — the window
  itself removes most of the noise it used to catch. It only counts *runs*, so it
  only means anything at the weekly cadence; on daily runs consecutive
  measurements overlap by 29/30 and the gate confirms nearly everything it sees.
- **30-day window, with deliberate exceptions.** Volume/trend comparisons run on
  30 days vs the previous 30. The email **fast incident checks** — spam complaint
  rate, delay rate, deliverability floor, bounce ceiling — do **not**: they are
  evaluated on the per-day / per-hour rows inside the window and fire on the most
  recent `incident_days_consecutive` days, so a live incident is not diluted into
  a monthly average. Two consequences to keep in mind: a KPI card can look healthy
  (30-day figure) while its alert is active (recent days), and these keys resolve
  on the *tail* of the window — an earlier "any breaching day in the window" rule
  would have pinned an alert open for a month.
- **The 7d→30d migration changed threshold semantics, not just numbers.** Values
  in `clients.yml` `custom_thresholds` keep their old meaning against a longer
  window. Percentage-drop keys were roughly halved (a 30-day sum carries about
  half the relative noise of a 7-day one); the **device-evolution** keys were
  *raised* instead, because they measure drift **across** the window and a longer
  window reaches the same percentage more easily — unchanged, they would have
  fired more. `min_*` floors were scaled ~4×. The one key whose unit changed was
  renamed (`push_pressure_per_user_max` → `push_pressure_per_user_max_30d`) so
  stale weekly overrides fall back to the new default rather than silently
  becoming ~4× stricter.
- **Slack is quiet by design.** Daily new-alert/resolution posts are retired.
  Slack only receives a throttled **critical escalation** (Step 10 — confirmed +
  critical + sustained, ≥14-day throttle stored as `lastEscalated` on the dashboard
  item — raised from 7 days because at a weekly cadence a 7-day throttle allowed an
  escalation on every single run; mirrored as a `· escalated {date}` Status suffix
  on the canvas row if that
  critical is showing) and a light **weekly recap** (Step 10b — top one-shot + unicast campaigns
  with hosted-image previews; throttled via a
  `_Recap posted:_` canvas footer marker). Everything else is in the dashboard.
- Changing default thresholds globally = edit
  `.cursor/skills/airship-kpi-monitor/SKILL.md`, commit, push; teammates pick up
  the new version on their next pull (the hook pulls automatically), applied on
  their next run.
