"""Explainable AI methods for an entirely synthetic Expo scheduling prototype.

Only the Python standard library is used. Capacities, travel times, occupancy
probabilities and utility weights are illustrative assumptions, not measurements.
"""
from __future__ import annotations

from datetime import date as Date
from functools import lru_cache
import heapq
import json
import math
from pathlib import Path
import random

OPEN, CLOSE, STEP = 480, 1200, 30
KINDS = {"study_room", "classroom", "auditorium", "imac", "computer_lab", "meeting_room", "lounge"}
FEATURES = {"quiet", "projector", "whiteboard", "wheelchair", "macOS"}
DATA_DIR = Path(__file__).resolve().parent / "data"
FLOOR_NODES = {floor: f"F{floor} lobby" for floor in range(1, 9)}


def _number(value, name, low=None, high=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if low is not None and value < low or high is not None and value > high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return float(value)


def _integer(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be an integer from {low} to {high}")
    return value


def _text(value, name, limit=120):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{name} must contain 1 to {limit} characters")
    if any(ord(c) < 32 for c in value):
        raise ValueError(f"{name} cannot contain control characters")
    return value.strip()


def _date(value):
    if not isinstance(value, str):
        raise ValueError("date must use YYYY-MM-DD")
    try:
        parsed = Date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("date must use YYYY-MM-DD") from exc
    if parsed.isoformat() != value:
        raise ValueError("date must use YYYY-MM-DD")
    return value


def _time(value, name):
    value = _integer(value, name, OPEN, CLOSE)
    if value % STEP:
        raise ValueError(f"{name} must be on a 30-minute boundary")
    return value


def load_resources():
    """Load the one canonical, editable synthetic inventory used by every client."""
    resources = json.loads((DATA_DIR / "resources.json").read_text(encoding="utf-8"))
    _resource_map(resources)
    return resources


def _resource_map(resources):
    if not isinstance(resources, list) or not 1 <= len(resources) <= 100:
        raise ValueError("resources must be a nonempty list with at most 100 items")
    mapping = {}
    for r in resources:
        if not isinstance(r, dict):
            raise ValueError("each resource must be an object")
        rid = _text(r.get("id"), "resource id", 60)
        if rid != r["id"]:
            raise ValueError("resource IDs cannot contain leading or trailing spaces")
        if rid in mapping:
            raise ValueError("resource IDs must be unique")
        _text(r.get("name"), "resource name")
        _integer(r.get("floor"), "resource floor", 1, 8)
        _integer(r.get("capacity"), "resource capacity", 1, 500)
        if not isinstance(r.get("kind"), str) or r["kind"] not in KINDS:
            raise ValueError("unknown resource kind")
        if not isinstance(r.get("features"), list) or any(not isinstance(f, str) or f not in FEATURES for f in r["features"]):
            raise ValueError("resource features must be a list of known features")
        _number(r.get("prior"), "resource prior", 0, 1)
        mapping[rid] = r
    for rid, resource in mapping.items():
        seen = {rid}
        parent = resource.get("parent_id")
        while parent is not None:
            if not isinstance(parent, str):
                raise ValueError("parent_id must be a resource ID or null")
            if parent not in mapping:
                raise ValueError("parent_id must identify an existing resource")
            if parent in seen:
                raise ValueError("resource hierarchy cannot contain a cycle")
            seen.add(parent)
            parent = mapping[parent].get("parent_id")
    return mapping


def validate_request(request):
    """Validate explicit user inputs. Reject booleans passed as numeric fields."""
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    r = dict(request)
    r["id"] = _text(r.get("id"), "request id", 60)
    r["title"] = _text(r.get("title"), "title")
    if not isinstance(r.get("kind"), str) or r["kind"] not in KINDS | {"any"}:
        raise ValueError("kind must be any or a known resource kind")
    r["group_size"] = _integer(r.get("group_size"), "group size", 1, 500)
    if not isinstance(r.get("features"), list) or any(not isinstance(f, str) or f not in FEATURES for f in r["features"]):
        raise ValueError("features must be a list of known features")
    r["features"] = sorted(set(r["features"]))
    r["preferred_floor"] = _integer(r.get("preferred_floor"), "preferred floor", 1, 8)
    r["earliest"] = _time(r.get("earliest"), "earliest start")
    r["latest"] = _time(r.get("latest"), "latest end")
    r["duration"] = _integer(r.get("duration"), "duration", STEP, CLOSE - OPEN)
    if r["duration"] % STEP:
        raise ValueError("duration must be a multiple of 30 minutes")
    if r["earliest"] + r["duration"] > r["latest"]:
        raise ValueError("time window must be wide enough for the duration")
    r["priority"] = _integer(r.get("priority"), "priority", 1, 3)
    if not isinstance(r.get("accessible"), bool):
        raise ValueError("accessible must be true or false")
    return r


def posterior(prior, report, sensitivity=0.85, false_positive=0.15):
    """P(free | report). Sensitivity=P(report free|free), FPR=P(report free|busy)."""
    p = _number(prior, "prior", 0, 1)
    s = _number(sensitivity, "sensitivity", 0, 1)
    f = _number(false_positive, "false positive probability", 0, 1)
    if not isinstance(report, str) or report not in {"free", "busy", "unknown"}:
        raise ValueError("report must be free, busy or unknown")
    if report == "unknown":
        return p
    lf, lb = (s, f) if report == "free" else (1 - s, 1 - f)
    evidence = p * lf + (1 - p) * lb
    if evidence == 0:
        raise ValueError("report has zero probability under the supplied assumptions")
    return p * lf / evidence


def hmm_filter(prior, reports, sensitivity=0.85, false_positive=0.15,
               stay_free=0.8, become_free=0.35):
    """Two-state HMM forward filtering, followed by a one-slot prediction.

    First observation updates the initial prior. Before every later observation,
    apply the transition model. This model is specified, not learned from data.
    Every report is a hypothetical successive 30-minute observation, not a real
    sensor measurement. 'unknown' performs a transition but no measurement update.
    """
    p = _number(prior, "prior", 0, 1)
    s = _number(sensitivity, "sensitivity", 0, 1)
    f = _number(false_positive, "false positive probability", 0, 1)
    sf = _number(stay_free, "stay_free", 0, 1)
    bf = _number(become_free, "become_free", 0, 1)
    if not isinstance(reports, list) or not 1 <= len(reports) <= 24:
        raise ValueError("reports must contain 1 to 24 hypothetical observations")
    trace = []
    for i, report in enumerate(reports):
        prediction = p if i == 0 else p * sf + (1 - p) * bf
        p = posterior(prediction, report, s, f)
        trace.append({"step": i + 1, "report": report, "prior": prediction, "posterior": p})
    return {"trace": trace, "posterior": p, "predictive_next": p * sf + (1 - p) * bf,
            "model": "Specified two-state HMM forward filtering; synthetic successive 30-minute observations"}


def build_route_graph(accessible=False):
    """A toy floor graph. All edge costs are assumed walking minutes."""
    if not isinstance(accessible, bool):
        raise ValueError("accessible must be true or false")
    graph = {}
    def edge(a, b, cost):
        graph.setdefault(a, {})[b] = cost
        graph.setdefault(b, {})[a] = cost
    for floor in range(1, 9):
        edge(FLOOR_NODES[floor], f"F{floor} lift", 0.6)
        if not accessible:
            edge(FLOOR_NODES[floor], f"F{floor} stairs", 0.3)
        if floor > 1:
            edge(f"F{floor-1} lift", f"F{floor} lift", 0.8)
            if not accessible:
                edge(f"F{floor-1} stairs", f"F{floor} stairs", 1.3)
    return graph


ROUTE_GRAPH = build_route_graph()


def astar(graph, start, goal, heuristic):
    """A* graph search with reopening, nonnegative edges and caller-supplied h.

    An optimality guarantee requires an admissible heuristic. This function
    validates numeric heuristic values but cannot establish admissibility for an
    arbitrary graph. Our floor heuristic is proved admissible in the report.
    """
    if not isinstance(graph, dict) or start not in graph or goal not in graph:
        raise ValueError("start and goal must be graph nodes")
    for node, edges in graph.items():
        if not isinstance(edges, dict):
            raise ValueError("graph adjacency must be a dictionary")
        for nxt, cost in edges.items():
            if nxt not in graph:
                raise ValueError("edge refers to an unknown node")
            _number(cost, "edge cost", 0)
    def h(node):
        return _number(heuristic(node), "heuristic", 0)
    if abs(h(goal)) > 1e-9:
        raise ValueError("goal heuristic must be zero")
    queue = [(h(start), 0.0, start)]
    best = {start: 0.0}
    parent = {}
    expanded = 0
    while queue:
        _, cost, node = heapq.heappop(queue)
        if cost > best[node] + 1e-12:
            continue
        expanded += 1
        if node == goal:
            path = [goal]
            while path[-1] != start:
                path.append(parent[path[-1]])
            return {"path": list(reversed(path)), "cost": cost, "expanded": expanded}
        for nxt, weight in sorted(graph[node].items()):
            candidate_cost = cost + weight
            if candidate_cost + 1e-12 < best.get(nxt, math.inf):
                best[nxt], parent[nxt] = candidate_cost, node
                heapq.heappush(queue, (candidate_cost + h(nxt), candidate_cost, nxt))
    return {"path": [], "cost": None, "expanded": expanded}


def route(start_floor, target_floor, accessible=False):
    start = _integer(start_floor, "start floor", 1, 8)
    target = _integer(target_floor, "target floor", 1, 8)
    graph = build_route_graph(accessible)
    # Every vertical edge costs at least 0.8 minutes per floor. Horizontal costs
    # are nonnegative, so this ignores costs and cannot overestimate the route.
    result = astar(graph, FLOOR_NODES[start], FLOOR_NODES[target],
                   lambda node: abs(int(node[1]) - target) * 0.8)
    result["path"].append("Resource door (assumed 1 minute)")
    result["cost"] += 1.0
    return result


def overlap(start1, end1, start2, end2):
    """Half-open intervals: 10:00-11:00 and 11:00-12:00 do not overlap."""
    return start1 < end2 and start2 < end1


def _conflict(id1, id2, mapping):
    if not isinstance(id1, str) or not isinstance(id2, str) or id1 not in mapping or id2 not in mapping:
        raise ValueError("unknown resource id")
    if id1 == id2:
        return True
    for child, ancestor in ((id1, id2), (id2, id1)):
        parent = mapping[child].get("parent_id")
        while parent is not None:
            if parent == ancestor:
                return True
            parent = mapping[parent].get("parent_id")
    return False


def resources_conflict(id1, id2, resources):
    return _conflict(id1, id2, _resource_map(resources))


def _bookings(bookings, mapping):
    if not isinstance(bookings, list) or len(bookings) > 10000:
        raise ValueError("bookings must be a list with at most 10000 entries")
    for b in bookings:
        if not isinstance(b, dict) or not isinstance(b.get("resource_id"), str) or b["resource_id"] not in mapping:
            raise ValueError("booking must refer to a known resource")
        _date(b.get("date"))
        start, end = _time(b.get("start"), "booking start"), _time(b.get("end"), "booking end")
        if start >= end:
            raise ValueError("booking end must be after its start")
    return bookings


def _assumptions(assumptions):
    if assumptions is None:
        return {"sensitivity": .85, "false_positive": .15}
    if not isinstance(assumptions, dict) or set(assumptions) - {"sensitivity", "false_positive"}:
        raise ValueError("assumptions supports sensitivity and false_positive only")
    return {"sensitivity": _number(assumptions.get("sensitivity", .85), "sensitivity", 0, 1),
            "false_positive": _number(assumptions.get("false_positive", .15), "false_positive", 0, 1)}


def _reports(reports, mapping, assumptions):
    if reports is None:
        reports = {}
    if not isinstance(reports, dict) or set(reports) - set(mapping):
        raise ValueError("reports must map known resource IDs to hypothetical reports")
    result = {}
    for rid, resource in mapping.items():
        evidence = reports.get(rid, "unknown")
        if isinstance(evidence, list):
            result[rid] = (hmm_filter(resource["prior"], evidence, **assumptions)["predictive_next"],
                           "HMM next-slot prediction from hypothetical report sequence")
        else:
            result[rid] = (posterior(resource["prior"], evidence, **assumptions),
                           f"Bayesian posterior from hypothetical {evidence} report")
    return result


def _candidates(r, resources, mapping, bookings, date, beliefs):
    result = []
    for resource in sorted(resources, key=lambda x: x["id"]):
        if r["kind"] != "any" and resource["kind"] != r["kind"]:
            continue
        if resource["capacity"] < r["group_size"]:
            continue
        required = set(r["features"]) | ({"wheelchair"} if r["accessible"] else set())
        if not required.issubset(resource["features"]):
            continue
        travel = route(r["preferred_floor"], resource["floor"], r["accessible"])
        belief, source = beliefs[resource["id"]]
        for start in range(r["earliest"], r["latest"] - r["duration"] + 1, STEP):
            end = start + r["duration"]
            if any(b["date"] == date and _conflict(resource["id"], b["resource_id"], mapping)
                   and overlap(start, end, b["start"], b["end"]) for b in bookings):
                continue
            wait_slots = (start - r["earliest"]) / STEP
            spare = resource["capacity"] - r["group_size"]
            # Synthetic utility units. Every assignment scores positively within
            # the supported range. Priority is user-selected, not inferred.
            score = 100 * r["priority"] + 30 * belief - 1.2 * wait_slots - 1.5 * travel["cost"] - .1 * spare
            result.append({"request_id": r["id"], "resource_id": resource["id"],
                           "start": start, "end": end, "score": score, "belief": belief,
                           "route": travel,
                           "explanation": f"Capacity {resource['capacity']} fits {r['group_size']}; required equipment available. "
                           f"{source}: {belief:.3f}. Assumed travel {travel['cost']:.1f} min; "
                           f"delay {int(start-r['earliest'])} min. Synthetic utility {score:.2f}. "
                           "Known local reservations are hard constraints; probability never overrides a booking."})
    return result


def candidates(request, resources, bookings, date, reports=None, assumptions=None):
    r = validate_request(request)
    mapping = _resource_map(resources)
    _date(date)
    _bookings(bookings, mapping)
    return _candidates(r, resources, mapping, bookings, date, _reports(reports, mapping, _assumptions(assumptions)))


def _compatible(candidate, existing, mapping):
    return all(not (_conflict(candidate["resource_id"], x["resource_id"], mapping)
                    and overlap(candidate["start"], candidate["end"], x["start"], x["end"]))
               for x in existing if x is not None)


def _score(schedule):
    return sum(c["score"] for c in schedule if c is not None)


def plan(requests, resources, bookings, date, reports=None, assumptions=None, seed=42, method="hill"):
    """Allocate one day's requests with a baseline, local search or exact CSP.

    CSP variables are requests and domains are feasible (resource,start) pairs
    plus unassigned. Exact mode uses complete domains, MRV ordering, pairwise
    constraints and an upper bound. Its node cap is disclosed in diagnostics.
    Local search uses full single moves and a bounded shortlist for pair moves.
    It retains the first-fit baseline, so its final objective cannot be worse.
    """
    if not isinstance(requests, list) or not 1 <= len(requests) <= 10:
        raise ValueError("provide between 1 and 10 requests")
    requests = [validate_request(r) for r in requests]
    if len({r["id"] for r in requests}) != len(requests):
        raise ValueError("request IDs must be unique")
    _date(date)
    mapping = _resource_map(resources)
    _bookings(bookings, mapping)
    if not isinstance(method, str) or method not in {"hill", "exact", "baseline"}:
        raise ValueError("method must be hill, exact or baseline")
    seed = _integer(seed, "seed", 0, 2**32 - 1)
    model_assumptions = _assumptions(assumptions)
    beliefs = _reports(reports, mapping, model_assumptions)
    domains = [_candidates(r, resources, mapping, bookings, date, beliefs) for r in requests]
    ranked = [sorted(d, key=lambda c: (-c["score"], c["resource_id"], c["start"])) for d in domains]
    baseline = []
    for domain in domains:
        baseline.append(next((c for c in domain if _compatible(c, baseline, mapping)), None))
    best, best_value = list(baseline), _score(baseline)
    trace = [best_value]
    diagnostics = {"candidate_counts": {r["id"]: len(d) for r, d in zip(requests, domains)},
                   "optimal": False, "search_nodes": 0, "node_limit": 200000,
                   "restarts": 0, "evaluated_moves": 0,
                   "trace_kind": "best objective so far", "data": "synthetic inventory and utility assumptions",
                   "objective": "sum(100*priority + 30*P(free) - 1.2*delay_slots - 1.5*travel_minutes - 0.1*spare_seats)",
                   "baseline": "First feasible resource ID, then start time, in input request order",
                   "csp": "Time, kind, capacity, equipment, accessibility, reservations and parent-child conflicts"}

    def retain(schedule):
        nonlocal best, best_value
        value = _score(schedule)
        if value > best_value + 1e-9:
            best, best_value = list(schedule), value
            trace.append(value)

    if method == "exact":
        if len(requests) > 5:
            raise ValueError("exact mode supports at most 5 requests; use hill for larger plans")
        order = sorted(range(len(requests)), key=lambda i: len(domains[i]))
        max_remaining = [0.0] * (len(order) + 1)
        for depth in range(len(order) - 1, -1, -1):
            i = order[depth]
            max_remaining[depth] = max_remaining[depth+1] + (ranked[i][0]["score"] if ranked[i] else 0)
        schedule = [None] * len(requests)
        stopped = False
        def visit(depth, value):
            nonlocal stopped
            if diagnostics["search_nodes"] >= diagnostics["node_limit"]:
                stopped = True
                return
            diagnostics["search_nodes"] += 1
            if value + max_remaining[depth] <= best_value + 1e-9:
                return
            if depth == len(order):
                retain(schedule)
                return
            i = order[depth]
            for c in ranked[i] + [None]:
                if stopped:
                    break
                if c is None or _compatible(c, schedule, mapping):
                    schedule[i] = c
                    visit(depth + 1, value + (c["score"] if c else 0))
                    schedule[i] = None
        visit(0, 0)
        diagnostics["optimal"] = not stopped
        diagnostics["search_limit_reached"] = stopped
    elif method == "hill":
        rng = random.Random(seed)
        n = len(requests)
        # A greedy score-based initialization and random feasible restarts help
        # escape some local maxima. They do not establish global optimality.
        for restart in range(5):
            diagnostics["restarts"] += 1
            if restart == 0:
                current = list(baseline)
            else:
                current = [None] * n
                order = list(range(n))
                if restart == 1:
                    order.sort(key=lambda i: (-requests[i]["priority"], len(domains[i])))
                else:
                    rng.shuffle(order)
                for i in order:
                    options = list(ranked[i])
                    if restart >= 2:
                        rng.shuffle(options)
                    current[i] = next((c for c in options if _compatible(c, current, mapping)), None)
            retain(current)
            for _ in range(30):
                value = _score(current)
                move, move_value = None, value
                for i in range(n):
                    others = current[:i] + current[i+1:]
                    old = current[i]["score"] if current[i] else 0
                    for c in ranked[i] + [None]:
                        diagnostics["evaluated_moves"] += 1
                        candidate_value = value - old + (c["score"] if c else 0)
                        if candidate_value > move_value + 1e-9 and (c is None or _compatible(c, others, mapping)):
                            move, move_value = ((i, c),), candidate_value
                # Pair replacement can free a specialized room for the request
                # which needs it. The shortlist bounds interactive runtime.
                for i in range(n):
                    for j in range(i + 1, n):
                        others = [c for k, c in enumerate(current) if k not in (i, j)]
                        def shortlist(index):
                            options = []
                            for candidate in ranked[index]:
                                if _compatible(candidate, others, mapping):
                                    options.append(candidate)
                                    if len(options) == 8:
                                        break
                            return options + [None]
                        opts_i, opts_j = shortlist(i), shortlist(j)
                        old = sum(current[k]["score"] if current[k] else 0 for k in (i, j))
                        for a in opts_i:
                            for b in opts_j:
                                diagnostics["evaluated_moves"] += 1
                                candidate_value = value - old + (a["score"] if a else 0) + (b["score"] if b else 0)
                                if candidate_value > move_value + 1e-9 and (a is None or b is None or _compatible(a, [b], mapping)):
                                    move, move_value = ((i, a), (j, b)), candidate_value
                if move is None:
                    break
                for i, c in move:
                    current[i] = c
                retain(current)
        diagnostics["local_search_note"] = "5 seeded starts; strict improving single moves and top-8 pair replacements; no global optimality guarantee"

    # Decision advice is evaluated after allocating the calendar. It helps the
    # user consider uncertain physical occupancy, but is not a calendar
    # constraint or another term in the scheduling objective. A user may still
    # create a local simulated reservation regardless of this optional advice.
    assignments = []
    for selected in best:
        if selected is not None:
            assignment = dict(selected)
            assignment["decision_advice"] = decision(selected["belief"], **model_assumptions)
            assignments.append(assignment)
    unassigned = [{"request_id": r["id"], "reason":
                   "No candidate meets the kind, capacity, equipment, accessibility and time constraints after existing reservations."
                   if not domains[i] else
                   "Feasible individual options exist, but this plan leaves the request unassigned because of competing requests or the bounded search."}
                  for i, r in enumerate(requests) if best[i] is None]
    return {"assignments": assignments, "unassigned": unassigned, "score": best_value,
            "baseline_score": _score(baseline), "baseline_assignments": [c for c in baseline if c is not None],
            "trace": trace, "method": method, "seed": seed, "diagnostics": diagnostics}


def decision(belief, horizon=3, sensitivity=.85, false_positive=.15, stay_free=.8,
             become_free=.35, success=10, failure=-8, inspect_cost=.7, wait_cost=.8):
    """Finite-horizon belief-state Bellman recursion, not value iteration.

    Occupancy is hidden, hence the honest classification is a small POMDP.
    Inspect changes information, wait evolves occupancy, book/leave terminate.
    Inspection is assumed faster than an occupancy transition. h counts action
    opportunities. At h=1 only terminal book and leave are available.
    """
    p = _number(belief, "belief", 0, 1)
    h = _integer(horizon, "horizon", 1, 5)
    s = _number(sensitivity, "sensitivity", 0, 1)
    f = _number(false_positive, "false_positive", 0, 1)
    sf = _number(stay_free, "stay_free", 0, 1)
    bf = _number(become_free, "become_free", 0, 1)
    win = _number(success, "success", 0, 100)
    lose = _number(failure, "failure", -100, 0)
    ic = _number(inspect_cost, "inspect_cost", 0, 100)
    wc = _number(wait_cost, "wait_cost", 0, 100)

    @lru_cache(maxsize=None)
    def values(b, remaining):
        result = {"book": b * win + (1 - b) * lose, "inspect": None, "wait": None, "leave": 0.0}
        if remaining > 1:
            report_free = b * s + (1 - b) * f
            information_value = -ic
            for report, probability in (("free", report_free), ("busy", 1 - report_free)):
                if probability > 1e-15:
                    after_report = posterior(b, report, s, f)
                    information_value += probability * value(round(after_report, 12), remaining - 1)
            result["inspect"] = information_value
            next_belief = b * sf + (1 - b) * bf
            result["wait"] = -wc + value(round(next_belief, 12), remaining - 1)
        return result

    def value(b, remaining):
        return max(v for v in values(b, remaining).values() if v is not None)

    scores = values(p, h)
    # Prefer leaving if every available alternative ties at zero. Otherwise use
    # a fixed deterministic tie order so runs and notebook outputs agree.
    action = max(("leave", "book", "inspect", "wait"), key=lambda a: scores[a] if scores[a] is not None else -math.inf)
    return {"action": action, "values": scores, "horizon": h, "belief": p,
            "explanation": f"Choose {action}: highest expected synthetic utility among allowed actions. "
            f"Book uses {p:.3f}*{win:g}+(1-{p:.3f})*{lose:g}. "
            "Inspection purchases a noisy observation without changing occupancy. Waiting changes the belief using the occupancy transition. "
            "Both consume one action opportunity; booking and leaving terminate. At horizon 1 only book/leave are allowed.",
            "model": "Finite-horizon belief-state POMDP solved by backward Bellman recursion; not value iteration",
            "states_evaluated": values.cache_info().currsize,
            "assumptions": {"sensitivity": s, "false_positive": f, "stay_free": sf, "become_free": bf,
                            "success": win, "failure": lose, "inspect_cost": ic, "wait_cost": wc}}
