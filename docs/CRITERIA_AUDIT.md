# Assessment criteria and deliverables audit

The Campus checklist inspected on 19 November 2026 requires a working project integrating at least three algorithms from different AIF topics. The maxima below are published weights, not awarded marks, predicted deductions or a guaranteed grade.

Sources: [Campus Final Project](https://campus.qairu.edu.kz/ru/assignments/a856684c-8ec3-410b-afc2-3f9c9ab1b3dd), [AIF course](https://campus.qairu.edu.kz/ru/courses/489d4a95-c8ff-4ddc-83af-692bef5e902d), [alem.ai directory](https://alem.ai/en/).

| Scope item | Evidence and boundary |
| --- | --- |
| Assignment attachment alignment | Not verified: `Final Project` and `MiniAI_FPTopics` were unavailable for reading. Compare their requirements with the Campus checklist before claiming full alignment. |
| Topic mapping | Course material lists MDP/reinforcement learning, probability/Bayesian networks and HMM. Mapping A*, CSP and local search to distinct assessable topics still requires the topic document. |
| Inventory | Eight floor themes provide context. All 23 resource identifiers, capacities, equipment, routes, probabilities and booking permissions are synthetic configuration. |
| Storage | Local mode uses SQLite; hosted mode uses personal browser storage. Neither creates institutional reservations. |

## Criterion mapping

| Published criterion | Maximum | Evidence | Evaluation boundary |
| --- | ---: | --- | --- |
| Correct implementation of three AI topics | 30 | CSP/backtracking, seeded hill climbing, A*, Bayes, HMM filtering and finite-horizon belief-state planning; examples and tests | Related methods are not automatically distinct course topics. Individual understanding requires assessment. |
| Functionality and stability | 20 | Exact-time finder, batch planning, validation, hierarchy-aware conflicts, confirmation, cancellation and export | Hosted calendars are personal simulations. Production authorization and real policies are outside scope. |
| Testing and results | 15 | Baseline/oracle comparisons, probability sensitivity and invalid-input tests | Synthetic results establish neither calibrated occupancy nor real benefit or general optimality. |
| UI/UX | 10 | Finder/controller/HTTP evidence and historical workspace browser run | Finder browser execution, physical devices, other engines and full accessibility remain untested. |
| Code quality, GitHub and documentation | 10 | Runnable source, notebook, setup, tests, report and method notes | Verify public repository contents against `MANIFEST.sha256` and run the documented setup. |
| Originality and practical value | 5 | Joint room/iMac allocation, whole-lab conflicts and alternative placements | The coordination problem is plausible; frequency and benefits have not been measured with users. |
| Defense and individual understanding | 10 | Equations, worked examples, guide and storyboard | Generated materials establish neither contribution nor understanding. |

The finder sends one exact-time request to the existing engine. Without a report, Bayes retains the prior; without a sequence, HMM filtering is inactive. POMDP advice follows allocation and neither ranks placements nor executes a reservation. The workspace provides multi-request and evidence experiments.

## Executed evidence

| Evidence | Result | Boundary |
| --- | --- | --- |
| Current Python suite | 95 run, 94 passed, 1 skipped, 0 failures/errors | Live-loopback check skipped for Windows socket error 10013; memory-stream handler and finder asset checks ran. |
| Current JavaScript suite | 53 passed | Includes 18 finder controller checks and seven atlas interaction checks using a small test DOM and fixtures, not rendering. |
| Published finder HTTP checks | 10 passed | Assets including the atlas interaction script, state API and invalid-date response; not interactive browser coverage. |
| Historical workspace browser suite, 21 November 2026 | 100 passed | Existing workspace only: 20 at each of five 360-1920px viewports, Chromium 151 with reduced motion. |
| Finder browser suite | 100 planned checks; not run | Runner syntax-checked; desktop/mobile interaction coverage pending. |

Evidence: `results/finder_qa.json`, `results/finder_http_checks.json`, `results/validation_summary.json`, test logs and `results/browser_e2e_verified_run.json`. Historical viewport/touch emulation does not establish physical-device, Safari/Firefox, normal-motion, screen-reader or full accessibility coverage. Extra Enter/Space assertions in the diagnostic workspace runner were outside that verified run.

## Synthetic evaluation

| Evaluation | Result |
| --- | ---: |
| Resource/report/reliability combinations | 207 |
| Tiny scheduling cases | 24 |
| Hill strictly improves first fit | 15/24 |
| Hill and exact search each match the independent Cartesian oracle | 24/24 |
| Mean score gain | 71.0667 assumed utility units |
| Recommendation sensitivity cases | 36 |
| Sequential-decision combinations | 225 |
| HMM sequences | 360 |

The benchmark uses three synthetic resources and two to four requests. Its oracle shares candidate domains and utility definitions. Matching it checks those fixtures, not inventory, calibration, weights or larger schedules. Retaining first fit makes the no-worse property partly true by construction.

## Required deliverables

| Campus requirement | Status |
| --- | --- |
| Working application and live/local demo | [Finder](https://expo-smart-scheduler.vercel.app/find.html), [workspace](https://expo-smart-scheduler.vercel.app/) and local source supplied. Finder browser coverage pending. |
| GitHub repository | [Public source repository](https://github.com/LordGibrat/exposcheduler); source-package integrity is tracked in `MANIFEST.sha256`. Verify contents and setup. |
| Technical report | Markdown and PDF supplied in `submission_materials/`. |
| 5-7 slide presentation | Seven-slide `Presentation.pdf` supplied. |
| 2-3 minute demo video | Pending: playable demo video is not included in this source package; provide and verify it separately. A storyboard is supplied. |
| AI Usage Declaration | Separate form intentionally blank; student completion required. |
| Team Contribution Statement | Individual-project form for Gibrat Sagadat. Specific work, group and confirmation fields require verification and completion. |

Campus explicitly lists both declarations. No individual-project exemption has been verified.

## Defense and final priorities

| Part | Published duration |
| --- | --- |
| Problem and objectives | 2 minutes |
| Live demonstration | 3-5 minutes |
| Three implemented AI topics | 2 minutes |
| Questions and answers | Up to 3 minutes |

Each student answers individually. The recorded 2-3 minute video is separate.

1. Compare the assignment attachments and confirm distinct-topic mapping.
2. Verify public repository contents, source-package integrity and clean-install instructions.
3. Execute the finder browser suite independently of historical workspace evidence.
4. Complete both declarations accurately.
5. Provide, review and time the actual demonstration video.
6. Rehearse equations, failed requests, storage limits and synthetic results.
