#!/usr/bin/env python3
"""Optimized, channel-aware extractor for Airship campaign ``push_body`` payloads.

The weekly recap (SKILL.md Step 10b) shows a small text preview of the top
campaigns: the title / subject and a short text snippet (no images). A
``push_body`` from ``/api/reports/perpush/pushbody/{push_id}`` is **base64-encoded
JSON** and can be large (a full HTML email is easily > 100 KB), so extraction must
be cheap and channel-aware. This module is the reusable, pure-function extractor
those steps call. It is **optional** — agents may inline the same logic — and does
**no** network / MCP: you pass it the already-fetched ``push_body`` (or decoded
dict).

Validated live against: Carrefour (push + message center), Libon (SMS, in-app
scene), M6 (email, push, in-app automation).

Cost controls handled by the caller (see SKILL.md 7b.6): fetch ``pushbody`` only
for the ranked shortlist, cache decoded JSON per run. This module adds the third:
a **bounded HTML parse** — strip ``<head>``/``<style>``/``<script>``/comments
*before* scanning for the hero image (scanning the raw first 8 KB fails on real
emails whose leading ``<style>`` block pushes the first ``<img>`` out of range).

API:
  decode_push_body(push_body) -> dict
  extract(push_body_or_dict, prefer_lang="fr") -> {
      "channels": [str, ...],          # every channel present in this campaign
      "channel":  str,                 # primary channel (first detected)
      "hero_image": str | None,        # https media URL (recap surfaces are text-only; unused there)
      "title":    str | None,          # push/MC title (email: mirrors subject)
      "subject":  str | None,          # email subject
      "snippet":  str | None,          # short plain-text body preview (<= ~200 chars)
  }
  clean_html(html) -> str
  hero_image_from_html(html) -> str | None
  snippet_from_html(html, n=200) -> str | None
  collect_media(obj) -> [str, ...]     # recursive https media URLs
  resolve_sms_alert(text, prefer_lang="fr") -> str
"""
import base64
import html as _html
import json
import re

_IMG_KEYS = ("url", "media_url", "background_image", "image", "src", "icon")
_IMG_EXT = re.compile(r"\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)", re.I)


def decode_push_body(push_body):
    """Base64-decode a push_body string into a dict (pass-through if already a dict)."""
    if isinstance(push_body, dict):
        return push_body
    if not push_body:
        return {}
    raw = base64.b64decode(push_body)
    return json.loads(raw.decode("utf-8", "replace"))


# --- HTML helpers (bounded parse) ------------------------------------------------
def clean_html(html):
    """Strip head/style/script/comments so the remaining body holds real content."""
    if not html:
        return ""
    h = re.sub(r"<!--.*?-->", " ", html, flags=re.S)
    h = re.sub(r"<head\b.*?</head>", " ", h, flags=re.S | re.I)
    h = re.sub(r"<style\b.*?</style>", " ", h, flags=re.S | re.I)
    h = re.sub(r"<script\b.*?</script>", " ", h, flags=re.S | re.I)
    return h


def hero_image_from_html(html):
    """First real <img src> or CSS background-image URL in the cleaned body."""
    body = clean_html(html)
    m = re.search(r"<img[^>]+src\s*=\s*[\"']([^\"']+)[\"']", body, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"background(?:-image)?\s*:\s*url\(\s*[\"']?([^\"')]+)", body, re.I)
    if m:
        return m.group(1).strip()
    return None


def snippet_from_html(html, n=200):
    """Plain-text preview from cleaned HTML: strip tags, decode entities, truncate."""
    body = clean_html(html)
    text = re.sub(r"<[^>]+>", " ", body)
    text = _html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    return text[: n - 1] + "\u2026" if len(text) > n else text


# --- recursive media collector (scenes / nested layouts) -------------------------
def collect_media(obj, out=None, _refs=None):
    """Recursively collect https media URLs from any nested structure."""
    if out is None:
        out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and k.lower() in _IMG_KEYS and _is_media_url(v):
                out.append(v)
            else:
                collect_media(v, out, _refs)
    elif isinstance(obj, list):
        for it in obj:
            collect_media(it, out, _refs)
    return out


def _is_media_url(s):
    return isinstance(s, str) and s.startswith(("http://", "https://")) and (
        bool(_IMG_EXT.search(s)) or "image" in s.lower() or "media" in s.lower()
    )


