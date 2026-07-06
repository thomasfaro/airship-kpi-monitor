/*
 * SAMPLE DATA — committed, fake, safe to share. Documents the schema the skill
 * writes to the LOCAL, gitignored `dashboard-data.js` at the end of each run
 * (see SKILL.md Step 13). This file lets the dashboard render before the first
 * run. When `dashboard-data.js` exists it overrides this sample.
 *
 * NEVER put secrets here (app keys, client IDs, client secrets). Routing-only:
 * project names, Slack channels, and canvas IDs (all from clients.yml).
 *
 * Severity values: "danger" (critical) | "warning" (watch) | "info".
 *
 * `alertsList` (optional, per project) documents each open alert and powers the
 * per-alert Mute / Unmute buttons. A `muted: true` entry is a declared false
 * positive: it stays visible (flagged "Muted") but is excluded from the row's
 * worst severity and from `alerts.count`; count it in `alerts.mutedCount`.
 * Mute state itself lives in clients.yml `muted_alerts` (see SKILL.md).
 *
 * `industry` (optional, per project) is the benchmark vertical slug from
 * clients.yml (e.g. "retail", "media", "finance_insurance"). It powers the
 * editable per-project industry chip and the canvas benchmark section. Omit when
 * unset. With the local server running, editing the chip writes it back to
 * clients.yml; under file:// the dashboard emits a copy-prompt instead.
 *
 * `candidatesList` (optional, per project) are breaches that are NOT yet confirmed
 * (SKILL.md Step 8a confirmation gate). They render under "Watching · not yet
 * confirmed" with a streak chip (streak/needed) and never count as open alerts.
 *
 * `resolvedRecently` (optional, top-level) logs alerts that just cleared the
 * resolve hysteresis — shown as "Recently resolved" (no Slack post fires for them).
 *
 * `metrics` (optional, per project) powers the deep project page (click a row →
 * "Open details"). One entry per evaluated KPI: current/previous window values,
 * WoW delta (deltaPct for volumes, deltaPts for rates), optional iOS/Android
 * split, a threshold block with signed `headroom` (positive = safe margin,
 * negative = breaching) driving the headroom gauge, a confirmation `status`, and
 * a bounded `series` for the mini-sparkline. See SKILL.md Step 13.
 *   - `rate` (optional) carries a correlated ratio alongside a raw-count metric,
 *     e.g. opt-outs: { current, previous, deltaPct } as the per-send rate
 *     (opt-outs ÷ sends × 100), or { note } when only a qualitative read exists.
 *     The opt-out alert fires only when BOTH the raw count and this rate rise
 *     (a volume-driven rise with a flat/down rate is suppressed — SKILL.md Step 8a).
 *   - `note` (optional) is a one-line caption shown on the card (e.g. why a rise
 *     was suppressed).
 *
 * `thresholdSuggestions` (optional, per project) are skill-computed tuning hints
 * (loosen/tighten) with a basis (volatility | false_positives | headroom), a one
 * line rationale and a confidence. The detail page renders Apply / Edit / Reset.
 */
