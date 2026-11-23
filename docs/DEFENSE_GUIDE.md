# Defense guide

## Problem and scope

Expo Smart Scheduler addresses a possible coordination problem: requests compete for resources, equipment and time. A flexible meeting can consume the only suitable classroom for a larger class. A whole-lab reservation must prevent overlapping individual iMac bookings.

The prototype represents 23 synthetic resources across eight floors. Public [alem.ai directory](https://alem.ai/en/) themes provide context, not verified rooms or booking permissions. Capacities, features, routes, probabilities and utility weights are assumptions. No measured student benefit or real institutional reservation is claimed.

The finder recommends one resource for one exact-time session. The AI workspace allocates competing requests and exposes evidence/decision experiments. The atlas masthead, spatial canvas, floating booking dock and reasoning rail provide interface structure without changing the engine. Intent presets set kind only; the 2D floor rail sets the stated route origin, not a hard resource-floor filter. Neither control starts a search or booking. Progress observes actual search/review states. Both interfaces use the same engine. Local simulations use SQLite; hosted simulations belong to the current browser profile.

## Complete pipeline

1. Validate inputs and generate resource/time candidates.
2. Enforce capacity, features, access, time and reservation constraints.
3. Derive an availability belief from a prior, one report or a report sequence.
4. Calculate an assumed route cost with A*.
5. Compare first fit, seeded hill climbing and bounded exact CSP search.
6. Explain placements and attach optional sequential advice.
7. Reserve only after confirmation and a fresh simulation conflict check.

The finder supplies no noisy report or sequence: Bayes retains the specified prior and HMM filtering is inactive. Its six method cards state these boundaries. POMDP advice follows allocation, does not rank placements and does not execute a booking. Scheduling scores and decision utilities answer different questions.

## Six methods

| Method | Role | Boundary |
| --- | --- | --- |
| CSP/backtracking | Find compatible assignments | Exact search is bounded. |
| Hill climbing | Improve a feasible combined schedule | Global optimality is not guaranteed. |
| A* | Find the cheapest configured graph path | Routes and costs are synthetic. |
| Bayes | Update a belief from one report | Prior/reliability are assumed. |
| HMM filtering | Update hidden occupancy over time | Parameters are specified, not trained. |
| Finite-horizon belief-state planning | Compare book, inspect, wait and leave | Small POMDP, not value iteration. |

Course assessment determines whether these count as distinct topics. Algorithm count alone guarantees no marks. Storage and interface validation are ordinary software components.

## 1. Constraint satisfaction

Each request is a variable. Its domain is feasible `(resource,start)` pairs plus unassigned. Constraints include kind, capacity, features, accessibility, 08:00-20:00 hours, request windows and existing/simultaneous reservations.

Half-open intervals overlap when `start_a < end_b and start_b < end_a`. Thus 10:00-11:00 and 11:00-12:00 are compatible. A whole lab conflicts with each child iMac during overlap; different computers may overlap.

Exact backtracking selects the smallest domain, rejects incompatible choices and prunes branches whose optimistic bound cannot improve the best result. Limits are five requests and 200,000 visited nodes. Only a completed search establishes `diagnostics.optimal`; a stopped search returns no proof of optimality.

## 2. Hill climbing and first fit

First fit processes input order, choosing the first feasible resource ID and then earliest start. Hill climbing keeps strictly improving single/pair replacements. Pair moves can free specialized space. Five seeded starts improve exploration and repeatability. Single moves use full domains; pair moves use the first eight feasible high-scoring options, with at most 30 improvement rounds per start.

Retaining first fit guarantees a no-lower final score by design. It does not establish general optimality or real-world superiority.

`score = 100*priority + 30*P(free) - 1.2*delay_slots - 1.5*travel_minutes - 0.1*spare_seats`

`delay_slots = (start-earliest)/30`

Total score sums assigned candidates; unassigned requests add zero. User-selected priorities range from 1 to 3. These are assumed utilities, not money, measured satisfaction or fairness guarantees. High priority can outweigh serving more low-priority requests.

The supplied specialist-room scenario serves two requests under first fit, score 430.65, and three under hill climbing, score 744.4. This is a synthetic demonstration.

## 3. A* routing

`f(node)=g(node)+h(node)`

`h(node)=0.8*abs(node_floor-target_floor)`

Every vertical edge costs at least 0.8 assumed minutes per floor; horizontal costs are nonnegative. Ignoring horizontal travel cannot overestimate the remainder, so the heuristic is admissible for this graph.

Nodes represent lobbies, lifts and stairs. Step-free mode removes stairs. One assumed minute from lobby to resource door is added after search. Floor one to floor four costs 4.6 assumed minutes, not measured walking time.

`preferred_floor` is the assumed route origin. There is no geolocation, verified corridor plan, lift waiting-time model, closure feed or chained itinerary. Real accessibility needs a survey.

## 4. Bayesian inference

Let `b=P(free)`, `s=P(report free|free)` and `f=P(report free|busy)`.

`P(free|free report)=b*s/(b*s+(1-b)*f)`

For busy reports, substitute `1-s` and `1-f`. Unknown reports retain the prior; zero-probability evidence is rejected.

For assumed `b=.60,s=.85,f=.15`, a free report gives `.51/(.51+.06)=.8947368421`; a busy report gives `.09/(.09+.34)=.2093023256`. Keeping prior/sensitivity fixed but using hypothetical `f=.25` gives `.8360655738` for a free report. This is a sensitivity comparison, not improved measured accuracy.

A high belief never overrides a known simulation booking. Uncertainty represents possible undeclared physical occupancy of an otherwise unreserved resource.

## 5. HMM forward filtering

The hidden state is free/busy. Reports are noisy observations. Let `a=P(next free|now free)` and `c=P(next free|now busy)`:

`b_predicted=b*a+(1-b)*c`

The first report updates the initial prior. Later reports follow a transition then Bayes. One final transition produces the next-slot prediction. Defaults `a=.80,c=.35` describe hypothetical successive 30-minute steps.

| Report | Belief before report | Belief after report |
| --- | ---: | ---: |
| Free | 0.600000 | 0.894737 |
| Busy | 0.752632 | 0.349349 |

The next-slot prediction is `0.5072068404`. Parameters are specified, not trained. Hidden transitions depend only on the previous state; observations depend only on the current state. Real calibration requires legitimate occupancy data.

Workspace report sequences can affect placement scores. The forecast is shared across candidate start times, not separately calibrated for every slot or full reservation duration. Without a sequence, filtering is inactive.

## 6. Finite-horizon decisions

Occupancy is hidden, so decisions use a belief. This is a small POMDP. `V_h(b)` is best expected utility with `h` opportunities remaining.

`Q_book(b)=b*success+(1-b)*failure`

`Q_leave(b)=0`

For `h>1`:

`Q_wait(b,h)=-wait_cost+V_(h-1)(b*a+(1-b)*c)`

`Q_inspect(b,h)=-inspect_cost+sum_reports P(report|b)*V_(h-1)(Bayes(b,report))`

`V_h(b)=max(allowed Q values)`

Book/leave terminate. Wait changes occupancy belief without observing it. Inspect buys information, assuming occupancy stays fixed during the check. Both consume an opportunity. At horizon one only book/leave remain.

The solver uses backward Bellman recursion, memoization and successor beliefs rounded to 12 decimals. It is neither an infinite-horizon value-iteration convergence procedure nor trained reinforcement learning.

For belief `.60`, success `10`, failure `-8`, inspect cost `.7` and wait cost `.8`:

| Horizon | Book | Inspect | Wait | Leave | Choice |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 2.80 | Unavailable | Unavailable | 0.00 | Book |
| 2 | 2.80 | 3.92 | 2.36 | 0.00 | Inspect |

Later information changes the action under these assumptions. Advice is evaluated after allocation; its utilities do not determine placement ranking or automatically make/prevent reservations.

## Evidence and likely questions

The study checks 207 resource/report/reliability combinations and 24 tiny schedules. Hill and exact search match the independent Cartesian oracle in 24/24; hill improves first fit in 15/24. Fixtures use three resources and two to four requests, sharing domains/utilities with the oracle. These are limited search checks, not real-world calibration or general optimality.

Current tests: 95 Python run, 94 passed, one live-loopback skip for Windows socket error 10013; 53 JavaScript passed, including 18 finder controller tests and seven atlas interaction checks. Ten finder live HTTP checks passed. DOM/controller/HTTP checks are not browser rendering evidence.

Historical 100-pass Chromium evidence dated 21 November covers the workspace only. The finder's 100 planned browser checks have not run. Viewport/touch emulation establishes no physical-device, Safari/Firefox, normal-motion or full accessibility coverage.

**Why not a neural network or LLM?** Explicit constraints and a small structured search space suit inspectable algorithms. No appropriate real training dataset is available. A language model would not establish booking consistency.

**Is the result optimal?** Only completed exact search proves the best objective for its candidate set. Hill climbing has no general guarantee.

**What if a booking changes after planning?** Confirmation rechecks current storage. SQLite uses a transaction. Hosted mode checks the personal calendar and coordinates same-origin tabs where Web Locks exist; it cannot see other visitors' calendars.

**Does every finder search use all six methods?** No. It uses existing constraint/search/routing calculations for one request. Bayes retains the prior without a report, HMM is inactive without a sequence, and sequential advice follows allocation. The cards explain this.

**Are priorities fair?** They are user-selected, without approved campus policy. Real use needs authorized rules and an assessment of who the objective disadvantages.

**What does production require?** Verified inventory, approved rules, authentication, shared server storage, permissions, audit records, monitoring, backups and real-user evaluation.

**What did the student contribute?** Use only verified details in the completed contribution statement: concrete files, changes, tests and explanations. Disclose AI assistance separately; these materials do not establish unaided authorship.

## Preparation

1. Run from a clean extracted directory using the README.
2. Demonstrate exact-time search, an impossible request and a lab/iMac conflict.
3. Compare the specialist scenario with first fit and exact search.
4. Recalculate Bayes and explain two HMM observations.
5. Explain the horizon-one/horizon-two decision change.
6. Distinguish synthetic utility, actual test evidence and operational limits.
7. Complete both declarations and provide the separate playable 2-3 minute video.
