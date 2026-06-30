#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["ruamel.yaml"]
# ///
"""Local-only dashboard server for the airship-kpi-monitor skill.

OPTIONAL. The dashboard works fully offline from `file://` (read-only, with
copy-prompt fallbacks). Running this server turns it into the primary surface:
it can write back to the local, gitignored `clients.yml` so a TAM can, directly
from the page:
  - mute / unmute alerts (false positives),
  - edit per-project alert thresholds,
  - manage the non-secret routing registry (add / edit / remove projects).

It NEVER touches secrets. Credentials live only in ~/.cursor/mcp.json and are
never read or written here; the server actively rejects any secret-shaped field.
MCP smoke-tests need MCP access and stay with the agent — the page emits
copy-prompts for those.

Safety model:
  - binds 127.0.0.1 only (loopback);
  - rejects requests whose Host is not localhost/127.0.0.1;
  - requires a same-origin Origin header on every POST (mitigates
    DNS-rebinding / CSRF from other local pages);
  - validates every field; writes only whitelisted routing keys.

Run (ruamel.yaml pulled inline, no global install):

    uv run --with ruamel.yaml serve.py        # or simply: uv run serve.py

Then open http://127.0.0.1:8787 . Stop with Ctrl-C.
"""

from __future__ import annotations

import datetime
import io
import json
import mimetypes
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("AIRSHIP_KPI_DASHBOARD_PORT", "8787"))

DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENTS_YML = os.path.normpath(os.path.join(DASHBOARD_DIR, "..", "clients.yml"))
CATALOG_JS = os.path.join(DASHBOARD_DIR, "thresholds-catalog.js")
BENCHMARKS_JSON = os.path.normpath(
    os.path.join(DASHBOARD_DIR, "..", "benchmarks", "benchmarks.json")
)

# Routing fields the Setup view may write. Anything else is ignored, and any
# secret-shaped key is rejected outright (defence in depth).
ROUTING_FIELDS = (
    "name",
    "brand_name",
    "airship_mcp",
    "slack_channel",
    "slack_canvas_id",
    "region",
    "time_zone",
    "industry",
    "enabled",
)
SECRET_RE = re.compile(
    r"(app[_-]?key|client[_-]?id|client[_-]?secret|secret|token|password|"
    r"authorization|bearer|api[_-]?key|credential)",
    re.IGNORECASE,
)
ALLOWED_ORIGINS = {
    "http://%s:%d" % (HOST, PORT),
    "http://localhost:%d" % PORT,
}

_LOCK = threading.Lock()


# --------------------------------------------------------------------------- #
# ruamel.yaml round-trip helpers
# --------------------------------------------------------------------------- #
def _yaml():
    from ruamel.yaml import YAML

    y = YAML()
    y.preserve_quotes = True
    y.indent(mapping=2, sequence=4, offset=2)
    y.width = 4096
    return y


def load_doc():
    """Load clients.yml as a round-trippable document (comments preserved)."""
    y = _yaml()
    with open(CLIENTS_YML, "r", encoding="utf-8") as fh:
        return y, y.load(fh)


def save_doc(y, doc):
    """Atomic write: render to a temp file then replace."""
    buf = io.StringIO()
    y.dump(doc, buf)
    tmp = CLIENTS_YML + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(buf.getvalue())
    os.replace(tmp, CLIENTS_YML)


def clients_list(doc):
    lst = doc.get("clients")
    return lst if lst is not None else []


def find_client(doc, name):
    target = (name or "").strip().lower()
    for c in clients_list(doc):
        cname = str(c.get("name", "")).strip().lower()
        bname = str(c.get("brand_name", "")).strip().lower()
        if cname == target or (bname and bname == target):
            return c
    return None


def today():
    return datetime.date.today().isoformat()


# --------------------------------------------------------------------------- #
# Threshold catalog (validation source, shared with the browser)
# --------------------------------------------------------------------------- #
def load_catalog_keys():
    try:
        with open(CATALOG_JS, "r", encoding="utf-8") as fh:
            text = fh.read()
        # Locate the object after the assignment (robust to braces in comments).
        i = text.index("AIRSHIP_KPI_THRESHOLDS")
        eq = text.index("=", i)
        start = text.index("{", eq)
        end = text.rindex("}")
        data = json.loads(text[start : end + 1])
        return {it["key"] for it in data.get("items", []) if "key" in it}
    except Exception:
        return set()


