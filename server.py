"""Local-only Expo scheduling demo. Python standard library, no cloud services.

Run ``python server.py`` and open http://127.0.0.1:8765.
Bookings are local simulations in SQLite. They never reach QAIRU Campus.
"""

from __future__ import annotations

import argparse
from collections import OrderedDict
from copy import deepcopy
from datetime import date as Date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlsplit
import uuid

import engine

ROOT = Path(__file__).resolve().parent
MAX_BODY = 262_144
MAX_PLANS = 128
PLAN_LIFETIME_SECONDS = 30 * 60
INVENTORY_NOTE = (
    "Synthetic inventory and travel times for a local Expo scheduling simulation. "
    "Resource examples span floors 1-8 and are not a verified room inventory. "
    "The fourth-floor auditorium and campus iMacs were reported by the user. "
    "Names, capacities, equipment, opening hours and booking rights are assumptions."
)
ALGORITHMS = [
    "Constraint satisfaction", "A* graph search", "Random-restart hill climbing",
    "Bayesian inference", "Hidden Markov model filtering",
    "Finite-horizon belief-state decision planning",
]


class APIError(Exception):
    """An expected, safe-to-show client error."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def validate_date(value):
    """Accept one canonical ISO calendar date. Past dates are valid simulations."""
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("date must use YYYY-MM-DD")
    try:
        parsed = Date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("date is not a valid calendar date") from exc
    if not 2000 <= parsed.year <= 2100:
        raise ValueError("simulation date must be between 2000 and 2100")
    return parsed.isoformat()


def strict_object(value, allowed, required=()):
    if not isinstance(value, dict):
        raise ValueError("JSON body must be an object")
    unexpected = set(value) - set(allowed)
    if unexpected:
        raise ValueError("Unknown field(s): " + ", ".join(sorted(unexpected)))
    missing = set(required) - set(value)
    if missing:
        raise ValueError("Missing field(s): " + ", ".join(sorted(missing)))
    return value


def _json_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate JSON field: " + key)
        value[key] = item
    return value


def _bad_constant(value):
    raise ValueError("Non-finite JSON numbers are not allowed")


def ical_escape(value):
    """RFC 5545 text escaping. User text cannot inject new calendar properties."""
    return str(value).replace("\\", "\\\\").replace("\r\n", "\n").replace(
        "\r", "\n"
    ).replace("\n", "\\n").replace(";", "\\;").replace(",", "\\,")


def _fold_ical(line):
    """Fold at 75 UTF-8 octets without splitting a multibyte character."""
    parts, current, size = [], "", 0
    for char in line:
        length = len(char.encode("utf-8"))
        if size + length > 75:
            parts.append(current)
            current, size = " ", 1
        current += char
        size += length
    parts.append(current)
    return "\r\n".join(parts)


def make_calendar(bookings, resources):
    """Return an ICS calendar with floating local times, as displayed in the UI.

    There is deliberately no real room reservation or remote calendar connection.
    Floating times avoid silently assuming the user's calendar time zone.
    """
    names = {item["id"]: item["name"] for item in resources}
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Expo Smart Scheduler//Local Simulation//EN",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Expo simulation"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for booking in bookings:
        day = booking["date"].replace("-", "")
        start, end = booking["start"], booking["end"]
        lines.extend([
            "BEGIN:VEVENT", "UID:" + booking["id"] + "@expo-local.invalid",
            "DTSTAMP:" + stamp,
            f"DTSTART:{day}T{start // 60:02d}{start % 60:02d}00",
            f"DTEND:{day}T{end // 60:02d}{end % 60:02d}00",
            "SUMMARY:" + ical_escape("[SIMULATION] " + booking["title"]),
            "LOCATION:" + ical_escape(names.get(booking["resource_id"], booking["resource_id"])),
            "DESCRIPTION:Local simulation only. No real booking exists. Times are floating local times.",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return ("\r\n".join(_fold_ical(line) for line in lines) + "\r\n").encode("utf-8")


class BookingStore:
    """One short-lived connection per operation, so HTTP threads share safely."""

    def __init__(self, path):
        self.path = str(Path(path).resolve())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        connection = self.connection()
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("""CREATE TABLE IF NOT EXISTS bookings (
                id TEXT PRIMARY KEY,
                resource_id TEXT NOT NULL,
                date TEXT NOT NULL,
                start INTEGER NOT NULL CHECK(start >= 480 AND start < 1200 AND start % 30 = 0),
                end INTEGER NOT NULL CHECK(end > start AND end <= 1200 AND end % 30 = 0),
                title TEXT NOT NULL
            )""")
            connection.execute("CREATE INDEX IF NOT EXISTS bookings_date ON bookings(date)")
        finally:
            connection.close()

    def connection(self):
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def rows(connection, day):
        return [dict(row) for row in connection.execute(
            "SELECT * FROM bookings WHERE date = ? ORDER BY start, resource_id, id", (day,)
        )]

    def list(self, day):
        connection = self.connection()
        try:
            return self.rows(connection, day)
        finally:
            connection.close()

    def cancel(self, booking_id):
        connection = self.connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute("DELETE FROM bookings WHERE id = ?", (booking_id,))
            if not cursor.rowcount:
                raise APIError(404, "Local reservation not found")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


class SchedulerApplication:
    def __init__(self, db_path, resources=None):
        self.resources = deepcopy(resources if resources is not None else engine.load_resources())
        self.store = BookingStore(db_path)
        self.plans = OrderedDict()
        self.plan_lock = threading.Lock()
        scenarios_path = ROOT / "data" / "scenarios.json"
        self.scenarios = json.loads(scenarios_path.read_text(encoding="utf-8")) if scenarios_path.exists() else []
        floors_path = ROOT / "data" / "floors.json"
        self.floors = json.loads(floors_path.read_text(encoding="utf-8")) if floors_path.exists() else []

    def state(self, day):
        return {"date": day, "resources": self.resources, "bookings": self.store.list(day),
                "simulation": True, "inventory_note": INVENTORY_NOTE, "algorithms": ALGORITHMS,
                "scenarios": self.scenarios, "floors": self.floors}

    def make_plan(self, payload):
        strict_object(payload, {"date", "requests", "reports", "assumptions", "seed", "method"},
                      {"date", "requests"})
        day = validate_date(payload["date"])
        requests = payload["requests"]
        if not isinstance(requests, list) or not 1 <= len(requests) <= 10:
            raise ValueError("requests must contain 1 to 10 requests")
        normalized = [engine.validate_request(item) for item in requests]
        if len({item["id"] for item in normalized}) != len(normalized):
            raise ValueError("Request IDs must be unique")
        method = payload.get("method", "hill")
        if method not in ("hill", "exact"):
            raise ValueError("method must be hill or exact")
        seed = payload.get("seed", 42)
        if type(seed) is not int or not 0 <= seed <= 2**32 - 1:
            raise ValueError("seed must be an integer from 0 to 4294967295")
        reports = payload.get("reports", {})
        if not isinstance(reports, dict):
            raise ValueError("reports must map resource IDs to a report or report list")
        known_ids = {item["id"] for item in self.resources}
        for resource_id, report in reports.items():
            if resource_id not in known_ids:
                raise ValueError("Unknown resource in reports: " + resource_id)
            values = report if isinstance(report, list) else [report]
            if not 1 <= len(values) <= 24 or any(value not in ("free", "busy", "unknown") for value in values):
                raise ValueError("Each report must be free, busy or unknown; histories contain 1 to 24 reports")
        assumptions = payload.get("assumptions", {})
        strict_object(assumptions, {"sensitivity", "false_positive"})
        # Engine validates the probability range even if there are no candidates.
        engine.posterior(0.5, "unknown", **assumptions)
        result = engine.plan(normalized, self.resources, self.store.list(day), day,
                             reports=reports, assumptions=assumptions, seed=seed, method=method)
        plan_id = str(uuid.uuid4())
        saved = {"date": day, "requests": deepcopy(normalized),
                 "reports": deepcopy(reports), "assumptions": deepcopy(assumptions),
                 "assignments": deepcopy(result["assignments"]), "created": time.monotonic(),
                 "committed": False}
        with self.plan_lock:
            self._prune_plans()
            self.plans[plan_id] = saved
            while len(self.plans) > MAX_PLANS:
                self.plans.popitem(last=False)
        result.update({"plan_id": plan_id, "date": day, "simulation": True})
        return result

    def _prune_plans(self):
        cutoff = time.monotonic() - PLAN_LIFETIME_SECONDS
        expired = [plan_id for plan_id, item in self.plans.items() if item["created"] < cutoff]
        for plan_id in expired:
            del self.plans[plan_id]

    def commit_plan(self, payload):
        # Clients supply only an issued plan ID. Never trust assignment edits from a browser.
        strict_object(payload, {"plan_id"}, {"plan_id"})
        plan_id = payload["plan_id"]
        if not isinstance(plan_id, str) or len(plan_id) > 64:
            raise ValueError("plan_id must be a server-issued string")
        with self.plan_lock:
            self._prune_plans()
            saved = self.plans.get(plan_id)
            if saved is None:
                raise APIError(409, "Plan expired or not found. Generate a new plan.")
            if saved["committed"]:
                raise APIError(409, "This plan has already been reserved locally")
            if not saved["assignments"]:
                raise ValueError("The plan has no assignments to reserve")
            connection = self.store.connection()
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = self.store.rows(connection, saved["date"])
                request_map = {item["id"]: item for item in saved["requests"]}
                accepted = []
                for item in saved["assignments"]:
                    request = request_map[item["request_id"]]
                    # Re-run hard constraints against CURRENT reservations inside the write lock.
                    domain = engine.candidates(request, self.resources, current + accepted, saved["date"],
                                               reports=saved["reports"], assumptions=saved["assumptions"])
                    if not any(candidate["resource_id"] == item["resource_id"]
                               and candidate["start"] == item["start"] and candidate["end"] == item["end"]
                               for candidate in domain):
                        raise APIError(409, "A resource is now unavailable. Nothing was reserved. Generate a new plan.")
                    booking = {"id": str(uuid.uuid4()), "resource_id": item["resource_id"],
                               "date": saved["date"], "start": item["start"], "end": item["end"],
                               "title": request["title"]}
                    connection.execute("INSERT INTO bookings(id,resource_id,date,start,end,title) VALUES (?,?,?,?,?,?)",
                                       tuple(booking[key] for key in ("id", "resource_id", "date", "start", "end", "title")))
                    accepted.append(booking)
                connection.commit()
                saved["committed"] = True
                return {"bookings": accepted, "date": saved["date"], "simulation": True}
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()


class SchedulerServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, app):
        self.app = app
        super().__init__(address, SchedulerHandler)


class SchedulerHandler(BaseHTTPRequestHandler):
    server_version = "ExpoLocal/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def log_message(self, format_string, *args):
        logging.info("%s", format_string % args)

    def _headers(self, status, content_type, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if extra:
            for name, value in extra.items():
                self.send_header(name, value)
        self.end_headers()

    def _send(self, status, data, content_type="application/json; charset=utf-8", extra=None):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self._headers(status, content_type, len(data), extra)
        if self.command != "HEAD":
            self.wfile.write(data)

    def _check_host(self):
        port = self.server.server_address[1]
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if port == 80:
            allowed_hosts.update({"127.0.0.1", "localhost"})
        if self.headers.get("Host", "").lower() not in allowed_hosts:
            raise APIError(403, "This demo only accepts local loopback hosts")

    def _check_origin(self):
        host = self.headers.get("Host", "").lower()
        if self.headers.get("Origin", "") != "http://" + host:
            raise APIError(403, "Use the local demo page to make changes (same-origin request required)")
        if self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
            raise APIError(403, "Cross-site requests are not allowed")

    def _body(self):
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "Transfer-Encoding is not supported")
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise APIError(415, "Content-Type must be application/json")
        try:
            size = int(self.headers.get("Content-Length", "-1"))
        except ValueError as exc:
            raise APIError(400, "Invalid Content-Length") from exc
        if not 1 <= size <= MAX_BODY:
            raise APIError(413 if size > MAX_BODY else 400, "JSON body must contain 1 to 262144 bytes")
        raw = self.rfile.read(size)
        if len(raw) != size:
            raise APIError(400, "Incomplete JSON body")
        try:
            return json.loads(raw.decode("utf-8"), object_pairs_hook=_json_object, parse_constant=_bad_constant)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Malformed UTF-8 JSON body") from exc

    def _path_and_date(self):
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query, keep_blank_values=True)
        if any(key != "date" for key in query) or len(query.get("date", [])) > 1:
            raise ValueError("Only one date query parameter is accepted")
        day = validate_date(query.get("date", [Date.today().isoformat()])[0])
        return parsed.path, day

    def _safe(self, action):
        try:
            self._check_host()
            action()
        except APIError as exc:
            self._send(exc.status, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            self._send(400, {"error": str(exc)})
        except sqlite3.OperationalError:
            logging.exception("Local database operation failed")
            self._send(503, {"error": "Local database is temporarily unavailable. Retry shortly."})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            logging.exception("Unexpected local demo error")
            self._send(500, {"error": "An unexpected local error occurred. Check the server terminal."})

    def do_GET(self):
        self._safe(self._get)

    def do_HEAD(self):
        self._safe(self._get)

    def _get(self):
        path, day = self._path_and_date()
        if path == "/api/state":
            self._send(200, self.server.app.state(day))
        elif path == "/api/export":
            body = make_calendar(self.server.app.store.list(day), self.server.app.resources)
            self._send(200, body, "text/calendar; charset=utf-8",
                       {"Content-Disposition": f'attachment; filename="expo_simulation_{day}.ics"'})
        elif path in ("/", "/index.html", "/app.js", "/browser-storage.js", "/style.css",
                      "/find.html", "/find.js", "/find.css", "/experience.js"):
            name = "index.html" if path == "/" else path[1:]
            file_path = ROOT / "static" / name
            if not file_path.is_file():
                raise APIError(404, "Demo asset not found")
            types = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                     ".css": "text/css; charset=utf-8"}
            self._send(200, file_path.read_bytes(), types[file_path.suffix])
        elif path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
        else:
            raise APIError(404, "Endpoint not found")

    def do_POST(self):
        self._safe(self._post)

    def _post(self):
        self._check_origin()
        path = urlsplit(self.path).path
        payload = self._body()
        if path == "/api/plan":
            result = self.server.app.make_plan(payload)
            self._send(200, result)
        elif path == "/api/bookings":
            self._send(201, self.server.app.commit_plan(payload))
        elif path == "/api/decision":
            strict_object(payload, {"belief", "horizon", "sensitivity", "false_positive", "stay_free",
                                    "become_free", "success", "failure", "inspect_cost", "wait_cost"}, {"belief"})
            self._send(200, engine.decision(**payload))
        elif path == "/api/occupancy":
            strict_object(payload, {"prior", "reports", "sensitivity", "false_positive", "stay_free", "become_free"},
                          {"prior", "reports"})
            if not isinstance(payload["reports"], list) or not 1 <= len(payload["reports"]) <= 24:
                raise ValueError("reports must contain 1 to 24 observations")
            self._send(200, engine.hmm_filter(**payload))
        else:
            raise APIError(404, "Endpoint not found")

    def do_DELETE(self):
        self._safe(self._delete)

    def _delete(self):
        self._check_origin()
        path = urlsplit(self.path).path
        match = re.fullmatch(r"/api/bookings/([a-f0-9-]{36})", path)
        if not match:
            raise APIError(404, "Local reservation not found")
        self.server.app.store.cancel(match.group(1))
        self._send(200, {"success": True, "simulation": True})

    def do_OPTIONS(self):
        self._send(403, {"error": "Cross-origin access is not supported"})


def build_server(host="127.0.0.1", port=8765, db_path=None, resources=None):
    """Create an unstarted server. Injectable resources/db support isolated tests."""
    if host not in ("127.0.0.1", "localhost"):
        raise ValueError("Bind only to 127.0.0.1 or localhost")
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError("port must be an integer from 0 to 65535")
    app = SchedulerApplication(db_path or ROOT / "data" / "bookings.sqlite3", resources)
    return SchedulerServer((host, port), app)


def main():
    parser = argparse.ArgumentParser(description="Local Expo Smart Scheduler simulation")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "bookings.sqlite3")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    server = build_server(port=args.port, db_path=args.db)
    print(f"Expo simulation: http://127.0.0.1:{server.server_address[1]}")
    print(f"Local reservation database: {server.app.store.path}")
    print("SIMULATION ONLY. No connection to real QAIRU or Expo bookings. Ctrl+C stops the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLocal server stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
