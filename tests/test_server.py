"""HTTP-handler, persistence, calendar and atomic-booking tests using a temporary DB.

Run from the project directory: python -m unittest discover -s tests -v
HTTP bytes pass through the real request parser in memory, so the tests also run
where the execution sandbox blocks outbound loopback sockets. A separate network
test performs a real connection or explicitly skips if that connection is blocked.
Every reservation in these tests is a synthetic local example.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
import http.client
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

import server


RESOURCES = [
    {"id": "T-ROOM", "name": "Test study room", "floor": 2, "kind": "study_room", "capacity": 4,
     "features": ["quiet", "whiteboard", "wheelchair"], "parent_id": None, "prior": 0.7},
    {"id": "T-AUD", "name": "Test auditorium", "floor": 4, "kind": "auditorium", "capacity": 80,
     "features": ["projector", "wheelchair"], "parent_id": None, "prior": 0.7},
    {"id": "T-LAB", "name": "Test iMac lab", "floor": 3, "kind": "computer_lab", "capacity": 2,
     "features": ["macOS", "wheelchair"], "parent_id": None, "prior": 0.7},
    {"id": "T-MAC1", "name": "Test iMac 1", "floor": 3, "kind": "imac", "capacity": 1,
     "features": ["macOS", "wheelchair"], "parent_id": "T-LAB", "prior": 0.7},
    {"id": "T-MAC2", "name": "Test iMac 2", "floor": 3, "kind": "imac", "capacity": 1,
     "features": ["macOS", "wheelchair"], "parent_id": "T-LAB", "prior": 0.7},
]
DAY = "2026-11-19"


def request(request_id="test", kind="study_room", start=540, title="Study session"):
    return {"id": request_id, "title": title, "kind": kind, "group_size": 1,
            "features": [], "preferred_floor": 2, "earliest": start, "latest": start + 60,
            "duration": 60, "priority": 2, "accessible": False}


class MemorySocket:
    """Only the stream interface needed by StreamRequestHandler, not a fake API."""

    def __init__(self, request_bytes):
        self.incoming = BytesIO(request_bytes)
        self.outgoing = BytesIO()

    def makefile(self, mode, *args):
        return self.incoming

    def sendall(self, data):
        self.outgoing.write(data)


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="expo_http_test_")
        self.db_path = Path(self.temp.name) / "test.sqlite3"
        self.server = server.build_server(port=0, db_path=self.db_path, resources=RESOURCES)
        self.port = self.server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"

    def tearDown(self):
        self.server.server_close()
        self.temp.cleanup()

    def call(self, method, path, payload=None, headers=None, raw=None):
        request_headers = {"Host": f"127.0.0.1:{self.port}", "Origin": self.origin}
        if payload is not None or raw is not None:
            request_headers["Content-Type"] = "application/json"
        if headers:
            request_headers.update(headers)
        body = raw if raw is not None else json.dumps(payload).encode("utf-8") if payload is not None else None
        if body is not None:
            request_headers["Content-Length"] = str(len(body))
        wire = f"{method} {path} HTTP/1.0\r\n" + "".join(f"{key}: {value}\r\n" for key, value in request_headers.items()) + "\r\n"
        stream = MemorySocket(wire.encode("ascii") + (body or b""))
        server.SchedulerHandler(stream, ("127.0.0.1", 12345), self.server)
        header_bytes, response_body = stream.outgoing.getvalue().split(b"\r\n\r\n", 1)
        lines = header_bytes.decode("iso-8859-1").split("\r\n")
        status = int(lines[0].split(" ")[1])
        response_headers = dict(line.split(": ", 1) for line in lines[1:])
        if "application/json" in response_headers.get("Content-Type", ""):
            response_body = json.loads(response_body)
        return status, response_body, response_headers

    def plan(self, requests=None, day=DAY, **kwargs):
        payload = {"date": day, "requests": requests or [request()], **kwargs}
        status, result, _ = self.call("POST", "/api/plan", payload)
        self.assertEqual(status, 200, result)
        self.assertTrue(result["plan_id"])
        return result

    def commit(self, plan):
        return self.call("POST", "/api/bookings", {"plan_id": plan["plan_id"]})

    def bookings(self, day=DAY):
        status, state, _ = self.call("GET", "/api/state?date=" + day)
        self.assertEqual(status, 200, state)
        return state["bookings"]

    def test_state_is_explicit_simulation(self):
        status, state, headers = self.call("GET", "/api/state?date=" + DAY)
        self.assertEqual(status, 200)
        self.assertTrue(state["simulation"])
        self.assertEqual(len(state["resources"]), len(RESOURCES))
        self.assertEqual(state["bookings"], [])
        self.assertIn("Synthetic", state["inventory_note"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_browser_storage_script_is_served(self):
        status, body, headers = self.call("GET", "/browser-storage.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", headers["Content-Type"])
        self.assertEqual(body, (server.ROOT / "static" / "browser-storage.js").read_bytes())

    def test_finder_assets_are_served_without_exposing_source_files(self):
        for name, content_type in (("find.html", "text/html"), ("find.css", "text/css"),
                                   ("find.js", "text/javascript"), ("experience.js", "text/javascript")):
            with self.subTest(asset=name):
                status, body, headers = self.call("GET", "/" + name)
                self.assertEqual(status, 200)
                self.assertIn(content_type, headers["Content-Type"])
                self.assertEqual(body, (server.ROOT / "static" / name).read_bytes())
        self.assertEqual(self.call("GET", "/engine.py")[0], 404)
        self.assertEqual(self.call("GET", "/static/find.html")[0], 404)

    def test_booking_and_cancellation(self):
        plan = self.plan()
        self.assertEqual(len(plan["assignments"]), 1)
        status, result, _ = self.commit(plan)
        self.assertEqual(status, 201, result)
        self.assertTrue(result["simulation"])
        self.assertEqual(len(self.bookings()), 1)
        booking_id = result["bookings"][0]["id"]
        status, result, _ = self.call("DELETE", "/api/bookings/" + booking_id)
        self.assertEqual(status, 200, result)
        self.assertEqual(self.bookings(), [])

    def test_committing_same_plan_twice_returns_conflict(self):
        plan = self.plan()
        self.assertEqual(self.commit(plan)[0], 201)
        self.assertEqual(self.commit(plan)[0], 409)
        self.assertEqual(len(self.bookings()), 1)

    def test_stale_plan_conflicts_without_double_booking(self):
        first, second = self.plan(), self.plan()
        self.assertEqual(self.commit(first)[0], 201)
        self.assertEqual(self.commit(second)[0], 409)
        self.assertEqual(len(self.bookings()), 1)

    def test_conflict_rolls_back_entire_batch(self):
        batch = self.plan([request("room"), request("aud", "auditorium")])
        self.assertEqual(len(batch["assignments"]), 2)
        occupied = self.plan([request("other-aud", "auditorium")])
        self.assertEqual(self.commit(occupied)[0], 201)
        self.assertEqual(self.commit(batch)[0], 409)
        rows = self.bookings()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["resource_id"], "T-AUD")

    def test_two_simultaneous_commits_cannot_reserve_same_resource(self):
        plans = [self.plan(), self.plan()]
        barrier = threading.Barrier(2)

        def compete(plan):
            barrier.wait(timeout=5)
            return self.commit(plan)[0]

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(compete, plans))
        self.assertEqual(sorted(outcomes), [201, 409])
        self.assertEqual(len(self.bookings()), 1)

    def test_independent_applications_share_sqlite_atomicity(self):
        # Two application instances have different Python locks and plan caches.
        # SQLite's transaction must still prevent their overlapping reservations.
        other = server.SchedulerApplication(self.db_path, resources=RESOURCES)
        apps = [self.server.app, other]
        plans = [app.make_plan({"date": DAY, "requests": [request()]}) for app in apps]
        barrier = threading.Barrier(2)

        def compete(index):
            barrier.wait(timeout=5)
            try:
                apps[index].commit_plan({"plan_id": plans[index]["plan_id"]})
                return 201
            except server.APIError as exc:
                return exc.status

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(compete, [0, 1]))
        self.assertEqual(sorted(outcomes), [201, 409])
        self.assertEqual(len(self.bookings()), 1)

    def test_lab_booking_blocks_all_child_imacs(self):
        lab = self.plan([request("lab", "computer_lab")])
        mac = self.plan([request("mac", "imac")])
        self.assertEqual(self.commit(lab)[0], 201)
        self.assertEqual(self.commit(mac)[0], 409)
        self.assertEqual(len(self.bookings()), 1)

    def test_child_imac_blocks_parent_lab(self):
        mac = self.plan([request("mac", "imac")])
        lab = self.plan([request("lab", "computer_lab")])
        self.assertEqual(self.commit(mac)[0], 201)
        self.assertEqual(self.commit(lab)[0], 409)

    def test_sibling_imacs_can_overlap(self):
        both = self.plan([request("one", "imac"), request("two", "imac")])
        self.assertEqual(len(both["assignments"]), 2)
        self.assertEqual(self.commit(both)[0], 201)
        self.assertEqual({row["resource_id"] for row in self.bookings()}, {"T-MAC1", "T-MAC2"})

    def test_half_open_intervals_allow_back_to_back_bookings(self):
        self.assertEqual(self.commit(self.plan())[0], 201)
        second = self.plan([request("later", start=600)])
        self.assertEqual(self.commit(second)[0], 201)
        self.assertEqual(len(self.bookings()), 2)

    def test_different_days_are_independent(self):
        self.assertEqual(self.commit(self.plan())[0], 201)
        self.assertEqual(self.commit(self.plan(day="2026-11-20"))[0], 201)
        self.assertEqual(len(self.bookings()), 1)
        self.assertEqual(len(self.bookings("2026-11-20")), 1)

    def test_assignment_tampering_is_rejected(self):
        plan = self.plan()
        status, _, _ = self.call("POST", "/api/bookings", {
            "plan_id": plan["plan_id"], "assignments": [{"resource_id": "T-AUD"}]
        })
        self.assertEqual(status, 400)
        self.assertEqual(self.bookings(), [])

    def test_unknown_and_expired_plan_return_conflict(self):
        status, _, _ = self.call("POST", "/api/bookings", {"plan_id": "unknown"})
        self.assertEqual(status, 409)
        plan = self.plan()
        self.server.app.plans[plan["plan_id"]]["created"] = time.monotonic() - server.PLAN_LIFETIME_SECONDS - 1
        self.assertEqual(self.commit(plan)[0], 409)

    def test_empty_solution_cannot_be_committed(self):
        plan = self.plan([request("no-such-kind", "classroom")])
        self.assertEqual(plan["assignments"], [])
        self.assertEqual(self.commit(plan)[0], 400)

    def test_unknown_resource_report_is_rejected(self):
        status, _, _ = self.call("POST", "/api/plan", {"date": DAY, "requests": [request()],
                                                               "reports": {"does-not-exist": "free"}})
        self.assertEqual(status, 400)

    def test_duplicate_request_ids_are_rejected(self):
        status, _, _ = self.call("POST", "/api/plan", {"date": DAY, "requests": [request(), request()]})
        self.assertEqual(status, 400)

    def test_request_count_boundaries(self):
        for requests in ([], [request(str(index)) for index in range(11)]):
            with self.subTest(count=len(requests)):
                status, _, _ = self.call("POST", "/api/plan", {"date": DAY, "requests": requests})
                self.assertEqual(status, 400)

    def test_bad_dates_are_rejected(self):
        for value in ("2026-02-30", "2026-11-9", "1999-12-31", "2026-11-19T10:00", "", "<script>"):
            with self.subTest(value=value):
                status, _, _ = self.call("GET", "/api/state?date=" + value)
                self.assertEqual(status, 400)

    def test_duplicate_date_query_is_rejected(self):
        self.assertEqual(self.call("GET", "/api/state?date=" + DAY + "&date=" + DAY)[0], 400)

    def test_invalid_json_and_nonfinite_numbers(self):
        for raw in (b"{", b"[]", b'{"belief":NaN}', b'{"belief":0.2,"belief":0.8}', b"\xff"):
            with self.subTest(raw=raw):
                self.assertEqual(self.call("POST", "/api/decision", raw=raw)[0], 400)

    def test_oversized_request_rejected_before_parsing(self):
        self.assertEqual(self.call("POST", "/api/decision", raw=b" " * (server.MAX_BODY + 1))[0], 413)

    def test_content_type_is_required(self):
        status, _, _ = self.call("POST", "/api/decision", raw=b'{"belief":0.5}',
                                 headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)

    def test_remote_origin_and_wrong_host_are_rejected(self):
        status, _, _ = self.call("POST", "/api/decision", {"belief": 0.5},
                                 headers={"Origin": "https://example.com"})
        self.assertEqual(status, 403)
        status, _, _ = self.call("GET", "/api/state", headers={"Host": "attacker.example"})
        self.assertEqual(status, 403)

    def test_missing_origin_is_rejected_for_mutations(self):
        self.assertEqual(self.call("POST", "/api/decision", {"belief": 0.5}, headers={"Origin": ""})[0], 403)

    def test_cross_site_fetch_and_preflight_are_rejected(self):
        self.assertEqual(self.call("POST", "/api/decision", {"belief": 0.5},
                                   headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.call("OPTIONS", "/api/bookings")[0], 403)

    def test_decision_and_hmm_endpoints(self):
        status, body, _ = self.call("POST", "/api/decision", {"belief": 0.55, "horizon": 3})
        self.assertEqual(status, 200, body)
        self.assertIn(body["action"], ("book", "inspect", "wait", "leave"))
        self.assertIn("values", body)
        status, body, _ = self.call("POST", "/api/occupancy", {"prior": 0.55, "reports": ["free", "busy"]})
        self.assertEqual(status, 200, body)
        self.assertIn("predictive_next", body)

    def test_hmm_report_length_boundaries(self):
        for reports in ([], ["free"] * 25, "free"):
            with self.subTest(reports=reports):
                self.assertEqual(self.call("POST", "/api/occupancy", {"prior": 0.5, "reports": reports})[0], 400)

    def test_plan_accepts_hmm_history(self):
        plan = self.plan(reports={"T-ROOM": ["free", "busy", "free"]})
        self.assertEqual(len(plan["assignments"]), 1)

    def test_calendar_is_escaped_and_explicitly_simulated(self):
        title = "Group, A; code\\review 'SQL'"
        self.assertEqual(self.commit(self.plan([request(title=title)]))[0], 201)
        status, body, headers = self.call("GET", "/api/export?date=" + DAY)
        self.assertEqual(status, 200)
        text = body.decode("utf-8")
        self.assertIn("BEGIN:VCALENDAR\r\n", text)
        self.assertEqual(text.count("BEGIN:VEVENT"), 1)
        self.assertIn("SUMMARY:[SIMULATION] Group\\, A\\; code\\\\review 'SQL'", text)
        self.assertIn("DTSTART:20261119T090000", text)
        self.assertIn("DTEND:20261119T100000", text)
        self.assertIn("floating local times", text.replace("\r\n ", ""))
        self.assertIn("attachment;", headers["Content-Disposition"])
        self.assertTrue(all(len(line.encode("utf-8")) <= 75 for line in text.split("\r\n")))

    def test_ics_unicode_folding_preserves_characters(self):
        title = "Ғибрат " * 18
        encoded = server.make_calendar([{"id": "test", "date": DAY, "start": 540, "end": 600,
                                         "resource_id": "T-ROOM", "title": title}], RESOURCES)
        text = encoded.decode("utf-8")
        unfolded = text.replace("\r\n ", "")
        self.assertIn("SUMMARY:[SIMULATION] " + title, unfolded)
        self.assertTrue(all(len(line.encode("utf-8")) <= 75 for line in text.split("\r\n")))

    def test_database_persists_across_application_instances(self):
        self.assertEqual(self.commit(self.plan())[0], 201)
        reopened = server.SchedulerApplication(self.db_path, resources=RESOURCES)
        self.assertEqual(len(reopened.store.list(DAY)), 1)

    def test_unknown_routes_and_local_cancel_id(self):
        self.assertEqual(self.call("GET", "/not-found")[0], 404)
        self.assertEqual(self.call("GET", "/../server.py")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/bookings/00000000-0000-0000-0000-000000000000")[0], 404)


class ValidationTests(unittest.TestCase):
    def test_build_server_cannot_bind_publicly(self):
        with self.assertRaises(ValueError):
            server.build_server(host="0.0.0.0")

    def test_calendar_text_escape_prevents_property_injection(self):
        self.assertEqual(server.ical_escape("hello\r\nBEGIN:VEVENT"), "hello\\nBEGIN:VEVENT")

    def test_valid_leap_day(self):
        self.assertEqual(server.validate_date("2028-02-29"), "2028-02-29")


class LiveLoopbackTests(unittest.TestCase):
    def test_actual_network_state(self):
        with tempfile.TemporaryDirectory(prefix="expo_network_test_") as temp:
            local = server.build_server(port=0, db_path=Path(temp) / "live.sqlite3", resources=RESOURCES)
            worker = threading.Thread(target=lambda: local.serve_forever(poll_interval=0.01), daemon=True)
            worker.start()
            connection = http.client.HTTPConnection("127.0.0.1", local.server_address[1], timeout=3)
            try:
                try:
                    connection.request("GET", "/api/state?date=" + DAY)
                except PermissionError as exc:
                    self.skipTest("Execution environment blocks loopback socket connections: " + str(exc))
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertTrue(json.loads(response.read())["simulation"])
            finally:
                connection.close()
                local.shutdown()
                local.server_close()
                worker.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
