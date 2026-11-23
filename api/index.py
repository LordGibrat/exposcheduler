"""Stateless Vercel adapter for the same Expo AI engine used by server.py.

Only static inventory is cached. Online reservations belong to the browser and
are sent as hypothetical planning constraints. A plan_id is a correlation ID,
not a reservation, authentication token, or server-side cached plan.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import date as Date
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
import json
import logging
import math
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import engine
from server import (ALGORITHMS, APIError, INVENTORY_NOTE, MAX_BODY,
                    _bad_constant, _json_object, validate_date)

STORAGE_NOTICE = (
    "Online demo: reservations are simulations stored only in this browser. "
    "They are not shared between users or devices and do not book real Expo resources. "
    "The server uses supplied reservations only as hypothetical planning constraints."
)
BODY_KEYS = {"date", "requests", "reports", "assumptions", "seed", "method", "bookings", "local_bookings"}
ROUTES = {"state", "plan", "decision", "occupancy", "bookings", "export"}


def checked_object(value, allowed, required=()):
    """Reject unknown fields without reflecting their user-controlled names."""
    if not isinstance(value, dict):
        raise ValueError("JSON body must be an object")
    if set(value) - set(allowed):
        raise ValueError("JSON body contains unsupported fields")
    if set(required) - set(value):
        raise ValueError("JSON body is missing required fields")
    return value


def _finite_float(text):
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("Non-finite JSON numbers are not allowed")
    return value


@lru_cache(maxsize=1)
def inventory():
    """Cache read-only JSON assets, never plans, bookings or personal information."""
    resources = engine.load_resources()
    scenarios = json.loads((ROOT / "data" / "scenarios.json").read_text(encoding="utf-8"))
    floors = json.loads((ROOT / "data" / "floors.json").read_text(encoding="utf-8"))
    return resources, scenarios, floors


def state(day):
    resources, scenarios, floors = inventory()
    return {"date": day, "resources": deepcopy(resources), "bookings": [],
            "scenarios": deepcopy(scenarios), "floors": deepcopy(floors),
            "simulation": True, "storage_mode": "browser", "storage_notice": STORAGE_NOTICE,
            "inventory_note": INVENTORY_NOTE, "algorithms": ALGORITHMS}


def make_plan(payload):
    checked_object(payload, BODY_KEYS, {"date", "requests"})
    day = validate_date(payload["date"])
    if "bookings" in payload and "local_bookings" in payload:
        raise ValueError("Supply bookings or local_bookings, not both")
    bookings = payload.get("bookings", payload.get("local_bookings", []))
    if not isinstance(bookings, list) or len(bookings) > 10000:
        raise ValueError("bookings must be a list with at most 10000 entries")
    for booking in bookings:
        if not isinstance(booking, dict):
            raise ValueError("Each supplied reservation must be an object")
        validate_date(booking.get("date"))
    requests = payload["requests"]
    if not isinstance(requests, list) or not 1 <= len(requests) <= 10:
        raise ValueError("requests must contain 1 to 10 requests")
    normalized = [engine.validate_request(item) for item in requests]
    if len({item["id"] for item in normalized}) != len(normalized):
        raise ValueError("Request IDs must be unique")
    method = payload.get("method", "hill")
    if not isinstance(method, str) or method not in {"hill", "exact"}:
        raise ValueError("method must be hill or exact")
    seed = payload.get("seed", 42)
    if type(seed) is not int or not 0 <= seed <= 2**32 - 1:
        raise ValueError("seed must be an integer from 0 to 4294967295")
    assumptions = payload.get("assumptions", {})
    checked_object(assumptions, {"sensitivity", "false_positive"})
    engine.posterior(0.5, "unknown", **assumptions)
    resources = inventory()[0]
    # The engine validates every reservation, resource reference, interval,
    # hypothetical report and hard constraint. Client state is never trusted as
    # shared truth, and the result is not persisted in a database or /tmp file.
    result = engine.plan(normalized, resources, bookings, day,
                         reports=payload.get("reports", {}), assumptions=assumptions,
                         seed=seed, method=method)
    result.update({"date": day, "plan_id": str(uuid.uuid4()), "simulation": True,
                   "storage_mode": "browser", "storage_notice": STORAGE_NOTICE})
    return result


class handler(BaseHTTPRequestHandler):
    """Vercel's Python runtime discovers this BaseHTTPRequestHandler class."""

    server_version = "ExpoStateless/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def log_message(self, format_string, *args):
        # Avoid logging request paths, query strings or user-supplied bodies.
        pass

    def _send(self, status, payload, allow=None):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        if allow:
            self.send_header("Allow", allow)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _origin(self):
        origin = self.headers.get("Origin")
        if origin is None:
            return
        try:
            parsed = urlsplit(origin)
            host = self.headers.get("Host", "").lower()
            valid = (parsed.scheme in ("http", "https") and parsed.netloc.lower() == host
                     and bool(parsed.hostname) and parsed.username is None and parsed.password is None
                     and not parsed.path and not parsed.query and not parsed.fragment)
        except ValueError:
            valid = False
        if not valid:
            raise APIError(403, "Cross-origin requests are not supported")

    def _resolve_route(self):
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=8)
        if any(len(values) != 1 for values in query.values()):
            raise ValueError("Duplicate query parameters are not allowed")
        if set(query) - {"route", "date", "path", "_vercel_share"}:
            raise ValueError("Unsupported query parameter")
        # Vercel can preserve the original /api/... path while also supplying
        # the rewrite's route and captured path as query parameters. Its share
        # marker is transport metadata, not an application parameter or token
        # consumed by this API. Never log or reflect its value.
        query.pop("_vercel_share", None)
        explicit_route = query.pop("route", None)
        if parsed.path == "/api":
            route = explicit_route[0] if explicit_route is not None else ""
        elif parsed.path.startswith("/api/"):
            route = parsed.path[len("/api/"):]
            if explicit_route is not None and explicit_route[0] != route:
                raise ValueError("Ambiguous API route")
        else:
            raise APIError(404, "Endpoint not found")
        captured_path = query.pop("path", None)
        if captured_path is not None and captured_path[0] != route:
            raise ValueError("Rewrite path does not match the API route")
        if route not in ROUTES and not re.fullmatch(r"bookings/[a-f0-9-]{36}", route):
            raise APIError(404, "Endpoint not found")
        return route, query

    def _body(self):
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "Transfer-Encoding is not supported")
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise APIError(415, "Content-Type must be application/json")
        try:
            size = int(self.headers.get("Content-Length", "-1"))
        except ValueError as exc:
            raise APIError(400, "Invalid Content-Length") from exc
        if not 1 <= size <= MAX_BODY:
            raise APIError(413 if size > MAX_BODY else 400, "JSON body must contain 1 to 262144 bytes")
        raw = self.rfile.read(size)
        if len(raw) != size:
            raise ValueError("Incomplete JSON body")
        try:
            return json.loads(raw.decode("utf-8"), object_pairs_hook=_json_object,
                              parse_constant=_bad_constant, parse_float=_finite_float)
        except (UnicodeDecodeError, ValueError, RecursionError) as exc:
            raise ValueError("Malformed or ambiguous UTF-8 JSON body") from exc

    def _safe(self):
        try:
            self._origin()
            route, query = self._resolve_route()
            if route in ("bookings", "export") or route.startswith("bookings/"):
                raise APIError(405, "Online reservations, cancellation and calendar export are browser-owned simulations. No server booking was created.")
            if self.command in ("GET", "HEAD"):
                if route != "state":
                    self._send(405, {"error": "Use POST for this endpoint"}, allow="POST")
                    return
                day = validate_date(query.get("date", [Date.today().isoformat()])[0])
                self._send(200, state(day))
                return
            if self.command != "POST":
                self._send(405, {"error": "Method not allowed"}, allow="GET, HEAD" if route == "state" else "POST")
                return
            if route == "state":
                self._send(405, {"error": "Use GET for the state endpoint"}, allow="GET, HEAD")
                return
            if query:
                raise ValueError("POST parameters belong in the JSON body")
            payload = self._body()
            if route == "plan":
                result = make_plan(payload)
            elif route == "decision":
                checked_object(payload, {"belief", "horizon", "sensitivity", "false_positive", "stay_free",
                                          "become_free", "success", "failure", "inspect_cost", "wait_cost"}, {"belief"})
                result = engine.decision(**payload)
            elif route == "occupancy":
                checked_object(payload, {"prior", "reports", "sensitivity", "false_positive", "stay_free", "become_free"},
                               {"prior", "reports"})
                result = engine.hmm_filter(**payload)
            else:
                raise APIError(404, "Endpoint not found")
            self._send(200, result)
        except APIError as exc:
            self._send(exc.status, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            # JSON is served as application/json with nosniff, never as HTML.
            # Short validation reasons are useful; raw request bodies are not echoed.
            self._send(400, {"error": str(exc)[:240]})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            logging.exception("Stateless Expo API operation failed")
            self._send(500, {"error": "The simulation service could not complete this request."})

    do_GET = _safe
    do_HEAD = _safe
    do_POST = _safe
    do_DELETE = _safe
    do_PUT = _safe
    do_PATCH = _safe
    do_OPTIONS = _safe
