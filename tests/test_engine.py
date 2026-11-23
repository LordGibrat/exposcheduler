"""Independent checks of probabilities, graph paths, and schedule invariants."""
import itertools
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine

DAY = "2026-12-01"


def request(rid="Q1", **changes):
    result = dict(id=rid, title="Study session", kind="study_room", group_size=4,
                  features=[], preferred_floor=1, earliest=540, latest=600,
                  duration=60, priority=1, accessible=False)
    result.update(changes)
    return result


def toy_resources():
    return [dict(id="R-A", name="Projector room", floor=1, kind="study_room", capacity=8,
                 features=["projector", "quiet", "wheelchair"], parent_id=None, prior=.7),
            dict(id="R-B", name="Second room", floor=2, kind="study_room", capacity=4,
                 features=["whiteboard", "quiet", "wheelchair"], parent_id=None, prior=.8)]


def independent_conflict(a, b, resources):
    parents = {r["id"]: r.get("parent_id") for r in resources}
    def chain(node):
        answer = set()
        while node:
            answer.add(node)
            node = parents.get(node)
        return answer
    return a == b or a in chain(b) or b in chain(a)


def assert_feasible(test, assignments, resources, bookings=()):
    test.assertEqual(len({a["request_id"] for a in assignments}), len(assignments))
    for a, b in itertools.combinations(assignments, 2):
        if independent_conflict(a["resource_id"], b["resource_id"], resources):
            test.assertFalse(a["start"] < b["end"] and b["start"] < a["end"])
    for a in assignments:
        for b in bookings:
            if b["date"] == DAY and independent_conflict(a["resource_id"], b["resource_id"], resources):
                test.assertFalse(a["start"] < b["end"] and b["start"] < a["end"])


def brute_schedule(domains, resources):
    """Independent exhaustive Cartesian enumeration, for tiny fixtures only."""
    best = 0.0
    for choices in itertools.product(*[[None] + d for d in domains]):
        chosen = [c for c in choices if c is not None]
        feasible = True
        for a, b in itertools.combinations(chosen, 2):
            if (independent_conflict(a["resource_id"], b["resource_id"], resources)
                    and a["start"] < b["end"] and b["start"] < a["end"]):
                feasible = False
                break
        if feasible:
            best = max(best, sum(c["score"] for c in chosen))
    return best


class ProbabilityTests(unittest.TestCase):
    def test_bayes_hand_calculation(self):
        self.assertAlmostEqual(engine.posterior(.6, "free", .85, .25), .51/.61)
        self.assertAlmostEqual(engine.posterior(.6, "busy", .85, .25), .09/.39)

    def test_no_evidence_and_uninformative_report(self):
        for prior in [0, .1, .5, .9, 1]:
            with self.subTest(prior=prior):
                self.assertAlmostEqual(engine.posterior(prior, "unknown"), prior)
                self.assertAlmostEqual(engine.posterior(prior, "free", .5, .5), prior)

    def test_bad_probabilities_and_impossible_evidence(self):
        for value in [-.1, 1.1, float("nan"), float("inf"), "0.5", True]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                engine.posterior(value, "free")
        with self.assertRaises(ValueError):
            engine.posterior(0, "free", 1, 0)
        with self.assertRaises(ValueError):
            engine.posterior(.5, "not_a_report")

    def test_evidence_direction(self):
        for prior in [.1, .3, .5, .7, .9]:
            self.assertGreater(engine.posterior(prior, "free"), prior)
            self.assertLess(engine.posterior(prior, "busy"), prior)

    def test_hmm_against_hidden_state_enumeration(self):
        observations = ["free", "busy", "free"]
        prior, stay, become, sensitivity, fp = .6, .8, .35, .85, .15
        weight_free = weight_all = 0.
        for states in itertools.product([False, True], repeat=len(observations)):
            probability = prior if states[0] else 1-prior
            for i, (state, observation) in enumerate(zip(states, observations)):
                if i:
                    next_free = stay if states[i-1] else become
                    probability *= next_free if state else 1-next_free
                like_free = sensitivity if state else fp
                probability *= like_free if observation == "free" else 1-like_free
            weight_all += probability
            weight_free += probability if states[-1] else 0
        actual = engine.hmm_filter(prior, observations, sensitivity, fp, stay, become)
        # Use next-step forecast so the check is independent of trace formatting.
        self.assertAlmostEqual(actual["predictive_next"],
                               (weight_free/weight_all)*stay + (1-weight_free/weight_all)*become)

    def test_hmm_unknown_sequence_and_invalid_input(self):
        actual = engine.hmm_filter(.6, ["unknown", "unknown"])
        self.assertAlmostEqual(actual["predictive_next"], (.6*.8+.4*.35)*.8+(1-(.6*.8+.4*.35))*.35)
        for reports in [["bad"], ["free"]*25]:
            with self.subTest(reports=reports), self.assertRaises(ValueError):
                engine.hmm_filter(.5, reports)


