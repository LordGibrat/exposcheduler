# Hosted demonstration and local server

- [Find a space](https://expo-smart-scheduler.vercel.app/find.html): one resource for one exact-time session.
- [AI workspace](https://expo-smart-scheduler.vercel.app/): competing requests and detailed AI experiments.

Deployment readiness, asset/API checks and interactive browser validation are separate forms of evidence.

## Runtime and storage

Both interfaces use the same Python `engine.py` and synthetic inventory. Reservations are simulations.

| Property | Local server | Hosted demonstration |
| --- | --- | --- |
| Start | `python server.py` | Public URLs above |
| AI computation | Python engine in local process | Same engine in a Vercel Function |
| Persistence | SQLite database on server computer | Browser storage for current profile and origin |
| Conflict recheck | Current database, atomic transaction | Current personal calendar; same-origin tabs coordinate through Web Locks where supported |
| Other devices/profiles | Loopback is local to server computer | Separate personal simulations |
| Shared campus calendar | Not provided | Not provided |

The hosted API performs stateless computation. Function-local temporary files are not a durable shared cross-instance database. Reference: [Vercel filesystem documentation](https://vercel.com/docs/functions/runtimes#file-system-support). A real shared service requires persistent server storage, authentication, permissions, atomic transactions and approved institutional policies.

## Source and build

`api/index.py` adapts the engine for hosting. `static/browser-storage.js` manages personal simulations. `server.py` provides local SQLite mode. Prepare deployment source with:

```bash
python scripts/build_vercel.py
```

The script prints its output directory and the copied engine's SHA-256. The source set contains the frontend, adapter, canonical engine, imported helpers, JSON data and runtime configuration. Importing helpers does not start the local server. Regenerate the set after editing canonical source; maintain a single AI implementation.

Recorded finder source checks preserve hashes for `engine.py`, `static/app.js`, `static/style.css` and `static/browser-storage.js`. Workspace HTML adds finder navigation and revised footer text. The finder adds atlas styling and `static/experience.js`: a full-width masthead, spatial canvas, floating booking dock, intent presets and a 2D floor rail. Kind presets do not search or book; the floor rail sets the assumed route origin without filtering resources to that floor. Progress follows actual search/review states. The engine, finder controller, storage and existing workspace controller/styles remain unchanged. No new ranking or probability method is introduced.

The deployable set excludes notebook, report, slides, local database, tests and caches. These accompany the complete project package. [Public source repository](https://github.com/LordGibrat/exposcheduler): compare source-package integrity with `MANIFEST.sha256` and verify README setup. Hosting and repository delivery are separate requirements.

## Personal simulation behavior

Hosted responses identify `storage_mode: browser`. A `plan_id` is a correlation identifier, not authorization or a server-held reservation. The browser retains a plan for up to 15 minutes and rechecks personal reservations before writing it. Local mode uses a 30-minute plan cache and SQLite transaction.

- Both pages share reservations after refreshing state when origin, profile and storage mode agree.
- Other profiles/devices/origins have separate simulations. No shared public calendar exposes visitors' reservations.
- Clearing site data, private browsing or blocked storage can remove or prevent persistence.
- Web Locks coordinate participating same-origin tabs where available. The fallback serializes one adapter instance only; it is not a cross-user transaction guarantee.
- Browser data is user-controlled, not institutional authorization or an audit record.
- Hosted computation sends supplied request data to the function. Fictional titles suffice; student identifiers and attendance records are unnecessary.
- ICS exports are labelled simulations and create no real resource reservation.

## Verification

| Check | Result and boundary |
| --- | --- |
| Python | 95 run, 94 passed, one live-loopback skip for Windows socket error 10013; no failures/errors. |
| JavaScript | 53 passed, including 18 finder controller checks and seven atlas interaction checks; test DOM/fixtures, not browser rendering. |
| Published finder HTTP checks | Ten passed: assets including the atlas interaction script, state API and invalid-date response. |
| Historical workspace browser run, 21 November 2026 | 100 passed across five viewports; existing workspace only. |
| Finder browser suite | 100 planned checks, syntax-checked but not executed. |

See `docs/FINDER_QA.md` and `results/finder_qa.json`. After installing documented dependencies, run `npm run test:browser:finder`. The historical workspace suite is archived in `tests/browser_e2e_verified.cjs` and `results/browser_e2e_verified_run.json`; `npm run test:browser:verified` targets it.

Historical Chromium evidence uses reduced-motion viewport/touch emulation. It establishes neither physical-device, Safari/Firefox, normal-motion nor full accessibility coverage. Extra Enter/Space floor-control assertions in the diagnostic runner were outside that verified run. Hosting does not turn synthetic evaluation into real-campus performance evidence.
