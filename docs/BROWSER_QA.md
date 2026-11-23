# Browser verification

The final recorded browser run **passed 100 checks, with 0 failures and 0 not run**:
20 checks at each of five viewports. The run used Chromium 151.0.7922.34 on the
project owner's computer on 21 November 2026, from 16:41:11Z to 16:41:51Z.

The preserved evidence is `results/browser_e2e_verified_run.json`. The exact
executed source is supplied as `tests/browser_e2e_verified.cjs` (SHA-256
`19b6afa5259f0a2b13d34e4a8202228324fb4221433e3a44b167c78afe6edcbc`).
These are actual API and browser observations; no API responses were mocked.

| Emulated viewport | Checks passed | Initial document/body width |
| --- | --- | --- |
| 360 × 800 | 20 / 20 | 360 px |
| 390 × 844 | 20 / 20 | 390 px |
| 768 × 1024 | 20 / 20 | 768 px |
| 1440 × 1000 | 20 / 20 | 1440 px |
| 1920 × 1080 | 20 / 20 | 1920 px |

All contexts used reduced motion. The first three emulated mobile/touch behavior.
These results establish browser emulation, not testing on physical phones.

## What passed

- The 23-resource inventory across eight floors and the fresh personal storage.
- Keyboard access through the skip link into the workspace.
- Initial, generated-plan and 100-character-title horizontal fit.
- A real click selecting floor four, six-iMac filtering, separated floors, and
  timeline scrolling contained inside its own panel.
- The specialist scenario: three placements versus two for first fit; a visible
  route explanation; changed-input invalidation followed by regeneration.
- Three browser-only reservations, persistence after reload, a downloaded ICS
  calendar containing three simulation events, and cancellation of all three.
- Horizon-one Inspect/Wait shown as N/A, an HMM sequence and its application.
- An impossible request, invalid-time feedback, and no uncaught page errors.

## Reproduce the verified suite

From the extracted project folder, use Node.js/npm and run:

```powershell
npm.cmd install
npx.cmd playwright install chromium
npm.cmd run test:browser:verified
```

The target is https://expo-smart-scheduler.vercel.app/. Each viewport uses a
fresh browser context. The runner checks for browser-owned simulation storage
before creating reservations; it does not create shared/server bookings. It
rejects Campus as a target and never changes a submission.

A subsequent run writes its own `results/browser_e2e/report.json`, screenshots
and downloaded calendars. That runtime directory is excluded from the clean
archive; the frozen verified report above remains separate.

## Extended diagnostic runner

`npm.cmd run test:browser:diagnostic` runs `tests/browser_e2e.cjs`, revision
`2026-11-21-responsive-3`. This variant adds progress messages, date-readiness
checks, detailed pointer/overflow traces, interim reports and extra Enter/Space
assertions on the 3D floor buttons within the same 20 named scenarios.

**That extended revision has passed syntax checking only; it was not the
driver of the recorded 100-pass run.** Do not claim its additional Enter/Space
assertions have passed.

`npm.cmd run test:browser` is an alias for the verified suite above.
On Windows, `RUN_BROWSER_CHECK_WINDOWS.bat` performs the optional dependency
setup and starts that verified suite. To choose the extended diagnostic runner,
run `RUN_BROWSER_CHECK_WINDOWS.bat diagnostic`. The file leaves the window open
to show errors. It does not change Windows security settings.

Exit code 0 means the invoked suite passed, 1 means a failure, and 2 means the
browser/module could not start. Inspect the report's timestamp, runner revision
and status before interpreting a file left from a previous run.

## Scope and remaining limits

The following were not established by the recorded run:

- Physical iOS/Android devices, Safari, Firefox or other browser versions.
- A full accessibility audit, or Enter/Space activation of the 3D floor buttons.
- The ordinary-motion/parallax state; reduced motion was used throughout.
- Load, long-term persistence, real multi-user booking or real-campus performance.
- A rendered local-SQLite browser flow; the hosted personal-browser mode was used.

Earlier failed reports are preserved separately in `results/`. The narrow
transformed stack frame was reduced to 300 px and centred; coplanar floor
buttons now use flat hit testing and stable paint order while retaining the
parent's 3D projection. The subsequent verified run passed the affected cases.

The authoring host's earlier Chromium access-denied error is historical.
The later owner-run test successfully launched Chromium and produced the evidence.