class DecisionTests(unittest.TestCase):
    def test_horizon_one_matches_expected_utility(self):
        for belief in [0, .2, .5, .8, 1]:
            answer = engine.decision(belief, horizon=1)
            self.assertAlmostEqual(answer["values"]["book"], 10*belief-8*(1-belief))
            self.assertEqual(answer["action"], "book" if belief > 8/18 else "leave")

    def test_perfect_inspection_has_information_value(self):
        answer = engine.decision(.5, horizon=2, sensitivity=1, false_positive=0,
                                 inspect_cost=0, wait_cost=100)
        self.assertEqual(answer["action"], "inspect")
        self.assertAlmostEqual(answer["values"]["inspect"], 5.)

    def test_wait_can_change_occupancy(self):
        answer = engine.decision(0, horizon=2, stay_free=1, become_free=1,
                                 wait_cost=.8, inspect_cost=100)
        self.assertEqual(answer["action"], "wait")
        self.assertAlmostEqual(answer["values"]["wait"], 9.2)

    def test_decision_horizon_and_cost_validation(self):
        for kwargs in [dict(horizon=0),dict(horizon=6),dict(horizon=True),
                       dict(inspect_cost=-1),dict(wait_cost=float("nan"))]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                engine.decision(.5, **kwargs)


class RouteTests(unittest.TestCase):
    def test_astar_matches_independent_dijkstra_on_all_node_pairs(self):
        import heapq
        for accessible in [False, True]:
            graph = engine.build_route_graph(accessible)
            for start, goal in itertools.product(graph, repeat=2):
                queue, distances = [(0., start)], {start: 0.}
                while queue:
                    cost, node = heapq.heappop(queue)
                    if cost != distances[node]:
                        continue
                    for nxt, weight in graph[node].items():
                        new_cost = cost+weight
                        if new_cost < distances.get(nxt, math.inf):
                            distances[nxt] = new_cost
                            heapq.heappush(queue, (new_cost, nxt))
                actual = engine.astar(graph, start, goal, lambda _node: 0)
                self.assertAlmostEqual(actual["cost"], distances[goal])

    def test_route_accessibility_and_endpoints(self):
        for start, end in itertools.product(range(1,9), repeat=2):
            answer = engine.route(start, end, True)
            self.assertTrue(answer["path"])
            self.assertTrue(math.isfinite(answer["cost"]))
            self.assertFalse(any("stair" in node.lower() for node in answer["path"]))


class ScheduleTests(unittest.TestCase):
    def test_parent_child_conflict_but_not_siblings(self):
        rooms = engine.load_resources()
        kids = [r for r in rooms if r.get("parent_id")]
        self.assertGreaterEqual(len(kids), 2)
        a,b = kids[:2]
        self.assertTrue(engine.resources_conflict(a["parent_id"],a["id"],rooms))
        self.assertTrue(engine.resources_conflict(a["id"],a["parent_id"],rooms))
        self.assertFalse(engine.resources_conflict(a["id"],b["id"],rooms))

    def test_half_open_intervals(self):
        self.assertFalse(engine.overlap(540,600,600,660))
        self.assertTrue(engine.overlap(540,600,570,630))

    def test_capacity_features_window_and_opening_hours(self):
        rooms = toy_resources()
        for invalid in [dict(group_size=9), dict(features=["macOS"]),
                        dict(kind="auditorium")]:
            self.assertEqual(engine.candidates(request(**invalid),rooms,[],DAY),[])
        candidates = engine.candidates(request(),rooms,[],DAY)
        self.assertTrue(candidates)
        self.assertTrue(all(c["start"]==540 and c["end"]==600 for c in candidates))

    def test_invalid_request_variants(self):
        for kwargs in [dict(group_size=0),dict(group_size=True),dict(priority=4),
                       dict(earliest=475),dict(duration=0),dict(duration=45),
                       dict(latest=530),dict(preferred_floor=9),dict(title=""),
                       dict(features="quiet"),dict(accessible="yes")]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                engine.validate_request(request(**kwargs))

    def test_booking_and_different_date(self):
        rooms = toy_resources()
        occupied = [dict(id="B1",resource_id="R-A",date=DAY,start=540,end=600,title="Busy")]
        answer = engine.candidates(request(),rooms,occupied,DAY)
        self.assertEqual({c["resource_id"] for c in answer},{"R-B"})
        self.assertEqual(len(engine.candidates(request(),rooms,occupied,"2026-12-02")),2)

    def test_hill_improves_first_fit_trap(self):
        rooms=toy_resources()
        reqs=[request("flexible"),request("needs_projector",features=["projector"],priority=3)]
        answer=engine.plan(reqs,rooms,[],DAY)
        self.assertGreater(answer["score"],answer["baseline_score"])
        self.assertEqual(len(answer["assignments"]),2)
        assert_feasible(self,answer["assignments"],rooms)
        self.assertTrue(all(b>=a-1e-8 for a,b in zip(answer["trace"],answer["trace"][1:])))

    def test_exact_matches_independent_exhaustive_enumerator(self):
        rooms=toy_resources()
        reqs=[request("A",latest=660),request("B",latest=660,features=["projector"]),
              request("C",latest=630,priority=3)]
        domains=[engine.candidates(r,rooms,[],DAY) for r in reqs]
        expected=brute_schedule(domains,rooms)
        answer=engine.plan(reqs,rooms,[],DAY,method="exact")
        self.assertAlmostEqual(answer["score"],expected,places=5)
        self.assertTrue(answer["diagnostics"]["optimal"])
        assert_feasible(self,answer["assignments"],rooms)

    def test_reproducibility_and_unsatisfiable_request(self):
        rooms=toy_resources()
        reqs=[request("A",latest=660),request("B",latest=660)]
        a=engine.plan(reqs,rooms,[],DAY,seed=123)
        b=engine.plan(reqs,rooms,[],DAY,seed=123)
        self.assertEqual(a["assignments"],b["assignments"])
        self.assertEqual(a["trace"],b["trace"])
        impossible=engine.plan([request(group_size=100)],rooms,[],DAY)
        self.assertEqual(impossible["assignments"],[])
        self.assertTrue(impossible["unassigned"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
