#!/usr/bin/env python3
"""Classify Airship campaigns by type from reports data.

The Reports API does not label a push as "automated" or "recurring". This skill uses
**only the Reports + Content APIs** (it never calls `/api/pipelines` or `/api/schedules`).
Two complementary typology paths are provided:

1. `classify_activity(activities, names)` — **preferred** for the weekly top-campaigns
   section. Works on `/api/reports/activity/details` rows, which already carry the
   typology: `type` (`GROUP` = recurring/automation, `PUSH` = one-shot) and an
   `experiment` flag. Buckets each row experiment -> recurring -> one_shot, folds
   repeated one-shots sharing a normalized name into a recurring group, ranks by
   delivery volume, and computes per-series volume drift. The activity log excludes
   1:1 unicast sends, so this stays small and clean.

2. `classify(pushes, message_names)` — legacy `responses/list` path. Reconstructs
   typology heuristically by normalizing names, grouping by `group_id` else name,
   and detecting cadence. Kept for the email-delay root-cause correlation (Step 3c).

Both are pure functions — no network / MCP.

API:
  normalize_name(name) -> str
  classify_activity(activities, names=None, min_occurrences=3)
      -> {"summary": {...}, "entries": [...]}  (ranked by total delivery desc)
      activities: rows from /api/reports/activity/details (push_id, timestamp,
                  type PUSH|GROUP, experiment, details.delivery/interaction).
      names: optional {push_id: message_name} from decoded pushbodies.
      Each entry carries: bucket (one_shot|recurring|experiment), label, occurrences,
      total_sends, app_sends, web_sends, total_direct, volume_drift_pct,
      first/last_seen, push_ids.
  classify(pushes, message_names=None) -> {"summary": {...}, "campaigns": [...]}
      pushes: list of dicts from responses/list (need push_uuid, push_time;
              optional group_id, sends, direct_responses).
      message_names: optional {push_uuid: message_name} from decoded pushbodies.
"""
import re
import statistics
from collections import defaultdict
from datetime import datetime

# Tokens stripped from message names to collapse recurring variants to a stable key.
_DATE_PATTERNS = [
    r"\d{4}[-_/]\d{2}[-_/]\d{2}",          # 2026-06-07 / 2026_06_07
    r"\d{2}[-_/]\d{2}[-_/]\d{4}",          # 07-06-2026
    r"\b\d{8}\b",                           # 07062026 / 20260607
    r"\b\d{6}\b",                           # 070626
    r"\b\d{4}\b",                           # bare year/MMDD
]
_NOISE_PATTERNS = [
    r"\bv\d+\b",                            # v2, v10
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",  # uuid
    r"\b[0-9a-f]{12,}\b",                  # long hex/hash
    r"#\d+",                                # #123
]
_MONTHS = (r"jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|"
           r"janv|fevr|f\u00e9vr|mars|avr|mai|juin|juil|aout|ao\u00fbt|sept|oct|nov|dec|d\u00e9c")


