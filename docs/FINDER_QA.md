# Find a space: validation

## Executed checks

- **18 finder controller tests passed**, using the actual page IDs, a small
  test DOM and fixture API responses. These are unit/integration checks, not
  browser rendering evidence.
- **53 JavaScript tests passed** in total, including the existing workspace
  and browser reservation transport tests: 28 legacy checks, 18 finder checks and seven atlas interaction checks.
- **95 Python tests ran: 94 passed and one live-loopback check was skipped** because the
  execution environment blocked socket connections. The actual HTTP handler
  is also exercised over memory streams. The added finder asset test checks
  page/style/script responses, content types and the static-path whitelist.
- **Ten live HTTP checks passed** after publication: the new and existing
  public assets, including `static/experience.js`, matched the reviewed source, the state API returned the 23
  resources in browser mode, and an invalid date returned HTTP 400.

The finder checks cover payload translation, date/time boundaries, invalid
inputs, the one-person iMac rule, escaped text, accurate AIF method labels,
review/confirmation, stale asynchronous results, duplicate-save guards,
conflict/expiry responses, cancellation, storage recovery and date isolation.

The existing engine, workspace controller, workspace stylesheet and browser
reservation transport are preserved. The workspace has an additional navigation
link to the finder. The seven atlas interaction checks cover intent presets, the 2D starting-floor rail and progress observation. Presets set kind without searching or booking. The rail sets the stated route origin and does not restrict resource floors. Progress follows actual search/review state. Engine, `static/find.js`, browser storage and existing workspace styles are unchanged. No new ranking or probability method was introduced.

## Browser suite

`tests/finder_e2e.cjs` is a separate Playwright suite for the new interface.
It plans 100 checks across five viewport sizes and uses fresh browser profiles with simulation
reservations. It checks search, visible AIF explanations, review, confirmation,
persistence, the shared workspace calendar, export, cancellation, invalid
inputs and horizontal fit.

**Status: not executed in a real browser for this new page.** The runner has
been syntax-checked. The preserved 100-pass browser report from 21 November
2026 concerns the existing AI workspace and must not be presented as finder
browser coverage.

A 23 November 2026 invocation stopped before browser launch because the matching Chromium executable was absent (0 checks passed, 0 failed, 100 not run); raw diagnostics are recorded in `results/finder_qa.json` under `last_attempt`.

Run from the complete project folder:

```bash
npm install
npx playwright install chromium
npm run test:browser:finder
```

Or double-click `RUN_FINDER_CHECK_WINDOWS.bat` on Windows. The result is written
to `results/finder_e2e/report.json`. The runner requires personal browser
simulation mode and stops before any reservation if it detects server-owned
storage. Its default target is the hosted deployment.

Before claiming desktop/mobile coverage for the finder, review the completed
report and screenshots. Viewport and touch emulation do not establish testing
on physical devices or in Safari/Firefox. A full accessibility audit is also
outside the current evidence.
