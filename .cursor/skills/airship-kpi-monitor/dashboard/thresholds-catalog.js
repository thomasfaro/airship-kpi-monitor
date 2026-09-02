/*
 * Airship KPI Monitor — alert threshold catalog (committed, no data, no secrets).
 *
 * Single source of truth for the dashboard's per-project threshold editor. It
 * MUST mirror SKILL.md "Step 8 — Default thresholds". When you change a default
 * here, change it in SKILL.md too (and vice-versa).
 *
 * Dual-consumer format: the right-hand side of the assignment below is STRICT
 * JSON (double-quoted keys, no comments, no trailing commas) so that:
 *   - the browser loads it as a normal <script> (sets the global below), and
 *   - serve.py reads the same file, slices the object after the assignment, and
 *     json.loads() it — one source, both modes.
 *
 * Item fields: key (matches clients.yml custom_thresholds), label, group,
 * unit (percent, pts, or empty), default (number), hint (one line).
 */
window.AIRSHIP_KPI_THRESHOLDS = {
  "groups": [
    { "id": "app", "label": "App & engagement" },
    { "id": "push", "label": "Push" },
    { "id": "acquisition", "label": "Acquisition & opt-ins" },
    { "id": "email", "label": "Email" },
    { "id": "web", "label": "Web push" },
    { "id": "sms", "label": "SMS" },
    { "id": "minvol", "label": "Minimum volumes (anti false-positive)" },
    { "id": "confirm", "label": "Alert confirmation gate (anti false-positive)" },
    { "id": "insights", "label": "Weekly insights — top campaigns" }
  ],
  "items": [
    { "key": "app_opens_drop_pct", "label": "App opens drop", "group": "app", "unit": "%", "default": 25, "hint": "30d drop > X% on that OS -> alert (per OS)" },
    { "key": "app_opens_cross_os_gap_pts", "label": "App opens iOS/Android gap", "group": "app", "unit": "pts", "default": 30, "hint": "OR |iOS 30d delta - Android 30d delta| > X pts -> alert on BOTH OS" },
    { "key": "timeinapp_drop_pct", "label": "Time-in-app drop", "group": "app", "unit": "%", "default": 15, "hint": "Avg time-in-app drop > X% (per OS) -> alert" },
    { "key": "optin_optout_ratio_drop_pct", "label": "Opt-in/opt-out ratio drop", "group": "app", "unit": "%", "default": 20, "hint": "Avg daily opt-in/opt-out ratio in the current window drops > X% vs the previous window AND the within-window trend is also declining (per OS) -> alert" },

    { "key": "push_sends_drop_pct", "label": "Push sends drop", "group": "push", "unit": "%", "default": 100, "hint": "Drop > X% (per OS) -> alert; 100 = only when sends go to zero" },
    { "key": "push_pressure_per_user_max_30d", "label": "Push pressure ceiling (msg/user/30d)", "group": "push", "unit": "", "default": 60, "hint": "30d push sends (iOS+Android) / opted-in devices > X -> over-messaging ceiling (informational; sensible default ~2/day). RENAMED from push_pressure_per_user_max, which was per week" },
    { "key": "direct_response_rate_min", "label": "Click rate floor", "group": "push", "unit": "%", "default": 0.5, "hint": "Click rate (direct responses / sends) < X% in the current window -> alert (tracking-health)" },
    { "key": "direct_response_collapse_pct", "label": "Click rate collapse", "group": "push", "unit": "%", "default": 40, "hint": "30d drop of the click rate >= X% -> likely tracking/SDK issue" },

    { "key": "total_devices_evolution_drop_pct", "label": "Total devices evolution decline", "group": "acquisition", "unit": "%", "default": 10, "hint": "Strong decline > X% in TOTAL unique devices between the two dated /api/reports/devices calls (window start -> end, per OS + total) -> alert. Raised from 5 with the 30d window: drift accumulates over a longer span" },
    { "key": "devices_optin_drop_pct", "label": "Opted-in devices drop", "group": "acquisition", "unit": "%", "default": 10, "hint": "Opted-in devices drop > X% between the two dated devices calls (window start -> end, per OS) -> alert" },
    { "key": "devices_uninstall_rise_pct", "label": "Uninstalls rise", "group": "acquisition", "unit": "%", "default": 25, "hint": "Uninstalled devices rise > X% between the two dated devices calls (window start -> end, per OS) -> alert" },

    { "key": "email_sends_drop_pct", "label": "Email sends drop", "group": "email", "unit": "%", "default": 100, "hint": "Drop > X% -> alert; 100 = only when sends go to zero" },
    { "key": "email_deliverability_min", "label": "Email deliverability floor", "group": "email", "unit": "%", "default": 95, "hint": "SOURCE: SparkPost. FAST CHECK: per-day delivered/injected < X% on the last incident_days_consecutive days -> alert (never the 30d average)" },
    { "key": "email_open_rate_drop_pts", "label": "Email open-rate drop", "group": "email", "unit": "pts", "default": 4, "hint": "SOURCE: SparkPost (unique confirmed opens / delivered). Drop > X percentage points vs the previous 30 days -> alert" },
    { "key": "email_bounce_max", "label": "Email bounce ceiling", "group": "email", "unit": "%", "default": 2, "hint": "SOURCE: SparkPost. FAST CHECK: per-day bounce/injected > X% on the last incident_days_consecutive days -> alert (never the 30d average)" },
    { "key": "email_unsubscribe_rise_pct", "label": "Email unsubscribe rise", "group": "email", "unit": "%", "default": 25, "hint": "SOURCE: SparkPost. Rise > X% vs the previous 30 days -> alert" },
    { "key": "email_spam_complaint_rate_max", "label": "Email spam-complaint ceiling", "group": "email", "unit": "%", "default": 0.3, "hint": "SOURCE: SparkPost. FAST CHECK: daily spam_complaint/delivered > X% -> alert. Re-based from 1% to 0.3% on 2026-09-01: 0.3% is the limit Gmail and Yahoo ENFORCE on bulk senders (their 2024 requirements), so a 1% ceiling only fired long after the provider had already started filtering. 0.1% is the level to actually aim for" },
    { "key": "email_hard_bounce_rate_max", "label": "Email hard-bounce ceiling", "group": "email", "unit": "%", "default": 0.5, "hint": "SOURCE: SparkPost count_hard_bounce/injected. LIST QUALITY, and the bounce type that gets a sender blocklisted \u2014 it means the address does not exist. Split out from the total bounce rate because the two demand opposite fixes: hard bounces mean clean the list, soft bounces (mailbox full) mean wait" },
    { "key": "email_block_bounce_rate_max", "label": "Email block-bounce ceiling", "group": "email", "unit": "%", "default": 0.1, "hint": "SOURCE: SparkPost count_block_bounce/injected. REPUTATION: the receiver refused the mail on policy, not because the address is bad. Any sustained value means being actively blocked somewhere, which no volume or content change will fix on its own" },
    { "key": "email_unsubscribe_rate_max", "label": "Email unsubscribe ceiling", "group": "email", "unit": "%", "default": 0.5, "hint": "SOURCE: SparkPost count_unsubscribe/delivered. Complements the rise-based key: a rate that is high but STABLE never triggers a rise alert, yet still signals over-mailing or a mismatched audience" },
    { "key": "email_ctor_drop_pct", "label": "Click-to-open drop", "group": "email", "unit": "%", "default": 30, "hint": "SOURCE: SparkPost unique_clicked/unique_opened. RELATIVE, not a floor: measured across the fleet on 2026-09-01, CTOR separates transactional mail (8-62%) from marketing broadcast (0.2-2.4%), so any absolute floor fires on every marketing domain and tells a TAM nothing. Apple Mail Privacy Protection also pre-opens messages, inflating the denominator and pushing the whole scale down, which is why published CTOR benchmarks do not transfer. A DROP > X% vs the previous 30 days is the actionable signal" },
    { "key": "email_delay_rate_max", "label": "Email delay ceiling", "group": "email", "unit": "%", "default": 20, "hint": "SOURCE: SparkPost count_delayed_first/injected \u2014 share of messages DEFERRED ON THEIR FIRST ATTEMPT, bounded by 100%. NOT the old events-per-delivered ratio, which counted every retry and routinely exceeded 100% (Client Charlie measured 485%); the ceiling was re-based from 10 to 20 with the definition. FAST CHECK on the last incident_days_consecutive days" },
    { "key": "incident_days_consecutive", "label": "Incident confirm days", "group": "email", "unit": "", "default": 2, "hint": "Consecutive MOST RECENT days a per-day incident check must breach. Anchoring on the tail of the window keeps a finished incident from pinning an alert open for a month" },

    { "key": "web_sends_drop_pct", "label": "Web push sends drop", "group": "web", "unit": "%", "default": 100, "hint": "Drop > X% -> alert; 100 = only when sends go to zero (only if web devices > 0)" },
    { "key": "web_sends_rise_pct", "label": "Web push sends spike", "group": "web", "unit": "%", "default": 100, "hint": "Rise > X% -> alert (unexpected spike)" },

    { "key": "sms_sends_drop_pct", "label": "SMS sends drop", "group": "sms", "unit": "%", "default": 100, "hint": "30d drop > X% -> alert; 100 = only when sends go to zero (only if SMS channel active)" },
    { "key": "sms_sends_rise_pct", "label": "SMS sends spike", "group": "sms", "unit": "%", "default": 100, "hint": "30d rise > X% -> alert (unexpected spike)" },
    { "key": "min_push_sends", "label": "Min push sends", "group": "minvol", "unit": "", "default": 4000, "hint": "Per OS - skip push thresholds if prev 30d sends < X" },
    { "key": "min_email_sends", "label": "Min email sends", "group": "minvol", "unit": "", "default": 2000, "hint": "Skip email thresholds if prev 30d emails < X" },
    { "key": "min_email_delivery_day", "label": "Min daily email deliveries", "group": "minvol", "unit": "", "default": 100, "hint": "Skip the per-day incident checks (spam/delay/deliverability/bounce) if that day's deliveries < X. Per-day, so unchanged by the 30d switch" },
    { "key": "min_email_campaign_sends", "label": "Min email campaign sends", "group": "minvol", "unit": "", "default": 5000, "hint": "Min sends to include a campaign in delay correlation" },
    { "key": "min_optin_optout_volume", "label": "Min opt-in/opt-out volume", "group": "minvol", "unit": "", "default": 400, "hint": "Per OS - skip the opt-in/opt-out ratio threshold if prev 30d opt-in + opt-out volume < X" },
    { "key": "min_timeinapp", "label": "Min time-in-app", "group": "minvol", "unit": "", "default": 1, "hint": "Skip time-in-app threshold if prev avg < X (an average, so unchanged by the 30d switch)" },
    { "key": "min_sms_sends", "label": "Min SMS sends", "group": "minvol", "unit": "", "default": 400, "hint": "Skip SMS sends thresholds if prev 30d SMS sends < X" },
    { "key": "min_web_sends", "label": "Min web push sends", "group": "minvol", "unit": "", "default": 400, "hint": "Skip web push threshold if prev 30d web sends < X" },

    { "key": "alert_confirm_runs", "label": "Confirm after N runs", "group": "confirm", "unit": "", "default": 2, "hint": "Consecutive breaching runs before a breach is CONFIRMED (candidate -> confirmed). Counts RUNS, not days: at the intended weekly cadence 2 runs means 'still breaching a week later'" },
    { "key": "alert_resolve_runs", "label": "Resolve after N runs", "group": "confirm", "unit": "", "default": 2, "hint": "Consecutive non-breaching runs before a confirmed alert resolves (hysteresis prevents flapping)" },
    { "key": "alert_escalate_runs", "label": "Escalate after N runs", "group": "confirm", "unit": "", "default": 3, "hint": "Confirmed + critical + streak >= X -> eligible for a throttled Slack escalation (Step 10)" },
    { "key": "escalate_throttle_days", "label": "Escalation throttle (days)", "group": "confirm", "unit": "", "default": 14, "hint": "Min days between two Slack escalation posts for the same alert key. Raised from 7: at a weekly cadence a 7-day throttle allowed an escalation on every run" },
    { "key": "cadence_daily_ratio", "label": "Daily-sender cadence ratio", "group": "confirm", "unit": "", "default": 0.6, "hint": "Min active-send-day ratio (trailing 28d) to treat a channel as a daily sender; below this a zero-send window is expected -> zero-send drop suppressed" },

    { "key": "min_campaign_sends", "label": "Min campaign sends (30d)", "group": "insights", "unit": "", "default": 1000, "hint": "Ignore a campaign identity below X sends over 30d (top-campaigns section)" },
    { "key": "min_recurring_occurrences", "label": "Min recurring occurrences", "group": "insights", "unit": "", "default": 3, "hint": "Min occurrences to treat a series as automated/recurring" },
    { "key": "recurring_drift_pct", "label": "Recurring volume drift flag", "group": "insights", "unit": "%", "default": 50, "hint": "Flag a recurring series whose latest volume deviates > X% from its median" }
  ]
};
