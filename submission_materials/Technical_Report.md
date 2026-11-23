# Expo Smart Scheduler

Technical report

## 1. Problem, objective and scope

Shared study resources create competing requirements: a session may need computers, a projector, enough seats, step-free access or a specific time. Independent first-come allocation can give a flexible meeting the only classroom suitable for another group. A whole-lab reservation must also prevent conflicting reservations of its individual iMacs.

Expo Smart Scheduler coordinates these constraints, compares alternative placements and explains its recommendations. It combines constrained search, local optimization, routing, uncertain occupancy inference and sequential decision advice. The configured prototype contains 23 illustrative resources across eight Expo/alem.ai floors, including rooms, six individual iMacs, their parent computer lab and a fourth-floor auditorium.

In 24 tiny synthetic scheduling cases, hill climbing matched an independent enumeration oracle in every case and improved first fit in 15. The mean gain was 71.0667 assumed utility units. This demonstrates behavior on defined fixtures, not measured campus benefit or general optimality.

The public alem.ai directory provides floor-level context only. Resource identities, capacities, equipment, access flags, routes, opening hours and booking permissions are synthetic configuration. Neither interface makes institutional reservations or uses real occupancy data.

## 2. Application and architecture

The application offers two views of one Python engine. The finder at `/find.html` recommends one resource for one session at an exact start time. It separates search, review and confirmation; editing inputs invalidates the recommendation. The AI workspace at `/` supports competing requests, alternative schedules and interactive evidence/decision experiments. The finder uses a full-width masthead, spatial atlas canvas, floating booking dock and a separate result reasoning rail. Intent presets set the resource kind without starting a search or reservation. The 2D floor rail sets the stated route origin, not a hard resource-floor filter. Progress follows actual search/review state. This interface layer leaves engine, finder controller and storage behavior unchanged.

A request specifies kind, group size, features, starting/preferred floor, time window, duration, priority and accessibility. A batch contains one to ten requests for one date. Times follow a 30-minute grid within assumed hours of 08:00-20:00. Validation rejects malformed dates, unsupported features, nonfinite probabilities, invalid numeric types and impossible windows. Confirmation rechecks conflicts; planning itself creates no reservation.

Local mode uses `server.py`, a loopback HTTP API and SQLite. Issued plans expire after 30 minutes. Confirmation checks the current database inside `BEGIN IMMEDIATE` and commits the batch atomically. Hosted mode uses `api/index.py` for stateless computation and personal browser storage for reservations. Its plan identifier is a correlation ID; the browser retains the plan for 15 minutes and rechecks its personal calendar before saving. Web Locks coordinate participating same-origin tabs where available; the fallback serializes one adapter instance only. Profiles and devices have separate simulations, so hosting provides no shared cross-user calendar.

The finder sends no noisy report or sequence. Its Bayes component therefore retains the configured prior, while HMM filtering is inactive. Its six method cards disclose these boundaries. Sequential advice is computed after allocation and does not influence placement ranking. The workspace exposes experiments requiring observations or multiple requests. Both pages share a simulation only when origin, profile and storage mode agree. Cancellation and simulation-labelled ICS export use that storage mode.

## 3. Constrained scheduling and optimization

### Feasibility and exact search

Each request is a CSP variable. Its domain contains feasible `(resource,start)` pairs plus unassigned. Unary constraints cover kind, capacity, features, accessibility, opening hours, request windows and known reservations. Pairwise constraints reject overlapping assignments to conflicting resources.

Intervals are half-open:

```text
overlap = start_a < end_b and start_b < end_a
```

Thus adjacent sessions are compatible. A whole-lab reservation conflicts with each child iMac during overlap; different computers may overlap. Exact search uses backtracking, smallest-domain-first ordering and an optimistic remaining-score bound. It supports five requests and 200,000 visited nodes. Only a completed search sets `diagnostics.optimal`; a capped result is not a proven optimum.

### Baseline and hill climbing

First fit processes requests in input order, selecting the first feasible resource ID and then start time. Hill climbing accepts strictly improving single replacements and pair replacements. Five starts include the baseline, a priority/domain-based initialization and seeded random feasible starts. Each permits 30 improvement rounds. Single moves examine full domains; pair moves use the top eight compatible options per request, potentially missing improvements outside that shortlist.

For each allocated candidate:

