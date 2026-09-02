#!/usr/bin/env python3
"""Fetch per-client deliverability from SparkPost, the ESP Airship delivers through.

OPTIONAL. Answers the two questions Airship's own Reports API cannot: *which
mailbox provider* is degrading, and *why* mail is delayed or bounced. Airship
reports totals — delivered, bounced, delayed — with no provider split and no
reason. SparkPost, as the actual sending infrastructure, has both.

Why this beats the alternatives for our setup:
  - Google Postmaster Tools covers Gmail ONLY and lags 2-3 days. This covers
    every provider (Gmail, Outlook, Yahoo, Orange, Free, corporate MX...) with
    no lag.
  - IP-reputation tools (Validity Sender Score, Microsoft SNDS) grade the shared
    SparkPost IP pool, so they return the same score for every client and the
    client has no lever on it. Filtering by SENDING DOMAIN is what isolates one
    client's reputation.

What is NOT available here: the SparkPost **Health Score** has no public API
endpoint. It is a proprietary Signals model, readable in the dashboard only. It
can still reach us as a push notification — see MODOP.md on wiring a Health
Score alert to a Slack webhook.

Credentials: ONE key for the whole Airship account, so no per-client setup and
nothing to ask the client. Read-only, grants "Metrics: Read" (required) and
"Message Events: Read" (optional). Supply it as the SPARKPOST_API_KEY env var
or via --key-file. Never pass a key on the command line — argv is world-readable
in `ps`.

Because that one key sees EVERY client in the account, --sending-domain is
mandatory: it is what scopes a call to a single client. Passing no filter would
return Airship-wide aggregates and risk showing one client another's numbers.

    # Validate the key/region and list the domains that actually sent
    uv run --with requests scripts/sparkpost_deliverability.py --check --region eu

    # One client, last 30 days
    uv run --with requests scripts/sparkpost_deliverability.py \
        --region eu --sending-domain email.example.com --days 30

Output is JSON on stdout. Exit codes: 0 ok, 2 no data in the window, 3
access/auth/plan problem, 4 bad usage. The skill treats any non-zero exit as
"SparkPost unavailable" and renders the email block from Airship data alone.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import requests
except ModuleNotFoundError:
    sys.exit(
        "Missing dependencies. Run this script via:\n"
        "    uv run --with requests scripts/sparkpost_deliverability.py ..."
    )

HOSTS = {
    "eu": "https://api.eu.sparkpost.com/api/v1",
    "us": "https://api.sparkpost.com/api/v1",
}

# Everything needed to rebuild deliverability, bounce, complaint, delay and
# engagement rates. Placement metrics (count_inbox_panel, count_spam_panel...)
# are deliberately absent: they need the paid Deliverability Add-On and 403 on
# accounts without it.
METRICS = [
    "count_injected",
    "count_sent",
    "count_accepted",
    "count_delivered",
    "count_bounce",
    "count_hard_bounce",
    "count_soft_bounce",
    "count_block_bounce",
    "count_admin_bounce",
    "count_spam_complaint",
    "count_delayed",
    "count_delayed_first",
    "count_unsubscribe",
    "count_unique_confirmed_opened",
    "count_unique_clicked",
]

# The reason/classification endpoints accept a NARROWER metric set than the
# aggregate ones — count_hard_bounce and count_block_bounce are rejected with a
# 400 here. The bounce class comes back as a label anyway (bounce_class_name,
# bounce_category_name), which is more useful than the split counters.
BOUNCE_METRICS = [
    "count_bounce",
    "count_inband_bounce",
    "count_outofband_bounce",
    "count_admin_bounce",
]


class AccessError(Exception):
    """Auth, permission or plan-tier problem — distinct from 'no data'."""


def resolve_key(key_file: str | None) -> str:
    if key_file:
        path = Path(key_file).expanduser()
        if not path.exists():
            raise SystemExit(json.dumps({"error": f"key file not found: {path}"}))
        return path.read_text().strip()
    key = os.environ.get("SPARKPOST_API_KEY", "").strip()
    if not key:
        raise SystemExit(
            json.dumps(
                {
                    "error": "no API key: set SPARKPOST_API_KEY or pass --key-file",
                }
            )
        )
    return key


def get(session: requests.Session, base: str, path: str, params: dict) -> dict:
    """GET with the documented 429 backoff. Raises AccessError on 401/403/404."""
    url = f"{base}/{path}"
    for attempt in range(4):
        resp = session.get(url, params=params, timeout=30)
        if resp.status_code == 429:
            time.sleep(1 + 2 * attempt)
            continue
        if resp.status_code in (401, 403):
            raise AccessError(
                f"{resp.status_code} on /{path}. Either the API key is invalid for "
                f"this region, it lacks the 'Metrics: Read' grant, or the plan does "
                f"not include this resource. Body: {resp.text[:300]}"
            )
        if resp.status_code == 404:
            raise AccessError(f"404 on /{path} — endpoint not available on this account.")
        resp.raise_for_status()
        return resp.json()
    raise AccessError(f"rate limited repeatedly on /{path}")


def pct(numerator: float | None, denominator: float | None) -> float | None:
    """Percentage, or None when the base is too small to mean anything."""
    if not denominator or numerator is None:
        return None
    return round(numerator / denominator * 100, 3)


def rates(row: dict) -> dict:
    """Derive the rates the canvas shows, so the caller never redoes arithmetic."""
    injected = row.get("count_injected") or 0
    delivered = row.get("count_delivered") or 0
    return {
        "injected": injected,
        "delivered": delivered,
        "delivery_rate": pct(delivered, injected),
        "bounce_rate": pct(row.get("count_bounce"), injected),
        "hard_bounce_rate": pct(row.get("count_hard_bounce"), injected),
        "block_bounce_rate": pct(row.get("count_block_bounce"), injected),
        "admin_bounce_rate": pct(row.get("count_admin_bounce"), injected),
        # Two different questions, and only the first one is alertable.
        # `count_delayed` counts delay EVENTS: one message retried five times
        # scores five, so this ratio routinely exceeds 100% (Client Charlie hit
        # 485%) and is meaningless against a percentage ceiling. Keep it as the
        # retry-pressure diagnostic it actually is, and derive the per-message
        # rate from `count_delayed_first` — messages deferred on their first
        # attempt — which is bounded by 100% and is what a threshold can read.
        "delay_rate": pct(row.get("count_delayed_first"), injected),
        "delay_retries_per_delivered": pct(row.get("count_delayed"), delivered),
        "spam_complaint_rate": pct(row.get("count_spam_complaint"), delivered),
        "unsubscribe_rate": pct(row.get("count_unsubscribe"), delivered),
        "open_rate": pct(row.get("count_unique_confirmed_opened"), delivered),
        "click_rate": pct(row.get("count_unique_clicked"), delivered),
    }


FMT = "%Y-%m-%dT%H:%M"


def window(days: int, start_ts: str | None = None, end_ts: str | None = None) -> tuple[str, str]:
    """SparkPost wants YYYY-MM-DDTHH:MM, interpreted in the --timezone passed.

    Explicit --from/--to win, and callers should use them: the canvas compares
    whole local days, so a window anchored on "now" would silently straddle a
    day boundary and never quite match the Airship figures beside it.
    """
    if start_ts and end_ts:
        return start_ts, end_ts
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    return start.strftime(FMT), end.strftime(FMT)


def run_check(session: requests.Session, base: str, days: int, match: str | None) -> int:
    start, end = window(days)
    params = {"from": start, "to": end, "limit": 1000}
    if match:
        params["match"] = match
    payload = get(session, base, "metrics/sending-domains", params)

    # The "list the available values" endpoints nest their list under the
    # resource name and return bare strings — unlike the deliverability
    # endpoints, which return a flat list of objects.
    results = payload.get("results", {})
    raw = results.get("sending-domains", []) if isinstance(results, dict) else results
    domains = sorted(d if isinstance(d, str) else d.get("sending_domain") for d in raw if d)

    print(
        json.dumps(
            {
                "ok": True,
                "region_base_url": base,
                "window": {"start": start, "end": end, "days": days},
                "sending_domain_count": len(domains),
                "sending_domains_with_activity": domains,
                "hint": "This key sees EVERY client on the account. Put the one you want "
                "in clients.yml under the client's email.sending_domains.",
            },
            indent=2,
        )
    )
    return 0 if domains else 2


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--region", choices=("eu", "us"), default="eu", help="SparkPost tenancy")
    ap.add_argument("--key-file", help="File containing the API key (else $SPARKPOST_API_KEY)")
    ap.add_argument("--sending-domain", help="Client sending domain, e.g. email.example.com")
    ap.add_argument("--subaccount", help="Optional subaccount id, narrows further")
    ap.add_argument("--days", type=int, default=30, help="Window length (default 30, matching the skill's analysis window)")
    ap.add_argument(
        "--from",
        dest="from_ts",
        metavar="YYYY-MM-DDTHH:MM",
        help="Explicit window start, read in --timezone. Overrides --days. Use this "
        "to align exactly with the Airship window shown beside it.",
    )
    ap.add_argument(
        "--to", dest="to_ts", metavar="YYYY-MM-DDTHH:MM", help="Explicit window end"
    )
    ap.add_argument("--timezone", default="UTC", help="IANA tz for day boundaries")
    ap.add_argument("--limit", type=int, default=8, help="Rows per breakdown (default 8)")
    ap.add_argument(
        "--with-ips",
        action="store_true",
        help="Add the per-sending-IP breakdown and classify each IP as shared or "
        "dedicated by listing the other domains it served in the window. Costs "
        "one extra call per IP, so it is opt-in.",
    )
    ap.add_argument("--check", action="store_true", help="Validate key, list active domains")
    ap.add_argument("--match", help="With --check, substring-filter the domain list")
    args = ap.parse_args()

    if not args.check and not args.sending_domain:
        print(
            json.dumps(
                {
                    "error": "--sending-domain is required (it is what scopes the call "
                    "to one client). Use --check to discover the available domains."
                }
            )
        )
        return 4

    base = HOSTS[args.region]
    session = requests.Session()
    session.headers.update(
        {"Authorization": resolve_key(args.key_file), "Content-Type": "application/json"}
    )

    try:
        if args.check:
            return run_check(session, base, args.days, args.match)

        start, end = window(args.days, args.from_ts, args.to_ts)
        common = {
            "from": start,
            "to": end,
            "timezone": args.timezone,
            "sending_domains": args.sending_domain,
        }
        if args.subaccount:
            common["subaccounts"] = args.subaccount

        totals_rows = get(
            session,
            base,
            "metrics/deliverability",
            {**common, "metrics": ",".join(METRICS)},
        ).get("results", [])
        totals = totals_rows[0] if totals_rows else {}

        providers = get(
            session,
            base,
            "metrics/deliverability/mailbox-provider",
            {
                **common,
                "metrics": ",".join(METRICS),
                "limit": args.limit,
                "order_by": "count_injected",
            },
        ).get("results", [])

        # Reason breakdowns are the whole point: they turn "12.7% delayed" into
        # "Gmail mailboxes are full". Losing one must never fail the run — a plan
        # restriction or a per-endpoint schema quirk degrades to an empty list.
        def optional(path: str, params: dict) -> list:
            try:
                return get(session, base, path, params).get("results", [])
            except (AccessError, requests.HTTPError):
                return []

        delay_reasons = optional(
            "metrics/deliverability/delay-reason/domain", {**common, "limit": args.limit}
        )
        bounce_reasons = optional(
            "metrics/deliverability/bounce-reason/domain",
            {**common, "metrics": ",".join(BOUNCE_METRICS), "limit": args.limit},
        )
        bounce_classes = optional(
            "metrics/deliverability/bounce-classification",
            {**common, "metrics": "count_bounce", "limit": args.limit},
        )

        # --- sending IPs, and whether each is shared -------------------------
        # Airship sends over SparkPost IP pools, so a client can inherit its
        # neighbours' reputation without anything in its own numbers explaining
        # why. Pool NAMES are a convention, not proof: `client-bravo_mkt` looks
        # dedicated and is (two markets of one brand), while Client Delta pushes 90% of
        # its volume over IPs that answer to no named pool at all. The only
        # reliable test is to ask which sending domains each IP actually served.
        ips: list = []
        if args.with_ips:
            ip_rows = optional(
                "metrics/deliverability/sending-ip",
                {**common, "metrics": ",".join(METRICS), "limit": 50,
                 "order_by": "count_injected"},
            )
            pool_rows = optional(
                "metrics/deliverability/ip-pool",
                {**common, "metrics": "count_injected", "limit": 50},
            )
            pool_of = {}
            for pr in pool_rows:
                pool_of[pr.get("ip_pool")] = pr.get("count_injected")

            def neighbours(ip: str) -> list:
                rows = optional(
                    "metrics/deliverability/sending-domain",
                    {**{k: v for k, v in common.items() if k != "sending_domains"},
                     "metrics": "count_injected", "limit": 100, "sending_ips": ip},
                )
                return [
                    {"sending_domain": r.get("sending_domain"),
                     "injected": r.get("count_injected")}
                    for r in rows
                    if r.get("sending_domain") != args.sending_domain
                ]

            for row in ip_rows:
                ip = row.get("sending_ip")
                others = neighbours(ip) if ip else []
                ips.append({
                    "sending_ip": ip,
                    **rates(row),
                    "shared": bool(others),
                    "co_tenant_count": len(others),
                    "co_tenants": [o["sending_domain"] for o in others[:12]],
                })
            shared_vol = sum(i["injected"] for i in ips if i["shared"])
            total_vol = sum(i["injected"] for i in ips) or 0

        result = {
            "source": "SparkPost Metrics API",
            "region": args.region,
            "sending_domain": args.sending_domain,
            "subaccount": args.subaccount,
            "window": {"start": start, "end": end, "days": args.days, "tz": args.timezone},
            "totals": {**rates(totals), "raw": totals},
            "by_mailbox_provider": [
                {"mailbox_provider": p.get("mailbox_provider"), **rates(p)} for p in providers
            ],
            "top_delay_reasons": delay_reasons,
            "top_bounce_reasons": bounce_reasons,
            "bounce_classifications": bounce_classes,
            "by_sending_ip": ips,
            "ip_exposure": (
                {
                    "ip_count": len(ips),
                    "shared_ip_count": sum(1 for i in ips if i["shared"]),
                    "shared_volume_pct": (
                        round(shared_vol / total_vol * 100, 2) if ips and total_vol else None
                    ),
                    "worst_co_tenant_count": max((i["co_tenant_count"] for i in ips), default=0),
                }
                if args.with_ips
                else None
            ),
            "notes": {
                "health_score": "Not exposed by any public API; dashboard or alert webhook only.",
                "placement": "Inbox/spam placement omitted — requires the paid Deliverability Add-On.",
            },
        }
        print(json.dumps(result, indent=2))
        return 0 if (totals.get("count_injected") or 0) > 0 else 2

    except AccessError as exc:
        print(json.dumps({"error": str(exc)}))
        return 3
    except requests.HTTPError as exc:
        print(json.dumps({"error": f"HTTP error: {exc}"}))
        return 3
    except requests.RequestException as exc:
        print(json.dumps({"error": f"network error: {exc}"}))
        return 3


if __name__ == "__main__":
    sys.exit(main())
