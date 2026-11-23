"""Stateless deployment adapter tests using real HTTP parsing without sockets.

These tests use the same canonical engine and inventory as the notebook and
local demo. All supplied reservations are synthetic client-owned constraints.
"""

from io import BytesIO
import json
import unittest
from unittest.mock import patch

from api import index as api

DAY = "2026-11-19"
HOST = "expo-example.vercel.app"


class MemorySocket:
    def __init__(self, body):
        self.incoming = BytesIO(body)
        self.outgoing = BytesIO()

    def makefile(self, mode, *args):
        return self.incoming

    def sendall(self, body):
        self.outgoing.write(body)


def request(kind="auditorium", request_id="online-test", title="Demo event"):
    return {"id": request_id, "title": title, "kind": kind, "group_size": 1,
            "features": [], "preferred_floor": 4, "earliest": 540, "latest": 600,
            "duration": 60, "priority": 2, "accessible": False}


def booking(resource_id, day=DAY, start=540, end=600):
    return {"id": "local-example", "resource_id": resource_id, "date": day,
            "start": start, "end": end, "title": "Browser-only example"}


class StatelessAPITests(unittest.TestCase):
    def call(self, method, path, payload=None, raw=None, headers=None):
        request_headers = {"Host": HOST, "Origin": "https://" + HOST}
        body = raw if raw is not None else json.dumps(payload).encode("utf-8") if payload is not None else b""
        if body:
            request_headers.update({"Content-Type": "application/json", "Content-Length": str(len(body))})
        if headers:
            request_headers.update(headers)
        head = f"{method} {path} HTTP/1.0\r\n" + "".join(f"{key}: {value}\r\n" for key, value in request_headers.items()) + "\r\n"
        stream = MemorySocket(head.encode("ascii") + body)
        api.handler(stream, ("127.0.0.1", 12345), object())
        response_head, response_body = stream.outgoing.getvalue().split(b"\r\n\r\n", 1)
        lines = response_head.decode("iso-8859-1").split("\r\n")
        status = int(lines[0].split(" ")[1])
        response_headers = dict(line.split(": ", 1) for line in lines[1:])
        return status, json.loads(response_body) if response_body else None, response_headers

    def plan(self, **overrides):
        payload = {"date": DAY, "requests": [request()], **overrides}
        status, result, _ = self.call("POST", "/api/plan", payload)
        self.assertEqual(status, 200, result)
        return result

    def test_state_uses_canonical_inventory_and_browser_storage(self):
        status, result, headers = self.call("GET", "/api/state?date=" + DAY)
        self.assertEqual(status, 200)
        self.assertTrue(result["simulation"])
        self.assertEqual(result["storage_mode"], "browser")
        self.assertEqual(result["bookings"], [])
        self.assertEqual(result["resources"], api.engine.load_resources())
        self.assertTrue(result["floors"])
        self.assertTrue(result["scenarios"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_rewritten_state_route_matches_direct_route(self):
        direct = self.call("GET", "/api/state?date=" + DAY)
        rewritten = self.call("GET", "/api?route=state&date=" + DAY)
        self.assertEqual(direct[:2], rewritten[:2])

    def test_vercel_original_path_with_matching_rewrite_metadata(self):
        direct = self.call("GET", "/api/state?date=" + DAY)
        transported = self.call("GET", "/api/state?route=state&path=state&date=" + DAY + "&_vercel_share=private-transport-marker")
        self.assertEqual(transported[:2], direct[:2])
        self.assertNotIn("private-transport-marker", str(transported[1]))

    def test_vercel_destination_path_with_matching_capture(self):
        direct = self.call("GET", "/api/state?date=" + DAY)
        transported = self.call("GET", "/api?route=state&path=state&date=" + DAY + "&_vercel_share=private-transport-marker")
        self.assertEqual(transported[:2], direct[:2])

    def test_vercel_metadata_is_removed_before_post_validation(self):
        status, result, _ = self.call("POST", "/api/decision?route=decision&path=decision&_vercel_share=private-transport-marker",
                                      {"belief": 0.5, "horizon": 2})
        self.assertEqual(status, 200, result)
        self.assertEqual(result, api.engine.decision(belief=0.5, horizon=2))

    def test_vercel_mismatched_route_and_capture_are_rejected(self):
        for path in ("/api/state?route=plan&path=state", "/api/state?route=state&path=plan",
                     "/api?route=state&path=plan", "/api/state?path=../state",
                     "/api/state?route=state&path=state/extra"):
            with self.subTest(path=path):
                self.assertEqual(self.call("GET", path)[0], 400)

    def test_duplicate_vercel_transport_metadata_is_rejected(self):
        for path in ("/api/state?route=state&path=state&path=state",
                     "/api/state?_vercel_share=one&_vercel_share=two",
                     "/api/state?route=state&route=state"):
            with self.subTest(path=path):
                self.assertEqual(self.call("GET", path)[0], 400)

    def test_share_metadata_never_authorizes_unknown_queries_or_routes(self):
        self.assertEqual(self.call("GET", "/api/state?_vercel_share=private-marker&extra=value")[0], 400)
        self.assertEqual(self.call("GET", "/api?route=unknown&path=unknown&_vercel_share=private-marker")[0], 404)

    def test_rewritten_plan_route(self):
        status, result, _ = self.call("POST", "/api?route=plan", {"date": DAY, "requests": [request()]})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["date"], DAY)
        self.assertEqual(len(result["assignments"]), 1)

    def test_plan_contains_correlation_id_without_server_persistence(self):
        first, second = self.plan(), self.plan()
        self.assertEqual(first["assignments"], second["assignments"])
        self.assertNotEqual(first["plan_id"], second["plan_id"])
        self.assertEqual(first["storage_mode"], "browser")
        self.assertTrue(first["simulation"])
        self.assertEqual(self.call("GET", "/api/state?date=" + DAY)[1]["bookings"], [])

    def test_client_supplied_parent_lab_blocks_all_imacs(self):
        resources = api.inventory()[0]
        lab = next(item for item in resources if item["kind"] == "computer_lab")
        result = self.plan(requests=[request("imac")], bookings=[booking(lab["id"])])
        self.assertEqual(result["assignments"], [])
        self.assertEqual(len(result["unassigned"]), 1)

    def test_client_imac_blocks_parent_lab(self):
        mac = next(item for item in api.inventory()[0] if item["kind"] == "imac")
        result = self.plan(requests=[request("computer_lab")], local_bookings=[booking(mac["id"])])
        self.assertEqual(result["assignments"], [])

    def test_client_imac_does_not_block_sibling_imac(self):
        mac = next(item for item in api.inventory()[0] if item["kind"] == "imac")
        result = self.plan(requests=[request("imac")], bookings=[booking(mac["id"])])
        self.assertEqual(len(result["assignments"]), 1)
        self.assertNotEqual(result["assignments"][0]["resource_id"], mac["id"])

    def test_client_bookings_do_not_leak_to_next_request(self):
        aud = next(item for item in api.inventory()[0] if item["kind"] == "auditorium")
        occupied = self.plan(bookings=[booking(aud["id"])])
        fresh = self.plan()
        self.assertEqual(occupied["assignments"], [])
        self.assertEqual(len(fresh["assignments"]), 1)

    def test_existing_bookings_on_another_day_do_not_block(self):
        aud = next(item for item in api.inventory()[0] if item["kind"] == "auditorium")
        result = self.plan(bookings=[booking(aud["id"], day="2026-11-20")])
        self.assertEqual(len(result["assignments"]), 1)

    def test_back_to_back_client_booking_allowed(self):
        aud = next(item for item in api.inventory()[0] if item["kind"] == "auditorium")
        result = self.plan(bookings=[booking(aud["id"], start=480, end=540)])
        self.assertEqual(len(result["assignments"]), 1)

    def test_untrusted_booking_data_is_validated(self):
        examples = [None, "not-a-list", [None], [booking("unknown-resource")],
                    [booking("F4-LAB", start=541)], [booking("F4-LAB", start=600, end=540)],
                    [booking("F4-LAB", day="2026-02-30")], [booking("F4-LAB", day="1999-12-31")]]
        for bookings in examples:
            with self.subTest(bookings=bookings):
                status, _, _ = self.call("POST", "/api/plan", {"date": DAY, "requests": [request()], "bookings": bookings})
                self.assertEqual(status, 400)

    def test_ambiguous_booking_fields_are_rejected(self):
        status, _, _ = self.call("POST", "/api/plan", {"date": DAY, "requests": [request()],
                                                        "bookings": [], "local_bookings": []})
        self.assertEqual(status, 400)

    def test_no_database_connection_for_stateless_endpoints(self):
        with patch("server.sqlite3.connect", side_effect=AssertionError("Database use is forbidden")):
            self.assertEqual(self.call("GET", "/api/state?date=" + DAY)[0], 200)
            self.assertEqual(len(self.plan()["assignments"]), 1)
            self.assertEqual(self.call("POST", "/api/decision", {"belief": 0.55})[0], 200)
            self.assertEqual(self.call("POST", "/api/occupancy", {"prior": 0.5, "reports": ["free"]})[0], 200)

    def test_server_mutations_and_export_are_explicitly_browser_owned(self):
        for method, path in [("GET", "/api/bookings"), ("POST", "/api/bookings"),
                             ("GET", "/api/export?date=" + DAY), ("POST", "/api/export"),
                             ("DELETE", "/api/bookings/00000000-0000-0000-0000-000000000000"),
                             ("POST", "/api?route=bookings")]:
            with self.subTest(method=method, path=path):
                status, result, _ = self.call(method, path, {})
                self.assertEqual(status, 405)
                self.assertIn("browser-owned", result["error"])

    def test_decision_endpoint_uses_same_engine(self):
        payload = {"belief": 0.4, "horizon": 3, "inspect_cost": 0.7}
        status, result, _ = self.call("POST", "/api/decision", payload)
        self.assertEqual(status, 200, result)
        self.assertEqual(result, api.engine.decision(**payload))

    def test_hmm_endpoint_uses_same_engine(self):
        payload = {"prior": 0.5, "reports": ["free", "busy", "unknown"], "sensitivity": 0.8, "false_positive": 0.2}
        status, result, _ = self.call("POST", "/api?route=occupancy", payload)
        self.assertEqual(status, 200, result)
        self.assertEqual(result, api.engine.hmm_filter(**payload))

    def test_hypothetical_hmm_reports_feed_planning(self):
        aud = next(item for item in api.inventory()[0] if item["kind"] == "auditorium")
        result = self.plan(reports={aud["id"]: ["busy", "free"]}, assumptions={"sensitivity": 0.8, "false_positive": 0.2})
        self.assertEqual(len(result["assignments"]), 1)
        expected = api.engine.hmm_filter(aud["prior"], ["busy", "free"], sensitivity=0.8, false_positive=0.2)["predictive_next"]
        self.assertAlmostEqual(result["assignments"][0]["belief"], expected)

    def test_invalid_dates_are_rejected(self):
        for day in ("2026-02-30", "2026-11-9", "1999-12-31", "2101-01-01", ""):
            with self.subTest(day=day):
                self.assertEqual(self.call("GET", "/api?route=state&date=" + day)[0], 400)
                self.assertEqual(self.call("POST", "/api/plan", {"date": day, "requests": [request()]})[0], 400)

    def test_request_and_probability_boundaries(self):
        cases = [{"requests": []}, {"requests": [request()] * 11},
                 {"requests": [request(), request()]}, {"seed": True}, {"seed": -1},
                 {"method": "invented"}, {"method": []}, {"reports": {"unknown": "free"}},
                 {"assumptions": {"sensitivity": 1.1}}, {"assumptions": {"other": 1}}]
        for override in cases:
            with self.subTest(override=override):
                status, _, _ = self.call("POST", "/api/plan", {"date": DAY, "requests": [request()], **override})
                self.assertEqual(status, 400)

    def test_invalid_lab_parameters_return_400(self):
        for route, payload in [("decision", {"belief": -0.1}), ("decision", {"belief": 0.5, "horizon": 6}),
                               ("decision", {"belief": 0.5, "unrecognized": 2}),
                               ("occupancy", {"prior": 0.5, "reports": []}),
                               ("occupancy", {"prior": 0.5, "reports": ["free"] * 25}),
                               ("occupancy", {"prior": 0.5, "reports": ["invalid"]})]:
            with self.subTest(route=route, payload=payload):
                self.assertEqual(self.call("POST", "/api/" + route, payload)[0], 400)

    def test_nonfinite_duplicate_and_malformed_json(self):
        for body in (b"{", b"[]", b"null", b"\xff", b'{"belief":NaN}', b'{"belief":Infinity}',
                     b'{"belief":1e999}', b'{"belief":0.2,"belief":0.8}'):
            with self.subTest(body=body):
                self.assertEqual(self.call("POST", "/api/decision", raw=body)[0], 400)

    def test_unknown_fields_are_not_reflected(self):
        status, result, _ = self.call("POST", "/api/decision", {"belief": 0.5, "private-secret-marker": "<script>"})
        self.assertEqual(status, 400)
        self.assertNotIn("private-secret-marker", str(result))
        self.assertNotIn("<script>", str(result))

    def test_oversized_and_truncated_bodies(self):
        self.assertEqual(self.call("POST", "/api/decision", raw=b" " * (api.MAX_BODY + 1))[0], 413)
        self.assertEqual(self.call("POST", "/api/decision", raw=b"{}", headers={"Content-Length": "20"})[0], 400)

    def test_wrong_content_type_and_transfer_encoding(self):
        self.assertEqual(self.call("POST", "/api/decision", {"belief": 0.5}, headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.call("POST", "/api/decision", {"belief": 0.5}, headers={"Transfer-Encoding": "chunked"})[0], 400)

    def test_same_host_origin_is_allowed(self):
        self.assertEqual(self.call("POST", "/api/decision", {"belief": 0.5})[0], 200)

    def test_absent_origin_is_allowed_for_stateless_api_clients(self):
        body = b'{"belief":0.5}'
        raw = b"POST /api/decision HTTP/1.0\r\nHost: " + HOST.encode() + b"\r\nContent-Type: application/json\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
        stream = MemorySocket(raw)
        api.handler(stream, ("127.0.0.1", 12345), object())
        self.assertTrue(stream.outgoing.getvalue().startswith(b"HTTP/1.0 200 "))

    def test_cross_host_and_null_origins_are_rejected(self):
        for origin in ("https://attacker.example", "null", "https://" + HOST + "/path", "https://" + HOST + "@evil.example"):
            with self.subTest(origin=origin):
                self.assertEqual(self.call("POST", "/api/decision", {"belief": 0.5}, headers={"Origin": origin})[0], 403)

    def test_malformed_and_unknown_routes_are_404(self):
        for path in ("/api", "/api?route=", "/api?route=unknown", "/api?route=../engine.py",
                     "/api/state/extra", "/outside", "/api/bookings/not-a-uuid"):
            with self.subTest(path=path):
                self.assertEqual(self.call("GET", path)[0], 404)

    def test_ambiguous_or_unknown_queries_are_rejected(self):
        for path in ("/api?route=state&route=plan", "/api/state?route=plan", "/api/state?date=" + DAY + "&date=" + DAY,
                     "/api/state?secret=value"):
            with self.subTest(path=path):
                self.assertEqual(self.call("GET", path)[0], 400)

    def test_method_restrictions_and_head(self):
        self.assertEqual(self.call("GET", "/api/decision")[0], 405)
        self.assertEqual(self.call("POST", "/api/state", {})[0], 405)
        self.assertEqual(self.call("PUT", "/api/plan", {})[0], 405)
        status, body, _ = self.call("HEAD", "/api/state?date=" + DAY)
        self.assertEqual(status, 200)
        self.assertIsNone(body)


if __name__ == "__main__":
    unittest.main()
