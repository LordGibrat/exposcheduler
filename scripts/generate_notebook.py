"""Build and execute the teaching notebook with ordinary Python.

The generated file uses the standard nbformat 4 structure. Cells are run in one
Python namespace with stdout captured; this is not a Jupyter-kernel test.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
cells = []
namespace = {}
count = 0


def md(text):
    cells.append(dict(cell_type="markdown",metadata={},source=text.splitlines(True)))


def code(text):
    global count
    count += 1
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        exec(compile(text, f"notebook cell {count}", "exec"), namespace)
    output = buffer.getvalue()
    cells.append(dict(cell_type="code",metadata={},source=text.splitlines(True),execution_count=count,
                      outputs=[dict(output_type="stream",name="stdout",text=output.splitlines(True))] if output else []))


md("""# Expo Smart Scheduler
## Explainable allocation of rooms, iMacs and shared spaces

AI Fundamentals project prototype. All resource capacities, identifiers,
availability reports, travel times and utility weights are synthetic assumptions.
The official alem.ai directory supplies floor themes, not booking permissions.
The fourth-floor auditorium is included as a scenario resource. Reservations
are local simulations; no real university booking occurs.

Open this notebook from the extracted project directory. The notebook imports
the same `engine.py` as the web application so the two implementations agree.
""")
code("""import json
import math
from pathlib import Path
import engine

resources = engine.load_resources()
scenarios = json.loads(Path('data/scenarios.json').read_text(encoding='utf-8'))
day = '2026-12-01'
print('Synthetic resources:', len(resources))
print('Represented floors:', sorted({r['floor'] for r in resources}))
print('No real reservations or campus data are loaded.')
""")
md("""## 1. Constraint satisfaction

Each request is a variable. Its domain contains feasible (resource, start) pairs
and an unassigned option. Hard constraints cover capacity, kind, features,
accessibility, time windows, existing reservations and whole-lab/iMac conflicts.
Intervals are half-open: one session may start exactly when another finishes.
""")
code("""example = next(s for s in scenarios if s['id'] == 'specialist_room')
requests = example['requests']
for request in requests:
    options = engine.candidates(request, resources, [], day)
    print(request['title'], '->', len(options), 'feasible choices')
print('Adjacent time intervals overlap:', engine.overlap(540, 600, 600, 660))
print('Lab vs its iMac:', engine.resources_conflict('F4-LAB','F4-IM01', resources))
print('Two individual iMacs:', engine.resources_conflict('F4-IM01','F4-IM02', resources))
""")
md("""## 2. Hill climbing versus first fit and exact CSP

First fit processes requests in input order and chooses resource IDs before
start times. Hill climbing keeps strict improvements from single and pair moves,
with five seeded starts. Pair shortlists and iteration caps make this heuristic
bounded. Retaining the baseline guarantees a score no lower than that baseline,
but does not guarantee global optimality.

For a selected candidate, the assumed score is:

`100*priority + 30*P(free) - 1.2*delay_slots - 1.5*travel_minutes - 0.1*spare_seats`

Exact backtracking is limited to five requests and 200,000 nodes. Read its
`optimal` flag before calling the result an optimum.
""")
code("""hill = engine.plan(requests, resources, [], day, seed=42)
exact = engine.plan(requests, resources, [], day, method='exact')
print('First-fit served:', len(hill['baseline_assignments']), 'score:', round(hill['baseline_score'], 3))
print('Hill served:', len(hill['assignments']), 'score:', round(hill['score'], 3))
print('Exact score:', round(exact['score'], 3), 'proof complete:', exact['diagnostics']['optimal'])
print('Best-so-far trace:', [round(x,3) for x in hill['trace']])
for a in hill['assignments']:
    print(a['request_id'], a['resource_id'], a['start'], a['end'])
assert hill['score'] >= hill['baseline_score']
assert hill['score'] <= exact['score'] + 1e-8
""")
md("""## 3. A* graph search

Nodes represent example lobbies, lifts and stairs. Edges use assumed minutes.
A* uses `f=g+h`, with `h=0.8*abs(current_floor-target_floor)`. Every vertical
edge costs at least 0.8 per floor, so the heuristic does not overestimate.
Step-free mode removes stairs. One assumed minute to the resource door is added.
The request's starting/preferred floor is the route origin; routes are not a
chained itinerary for one person.
""")
code("""normal_route = engine.route(1, 8)
step_free = engine.route(1, 8, accessible=True)
print('Normal route:', normal_route)
print('Step-free route:', step_free)
assert not any('stairs' in node for node in step_free['path'])
""")
md("""## 4. Bayesian inference

