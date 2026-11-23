/*
 * Real-browser integration and responsive checks. There are no mocked API replies.
 *
 * Setup on a machine that permits Chromium:
 *   npm install
 *   npx playwright install chromium
 *   npm run test:browser
 *
 * Optional environment variables:
 *   BASE_URL              defaults to the public production demo
 *   PLAYWRIGHT_MODULE     package name or absolute module path, defaults to playwright
 *   CHROMIUM_EXECUTABLE   explicit compatible Chromium executable, otherwise bundled
 *   BROWSER_QA_OUTPUT     output directory, defaults to results/browser_e2e
 *   PLANNING_DATE         synthetic planning date, defaults to 2026-12-01
 *
 * Each viewport uses a fresh browser context. The runner verifies browser-owned
 * simulation mode before it creates reservations. No shared/server bookings are
 * written. Actual screenshots, downloads and a JSON report are created only when
 * this runner is executed. Syntax checking this file runs no browser or requests.
 * Exit codes: 0 passed, 1 failed, 2 blocked (module/browser unavailable).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASE = new URL(process.env.BASE_URL || "https://expo-smart-scheduler.vercel.app/");
const OUTPUT = path.resolve(process.env.BROWSER_QA_OUTPUT || path.join(ROOT, "results/browser_e2e"));
const DAY = process.env.PLANNING_DATE || "2026-12-01";
const TIMEOUT = 60_000;
const VIEWPORTS = [
  {width:360,height:800}, {width:390,height:844}, {width:768,height:1024},
  {width:1440,height:1000}, {width:1920,height:1080},
];
const CHECKS = [
  "inventory-and-browser-storage", "keyboard-skip-link", "initial-horizontal-fit",
  "floor-four-and-six-imacs", "timeline-contained-overflow", "specialist-plan-versus-baseline",
  "placement-route-explanation", "planned-horizontal-fit", "changed-seed-invalidates-plan",
  "three-browser-reservations", "reservations-survive-reload", "downloaded-ics-calendar",
  "cancel-all-simulation-reservations", "one-step-unavailable-actions", "hmm-three-report-forecast",
  "apply-hmm-sequence-to-resource", "impossible-request-stays-unassigned", "invalid-time-ui-error",
  "long-title-horizontal-fit", "no-uncaught-page-errors",
];

function safeError(error) {
  return String(error?.message || error).replace(/([?&]_vercel_share=)[^&\s]+/g, "$1[redacted]").slice(0, 1500);
}

async function waitText(page, selector, text) {
  await page.waitForFunction(({selector,text}) => document.querySelector(selector)?.textContent.trim() === text,
    {selector,text}, {timeout:TIMEOUT});
}

async function waitCount(page, selector, count) {
  await page.waitForFunction(({selector,count}) => document.querySelectorAll(selector).length === count,
    {selector,count}, {timeout:TIMEOUT});
}

function apiResponse(page, endpoint, predicate = () => true) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === endpoint && response.request().method() === "POST" && predicate(response.request());
  }, {timeout:TIMEOUT});
}

async function readResponse(response) {
  const result = await response.json();
  assert(response.ok(), `API returned ${response.status()}: ${String(result.error || "request failed")}`);
  return result;
}

async function waitInventory(page) {
  await waitText(page, "#stat-resources", "23");
  await waitCount(page, "#building-stack .floor-layer", 8);
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
}

async function setPlanningDate(page) {
  const input = page.locator("#planning-date");
  if (await input.inputValue() === DAY) return;
  const response = page.waitForResponse(r => {
    const url = new URL(r.url());
    return url.pathname === "/api/state" && url.searchParams.get("date") === DAY;
  }, {timeout:TIMEOUT});
  await input.fill(DAY);
  await input.press("Tab");
  const state = await readResponse(await response);
  assert.equal(state.date, DAY);
  await waitInventory(page);
}

async function pageFits(page) {
  const result = await page.evaluate(() => ({
    viewport_width:document.documentElement.clientWidth,
    document_width:document.documentElement.scrollWidth,
    body_width:document.body.scrollWidth,
  }));
  assert(result.document_width <= result.viewport_width + 1,
    `Document overflows horizontally: ${JSON.stringify(result)}`);
  assert(result.body_width <= result.viewport_width + 1,
    `Body overflows horizontally: ${JSON.stringify(result)}`);
  return result;
}

async function loadExample(page, label, count) {
  await page.locator("#example-select").selectOption({label});
  await page.locator("#load-example").click();
  await waitCount(page, "#request-queue .request-item", count);
}

async function generatePlan(page) {
  const response = apiResponse(page, "/api/plan");
  await page.locator("#generate-plan").click();
  const result = await readResponse(await response);
  await page.locator("#plan-results").waitFor({state:"visible"});
  await waitCount(page, "#plan-results .plan-row", result.assignments.length);
  await page.waitForFunction(() => !document.querySelector("#generate-plan").disabled, null, {timeout:TIMEOUT});
  return result;
}

async function storedBookingCount(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("expo-smart-scheduler-v1");
    return raw ? JSON.parse(raw).bookings.length : 0;
  });
}

async function screenshot(page, record, label) {
  const filename = `${record.id}-${label}.png`;
  await page.screenshot({path:path.join(OUTPUT,filename),fullPage:false});
  record.screenshots.push(filename);
}

async function runViewport(browser, viewport) {
  const record = {id:`${viewport.width}x${viewport.height}`,viewport,
    emulation:{reduced_motion:"reduce",touch:viewport.width <= 768,mobile:viewport.width <= 768},
    status:"running",checks:CHECKS.map(name => ({name,status:"not_run"})),screenshots:[],page_errors:[],api_requests:[]};
  const context = await browser.newContext({viewport,acceptDownloads:true,reducedMotion:"reduce",colorScheme:"light",
    locale:"en-GB",isMobile:viewport.width <= 768,hasTouch:viewport.width <= 768,deviceScaleFactor:1});
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.on("pageerror", error => record.page_errors.push(safeError(error)));
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin === BASE.origin && url.pathname.startsWith("/api/"))
      record.api_requests.push({method:request.method(),path:url.pathname});
  });
  async function check(name, action) {
    const item = record.checks.find(value => value.name === name);
    const start = Date.now();
    try { item.observed = await action(); item.status = "passed"; }
    catch (error) { item.status = "failed"; item.error = safeError(error); throw error; }
    finally { item.duration_ms = Date.now()-start; }
  }
  try {
    const initialState = page.waitForResponse(r => new URL(r.url()).pathname === "/api/state", {timeout:TIMEOUT});
    await page.goto(BASE.href,{waitUntil:"domcontentloaded",timeout:TIMEOUT});
    const remote = await readResponse(await initialState);
    await waitInventory(page);

    await check("inventory-and-browser-storage", async () => {
      assert.equal(remote.resources.length,23);
      assert.equal(new Set(remote.resources.map(r => r.floor)).size,8);
      assert.equal(remote.storage_mode,"browser","This runner only writes browser-owned simulation bookings");
      assert.equal(await page.locator("#resource-cards .resource-card").count(),23);
      assert.equal(await storedBookingCount(page),0);
      assert.match(await page.locator("#storage-mode-note").innerText(),/browser only|browser profile|this browser/i);
      return {resources:23,floors:8,storage_mode:remote.storage_mode,initial_reservations:0};
    });
    await check("keyboard-skip-link", async () => {
      await page.keyboard.press("Tab");
      assert(await page.locator(".skip-link").evaluate(el => el === document.activeElement),"First Tab must focus the skip link");
      const box = await page.locator(".skip-link").boundingBox();
      assert(box && box.x >= -1 && box.y >= -1 && box.x < viewport.width && box.y < viewport.height,
        "Focused skip link must be visible inside the viewport");
      await page.keyboard.press("Enter");
      assert.equal(new URL(page.url()).hash,"#main");
      await page.keyboard.press("Tab");
      assert(await page.locator("#planning-date").evaluate(el => el === document.activeElement),
        "Tab after the skip link must enter the main workspace");
      return {first_focus:"skip-link",next_main_control:"planning-date"};
    });
    await check("initial-horizontal-fit", () => pageFits(page));
    await screenshot(page,record,"initial");
    await setPlanningDate(page);

    await check("floor-four-and-six-imacs", async () => {
      await page.locator('#building-stack [data-floor="4"]').click();
      assert.equal(await page.locator('#floor-tabs [data-floor="4"]').getAttribute("aria-pressed"),"true");
      await page.locator("#explode-building").click();
      assert.equal(await page.locator("#explode-building").getAttribute("aria-pressed"),"true");
      await page.locator("#resource-kind").selectOption("imac");
      await waitCount(page,'#resource-cards .resource-card[data-kind="imac"]',6);
      assert.equal(await page.locator("#resource-cards .resource-card").count(),6);
      return {selected_floor:4,imacs:6,exploded:true};
    });
    await check("timeline-contained-overflow", async () => {
      await page.locator('#floor-tabs [data-floor="all"]').click();
      await page.locator("#resource-kind").selectOption("all");
      await page.locator("#view-timeline").click();
      const panel = page.locator("#resource-timeline");
      await panel.waitFor({state:"visible"});
      const observed = await panel.evaluate(el => {
        const inner = el.querySelector(".timeline-inner");
        return {client_width:el.clientWidth,scroll_width:el.scrollWidth,
          inner_width:inner.getBoundingClientRect().width,inner_min_width:getComputedStyle(inner).minWidth,
          overflow_x:getComputedStyle(el).overflowX,rows:el.querySelectorAll(".timeline-row").length};
      });
      assert.equal(observed.rows,23);
      assert(["auto","scroll"].includes(observed.overflow_x),"Timeline must contain its own horizontal scrolling");
      if (observed.inner_width > observed.client_width + 1)
        assert(observed.scroll_width > observed.client_width,"A timeline wider than its panel needs internal overflow");
      await pageFits(page);
      await page.locator("#view-cards").click();
      return observed;
    });

    let specialist;
    await check("specialist-plan-versus-baseline", async () => {
      await loadExample(page,"Flexible request versus specialist request",3);
      await page.locator("#search-method").selectOption("hill");
      await page.locator("#search-seed").fill("42");
      specialist = await generatePlan(page);
      assert.equal(specialist.assignments.length,3);
      assert.equal(specialist.baseline_assignments.length,2);
      assert(specialist.score >= specialist.baseline_score);
      assert.equal(await page.locator("#plan-results .baseline-table tbody tr").count(),3);
      assert.equal(await page.locator("#commit-plan").isDisabled(),false);
      return {chosen_placements:specialist.assignments.length,baseline_placements:specialist.baseline_assignments.length,
        chosen_score:specialist.score,baseline_score:specialist.baseline_score};
    });
    await check("placement-route-explanation", async () => {
      const detail = page.locator("#plan-results .assignment-detail").first();
      await detail.locator("summary").click();
      await detail.locator(".route-line").waitFor({state:"visible"});
      const route = await detail.locator(".route-line").innerText();
      assert.match(route,/F\d/);
      assert.match(await detail.innerText(),/Assumed route cost|Modelled P\(free\)/);
      return {route_text:route};
    });
    await check("planned-horizontal-fit", () => pageFits(page));
    await screenshot(page,record,"specialist-plan");
    await check("changed-seed-invalidates-plan", async () => {
      await page.locator("#search-seed").fill("43");
      await page.locator("#plan-results .stale-note").waitFor({state:"visible"});
      assert.equal(await page.locator("#commit-plan").isDisabled(),true);
      await page.locator("#search-seed").fill("42");
      specialist = await generatePlan(page);
      assert.equal(specialist.assignments.length,3);
      assert.equal(await page.locator("#commit-plan").isDisabled(),false);
      return {disabled_after_change:true,regenerated:true};
    });
    await check("three-browser-reservations", async () => {
      await page.locator("#commit-plan").click();
      await waitCount(page,"#reservation-list .reservation-row",3);
      await waitText(page,"#stat-bookings","3");
      assert.equal(await storedBookingCount(page),3);
      assert(!record.api_requests.some(r => r.path === "/api/bookings" && r.method === "POST"),
        "Browser reservations must not be sent to a server booking endpoint");
      return {browser_reservations:3,server_booking_posts:0};
    });
    await check("reservations-survive-reload", async () => {
      await page.reload({waitUntil:"domcontentloaded"});
      await waitInventory(page);
      assert.equal(await storedBookingCount(page),3);
      await setPlanningDate(page);
      await waitCount(page,"#reservation-list .reservation-row",3);
      return {reservations_after_reload:3};
    });
    await check("downloaded-ics-calendar", async () => {
      const pending = page.waitForEvent("download",{timeout:TIMEOUT});
      await page.locator("#export-calendar").click();
      const download = await pending;
      assert.match(download.suggestedFilename(),/\.ics$/i);
      const filename = `${record.id}-reservations.ics`;
      await download.saveAs(path.join(OUTPUT,filename));
      const calendar = await fs.readFile(path.join(OUTPUT,filename),"utf8");
      assert(calendar.startsWith("BEGIN:VCALENDAR\r\n"));
      assert(calendar.endsWith("END:VCALENDAR\r\n"));
      assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,3);
      assert.equal((calendar.match(/SUMMARY:\[SIMULATION\]/g)||[]).length,3);
      assert(calendar.includes("DTSTART:"+DAY.replaceAll("-","")+"T"));
      assert(!/(^|[^\r])\n/.test(calendar),"ICS must use CRLF line endings");
      assert(calendar.split("\r\n").every(line => Buffer.byteLength(line,"utf8") <= 75),"ICS lines must be folded at 75 UTF-8 octets");
      assert(!record.api_requests.some(r => r.path === "/api/export"),"Browser calendar export must stay local");
      return {download:filename,events:3,simulation_labels:3,floating_times:true};
    });
    await check("cancel-all-simulation-reservations", async () => {
      for (let remaining=3;remaining>0;remaining--) {
        await page.locator("#reservation-list [data-cancel]").first().click();
        await waitCount(page,"#reservation-list .reservation-row",remaining-1);
      }
      assert.equal(await storedBookingCount(page),0);
      await waitText(page,"#stat-bookings","0");
      return {remaining_reservations:0};
    });

    await check("one-step-unavailable-actions", async () => {
      await page.locator("#lab-horizon").selectOption("1");
      const response = apiResponse(page,"/api/decision",r => JSON.parse(r.postData() || "{}").horizon === 1);
      await page.locator("#evaluate-decision").click();
      const result = await readResponse(await response);
      assert.equal(result.values.inspect,null);
      assert.equal(result.values.wait,null);
      await page.waitForFunction(() => [...document.querySelectorAll("#decision-result .action-value strong")].filter(el => el.textContent === "N/A").length === 2);
      const values = await page.locator("#decision-result .action-value").evaluateAll(rows =>
        Object.fromEntries(rows.map(row => [row.querySelector("span").textContent,row.querySelector("strong").textContent])));
      assert.equal(values.Inspect,"N/A");assert.equal(values.Wait,"N/A");
      return {horizon:1,inspect:values.Inspect,wait:values.Wait};
    });
    await check("hmm-three-report-forecast", async () => {
      await page.locator("#hmm-reports").fill("free, busy, free");
      const response = apiResponse(page,"/api/occupancy");
      await page.locator("#evaluate-occupancy").click();
      const result = await readResponse(await response);
      assert.equal(result.trace.length,3);
      assert(result.predictive_next >= 0 && result.predictive_next <= 1);
      await waitCount(page,"#occupancy-result .hmm-step",3);
      return {reports:3,predictive_next:result.predictive_next};
    });
    await check("apply-hmm-sequence-to-resource", async () => {
      await page.locator("#forecast-resource").selectOption("F4-IM01");
      await page.locator("#apply-forecast").click();
      const report = page.locator('#resource-cards select[data-report="F4-IM01"]');
      assert.equal(await report.inputValue(),"sequence");
      assert.match(await report.locator("option:checked").innerText(),/3-report sequence/);
      assert.equal(await storedBookingCount(page),0);
      return {resource_id:"F4-IM01",report_count:3,reservations_created:0};
    });
    await check("impossible-request-stays-unassigned", async () => {
      await loadExample(page,"Explain an impossible request",1);
      const result = await generatePlan(page);
      assert.equal(result.assignments.length,0);assert.equal(result.unassigned.length,1);
      assert.equal(await page.locator("#commit-plan").isDisabled(),true);
      assert.equal(await page.locator("#plan-results .unassigned-box").count(),1);
      return {assignments:0,unassigned:1,commit_disabled:true};
    });
    await check("invalid-time-ui-error", async () => {
      await page.locator("#clear-queue").click();
      await page.locator("#request-title").fill("Invalid time window");
      await page.locator("#request-earliest").fill("13:00");
      await page.locator("#request-latest").fill("12:00");
      await page.locator("#request-duration").selectOption("60");
      await page.locator("#add-request").click();
      await page.locator("#request-error").waitFor({state:"visible"});
      assert.match(await page.locator("#request-error").innerText(),/half-hour|full duration/i);
      assert.equal(await page.locator("#request-queue .request-item").count(),0);
      return {invalid_request_added:false,visible_error:true};
    });
    await check("long-title-horizontal-fit", async () => {
      const title = "L".repeat(100);
      await page.locator("#request-title").fill(title);
      await page.locator("#request-kind").selectOption("study_room");
      await page.locator("#request-people").fill("4");
      await page.locator("#request-earliest").fill("10:00");
      await page.locator("#request-latest").fill("11:00");
      await page.locator("#add-request").click();
      await waitCount(page,"#request-queue .request-item",1);
      assert.equal(await page.locator("#request-queue h4").innerText(),title);
      const result = await generatePlan(page);
      assert.equal(result.assignments.length,1);
      assert.equal(await page.locator("#plan-results .plan-row h4").innerText(),title);
      const fit = await pageFits(page);
      await screenshot(page,record,"long-title-plan");
      return {title_length:title.length,...fit};
    });
    await check("no-uncaught-page-errors", async () => {
      assert.deepEqual(record.page_errors,[]);
      return {uncaught_errors:0};
    });
    record.status = "passed";
  } catch (error) {
    record.status = "failed";record.error = safeError(error);
    try { await screenshot(page,record,"failure"); } catch (captureError) { record.capture_error = safeError(captureError); }
  } finally { await context.close(); }
  return record;
}

async function main() {
  const report = {kind:"actual-playwright-browser-run",started_at:new Date().toISOString(),
    base_url:BASE.origin+BASE.pathname,planning_date:DAY,status:"running",viewports:[],
    note:"Results and screenshots come only from this invocation. No API responses are mocked. Browser-owned simulation bookings use fresh profiles."};
  let browser;
  try {
    assert(["http:","https:"].includes(BASE.protocol) && !BASE.username && !BASE.password && !BASE.search && !BASE.hash,
      "BASE_URL must be a credential-free HTTP(S) page URL without query parameters");
    assert(BASE.hostname.toLowerCase() !== "campus.qairu.edu.kz",
      "QAIRU Campus is not a test target. Use the independent Expo simulation deployment.");
    assert(/^\d{4}-\d{2}-\d{2}$/.test(DAY) && new Date(DAY+"T12:00:00Z").toISOString().slice(0,10) === DAY,
      "PLANNING_DATE must be a real YYYY-MM-DD calendar date");
    await fs.mkdir(OUTPUT,{recursive:true});
    let playwright;
    try { playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright"); }
    catch (error) { report.status="blocked";report.blocked_reason="Playwright module unavailable: "+safeError(error);return report; }
    try {
      browser = await playwright.chromium.launch({headless:true,
        ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
    } catch (error) {
      report.status="blocked";report.blocked_reason="Chromium could not launch: "+safeError(error);return report;
    }
    report.browser_version = browser.version();
    for (const viewport of VIEWPORTS) report.viewports.push(await runViewport(browser,viewport));
    report.status = report.viewports.every(item => item.status === "passed") ? "passed" : "failed";
    return report;
  } catch (error) {
    report.status="failed";report.error=safeError(error);return report;
  } finally {
    if (browser) await browser.close();
    report.finished_at=new Date().toISOString();
    report.totals={viewports_run:report.viewports.length,
      checks_passed:report.viewports.flatMap(v=>v.checks).filter(c=>c.status==="passed").length,
      checks_failed:report.viewports.flatMap(v=>v.checks).filter(c=>c.status==="failed").length,
      checks_not_run:report.viewports.flatMap(v=>v.checks).filter(c=>c.status==="not_run").length};
    await fs.mkdir(OUTPUT,{recursive:true});
    await fs.writeFile(path.join(OUTPUT,"report.json"),JSON.stringify(report,null,2)+"\n","utf8");
    console.log(JSON.stringify(report,null,2));
    process.exitCode=report.status==="passed"?0:report.status==="blocked"?2:1;
  }
}

if (require.main === module) main().catch(error => { console.error(safeError(error));process.exitCode=1; });
