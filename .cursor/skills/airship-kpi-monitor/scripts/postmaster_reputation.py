#!/usr/bin/env python3
"""Fetch Gmail domain reputation from Google Postmaster Tools.

OPTIONAL. Gives the skill a market-reference deliverability signal to sit beside
the internally-computed sender score. Google Postmaster Tools (GPT) is the
reference for Gmail: it reports the reputation Gmail actually assigns to a
SENDING DOMAIN, the spam rate real users reported, and SPF/DKIM/DMARC pass
rates.

Why domain and not IP: Airship delivers through SparkPost shared IP pools, so
IP-based scores (Validity Sender Score, Microsoft SNDS) grade the shared
infrastructure, not the client. The domain is the client-specific axis.

Prerequisites (once per Google Cloud project):
  1. Enable the "Gmail Postmaster Tools API" in a GCP project.
  2. Create a service account and download its JSON key.

Prerequisites (once per client, done BY THE CLIENT — they own the domain):
  3. Verify the sending domain in https://postmaster.google.com
  4. Add the service account's email address as a user on that domain.

Then:
    uv run --with google-auth --with requests scripts/postmaster_reputation.py \
        --key ~/.cursor/airship-kpi-monitor/gpt-service-account.json \
        --domain email.example.com --days 30

    # Which domains has this service account actually been granted?
    uv run --with google-auth --with requests scripts/postmaster_reputation.py \
        --key <path> --check

Output is JSON on stdout. Exit codes: 0 ok, 2 no data, 3 access/auth problem,
4 bad usage. The skill treats any non-zero exit as "reputation unavailable" and
falls back to its own computed sender score.

GPT caveats the caller must respect:
  - Gmail traffic ONLY. It says nothing about Outlook, Yahoo or corporate MX.
  - Data lags ~2-3 days, so the most recent days of a window are often absent.
  - Google withholds a day entirely when volume to Gmail is too low, so small
    senders legitimately return no rows.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

try:
    import requests
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account
except ModuleNotFoundError:
    sys.exit(
        "Missing dependencies. Run this script via:\n"
        "    uv run --with google-auth --with requests "
        "scripts/postmaster_reputation.py ..."
    )

API_ROOT = "https://gmailpostmastertools.googleapis.com/v1"
SCOPES = ["https://www.googleapis.com/auth/postmaster.readonly"]

# GPT returns a category, not a number. Keep it categorical — mapping it onto a
# 0-100 scale would invent precision Google never published.
REPUTATION_ORDER = {"BAD": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}


def build_session(key_path: Path, subject: str | None) -> requests.Session:
    creds = service_account.Credentials.from_service_account_file(
        str(key_path), scopes=SCOPES
    )
    if subject:
        creds = creds.with_subject(subject)
    creds.refresh(Request())
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {creds.token}"
    return session


def get(session: requests.Session, path: str, params: dict | None = None) -> dict:
    resp = session.get(f"{API_ROOT}/{path}", params=params, timeout=30)
    if resp.status_code in (401, 403):
        raise PermissionError(
            f"{resp.status_code} on /{path}. The service account is probably not "
            "registered as a user on this domain in postmaster.google.com, or the "
            "Postmaster Tools API is not enabled in the project."
        )
    if resp.status_code == 404:
        raise LookupError(
            f"404 on /{path}. The domain is not verified in Postmaster Tools, or "
            "it is not shared with this service account."
        )
    resp.raise_for_status()
    return resp.json()


def date_params(prefix: str, day: date) -> dict:
    return {
        f"{prefix}.year": day.year,
        f"{prefix}.month": day.month,
        f"{prefix}.day": day.day,
    }


def summarise(rows: list[dict]) -> dict:
    """Reduce a window of daily rows to what the canvas needs."""

    def avg(key: str) -> float | None:
        vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
        return round(sum(vals) / len(vals), 6) if vals else None

    reputations = [
        r["domainReputation"]
        for r in rows
        if r.get("domainReputation") in REPUTATION_ORDER
    ]
    # Report the WORST day in the window, not the average: one bad day is the
    # signal a TAM needs to see, and averaging categories would hide it.
    worst = (
        min(reputations, key=lambda r: REPUTATION_ORDER[r]) if reputations else None
    )
    latest = rows[-1] if rows else {}

    errors = {}
    for row in rows:
        for err in row.get("deliveryErrors", []) or []:
            ratio = err.get("errorRatio")
            if isinstance(ratio, (int, float)):
                key = f"{err.get('errorClass', '?')}/{err.get('errorType', '?')}"
                errors[key] = max(errors.get(key, 0.0), ratio)

    return {
        "days_with_data": len(rows),
        "first_day": rows[0]["name"].rsplit("/", 1)[-1] if rows else None,
        "last_day": rows[-1]["name"].rsplit("/", 1)[-1] if rows else None,
        "domain_reputation_worst": worst,
        "domain_reputation_latest": latest.get("domainReputation"),
        "user_reported_spam_ratio_avg": avg("userReportedSpamRatio"),
        "user_reported_spam_ratio_max": max(
            (
                r["userReportedSpamRatio"]
                for r in rows
                if isinstance(r.get("userReportedSpamRatio"), (int, float))
            ),
            default=None,
        ),
        "spf_success_ratio_avg": avg("spfSuccessRatio"),
        "dkim_success_ratio_avg": avg("dkimSuccessRatio"),
        "dmarc_success_ratio_avg": avg("dmarcSuccessRatio"),
        "ip_reputations_latest": latest.get("ipReputations"),
        "top_delivery_errors": sorted(
            ({"error": k, "max_ratio": v} for k, v in errors.items()),
            key=lambda e: e["max_ratio"],
            reverse=True,
        )[:3],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--key", required=True, help="Path to the service-account JSON key")
    ap.add_argument("--domain", help="Sending domain, e.g. email.example.com")
    ap.add_argument("--days", type=int, default=30, help="Window length (default 30, matching the skill's analysis window)")
    ap.add_argument(
        "--subject",
        help="Optional user to impersonate (Workspace domain-wide delegation)",
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="List the domains this service account can read, then exit",
    )
    args = ap.parse_args()

    key_path = Path(args.key).expanduser()
    if not key_path.exists():
        print(json.dumps({"error": f"key file not found: {key_path}"}))
        return 4
    if not args.check and not args.domain:
        print(json.dumps({"error": "--domain is required unless --check is used"}))
        return 4

    try:
        session = build_session(key_path, args.subject)
        if args.check:
            payload = get(session, "domains")
            domains = [d["name"].rsplit("/", 1)[-1] for d in payload.get("domains", [])]
            print(json.dumps({"accessible_domains": domains}, indent=2))
            return 0 if domains else 2

        # GPT lags ~2-3 days; end yesterday and let the caller see how many days
        # actually came back rather than silently shortening the window.
        end = date.today() - timedelta(days=1)
        start = end - timedelta(days=args.days - 1)
        params = {"pageSize": 100}
        params.update(date_params("startDate", start))
        params.update(date_params("endDate", end))

        payload = get(session, f"domains/{args.domain}/trafficStats", params)
        rows = sorted(payload.get("trafficStats", []), key=lambda r: r["name"])
        result = {
            "domain": args.domain,
            "requested_window": {"start": start.isoformat(), "end": end.isoformat()},
            "source": "Google Postmaster Tools API v1 (Gmail traffic only)",
            **summarise(rows),
        }
        print(json.dumps(result, indent=2))
        return 0 if rows else 2

    except (PermissionError, LookupError) as exc:
        print(json.dumps({"error": str(exc)}))
        return 3
    except requests.HTTPError as exc:
        print(json.dumps({"error": f"HTTP error: {exc}"}))
        return 3


if __name__ == "__main__":
    sys.exit(main())
