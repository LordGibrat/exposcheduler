"""Reproduce synthetic comparisons. No measured campus data or ML training."""
import csv
import itertools
import json
import random
import time
from pathlib import Path
import engine

ROOT = Path(__file__).resolve().parent
DAY = "2026-12-01"


def req(rid, **changes):
    r = dict(id=rid, title="Synthetic study request", kind="study_room", group_size=4,
             features=[], preferred_floor=1, earliest=540, latest=660, duration=60,
             priority=1, accessible=False)
    r.update(changes)
    return r


def conflict(a, b, resources):
    parents = {r["id"]: r.get("parent_id") for r in resources}
    def ancestors(node):
        seen = set()
        while node:
            seen.add(node)
            node = parents.get(node)
        return seen
    return (a["resource_id"] in ancestors(b["resource_id"])
            or b["resource_id"] in ancestors(a["resource_id"])) and a["start"] < b["end"] and b["start"] < a["end"]


def independent_oracle(domains, resources):
    best, count = 0., 0
    for combination in itertools.product(*[[None] + d for d in domains]):
        count += 1
        selected = [a for a in combination if a is not None]
        if all(not conflict(a, b, resources) for a, b in itertools.combinations(selected, 2)):
            best = max(best, sum(a["score"] for a in selected))
    return best, count


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def evaluate():
    output = ROOT / "results"
    output.mkdir(exist_ok=True)
    inventory = engine.load_resources()
    probabilities = []
    for resource, report, (s, fp) in itertools.product(inventory, ["free", "busy", "unknown"], [(.7,.3),(.85,.15),(.95,.05)]):
        isolated = dict(resource, parent_id=None)
        choices = engine.candidates(req("probe", kind=resource["kind"], group_size=1, preferred_floor=resource["floor"], latest=600),
                                    [isolated], [], DAY, {resource["id"]: report}, dict(sensitivity=s, false_positive=fp))
        assert len(choices) == 1
        p, actual = resource["prior"], choices[0]["belief"]
        lf, lb = (s, fp) if report == "free" else (1-s, 1-fp)
        expected = p if report == "unknown" else p*lf/(p*lf+(1-p)*lb)
        assert abs(actual-expected) < 1e-12
        probabilities.append(dict(resource=resource["id"], report=report, sensitivity=s, false_positive=fp, prior=p, posterior=actual))
    write_csv(output / "room_report_sensitivity.csv", probabilities)

    rooms = [dict(id="R-A",name="Projector studio",floor=1,kind="study_room",capacity=8,features=["projector","quiet","wheelchair"],parent_id=None,prior=.7),
             dict(id="R-B",name="Small studio",floor=2,kind="study_room",capacity=4,features=["quiet","wheelchair"],parent_id=None,prior=.8),
             dict(id="R-C",name="Team studio",floor=4,kind="study_room",capacity=6,features=["whiteboard","wheelchair"],parent_id=None,prior=.65)]
    trials = []
    for seed in range(24):
        rng = random.Random(seed)
        requests = [req(f"Q{i+1}", group_size=rng.choice([2,4,6,9]), priority=rng.randint(1,3),
                        features=rng.choice([[],["quiet"],["projector"],["whiteboard"]]), preferred_floor=rng.choice([1,2,4]),
                        earliest=rng.choice([540,570]), latest=rng.choice([630,660]), accessible=rng.choice([False,True])) for i in range(2+seed%3)]
        domains = [engine.candidates(r,rooms,[],DAY) for r in requests]
        oracle, enumerated = independent_oracle(domains,rooms)
        before = time.perf_counter()
        hill = engine.plan(requests,rooms,[],DAY,seed=seed)
        elapsed = (time.perf_counter()-before)*1000
        exact = engine.plan(requests,rooms,[],DAY,seed=seed,method="exact")
        assert all(not conflict(a,b,rooms) for a,b in itertools.combinations(hill["assignments"],2))
        assert hill["baseline_score"]-1e-8 <= hill["score"] <= oracle+1e-8
        assert abs(exact["score"]-oracle)<1e-8 and exact["diagnostics"]["optimal"]
        trials.append(dict(seed=seed, requests=len(requests), served=len(hill["assignments"]), baseline_served=len(hill["baseline_assignments"]),
                           baseline_score=hill["baseline_score"], hill_score=hill["score"], oracle_score=oracle,
                           gap=oracle-hill["score"], enumerated=enumerated, hill_ms=round(elapsed,3)))
    write_csv(output / "scheduler_benchmark.csv", trials)
    trap = engine.plan([req("flexible",latest=600),req("projector",features=["projector"],priority=3,latest=600)],rooms[:2],[],DAY)
    assert len(trap["assignments"]) == 2 and len(trap["baseline_assignments"]) == 1
    (output / "competition_example.json").write_text(json.dumps(trap,indent=2),encoding="utf-8")

    ranking = []
    for s, fp, a, b in itertools.product([.7,.85,.95],[.05,.15,.3],["free","busy"],["free","busy"]):
        result = engine.plan([req("Q",latest=600)],rooms[:2],[],DAY,{"R-A":a,"R-B":b},dict(sensitivity=s,false_positive=fp))
        ranking.append(dict(sensitivity=s,false_positive=fp,report_a=a,report_b=b,recommendation=result["assignments"][0]["resource_id"],score=result["score"]))
    write_csv(output / "recommendation_sensitivity.csv",ranking)
    policy = []
    for b,h,s,fp in itertools.product([.1,.3,.5,.7,.9],[1,2,3,4,5],[.7,.85,.95],[.05,.15,.3]):
        answer = engine.decision(b,h,s,fp)
        allowed = {k:v for k,v in answer["values"].items() if v is not None}
        assert abs(allowed[answer["action"]]-max(allowed.values()))<1e-12
        policy.append(dict(belief=b,horizon=h,sensitivity=s,false_positive=fp,action=answer["action"],**answer["values"]))
    write_csv(output / "decision_sensitivity.csv",policy)
    hmm = []
    for prior,length in itertools.product([.2,.5,.8],[1,2,3,4]):
        for reports in itertools.product(["free","busy","unknown"],repeat=length):
            answer = engine.hmm_filter(prior,list(reports))
            assert 0 <= answer["predictive_next"] <= 1
            hmm.append(dict(prior=prior,reports=",".join(reports),posterior=answer["posterior"],predictive_next=answer["predictive_next"]))
    write_csv(output / "hmm_sequences.csv",hmm)
    summary = dict(data="All inventory, probabilities and utilities are synthetic; no real-world performance estimate.",
                   inventory_resources=len(inventory), floors=sorted({r["floor"] for r in inventory}), room_report_checks=len(probabilities),
                   scheduling_trials=len(trials), hill_no_worse_than_baseline=sum(t["hill_score"]>=t["baseline_score"]-1e-8 for t in trials),
                   hill_strictly_improved=sum(t["hill_score"]>t["baseline_score"]+1e-8 for t in trials),
                   hill_matches_oracle=sum(t["gap"]<1e-8 for t in trials), mean_objective_gain=sum(t["hill_score"]-t["baseline_score"] for t in trials)/len(trials),
                   max_oracle_gap=max(t["gap"] for t in trials), constraint_violations=0, exact_matches_independent_oracle=len(trials),
                   recommendation_sensitivity_cases=len(ranking), decision_sensitivity_cases=len(policy), hmm_sequences=len(hmm),
                   timing_note="CSV times are one local run per small instance, not a scalability benchmark.")
    (output / "evaluation_summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    print(json.dumps(summary,indent=2))
    return summary


if __name__ == "__main__":
    evaluate()
