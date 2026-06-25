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
    openAlerts: 5,
    resolutions: 1,
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
  // Projects grouped by client. A client can own several projects.
  clients: [
    {
      name: "Sample Retailer",
      projects: [
        {
          name: "Sample Retailer FR PROD",
          channel: "cs-sample-retailer",
          canvasId: "F0SAMPLE001",
          lastRun: "2026-06-24 · 20:23 CEST",
          alerts: { count: 3, worstSeverity: "danger" },
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
          lastRun: "2026-06-24 · 20:23 CEST",
          alerts: { count: 2, worstSeverity: "warning" },
          trend: [
            "Email delay 8.3% on Jun 23 (peak 38.9% at 10:00 local)",
            "Other channels nominal",
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
          lastRun: "2026-06-24 · 20:23 CEST",
          alerts: { count: 0, worstSeverity: null },
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
        note: "MCP server name, Slack channel, canvas ID, region, time zone.",
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
