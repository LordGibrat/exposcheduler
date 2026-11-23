# Demo-video script and storyboard

Target length: 2 minutes 45 seconds. This is a recording plan, not a recorded video. Use a fresh local demo database or cancel only your disposable test reservations before recording. Never show Campus credentials or unrelated personal data.

Locations, capacities, priors, report sequences and walking costs use the sample configuration. No real reservation is created. Start at https://expo-smart-scheduler.vercel.app/find.html, then open the AI workspace at the same site's root. Hosted reservations are personal browser simulations; local mode uses SQLite. The historical AI-workspace browser suite passed 100 checks. The atlas finder has 100 planned browser checks that have not run; see `docs/FINDER_QA.md` for its separate coverage.

| Time | Screen and action | Spoken text |
| --- | --- | --- |
| 0:00-0:20 | On the atlas page, choose the iMac intent preset, then search at 10:00 for one hour. Presets do not search or book automatically; the floor rail sets the route origin only. Show the resource, time and visible AI explanation. | "Expo Smart Scheduler helps find a room, an iMac or an auditorium. This page gives one clear recommendation for an exact time. It explains which AI methods apply. Searching does not reserve anything; I review the details before confirming a simulation reservation." |
| 0:20-0:40 | Open AI workspace. Browse floor four, an individual iMac and the whole computer lab. | "The full workspace coordinates competing requests across eight represented floors. Each iMac can be reserved separately, but a whole-lab reservation conflicts with its computers. The auditorium is on floor four in this example. Capacities and booking permissions still need verification." |
| 0:40-1:05 | Select Flexible vs specialist requests, load the example and run the planner. Show size, equipment and time windows. | "These groups have different requirements and time windows. The planner removes options that violate capacity, equipment, operating hours and booking constraints. Hill climbing then searches for a better combined allocation. Here, moving a flexible meeting frees a suitable classroom for another group." |
| 1:05–1:25 | Show the final plan, first-fit baseline, score trace and one route explanation. | “The comparison uses a simple first-fit baseline. Hill climbing improves a feasible schedule through small changes and seeded restarts. The displayed score is an assumed utility, not a measured improvement in student experience. A star finds a route in our example building graph.” |
| 1:25–1:50 | Change a hypothetical availability report, then show the occupancy-sequence panel. Replan if needed. | “A report can be wrong. Bayes combines an assumed prior with report reliability. For a sequence, a two-state hidden Markov model also represents changes between free and busy. It produces a next-step availability belief. These are hypothetical observations, not live sensor data.” |
| 1:50–2:10 | Show the sequential decision panel and compare a short horizon with a longer horizon. | “The decision model compares booking, checking, waiting and leaving. Checking may reveal useful information. Waiting changes the availability belief. This is finite-horizon planning in belief space. It is not value iteration or a learned reinforcement-learning policy.” |
| 2:10–2:30 | Save the generated plan, then show cancellation and an alternative plan in the mode being recorded. | “This hosted demo saves a personal simulation in my browser and rechecks its current reservations before saving. Other users have separate calendars. The optional local server uses SQLite transactions. Neither mode reserves a real Expo space.” |
| 2:30–2:45 | Show the evaluation files or test summary and finish on the dashboard. | “Tests compare methods on reproducible synthetic cases and check invalid inputs and boundaries. The main limits are assumed probabilities, example routes and unverified inventory. Real deployment would need authorization, a verified campus database and evaluation with users.” |

## Recording checklist

- Record the actual running application. Do not substitute animation for a working feature.
- Use a legible 1080p capture if available, with a steady pace and cursor movement.
- Verify button and panel names against the final interface before recording.
- Show one result and one limitation clearly. Do not read every algorithm equation during this short video.
- If the exact-search comparison is shown, use a small case and show whether search completed. Do not call a capped result a proven optimum.
- Use only test bookings. If a second browser session creates a conflict, explain that both sessions share this local server's simulated database.
- Mention only test counts and performance values actually present in the final test/evaluation record.
- Check the final duration, audio and readable labels. Save the video separately only after recording it.
