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
 * editable per-project industry chip and the weekly recap / dashboard
 * benchmark read. Omit when
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
 * the 30-day-vs-previous-30-day delta (deltaPct for volumes, deltaPts for rates),
 * optional iOS/Android
 * (and web) split, a threshold block with signed `headroom` (positive = safe
 * margin, negative = breaching) driving the headroom gauge, a confirmation
 * `status`, and a bounded `series` for the mini-sparkline. See SKILL.md Step 13.
 *   - WINDOW: every current/previous pair here is the last 30 complete days vs
 *     the 30 immediately before. The Slack canvas uses the SAME window, so the
 *     two surfaces show the same delta — if they disagree, it is a bug.
 *   - `os` per-OS split: use `{ deltaPct }` for windowed / two-date-evolution KPIs
 *     (app opens, push sends, opt-in/opt-out ratio, and the device evolution
 *     families — iOS/Android only), or `{ value }` (absolute snapshot) when only a
 *     current base is available. Include `web` when the channel is active.
 *   - Opt-in/opt-out ratio (family `optin_optout_ratio`, App & engagement section)
 *     is daily opt-ins ÷ opt-outs, per OS (iOS/Android only). `series` IS the
 *     trend (the daily ratio across the window), not a separate delta-only figure.
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
 *     30-day push sends (iOS+Android) / opted-in devices, unit "msg/user/30d", with
 *     a `series` that is the ROLLING 30-day value sampled weekly (same unit as the
 *     headline, so the chart is directly readable). Denominator is opted-in via
 *     /api/reports/devices?date= (labelled proxy when a dated call is n/a). The
 *     threshold key is `push_pressure_per_user_max_30d` — renamed from
 *     `push_pressure_per_user_max` when the unit went from weekly to monthly.
 *   - `rate` (optional) carries a correlated ratio alongside a raw-count metric,
 *     e.g. opt-outs: { current, previous, deltaPct } as the per-send rate
 *     (opt-outs ÷ sends × 100), or { note } when only a qualitative read exists.
 *     The opt-out alert fires only when BOTH the raw count and this rate rise
 *     (a volume-driven rise with a flat/down rate is suppressed — SKILL.md Step 8a).
 *   - `sources` (optional) carries a SECOND measurement of the same KPI, used by the
 *     email family where both Airship and SparkPost measure it. The card headlines
 *     `sources[primary]` — current, previous AND delta all from that one source, so a
 *     card never mixes them — and shows the other underneath with its origin labelled,
 *     which is how the same KPI stays on a single card. SparkPost is primary on every
 *     rate it measures; Airship stays primary on email_sends and email_unsubscribe.
 *     `note` explains any case where the two are not strictly comparable. The alert
 *     threshold always evaluates the Airship series, and the card says so. Note the
 *     email rate guards (deliverability, bounce, spam, delay) alert on RECENT DAYS,
 *     not on the 30-day figure headlined here, so an alert can be active while the
 *     card looks healthy. Omit for
 *     single-source KPIs: the card then just shows an "Airship" chip.
 *   - `note` (optional) is a one-line caption shown on the card (e.g. why a rise
 *     was suppressed).
 *   - `analysis` (optional) is a one-sentence, client-contextualized read of the
 *     KPI (value + 30-day evolution, benchmark position, whether it's a concern). The
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
 * EMAIL is described at TWO levels, because the sending DOMAIN is the unit that
 * alerts, scores and streaks attach to — not the project.
 *   - `emailSummary` (optional, per project) is the project rollup: {senderScore,
 *     previousSenderScore, senderGrade, activeDomainCount, placementRisk}. It is
 *     recombined from the domains' RAW COUNTS, never by averaging their rates:
 *     one real client sends 10.1M on one domain and 394k on another with a very
 *     different profile, and a mean erases the smaller one.
 *   - `emailDomains[]` (optional, per project) is one entry per domain declared in
 *     clients.yml `email.sending_domains`: {domain, active, senderScore,
 *     senderGrade, rates, ips, metrics[], placementRisk, deliverability}. A domain
 *     that sent nothing in the window is `active: false` and reports `na` — NEVER
 *     `ok`. A domain under `min_email_sends` (2000) is reported but not judged:
 *     no score, no findings, `na` rates.
 * `placementRisk` {level: none|watch|high, domain, reasons[]} answers a question
 * the sender score cannot. The score grades ACCEPTANCE (did the receiver take the
 * mail); placement is inbox-vs-spam, which no API exposes without SparkPost's paid
 * add-on. A real project scored 100/100 while its open rate fell 21.8 points with
 * delivery at 99.7% and its IP suspended — accepted everywhere, seen nowhere.
 *
 * `deliverability` (per DOMAIN, inside `emailDomains[]`) is the SparkPost
 * drill-down written by SKILL.md Step 3e. Airship reports email totals but not
 * WHERE mail lands or WHY it failed; this adds both, and is the reason the Slack
 * canvas can stay synthetic. It renders INSIDE the Email KPI panel (findings above
 * the cards, provider table and reasons below), so all email lives in one place.
 * The account totals are NOT drawn as tiles — each already has a KPI card and is
 * attached to it through `metrics[].sources`. Rates are computed on INJECTIONS
 * (SparkPost's denominator), so they will not tie out exactly to the Airship email
 * send count — that is expected, never reconcile one with the other.
 *   - `findings[]` is the skill's diagnosis, rendered first: {severity, title,
 *     detail}. Severity is danger | warning | info | success.
 *   - `providers[]` one row per mailbox provider, ordered by volume: {name,
 *     share, injected, deliveryRate, delayRate, bounceRate, openRate}.
 *   - `delayReasons[]` / `bounceReasons[]` carry the raw SMTP response the
 *     receiving server returned: {domain, count, reason}. Never paraphrase them.
 *     Each also carries the bucket it was classified into: {classId, className,
 *     classSeverity}.
 *   - `deferralClasses[]` is the deferral MIX, and it is what makes a delay rate
 *     readable: {id, label, severity, count, share, meaning, domains[]}. The same
 *     headline rate means opposite things — one real project was 82%
 *     `ip_suspended` (infrastructure) and another 65% `mailbox_full` (list
 *     ageing). Buckets: ip_suspended, reputation_spam, reputation_volume,
 *     throttle_session, mailbox_full, mailbox_inactive, dns_unreachable,
 *     service_refused.
 *   - `bounceClasses[]` labels bounces: {name, category (Soft|Hard|Block), count}.
 *   - `gmailReputation` (optional) is the Google Postmaster read when configured:
 *     {reputation, lastDay} — or {reason} explaining why it is missing.
 * Omit the whole block when the project sends no email or SparkPost is not
 * enabled for it; the panel then does not render at all.
 *
 * `watchedAlerts` (optional, per project) are KPIs a TAM manually watches (served:
 * POST /api/watch with a reason; file://: copy-prompt) → written to clients.yml
 * `watched_alerts: [{key, reason, since}]`. Watched KPIs stay surfaced (a 👁 chip on
 * the tile + a "Watched KPIs · manual" timeline block) even when NOT breaching.
 */
window.AIRSHIP_KPI_DATA = {
  isSample: true,
  generatedAt: "2026-06-24 · 20:23 CEST",
  // Object form (preferred). A plain string is still accepted for old snapshots.
  window: {
    current: { start: "2026-05-26", end: "2026-06-24" },
    previous: { start: "2026-04-26", end: "2026-05-25" },
  },
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
            { key: "optin_optout_ratio_drop_ios", severity: "warning", openedAt: "2026-06-18", cause: "Lower acquisition period" },
            { key: "direct_response_low", severity: "warning", openedAt: "2026-06-16", cause: "Tracking-health signal — verify deep links" },
          ],
          // Per-KPI depth for the deep project page (click the row → Open details).
          // CANONICAL SHAPE: one metric per KPI FAMILY, OS split in the `os` OBJECT
          // (never baked into `key`). This project shows FULL mobile coverage:
          //   App & engagement → app_opens + timeinapp + optin_optout_ratio
          //   Push             → push_sends + push_pressure_per_user + direct_response_rate (each with os)
          //   Acquisition      → total_devices_evolution + devices_optin + devices_uninstall (two-date evolution)
          metrics: [
            {
              key: "app_opens", label: "App opens", group: "app", channel: "app", unit: "count",
              current: 128000, previous: 210000, deltaPct: -39,
              os: { ios: { deltaPct: -34 }, android: { deltaPct: -41 } },
              threshold: { key: "app_opens_drop_pct", value: 25, kind: "drop", headroom: -1, breaching: true },
              status: "confirmed",
              analysis: "Down 39% vs prev 30d (iOS -34% / Android -41%) and breaching the drop threshold - driven by no campaign Jun 17-20; a real engagement dip to watch.",
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
              threshold: { key: "timeinapp_drop_pct", value: 15, kind: "drop", headroom: 9.4, breaching: false },
              status: "ok",
              analysis: "Session time eased ~11% vs prev 30d (iOS -8% / Android -13%) alongside the quieter period, still 9 pts clear of the drop guard - a soft dip, not a concern yet.",
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
              analysis: "Push volume down 17% vs prev 30d but well within the drop guard (83 pts of headroom) - normal cadence, healthy.",
              series: [
                { t: "2026-06-18", v: 1180 }, { t: "2026-06-19", v: 1150 }, { t: "2026-06-20", v: 1120 },
                { t: "2026-06-21", v: 1080 }, { t: "2026-06-22", v: 1020 }, { t: "2026-06-23", v: 990 }, { t: "2026-06-24", v: 980 },
              ],
            },
            {
              // Push pressure per user per 30 days = window push sends (iOS+Android) /
              // opted-in devices. `series` is the ROLLING 30-day value SAMPLED WEEKLY
              // (unit msg/user/30d — same as the headline, so the chart is directly
              // comparable to the printed value). Denominator is opted-in via
              // /api/reports/devices?date=; a labelled proxy is used only when a
              // dated call is unavailable.
              key: "push_pressure_per_user", label: "Push pressure / user / 30d", group: "push", channel: "push", unit: "x",
              current: 17.6, previous: 15.9, deltaPct: 10.8,
              threshold: { key: "push_pressure_per_user_max_30d", value: 60, kind: "ceiling", headroom: 42.4, breaching: false },
              status: "ok",
              analysis: "~17.6 msg/user/30d (up from 15.9), well under the 60/30d over-messaging ceiling - healthy marketing pressure with room to grow.",
              series: [
                { t: "2026-04-27", v: 13.8 }, { t: "2026-05-04", v: 14.6 }, { t: "2026-05-11", v: 15.1 },
                { t: "2026-05-18", v: 15.5 }, { t: "2026-05-25", v: 15.9 }, { t: "2026-06-01", v: 16.8 },
                { t: "2026-06-08", v: 16.3 }, { t: "2026-06-15", v: 17.2 }, { t: "2026-06-22", v: 17.6 },
              ],
            },
            {
              // Click rate (direct responses ÷ sends) — REQUIRES the per-OS `os` object.
              key: "direct_response_rate", label: "Click rate", group: "push", channel: "push", unit: "%",
              current: 0.1, previous: 0.6, deltaPts: -0.5,
              os: { ios: { deltaPct: -78 }, android: { deltaPct: -85 } },
              threshold: { key: "direct_response_rate_min", value: 0.5, kind: "floor", headroom: -0.4, breaching: true },
              status: "confirmed",
              analysis: "Click rate collapsed to 0.1% (iOS -78% / Android -85% vs prev 30d), below the 0.5% floor - likely a deep-link/tracking-health problem, not audience fatigue.",
              series: [
                { t: "2026-06-18", v: 0.6 }, { t: "2026-06-19", v: 0.6 }, { t: "2026-06-20", v: 0.5 },
                { t: "2026-06-21", v: 0.4 }, { t: "2026-06-22", v: 0.2 }, { t: "2026-06-23", v: 0.1 }, { t: "2026-06-24", v: 0.1 },
              ],
            },
            {
              // Opt-in / opt-out ratio = daily opt-ins ÷ opt-outs, per OS (iOS/Android
              // only). `series` IS the trend across the window — no separate vs prev 30d-only
              // view. Replaces the old standalone "Opt-in registrations" tile.
              key: "optin_optout_ratio", label: "Opt-in / opt-out ratio", group: "app", channel: "app", unit: "x",
              current: 0.73, previous: 1.12, deltaPct: -34.8,
              os: { ios: { deltaPct: -31 }, android: { deltaPct: -38 } },
              threshold: { key: "optin_optout_ratio_drop_pct", value: 20, kind: "drop", headroom: -4.8, breaching: true },
              status: "confirmed",
              analysis: "Ratio fell below 1 (0.73x, was 1.12x) - churn-dominant this window (iOS -31% / Android -38% vs prev 30d) and still declining day over day, past the 20% drop guard.",
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
              threshold: { key: "total_devices_evolution_drop_pct", value: 10, kind: "drop", headroom: 6.1, breaching: false },
              status: "ok",
              note: "Between /api/reports/devices?date=2026-06-17 and ?date=2026-06-24 (total 1.191M → 1.204M).",
              analysis: "Installed base grew ~1.1% across the window (iOS +0.8% / Android +1.4%) - healthy net acquisition, well clear of the 10% decline guard.",
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
              threshold: { key: "devices_optin_drop_pct", value: 10, kind: "drop", headroom: 4.4, breaching: false },
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
              threshold: { key: "devices_uninstall_rise_pct", value: 25, kind: "rise", headroom: 5.7, breaching: false },
              status: "ok",
              analysis: "Cumulative uninstalls 96K, up ~4% across the window within the 25% rise guard - normal churn, no spike.",
              series: [
                { t: "2026-06-18", v: 92 }, { t: "2026-06-19", v: 92 }, { t: "2026-06-20", v: 93 },
                { t: "2026-06-21", v: 94 }, { t: "2026-06-22", v: 94 }, { t: "2026-06-23", v: 95 }, { t: "2026-06-24", v: 96 },
              ],
            },
          ],
          thresholdSuggestions: [
            {
              key: "app_opens_drop_pct", current: 25, suggested: 35, direction: "loosen", basis: "volatility",
              rationale: "iOS/Android vs prev 30d swings ±30–40% around campaign windows; 2 candidates cleared without a real incident.",
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
          dismissedSuggestions: ["timeinapp_drop_pct"],
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
            { key: "app_opens_drop_android", severity: "danger", streak: 2, needed: 3, cause: "Android opens diverge from iOS by 38 pts (Android −44% vs iOS −6%) — cross-OS gap, so it needs 3 breaching runs; one more to confirm" },
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
              analysis: "Email volume up ~4% vs prev 30d at 2.40M sends - steady editorial cadence, no drop risk.",
              series: [
                { t: "2026-06-18", v: 330 }, { t: "2026-06-19", v: 335 }, { t: "2026-06-20", v: 342 },
                { t: "2026-06-21", v: 338 }, { t: "2026-06-22", v: 344 }, { t: "2026-06-23", v: 351 }, { t: "2026-06-24", v: 340 },
              ],
            },
            {
              // Cross-sourced: SparkPost leads (it is the system that delivered),
              // Airship stays visible under it. Both windows come from the same
              // source, so value/previous/delta never mix origins.
              key: "email_deliverability", label: "Email deliverability", group: "email", channel: "email", unit: "%",
              current: 98.6, previous: 98.8, deltaPts: -0.2,
              sources: {
                primary: "sparkpost",
                airship: { current: 98.6, previous: 98.8, deltaPts: -0.2 },
                sparkpost: { current: 98.62, previous: 98.91, deltaPts: -0.29 },
              },
              threshold: { key: "email_deliverability_min", value: 95, kind: "floor", headroom: 3.6, breaching: false },
              status: "ok",
              analysis: "SparkPost delivered 98.62% of injections (98.91% previously), 3.6 pts above the 95% floor - healthy sender reputation.",
              series: [
                { t: "2026-06-18", v: 98.9 }, { t: "2026-06-19", v: 98.8 }, { t: "2026-06-20", v: 98.7 },
                { t: "2026-06-21", v: 98.8 }, { t: "2026-06-22", v: 98.7 }, { t: "2026-06-23", v: 98.5 }, { t: "2026-06-24", v: 98.6 },
              ],
            },
            {
              key: "email_open_rate", label: "Email open rate", group: "email", channel: "email", unit: "%",
              current: 24.1, previous: 25.0, deltaPts: -0.9,
              threshold: { key: "email_open_rate_drop_pts", value: 4, kind: "drop", headroom: 4.1, breaching: false },
              status: "ok",
              analysis: "Open rate 24.1%, off 0.9 pts vs prev 30d but 4 pts clear of the drop guard - within normal month-to-month variation.",
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
              // Split out of the total bounce because the two demand OPPOSITE
              // fixes: hard means clean the list, soft means wait. Hard bounces
              // are also the type that gets a sender blocklisted.
              key: "email_hard_bounce_rate", label: "Hard bounce rate", group: "email", channel: "email", unit: "%",
              current: 0.44, previous: 0.38, deltaPts: 0.06,
              threshold: { key: "email_hard_bounce_rate_max", value: 0.5, kind: "ceiling", headroom: 0.06, breaching: false },
              status: "ok",
              analysis: "Hard bounces 0.44% against a 0.5% ceiling - close enough to watch; these are addresses that do not exist.",
            },
            {
              // Reputation, not list quality: the receiver refused on policy.
              key: "email_block_bounce_rate", label: "Block bounce rate", group: "email", channel: "email", unit: "%",
              current: 0.02, previous: 0.01, deltaPts: 0.01,
              threshold: { key: "email_block_bounce_rate_max", value: 0.1, kind: "ceiling", headroom: 0.08, breaching: false },
              status: "ok",
              analysis: "Block bounces 0.02% - no provider is refusing this domain on policy.",
            },
            {
              // Complements email_unsubscribe (a count) and the rise guard: a rate
              // that is high but STABLE never trips a rise threshold.
              key: "email_unsubscribe_rate", label: "Unsubscribe rate", group: "email", channel: "email", unit: "%",
              current: 0.29, previous: 0.24, deltaPts: 0.05,
              threshold: { key: "email_unsubscribe_rate_max", value: 0.5, kind: "ceiling", headroom: 0.21, breaching: false },
              status: "ok",
              analysis: "Unsubscribes 0.29% of deliveries, under the 0.5% ceiling but drifting up with the placement problem.",
            },
            {
              // RELATIVE guard, deliberately not a floor: CTOR separates
              // transactional mail from broadcast rather than healthy from broken,
              // and Apple MPP deflates the whole scale by pre-opening messages.
              key: "email_ctor", label: "Click-to-open rate", group: "email", channel: "email", unit: "%",
              current: 1.9, previous: 2.4, deltaPct: -20.8,
              threshold: { key: "email_ctor_drop_pct", value: 30, kind: "drop_pct", headroom: 9.2, breaching: false },
              status: "ok",
              analysis: "CTOR down 20.8% vs prev 30d - inside the 30% drop guard, but consistent with mail landing outside the inbox.",
            },
            {
              key: "email_unsubscribe", label: "Email unsubscribes", group: "email", channel: "email", unit: "count",
              current: 4200, previous: 3900, deltaPct: 7.7,
              threshold: { key: "email_unsubscribe_rise_pct", value: 25, kind: "rise", headroom: 22.3, breaching: false },
              status: "ok",
              analysis: "Unsubscribes up ~8% vs prev 30d, comfortably within the 25% rise guard - normal churn against a heavier send period.",
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
              // The two sources genuinely measure different things here (worst day vs
              // window average), which is exactly what `note` is for — the value is
              // never overwritten to make them agree.
              key: "email_delay_rate", label: "Email delay rate", group: "email", channel: "email", unit: "%",
              current: 38.9, previous: 6.2, deltaPts: 32.7,
              sources: {
                primary: "sparkpost",
                airship: { current: 38.9, previous: 6.2, deltaPts: 32.7 },
                sparkpost: { current: 41.2, previous: 5.9, deltaPts: 35.3 },
                note: "The Airship figure is the worst single day (Jun 23); the SparkPost one is the average across the whole window.",
              },
              threshold: { key: "email_delay_rate_max", value: 10, kind: "ceiling", headroom: -28.9, breaching: true },
              status: "confirmed",
              analysis: "41.2% of delivered mail was delayed across the window, up from 5.9% - Gmail throttling on the newsletter send. Airship's 38.9% is the worst single day (Jun 23), which is what the alert fired on.",
              series: [
                { t: "2026-06-18", v: 5.8 }, { t: "2026-06-19", v: 6.1 }, { t: "2026-06-20", v: 6.4 },
                { t: "2026-06-21", v: 7.0 }, { t: "2026-06-22", v: 9.2 }, { t: "2026-06-23", v: 38.9 }, { t: "2026-06-24", v: 22.5 },
              ],
            },
            {
              key: "app_opens", label: "App opens", group: "app", channel: "app", unit: "count",
              current: 88000, previous: 157000, deltaPct: -44,
              os: { ios: { deltaPct: -12 }, android: { deltaPct: -44 } },
              threshold: { key: "app_opens_drop_pct", value: 25, kind: "drop", headroom: -4, breaching: true },
              status: "candidate",
              analysis: "Android opens down 44% vs prev 30d past the drop guard while iOS holds (-12%) - one more breaching run to confirm; likely a low-content period.",
              series: [
                { t: "2026-06-18", v: 156 }, { t: "2026-06-19", v: 152 }, { t: "2026-06-20", v: 149 },
                { t: "2026-06-21", v: 140 }, { t: "2026-06-22", v: 120 }, { t: "2026-06-23", v: 98 }, { t: "2026-06-24", v: 88 },
              ],
            },
            {
              key: "timeinapp", label: "Time in app", group: "app", channel: "app", unit: "%",
              current: 142, previous: 150, deltaPct: -5.3,
              os: { ios: { deltaPct: -3.1 }, android: { deltaPct: -7.4 } },
              threshold: { key: "timeinapp_drop_pct", value: 15, kind: "drop", headroom: 14.7, breaching: false },
              status: "ok",
              analysis: "Session time off ~5% vs prev 30d, 15 pts clear of the drop guard - engagement depth holding despite the opens dip.",
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
              threshold: { key: "optin_optout_ratio_drop_pct", value: 20, kind: "drop", headroom: 3.2, breaching: false },
              status: "candidate",
              analysis: "iOS ratio down 27% vs prev 30d (0.82x, was 1.12x) while Android holds (-6%) - an iOS-specific reach dip, watching before it confirms.",
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
              threshold: { key: "total_devices_evolution_drop_pct", value: 10, kind: "drop" },
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
              threshold: { key: "devices_optin_drop_pct", value: 10, kind: "drop" },
              status: "ok",
              note: "Evolution n/a \u2014 window-start dated devices call not read this run.",
              analysis: "Opted-in base 486K (iOS 214K / Android 272K); the two-date \u0394 is pending the second dated call, but current reach is visible and healthy.",
            },
          ],
          // EMAIL, per sending domain. This project declares two domains: one
          // healthy marketing sender and one that is being throttled by Gmail.
          // The project rollup is recombined from their RAW COUNTS.
          emailSummary: {
            senderScore: 71, previousSenderScore: 88, senderGrade: "fair",
            activeDomainCount: 2,
            // Worst domain wins: a project is as exposed as its most exposed sender.
            placementRisk: {
              level: "high", domain: "news.sample-media.com",
              reasons: ["Open rate down 11.4 pts while delivery held at 98.3%."],
            },
          },
          emailDomains: [
            {
              domain: "news.sample-media.com", active: true,
              senderScore: 64, previousSenderScore: 86, senderGrade: "fair",
              rates: {
                injected: 2455000, delivered: 2421000, deliverability: 98.62,
                bounce: 0.81, hardBounce: 0.44, blockBounce: 0.02,
                spamComplaint: 0.031, unsubscribe: 0.29,
                delayRate: 20.4, delayRetriesPerDelivered: 0.63,
                openRate: 24.1, ctor: 1.9,
              },
              // Empirical, from SparkPost: which OTHER sending domains shared each
              // IP in the window. A pool NAME is not evidence — see SKILL.md.
              ips: [
                { ip: "192.0.2.41", pool: "sample_mkt", shared: false, coTenants: [], injected: 1840000 },
                { ip: "192.0.2.77", pool: "shared", shared: true, coTenants: 6, injected: 615000 },
              ],
              placementRisk: {
                level: "high",
                reasons: ["Open rate down 11.4 pts while delivery held at 98.3% — the gap between delivered and opened is the classic signature of filtering to the spam folder."],
              },
              deliverability: {
                source: "SparkPost Metrics API",
                window: "2026-05-26 \u2192 2026-06-24 (Europe/Paris)",
                fetchedAt: "2026-06-24 \u00b7 20:23 CEST",
                findings: [
                  {
                    severity: "danger",
                    title: "The delay is concentrated on Gmail, which is 48% of the volume",
                    detail:
                      "41% of Gmail mail was deferred on first attempt against 0.4\u20132% at every other provider. " +
                      "Gmail returns \"421-4.7.28 unusual rate of unsolicited mail\", a REPUTATION throttle: sending " +
                      "more slowly will not clear it, only engagement and list hygiene will.",
                  },
                  {
                    severity: "warning",
                    title: "Opens fell 11.4 pts while delivery held \u2014 placement, not acceptance",
                    detail:
                      "Delivery is steady at 98.6%, so receivers are still accepting the mail; they are increasingly " +
                      "filing it out of the inbox. No API reports placement directly without the paid add-on, which " +
                      "is why this is a risk flag rather than a measured rate.",
                  },
                ],
                // The deferral MIX is the actionable part of a delay rate.
                deferralClasses: [
                  { id: "reputation_spam", label: "Reputation \u00b7 unsolicited mail", severity: "danger", count: 402100, share: 80.4,
                    meaning: "Rate-limited on how recipients react. Slowing down does not clear it; engagement and hygiene do.",
                    domains: ["gmail.com"] },
                  { id: "mailbox_full", label: "Mailbox full", severity: "info", count: 96400, share: 19.3,
                    meaning: "Abandoned accounts. Age them out on repeated soft bounces.", domains: ["gmail.com"] },
                  { id: "reputation_volume", label: "Reputation \u00b7 volume spike", severity: "warning", count: 1120, share: 0.2,
                    meaning: "An abrupt volume change on the authenticated domain. Steady the daily volume.", domains: ["hotmail.fr"] },
                ],
                providers: [
                  { name: "Gmail", share: 48.3, injected: 1185000, deliveryRate: 98.31, delayRate: 41.2, bounceRate: 0.92, openRate: 22.4 },
                  { name: "Hotmail / Outlook", share: 21.7, injected: 532000, deliveryRate: 99.94, delayRate: 0.41, bounceRate: 0.35, openRate: 25.8 },
                  { name: "Apple", share: 12.4, injected: 304000, deliveryRate: 96.02, delayRate: 0.83, bounceRate: 3.91, openRate: 27.1 },
                  { name: "Yahoo", share: 9.1, injected: 223000, deliveryRate: 99.82, delayRate: 0.02, bounceRate: 0.17, openRate: 21.9 },
                ],
                receivingDomains: [
                  { name: "gmail.com", share: 48.3, injected: 1185000, deliveryRate: 98.31, bounceRate: 0.92 },
                  { name: "orange.fr", share: 7.2, injected: 176800, deliveryRate: 99.61, bounceRate: 0.28 },
                ],
                delayReasons: [
                  { domain: "gmail.com", count: 402100, classId: "reputation_spam", className: "Reputation \u00b7 unsolicited mail", classSeverity: "danger",
                    reason: "421-4.7.28 Gmail has detected an unusual rate of unsolicited mail originating from your IP address." },
                  { domain: "gmail.com", count: 96400, classId: "mailbox_full", className: "Mailbox full", classSeverity: "info",
                    reason: "452-4.2.2 The recipient's inbox is out of storage space." },
                  { domain: "hotmail.fr", count: 1120, classId: "reputation_volume", className: "Reputation \u00b7 volume spike", classSeverity: "warning",
                    reason: "451 4.7.650 The mail server has been temporarily rate limited due to IP reputation." },
                ],
                bounceClasses: [
                  { name: "Mailbox Full", category: "Soft", count: 14200 },
                  { name: "Invalid Recipient", category: "Hard", count: 3100 },
                  { name: "Mail Block", category: "Block", count: 480 },
                ],
                gmailReputation: { reason: "domain not yet shared with us in Postmaster Tools" },
              },
            },
            {
              // Declared but silent in the window: `na`, never `ok`. A sender that
              // stopped is not a sender that is healthy.
              domain: "tx.sample-media.com", active: false,
              senderScore: null, senderGrade: "na",
              rates: { injected: 0, delivered: 0 },
              placementRisk: { level: "na", reasons: [] },
            },
          ],
          thresholdSuggestions: [
            {
              key: "optin_optout_ratio_drop_pct", current: 20, suggested: 25, direction: "loosen", basis: "false_positives",
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
              threshold: { key: "app_opens_drop_pct", value: 25, kind: "drop", headroom: 41.9, breaching: false },
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
              key: "app_opens_drop_pct", current: 25, suggested: 20, direction: "tighten", basis: "headroom",
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