window.AIRSHIP_KPI_DATA = {
  isSample: true,
  generatedAt: "2026-06-24 · 20:23 CEST",
  window: "2026-06-17 → 2026-06-23 vs 2026-06-10 → 2026-06-16",
  // Used to build Slack deep links (channel + canvas). Defaults applied if absent.
  slackWorkspace: "urbanairship",
  slackTeamId: "T025Q1VP7",
  // Top-of-page priority note (optional).
  priority:
    "Sample data shown. Run the skill once to generate the local dashboard-data.js " +
    "and replace this with your real projects.",
  // Global stats tiles (optional — recomputed from clients if omitted).
  stats: {
    clients: 3,
    projects: 4,
    projectsInAlert: 2,
    openAlerts: 4, // active only (muted false positives are excluded)
    resolutions: 1,
    muted: 1,
  },
  // Rolling history of recent runs, newest last. Drives the header sparkline.
  history: [
    { ts: "2026-06-18", openAlerts: 7, projectsInAlert: 4 },
    { ts: "2026-06-19", openAlerts: 6, projectsInAlert: 3 },
    { ts: "2026-06-20", openAlerts: 6, projectsInAlert: 3 },
    { ts: "2026-06-21", openAlerts: 8, projectsInAlert: 4 },
    { ts: "2026-06-22", openAlerts: 5, projectsInAlert: 2 },
    { ts: "2026-06-23", openAlerts: 5, projectsInAlert: 2 },
    { ts: "2026-06-24", openAlerts: 5, projectsInAlert: 2 },
  ],
  // Alerts that cleared the resolve hysteresis recently (no Slack post fires).
  resolvedRecently: [
    { key: "push_sends_drop_ios", project: "Sample Retailer FR PROD", resolvedAt: "2026-06-23", cause: "Campaign resumed Jun 22 — sends back to baseline" },
    { key: "sms_delivery_rate_low", project: "Sample Media PROD", resolvedAt: "2026-06-22", cause: "Carrier issue cleared; delivery back to 97%" },
  ],
  // Projects grouped by client. A client can own several projects.
  clients: [
    {
      name: "Sample Retailer",
      projects: [
        {
          name: "Sample Retailer FR PROD",
          channel: "cs-sample-retailer",
          canvasId: "F0SAMPLE001",
          industry: "retail",
          lastRun: "2026-06-24 · 20:23 CEST",
          alerts: { count: 3, worstSeverity: "danger", mutedCount: 0 },
          // Per-alert detail powers the Mute buttons; severity drives the dots.
          alertsList: [
            { key: "app_opens_drop_ios", severity: "danger", openedAt: "2026-06-10", cause: "No campaign Jun 17–20" },
            { key: "optin_velocity_drop", severity: "warning", openedAt: "2026-06-18", cause: "Lower acquisition week" },
            { key: "direct_response_low", severity: "warning", openedAt: "2026-06-16", cause: "Tracking-health signal — verify deep links" },
          ],
          // Per-KPI depth for the deep project page (click the row → Open details).
          metrics: [
            {
              key: "app_opens_drop_ios", label: "App opens", group: "app", channel: "app", unit: "count",
              current: 128000, previous: 210000, deltaPct: -39,
              os: { ios: { deltaPct: -34 }, android: { deltaPct: -41 } },
              threshold: { key: "app_opens_drop_pct", value: 40, kind: "drop", headroom: -1, breaching: true },
              status: "confirmed",
              series: [
                { t: "2026-06-18", v: 205 }, { t: "2026-06-19", v: 198 }, { t: "2026-06-20", v: 176 },
                { t: "2026-06-21", v: 168 }, { t: "2026-06-22", v: 150 }, { t: "2026-06-23", v: 134 }, { t: "2026-06-24", v: 128 },
              ],
            },
            {
              key: "optins_drop", label: "New opt-ins", group: "acquisition", channel: "acquisition", unit: "count",
              current: 3200, previous: 5080, deltaPct: -37,
              threshold: { key: "optins_drop_pct", value: 25, kind: "drop", headroom: -12, breaching: true },
              status: "confirmed",
              series: [
                { t: "2026-06-18", v: 5.1 }, { t: "2026-06-19", v: 4.9 }, { t: "2026-06-20", v: 4.4 },
                { t: "2026-06-21", v: 4.1 }, { t: "2026-06-22", v: 3.7 }, { t: "2026-06-23", v: 3.4 }, { t: "2026-06-24", v: 3.2 },
              ],
            },
            {
              key: "direct_response_rate", label: "Direct response rate", group: "push", channel: "push", unit: "%",
              current: 0.1, previous: 0.6, deltaPts: -0.5,
              threshold: { key: "direct_response_rate_min", value: 0.5, kind: "floor", headroom: -0.4, breaching: true },
              status: "confirmed",
              series: [
                { t: "2026-06-18", v: 0.6 }, { t: "2026-06-19", v: 0.6 }, { t: "2026-06-20", v: 0.5 },
                { t: "2026-06-21", v: 0.4 }, { t: "2026-06-22", v: 0.2 }, { t: "2026-06-23", v: 0.1 }, { t: "2026-06-24", v: 0.1 },
              ],
            },
            {
              key: "push_sends_drop", label: "Push sends", group: "push", channel: "push", unit: "count",
              current: 980000, previous: 1180000, deltaPct: -16.9,
              os: { ios: { deltaPct: -14 }, android: { deltaPct: -20 } },
              threshold: { key: "push_sends_drop_pct", value: 100, kind: "drop", headroom: 83.1, breaching: false },
              status: "ok",
              series: [
                { t: "2026-06-18", v: 1180 }, { t: "2026-06-19", v: 1150 }, { t: "2026-06-20", v: 1120 },
                { t: "2026-06-21", v: 1080 }, { t: "2026-06-22", v: 1020 }, { t: "2026-06-23", v: 990 }, { t: "2026-06-24", v: 980 },
              ],
            },
            {
              // Volume-driven opt-out rise: raw count up, but the per-send RATE fell
              // (sends grew faster) → alert suppressed by the rate-correlation gate.
              key: "optouts_ios", label: "Opt-outs (iOS)", group: "push", channel: "push", unit: "count",
              current: 44000, previous: 32000, deltaPct: 37.5,
              rate: { current: 4.5, previous: 5.4, deltaPct: -16.7 },
              threshold: { key: "optout_rate_rise_pct", value: 15, kind: "rise", headroom: 31.7, breaching: false },
              status: "ok",
              note: "Raw +37.5% but rate/send 5.4%→4.5% (sends +65%) — volume-driven, suppressed.",
              series: [
                { t: "2026-06-18", v: 5800 }, { t: "2026-06-19", v: 6100 }, { t: "2026-06-20", v: 6400 },
                { t: "2026-06-21", v: 6300 }, { t: "2026-06-22", v: 6500 }, { t: "2026-06-23", v: 6600 }, { t: "2026-06-24", v: 6300 },
              ],
            },
            {
              key: "devices_optin", label: "Opted-in devices", group: "devices", channel: "devices", unit: "count",
              current: 512000, previous: 515000, deltaPct: -0.6,
              threshold: { key: "devices_optin_drop_pct", value: 5, kind: "drop", headroom: 4.4, breaching: false },
              status: "ok",
              series: [
                { t: "2026-06-18", v: 516 }, { t: "2026-06-19", v: 515 }, { t: "2026-06-20", v: 515 },
                { t: "2026-06-21", v: 514 }, { t: "2026-06-22", v: 513 }, { t: "2026-06-23", v: 512 }, { t: "2026-06-24", v: 512 },
              ],
            },
          ],
          thresholdSuggestions: [
            {
              key: "app_opens_drop_pct", current: 40, suggested: 45, direction: "loosen", basis: "volatility",
              rationale: "iOS/Android WoW swings ±30–40% around campaign windows; 2 candidates cleared without a real incident.",
              confidence: "med",
            },
          ],
          // For watch/alert projects, `trend` is an ARRAY → rendered as bullet
          // points (one driver per line). For stable projects use a plain string.
          trend: [
            "App opens ↓34% iOS / ↓41% Android",
            "Opt-ins ↓37%",
            "Direct response ~0.1% — structural decline since Jun 16",
          ],
          // Per-run open-alert counts, newest last (drives the row sparkline).
          alertHistory: [4, 3, 3, 5, 3, 3, 3],
        },
        {
          name: "Sample Retailer Web",
          channel: "cs-sample-retailer",
          canvasId: "F0SAMPLE002",
          lastRun: "2026-06-24 · 20:23 CEST",
          alerts: { count: 0, worstSeverity: null },
          trend: "Stable — no significant variations",
          alertHistory: [0, 0, 0, 0, 0, 0, 0],
        },
      ],
    },
    {
      name: "Sample Media",
      projects: [
        {
          name: "Sample Media PROD",
          channel: "cs-sample-media",
          canvasId: "F0SAMPLE003",
          industry: "media",
          lastRun: "2026-06-24 · 20:23 CEST",
          // 1 active alert + 1 muted false positive (excluded from worstSeverity).
          alerts: { count: 1, worstSeverity: "warning", mutedCount: 1 },
          alertsList: [
            { key: "email_delay_high", severity: "warning", openedAt: "2026-06-23", cause: "1 day confirmed (Jun 23), peak 38.9% at 10:00 local — one alert per project; per-day detail in Email health history" },
            { key: "push_sends_drop_android", severity: "info", muted: true, openedAt: "2026-06-20", reason: "Campaign-timing artifact, expected" },
          ],
          // Breaching but not yet confirmed — dashboard-only, never posted to Slack.
          candidatesList: [
            { key: "optins_drop_ios", severity: "warning", streak: 1, needed: 2, cause: "iOS opt-ins −27% — watching before it confirms" },
            { key: "app_opens_drop_android", severity: "danger", streak: 2, needed: 3, cause: "Android opens −44% — one more breaching run to confirm" },
          ],
          metrics: [
            {
              key: "email_delay_rate", label: "Email delay rate", group: "email", channel: "email", unit: "%",
              current: 38.9, previous: 6.2, deltaPts: 32.7,
              threshold: { key: "email_delay_rate_max", value: 10, kind: "ceiling", headroom: -28.9, breaching: true },
              status: "confirmed",
              series: [
                { t: "2026-06-18", v: 5.8 }, { t: "2026-06-19", v: 6.1 }, { t: "2026-06-20", v: 6.4 },
                { t: "2026-06-21", v: 7.0 }, { t: "2026-06-22", v: 9.2 }, { t: "2026-06-23", v: 38.9 }, { t: "2026-06-24", v: 22.5 },
              ],
            },
            {
              key: "email_open_rate", label: "Email open rate", group: "email", channel: "email", unit: "%",
              current: 24.1, previous: 25.0, deltaPts: -0.9,
              threshold: { key: "email_open_rate_drop_pts", value: 5, kind: "drop", headroom: 4.1, breaching: false },
              status: "ok",
              series: [
                { t: "2026-06-18", v: 25.2 }, { t: "2026-06-19", v: 24.9 }, { t: "2026-06-20", v: 25.1 },
                { t: "2026-06-21", v: 24.6 }, { t: "2026-06-22", v: 24.4 }, { t: "2026-06-23", v: 24.2 }, { t: "2026-06-24", v: 24.1 },
              ],
            },
            {
              key: "app_opens_drop_android", label: "App opens", group: "app", channel: "app", unit: "count",
              current: 88000, previous: 157000, deltaPct: -44,
              os: { ios: { deltaPct: -12 }, android: { deltaPct: -44 } },
              threshold: { key: "app_opens_drop_pct", value: 40, kind: "drop", headroom: -4, breaching: true },
              status: "candidate",
              series: [
                { t: "2026-06-18", v: 156 }, { t: "2026-06-19", v: 152 }, { t: "2026-06-20", v: 149 },
                { t: "2026-06-21", v: 140 }, { t: "2026-06-22", v: 120 }, { t: "2026-06-23", v: 98 }, { t: "2026-06-24", v: 88 },
              ],
            },
            {
              key: "optins_drop_ios", label: "New opt-ins", group: "acquisition", channel: "acquisition", unit: "count",
              current: 1400, previous: 1920, deltaPct: -27,
              os: { ios: { deltaPct: -27 }, android: { deltaPct: -6 } },
              threshold: { key: "optins_drop_pct", value: 25, kind: "drop", headroom: -2, breaching: true },
              status: "candidate",
              series: [
                { t: "2026-06-18", v: 1.9 }, { t: "2026-06-19", v: 1.85 }, { t: "2026-06-20", v: 1.8 },
                { t: "2026-06-21", v: 1.7 }, { t: "2026-06-22", v: 1.6 }, { t: "2026-06-23", v: 1.5 }, { t: "2026-06-24", v: 1.4 },
              ],
            },
            {
              key: "push_sends_drop_android", label: "Push sends", group: "push", channel: "push", unit: "count",
              current: 0, previous: 240000, deltaPct: -100,
              os: { ios: { deltaPct: -3 }, android: { deltaPct: -100 } },
              threshold: { key: "push_sends_drop_pct", value: 100, kind: "drop", headroom: 0, breaching: true },
              status: "muted",
              series: [
                { t: "2026-06-18", v: 240 }, { t: "2026-06-19", v: 235 }, { t: "2026-06-20", v: 0 },
                { t: "2026-06-21", v: 0 }, { t: "2026-06-22", v: 238 }, { t: "2026-06-23", v: 0 }, { t: "2026-06-24", v: 0 },
              ],
            },
          ],
          thresholdSuggestions: [
            {
              key: "optins_drop_pct", current: 25, suggested: 30, direction: "loosen", basis: "false_positives",
              rationale: "iOS opt-ins dipped and recovered twice in 3 weeks with no acquisition change — likely weekend noise.",
              confidence: "med",
            },
          ],
          trend: [
            "email_delay_high: 1 confirmed day (Jun 23), peak 38.9% at 10:00 local",
            "2 candidates watching (opt-ins iOS, app opens Android)",
            "Push sends dip muted (false positive — campaign timing)",
          ],
          alertHistory: [2, 2, 2, 2, 1, 2, 2],
        },
      ],
    },
    {
      name: "Sample Bank",
      projects: [
        {
          name: "Sample Bank PROD",
          channel: "cs-sample-bank",
          canvasId: "F0SAMPLE004",
          industry: "finance_insurance",
          lastRun: "2026-06-24 · 20:23 CEST",
          alerts: { count: 0, worstSeverity: null },
          metrics: [
            {
              key: "app_opens", label: "App opens", group: "app", channel: "app", unit: "count",
              current: 54000, previous: 53000, deltaPct: 1.9,
              os: { ios: { deltaPct: 2.4 }, android: { deltaPct: 1.1 } },
              threshold: { key: "app_opens_drop_pct", value: 40, kind: "drop", headroom: 41.9, breaching: false },
              status: "ok",
              series: [
                { t: "2026-06-18", v: 52 }, { t: "2026-06-19", v: 53 }, { t: "2026-06-20", v: 52 },
                { t: "2026-06-21", v: 54 }, { t: "2026-06-22", v: 53 }, { t: "2026-06-23", v: 54 }, { t: "2026-06-24", v: 54 },
              ],
            },
            {
              key: "email_deliverability", label: "Email deliverability", group: "email", channel: "email", unit: "%",
              current: 99.1, previous: 99.0, deltaPts: 0.1,
              threshold: { key: "email_deliverability_min", value: 95, kind: "floor", headroom: 4.1, breaching: false },
              status: "ok",
              series: [
                { t: "2026-06-18", v: 99.0 }, { t: "2026-06-19", v: 98.9 }, { t: "2026-06-20", v: 99.1 },
                { t: "2026-06-21", v: 99.0 }, { t: "2026-06-22", v: 99.2 }, { t: "2026-06-23", v: 99.0 }, { t: "2026-06-24", v: 99.1 },
              ],
            },
          ],
          thresholdSuggestions: [
            {
              key: "app_opens_drop_pct", current: 40, suggested: 30, direction: "tighten", basis: "headroom",
              rationale: "App opens have stayed within ±5% for 8 runs; a 40% drop floor would never catch a real regression.",
              confidence: "low",
            },
          ],
          trend: "Stable — no significant variations",
          alertHistory: [1, 1, 1, 1, 0, 0, 0],
        },
      ],
    },
  ],
  // Local setup context (optional) — shown in the collapsed Setup section.
  setup: {
    files: [
      {
        label: "Credentials (secrets)",
        path: "~/.cursor/mcp.json",
        note: "OAuth app keys, client IDs, secrets — one Airship MCP server per project.",
      },
      {
        label: "Routing registry (no secrets)",
        path: ".cursor/skills/airship-kpi-monitor/clients.yml",
        note: "MCP server name, Slack channel, canvas ID, region, time zone, industry.",
      },
    ],
    checklist: [
      { content: "Prerequisites (uv, Slack MCP plugin)", done: true },
      { content: "Skill installed + docs synced from the repo", done: true },
      { content: "Local clients.yml created", done: true },
      { content: "Airship MCP servers in ~/.cursor/mcp.json", done: true },
      { content: "Smoke tests (opens API + Slack channel resolution)", done: true },
      { content: "First KPI run executed", done: true },
    ],
  },
};
