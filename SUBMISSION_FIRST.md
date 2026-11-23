# QAIRU AI Fundamentals Submission Guide

User page: https://expo-smart-scheduler.vercel.app/find.html

AI workspace: https://expo-smart-scheduler.vercel.app/

Public repository: https://github.com/LordGibrat/exposcheduler

Compare the public source repository with the package's `MANIFEST.sha256` and
verify the README setup before assessment.

Expo Smart Scheduler coordinates requests for rooms, computers and shared spaces.
Its evaluation uses synthetic resource data, specified availability probabilities,
assumed routes and utility weights. Reservations use a local simulation calendar.

## Which files to use

| Required item | File in this package |
| --- | --- |
| Complete source and setup instructions | Keep the whole project folder; read `README.md` and `START_HERE.md` |
| Python notebook | `Expo_Smart_Scheduler.ipynb`; keep `engine.py` and `data/` beside it |
| Technical report | `submission_materials/Technical_Report.pdf` |
| Seven-slide presentation | `submission_materials/Presentation.pdf`; browser version: `docs/slides.html` |
| AI Usage Declaration | `submission_materials/AI_Usage_Declaration.docx`, intentionally blank for you to complete |
| Contribution Statement | `submission_materials/Team_Contribution_Statement.docx`, identifying an individual project; verify your specific personal work |
| Defense preparation | `docs/DEFENSE_GUIDE.md` |
| Demo-video script, 2:45 | `docs/DEMO_SCRIPT.md`; playable video is not included in this source package; provide and verify it separately |
| Browser verification and scope | `docs/BROWSER_QA.md` and `results/browser_e2e_verified_run.json` |
| New finder validation and pending browser suite | `docs/FINDER_QA.md` and `results/finder_qa.json` |
| Criterion-by-criterion audit | `docs/CRITERIA_AUDIT.md` and `submission_materials/SUBMISSION_CHECKLIST.md` |

The report and declarations also have editable Markdown versions in
`submission_materials/`.

## What remains before submission

1. Complete the AI declaration and individual contribution statement with
   accurate details of your work and the assistance used.
2. Provide and review a real 2–3 minute demonstration video. The supplied script
   is a storyboard and does not satisfy the recorded-video requirement.
3. Verify the public source at https://github.com/LordGibrat/exposcheduler,
   compare package integrity with `MANIFEST.sha256` and run the README setup.
   The Vercel URL provides the separate live demonstration.
4. Read the final verification results and their limits below. Run the new
   finder browser suite before claiming desktop/mobile verification for it.
5. Compare the previously unavailable `Final Project` and `MiniAI_FPTopics`
   attachments with the Campus checklist. That document comparison remains open.
6. Review all final files and links before submission.

## Run the project locally

Extract the complete archive. Open a terminal in the project folder and run:

```text
python server.py
```

Open http://127.0.0.1:8765/ and leave the terminal running. Python 3.12 or newer
is required. The core application uses the Python standard library and needs
no API key or third-party Python package installation. On Windows you can also
use `START_WINDOWS.bat` when the `python` command is available.

Both demonstration modes use the same Python AI engine. The local server stores
simulated reservations in SQLite on the computer running the server. The hosted
demo stores them only in the current browser profile. Visitors do not share a
public reservation calendar.

## Verified results

- **Python:** 95 tests run; 94 passed and one live-loopback test was skipped
  because the authoring environment blocked the socket connection.
- **JavaScript:** all 53 controller and storage unit tests passed, including
  18 finder checks and seven atlas interaction checks. These use
  simulated DOM/storage fixtures and are separate from browser verification.
- **Notebook:** all eight code cells were executed in order using ordinary
  Python with captured output. A Jupyter kernel was not tested.
- **Recorded AI-workspace browser run:** 100 checks passed, with no failures or checks left unrun:
  20 at each of 360×800, 390×844, 768×1024, 1440×1000 and 1920×1080.

The browser run checked floor selection, six-iMac filtering, the scheduling
comparison, explanations, local simulation reservations, persistence after
reload, calendar export, cancellation, uncertainty calculations, invalid inputs,
impossible requests and horizontal fit, including a long session title.

The exact executed driver is `tests/browser_e2e_verified.cjs`. Its preserved
report is `results/browser_e2e_verified_run.json`. To reproduce the verified
suite after installing the optional browser-test dependencies, run:

```text
npm run test:browser
```

The explicit alias `npm run test:browser:verified` uses the same driver. On
Windows, `RUN_BROWSER_CHECK_WINDOWS.bat` can install Playwright and Chromium and
start the verified suite. A new invocation writes its report to
`results/browser_e2e/report.json`, with screenshots beside it. Node.js/npm and
an internet connection are needed for this optional workflow.

The verified run used Chromium 151 with reduced motion and viewport/touch
emulation. Physical phones, Safari/Firefox, ordinary-motion interactions and a
full accessibility audit were not tested. The extended diagnostic runner,
`npm run test:browser:diagnostic`, includes additional Enter/Space assertions
on the 3D floor buttons; those extra assertions have not been executed.

The new **Find a space** page uses the same engine and storage, with a simpler
single-session form, visible AIF explanations and a review/receipt flow.
Its controller tests and ten live asset/API checks passed, including the atlas
interaction asset. Its separate 100-check
desktop/mobile suite has not yet run in a real browser. Use
`RUN_FINDER_CHECK_WINDOWS.bat` or `npm run test:browser:finder`; the report will
be written to `results/finder_e2e/report.json`.

The results concern a synthetic prototype. They do not establish real-campus
booking permissions, measured real-world performance or a guaranteed grade.