def normalize_name(name):
    """Collapse a message name to a stable key by removing date/version/id tokens."""
    if not name:
        return ""
    s = name.lower()
    # Separators -> spaces FIRST so \b boundaries apply to underscore-delimited tokens
    # (e.g. "series_01062026" -> "series 01062026", letting the date pattern match).
    s = re.sub(r"[\W_]+", " ", s)
    for pat in _DATE_PATTERNS + _NOISE_PATTERNS:
        s = re.sub(pat, " ", s)
    s = re.sub(rf"\b({_MONTHS})\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _parse_time(t):
    if not t:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(t[:19], fmt)
        except ValueError:
            continue
    return None


def _cadence(times):
    """Infer cadence from sorted datetimes. Returns (label, median_gap_days)."""
    ds = sorted(t for t in times if t)
    if len(ds) < 2:
        return ("single", None)
    gaps = [(b - a).total_seconds() / 86400.0 for a, b in zip(ds, ds[1:])]
    gaps = [g for g in gaps if g > 0]
    if not gaps:
        return ("same-day burst", 0.0)
    med = statistics.median(gaps)
    if med <= 0.5:
        label = "intra-day"
    elif med <= 1.5:
        label = "daily"
    elif med <= 3.5:
        label = "every few days"
    elif med <= 10:
        label = "weekly"
    elif med <= 45:
        label = "monthly"
    else:
        label = "irregular"
    return (label, round(med, 1))


def classify(pushes, message_names=None):
    """Group pushes and tag each campaign one_shot / automated_recurring / ambiguous."""
    message_names = message_names or {}
    groups = defaultdict(list)
    for p in pushes:
        uuid = p.get("push_uuid") or p.get("push_id")
        gid = p.get("group_id")
        name = message_names.get(uuid)
        if gid:
            key = ("group", gid)
            label = name or gid
        elif name:
            norm = normalize_name(name)
            key = ("name", norm or name.lower())
            label = norm or name
        else:
            key = ("uuid", uuid)            # unknown name & no group -> standalone
            label = uuid
        groups[key].append((p, label))

    campaigns = []
    for key, members in groups.items():
        times = [_parse_time(p.get("push_time")) for p, _ in members]
        cad_label, med_gap = _cadence(times)
        occ = len(members)
        total_sends = sum(int(p.get("sends") or 0) for p, _ in members)
        total_direct = sum(int(p.get("direct_responses") or 0) for p, _ in members)
        ts = sorted(t for t in times if t)
        label = members[0][1]

        # Typology: recurring if multiple occurrences on a non-burst cadence,
        # or many occurrences even if cadence is loose.
        regular = cad_label in {"daily", "every few days", "weekly", "monthly"}
        if occ >= 3 and (regular or occ >= 5):
            ctype = "automated_recurring"
        elif occ == 1:
            ctype = "one_shot"
        elif occ == 2 and regular:
            ctype = "automated_recurring"
        else:
            ctype = "ambiguous"            # e.g. 2x same-day burst (likely a split send)

        campaigns.append({
            "key": "%s:%s" % key,
            "label": label,
            "type": ctype,
            "occurrences": occ,
            "cadence": cad_label,
            "median_gap_days": med_gap,
            "total_sends": total_sends,
            "total_direct_responses": total_direct,
            "first_seen": ts[0].isoformat() if ts else None,
            "last_seen": ts[-1].isoformat() if ts else None,
            "push_uuids": [(p.get("push_uuid") or p.get("push_id")) for p, _ in members],
        })

    campaigns.sort(key=lambda c: c["total_sends"], reverse=True)
    summary = {
        "one_shot": sum(1 for c in campaigns if c["type"] == "one_shot"),
        "automated_recurring": sum(1 for c in campaigns if c["type"] == "automated_recurring"),
        "ambiguous": sum(1 for c in campaigns if c["type"] == "ambiguous"),
    }
    return {"summary": summary, "campaigns": campaigns}


def _activity_delivery(row):
    """App + web delivery (sends proxy) from an activity/details row."""
    d = (row.get("details") or {}).get("delivery") or {}
    app = d.get("app") or {}
    web = d.get("web") or {}
    app_sends = (int(app.get("alerting") or 0)
                 + int(app.get("silent") or 0)
                 + int(app.get("rich") or 0))
    web_sends = int((web or {}).get("total") or 0)
    return app_sends, web_sends


def _activity_direct(row):
    """Direct opens from an activity/details row (-1 = not measured -> None)."""
    app = ((row.get("details") or {}).get("interaction") or {}).get("app") or {}
    val = app.get("direct")
    return int(val) if isinstance(val, (int, float)) and val >= 0 else None


def classify_activity(activities, names=None, min_occurrences=3):
    """Classify Activity Log rows (/api/reports/activity/details) by type.

    Buckets (priority): experiment -> recurring (type GROUP) -> one_shot (type PUSH).
    Repeated one-shots sharing a normalized message name are folded into a recurring
    group (best-effort, needs `names`). Empty-delivery rows are dropped. Entries are
    ranked by total delivery; recurring entries carry volume_drift_pct (latest vs
    median of prior occurrences).
    """
    names = names or {}
    rows = []
    for a in activities:
        pid = a.get("push_id") or a.get("push_uuid")
        app_sends, web_sends = _activity_delivery(a)
        if app_sends == 0 and web_sends == 0:
            continue  # non-delivering schedule / canceled send — not a campaign
        rows.append({
            "push_id": pid,
            "timestamp": a.get("timestamp"),
            "type": (a.get("type") or "PUSH").upper(),
            "experiment": bool(a.get("experiment")),
            "app_sends": app_sends,
            "web_sends": web_sends,
            "sends": app_sends + web_sends,
            "direct": _activity_direct(a),
            "name": names.get(pid),
        })

    name_counts = defaultdict(int)
    for r in rows:
        if r["name"]:
            name_counts[normalize_name(r["name"]) or r["name"].lower()] += 1

    fam = defaultdict(list)   # (bucket, key) -> rows (recurring/experiment + folds)
    singles = []              # genuine one-shots
    for r in rows:
        norm = normalize_name(r["name"]) if r["name"] else None
        if r["experiment"]:
            fam[("experiment", norm or r["push_id"])].append(r)
        elif r["type"] == "GROUP":
            fam[("recurring", norm or r["push_id"])].append(r)
        elif norm and name_counts[norm] >= min_occurrences:
            fam[("recurring", norm)].append(r)   # repeated one-shot -> recurring
        else:
            singles.append(r)

    entries = []
    for (bucket, _key), members in fam.items():
        members.sort(key=lambda m: m.get("timestamp") or "")
        series = [m["sends"] for m in members]
        drift = None
        if len(series) >= 2:
            med = statistics.median(series[:-1])
            if med:
                drift = round((series[-1] - med) / med * 100, 1)
        label = next((m["name"] for m in members if m["name"]), members[0]["push_id"])
        entries.append({
            "bucket": bucket,
            "label": label,
            "occurrences": len(members),
            "total_sends": sum(series),
            "app_sends": sum(m["app_sends"] for m in members),
            "web_sends": sum(m["web_sends"] for m in members),
            "total_direct": sum((m["direct"] or 0) for m in members),
            "volume_drift_pct": drift,
            "first_seen": members[0].get("timestamp"),
            "last_seen": members[-1].get("timestamp"),
            "push_ids": [m["push_id"] for m in members],
        })
    for r in singles:
        entries.append({
            "bucket": "one_shot",
            "label": r["name"] or r["push_id"],
            "occurrences": 1,
            "total_sends": r["sends"],
            "app_sends": r["app_sends"],
            "web_sends": r["web_sends"],
            "total_direct": r["direct"] or 0,
            "volume_drift_pct": None,
            "first_seen": r["timestamp"],
            "last_seen": r["timestamp"],
            "push_ids": [r["push_id"]],
        })

    entries.sort(key=lambda e: e["total_sends"], reverse=True)
    summary = {
        "one_shot": sum(1 for e in entries if e["bucket"] == "one_shot"),
        "recurring": sum(1 for e in entries if e["bucket"] == "recurring"),
        "experiment": sum(1 for e in entries if e["bucket"] == "experiment"),
        "rows_kept": len(rows),
    }
    return {"summary": summary, "entries": entries}


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) > 1:
        data = json.load(open(sys.argv[1], encoding="utf-8"))
        pushes = data.get("pushes", data) if isinstance(data, dict) else data
        names = data.get("message_names") if isinstance(data, dict) else None
    else:  # tiny self-demo
        pushes = [
            {"push_uuid": "a", "push_time": "2026-06-01 17:00:00", "sends": 500000,
             "group_id": None, "direct_responses": 1200},
            {"push_uuid": "b", "push_time": "2026-06-02 17:00:00", "sends": 510000,
             "direct_responses": 1100},
            {"push_uuid": "c", "push_time": "2026-06-03 17:00:00", "sends": 505000,
             "direct_responses": 1150},
            {"push_uuid": "z", "push_time": "2026-06-04 09:00:00", "sends": 900000,
             "direct_responses": 5000},
        ]
        names = {"a": "brand_push_series_01062026", "b": "brand_push_series_02062026",
                 "c": "brand_push_series_03062026", "z": "Soldes_ete_lancement"}
    print(json.dumps(classify(pushes, names), indent=2, ensure_ascii=False))