```text
U = 100*priority + 30*b - 1.2*delay_slots
    - 1.5*travel_minutes - 0.1*spare_seats
delay_slots = (start-earliest_start)/30
```

The objective sums candidate utilities; unassigned requests add zero. Priority ranges from 1 to 3 and `b` is the assumed availability belief. Coefficients are chosen utilities, not learned values or measured satisfaction. High priorities can outweigh serving additional lower-priority requests, so the objective establishes neither fairness nor maximum attendance.

Retaining the baseline guarantees a no-lower objective by construction. Restarts can escape some local maxima but provide no general global-optimality guarantee.

## 4. Routing with A*

The graph contains floor lobbies, lifts and stairs with assumed travel costs. Step-free mode removes stairs and resource filtering requires the sample wheelchair feature. A* uses accumulated cost `g` and an admissible heuristic:

```text
f(n) = g(n)+h(n)
h(n) = 0.8*abs(floor(n)-target_floor)
```

Every vertical edge costs at least 0.8 assumed minutes per floor; horizontal costs are nonnegative. Ignoring horizontal travel cannot overestimate remaining cost. The implementation permits node reopening and adds one assumed minute from target lobby to resource door after search.

The starting/preferred floor is a stated origin, not geolocation. The graph omits actual corridors, lift queues, closures and travel between consecutive activities. Floor one to floor four costs 4.6 assumed minutes, not a measured walking time. Step-free output is a model property, not a physical accessibility guarantee.

## 5. Occupancy inference

### One-report Bayesian update

Let `b=P(free)`, `s=P(report free|free)` and `f=P(report free|busy)`. For a free report:

```text
P(free|free report) = b*s/(b*s+(1-b)*f)
```

A busy report substitutes `1-s` and `1-f`. Unknown reports preserve the prior; zero-probability evidence is rejected. Defaults are `s=.85,f=.15`. With prior `.60`, free and busy reports produce `.8947368421` and `.2093023256`. Using hypothetical `f=.25` instead produces `.8360655738` after a free report. This comparison changes an assumption, not measured sensor accuracy.

Known simulation reservations remain hard constraints. Availability beliefs concern possible undeclared physical occupancy of otherwise unreserved resources; they cannot override a booking.

### HMM forward filtering

A specified two-state HMM represents free/busy occupancy across hypothetical successive 30-minute observations. Let `a=P(next free|free)` and `c=P(next free|busy)`:

```text
b_predicted = b*a+(1-b)*c
```

The first report updates the initial prior directly. Later reports follow a transition and Bayesian measurement update. Unknown observations omit the measurement update. One final transition produces the next-slot forecast. Defaults are `a=.80,c=.35`. Prior `.60` and reports `free,busy` give posterior `.3493485342` and next-slot probability `.5072068404`.

Parameters are specified, not trained. The first-order Markov assumption makes next occupancy depend only on the previous hidden state; reports depend only on the current state. Transition parameters are stationary. A workspace sequence changes candidate scores through its next-slot belief, but that belief is shared across candidate times. It does not forecast each future slot or whole reservation duration, and lab/computer occupancy correlations are not modelled probabilistically.

## 6. Sequential belief-state decisions

Hidden occupancy makes the decision component a finite-horizon POMDP represented in belief space. Let `V_h(b)` be best expected utility with `h` opportunities remaining. At horizon one, only terminal book and leave actions are available:

```text
Q_book(b) = b*success+(1-b)*failure
Q_leave(b) = 0
```

For `h>1`:

```text
Q_wait(b,h) = -wait_cost+V_(h-1)(b*a+(1-b)*c)
Q_inspect(b,h) = -inspect_cost
  + sum_report P(report|b)*V_(h-1)(Bayes(b,report))
V_h(b) = max of allowed action values
```

Waiting changes occupancy belief without observing it. Inspection purchases a noisy observation and assumes occupancy stays fixed during the check. Both consume an opportunity; booking and leaving terminate. Defaults are success `10`, failure `-8`, inspection cost `.7`, waiting cost `.8` and horizon `3`, bounded to 1-5. Observation and transition defaults match the occupancy model. Successor beliefs are rounded to 12 decimals for memoization.

At belief `.60`, horizon one chooses book with value `2.80`. At horizon two, book is `2.80`, inspect `3.92`, wait `2.36` and leave `0`, so inspection is preferred. Future information can change the action under the stated assumptions. The solver uses backward Bellman recursion, not value iteration or trained reinforcement learning. Advice follows calendar optimization and neither changes its objective nor automatically makes or prevents reservations.