# --- SMS (multilingual Handlebars) ----------------------------------------------
def resolve_sms_alert(text, prefer_lang="fr"):
    """Resolve an Airship SMS Handlebars template to a single language's text.

    Handles ``{{#eq language "fr"}}...{{else}}...{{/eq}}`` style templates and
    strips remaining Handlebars tags. Falls back to the whole cleaned string.
    """
    if not text:
        return None
    m = re.search(
        r"\{\{#eq\s+language\s+[\"']" + re.escape(prefer_lang) + r"[\"']\}\}(.*?)\{\{",
        text,
        re.S | re.I,
    )
    chosen = m.group(1) if m else text
    chosen = re.sub(r"\{\{.*?\}\}", "", chosen, flags=re.S)
    chosen = re.sub(r"\s+", " ", chosen).strip()
    return chosen or None


def _find(obj, *path):
    cur = obj
    for key in path:
        if isinstance(cur, dict) and key in cur:
            cur = cur[key]
        else:
            return None
    return cur


# --- main extractor --------------------------------------------------------------
def extract(push_body_or_dict, prefer_lang="fr"):
    d = decode_push_body(push_body_or_dict)
    channels = []
    hero = None
    title = None
    subject = None
    snippet = None

    push = d.get("push") if isinstance(d.get("push"), dict) else {}
    notif = d.get("notification") if isinstance(d.get("notification"), dict) else {}
    # A pushbody often wraps the notification under ``push`` (per-restaurant / segment
    # pushes), not at the top level. Fall back so push campaigns are still detected.
    if not notif and isinstance(push.get("notification"), dict):
        notif = push["notification"]
    message = d.get("message") if isinstance(d.get("message"), dict) else {}
    if not message and isinstance(push.get("message"), dict):
        message = push["message"]

    # In-app scene / layout or legacy modal
    if "in_app_message" in d or "layout" in d or _find(d, "reporting_context", "content_types"):
        channels.append("in_app")
        media = _find(d, "in_app_message", "message", "display", "media", "url")
        if not media:
            found = collect_media(d)
            media = found[0] if found else None
        hero = hero or media
        snippet = snippet or _find(d, "in_app_message", "message", "display", "body", "text")

    # SMS
    if _find(notif, "sms") is not None:
        channels.append("sms")
        alert = _find(notif, "sms", "template", "fields", "alert")
        snippet = snippet or resolve_sms_alert(alert, prefer_lang)

    # Message center
    if "template" in message or "icons" in message or "body" in message:
        channels.append("message_center")
        hero = hero or _find(message, "icons", "list_icon")
        html_body = _find(message, "template", "fields", "html_body") or message.get("body")
        if isinstance(html_body, str):
            hero = hero or hero_image_from_html(html_body)
            snippet = snippet or snippet_from_html(html_body)
        title = title or message.get("title")

    # Email — HTML under push.message.body (legacy) or push.notification.email.template
    email_html = _find(push, "message", "body")
    if not (isinstance(email_html, str) and "<" in email_html):
        email_html = _find(push, "notification", "email", "template", "fields", "html_body")
    is_email = (
        "email" in (push.get("device_types") or [])
        or _find(push, "notification", "email") is not None
        or (isinstance(email_html, str) and "<" in email_html)
    )
    if is_email:
        channels.append("email")
        if isinstance(email_html, str):
            hero = hero or hero_image_from_html(email_html)
            snippet = snippet or snippet_from_html(email_html)
        subject = (
            subject
            or _find(push, "message", "subject")
            or _find(push, "notification", "email", "template", "fields", "subject")
        )
        title = title or subject

    # Push (mobile / web) — not when this payload is email-only
    email_only = push.get("device_types") == ["email"]
    if notif and not email_only and (
        "ios" in notif or "android" in notif or "web" in notif or "alert" in notif
    ):
        channels.append("push")
        hero = hero or _find(notif, "ios", "media_attachment", "url")
        hero = hero or _find(notif, "android", "style", "big_picture")
        hero = hero or _find(notif, "web", "image") or _find(notif, "web", "icon")
        alert = notif.get("alert") or _find(notif, "ios", "alert") or _find(notif, "android", "alert")
        if isinstance(alert, dict):
            alert = alert.get("body") or alert.get("alert")
        snippet = snippet or (alert if isinstance(alert, str) else None)
        title = (
            title
            or _find(notif, "ios", "alert", "title")
            or _find(notif, "ios", "title")
            or _find(notif, "android", "title")
            or _find(notif, "web", "title")
        )

    # Last resort: any media anywhere
    if not hero:
        found = collect_media(d)
        hero = found[0] if found else None

    return {
        "channels": channels,
        "channel": channels[0] if channels else "unknown",
        "hero_image": hero,
        "title": title,
        "subject": subject,
        "snippet": snippet,
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as fh:
            payload = fh.read().strip()
    else:
        payload = sys.stdin.read().strip()
    print(json.dumps(extract(payload), indent=2, ensure_ascii=False))
