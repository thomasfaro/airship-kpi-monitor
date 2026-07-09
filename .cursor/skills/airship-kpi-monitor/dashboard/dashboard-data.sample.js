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
 * (and web) split, a threshold block with signed `headroom` (positive = safe
 * margin, negative = breaching) driving the headroom gauge, a confirmation
 * `status`, and a bounded `series` for the mini-sparkline. See SKILL.md Step 13.
 *   - `os` per-OS split: use `{ deltaPct }` for WoW / two-date-evolution KPIs
 *     (app opens, push sends, opt-in/opt-out ratio, and the device evolution
 *     families — iOS/Android only), or `{ value }` (absolute snapshot) when only a
 *     current base is available. Include `web` when the channel is active.
 *   - Opt-in/opt-out ratio (family `optin_optout_ratio`, App & engagement section)
 *     is daily opt-ins ÷ opt-outs, per OS (iOS/Android only). `series` IS the
 *     trend (the daily ratio across the window), not a separate WoW-only figure.
 *     Ratio > 1 = net-positive reach; < 1 = churn-dominant. Replaces the old
 *     standalone "Opt-in registrations" tile. See SKILL.md.
 *   - Total devices evolution (family `total_devices_evolution`, Acquisition
 *     section) is the % growth/decline of TOTAL unique devices between TWO dated
 *     /api/reports/devices calls (window start vs window end/today), per OS +
 *     total. GET /api/reports/devices?date=<date-time> counts all device events
 *     before that date-time, so the two endpoints are read directly from the API
 *     (no canvas-history dependency). This single family MERGES the former
 *     `installs` proxy and `devices_unique` trend tiles.
 *   - Opted-in / uninstalled devices (family `devices_optin` / `devices_uninstall`,
 *     Acquisition section) use the SAME two-date evolution (growth/decline %) per
 *     OS, computed from counts.{os}.opted_in / .uninstalled at the two dates.
 *   - Push pressure per user (family `push_pressure_per_user`, Push section) =
 *     weekly push sends (iOS+Android) / opted-in devices, unit "msg/user/wk", with
 *     a multi-week evolution `series`. Denominator is per-week opted-in via
 *     /api/reports/devices?date= (labelled proxy when a week's dated call is n/a).
 *   - `rate` (optional) carries a correlated ratio alongside a raw-count metric,
 *     e.g. opt-outs: { current, previous, deltaPct } as the per-send rate
 *     (opt-outs ÷ sends × 100), or { note } when only a qualitative read exists.
 *     The opt-out alert fires only when BOTH the raw count and this rate rise
 *     (a volume-driven rise with a flat/down rate is suppressed — SKILL.md Step 8a).
 *   - `note` (optional) is a one-line caption shown on the card (e.g. why a rise
 *     was suppressed).
 *   - `analysis` (optional) is a one-sentence, client-contextualized read of the
 *     KPI (value + WoW evolution, benchmark position, whether it's a concern). The
 *     skill authors it on weekly runs and reuses/falls back otherwise; the
 *     dashboard also derives a deterministic fallback sentence when it is absent.
 *   The detail page shows EVERY monitored KPI on the project's ACTIVE channels
 *   (healthy KPIs included, not just problems). A KPI under its min-volume floor is
 *   emitted with status "na" so it stays visible but is clearly not assessed;
 *   channels the project does not use at all are omitted.
 *
 * `thresholdSuggestions` (optional, per project) are skill-computed tuning hints
 * (loosen/tighten) with a basis (volatility | false_positives | headroom), a one
 * line rationale and a confidence. Each is shown inline on its KPI card (under the
 * headroom gauge) with Set / Reset and an Apply for the suggested value; a
 * suggestion with no matching KPI card falls back to an "Other suggestions" panel.
 * A suggestion may be DISMISSED from the dashboard (served: POST
 * /api/dismiss-suggestion; file://: copy-prompt) → its key lands in the project's
 * clients.yml `dismissed_suggestions` and the skill stops re-emitting it.
 * `dismissedSuggestions` (optional, per project) mirrors that list into the
 * snapshot so the dashboard also filters it client-side.
 * `watchedAlerts` (optional, per project) are KPIs a TAM manually watches (served:
 * POST /api/watch with a reason; file://: copy-prompt) → written to clients.yml
 * `watched_alerts: [{key, reason, since}]`. Watched KPIs stay surfaced (a 👁 chip on
 * the tile + a "Watched KPIs · manual" timeline block) even when NOT breaching.
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
            { key: "optin_optout_ratio_drop_ios", severity: "warning", openedAt: "2026-06-18", cause: "Lower acquisition week" },
            { key: "direct_response_low", severity: "warning", openedAt: "2026-06-16", cause: "Tracking-health signal — verify deep links" },
          ],
          // Per-KPI depth for the deep project page (click the row → Open details).
          // CANONICAL SHAPE: one metric per KPI FAMILY, OS split in the `os` OBJECT
          // (never baked into `key`). This project shows FULL mobile coverage:
          //   App & engagement → app_opens + timeinapp + optin_optout_ratio
          //   Push             → push_sends + push_pressure_per_user + optouts + direct_response_rate (each with os)
          //   Acquisition      → total_devices_evolution + devices_optin + devices_uninstall (two-date evolution)
          metrics: [
            {
              key: "app_opens", label: "App opens", group: "app", channel: "app", unit: "count",
              current: 128000, previous: 210000, deltaPct: -39,
              os: { ios: { deltaPct: -34 }, android: { deltaPct: -41 } },
              threshold: { key: "app_opens_drop_pct", value: 40, kind: "drop", headroom: -1, breaching: true },
              status: "confirmed",
              analysis: "Down 39% WoW (iOS -34% / Android -41%) and breaching the drop threshold - driven by no campaign Jun 17-20; a real engagement dip to watch.",
              series: [
                { t: "2026-06-18", v: 205 }, { t: "2026-06-19", v: 198 }, { t: "2026-06-20", v: 176 },
                { t: "2026-06-21", v: 168 }, { t: "2026-06-22", v: 150 }, { t: "2026-06-23", v: 134 }, { t: "2026-06-24", v: 128 },
              ],
            },
            {
              // Time-in-app ALWAYS accompanies app_opens on an app-active project.
              key: "timeinapp", label: "Time in app", group: "app", channel: "app", unit: "%",
              current: 118, previous: 132, deltaPct: -10.6,
              os: { ios: { deltaPct: -8.2 }, android: { deltaPct: -12.9 } },
              threshold: { key: "timeinapp_drop_pct", value: 20, kind: "drop", headroom: 9.4, breaching: false },
              status: "ok",
              analysis: "Session time eased ~11% WoW (iOS -8% / Android -13%) alongside the quieter week, still 9 pts clear of the drop guard - a soft dip, not a concern yet.",
              series: [
                { t: "2026-06-18", v: 131 }, { t: "2026-06-19", v: 129 }, { t: "2026-06-20", v: 126 },
                { t: "2026-06-21", v: 124 }, { t: "2026-06-22", v: 121 }, { t: "2026-06-23", v: 119 }, { t: "2026-06-24", v: 118 },
              ],
            },
            {
              key: "push_sends", label: "Push sends", group: "push", channel: "push", unit: "count",
              current: 980000, previous: 1180000, deltaPct: -16.9,
              os: { ios: { deltaPct: -14 }, android: { deltaPct: -20 } },
              threshold: { key: "push_sends_drop_pct", value: 100, kind: "drop", headroom: 83.1, breaching: false },
              status: "ok",
              analysis: "Push volume down 17% WoW but well within the drop guard (83 pts of headroom) - normal cadence, healthy.",
              series: [
                { t: "2026-06-18", v: 1180 }, { t: "2026-06-19", v: 1150 }, { t: "2026-06-20", v: 1120 },
                { t: "2026-06-21", v: 1080 }, { t: "2026-06-22", v: 1020 }, { t: "2026-06-23", v: 990 }, { t: "2026-06-24", v: 980 },
              ],
            },
            {
              // Push pressure per user per week = weekly push sends (iOS+Android) /
              // opted-in devices. `series` is a MULTI-WEEK evolution (one point per
              // ISO week, unit msg/user/wk). Denominator here is per-week opted-in
              // via /api/reports/devices?date=; a labelled proxy is used only when a
              // week's dated call is unavailable.
              key: "push_pressure_per_user", label: "Push pressure / user / wk", group: "push", channel: "push", unit: "x",
              current: 4.1, previous: 3.7, deltaPct: 10.8,
              threshold: { key: "push_pressure_per_user_max", value: 14, kind: "ceiling", headroom: 9.9, breaching: false },
              status: "ok",
              analysis: "~4.1 push/user/week (up from 3.7), well under the ~14/wk over-messaging ceiling - healthy marketing pressure with room to grow.",
              series: [
                { t: "2026-04-27", v: 3.2 }, { t: "2026-05-04", v: 3.4 }, { t: "2026-05-11", v: 3.5 },
                { t: "2026-05-18", v: 3.6 }, { t: "2026-05-25", v: 3.7 }, { t: "2026-06-01", v: 3.9 },
                { t: "2026-06-08", v: 3.8 }, { t: "2026-06-15", v: 4.0 }, { t: "2026-06-22", v: 4.1 },
              ],
            },
            {
              // Opt-outs — ONE family metric with the per-OS split in the `os` object.
              // Volume-driven rise: raw count up, but the per-send RATE fell (sends grew
              // faster) → alert suppressed by the rate-correlation gate (Step 8a).
              key: "optouts", label: "Opt-outs", group: "push", channel: "push", unit: "count",
              current: 44000, previous: 32000, deltaPct: 37.5,
              os: { ios: { deltaPct: 41.2 }, android: { deltaPct: 33.1 } },
              rate: { current: 4.5, previous: 5.4, deltaPct: -16.7 },
              threshold: { key: "optout_rate_rise_pct", value: 15, kind: "rise", headroom: 31.7, breaching: false },
              status: "ok",
              note: "Raw +37.5% but rate/send 5.4%→4.5% (sends +65%) — volume-driven, suppressed.",
              analysis: "Opt-out raw count up 37% (iOS +41% / Android +33%) but the per-send rate fell 5.4%->4.5% as sends grew - volume-driven, not a churn signal.",
              series: [
                { t: "2026-06-18", v: 5800 }, { t: "2026-06-19", v: 6100 }, { t: "2026-06-20", v: 6400 },
                { t: "2026-06-21", v: 6300 }, { t: "2026-06-22", v: 6500 }, { t: "2026-06-23", v: 6600 }, { t: "2026-06-24", v: 6300 },
              ],
            },
            {
              // Click rate (direct responses ÷ sends) — REQUIRES the per-OS `os` object.
              key: "direct_response_rate", label: "Click rate", group: "push", channel: "push", unit: "%",
              current: 0.1, previous: 0.6, deltaPts: -0.5,
              os: { ios: { deltaPct: -78 }, android: { deltaPct: -85 } },
              threshold: { key: "direct_response_rate_min", value: 0.5, kind: "floor", headroom: -0.4, breaching: true },
              status: "confirmed",
              analysis: "Click rate collapsed to 0.1% (iOS -78% / Android -85% WoW), below the 0.5% floor - likely a deep-link/tracking-health problem, not audience fatigue.",
              series: [
                { t: "2026-06-18", v: 0.6 }, { t: "2026-06-19", v: 0.6 }, { t: "2026-06-20", v: 0.5 },
                { t: "2026-06-21", v: 0.4 }, { t: "2026-06-22", v: 0.2 }, { t: "2026-06-23", v: 0.1 }, { t: "2026-06-24", v: 0.1 },
              ],
            },
            {
              // Opt-in / opt-out ratio = daily opt-ins ÷ opt-outs, per OS (iOS/Android
              // only). `series` IS the trend across the window — no separate WoW-only
              // view. Replaces the old standalone "Opt-in registrations" tile.
              key: "optin_optout_ratio", label: "Opt-in / opt-out ratio", group: "app", channel: "app", unit: "x",
              current: 0.73, previous: 1.12, deltaPct: -34.8,
              os: { ios: { deltaPct: -31 }, android: { deltaPct: -38 } },
              threshold: { key: "optin_optout_ratio_drop_pct", value: 30, kind: "drop", headroom: -4.8, breaching: true },
              status: "confirmed",
              analysis: "Ratio fell below 1 (0.73x, was 1.12x) - churn-dominant this week (iOS -31% / Android -38% WoW) and still declining day over day, past the 30% drop guard.",
              series: [
                { t: "2026-06-18", v: 1.15 }, { t: "2026-06-19", v: 1.05 }, { t: "2026-06-20", v: 0.98 },
                { t: "2026-06-21", v: 0.9 }, { t: "2026-06-22", v: 0.85 }, { t: "2026-06-23", v: 0.78 }, { t: "2026-06-24", v: 0.73 },
              ],
            },
            {
              // Total devices evolution — % growth/decline of TOTAL unique devices
              // between two dated /api/reports/devices calls (window start → end),
              // per OS + total. Merges the former installs proxy + unique-devices
              // trend into one Acquisition tile.
              key: "total_devices_evolution", label: "Total devices evolution", group: "acquisition", channel: "acquisition", unit: "count",
              current: 1204000, previous: 1191000, deltaPct: 1.1,
              os: { ios: { deltaPct: 0.8 }, android: { deltaPct: 1.4 } },
              threshold: { key: "total_devices_evolution_drop_pct", value: 5, kind: "drop", headroom: 6.1, breaching: false },
              status: "ok",
              note: "Between /api/reports/devices?date=2026-06-17 and ?date=2026-06-24 (total 1.191M → 1.204M).",
              analysis: "Installed base grew ~1.1% across the window (iOS +0.8% / Android +1.4%) - healthy net acquisition, well clear of the 5% decline guard.",
              series: [
                { t: "2026-06-18", v: 1191 }, { t: "2026-06-19", v: 1193 }, { t: "2026-06-20", v: 1195 },
                { t: "2026-06-21", v: 1198 }, { t: "2026-06-22", v: 1200 }, { t: "2026-06-23", v: 1202 }, { t: "2026-06-24", v: 1204 },
              ],
            },
            {
              // Opted-in devices — two-date evolution (window start → end), per OS.
              key: "devices_optin", label: "Opted-in devices", group: "acquisition", channel: "acquisition", unit: "count",
              current: 512000, previous: 515000, deltaPct: -0.6,
              os: { ios: { deltaPct: -0.4 }, android: { deltaPct: -0.8 } },
              threshold: { key: "devices_optin_drop_pct", value: 5, kind: "drop", headroom: 4.4, breaching: false },
              status: "ok",
              analysis: "Opted-in base essentially flat (-0.6% across the window), 4.4 pts of headroom - stable and healthy.",
              series: [
                { t: "2026-06-18", v: 516 }, { t: "2026-06-19", v: 515 }, { t: "2026-06-20", v: 515 },
                { t: "2026-06-21", v: 514 }, { t: "2026-06-22", v: 513 }, { t: "2026-06-23", v: 512 }, { t: "2026-06-24", v: 512 },
              ],
            },
            {
              // Uninstalled devices — two-date evolution (window start → end), per OS.
              key: "devices_uninstall", label: "Uninstalled devices", group: "acquisition", channel: "acquisition", unit: "count",
              current: 96000, previous: 92000, deltaPct: 4.3,
              os: { ios: { deltaPct: 3.1 }, android: { deltaPct: 5.2 } },
              threshold: { key: "devices_uninstall_rise_pct", value: 10, kind: "rise", headroom: 5.7, breaching: false },
              status: "ok",
              analysis: "Cumulative uninstalls 96K, up ~4% across the window within the 10% rise guard - normal churn, no spike.",
              series: [
                { t: "2026-06-18", v: 92 }, { t: "2026-06-19", v: 92 }, { t: "2026-06-20", v: 93 },
                { t: "2026-06-21", v: 94 }, { t: "2026-06-22", v: 94 }, { t: "2026-06-23", v: 95 }, { t: "2026-06-24", v: 96 },
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
          // Manually-watched KPIs (clients.yml watched_alerts) — surfaced even when
          // NOT breaching (a 👁 Watching chip on the tile + a "Watched KPIs · manual"
          // block in the timeline). The skill echoes this list verbatim each run.
          watchedAlerts: [
            { key: "timeinapp_drop_pct", reason: "Keeping an eye on session length after the June UX refresh.", since: "2026-06-20" },
          ],
          // Threshold-suggestion keys the TAM dismissed from the dashboard — the
          // skill must NOT re-emit them (filtered client-side too, belt-and-braces).
          dismissedSuggestions: ["optout_rate_rise_pct"],
          // For watch/alert projects, `trend` is an ARRAY → rendered as bullet
          // points (one driver per line). For stable projects use a plain string.
          trend: [
            "App opens ↓34% iOS / ↓41% Android",
            "Opt-in/opt-out ratio 0.73x (was 1.12x) — churn-dominant",
            "Click rate ~0.1% — structural decline since Jun 16",
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
            { key: "optin_optout_ratio_drop_ios", severity: "warning", streak: 1, needed: 2, cause: "iOS opt-in/opt-out ratio −27% — watching before it confirms" },
            { key: "app_opens_drop_android", severity: "danger", streak: 2, needed: 3, cause: "Android opens −44% — one more breaching run to confirm" },
          ],
          // FULL email-family coverage (email_sends → deliverability → open rate →
          // bounce → unsubscribe → spam complaint → delay) PLUS app/push/acquisition.
          // Canonical family keys; per-OS families carry the `os` object.
          metrics: [
            {
              key: "email_sends", label: "Email sends", group: "email", channel: "email", unit: "count",
              current: 2400000, previous: 2310000, deltaPct: 3.9,
              threshold: { key: "email_sends_drop_pct", value: 100, kind: "drop", headroom: 103.9, breaching: false },
              status: "ok",
              analysis: "Email volume up ~4% WoW at 2.40M sends - steady editorial cadence, no drop risk.",
              series: [
                { t: "2026-06-18", v: 330 }, { t: "2026-06-19", v: 335 }, { t: "2026-06-20", v: 342 },
                { t: "2026-06-21", v: 338 }, { t: "2026-06-22", v: 344 }, { t: "2026-06-23", v: 351 }, { t: "2026-06-24", v: 340 },
              ],
            },
            {
              key: "email_deliverability", label: "Email deliverability", group: "email", channel: "email", unit: "%",
              current: 98.6, previous: 98.8, deltaPts: -0.2,
              threshold: { key: "email_deliverability_min", value: 95, kind: "floor", headroom: 3.6, breaching: false },
              status: "ok",
              analysis: "Delivery 98.6%, 3.6 pts above the 95% floor - healthy sender reputation.",
              series: [
                { t: "2026-06-18", v: 98.9 }, { t: "2026-06-19", v: 98.8 }, { t: "2026-06-20", v: 98.7 },
                { t: "2026-06-21", v: 98.8 }, { t: "2026-06-22", v: 98.7 }, { t: "2026-06-23", v: 98.5 }, { t: "2026-06-24", v: 98.6 },
              ],
            },
            {
              key: "email_open_rate", label: "Email open rate", group: "email", channel: "email", unit: "%",
              current: 24.1, previous: 25.0, deltaPts: -0.9,
              threshold: { key: "email_open_rate_drop_pts", value: 5, kind: "drop", headroom: 4.1, breaching: false },
              status: "ok",
              analysis: "Open rate 24.1%, off 0.9 pts WoW but 4 pts clear of the drop guard - within normal weekly variation.",
              series: [
                { t: "2026-06-18", v: 25.2 }, { t: "2026-06-19", v: 24.9 }, { t: "2026-06-20", v: 25.1 },
                { t: "2026-06-21", v: 24.6 }, { t: "2026-06-22", v: 24.4 }, { t: "2026-06-23", v: 24.2 }, { t: "2026-06-24", v: 24.1 },
              ],
            },
            {
              key: "email_bounce", label: "Email bounce rate", group: "email", channel: "email", unit: "%",
              current: 0.8, previous: 0.7, deltaPts: 0.1,
              threshold: { key: "email_bounce_max", value: 2, kind: "ceiling", headroom: 1.2, breaching: false },
              status: "ok",
              analysis: "Bounce 0.8%, well under the 2% ceiling - list hygiene is good.",
              series: [
                { t: "2026-06-18", v: 0.7 }, { t: "2026-06-19", v: 0.7 }, { t: "2026-06-20", v: 0.8 },
                { t: "2026-06-21", v: 0.7 }, { t: "2026-06-22", v: 0.8 }, { t: "2026-06-23", v: 0.9 }, { t: "2026-06-24", v: 0.8 },
              ],
            },
            {
              key: "email_unsubscribe", label: "Email unsubscribes", group: "email", channel: "email", unit: "count",
              current: 4200, previous: 3900, deltaPct: 7.7,
              threshold: { key: "email_unsubscribe_rise_pct", value: 30, kind: "rise", headroom: 22.3, breaching: false },
              status: "ok",
              analysis: "Unsubscribes up ~8% WoW, comfortably within the 30% rise guard - normal churn against a heavier send week.",
              series: [
                { t: "2026-06-18", v: 560 }, { t: "2026-06-19", v: 580 }, { t: "2026-06-20", v: 600 },
                { t: "2026-06-21", v: 590 }, { t: "2026-06-22", v: 610 }, { t: "2026-06-23", v: 640 }, { t: "2026-06-24", v: 620 },
              ],
            },
            {
              key: "email_spam_complaint_rate", label: "Email spam-complaint rate", group: "email", channel: "email", unit: "%",
              current: 0.03, previous: 0.02, deltaPts: 0.01,
              threshold: { key: "email_spam_complaint_rate_max", value: 1, kind: "ceiling", headroom: 0.97, breaching: false },
              status: "ok",
              analysis: "Daily spam complaints 0.03%, far below the 1% ceiling - no deliverability risk.",
              series: [
                { t: "2026-06-18", v: 0.02 }, { t: "2026-06-19", v: 0.02 }, { t: "2026-06-20", v: 0.03 },
                { t: "2026-06-21", v: 0.02 }, { t: "2026-06-22", v: 0.03 }, { t: "2026-06-23", v: 0.04 }, { t: "2026-06-24", v: 0.03 },
              ],
            },
            {
              key: "email_delay_rate", label: "Email delay rate", group: "email", channel: "email", unit: "%",
              current: 38.9, previous: 6.2, deltaPts: 32.7,
              threshold: { key: "email_delay_rate_max", value: 10, kind: "ceiling", headroom: -28.9, breaching: true },
              status: "confirmed",
              analysis: "Delay rate spiked to 38.9% on Jun 23 (peak 10:00 local), far past the 10% ceiling - an ESP/throttling issue on the newsletter send, now easing.",
              series: [
                { t: "2026-06-18", v: 5.8 }, { t: "2026-06-19", v: 6.1 }, { t: "2026-06-20", v: 6.4 },
                { t: "2026-06-21", v: 7.0 }, { t: "2026-06-22", v: 9.2 }, { t: "2026-06-23", v: 38.9 }, { t: "2026-06-24", v: 22.5 },
              ],
            },
            {
              key: "app_opens", label: "App opens", group: "app", channel: "app", unit: "count",
              current: 88000, previous: 157000, deltaPct: -44,
              os: { ios: { deltaPct: -12 }, android: { deltaPct: -44 } },
              threshold: { key: "app_opens_drop_pct", value: 40, kind: "drop", headroom: -4, breaching: true },
              status: "candidate",
              analysis: "Android opens down 44% WoW past the drop guard while iOS holds (-12%) - one more breaching run to confirm; likely a low-content week.",
              series: [
                { t: "2026-06-18", v: 156 }, { t: "2026-06-19", v: 152 }, { t: "2026-06-20", v: 149 },
                { t: "2026-06-21", v: 140 }, { t: "2026-06-22", v: 120 }, { t: "2026-06-23", v: 98 }, { t: "2026-06-24", v: 88 },
              ],
            },
            {
              key: "timeinapp", label: "Time in app", group: "app", channel: "app", unit: "%",
              current: 142, previous: 150, deltaPct: -5.3,
              os: { ios: { deltaPct: -3.1 }, android: { deltaPct: -7.4 } },
              threshold: { key: "timeinapp_drop_pct", value: 20, kind: "drop", headroom: 14.7, breaching: false },
              status: "ok",
              analysis: "Session time off ~5% WoW, 15 pts clear of the drop guard - engagement depth holding despite the opens dip.",
              series: [
                { t: "2026-06-18", v: 150 }, { t: "2026-06-19", v: 149 }, { t: "2026-06-20", v: 147 },
                { t: "2026-06-21", v: 146 }, { t: "2026-06-22", v: 144 }, { t: "2026-06-23", v: 143 }, { t: "2026-06-24", v: 142 },
              ],
            },
            {
              key: "push_sends", label: "Push sends", group: "push", channel: "push", unit: "count",
              current: 0, previous: 240000, deltaPct: -100,
              os: { ios: { deltaPct: -3 }, android: { deltaPct: -100 } },
              threshold: { key: "push_sends_drop_pct", value: 100, kind: "drop", headroom: 0, breaching: true },
              status: "muted",
              analysis: "Android push went to zero (campaign-timing artifact, muted false positive); iOS steady.",
              series: [
                { t: "2026-06-18", v: 240 }, { t: "2026-06-19", v: 235 }, { t: "2026-06-20", v: 0 },
                { t: "2026-06-21", v: 0 }, { t: "2026-06-22", v: 238 }, { t: "2026-06-23", v: 0 }, { t: "2026-06-24", v: 0 },
              ],
            },
            {
              // Click rate with the required per-OS `os` object.
              key: "direct_response_rate", label: "Click rate", group: "push", channel: "push", unit: "%",
              current: 2.4, previous: 2.5, deltaPts: -0.1,
              os: { ios: { deltaPct: -2 }, android: { deltaPct: -6 } },
              threshold: { key: "direct_response_rate_min", value: 0.5, kind: "floor", headroom: 1.9, breaching: false },
              status: "ok",
              analysis: "Direct-open rate 2.4% (iOS 2.6% / Android 2.2%), well above the 0.5% floor - healthy push engagement.",
              series: [
                { t: "2026-06-18", v: 2.5 }, { t: "2026-06-19", v: 2.5 }, { t: "2026-06-20", v: 2.4 },
                { t: "2026-06-21", v: 2.5 }, { t: "2026-06-22", v: 2.4 }, { t: "2026-06-23", v: 2.4 }, { t: "2026-06-24", v: 2.4 },
              ],
            },
            {
              // Opt-in / opt-out ratio — candidate status (breaching but not yet
              // confirmed, see candidatesList above).
              key: "optin_optout_ratio", label: "Opt-in / opt-out ratio", group: "app", channel: "app", unit: "x",
              current: 0.82, previous: 1.12, deltaPct: -26.8,
              os: { ios: { deltaPct: -27 }, android: { deltaPct: -6 } },
              threshold: { key: "optin_optout_ratio_drop_pct", value: 30, kind: "drop", headroom: 3.2, breaching: false },
              status: "candidate",
              analysis: "iOS ratio down 27% WoW (0.82x, was 1.12x) while Android holds (-6%) - an iOS-specific reach dip, watching before it confirms.",
              series: [
                { t: "2026-06-18", v: 1.15 }, { t: "2026-06-19", v: 1.08 }, { t: "2026-06-20", v: 1.02 },
                { t: "2026-06-21", v: 0.96 }, { t: "2026-06-22", v: 0.9 }, { t: "2026-06-23", v: 0.86 }, { t: "2026-06-24", v: 0.82 },
              ],
            },
            {
              // Total devices evolution — GRACEFUL DEGRADE: only ONE dated
              // /api/reports/devices call was available this run (the window-start
              // dated call couldn't be fetched), so the evolution % isn't computable
              // yet. Show the current absolute base per OS with status "ok" (NOT
              // "na"); omit deltaPct/headroom/breaching and add a note.
              key: "total_devices_evolution", label: "Total devices evolution", group: "acquisition", channel: "acquisition", unit: "count",
              current: 892000,
              os: { ios: { value: 402000 }, android: { value: 490000 } },
              threshold: { key: "total_devices_evolution_drop_pct", value: 5, kind: "drop" },
              status: "ok",
              note: "Evolution n/a \u2014 window-start dated devices call not available this run.",
              analysis: "Installed base 892K (iOS 402K / Android 490K); the start\u2192end evolution needs both dated devices calls to compute.",
            },
            {
              // Graceful device snapshot: the window-start dated devices call was not
              // available → show the current absolute base per OS (status "ok"), NOT
              // a greyed-out "na" card.
              key: "devices_optin", label: "Opted-in devices", group: "acquisition", channel: "acquisition", unit: "count",
              current: 486000,
              os: { ios: { value: 214000 }, android: { value: 272000 } },
              threshold: { key: "devices_optin_drop_pct", value: 5, kind: "drop" },
              status: "ok",
              note: "Evolution n/a \u2014 window-start dated devices call not read this run.",
              analysis: "Opted-in base 486K (iOS 214K / Android 272K); the two-date \u0394 is pending the second dated call, but current reach is visible and healthy.",
            },
          ],
          thresholdSuggestions: [
            {
              key: "optin_optout_ratio_drop_pct", current: 30, suggested: 35, direction: "loosen", basis: "false_positives",
              rationale: "iOS ratio dipped and recovered twice in 3 weeks with no acquisition change — likely weekend noise.",
              confidence: "med",
            },
          ],
          trend: [
            "email_delay_high: 1 confirmed day (Jun 23), peak 38.9% at 10:00 local",
            "2 candidates watching (opt-in/opt-out ratio iOS, app opens Android)",
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
