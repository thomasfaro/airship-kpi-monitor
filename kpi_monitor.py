#!/usr/bin/env python3
"""
airship-kpi-monitor — Daily Rolling Window KPI Check
Implements SKILL.md using direct Airship Reports API + Slack API calls.

Required environment variables (set via Cursor Secrets):
  AIRSHIP_APP_KEY        Airship project app key
  AIRSHIP_CLIENT_ID      OAuth client ID (scope: rpt + tpl)
  AIRSHIP_CLIENT_SECRET  OAuth client secret
  AIRSHIP_REGION         "eu" or "us"
  SLACK_BOT_TOKEN        Slack bot token (scopes: chat:write, canvases:read, canvases:write)

Run:
  python3 kpi_monitor.py
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import date, timedelta
from typing import Any

import requests

# ─────────────────────────────────────────────────────────────────────────────
# Parameters
# ─────────────────────────────────────────────────────────────────────────────
CLIENT_NAME = "MAAF PROD"
BRAND_NAME = "MAAF"
SLACK_CHANNEL_ID = "CSR86DJ1H"
SLACK_CANVAS_ID = "F0BCF77RX0E"
CANVAS_URL = f"https://app.slack.com/docs/{SLACK_CANVAS_ID}"
ALERT_LANG = "fr"

# ─────────────────────────────────────────────────────────────────────────────
# Credentials (from environment / Cursor Secrets)
# ─────────────────────────────────────────────────────────────────────────────
AIRSHIP_APP_KEY       = os.environ.get("AIRSHIP_APP_KEY", "")
AIRSHIP_CLIENT_ID     = os.environ.get("AIRSHIP_CLIENT_ID", "")
AIRSHIP_CLIENT_SECRET = os.environ.get("AIRSHIP_CLIENT_SECRET", "")
AIRSHIP_REGION        = os.environ.get("AIRSHIP_REGION", "eu").lower()
SLACK_BOT_TOKEN       = os.environ.get("SLACK_BOT_TOKEN", "")

_REGION_URLS = {
    "eu": ("https://go.airship.eu",      "https://oauth2.asnapius.com/token"),
    "us": ("https://go.airship.com",     "https://oauth2.airship.com/token"),
}
AIRSHIP_BASE_URL, AIRSHIP_OAUTH_URL = _REGION_URLS.get(
    AIRSHIP_REGION, _REGION_URLS["eu"]
)

# ─────────────────────────────────────────────────────────────────────────────
# Default thresholds
# ─────────────────────────────────────────────────────────────────────────────
T = {
    "app_opens_drop_pct":           20,
    "timeinapp_drop_pct":           20,
    "devices_unique_drop_pct":       5,
    "devices_optin_drop_pct":        5,
    "devices_uninstall_rise_pct":   10,
    "push_sends_drop_pct":          30,
    "optouts_rise_pct":             20,
    "direct_response_rate_min":      0.5,
    "direct_response_collapse_pct": 60,
    "optins_drop_pct":              25,
    "email_sends_drop_pct":         20,
    "email_deliverability_min":     95,
    "email_open_rate_drop_pts":      5,
    "email_bounce_max":              2,
    "email_unsubscribe_rise_pct":   30,
    "web_sends_drop_pct":           30,
    "web_sends_rise_pct":          100,
    "sms_sends_drop_pct":           30,
    "sms_sends_rise_pct":          100,
    "sms_delivery_rate_min":        85,
    "sms_delivery_rate_drop_pts":   10,
    "custom_event_rise_pct":        50,
    "custom_event_drop_pct":        50,
    "min_push_sends":             1000,
    "min_email_sends":             500,
    "min_custom_event_count":      200,
    "min_optins":                  100,
    "min_timeinapp":                 1,
    "min_sms_sends":               100,
    "min_sms_dispatched":           50,
    "min_web_sends":               100,
}

# ─────────────────────────────────────────────────────────────────────────────
# i18n strings (fr)
# ─────────────────────────────────────────────────────────────────────────────
I18N: dict[str, dict[str, str]] = {
    "alert_header":      {"fr": "🔴 Alerte KPI — {client} — {start} → {end}",
                          "en": "🔴 KPI Alert — {client} — {start} → {end}"},
    "resolved_header":   {"fr": "✅ KPI Résolu — {client} — {today}",
                          "en": "✅ KPI Resolved — {client} — {today}"},
    "resolved_body":     {"fr": "{kpi} ({os}) est revenu dans la plage normale.",
                          "en": "{kpi} ({os}) is back within normal range."},
    "no_cause":          {"fr": "Aucune cause clairement identifiée. Vérifier le calendrier des campagnes.",
                          "en": "No clear cause identified from available data. Recommend checking campaign calendar."},
    "source_footer":     {"fr": "_(Source : Airship Reports API · [📊 Canvas KPI]({url}))_",
                          "en": "_(Source: Airship Reports API · [📊 KPI Canvas]({url}))_"},
    "possible_cause":    {"fr": "🔍 **Cause possible :** {cause}",
                          "en": "🔍 **Possible cause:** {cause}"},
    "section_app":       {"fr": "**Application & Engagement** _(source : /api/reports/opens, /api/reports/timeinapp)_",
                          "en": "**App & Engagement** _(source: /api/reports/opens, /api/reports/timeinapp)_"},
    "section_push":      {"fr": "**Push mobile** _(source : /api/reports/sends, /api/reports/optouts, /api/reports/responses)_",
                          "en": "**Mobile Push** _(source: /api/reports/sends, /api/reports/optouts, /api/reports/responses)_"},
    "section_acq":       {"fr": "**Acquisition** _(source : /api/reports/optins + /api/reports/optouts)_",
                          "en": "**Acquisition** _(source: /api/reports/optins + /api/reports/optouts)_"},
    "section_email":     {"fr": "**Email** _(source : /api/reports/events)_",
                          "en": "**Email** _(source: /api/reports/events)_"},
    "section_webpush":   {"fr": "**Web push** _(source : /api/reports/sends)_",
                          "en": "**Web push** _(source: /api/reports/sends)_"},
    "section_sms":       {"fr": "**SMS** _(source : /api/reports/sends + /api/reports/events)_",
                          "en": "**SMS** _(source: /api/reports/sends + /api/reports/events)_"},
    "section_devices":   {"fr": "**Parc installé** _(source : /api/reports/devices)_",
                          "en": "**Devices** _(source: /api/reports/devices)_"},
    "section_custom":    {"fr": "**Événements personnalisés** _(source : /api/reports/events)_",
                          "en": "**Custom Events** _(source: /api/reports/events)_"},
}

def t(key: str) -> str:
    return I18N.get(key, {}).get(ALERT_LANG, I18N.get(key, {}).get("en", key))

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
_log_lines: list[str] = []

def log(msg: str) -> None:
    print(msg, flush=True)
    _log_lines.append(msg)

# ─────────────────────────────────────────────────────────────────────────────
# Step 0 — Date windows
# ─────────────────────────────────────────────────────────────────────────────
def compute_windows() -> dict[str, date]:
    today     = date.today()
    yesterday = today - timedelta(days=1)
    return {
        "today":                  today,
        "yesterday":              yesterday,
        "current_window_start":   yesterday - timedelta(days=6),
        "current_window_end":     yesterday,
        "previous_window_start":  yesterday - timedelta(days=13),
        "previous_window_end":    yesterday - timedelta(days=7),
    }

# ─────────────────────────────────────────────────────────────────────────────
# Airship authentication
# ─────────────────────────────────────────────────────────────────────────────
_airship_token: str | None = None

def airship_token() -> str:
    global _airship_token
    if _airship_token:
        return _airship_token
    if not (AIRSHIP_CLIENT_ID and AIRSHIP_CLIENT_SECRET):
        raise RuntimeError(
            "Missing AIRSHIP_CLIENT_ID or AIRSHIP_CLIENT_SECRET. "
            "Add them via Cursor Secrets (Cloud Agents > Secrets)."
        )
    r = requests.post(
        AIRSHIP_OAUTH_URL,
        auth=(AIRSHIP_CLIENT_ID, AIRSHIP_CLIENT_SECRET),
        data={"grant_type": "client_credentials", "scope": "rpt"},
        timeout=30,
    )
    r.raise_for_status()
    _airship_token = r.json()["access_token"]
    return _airship_token


def airship_get(path: str, params: dict | None = None) -> Any:
    """Call Airship Reports API with retry on 401."""
    if not AIRSHIP_APP_KEY:
        raise RuntimeError(
            "Missing AIRSHIP_APP_KEY. Add it via Cursor Secrets."
        )
    headers = {
        "Authorization": f"Bearer {airship_token()}",
        "X-UA-Appkey": AIRSHIP_APP_KEY,
        "Accept": "application/vnd.urbanairship+json; version=3",
    }
    url = f"{AIRSHIP_BASE_URL}{path}"
    r = requests.get(url, headers=headers, params=params or {}, timeout=30)
    if r.status_code in (401, 403):
        log(f"scope unavailable: {path} (HTTP {r.status_code})")
        return None
    r.raise_for_status()
    return r.json()

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def fmt_date(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def delta_pct(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return (current - previous) / previous * 100


def fmt_delta(pct: float | None, decimals: int = 1) -> str:
    if pct is None:
        return "n/a"
    arrow = "⬆️" if pct > 0 else ("⬇️" if pct < 0 else "→")
    sign  = "+" if pct > 0 else ""
    return f"{arrow} {sign}{pct:.{decimals}f}%"


def fmt_num(n: float | None, unit: str = "") -> str:
    if n is None:
        return "n/a"
    if n >= 1_000_000:
        return f"{n/1_000_000:.2f}M{unit}"
    if n >= 1_000:
        return f"{n/1_000:.1f}K{unit}"
    return f"{n:.0f}{unit}"


def sum_field(rows: list[dict], os_key: str, field: str) -> float:
    total = 0.0
    for row in rows:
        val = row.get(os_key, {})
        if isinstance(val, dict):
            total += val.get(field, 0) or 0
        elif isinstance(val, (int, float)):
            total += val or 0
    return total


def split_windows(
    rows: list[dict], windows: dict[str, date]
) -> tuple[list[dict], list[dict]]:
    """Split daily rows into current and previous windows by date field."""
    cur_start = windows["current_window_start"]
    cur_end   = windows["current_window_end"]
    prv_start = windows["previous_window_start"]
    prv_end   = windows["previous_window_end"]
    current, previous = [], []
    for row in rows:
        row_date_str = row.get("date") or row.get("start_date", "")
        if not row_date_str:
            continue
        try:
            row_date = date.fromisoformat(row_date_str[:10])
        except ValueError:
            continue
        if cur_start <= row_date <= cur_end:
            current.append(row)
        elif prv_start <= row_date <= prv_end:
            previous.append(row)
    return current, previous

# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Fetch sends / opens / optins / optouts (14 days DAILY)
# ─────────────────────────────────────────────────────────────────────────────
def fetch_step1(windows: dict[str, date]) -> dict[str, Any]:
    prv_start = fmt_date(windows["previous_window_start"])
    cur_end   = fmt_date(windows["current_window_end"])
    params    = {"start": prv_start, "end": cur_end, "precision": "DAILY"}
    endpoints = {
        "sends":   "/api/reports/sends",
        "opens":   "/api/reports/opens",
        "optins":  "/api/reports/optins",
        "optouts": "/api/reports/optouts",
    }
    raw: dict[str, Any] = {}
    for key, path in endpoints.items():
        data = airship_get(path, params)
        if data is None:
            log(f"scope unavailable: {path}")
            raw[key] = []
            continue
        rows = data.get(key, data.get("counts", data.get("sends", [])))
        if isinstance(rows, dict):
            rows = rows.get("counts", [])
        raw[key] = rows if isinstance(rows, list) else []
        log(f"  {path}: {len(raw[key])} rows")
    return raw


def aggregate_step1(raw: dict[str, Any], windows: dict[str, date]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, rows in raw.items():
        cur_rows, prv_rows = split_windows(rows, windows)
        result[key] = {"current": cur_rows, "previous": prv_rows}
    return result

# ─────────────────────────────────────────────────────────────────────────────
# Step 2 & 3 — Fetch events (email system events + custom events)
# ─────────────────────────────────────────────────────────────────────────────
EMAIL_SYSTEM_EVENTS = {
    "injection", "delivery", "open", "initial_open",
    "click", "bounce", "unsubscribe", "spam_complaint",
}
IGNORED_LOCATIONS = {
    "in_app_message", "in_app_pager", "ua_mcrap", "ua_interactive_notification"
}
IGNORED_CUSTOM_NAMES = {
    "injection", "delivery", "open", "initial_open", "click",
    "bounce", "unsubscribe", "spam_complaint", "delay", "media_played",
}


def fetch_events(start: date, end: date) -> list[dict]:
    params   = {
        "start":      fmt_date(start),
        "end":        fmt_date(end),
        "precision":  "MONTHLY",
        "page_size":  100,
    }
    all_events: list[dict] = []
    page = 0
    while True:
        data = airship_get("/api/reports/events", params)
        if data is None:
            break
        events = data.get("events", [])
        all_events.extend(events)
        page += 1
        next_page = data.get("next_page")
        if not next_page or page >= 20:
            if page >= 20 and next_page:
                log("warning: events pagination exceeded 20 pages, stopping")
            break
        params["page"] = page + 1
        if "page" in data:
            params["page"] = data["page"] + 1
    return all_events


def parse_events(events: list[dict]) -> tuple[dict[str, int], dict[str, int]]:
    """Returns (email_events_by_name, custom_events_by_name) with counts."""
    email_counts:  dict[str, int] = {}
    custom_counts: dict[str, int] = {}
    for ev in events:
        location = ev.get("location", "")
        name     = ev.get("name", "")
        count    = int(ev.get("count", 0) or 0)
        if location in IGNORED_LOCATIONS:
            continue
        if name in EMAIL_SYSTEM_EVENTS:
            email_counts[name] = email_counts.get(name, 0) + count
        elif name not in IGNORED_CUSTOM_NAMES:
            custom_counts[name] = custom_counts.get(name, 0) + count
    return email_counts, custom_counts

# ─────────────────────────────────────────────────────────────────────────────
# Step 4 — Fetch direct responses
# ─────────────────────────────────────────────────────────────────────────────
def fetch_responses(windows: dict[str, date]) -> dict[str, Any]:
    params = {
        "start":     fmt_date(windows["previous_window_start"]),
        "end":       fmt_date(windows["current_window_end"]),
        "precision": "DAILY",
    }
    data = airship_get("/api/reports/responses", params)
    if data is None:
        return {"current": [], "previous": []}
    rows = data.get("responses", data.get("counts", []))
    if not isinstance(rows, list):
        rows = []
    cur, prv = split_windows(rows, windows)
    return {"current": cur, "previous": prv}

# ─────────────────────────────────────────────────────────────────────────────
# Step 5 — Fetch time in app
# ─────────────────────────────────────────────────────────────────────────────
def fetch_timeinapp(windows: dict[str, date]) -> dict[str, Any] | None:
    params = {
        "start":     fmt_date(windows["previous_window_start"]),
        "end":       fmt_date(windows["current_window_end"]),
        "precision": "DAILY",
    }
    data = airship_get("/api/reports/timeinapp", params)
    if data is None:
        log("scope unavailable: /api/reports/timeinapp")
        return None
    rows = data.get("timeinapp", data.get("counts", []))
    if not isinstance(rows, list):
        return None
    cur, prv = split_windows(rows, windows)
    return {"current": cur, "previous": prv}

# ─────────────────────────────────────────────────────────────────────────────
# Step 6 — Fetch devices snapshot
# ─────────────────────────────────────────────────────────────────────────────
def fetch_devices() -> dict[str, Any]:
    data = airship_get("/api/reports/devices")
    if data is None:
        return {}
    counts = data.get("counts", data)
    return counts

# ─────────────────────────────────────────────────────────────────────────────
# Step 7 — Read canvas state
# ─────────────────────────────────────────────────────────────────────────────
def slack_request(method: str, endpoint: str, payload: dict) -> dict | None:
    if not SLACK_BOT_TOKEN:
        log("warning: SLACK_BOT_TOKEN not set — Slack operations skipped")
        return None
    headers = {
        "Authorization": f"Bearer {SLACK_BOT_TOKEN}",
        "Content-Type":  "application/json; charset=utf-8",
    }
    url = f"https://slack.com/api/{endpoint}"
    try:
        if method.upper() == "GET":
            r = requests.get(url, headers=headers, params=payload, timeout=30)
        else:
            r = requests.post(url, headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        result = r.json()
        if not result.get("ok"):
            log(f"Slack API error [{endpoint}]: {result.get('error')}")
            return None
        return result
    except Exception as e:
        log(f"Slack request failed [{endpoint}]: {e}")
        return None


def read_canvas(canvas_id: str) -> str | None:
    if not canvas_id:
        return None
    result = slack_request("GET", "canvases.sections.lookup", {
        "canvas_id": canvas_id,
        "criteria":  json.dumps([{"section_types": ["any_header"]}]),
    })
    if result:
        sections = result.get("sections", [])
        content_parts = [s.get("markdown", "") for s in sections if s.get("markdown")]
        if content_parts:
            return "\n".join(content_parts)
    result2 = slack_request("GET", "files.info", {"file": canvas_id})
    if result2:
        file_info = result2.get("file", {})
        content = file_info.get("plain_text", "") or file_info.get("content", "")
        if content:
            return content
    return None


def parse_canvas_state(canvas_text: str | None, windows: dict[str, date]) -> dict[str, Any]:
    """Extract D-7 device snapshot and open alerts from canvas markdown."""
    state: dict[str, Any] = {
        "open_alerts": [],
        "d7_devices":  {},
    }
    if not canvas_text:
        return state

    d7_date_str = fmt_date(windows["current_window_start"])

    for line in canvas_text.splitlines():
        if d7_date_str in line and "|" in line:
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 6:
                try:
                    state["d7_devices"] = {
                        "ios_unique":          _parse_num(parts[1]) if len(parts) > 1 else None,
                        "ios_opted_in":        _parse_num(parts[2]) if len(parts) > 2 else None,
                        "ios_uninstalled":     _parse_num(parts[3]) if len(parts) > 3 else None,
                        "android_unique":      _parse_num(parts[4]) if len(parts) > 4 else None,
                        "android_opted_in":    _parse_num(parts[5]) if len(parts) > 5 else None,
                        "android_uninstalled": _parse_num(parts[6]) if len(parts) > 6 else None,
                    }
                except Exception:
                    pass

        if "| " in line and len(line.split("|")) >= 5:
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 5 and parts[1] and "_" in parts[1]:
                state["open_alerts"].append({
                    "key":       parts[1],
                    "os":        parts[2] if len(parts) > 2 else "",
                    "opened":    parts[3] if len(parts) > 3 else "",
                    "last_seen": parts[4] if len(parts) > 4 else "",
                })

    return state


def _parse_num(s: str) -> float | None:
    s = s.strip().replace(",", "").replace(" ", "")
    if not s or s in ("-", "n/a", "—"):
        return None
    for suffix, mult in [("M", 1e6), ("K", 1e3)]:
        if s.endswith(suffix):
            try:
                return float(s[:-1]) * mult
            except ValueError:
                return None
    try:
        return float(s)
    except ValueError:
        return None

# ─────────────────────────────────────────────────────────────────────────────
# Step 8 — Compute deltas and evaluate thresholds
# ─────────────────────────────────────────────────────────────────────────────
def compute_metrics(
    step1:       dict[str, Any],
    events_cur:  dict[str, int],
    events_prv:  dict[str, int],
    custom_cur:  dict[str, int],
    custom_prv:  dict[str, int],
    responses:   dict[str, Any],
    timeinapp:   dict[str, Any] | None,
    devices_now: dict[str, Any],
    canvas_state: dict[str, Any],
    windows:     dict[str, date],
) -> dict[str, Any]:
    m: dict[str, Any] = {}

    def _sum_os(rows: list[dict], os_key: str) -> float:
        total = 0.0
        for row in rows:
            v = row.get(os_key)
            if isinstance(v, dict):
                total += v.get("count", v.get("value", 0)) or 0
            elif isinstance(v, (int, float)):
                total += v or 0
        return total

    def _sum_direct(rows: list[dict], os_key: str) -> float:
        total = 0.0
        for row in rows:
            v = row.get(os_key, {})
            if isinstance(v, dict):
                total += v.get("direct", 0) or 0
        return total

    def _avg_os(rows: list[dict], os_key: str) -> float | None:
        vals = []
        for row in rows:
            v = row.get(os_key)
            if isinstance(v, (int, float)) and v is not None:
                vals.append(float(v))
            elif isinstance(v, dict):
                sub = v.get("value", v.get("count"))
                if sub is not None:
                    vals.append(float(sub))
        return sum(vals) / len(vals) if vals else None

    sends_cur = step1["sends"]["current"]
    sends_prv = step1["sends"]["previous"]
    opens_cur = step1["opens"]["current"]
    opens_prv = step1["opens"]["previous"]
    opts_cur  = step1["optouts"]["current"]
    opts_prv  = step1["optouts"]["previous"]
    opti_cur  = step1["optins"]["current"]
    opti_prv  = step1["optins"]["previous"]

    for os_key in ("ios", "android"):
        sc = _sum_os(sends_cur, os_key)
        sp = _sum_os(sends_prv, os_key)
        oc = _sum_os(opens_cur, os_key)
        op = _sum_os(opens_prv, os_key)
        xc = _sum_os(opts_cur,  os_key)
        xp = _sum_os(opts_prv,  os_key)
        ic = _sum_os(opti_cur,  os_key)
        ip = _sum_os(opti_prv,  os_key)
        dc = _sum_direct(responses["current"],  os_key)
        dp = _sum_direct(responses["previous"], os_key)

        m[f"sends_{os_key}_cur"]    = sc
        m[f"sends_{os_key}_prv"]    = sp
        m[f"opens_{os_key}_cur"]    = oc
        m[f"opens_{os_key}_prv"]    = op
        m[f"optouts_{os_key}_cur"]  = xc
        m[f"optouts_{os_key}_prv"]  = xp
        m[f"optins_{os_key}_cur"]   = ic
        m[f"optins_{os_key}_prv"]   = ip
        m[f"direct_{os_key}_cur"]   = dc
        m[f"direct_{os_key}_prv"]   = dp
        m[f"net_optin_{os_key}_cur"] = ic - xc
        m[f"net_optin_{os_key}_prv"] = ip - xp

        m[f"optout_rate_{os_key}_cur"] = (xc / sc * 100) if sc > 0 else None
        m[f"optout_rate_{os_key}_prv"] = (xp / sp * 100) if sp > 0 else None
        m[f"dr_rate_{os_key}_cur"]     = (dc / sc * 100) if sc > 0 else None
        m[f"dr_rate_{os_key}_prv"]     = (dp / sp * 100) if sp > 0 else None

        if timeinapp:
            m[f"tia_{os_key}_cur"] = _avg_os(timeinapp["current"],  os_key)
            m[f"tia_{os_key}_prv"] = _avg_os(timeinapp["previous"], os_key)
        else:
            m[f"tia_{os_key}_cur"] = None
            m[f"tia_{os_key}_prv"] = None

    m["sends_total_cur"] = m["sends_ios_cur"] + m["sends_android_cur"]
    m["sends_total_prv"] = m["sends_ios_prv"] + m["sends_android_prv"]

    def _sum_field_flat(rows: list[dict], field: str) -> float:
        total = 0.0
        for row in rows:
            v = row.get(field, 0) or 0
            total += float(v) if isinstance(v, (int, float)) else 0
        return total

    m["web_sends_cur"] = _sum_field_flat(sends_cur, "web")
    m["web_sends_prv"] = _sum_field_flat(sends_prv, "web")
    m["sms_sends_cur"] = _sum_field_flat(sends_cur, "sms")
    m["sms_sends_prv"] = _sum_field_flat(sends_prv, "sms")

    m["email_sends_cur"] = _sum_field_flat(sends_cur, "email")
    m["email_sends_prv"] = _sum_field_flat(sends_prv, "email")

    m["email_injection_cur"] = events_cur.get("injection", 0)
    m["email_delivery_cur"]  = events_cur.get("delivery", 0)
    m["email_open_cur"]      = events_cur.get("initial_open", 0)
    m["email_bounce_cur"]    = events_cur.get("bounce", 0)
    m["email_unsub_cur"]     = events_cur.get("unsubscribe", 0)
    m["email_injection_prv"] = events_prv.get("injection", 0)
    m["email_delivery_prv"]  = events_prv.get("delivery", 0)
    m["email_open_prv"]      = events_prv.get("initial_open", 0)
    m["email_bounce_prv"]    = events_prv.get("bounce", 0)
    m["email_unsub_prv"]     = events_prv.get("unsubscribe", 0)

    m["email_deliverability_cur"] = (
        m["email_delivery_cur"] / m["email_injection_cur"] * 100
        if m["email_injection_cur"] > 0 else None
    )
    m["email_deliverability_prv"] = (
        m["email_delivery_prv"] / m["email_injection_prv"] * 100
        if m["email_injection_prv"] > 0 else None
    )
    m["email_open_rate_cur"] = (
        m["email_open_cur"] / m["email_delivery_cur"] * 100
        if m["email_delivery_cur"] > 0 else None
    )
    m["email_open_rate_prv"] = (
        m["email_open_prv"] / m["email_delivery_prv"] * 100
        if m["email_delivery_prv"] > 0 else None
    )
    m["email_bounce_rate_cur"] = (
        m["email_bounce_cur"] / m["email_injection_cur"] * 100
        if m["email_injection_cur"] > 0 else None
    )
    m["email_bounce_rate_prv"] = (
        m["email_bounce_prv"] / m["email_injection_prv"] * 100
        if m["email_injection_prv"] > 0 else None
    )
    m["email_unsub_rate_cur"] = (
        m["email_unsub_cur"] / m["email_delivery_cur"] * 100
        if m["email_delivery_cur"] > 0 else None
    )
    m["email_unsub_rate_prv"] = (
        m["email_unsub_prv"] / m["email_delivery_prv"] * 100
        if m["email_delivery_prv"] > 0 else None
    )

    m["sms_dispatched_cur"] = custom_cur.get("dispatched", 0)
    m["sms_delivered_cur"]  = custom_cur.get("delivered", 0)
    m["sms_failed_cur"]     = custom_cur.get("failed", 0)
    m["sms_expired_cur"]    = custom_cur.get("expired", 0)
    m["sms_dispatched_prv"] = custom_prv.get("dispatched", 0)
    m["sms_delivered_prv"]  = custom_prv.get("delivered", 0)

    m["sms_delivery_rate_cur"] = (
        m["sms_delivered_cur"] / m["sms_dispatched_cur"] * 100
        if m["sms_dispatched_cur"] >= T["min_sms_dispatched"] else None
    )
    m["sms_delivery_rate_prv"] = (
        m["sms_delivered_prv"] / m["sms_dispatched_prv"] * 100
        if m["sms_dispatched_prv"] >= T["min_sms_dispatched"] else None
    )

    m["devices"]   = devices_now
    m["custom_cur"] = custom_cur
    m["custom_prv"] = custom_prv

    d7 = canvas_state.get("d7_devices", {})
    for os_key, prefix in [("ios", "ios"), ("android", "android")]:
        dev_now = devices_now.get(os_key, {})
        if isinstance(dev_now, dict):
            unique_now = dev_now.get("unique_devices", 0) or 0
            optin_now  = dev_now.get("opted_in", 0) or 0
            uninst_now = dev_now.get("uninstalled", 0) or 0
        else:
            unique_now = optin_now = uninst_now = 0

        unique_d7 = d7.get(f"{prefix}_unique")
        optin_d7  = d7.get(f"{prefix}_opted_in")
        uninst_d7 = d7.get(f"{prefix}_uninstalled")

        m[f"dev_{os_key}_unique_now"]  = unique_now
        m[f"dev_{os_key}_optin_now"]   = optin_now
        m[f"dev_{os_key}_uninst_now"]  = uninst_now
        m[f"dev_{os_key}_unique_d7"]   = unique_d7
        m[f"dev_{os_key}_optin_d7"]    = optin_d7
        m[f"dev_{os_key}_uninst_d7"]   = uninst_d7

    return m


def evaluate_thresholds(
    m: dict[str, Any],
    canvas_state: dict[str, Any],
) -> list[dict]:
    alerts: list[dict] = []
    today_str = fmt_date(date.today())

    def _breach(key: str, condition: bool, os: str = "", extra: dict | None = None) -> None:
        if condition:
            a = {"key": key, "os": os, "today": today_str}
            if extra:
                a.update(extra)
            alerts.append(a)

    for os_key in ("ios", "android"):
        sc  = m[f"sends_{os_key}_cur"]
        sp  = m[f"sends_{os_key}_prv"]
        oc  = m[f"opens_{os_key}_cur"]
        op  = m[f"opens_{os_key}_prv"]
        xc  = m[f"optouts_{os_key}_cur"]
        xp  = m[f"optouts_{os_key}_prv"]
        ic  = m[f"optins_{os_key}_cur"]
        ip  = m[f"optins_{os_key}_prv"]
        drc = m[f"dr_rate_{os_key}_cur"]
        drp = m[f"dr_rate_{os_key}_prv"]
        tia_c = m[f"tia_{os_key}_cur"]
        tia_p = m[f"tia_{os_key}_prv"]
        net_c = m[f"net_optin_{os_key}_cur"]
        net_p = m[f"net_optin_{os_key}_prv"]

        sends_ok  = sp >= T["min_push_sends"]
        optins_ok = ip >= T["min_optins"]

        if op > 0:
            opens_delta = delta_pct(oc, op)
            _breach(f"app_opens_drop_{os_key}", opens_delta is not None and opens_delta <= -T["app_opens_drop_pct"], os_key)

        if sends_ok:
            sends_delta = delta_pct(sc, sp)
            _breach(f"push_sends_drop_{os_key}", sends_delta is not None and sends_delta <= -T["push_sends_drop_pct"], os_key)

            if xp > 0:
                optouts_delta = delta_pct(xc, xp)
                _breach(f"push_optouts_rise_{os_key}", optouts_delta is not None and optouts_delta >= T["optouts_rise_pct"], os_key)

            if drc is not None:
                _breach(f"direct_response_low_{os_key}",      drc < T["direct_response_rate_min"], os_key)
            if drc is not None and drp is not None and drp > 0:
                dr_drop = delta_pct(drc, drp)
                _breach(f"direct_response_collapse_{os_key}", dr_drop is not None and -dr_drop >= T["direct_response_collapse_pct"], os_key)

        if optins_ok and ip > 0:
            optins_delta = delta_pct(ic, ip)
            _breach(f"optins_drop_{os_key}", optins_delta is not None and optins_delta <= -T["optins_drop_pct"], os_key)

        _breach(f"net_optin_negative_{os_key}", net_p >= 0 and net_c < 0, os_key)

        if tia_c is not None and tia_p is not None and tia_p >= T["min_timeinapp"]:
            tia_delta = delta_pct(tia_c, tia_p)
            _breach(f"timeinapp_drop_{os_key}", tia_delta is not None and tia_delta <= -T["timeinapp_drop_pct"], os_key)

        d7_unique = m.get(f"dev_{os_key}_unique_d7")
        d7_optin  = m.get(f"dev_{os_key}_optin_d7")
        d7_uninst = m.get(f"dev_{os_key}_uninst_d7")
        if d7_unique is not None:
            uq_delta = delta_pct(m[f"dev_{os_key}_unique_now"], d7_unique)
            _breach(f"devices_{os_key}_unique_drop", uq_delta is not None and uq_delta <= -T["devices_unique_drop_pct"], os_key)
        if d7_optin is not None:
            op_delta = delta_pct(m[f"dev_{os_key}_optin_now"], d7_optin)
            _breach(f"devices_{os_key}_optin_drop", op_delta is not None and op_delta <= -T["devices_optin_drop_pct"], os_key)
        if d7_uninst is not None and d7_uninst > 0:
            un_delta = delta_pct(m[f"dev_{os_key}_uninst_now"], d7_uninst)
            _breach(f"devices_{os_key}_uninstall_rise", un_delta is not None and un_delta >= T["devices_uninstall_rise_pct"], os_key)

    ep  = m["email_sends_prv"]
    if ep >= T["min_email_sends"]:
        ec  = m["email_sends_cur"]
        ed  = delta_pct(ec, ep)
        _breach("email_sends_drop", ed is not None and ed <= -T["email_sends_drop_pct"])
        if m["email_deliverability_cur"] is not None:
            _breach("email_deliverability_low", m["email_deliverability_cur"] < T["email_deliverability_min"])
        if m["email_open_rate_cur"] is not None and m["email_open_rate_prv"] is not None:
            drop_pts = m["email_open_rate_prv"] - m["email_open_rate_cur"]
            _breach("email_open_rate_drop", drop_pts >= T["email_open_rate_drop_pts"])
        if m["email_bounce_rate_cur"] is not None:
            _breach("email_bounce_high", m["email_bounce_rate_cur"] > T["email_bounce_max"])
        if m["email_unsub_cur"] > 0 and m["email_unsub_prv"] > 0:
            ud = delta_pct(m["email_unsub_cur"], m["email_unsub_prv"])
            _breach("email_unsubscribe_rise", ud is not None and ud >= T["email_unsubscribe_rise_pct"])

    devices = m.get("devices", {})
    web_dev = devices.get("web", {}) if isinstance(devices, dict) else {}
    web_unique = (web_dev.get("unique_devices", 0) or 0) if isinstance(web_dev, dict) else 0
    if web_unique > 0 or m["web_sends_prv"] > 0:
        if m["web_sends_prv"] >= T["min_web_sends"]:
            wd = delta_pct(m["web_sends_cur"], m["web_sends_prv"])
            _breach("web_sends_drop", wd is not None and wd <= -T["web_sends_drop_pct"])
            _breach("web_sends_rise", wd is not None and wd >= T["web_sends_rise_pct"])

    sms_dev = devices.get("sms", {}) if isinstance(devices, dict) else {}
    sms_unique = (sms_dev.get("unique_devices", 0) or 0) if isinstance(sms_dev, dict) else 0
    if sms_unique > 0 or m["sms_sends_prv"] > 0:
        if m["sms_sends_prv"] >= T["min_sms_sends"]:
            sd = delta_pct(m["sms_sends_cur"], m["sms_sends_prv"])
            _breach("sms_sends_drop", sd is not None and sd <= -T["sms_sends_drop_pct"])
            _breach("sms_sends_rise", sd is not None and sd >= T["sms_sends_rise_pct"])
        if m["sms_delivery_rate_cur"] is not None:
            _breach("sms_delivery_rate_low", m["sms_delivery_rate_cur"] < T["sms_delivery_rate_min"])
        if m["sms_delivery_rate_cur"] is not None and m["sms_delivery_rate_prv"] is not None:
            drop_pts = m["sms_delivery_rate_prv"] - m["sms_delivery_rate_cur"]
            _breach("sms_delivery_rate_drop", drop_pts >= T["sms_delivery_rate_drop_pts"])

    custom_cur = m.get("custom_cur", {})
    custom_prv = m.get("custom_prv", {})
    all_names = set(custom_cur) | set(custom_prv)
    sms_event_names = {"dispatched", "delivered", "failed", "expired"}
    for name in all_names:
        if name in sms_event_names:
            continue
        cc = custom_cur.get(name, 0)
        cp = custom_prv.get(name, 0)
        if cp == 0 and cc > 0:
            _breach(f"custom_event_new:{name}", True)
        elif cc == 0 and cp > 0:
            _breach(f"custom_event_vanished:{name}", True)
        elif cp >= T["min_custom_event_count"]:
            cd = delta_pct(cc, cp)
            _breach(f"custom_event_rise:{name}",  cd is not None and cd >= T["custom_event_rise_pct"])
            _breach(f"custom_event_drop:{name}",  cd is not None and cd <= -T["custom_event_drop_pct"])

    collapse_keys = {f"direct_response_collapse_{os}" for os in ("ios", "android")}
    low_keys      = {f"direct_response_low_{os}"      for os in ("ios", "android")}
    triggered_keys = {a["key"] for a in alerts}
    alerts = [a for a in alerts if not (
        a["key"] in low_keys and f"direct_response_collapse_{a['os']}" in triggered_keys
    )]

    return alerts

# ─────────────────────────────────────────────────────────────────────────────
# Step 8b — Root cause analysis
# ─────────────────────────────────────────────────────────────────────────────
def root_cause(alert: dict, m: dict[str, Any], windows: dict[str, date]) -> str:
    key = alert["key"]
    os_key = alert.get("os", "")

    if os_key in ("ios", "android"):
        sc = m.get(f"sends_{os_key}_cur", 0)
        sp = m.get(f"sends_{os_key}_prv", 0)
        oc = m.get(f"opens_{os_key}_cur", 0)
        op = m.get(f"opens_{os_key}_prv", 0)
        sends_delta = delta_pct(sc, sp)
        opens_delta = delta_pct(oc, op)

    if key.startswith("app_opens_drop_"):
        if sends_delta is not None and sends_delta <= -10:
            return (
                f"La baisse des ouvertures d'application sur {os_key.upper()} est cohérente "
                f"avec la réduction des envois push de {sends_delta:.1f}% sur {os_key.upper()}. "
                f"Source : /api/reports/opens vs /api/reports/sends."
            )

    if key.startswith("push_sends_drop_"):
        return (
            f"Baisse des envois push sur {os_key.upper()}. "
            f"Vérifier le calendrier des campagnes pour la période "
            f"{fmt_date(windows['current_window_start'])} → {fmt_date(windows['current_window_end'])}. "
            f"Source : /api/reports/sends."
        )

    if key.startswith("direct_response_collapse_"):
        drc = m.get(f"dr_rate_{os_key}_cur")
        drp = m.get(f"dr_rate_{os_key}_prv")
        return (
            f"Le taux de réponse directe sur {os_key.upper()} s'est effondré de "
            f"{drp:.2f}% → {drc:.2f}% (direct / envois push, source /api/reports/responses) "
            f"alors que les envois restaient normaux → probable problème de tracking/SDK "
            f"sur {os_key.upper()}. Recommandé : vérifier la version du SDK et le suivi "
            f"des réponses sur {os_key.upper()}."
        )

    if key.startswith("push_optouts_rise_"):
        if sends_delta is not None and sends_delta > 10:
            xc = m.get(f"optouts_{os_key}_cur", 0)
            xp = m.get(f"optouts_{os_key}_prv", 0)
            xr_c = m.get(f"optout_rate_{os_key}_cur")
            xr_p = m.get(f"optout_rate_{os_key}_prv")
            rate_dir = "amélioré" if (xr_c or 0) < (xr_p or 0) else "dégradé"
            return (
                f"La hausse brute des désinscriptions sur {os_key.upper()} est liée au volume "
                f"(envois push +{sends_delta:.1f}%) ; le taux de désinscription par envoi s'est {rate_dir}. "
                f"Source : /api/reports/optouts ÷ /api/reports/sends."
            )

    if key.startswith("timeinapp_drop_"):
        if opens_delta is not None and opens_delta <= -10:
            return (
                f"La baisse du temps passé dans l'app sur {os_key.upper()} s'accompagne d'une "
                f"baisse des ouvertures ({opens_delta:.1f}%) — érosion globale de l'engagement. "
                f"Source : /api/reports/timeinapp vs /api/reports/opens."
            )
        return (
            f"Le temps moyen dans l'application sur {os_key.upper()} a baissé sans baisse "
            f"correspondante des ouvertures — probable désengagement en session. "
            f"Source : /api/reports/timeinapp."
        )

    if key.startswith("optins_drop_"):
        if sends_delta is not None and sends_delta <= -15:
            return (
                f"La baisse des nouvelles inscriptions sur {os_key.upper()} est corrélée "
                f"à la baisse des envois push ({sends_delta:.1f}%). "
                f"Source : /api/reports/optins."
            )

    if key == "email_sends_drop":
        return (
            "Baisse des envois email. Vérifier si des campagnes ont été mises en pause "
            "ou reprogrammées sur la période. Source : /api/reports/sends."
        )

    if key == "email_deliverability_low":
        deliv = m.get("email_deliverability_cur")
        return (
            f"Taux de délivrabilité email à {deliv:.1f}% (seuil : {T['email_deliverability_min']}%). "
            f"Source : /api/reports/events (delivery / injection)."
        )

    if key == "email_bounce_high":
        bounce = m.get("email_bounce_rate_cur")
        return (
            f"Taux de bounces email élevé : {bounce:.2f}% (seuil : {T['email_bounce_max']}%). "
            f"Vérifier la qualité de la liste. Source : /api/reports/events."
        )

    if key.startswith("sms_delivery_rate"):
        failed = m.get("sms_failed_cur", 0)
        expired = m.get("sms_expired_cur", 0)
        dispatched = m.get("sms_dispatched_cur", 1)
        failure_rate = (failed + expired) / dispatched * 100 if dispatched else 0
        return (
            f"Dégradation du taux de livraison SMS. "
            f"Échecs + expirés : {failure_rate:.1f}% des envois. "
            f"Probable problème opérateur/réseau ou MSISDNs invalides. "
            f"Source : /api/reports/events (SMS Delivery Report)."
        )

    if key.startswith("custom_event_"):
        name = key.split(":", 1)[-1] if ":" in key else key
        return (
            f"Variation significative de l'événement personnalisé « {name} ». "
            f"Source : /api/reports/events."
        )

    return t("no_cause")

# ─────────────────────────────────────────────────────────────────────────────
# Step 9 — Anti-duplication
# ─────────────────────────────────────────────────────────────────────────────
def anti_dupe(
    triggered: list[dict],
    open_alerts: list[dict],
    today_str: str,
) -> tuple[list[dict], list[dict], list[dict]]:
    open_keys = {a["key"] for a in open_alerts}
    triggered_keys = {a["key"] for a in triggered}

    new_alerts       = [a for a in triggered   if a["key"] not in open_keys]
    ongoing_alerts   = [a for a in triggered   if a["key"] in open_keys]
    resolved_alerts  = [a for a in open_alerts if a["key"] not in triggered_keys]

    return new_alerts, resolved_alerts, ongoing_alerts

# ─────────────────────────────────────────────────────────────────────────────
# Step 10 — Build and post Slack messages
# ─────────────────────────────────────────────────────────────────────────────
def build_alert_message(
    new_alerts: list[dict],
    m: dict[str, Any],
    windows: dict[str, date],
    causes: dict[str, str],
) -> str:
    start_str = fmt_date(windows["current_window_start"])
    end_str   = fmt_date(windows["current_window_end"])

    lines = [
        t("alert_header").format(client=CLIENT_NAME, start=start_str, end=end_str),
        "",
    ]

    sections_order = [
        ("app",     lambda k: k.startswith("app_opens_drop_") or k.startswith("timeinapp_drop_")),
        ("push",    lambda k: any(k.startswith(p) for p in [
            "push_sends_drop_", "push_optouts_rise_", "direct_response_"])),
        ("acq",     lambda k: k.startswith("optins_drop_") or k.startswith("net_optin_negative_")),
        ("email",   lambda k: k.startswith("email_")),
        ("webpush", lambda k: k.startswith("web_sends_")),
        ("sms",     lambda k: k.startswith("sms_")),
        ("devices", lambda k: k.startswith("devices_")),
        ("custom",  lambda k: k.startswith("custom_event_")),
    ]

    table_header = "| Métrique | OS/Canal | Prev 7j | Derniers 7j | Δ |"
    table_sep    = "|---|---|---|---|---|"

    for sec_key, matcher in sections_order:
        sec_alerts = [a for a in new_alerts if matcher(a["key"])]
        if not sec_alerts:
            continue

        lines.append(t(f"section_{sec_key}"))
        lines.append(table_header)
        lines.append(table_sep)

        for a in sec_alerts:
            key    = a["key"]
            os_key = a.get("os", "—")
            row    = _build_metric_row(key, os_key, m)
            lines.append(row)
            lines.append("")

            cause = causes.get(key, t("no_cause"))
            lines.append(f"> {t('possible_cause').format(cause=cause)}")
            lines.append("")

    lines.append(t("source_footer").format(url=CANVAS_URL))
    return "\n".join(lines)


def _build_metric_row(key: str, os_key: str, m: dict[str, Any]) -> str:
    os_label = os_key.capitalize() if os_key in ("ios", "android") else os_key

    if key.startswith("app_opens_drop_"):
        c  = m.get(f"opens_{os_key}_cur", 0)
        p  = m.get(f"opens_{os_key}_prv", 0)
        d  = delta_pct(c, p)
        return f"| Ouvertures app | {os_label} | {fmt_num(p)} | {fmt_num(c)} | {fmt_delta(d)} |"

    if key.startswith("timeinapp_drop_"):
        c  = m.get(f"tia_{os_key}_cur")
        p  = m.get(f"tia_{os_key}_prv")
        d  = delta_pct(c or 0, p or 0) if c is not None and p is not None else None
        return f"| Temps moyen dans l'app /jour | {os_label} | {fmt_num(p)}s | {fmt_num(c)}s | {fmt_delta(d)} |"

    if key.startswith("push_sends_drop_"):
        c = m.get(f"sends_{os_key}_cur", 0)
        p = m.get(f"sends_{os_key}_prv", 0)
        d = delta_pct(c, p)
        return f"| Envois push | {os_label} | {fmt_num(p)} | {fmt_num(c)} | {fmt_delta(d)} |"

    if key.startswith("push_optouts_rise_"):
        xc = m.get(f"optouts_{os_key}_cur", 0)
        xp = m.get(f"optouts_{os_key}_prv", 0)
        rc = m.get(f"optout_rate_{os_key}_cur")
        rp = m.get(f"optout_rate_{os_key}_prv")
        d  = delta_pct(xc, xp)
        rc_str = f"({rc:.1f}%)" if rc is not None else ""
        rp_str = f"({rp:.1f}%)" if rp is not None else ""
        return (
            f"| Désinscriptions push (vs envois) | {os_label} | "
            f"{fmt_num(xp)} {rp_str} | {fmt_num(xc)} {rc_str} | {fmt_delta(d)} |"
        )

    if key.startswith("direct_response_collapse_") or key.startswith("direct_response_low_"):
        drc = m.get(f"dr_rate_{os_key}_cur")
        drp = m.get(f"dr_rate_{os_key}_prv")
        d   = delta_pct(drc or 0, drp or 0) if drc is not None and drp is not None else None
        drc_str = f"{drc:.2f}%" if drc is not None else "n/a"
        drp_str = f"{drp:.2f}%" if drp is not None else "n/a"
        return (
            f"| Taux de réponse directe (vs envois) | {os_label} | "
            f"{drp_str} | {drc_str} | {fmt_delta(d)} |"
        )

    if key.startswith("optins_drop_"):
        ic = m.get(f"optins_{os_key}_cur", 0)
        ip = m.get(f"optins_{os_key}_prv", 0)
        d  = delta_pct(ic, ip)
        return f"| Nouvelles inscriptions | {os_label} | {fmt_num(ip)} | {fmt_num(ic)} | {fmt_delta(d)} |"

    if key.startswith("net_optin_negative_"):
        nc = m.get(f"net_optin_{os_key}_cur", 0)
        np = m.get(f"net_optin_{os_key}_prv", 0)
        return (
            f"| Solde net opt-in (opt-ins − opt-outs) | {os_label} | "
            f"{fmt_num(np)} | {fmt_num(nc)} | {'⚠️ négatif' if nc < 0 else '→'} |"
        )

    if key == "email_sends_drop":
        c = m.get("email_sends_cur", 0)
        p = m.get("email_sends_prv", 0)
        d = delta_pct(c, p)
        return f"| Envois email | — | {fmt_num(p)} | {fmt_num(c)} | {fmt_delta(d)} |"

    if key == "email_deliverability_low":
        c = m.get("email_deliverability_cur")
        p = m.get("email_deliverability_prv")
        c_str = f"{c:.1f}%" if c is not None else "n/a"
        p_str = f"{p:.1f}%" if p is not None else "n/a"
        d = delta_pct(c or 0, p or 0) if c and p else None
        return f"| Délivrabilité email (livraison/injection) | — | {p_str} | {c_str} | {fmt_delta(d)} |"

    if key == "email_open_rate_drop":
        c = m.get("email_open_rate_cur")
        p = m.get("email_open_rate_prv")
        c_str = f"{c:.1f}%" if c is not None else "n/a"
        p_str = f"{p:.1f}%" if p is not None else "n/a"
        d_pts = (p - c) if p is not None and c is not None else None
        d_str = f"⬇️ -{d_pts:.1f} pts" if d_pts is not None and d_pts > 0 else fmt_delta(delta_pct(c or 0, p or 0))
        return f"| Taux d'ouverture email (vs livré) | — | {p_str} | {c_str} | {d_str} |"

    if key == "email_bounce_high":
        c = m.get("email_bounce_rate_cur")
        p = m.get("email_bounce_rate_prv")
        c_str = f"{c:.2f}%" if c is not None else "n/a"
        p_str = f"{p:.2f}%" if p is not None else "n/a"
        return f"| Taux de bounces email (vs injection) | — | {p_str} | {c_str} | ⬆️ |"

    if key == "email_unsubscribe_rise":
        uc = m.get("email_unsub_cur", 0)
        up = m.get("email_unsub_prv", 0)
        rc = m.get("email_unsub_rate_cur")
        rp = m.get("email_unsub_rate_prv")
        d  = delta_pct(uc, up)
        rc_str = f"({rc:.2f}%)" if rc is not None else ""
        rp_str = f"({rp:.2f}%)" if rp is not None else ""
        return (
            f"| Désinscriptions email (vs livré) | — | "
            f"{fmt_num(up)} {rp_str} | {fmt_num(uc)} {rc_str} | {fmt_delta(d)} |"
        )

    if key in ("web_sends_drop", "web_sends_rise"):
        c = m.get("web_sends_cur", 0)
        p = m.get("web_sends_prv", 0)
        d = delta_pct(c, p)
        return f"| Envois web push | Web | {fmt_num(p)} | {fmt_num(c)} | {fmt_delta(d)} |"

    if key in ("sms_sends_drop", "sms_sends_rise"):
        c = m.get("sms_sends_cur", 0)
        p = m.get("sms_sends_prv", 0)
        d = delta_pct(c, p)
        return f"| Envois SMS | SMS | {fmt_num(p)} | {fmt_num(c)} | {fmt_delta(d)} |"

    if key in ("sms_delivery_rate_low", "sms_delivery_rate_drop"):
        drc = m.get("sms_delivery_rate_cur")
        drp = m.get("sms_delivery_rate_prv")
        drc_str = f"{drc:.1f}%" if drc is not None else "n/a"
        drp_str = f"{drp:.1f}%" if drp is not None else "n/a"
        d = delta_pct(drc or 0, drp or 0) if drc and drp else None
        return (
            f"| Taux de livraison SMS (livré/dispatché) | SMS | "
            f"{drp_str} | {drc_str} | {fmt_delta(d)} | "
            f"livré={fmt_num(m.get('sms_delivered_cur',0))} "
            f"dispatché={fmt_num(m.get('sms_dispatched_cur',0))} "
            f"échoué+expiré={fmt_num((m.get('sms_failed_cur',0) or 0)+(m.get('sms_expired_cur',0) or 0))} |"
        )

    if key.startswith("devices_"):
        parts  = key.split("_")
        os_k   = parts[1] if len(parts) > 1 else os_key
        metric = "_".join(parts[2:]) if len(parts) > 2 else ""
        now = m.get(f"dev_{os_k}_{metric.replace('drop','').replace('rise','').strip('_')}_now")
        d7  = m.get(f"dev_{os_k}_{metric.replace('drop','').replace('rise','').strip('_')}_d7")
        d   = delta_pct(now or 0, d7 or 0) if d7 else None
        return (
            f"| Parc installé — {metric} | {os_k.capitalize()} | "
            f"{fmt_num(d7)} | {fmt_num(now)} | {fmt_delta(d)} |"
        )

    if key.startswith("custom_event_"):
        parts = key.split(":", 1)
        name  = parts[1] if len(parts) > 1 else key
        cc    = m.get("custom_cur", {}).get(name, 0)
        cp    = m.get("custom_prv", {}).get(name, 0)
        d     = delta_pct(cc, cp) if cp > 0 else None
        label = "nouveau" if "_new:" in key else ("disparu" if "_vanished:" in key else "")
        d_str = label or fmt_delta(d)
        return f"| Événement : {name} | — | {fmt_num(cp)} | {fmt_num(cc)} | {d_str} |"

    return f"| {key} | {os_label} | — | — | — |"


def post_slack_message(channel: str, message: str) -> bool:
    result = slack_request("POST", "chat.postMessage", {
        "channel": channel,
        "message": message,
    })
    if result is None:
        result = slack_request("POST", "chat.postMessage", {
            "channel": channel,
            "text": message,
        })
    return result is not None

# ─────────────────────────────────────────────────────────────────────────────
# Step 11 — Build and update canvas
# ─────────────────────────────────────────────────────────────────────────────
def build_canvas(
    m: dict[str, Any],
    windows: dict[str, date],
    all_open_alerts: list[dict],
    causes: dict[str, str],
) -> str:
    today      = windows["today"]
    cur_start  = windows["current_window_start"]
    cur_end    = windows["current_window_end"]
    prv_start  = windows["previous_window_start"]
    prv_end    = windows["previous_window_end"]

    devices = m.get("devices", {})
    ios_dev = devices.get("ios", {}) if isinstance(devices, dict) else {}
    and_dev = devices.get("android", {}) if isinstance(devices, dict) else {}
    web_dev = devices.get("web", {}) if isinstance(devices, dict) else {}
    sms_dev = devices.get("sms", {}) if isinstance(devices, dict) else {}

    ios_unique  = (ios_dev.get("unique_devices", 0)  or 0) if isinstance(ios_dev, dict) else 0
    ios_optin   = (ios_dev.get("opted_in", 0)        or 0) if isinstance(ios_dev, dict) else 0
    ios_optout  = (ios_dev.get("opted_out", 0)       or 0) if isinstance(ios_dev, dict) else 0
    ios_uninst  = (ios_dev.get("uninstalled", 0)     or 0) if isinstance(ios_dev, dict) else 0
    and_unique  = (and_dev.get("unique_devices", 0)  or 0) if isinstance(and_dev, dict) else 0
    and_optin   = (and_dev.get("opted_in", 0)        or 0) if isinstance(and_dev, dict) else 0
    and_optout  = (and_dev.get("opted_out", 0)       or 0) if isinstance(and_dev, dict) else 0
    and_uninst  = (and_dev.get("uninstalled", 0)     or 0) if isinstance(and_dev, dict) else 0
    web_unique  = (web_dev.get("unique_devices", 0)  or 0) if isinstance(web_dev, dict) else 0
    web_optin   = (web_dev.get("opted_in", 0)        or 0) if isinstance(web_dev, dict) else 0
    sms_unique  = (sms_dev.get("unique_devices", 0)  or 0) if isinstance(sms_dev, dict) else 0
    sms_optin   = (sms_dev.get("opted_in", 0)        or 0) if isinstance(sms_dev, dict) else 0
    sms_optout  = (sms_dev.get("opted_out", 0)       or 0) if isinstance(sms_dev, dict) else 0
    sms_uninst  = (sms_dev.get("uninstalled", 0)     or 0) if isinstance(sms_dev, dict) else 0

    def _d(c, p):
        d = delta_pct(c, p)
        return fmt_delta(d) if d is not None else "n/a"

    lines = [
        f"# KPI Monitor — {CLIENT_NAME}",
        f"_Dernière exécution : {fmt_date(today)} · Fenêtre {fmt_date(cur_start)}→{fmt_date(cur_end)} vs {fmt_date(prv_start)}→{fmt_date(prv_end)}_",
        "",
        "## 🚨 Alertes actives",
    ]

    if all_open_alerts:
        lines.append("| Alerte | OS | Ouverte | Dernière vue | Cause possible |")
        lines.append("|---|---|---|---|---|")
        for a in all_open_alerts:
            cause = causes.get(a["key"], "—")[:80]
            lines.append(f"| {a['key']} | {a.get('os','')} | {a.get('opened', a.get('today',''))} | {a.get('last_seen', a.get('today',''))} | {cause} |")
    else:
        lines.append("Aucune alerte active cette semaine.")

    lines += [
        "",
        "## 📊 Cette semaine en un coup d'œil",
        "",
        "### Application & Engagement  _(source : /api/reports/opens, /api/reports/timeinapp)_",
        "| KPI | OS | Prev 7j | Derniers 7j | Δ |",
        "|---|---|---|---|---|",
    ]

    for os_key, label in [("ios", "iOS"), ("android", "Android")]:
        oc = m.get(f"opens_{os_key}_cur", 0)
        op = m.get(f"opens_{os_key}_prv", 0)
        tc = m.get(f"tia_{os_key}_cur")
        tp = m.get(f"tia_{os_key}_prv")
        lines.append(f"| Ouvertures app | {label} | {fmt_num(op)} | {fmt_num(oc)} | {_d(oc, op)} |")
        tc_str = f"{tc:.0f}s" if tc is not None else "n/a"
        tp_str = f"{tp:.0f}s" if tp is not None else "n/a"
        tia_d  = fmt_delta(delta_pct(tc or 0, tp or 0)) if tc is not None and tp is not None else "n/a"
        lines.append(f"| Temps moyen dans l'app /jour | {label} | {tp_str} | {tc_str} | {tia_d} |")

    ot_c = m.get("opens_ios_cur", 0) + m.get("opens_android_cur", 0)
    ot_p = m.get("opens_ios_prv", 0) + m.get("opens_android_prv", 0)
    lines.append(f"| Ouvertures app | Total | {fmt_num(ot_p)} | {fmt_num(ot_c)} | {_d(ot_c, ot_p)} |")

    lines += [
        "",
        "### Push  _(source : /api/reports/sends, /api/reports/optouts, /api/reports/responses)_",
        "| KPI | OS | Prev 7j | Derniers 7j | Δ |",
        "|---|---|---|---|---|",
    ]
    for os_key, label in [("ios", "iOS"), ("android", "Android")]:
        sc = m.get(f"sends_{os_key}_cur", 0)
        sp = m.get(f"sends_{os_key}_prv", 0)
        xc = m.get(f"optouts_{os_key}_cur", 0)
        xp = m.get(f"optouts_{os_key}_prv", 0)
        rc = m.get(f"optout_rate_{os_key}_cur")
        rp = m.get(f"optout_rate_{os_key}_prv")
        dc = m.get(f"dr_rate_{os_key}_cur")
        dp = m.get(f"dr_rate_{os_key}_prv")
        rc_s = f" ({rc:.1f}%)" if rc is not None else ""
        rp_s = f" ({rp:.1f}%)" if rp is not None else ""
        dc_s = f"{dc:.2f}%" if dc is not None else "n/a"
        dp_s = f"{dp:.2f}%" if dp is not None else "n/a"
        lines.append(f"| Envois | {label} | {fmt_num(sp)} | {fmt_num(sc)} | {_d(sc, sp)} |")
        lines.append(f"| Désinscriptions (vs envois) | {label} | {fmt_num(xp)}{rp_s} | {fmt_num(xc)}{rc_s} | {_d(xc, xp)} |")
        lines.append(f"| Taux de réponse directe (vs envois) | {label} | {dp_s} | {dc_s} | {fmt_delta(delta_pct(dc or 0, dp or 0) if dc is not None and dp is not None else None)} |")

    lines += [
        "",
        "### Acquisition  _(source : /api/reports/optins + /api/reports/optouts)_",
        "| KPI | OS | Prev 7j | Derniers 7j | Δ |",
        "|---|---|---|---|---|",
    ]
    for os_key, label in [("ios", "iOS"), ("android", "Android")]:
        ic = m.get(f"optins_{os_key}_cur", 0)
        ip = m.get(f"optins_{os_key}_prv", 0)
        nc = m.get(f"net_optin_{os_key}_cur", 0)
        np = m.get(f"net_optin_{os_key}_prv", 0)
        lines.append(f"| Nouvelles inscriptions | {label} | {fmt_num(ip)} | {fmt_num(ic)} | {_d(ic, ip)} |")
        lines.append(f"| Solde net opt-in (opt-ins − opt-outs) | {label} | {fmt_num(np)} | {fmt_num(nc)} | {_d(nc, np)} |")

    email_active = m.get("email_sends_cur", 0) > 0 or m.get("email_sends_prv", 0) > 0
    if email_active:
        ec  = m.get("email_sends_cur", 0)
        ep  = m.get("email_sends_prv", 0)
        dlc = m.get("email_deliverability_cur")
        dlp = m.get("email_deliverability_prv")
        orc = m.get("email_open_rate_cur")
        orp = m.get("email_open_rate_prv")
        brc = m.get("email_bounce_rate_cur")
        brp = m.get("email_bounce_rate_prv")
        uc  = m.get("email_unsub_cur", 0)
        up  = m.get("email_unsub_prv", 0)
        urc = m.get("email_unsub_rate_cur")
        urp = m.get("email_unsub_rate_prv")
        lines += [
            "",
            "### Email  _(source : /api/reports/events)_",
            "| KPI | Prev 7j | Derniers 7j | Δ |",
            "|---|---|---|---|",
            f"| Envois | {fmt_num(ep)} | {fmt_num(ec)} | {_d(ec, ep)} |",
            f"| Délivrabilité (livraison/injection) | {f'{dlp:.1f}%' if dlp else 'n/a'} | {f'{dlc:.1f}%' if dlc else 'n/a'} | {fmt_delta(delta_pct(dlc or 0, dlp or 0) if dlc and dlp else None)} |",
            f"| Taux d'ouverture (vs livré) | {f'{orp:.1f}%' if orp else 'n/a'} | {f'{orc:.1f}%' if orc else 'n/a'} | {fmt_delta(delta_pct(orc or 0, orp or 0) if orc and orp else None)} |",
            f"| Taux de bounces (vs injection) | {f'{brp:.2f}%' if brp else 'n/a'} | {f'{brc:.2f}%' if brc else 'n/a'} | {fmt_delta(delta_pct(brc or 0, brp or 0) if brc and brp else None)} |",
            f"| Désinscriptions (vs livré) | {fmt_num(up)} {f'({urp:.2f}%)' if urp else ''} | {fmt_num(uc)} {f'({urc:.2f}%)' if urc else ''} | {_d(uc, up)} |",
        ]

    web_active = web_unique > 0 or m.get("web_sends_prv", 0) > 0
    if web_active:
        wc = m.get("web_sends_cur", 0)
        wp = m.get("web_sends_prv", 0)
        lines += [
            "",
            "### Web push  _(source : /api/reports/sends · uniquement si web actif)_",
            "| KPI | Prev 7j | Derniers 7j | Δ |",
            "|---|---|---|---|",
            f"| Envois web push | {fmt_num(wp)} | {fmt_num(wc)} | {_d(wc, wp)} |",
        ]

    sms_active = sms_unique > 0 or m.get("sms_sends_prv", 0) > 0
    if sms_active:
        sc2 = m.get("sms_sends_cur", 0)
        sp2 = m.get("sms_sends_prv", 0)
        drc = m.get("sms_delivery_rate_cur")
        drp = m.get("sms_delivery_rate_prv")
        lines += [
            "",
            "### SMS  _(source : /api/reports/sends + /api/reports/events · uniquement si SMS actif)_",
            "| KPI | Prev 7j | Derniers 7j | Δ |",
            "|---|---|---|---|",
            f"| Envois SMS | {fmt_num(sp2)} | {fmt_num(sc2)} | {_d(sc2, sp2)} |",
        ]
        if drc is not None:
            lines.append(f"| Taux de livraison SMS (livré/dispatché) | {f'{drp:.1f}%' if drp else 'n/a'} | {f'{drc:.1f}%' if drc else 'n/a'} | {fmt_delta(delta_pct(drc, drp) if drp else None)} |")
            lines.append(f"| SMS livrés | {fmt_num(m.get('sms_delivered_prv',0))} | {fmt_num(m.get('sms_delivered_cur',0))} | — |")
            lines.append(f"| SMS dispatchés | — | {fmt_num(m.get('sms_dispatched_cur',0))} | — |")
            lines.append(f"| SMS échoués + expirés | — | {fmt_num((m.get('sms_failed_cur',0) or 0)+(m.get('sms_expired_cur',0) or 0))} | — |")

    custom_cur = m.get("custom_cur", {})
    custom_prv = m.get("custom_prv", {})
    sms_names = {"dispatched", "delivered", "failed", "expired"}
    custom_names = [n for n in set(custom_cur) | set(custom_prv) if n not in sms_names]
    if custom_names:
        lines += [
            "",
            "### Événements personnalisés  _(source : /api/reports/events)_",
            "| Événement | Prev 7j | Derniers 7j | Δ |",
            "|---|---|---|---|",
        ]
        for name in sorted(custom_names):
            cc2 = custom_cur.get(name, 0)
            cp2 = custom_prv.get(name, 0)
            d   = fmt_delta(delta_pct(cc2, cp2)) if cp2 > 0 else ("nouveau" if cc2 > 0 else "disparu")
            lines.append(f"| {name} | {fmt_num(cp2)} | {fmt_num(cc2)} | {d} |")

    lines += [
        "",
        f"## 📱 Parc installé — snapshot {fmt_date(today)}  _(source : /api/reports/devices)_",
        "| OS | Unique | Opt-in | Opt-out | Désinstallés |",
        "|---|---|---|---|---|",
        f"| iOS | {fmt_num(ios_unique)} | {fmt_num(ios_optin)} | {fmt_num(ios_optout)} | {fmt_num(ios_uninst)} |",
        f"| Android | {fmt_num(and_unique)} | {fmt_num(and_optin)} | {fmt_num(and_optout)} | {fmt_num(and_uninst)} |",
    ]
    if web_unique > 0:
        lines.append(f"| Web | {fmt_num(web_unique)} | {fmt_num(web_optin)} | — | — |")
    if sms_unique > 0:
        lines.append(f"| SMS | {fmt_num(sms_unique)} | {fmt_num(sms_optin)} | {fmt_num(sms_optout)} | {fmt_num(sms_uninst)} |")

    header_cols = "| Date | iOS unique | iOS opt-in | iOS désinstallés | Android unique | Android opt-in | Android désinstallés"
    if web_unique > 0:
        header_cols += " | Web opt-in"
    if sms_unique > 0:
        header_cols += " | SMS unique | SMS opt-in"
    header_cols += " |"

    sep_cols = "|---|---|---|---|---|---|---"
    if web_unique > 0:
        sep_cols += "|---"
    if sms_unique > 0:
        sep_cols += "|---|---"
    sep_cols += "|"

    today_row = f"| {fmt_date(today)} | {fmt_num(ios_unique)} | {fmt_num(ios_optin)} | {fmt_num(ios_uninst)} | {fmt_num(and_unique)} | {fmt_num(and_optin)} | {fmt_num(and_uninst)}"
    if web_unique > 0:
        today_row += f" | {fmt_num(web_optin)}"
    if sms_unique > 0:
        today_row += f" | {fmt_num(sms_unique)} | {fmt_num(sms_optin)}"
    today_row += " |"

    lines += [
        "",
        "## 📈 Historique du parc (30 derniers jours)  _(source : /api/reports/devices)_",
        header_cols,
        sep_cols,
        today_row,
        "_(Les runs précédents seront ajoutés ici au fur et à mesure)_",
    ]

    return "\n".join(lines)


def update_canvas(canvas_id: str, content: str) -> bool:
    result = slack_request("POST", "canvases.edit", {
        "canvas_id": canvas_id,
        "changes": [
            {
                "operation":   "replace",
                "document_content": {
                    "type":     "markdown",
                    "markdown": content,
                }
            }
        ],
    })
    return result is not None


# ─────────────────────────────────────────────────────────────────────────────
# Credential validation
# ─────────────────────────────────────────────────────────────────────────────
def validate_credentials() -> list[str]:
    missing = []
    if not AIRSHIP_APP_KEY:
        missing.append("AIRSHIP_APP_KEY")
    if not AIRSHIP_CLIENT_ID:
        missing.append("AIRSHIP_CLIENT_ID")
    if not AIRSHIP_CLIENT_SECRET:
        missing.append("AIRSHIP_CLIENT_SECRET")
    if not SLACK_BOT_TOKEN:
        missing.append("SLACK_BOT_TOKEN")
    return missing


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    missing = validate_credentials()
    if missing:
        log("=" * 70)
        log(f"[airship-kpi-monitor] ERREUR DE CONFIGURATION — {CLIENT_NAME}")
        log("=" * 70)
        log("")
        log("Les variables d'environnement suivantes sont manquantes :")
        for var in missing:
            log(f"  ❌  {var}")
        log("")
        log("Pour les configurer :")
        log("  1. Allez sur cursor.com/dashboard → Cloud Agents → Secrets")
        log("  2. Ajoutez chaque variable listée ci-dessus comme un secret")
        log("  3. Pour les identifiants Airship, créez un client OAuth dans")
        log("     Airship Settings → OAuth avec les scopes « rpt » + « tpl »")
        log("  4. Pour SLACK_BOT_TOKEN, créez une app Slack avec les scopes :")
        log("     chat:write, canvases:read, canvases:write, files:read")
        log("")
        log("Référence : MODOP.md sections 1.3–1.6")
        log("=" * 70)
        sys.exit(1)

    log(f"\n[airship-kpi-monitor] {CLIENT_NAME} — démarrage {date.today()}")

    windows = compute_windows()
    log(
        f"  Fenêtres : {fmt_date(windows['current_window_start'])}→"
        f"{fmt_date(windows['current_window_end'])} vs "
        f"{fmt_date(windows['previous_window_start'])}→"
        f"{fmt_date(windows['previous_window_end'])}"
    )

    log("\n── Étape 1 : Récupération des métriques (14 jours DAILY)…")
    raw_step1 = fetch_step1(windows)
    step1     = aggregate_step1(raw_step1, windows)

    log("\n── Étapes 2 & 3 : Récupération des événements…")
    events_cur_raw = fetch_events(windows["current_window_start"],  windows["current_window_end"])
    events_prv_raw = fetch_events(windows["previous_window_start"], windows["previous_window_end"])
    email_cur, custom_cur = parse_events(events_cur_raw)
    email_prv, custom_prv = parse_events(events_prv_raw)
    log(f"  Events courants : {len(events_cur_raw)} | Précédents : {len(events_prv_raw)}")

    log("\n── Étape 4 : Récupération des réponses directes…")
    responses = fetch_responses(windows)

    log("\n── Étape 5 : Récupération du temps dans l'app…")
    timeinapp = fetch_timeinapp(windows)

    log("\n── Étape 6 : Récupération du snapshot des appareils…")
    devices = fetch_devices()

    log("\n── Étape 7 : Lecture du canvas Slack…")
    canvas_text  = read_canvas(SLACK_CANVAS_ID)
    canvas_state = parse_canvas_state(canvas_text, windows)
    open_alerts  = canvas_state.get("open_alerts", [])
    log(f"  Canvas lu : {'oui' if canvas_text else 'non (premier run)'}")
    log(f"  Alertes ouvertes dans le canvas : {len(open_alerts)}")

    log("\n── Étape 8 : Calcul des deltas et évaluation des seuils…")
    m = compute_metrics(
        step1, email_cur, email_prv, custom_cur, custom_prv,
        responses, timeinapp, devices, canvas_state, windows
    )
    triggered_alerts = evaluate_thresholds(m, canvas_state)
    log(f"  Alertes déclenchées : {len(triggered_alerts)}")
    for a in triggered_alerts:
        log(f"    → {a['key']} [{a.get('os','')}]")

    log("\n── Étape 8b : Analyse des causes racines…")
    causes: dict[str, str] = {}
    today_str = fmt_date(windows["today"])
    new_alerts, resolved_alerts, ongoing_alerts = anti_dupe(
        triggered_alerts, open_alerts, today_str
    )
    for a in new_alerts:
        causes[a["key"]] = root_cause(a, m, windows)
        log(f"  [{a['key']}] {causes[a['key']][:80]}…")

    log("\n── Étape 9 : Anti-duplication…")
    log(f"  Nouvelles : {len(new_alerts)} | Résolues : {len(resolved_alerts)} | En cours : {len(ongoing_alerts)}")

    all_open_after = (
        [a for a in open_alerts if a["key"] not in {r["key"] for r in resolved_alerts}]
        + [{**a, "last_seen": today_str} for a in ongoing_alerts]
        + [{**a, "opened": today_str, "last_seen": today_str} for a in new_alerts]
    )

    slack_posted = False

    log("\n── Étape 10 : Publication des messages Slack…")
    if new_alerts:
        alert_msg = build_alert_message(new_alerts, m, windows, causes)
        log(f"\n{'='*60}\nMESSAGE D'ALERTE :\n{'='*60}")
        log(alert_msg)
        log("=" * 60)
        if post_slack_message(SLACK_CHANNEL_ID, alert_msg):
            log("  ✅ Message d'alerte publié dans Slack")
            slack_posted = True
        else:
            log("  ⚠️  Échec de publication du message d'alerte")

    if resolved_alerts:
        canvas_url = CANVAS_URL
        for a in resolved_alerts:
            kpi = a["key"]
            os_label = a.get("os", "").capitalize()
            res_msg = (
                f"{t('resolved_header').format(client=CLIENT_NAME, today=today_str)}\n"
                f"{t('resolved_body').format(kpi=kpi, os=os_label)}\n"
                f"[📊 Canvas KPI]({canvas_url})"
            )
            log(f"\n{'='*60}\nMESSAGE DE RÉSOLUTION :\n{'='*60}")
            log(res_msg)
            log("=" * 60)
            if post_slack_message(SLACK_CHANNEL_ID, res_msg):
                log(f"  ✅ Résolution publiée : {kpi}")
                slack_posted = True

    if not new_alerts and not resolved_alerts:
        log("  ℹ️  Aucune alerte nouvelle ou résolue — pas de message Slack")

    log("\n── Étape 11 : Mise à jour du canvas…")
    canvas_content = build_canvas(m, windows, all_open_after, causes)
    log(f"\n{'='*60}\nCONTENU DU CANVAS :\n{'='*60}")
    log(canvas_content)
    log("=" * 60)
    if update_canvas(SLACK_CANVAS_ID, canvas_content):
        log(f"  ✅ Canvas mis à jour : {SLACK_CANVAS_ID}")
    else:
        log(f"  ⚠️  Échec de mise à jour du canvas {SLACK_CANVAS_ID}")

    log(f"\n{'='*60}")
    log(f"[airship-kpi-monitor] {CLIENT_NAME} — run {fmt_date(windows['today'])}")
    log(f"  Fenêtres : {fmt_date(windows['current_window_start'])}→{fmt_date(windows['current_window_end'])} vs {fmt_date(windows['previous_window_start'])}→{fmt_date(windows['previous_window_end'])}")
    log(f"  Nouvelles alertes : {len(new_alerts)} | Résolues : {len(resolved_alerts)} | En cours : {len(ongoing_alerts)}")
    log(f"  Canvas mis à jour : {SLACK_CANVAS_ID}")
    log(f"  Message Slack publié : {'oui' if slack_posted else 'non'}")
    log("=" * 60)


if __name__ == "__main__":
    main()
