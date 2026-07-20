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
    { "id": "custom", "label": "Custom events" },
    { "id": "minvol", "label": "Minimum volumes (anti false-positive)" },
    { "id": "confirm", "label": "Alert confirmation gate (anti false-positive)" },
    { "id": "insights", "label": "Weekly insights — top campaigns" }
  ],
  "items": [
    { "key": "app_opens_drop_pct", "label": "App opens drop", "group": "app", "unit": "%", "default": 40, "hint": "WoW drop > X% on that OS -> alert (per OS)" },
    { "key": "app_opens_cross_os_gap_pts", "label": "App opens iOS/Android gap", "group": "app", "unit": "pts", "default": 50, "hint": "OR |iOS WoW - Android WoW| > X pts -> alert on BOTH OS" },
    { "key": "timeinapp_drop_pct", "label": "Time-in-app drop", "group": "app", "unit": "%", "default": 20, "hint": "Avg time-in-app drop > X% (per OS) -> alert" },
    { "key": "optin_optout_ratio_drop_pct", "label": "Opt-in/opt-out ratio drop", "group": "app", "unit": "%", "default": 30, "hint": "Avg daily opt-in/opt-out ratio in the current window drops > X% vs the previous window AND the within-window trend is also declining (per OS) -> alert" },

    { "key": "push_sends_drop_pct", "label": "Push sends drop", "group": "push", "unit": "%", "default": 100, "hint": "Drop > X% (per OS) -> alert; 100 = only when sends go to zero" },
    { "key": "push_pressure_per_user_max", "label": "Push pressure ceiling (msg/user/wk)", "group": "push", "unit": "", "default": 14, "hint": "Weekly push sends (iOS+Android) / opted-in devices > X -> over-messaging ceiling (informational; sensible default ~2/day)" },
    { "key": "direct_response_rate_min", "label": "Click rate floor", "group": "push", "unit": "%", "default": 0.5, "hint": "Click rate (direct responses / sends) < X% in the current window -> alert (tracking-health)" },
    { "key": "direct_response_collapse_pct", "label": "Click rate collapse", "group": "push", "unit": "%", "default": 60, "hint": "WoW drop of the click rate >= X% -> likely tracking/SDK issue" },

    { "key": "total_devices_evolution_drop_pct", "label": "Total devices evolution decline", "group": "acquisition", "unit": "%", "default": 5, "hint": "Strong decline > X% in TOTAL unique devices between the two dated /api/reports/devices calls (window start -> end, per OS + total) -> alert" },
    { "key": "devices_optin_drop_pct", "label": "Opted-in devices drop", "group": "acquisition", "unit": "%", "default": 5, "hint": "Opted-in devices drop > X% between the two dated devices calls (window start -> end, per OS) -> alert" },
    { "key": "devices_uninstall_rise_pct", "label": "Uninstalls rise", "group": "acquisition", "unit": "%", "default": 10, "hint": "Uninstalled devices rise > X% between the two dated devices calls (window start -> end, per OS) -> alert" },

    { "key": "email_sends_drop_pct", "label": "Email sends drop", "group": "email", "unit": "%", "default": 100, "hint": "Drop > X% -> alert; 100 = only when sends go to zero" },
    { "key": "email_deliverability_min", "label": "Email deliverability floor", "group": "email", "unit": "%", "default": 95, "hint": "Delivery rate < X% -> alert (absolute)" },
    { "key": "email_open_rate_drop_pts", "label": "Email open-rate drop", "group": "email", "unit": "pts", "default": 5, "hint": "Drop > X percentage points -> alert" },
    { "key": "email_bounce_max", "label": "Email bounce ceiling", "group": "email", "unit": "%", "default": 2, "hint": "Bounce rate > X% -> alert (absolute)" },
    { "key": "email_unsubscribe_rise_pct", "label": "Email unsubscribe rise", "group": "email", "unit": "%", "default": 30, "hint": "Rise > X% -> alert" },
    { "key": "email_spam_complaint_rate_max", "label": "Email spam-complaint ceiling", "group": "email", "unit": "%", "default": 1, "hint": "Daily spam_complaint / delivery > X% -> alert" },
    { "key": "email_delay_rate_max", "label": "Email delay ceiling", "group": "email", "unit": "%", "default": 10, "hint": "Hourly delay / delivery > X% (per hour) — used in both daily pre-filter and hourly confirmation" },
    { "key": "email_delay_min_consecutive_hours", "label": "Email delay min consecutive hours", "group": "email", "unit": "", "default": 2, "hint": "Min consecutive hours above delay ceiling to fire alert (prevents single-hour spikes)" },

    { "key": "web_sends_drop_pct", "label": "Web push sends drop", "group": "web", "unit": "%", "default": 100, "hint": "Drop > X% -> alert; 100 = only when sends go to zero (only if web devices > 0)" },
    { "key": "web_sends_rise_pct", "label": "Web push sends spike", "group": "web", "unit": "%", "default": 100, "hint": "Rise > X% -> alert (unexpected spike)" },

    { "key": "sms_sends_drop_pct", "label": "SMS sends drop", "group": "sms", "unit": "%", "default": 100, "hint": "WoW drop > X% -> alert; 100 = only when sends go to zero (only if SMS channel active)" },
    { "key": "sms_sends_rise_pct", "label": "SMS sends spike", "group": "sms", "unit": "%", "default": 100, "hint": "WoW rise > X% -> alert (unexpected spike)" },
    { "key": "sms_delivery_rate_min", "label": "SMS delivery-rate floor", "group": "sms", "unit": "%", "default": 85, "hint": "delivered/dispatched < X% -> alert" },
    { "key": "sms_delivery_rate_drop_pts", "label": "SMS delivery-rate drop", "group": "sms", "unit": "pts", "default": 10, "hint": "Delivery rate drops > X percentage points -> alert" },

    { "key": "custom_event_rise_pct", "label": "Custom event rise", "group": "custom", "unit": "%", "default": 50, "hint": "Rise > X% -> alert" },
    { "key": "custom_event_drop_pct", "label": "Custom event drop", "group": "custom", "unit": "%", "default": 50, "hint": "Drop > X% -> alert" },

    { "key": "min_push_sends", "label": "Min push sends", "group": "minvol", "unit": "", "default": 1000, "hint": "Per OS - skip push thresholds if prev 7d sends < X" },
    { "key": "min_email_sends", "label": "Min email sends", "group": "minvol", "unit": "", "default": 500, "hint": "Skip email thresholds if prev 7d emails < X" },
    { "key": "min_email_delivery_day", "label": "Min daily email deliveries", "group": "minvol", "unit": "", "default": 100, "hint": "Skip daily spam/delay check if that day's deliveries < X" },
    { "key": "min_email_campaign_sends", "label": "Min email campaign sends", "group": "minvol", "unit": "", "default": 5000, "hint": "Min sends to include a campaign in delay correlation" },
    { "key": "min_custom_event_count", "label": "Min custom event count", "group": "minvol", "unit": "", "default": 200, "hint": "Skip custom event threshold if prev count < X" },
    { "key": "min_optin_optout_volume", "label": "Min opt-in/opt-out volume", "group": "minvol", "unit": "", "default": 100, "hint": "Per OS - skip the opt-in/opt-out ratio threshold if prev 7d opt-in + opt-out volume < X" },
    { "key": "min_timeinapp", "label": "Min time-in-app", "group": "minvol", "unit": "", "default": 1, "hint": "Skip time-in-app threshold if prev avg < X" },
    { "key": "min_sms_sends", "label": "Min SMS sends", "group": "minvol", "unit": "", "default": 100, "hint": "Skip SMS sends thresholds if prev 7d SMS sends < X" },
    { "key": "min_sms_dispatched", "label": "Min SMS dispatched", "group": "minvol", "unit": "", "default": 50, "hint": "Skip SMS delivery-rate threshold if prev 7d dispatched < X" },
    { "key": "min_web_sends", "label": "Min web push sends", "group": "minvol", "unit": "", "default": 100, "hint": "Skip web push threshold if prev 7d web sends < X" },

    { "key": "alert_confirm_runs", "label": "Confirm after N runs", "group": "confirm", "unit": "", "default": 2, "hint": "Consecutive breaching runs before a breach is CONFIRMED (candidate -> confirmed). Urgent metrics confirm in 1, noisy ones in 3 (see SKILL.md Step 8a)" },
    { "key": "alert_resolve_runs", "label": "Resolve after N runs", "group": "confirm", "unit": "", "default": 2, "hint": "Consecutive non-breaching runs before a confirmed alert resolves (hysteresis prevents flapping)" },
    { "key": "alert_escalate_runs", "label": "Escalate after N runs", "group": "confirm", "unit": "", "default": 3, "hint": "Confirmed + critical + streak >= X -> eligible for a throttled Slack escalation (Step 10)" },
    { "key": "escalate_throttle_days", "label": "Escalation throttle (days)", "group": "confirm", "unit": "", "default": 7, "hint": "Min days between two Slack escalation posts for the same alert key" },
    { "key": "cadence_daily_ratio", "label": "Daily-sender cadence ratio", "group": "confirm", "unit": "", "default": 0.6, "hint": "Min active-send-day ratio (trailing 28d) to treat a channel as a daily sender; below this a zero-send window is expected -> zero-send drop suppressed" },

    { "key": "min_campaign_sends", "label": "Min campaign sends (30d)", "group": "insights", "unit": "", "default": 1000, "hint": "Ignore a campaign identity below X sends over 30d (top-campaigns section)" },
    { "key": "min_recurring_occurrences", "label": "Min recurring occurrences", "group": "insights", "unit": "", "default": 3, "hint": "Min occurrences to treat a series as automated/recurring" },
    { "key": "recurring_drift_pct", "label": "Recurring volume drift flag", "group": "insights", "unit": "%", "default": 50, "hint": "Flag a recurring series whose latest volume deviates > X% from its median" }
  ]
};