Let F mean free and R mean a report of free.

`P(F|R)=P(R|F)*P(F)/(P(R|F)*P(F)+P(R|not F)*(1-P(F)))`

Sensitivity and false-positive probability are assumptions, not measured accuracy.
The following comparison holds sensitivity at 0.85 and changes the hypothetical
false-positive probability from 0.25 to 0.15. The default example uses 0.15.
A higher posterior under that assumption is not evidence of a better sensor.
""")
code("""for report in ['free','busy','unknown']:
    print(report, round(engine.posterior(.6, report), 6))
print('Hypothetical false-positive probability 0.25:', round(engine.posterior(.6,'free',.85,.25),6))
print('Hypothetical false-positive probability 0.15:', round(engine.posterior(.6,'free',.85,.15),6))
assert math.isclose(engine.posterior(.6,'free',.85,.25), .51/.61)
""")
md("""## 5. Hidden Markov model

The hidden state is free/busy. A noisy report is the observation. Between
observations the forecast is `p_next=p*0.8+(1-p)*0.35`. Bayes then incorporates
the next report. The first report uses the initial prior without a transition.
These are invented successive 30-minute observations; the parameters are specified,
not trained. Passing a sequence in `reports` makes its next-slot belief affect
the actual schedule score. This simple forecast is shared across candidate times,
so it is not a separate calendar-slot occupancy forecast.
""")
code("""sequence = ['free','busy','free']
forecast = engine.hmm_filter(.6, sequence)
print(json.dumps(forecast, indent=2))
busy_day = next(s for s in scenarios if s['id']=='expo_busy_day')
result = engine.plan(busy_day['requests'], resources, [], day, reports=busy_day['reports'])
print('Busy-day plan served:', len(result['assignments']))
""")
md("""## 6. Meaningful sequential decisions

The decision model is a small POMDP: occupancy is hidden and the state available
to the decision maker is a belief about whether the resource is free.

`V_h(b)=max(Q_book,Q_leave,Q_inspect,Q_wait)`

`Q_book=b*10+(1-b)*(-8)` and `Q_leave=0`.
Inspection pays a cost, gives a noisy observation and uses `V_(h-1)` for each
possible posterior. Waiting pays a cost and uses `V_(h-1)` at the transitioned
belief. Both consume one opportunity. At h=1 only book/leave are available.
The solver uses backward Bellman recursion, not value iteration or learned RL.
Per-assignment advice is advisory after allocation; it does not automatically
authorize a real booking or change the calendar objective.
""")
code("""for horizon in [1,2,3]:
    answer = engine.decision(.6,horizon=horizon)
    print('Horizon',horizon,'action:',answer['action'],'values:',answer['values'])
print('Perfect free inspection at belief .5:',
      engine.decision(.5,horizon=2,sensitivity=1,false_positive=0,inspect_cost=0,wait_cost=100)['values']['inspect'])
""")
md("""## Reproducibility, evaluation and limits

Run `python evaluation.py` to recreate the CSV/JSON results, and
`python -m unittest discover -s tests -v` to run tests. The evaluation uses an
independent Cartesian enumerator on 24 tiny scheduling tasks, reports sensitivity
to assumptions, and checks 207 resource/report/reliability combinations.
Matching an oracle on tiny synthetic tasks does not prove optimality on all inputs.
The technical report explains the implementation, results and limitations.
""")
code("""summary = json.loads(Path('results/evaluation_summary.json').read_text(encoding='utf-8'))
print(json.dumps(summary,indent=2))
repeat = engine.plan(requests,resources,[],day,seed=42)
assert repeat['assignments'] == hill['assignments']
print('Repeated seeded plan is identical.')
""")
md("""## Project declarations

The AI-use declaration is intentionally blank in
`submission_materials/AI_Usage_Declaration.md` for the project owner to complete.
`submission_materials/Team_Contribution_Statement.md` identifies this as an
individual project; the owner must verify the specific personal-work details.
""")
for i,cell in enumerate(cells):
    cell['id'] = f"expo-{i:02d}"
notebook = dict(cells=cells,metadata=dict(kernelspec=dict(display_name="Python 3",language="python",name="python3"),
                 language_info=dict(name="python",version="3.12"),
                 execution_note="All code cells executed in order with Python exec and captured stdout; not Jupyter-kernel verification."),nbformat=4,nbformat_minor=5)
path = ROOT / 'Expo_Smart_Scheduler.ipynb'
path.write_text(json.dumps(notebook,indent=1),encoding='utf-8')
print(f'Created and executed {count} code cells: {path.name}')
