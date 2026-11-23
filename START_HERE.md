# Expo Smart Scheduler: Quick Start

Open **[Find a space](https://expo-smart-scheduler.vercel.app/find.html)** for
one session, or **[AI workspace](https://expo-smart-scheduler.vercel.app/)** for
batch scheduling and probability experiments.

Public source repository: **https://github.com/LordGibrat/exposcheduler**.
Compare source-package integrity with `MANIFEST.sha256` and follow the README setup.

This is a personal browser simulation. Another browser profile or device uses
a separate simulation. No real Expo room or computer is reserved.

For the submission file list and remaining deliverables, read
`SUBMISSION_FIRST.md`.

## Run locally

1. Extract the whole archive and keep its folder structure.
2. Use Python 3.12 or newer and open a terminal in the project folder.
3. Run `python server.py`.
4. Open http://127.0.0.1:8765/ and keep the terminal running.

On Windows, `START_WINDOWS.bat` runs the same command when Python is available.
If the port is busy, use `python server.py --port 8766` and open the printed
address. Stop the server with Ctrl+C. Opening `static/index.html` directly does
not start the Python API. No third-party libraries are needed for the core app.

Local mode stores simulation reservations in SQLite. Hosted mode uses the same
AI engine and stores personal reservations in the current browser only.

## Demonstrate the project

On **Find a space**, use the atlas presets to choose a resource kind, then choose your time and group size. Presets do not search or reserve automatically. The 2D floor rail changes the assumed starting floor, not a resource-floor filter. Search,
read the single recommended space and its AIF explanation, review, then confirm
a simulation reservation. The six AIF methods are also explained on the page.
The full batch search remains in **AI workspace**.

Select **See AI solve a clash**, then **Generate a conflict-free plan**. In this
constructed scenario, first fit serves two of three requests and hill climbing
serves all three. Compare the placements, open an explanation and inspect the
route. These are results on synthetic inputs, not measured campus benefits.

Select floor four to explore individual iMacs, their parent lab and the example
auditorium. Whole-lab and individual-iMac reservations cannot overlap. The
availability lab lets you change hypothetical reports and assumptions, inspect
an HMM forecast and compare book, inspect, wait and leave decisions.

Save the plan in the simulation, reload to check persistence, export a calendar,
then cancel the demonstration reservations. The interface labels these actions
as simulations.

## Files to read

- `README.md`: setup, methods, test commands, file structure and limitations.
- `Expo_Smart_Scheduler.ipynb`: worked examples using the actual Python engine.
- `submission_materials/Technical_Report.pdf`: technical report; editable
  Markdown is supplied beside it.
- `submission_materials/Presentation.pdf`: seven slides; `docs/slides.html`
  is the browser version.
- `docs/DEFENSE_GUIDE.md`: simple explanations, equations and likely questions.
- `docs/DEMO_SCRIPT.md`: a 2:45 recording storyboard; playable video is not included in this source package.
- `submission_materials/`: separate declarations, contribution form and checklist.
- `results/`: actual synthetic-evaluation outputs and preserved test records.

The AI Usage Declaration is blank for you to complete. The contribution form
identifies an individual project by Gibrat Sagadat; specific personal-work
details remain for you to verify. Check the public repository contents against
`MANIFEST.sha256` and verify setup. Playable demo video is not included in this source package; provide and verify it separately.

## Checks and actual results

```text
python -m unittest discover -s tests -v
python evaluation.py
npm test
```

The current Python run executed 95 tests: 94 passed and one live-loopback test
was skipped because of Windows socket error 10013. All 53 Node tests passed,
including 18 finder checks and seven atlas interaction checks.
Ten live finder asset/API checks passed, including the atlas interaction asset.
The Node unit tests and HTTP checks do not establish real browser rendering.

The recorded AI-workspace browser run passed **100 checks, with zero failures and zero
checks left unrun**: 20 at each of 360×800, 390×844, 768×1024, 1440×1000 and
1920×1080. The preserved report is `results/browser_e2e_verified_run.json`;
the exact executed driver is `tests/browser_e2e_verified.cjs`.

After installing the optional Playwright dependency and matching Chromium,
`npm run test:browser` reproduces that verified suite. The alias
`npm run test:browser:verified` does the same. See `docs/BROWSER_QA.md` for setup,
scope, evidence hashes and the separate diagnostic command.

The run used Chromium 151 with reduced motion and mobile/touch emulation.
Physical phones, Safari/Firefox, ordinary-motion interaction and a full
accessibility audit were not tested. The additional 3D Enter/Space assertions
in the diagnostic runner were not part of this successful run.

The new finder has not yet had a real-browser run. Use
`RUN_FINDER_CHECK_WINDOWS.bat` or `npm run test:browser:finder` for its separate
100-check suite. Read `docs/FINDER_QA.md` for current coverage. The earlier
100-pass report does not cover this new page.

Resource placements, equipment, capacities, probabilities, utilities, routes
and booking rules are synthetic. The official directory supports floor themes,
not a verified list of rooms available for student booking. The original
assignment attachments still need comparison with the Campus checklist.
