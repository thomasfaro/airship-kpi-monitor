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
    { "id": "devices", "label": "Devices" },
    { "id": "push", "label": "Push (mobile)" },
    { "id": "acquisition", "label": "Acquisition / opt-ins" },
    { "id": "email", "label": "Email" },
    { "id": "web", "label": "Web push" },
    { "id": "sms", "label": "SMS" },
    { "id": "custom", "label": "Custom events" },
    { "id": "minvol", "label": "Minimum volumes (anti false-positive)" }
  ],
  "items": [
    { "key": "app_opens_drop_pct", "label": "App opens drop", "group": "app", "unit": "%", "default": 40, "hint": "WoW drop > X% on that OS -> alert (per OS)" },
    { "key": "app_opens_cross_os_gap_pts", "label": "App opens iOS/Android gap", "group": "app", "unit": "pts", "default": 50, "hint": "OR |iOS WoW - Android WoW| > X pts -> alert on BOTH OS" },
    { "key": "timeinapp_drop_pct", "label": "Time-in-app drop", "group": "app", "unit": "%", "default": 20, "hint": "Avg time-in-app drop > X% (per OS) -> alert" },

    { "key": "devices_unique_drop_pct", "label": "Unique devices drop", "group": "devices", "unit": "%", "default": 5, "hint": "Drop > X% vs canvas D-7 snapshot (per OS) -> alert" },
    { "key": "devices_optin_drop_pct", "label": "Opted-in devices drop", "group": "devices", "unit": "%", "default": 5, "hint": "Drop > X% vs canvas D-7 snapshot (per OS) -> alert" },
    { "key": "devices_uninstall_rise_pct", "label": "Uninstalls rise", "group": "devices", "unit": "%", "default": 10, "hint": "Rise > X% vs canvas D-7 snapshot (per OS) -> alert" },

    { "key": "push_sends_drop_pct", "label": "Push sends drop", "group": "push", "unit": "%", "default": 100, "hint": "Drop > X% (per OS) -> alert; 100 = only when sends go to zero" },
    { "key": "optouts_rise_pct", "label": "Push opt-outs rise", "group": "push", "unit": "%", "default": 20, "hint": "Opt-out raw count rise > X% (per OS) -> alert" },
    { "key": "direct_response_rate_min", "label": "Direct response rate floor", "group": "push", "unit": "%", "default": 0.5, "hint": "Current-window rate < X% -> alert (tracking-health)" },
    { "key": "direct_response_collapse_pct", "label": "Direct response collapse", "group": "push", "unit": "%", "default": 60, "hint": "WoW drop of the response RATE >= X% -> likely tracking/SDK issue" },

    { "key": "optins_drop_pct", "label": "Opt-ins drop", "group": "acquisition", "unit": "%", "default": 25, "hint": "New opt-ins drop > X% (per OS) -> alert" },

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
    { "key": "min_optins", "label": "Min opt-ins", "group": "minvol", "unit": "", "default": 100, "hint": "Per OS - skip opt-in thresholds if prev 7d opt-ins < X" },
    { "key": "min_timeinapp", "label": "Min time-in-app", "group": "minvol", "unit": "", "default": 1, "hint": "Skip time-in-app threshold if prev avg < X" },
    { "key": "min_sms_sends", "label": "Min SMS sends", "group": "minvol", "unit": "", "default": 100, "hint": "Skip SMS sends thresholds if prev 7d SMS sends < X" },
    { "key": "min_sms_dispatched", "label": "Min SMS dispatched", "group": "minvol", "unit": "", "default": 50, "hint": "Skip SMS delivery-rate threshold if prev 7d dispatched < X" },
    { "key": "min_web_sends", "label": "Min web push sends", "group": "minvol", "unit": "", "default": 100, "hint": "Skip web push threshold if prev 7d web sends < X" }
  ]
};