## 7. Evaluation and verification

### Synthetic study

The resource/report study isolates each resource at one feasible time and compares its posterior with direct Bayes calculations. Twenty-three resources, three reports and three reliability settings produce 207 combinations. The scheduling study creates 24 seeded cases with three purpose-built rooms and two to four requests, varying capacity, features, floor, priority, access and windows, including infeasible demands.

An independent Cartesian oracle enumerates every candidate/unassigned combination and checks conflicts separately. It shares candidate domains and utility definitions with the solver: independence concerns allocation enumeration, not domain correctness or the objective. Hill and exact search are compared with this oracle, with checks for feasibility and `baseline <= hill <= oracle`.

| Measure | Recorded result |
| --- | ---: |
| Resource/report/reliability combinations | 207 |
| Tiny scheduling cases | 24 |
| Hill strictly improves first fit | 15/24 |
| Hill matches the oracle | 24/24 |
| Exact search matches the oracle | 24/24 |
| Detected scheduling conflicts | 0 |
| Mean first-fit / hill score | 336.8500 / 407.9167 |
| Mean gain in assumed utility | 71.0667 |
| Recommendation / decision / HMM cases | 36 / 225 / 360 |

Recommendation grids vary observations/reliability. Decision grids check that the chosen action maximizes allowed values; HMM grids check probability bounds. Separate unit tests compare HMM filtering with hidden-state enumeration. These checks establish bounded consistency, not predictive generalization. No training split is claimed because parameters are not learned. Matching 24 tiny oracles does not prove large-instance optimality; recorded fixture timings are not a scalability benchmark.

### Software and browser evidence

The current Python suite ran 95 tests: 94 passed, one live-loopback check skipped for Windows socket error 10013, and no failures/errors. JavaScript tests passed 53 checks, including 18 finder controller checks and seven atlas interaction checks using a small test DOM and fixtures. Ten live finder HTTP checks passed for published assets, state API and invalid-date handling. Memory-stream handlers, component tests and HTTP asset checks do not establish interactive browser rendering.

The historical Chromium 151 run on 21 November 2026 passed 100 workspace checks across five viewports from 360x800 to 1920x1080. It covered planning, simulated booking, reload persistence, export, cancellation and model controls. This is workspace evidence only. The finder's separate 100-check browser suite is syntax-checked but has not run. Historical reduced-motion viewport/touch emulation establishes no physical-device, Safari/Firefox, normal-motion or full accessibility coverage.

## 8. Reproduction and limitations

Python 3.12+ and the standard library run the application, mathematical evaluation and Python tests. Node runs JavaScript component tests; Playwright dependencies are needed separately for browser suites. From the extracted project root:

```bash
python server.py
python evaluation.py
python -m unittest discover -s tests -v
npm test
python scripts/generate_notebook.py
```

`engine.py` contains all AI methods; `server.py` and `api/index.py` provide local/hosted adapters. `data/` holds canonical resources and scenarios. `static/` contains both interfaces and browser storage. `evaluation.py`, `tests/` and `results/` provide reproducible evidence. `Expo_Smart_Scheduler.ipynb` imports the same engine. Its eight cells were executed sequentially with ordinary Python and captured output; this was not Jupyter-kernel verification.

Results are traceable to `evaluation_summary.json`, evaluation CSVs, `finder_qa.json`, `finder_http_checks.json`, test logs and `browser_e2e_verified_run.json`. Reproduction in another environment may expose transport or browser differences.

Operational use would require surveyed inventory/accessibility, approved priorities, authenticated roles, shared server storage, audit records, monitoring, backups and real-user evaluation. Self-selected priorities can be misused; chosen weights may disadvantage some requests. The prototype omits recurring events, real timetables, correlated occupancy and whole-duration forecasts. Use fictional titles: hosted requests are transmitted for computation, while exported calendars use floating local times. These limits distinguish a reproducible educational system from a validated campus booking service.

References: [alem.ai directory](https://alem.ai/en/), [QAIRU Final Project](https://campus.qairu.edu.kz/ru/assignments/a856684c-8ec3-410b-afc2-3f9c9ab1b3dd), [AIF course](https://campus.qairu.edu.kz/ru/courses/489d4a95-c8ff-4ddc-83af-692bef5e902d).
