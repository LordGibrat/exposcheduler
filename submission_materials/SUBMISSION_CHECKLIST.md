# QAIRU AIF Final Project submission checklist

This follows the [Campus checklist](https://campus.qairu.edu.kz/ru/assignments/a856684c-8ec3-410b-afc2-3f9c9ab1b3dd) inspected on 19 November 2026. Alignment with `Final Project` and `MiniAI_FPTopics` remains unverified because their contents were unavailable for reading.

## Required deliverables

| Requirement | Material or link | Status |
| --- | --- | --- |
| Working application and live/local demo | [Finder](https://expo-smart-scheduler.vercel.app/find.html), [workspace](https://expo-smart-scheduler.vercel.app/) and runnable source | Supplied; finder interactive browser validation pending. |
| GitHub repository | [LordGibrat/exposcheduler](https://github.com/LordGibrat/exposcheduler) | Public source repository; source-package integrity tracked in `MANIFEST.sha256`. Verify contents and setup. |
| Technical report | `Technical_Report.md` and `.pdf` | Supplied; confirm agreement with final implementation. |
| 5-7 slide presentation | `Presentation.pdf` | Seven-slide deck supplied. |
| 2-3 minute demo video | Actual playable file or public video link | Playable demo video is not included in this source package; provide and verify it separately. Script/storyboard does not satisfy this requirement. |
| AI Usage Declaration | `AI_Usage_Declaration.docx` or `.md` | Intentionally blank; student completion required. |
| Team Contribution Statement | `Team_Contribution_Statement.docx` or `.md` | Individual project: Gibrat Sagadat. Specific work, group and confirmation fields require verification and completion. |

Campus explicitly requires both declarations. No individual-project exemption has been verified.

## Validation status

| Evidence | Result | Limitation |
| --- | --- | --- |
| Python | 95 run, 94 passed, one skip, no failures/errors | Live-loopback check skipped for Windows socket error 10013. |
| JavaScript | 53 passed, including 18 finder controller checks and seven atlas interaction checks | Small test DOM/fixtures, not rendering evidence. |
| Finder live HTTP checks | Ten passed | Assets/API, not interactive viewport coverage. |
| Historical workspace browser run, 21 November 2026 | 100 passed across five viewports | Workspace only; reduced-motion viewport/touch emulation. |
| Finder browser suite | 100 planned checks; not run | Desktop/mobile interactions remain pending. |

Evidence: `results/finder_qa.json`, `results/finder_http_checks.json`, test logs and `results/browser_e2e_verified_run.json`. Physical devices, Safari/Firefox, normal-motion and full accessibility are not established.

## Final checks

1. Read both assignment attachments, reconcile requirements and verify distinct-topic mapping.
2. Verify public repository contents, `MANIFEST.sha256`, setup and access without a private owner session.
3. Run from the README; confirm notebook filename and included data.
4. Execute `npm run test:browser:finder`; review its report/screenshots before claiming finder browser coverage.
5. Confirm source/notebook/report/slide agreement. Preserve synthetic inventory, assumed probability/utility and simulation-storage disclosures.
6. Complete both declarations with verified personal-work and AI-assistance details.
7. Provide, watch and time the actual 2-3 minute demo video; add its working link or file.
8. Review final files and public links before submission. Assessment remains the examiner's decision.