# --------------------------------------------------------------------------- #
# Benchmark verticals (industry validation + browser dropdown source)
# --------------------------------------------------------------------------- #
def load_verticals():
    """Return {slug: label} of valid industries from benchmarks.json (best-effort)."""
    try:
        with open(BENCHMARKS_JSON, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        out = {}
        for slug, v in (data.get("verticals") or {}).items():
            out[str(slug)] = str((v or {}).get("label") or slug)
        return out
    except Exception:
        return {}


# --------------------------------------------------------------------------- #
# State (read-only projection of clients.yml — never any secret)
# --------------------------------------------------------------------------- #
def build_state(doc):
    out_clients = []
    for c in clients_list(doc):
        muted = []
        for m in c.get("muted_alerts", []) or []:
            muted.append(
                {
                    "key": str(m.get("key", "")),
                    "reason": m.get("reason", ""),
                    "muted_since": str(m.get("muted_since", "")) if m.get("muted_since") else "",
                }
            )
        ct = {}
        for k, v in (c.get("custom_thresholds", {}) or {}).items():
            ct[str(k)] = v
        out_clients.append(
            {
                "name": c.get("name", ""),
                "brand_name": c.get("brand_name", ""),
                "airship_mcp": c.get("airship_mcp", ""),
                "slack_channel": c.get("slack_channel", ""),
                "slack_canvas_id": c.get("slack_canvas_id", ""),
                "region": c.get("region", ""),
                "time_zone": c.get("time_zone", ""),
                "industry": c.get("industry", ""),
                "enabled": bool(c.get("enabled", True)),
                "custom_thresholds": ct,
                "muted_alerts": muted,
            }
        )
    return {
        "serverMode": True,
        "slackWorkspace": doc.get("slack_workspace", ""),
        "slackTeamId": doc.get("slack_team_id", ""),
        "verticals": load_verticals(),
        "clients": out_clients,
    }


def read_state():
    _, doc = load_doc()
    return build_state(doc)


# --------------------------------------------------------------------------- #
# Mutations
# --------------------------------------------------------------------------- #
class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _commented_map(pairs):
    from ruamel.yaml.comments import CommentedMap

    m = CommentedMap()
    for k, v in pairs:
        m[k] = v
    return m


def op_mute(payload):
    project = payload.get("project")
    key = (payload.get("key") or "").strip()
    reason = (payload.get("reason") or "").strip()
    if not project or not key:
        raise ApiError("project and key are required")
    with _LOCK:
        y, doc = load_doc()
        c = find_client(doc, project)
        if c is None:
            raise ApiError("project not found: %s" % project, 404)
        lst = c.get("muted_alerts")
        if lst is None:
            from ruamel.yaml.comments import CommentedSeq

            lst = CommentedSeq()
            c["muted_alerts"] = lst
        existing = None
        for item in lst:
            if str(item.get("key", "")) == key:
                existing = item
                break
        if existing is not None:
            if reason:
                existing["reason"] = reason
        else:
            lst.append(
                _commented_map(
                    [
                        ("key", key),
                        ("reason", reason or "Declared false positive"),
                        ("muted_since", today()),
                    ]
                )
            )
        save_doc(y, doc)
        return build_state(doc)


def op_unmute(payload):
    project = payload.get("project")
    key = (payload.get("key") or "").strip()
    if not project or not key:
        raise ApiError("project and key are required")
    with _LOCK:
        y, doc = load_doc()
        c = find_client(doc, project)
        if c is None:
            raise ApiError("project not found: %s" % project, 404)
        lst = c.get("muted_alerts")
        if lst:
            keep = [it for it in lst if str(it.get("key", "")) != key]
            if len(keep) == len(lst):
                # nothing removed — still fine (idempotent)
                pass
            if keep:
                from ruamel.yaml.comments import CommentedSeq

                seq = CommentedSeq()
                for it in keep:
                    seq.append(it)
                c["muted_alerts"] = seq
            else:
                del c["muted_alerts"]
        save_doc(y, doc)
        return build_state(doc)


def _coerce_number(v):
    if isinstance(v, bool):
        raise ApiError("threshold value must be numeric")
    if isinstance(v, (int, float)):
        n = v
    else:
        s = str(v).strip()
        if s == "":
            return None
        try:
            n = float(s)
        except ValueError:
            raise ApiError("threshold value must be numeric: %r" % v)
    if isinstance(n, float) and n.is_integer():
        n = int(n)
    return n


def op_thresholds(payload):
    project = payload.get("project")
    overrides = payload.get("overrides")
    if not project or not isinstance(overrides, dict):
        raise ApiError("project and overrides object are required")
    catalog = load_catalog_keys()
    with _LOCK:
        y, doc = load_doc()
        c = find_client(doc, project)
        if c is None:
            raise ApiError("project not found: %s" % project, 404)
        ct = c.get("custom_thresholds")
        for k, raw in overrides.items():
            if catalog and k not in catalog:
                raise ApiError("unknown threshold key: %s" % k)
            val = None if raw is None else _coerce_number(raw)
            if val is None:
                # reset to default → drop the override
                if ct is not None and k in ct:
                    del ct[k]
            else:
                if ct is None:
                    ct = _commented_map([])
                    c["custom_thresholds"] = ct
                ct[k] = val
        if ct is not None and len(ct) == 0:
            del c["custom_thresholds"]
        save_doc(y, doc)
        return build_state(doc)


def _reject_secrets(payload):
    for k in payload.keys():
        if SECRET_RE.search(str(k)):
            raise ApiError(
                "secret-shaped field rejected: %s (credentials belong only in "
                "~/.cursor/mcp.json, never in clients.yml)" % k
            )


def _validate_routing(fields):
    region = fields.get("region")
    if region is not None and str(region).strip().lower() not in ("eu", "us"):
        raise ApiError("region must be 'eu' or 'us'")
    if "time_zone" in fields and not str(fields.get("time_zone") or "").strip():
        raise ApiError("time_zone must not be empty")
    if "enabled" in fields and not isinstance(fields.get("enabled"), bool):
        raise ApiError("enabled must be a boolean")
    if "industry" in fields:
        ind = str(fields.get("industry") or "").strip()
        verticals = load_verticals()
        # Empty clears the field; otherwise must be a known vertical slug (when the
        # benchmark file is available — if it isn't, accept any non-empty value).
        if ind and verticals and ind not in verticals:
            raise ApiError(
                "unknown industry: %s (use a benchmark vertical slug)" % ind
            )


def op_client_upsert(payload):
    _reject_secrets(payload)
    name = (payload.get("name") or "").strip()
    old_name = (payload.get("oldName") or "").strip()
    if not name:
        raise ApiError("name is required")
    fields = {k: payload[k] for k in ROUTING_FIELDS if k in payload}
    if "region" in fields and isinstance(fields["region"], str):
        fields["region"] = fields["region"].strip().lower()
    _validate_routing(fields)
    with _LOCK:
        y, doc = load_doc()
        lookup = old_name or name
        c = find_client(doc, lookup)
        # guard against renaming onto another existing client
        if name.lower() != lookup.lower():
            clash = find_client(doc, name)
            if clash is not None and clash is not c:
                raise ApiError("a project named %r already exists" % name)
        if c is None:
            from ruamel.yaml.comments import CommentedMap, CommentedSeq

            c = CommentedMap()
            for f in ROUTING_FIELDS:
                if f == "name":
                    c[f] = name
                elif f in fields:
                    c[f] = fields[f]
                elif f == "enabled":
                    c[f] = True
            lst = doc.get("clients")
            if lst is None:
                doc["clients"] = lst = CommentedSeq()
            lst.append(c)
        else:
            for f, v in fields.items():
                c[f] = v
            c["name"] = name
        save_doc(y, doc)
        return build_state(doc)


def op_client_delete(payload):
    name = (payload.get("name") or "").strip()
    if not name:
        raise ApiError("name is required")
    with _LOCK:
        y, doc = load_doc()
        lst = doc.get("clients")
        if not lst:
            raise ApiError("project not found: %s" % name, 404)
        target = name.lower()
        idx = None
        for i, c in enumerate(lst):
            if str(c.get("name", "")).strip().lower() == target:
                idx = i
                break
        if idx is None:
            raise ApiError("project not found: %s" % name, 404)
        del lst[idx]
        save_doc(y, doc)
        return build_state(doc)


ROUTES = {
    "/api/mute": op_mute,
    "/api/unmute": op_unmute,
    "/api/thresholds": op_thresholds,
    "/api/client": op_client_upsert,
    "/api/client/delete": op_client_delete,
}


# --------------------------------------------------------------------------- #
# HTTP handler
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = "AirshipKpiDashboard/1.0"

    def log_message(self, fmt, *args):  # quieter logs
        sys.stderr.write("[dashboard] %s\n" % (fmt % args))

    # -- security gates ----------------------------------------------------- #
    def _host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        return host in ("127.0.0.1", "localhost", "")

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        # Same-origin fetch() always sends Origin. Reject cross-origin / missing.
        return origin in ALLOWED_ORIGINS

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # -- GET ---------------------------------------------------------------- #
    def do_GET(self):
        if not self._host_ok():
            self._send_json({"ok": False, "error": "bad host"}, 403)
            return
        path = self.path.split("?", 1)[0]
        if path == "/api/state":
            try:
                self._send_json({"ok": True, "state": read_state()})
            except Exception as e:  # fail-open: report, don't crash
                self._send_json({"ok": False, "error": str(e)}, 500)
            return
        self._serve_static(path)

    def _serve_static(self, path):
        if path == "/" or path == "":
            path = "/index.html"
        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(DASHBOARD_DIR, rel))
        # Confine to the dashboard dir (no traversal, never expose clients.yml).
        if not full.startswith(DASHBOARD_DIR + os.sep) and full != DASHBOARD_DIR:
            self._send_json({"ok": False, "error": "not found"}, 404)
            return
        if not os.path.isfile(full):
            self._send_json({"ok": False, "error": "not found"}, 404)
            return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if full.endswith(".js"):
            ctype = "application/javascript"
        try:
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError:
            self._send_json({"ok": False, "error": "not found"}, 404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # -- POST --------------------------------------------------------------- #
    def do_POST(self):
        if not self._host_ok():
            self._send_json({"ok": False, "error": "bad host"}, 403)
            return
        if not self._origin_ok():
            self._send_json({"ok": False, "error": "bad origin"}, 403)
            return
        path = self.path.split("?", 1)[0]
        handler = ROUTES.get(path)
        if handler is None:
            self._send_json({"ok": False, "error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > 256 * 1024:
            self._send_json({"ok": False, "error": "invalid body"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("body must be a JSON object")
        except Exception as e:
            self._send_json({"ok": False, "error": "invalid JSON: %s" % e}, 400)
            return
        try:
            state = handler(payload)
            self._send_json({"ok": True, "state": state})
        except ApiError as e:
            self._send_json({"ok": False, "error": str(e)}, e.status)
        except Exception as e:  # never crash the server on one bad request
            self._send_json({"ok": False, "error": str(e)}, 500)


def main():
    if not os.path.isfile(CLIENTS_YML):
        sys.stderr.write(
            "[dashboard] clients.yml not found at %s — create it first "
            "(see SETUP.md / MODOP.md).\n" % CLIENTS_YML
        )
    try:
        import ruamel.yaml  # noqa: F401
    except Exception:
        sys.stderr.write(
            "[dashboard] ruamel.yaml is required. Run: "
            "uv run --with ruamel.yaml serve.py\n"
        )
        sys.exit(1)
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as e:
        sys.stderr.write(
            "[dashboard] cannot bind %s:%d (%s). Is it already running? "
            "Open http://%s:%d\n" % (HOST, PORT, e, HOST, PORT)
        )
        sys.exit(1)
    sys.stderr.write(
        "[dashboard] serving %s on http://%s:%d (Ctrl-C to stop)\n"
        % (DASHBOARD_DIR, HOST, PORT)
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[dashboard] stopped.\n")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
