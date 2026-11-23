# Expo Smart Scheduler

**Explainable scheduling for rooms, iMacs and shared spaces.**

[Find a space](https://expo-smart-scheduler.vercel.app/find.html) · [AI workspace](https://expo-smart-scheduler.vercel.app/) · [Technical report](submission_materials/Technical_Report.pdf) · [Seven-slide presentation](submission_materials/Presentation.pdf) · [Quick start](START_HERE.md)

Expo Smart Scheduler is an AI Fundamentals project that coordinates competing
requests for campus resources. It combines constraint satisfaction, search and
probabilistic reasoning to produce a feasible schedule and explain each placement.

## The problem

Choosing the first available room can prevent another session from being
scheduled. A flexible meeting might occupy the only classroom suitable for a
larger class. Computer labs introduce another conflict: reserving the whole lab
must also block its individual iMacs.

The application plans requests together, compares its result with a first-fit
baseline and explains requests that cannot be placed.

## Two ways to use the application

| Page | Best for | What it shows |
| --- | --- | --- |
| [Find a space](https://expo-smart-scheduler.vercel.app/find.html) (`/find.html`) | One session at an exact time | A short search form, one recommended space, visible AI explanations, a review step and a reservation receipt |
| [AI workspace](https://expo-smart-scheduler.vercel.app/) (`/`) | Several competing requests and AIF experiments | The full batch scheduler, first-fit comparison, search diagnostics, floor explorer and probability lab |

Both pages call the same scheduling engine and use the same reservation storage
for the selected deployment. The simple page does not replace the batch search.
It shows the actual selected space rather than presenting the utility score as
a match percentage. See the [user-page guide](docs/FINDER_GUIDE.md).

## Main features

- Explore **23 sample resources across eight floors**, including study rooms,
  classrooms, individual iMacs, a computer lab and an auditorium.
- Plan up to **10 requests** with capacity, equipment, accessibility, duration
  and time-window requirements.
- Enforce whole-lab/iMac conflicts while allowing simultaneous reservations of
  different iMacs and back-to-back sessions.
- Compare first fit, seeded hill climbing and bounded exact search; inspect
  scores, accepted improvements, routes and placement explanations.
- Explore hypothetical availability reports, HMM forecasts and book/inspect/wait
  decisions in an interactive uncertainty lab.
- Save, cancel and export simulated reservations as an `.ics` calendar.
- Use a responsive interface with an interactive floor schematic.

**Data and scope:** experiments use a configurable synthetic resource inventory,
specified probabilities, assumed routes and utility weights. The reservation
calendar demonstrates local booking logic with simulated reservations.

## Run locally

Requires **Python 3.12+**. From the complete extracted project folder:

```bash
python server.py
```

Open **http://127.0.0.1:8765/**. Keep the terminal running and use **Ctrl+C** to stop.

The application, Python tests and evaluation use the Python standard library.
Node.js 20+ is optional for JavaScript and browser tests. On Windows,
`START_WINDOWS.bat` runs the server when Python is available.

If port 8765 is occupied:

```bash
python server.py --port 8766
```

Open the address printed by the server. Use the server URL rather than opening
`static/index.html` directly.

## Try the demonstration

For a single session, open **Find a space**, choose a resource type, date, start
time, duration and group size, then search. Review the recommended resource and
its AI explanation before confirming a simulation reservation.

To demonstrate why joint scheduling matters, open **AI workspace**:

1. Select **See AI solve a clash**.
2. Select **Generate a conflict-free plan**.
3. Compare the three scheduled requests with the two served by first fit.
4. Open **Why this placement?** to inspect the route and availability assumptions.
5. Reserve the plan in the simulation, reload, export the calendar and cancel
   the reservations.

This is a constructed specialist-request scenario. It demonstrates the effect
of planning requests jointly; it is not a measurement of real-campus efficiency.

## How the AI methods work

| Method | Purpose |
| --- | --- |
| **Constraint satisfaction** | Build feasible resource/time choices using capacity, equipment, access, time and reservation constraints. Optional exact backtracking checks small batches. |
| **Hill climbing** | Improve the combined schedule with single/pair changes and five seeded starts, retaining first fit as a fallback. |
| **A\* search** | Find routes in the sample lobby/lift/stair graph using assumed travel times; step-free routing excludes stairs. |
| **Bayesian inference** | Update a resource's assumed availability after one hypothetical free/busy report. |
| **Hidden Markov model** | Filter a sequence of noisy reports and predict the next free/busy state using specified transition probabilities. |
| **Finite-horizon belief-state planning** | Compare book, inspect, wait and leave using future beliefs and observation costs. |

The decision extension is a small POMDP solved by **backward Bellman recursion**.
It provides advice after allocation. Saving a simulated reservation is a separate
user action.

### Scheduling objective

Each placement contributes:

```text
100 * priority + 30 * P(free)
- 1.2 * delay_in_30_minute_slots
- 1.5 * assumed_travel_minutes
- 0.1 * spare_seats
```

The planner aims to maximize the sum of these assumed utility units. First fit processes
requests in their input order, then resource ID and start time. Hill climbing
preserves its score as a lower bound but does not guarantee the global optimum.

Planning uses 30-minute slots between 08:00 and 20:00. Exact mode supports up to
five requests and 200,000 search nodes; only a completed search with
`diagnostics.optimal = true` establishes an optimum for that model.

## Local and hosted modes

Both modes use the same `engine.py` and JSON inventory.

| Mode | AI computation | Reservation storage |
| --- | --- | --- |
| Local server | Python through `server.py` | SQLite on the computer running the server |
| Hosted demo | Python through `api/index.py` | Personal storage in the current browser profile |

Local mode rechecks the batch inside a database transaction. Hosted mode
rechecks the current personal simulation and coordinates participating tabs with
Web Locks where supported; otherwise, use one tab for booking.

Hosted reservations are not shared across users or devices. Clearing site data
can remove them. Neither mode creates real institutional bookings. See
[hosting details](docs/VERCEL_DEPLOYMENT.md).

## Testing and recorded results

Run the Python tests and reproduce the synthetic evaluation:

```bash
python -m unittest discover -s tests -v
python evaluation.py
```

Optional JavaScript tests require Node.js:

```bash
npm install
npm test
```

To run the verified browser suite:

```bash
npx playwright install chromium
npm run test:browser
```

| Recorded check | Result |
| --- | --- |
| Python tests | 94 passed; one live-loopback check skipped because the environment blocked the connection |
| JavaScript controller/storage tests | 53 passed, including 18 finder checks and seven atlas interaction checks |
| Recorded AI-workspace browser suite (21 November 2026) | 100 passed: 20 at each of five viewport sizes, with no failures or unexecuted checks |
| Tiny synthetic scheduling cases | Hill climbing matched independent exhaustive enumeration in 24/24 cases and improved on first fit in 15/24 |

The browser run used Chromium 151, reduced motion and viewport/touch emulation
at 360×800, 390×844, 768×1024, 1440×1000 and 1920×1080. It checked scheduling,
floor selection, iMac filtering, reservation persistence, calendar export,
cancellation, invalid inputs and horizontal fit.

The recorded 100-check run covers the existing AI workspace. The new
`/find.html` page has controller and asset tests; a real browser run of its
separate suite is still required:

```bash
npm run test:browser:finder
```

On Windows, `RUN_FINDER_CHECK_WINDOWS.bat` installs the optional browser tools
and runs that suite against the hosted page. See [finder QA](docs/FINDER_QA.md)
for scope and current evidence.

Physical devices, Safari/Firefox, ordinary-motion interaction and a full
accessibility audit were not tested. The separate
`npm run test:browser:diagnostic` adds diagnostic output and extra 3D Enter/Space
assertions that were not part of the recorded run.

The exact executed browser driver is `tests/browser_e2e_verified.cjs`.
See [browser evidence](docs/BROWSER_QA.md),
[the raw verified report](results/browser_e2e_verified_run.json) and
[synthetic evaluation results](results/evaluation_summary.json).
Matching an oracle on tiny cases does not prove optimality on every input or
real-world performance.

## Project files

| File or folder | Contents |
| --- | --- |
| `engine.py` | AI methods, scoring and validation |
| `server.py`, `api/index.py` | Local SQLite service and stateless hosted adapter |
| `static/` | Interface, floor schematic and browser reservation transport |
| `data/` | Sample resources, floor themes and demonstration scenarios |
| `Expo_Smart_Scheduler.ipynb` | Worked examples using the same engine as the app |
| `tests/`, `evaluation.py`, `results/` | Tests, reproducible experiments and preserved evidence |
| `docs/` | Method explanations, presentation, defense guide and demo storyboard |
| `submission_materials/` | Report, presentation, declaration forms and submission checklist |

The local server creates `data/bookings.sqlite3`; it is excluded from the source
package. Edit `data/resources.json` before starting the server, then restart.
Use a fresh simulation database after incompatible inventory changes:

```bash
python server.py --db data/demo_bookings.sqlite3
```

The notebook contains eight executed code cells with captured Python output;
a Jupyter kernel was not tested. The supplied report and slides can be read
without installing document-generation dependencies.

## Limitations and further work

- Resource locations, access rules and travel times need institutional verification.
- Availability probabilities and utilities are assumptions, not calibrated measurements.
- The HMM next-slot forecast is shared across candidate start times.
- Routes begin at each request's stated floor; they are not a chained personal itinerary.
- A shared operational service would need authentication, permissions and a
  persistent central database.

For course deliverables and the remaining submission items, read
[SUBMISSION_FIRST.md](SUBMISSION_FIRST.md). The contribution and AI-use forms
are provided for the student to complete with verified details.

Floor themes are based on the [official alem.ai directory](https://alem.ai/en/);
that source does not establish room capacities or booking permissions.
