/*
 * Real-browser checks for the simple /find.html page. No API replies are mocked.
 * This file prepares a test suite; syntax checking it does not run any tests.
 *
 * Optional setup on a machine that permits Chromium:
 *   npm install
 *   npx playwright install chromium
 *   node tests/finder_e2e.cjs
 *
 * Optional environment variables:
 *   BASE_URL              deployment origin, or its /find.html URL
 *   PLAYWRIGHT_MODULE     package name or absolute module path
 *   CHROMIUM_EXECUTABLE   explicit compatible Chromium executable
 *   FINDER_QA_OUTPUT      output folder; defaults to results/finder_e2e
 *   PLANNING_DATE         synthetic date; defaults to 2026-12-01
 *   FINDER_SCREENSHOTS    set to 0 to omit screenshots
 *
 * Five fresh browser profiles run 20 checks each. Writes are allowed only after
 * the live API identifies browser-owned simulation mode. No Campus submission
 * or shared server reservation is changed. API requests use fictional titles.
 * Screenshots/report belong to this invocation and cannot replace the frozen
 * verification evidence for the original workspace. Reports are saved after
 * every check, including failures. Unexecuted checks remain explicitly not_run.
 *
 * Scope: Chromium, reduced motion, viewport/touch emulation. Keyboard checks
 * cover the skip link, labelled form controls, Tab within the main form, and
 * ArrowDown/Home/End focus and selection on the native floor rail.
 * The confirmation check uses a normal click and verifies one saved booking
 * and an unavailable confirmation control afterward. It is not a concurrent
 * double-submit stress test. Physical devices and a full accessibility audit
 * are outside this suite. Exit codes: 0 passed, 1 failed, 2 browser unavailable.
 */
"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.resolve(process.env.FINDER_QA_OUTPUT || path.join(ROOT, "results/finder_e2e"));
const DEFAULT_BASE = "https://expo-smart-scheduler.vercel.app/";
const DAY = process.env.PLANNING_DATE || "2026-12-01";
const TIMEOUT = 60_000;
const TITLE = "L".repeat(100); // Deliberately unbroken, fictional text tests wrapping.
const TAKE_SCREENSHOTS = process.env.FINDER_SCREENSHOTS !== "0";
const VIEWPORTS = [
  {width:360,height:800}, {width:390,height:844}, {width:768,height:1024},
  {width:1440,height:1000}, {width:1920,height:1080},
];
const CHECKS = [
  "inventory-and-personal-browser-scope",
  "keyboard-and-labelled-search-form",
  "initial-horizontal-fit",
  "visible-ai-topics-and-scope",
  "native-intent-presets-update-the-search-form",
  "native-floor-rail-updates-the-route-origin",
  "find-one-imac-through-live-api",
  "result-constraints-and-honest-ai-explanation",
  "result-horizontal-fit",
  "review-without-creating-a-reservation",
  "long-title-review-horizontal-fit",
  "single-reservation-confirmation",
  "long-title-reservation-horizontal-fit",
  "download-simulated-calendar",
  "personal-reservation-survives-reload",
  "original-workspace-sees-the-same-reservation",
  "cancel-reservation-and-refresh-original-workspace",
  "late-window-shows-error-without-api-search",
  "oversized-group-stays-unassigned",
  "no-uncaught-errors-or-server-booking-writes",
];

function safeError(error) {
  return String(error?.message || error)
    .replace(/([?&]_vercel_share=)[^&\s]+/g, "$1[redacted]")
    .slice(0, 2000);
}

function totals(report) {
  const checks = report.viewports.flatMap(v => v.checks);
  return {viewports_planned:VIEWPORTS.length,
    viewports_started:report.viewports.filter(v=>v.started_at).length,
    viewports_completed:report.viewports.filter(v=>v.status==="passed" || v.status==="failed").length,
    checks_planned:VIEWPORTS.length*CHECKS.length,
    checks_passed:checks.filter(c=>c.status==="passed").length,
    checks_failed:checks.filter(c=>c.status==="failed").length,
    checks_not_run:checks.filter(c=>c.status==="not_run").length};
}

async function checkpoint(report) {
  report.updated_at = new Date().toISOString();
  report.totals = totals(report);
  await fs.mkdir(OUTPUT,{recursive:true});
  const temporary = path.join(OUTPUT,`report.${process.pid}.tmp`);
  await fs.writeFile(temporary,JSON.stringify(report,null,2)+"\n","utf8");
  await fs.rename(temporary,path.join(OUTPUT,"report.json"));
}

async function waitCount(page,selector,count) {
  await page.waitForFunction(({selector,count})=>document.querySelectorAll(selector).length===count,
    {selector,count},{timeout:TIMEOUT});
}

async function waitPhase(page,phase) {
  await page.waitForFunction(phase=>document.querySelector("#find-results")?.dataset.phase===phase,
    phase,{timeout:TIMEOUT});
}

async function waitFinderReady(page) {
  await page.waitForFunction(()=>document.querySelector("#finder-inventory-count")?.textContent.trim()==="23"
    && document.querySelector("#find-submit")?.disabled===false,null,{timeout:TIMEOUT});
  await page.evaluate(async()=>{if(document.fonts)await document.fonts.ready;});
}

async function readResponse(response) {
  const result = await response.json();
  assert(response.ok(),`Live API returned ${response.status()}: ${String(result.error||"request failed")}`);
  return result;
}

function stateResponse(page,day) {
  return page.waitForResponse(response=>{
    const url=new URL(response.url());
    return url.pathname==="/api/state" && response.request().method()==="GET"
      && (!day || url.searchParams.get("date")===day);
  },{timeout:TIMEOUT});
}

function planResponse(page) {
  return page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plan"
    && response.request().method()==="POST",{timeout:TIMEOUT});
}

async function setFinderDate(page) {
  const field=page.locator("#find-date");
  if(await field.inputValue()===DAY){await waitFinderReady(page);return;}
  const pending=stateResponse(page,DAY);
  await field.fill(DAY);await field.press("Tab");
  const result=await readResponse(await pending);
  assert.equal(result.date,DAY);assert.equal(result.storage_mode,"browser");
  await waitFinderReady(page);
}

async function storedBookings(page) {
  return page.evaluate(()=>{
    const raw=localStorage.getItem("expo-smart-scheduler-v1");
    return raw ? JSON.parse(raw).bookings : [];
  });
}

async function pageFits(page) {
  const result=await page.evaluate(()=>({
    viewport_width:document.documentElement.clientWidth,
    document_width:document.documentElement.scrollWidth,
    body_width:document.body.scrollWidth,
  }));
  assert(result.document_width<=result.viewport_width+1,
    `Document overflows horizontally: ${JSON.stringify(result)}`);
  assert(result.body_width<=result.viewport_width+1,
    `Body overflows horizontally: ${JSON.stringify(result)}`);
  return result;
}

async function capture(page,record,label) {
  if(!TAKE_SCREENSHOTS)return;
  const filename=`finder-${record.id}-${label}.png`;
  await page.screenshot({path:path.join(OUTPUT,filename),fullPage:false});
  record.screenshots.push(filename);
}

async function prepareSearch(page,{kind="imac",people=1,title=TITLE,start="10:00",duration="60"}={}) {
  await setFinderDate(page);
  await page.locator("#find-kind").selectOption(kind);
  if(await page.locator("#find-people").isDisabled()) {
    assert.equal(kind,"imac","Only the individual-iMac form should lock the people field");
    assert.equal(await page.locator("#find-people").inputValue(),"1");
  } else await page.locator("#find-people").fill(String(people));
  await page.locator("#find-start").fill(start);
  await page.locator("#find-duration").selectOption(duration);
  const preferences=page.locator("#find-preferences");
  if(!await preferences.evaluate(el=>el.open))await preferences.locator("summary").click();
  await page.locator("#find-floor").selectOption("4");
  await page.locator("#find-title").fill(title);
}

async function search(page,expectedPhase="ready") {
  const pending=planResponse(page);
  await page.locator("#find-submit").click();
  const response=await pending;
  const payload=JSON.parse(response.request().postData()||"{}");
  const result=await readResponse(response);
  await waitPhase(page,expectedPhase);await waitFinderReady(page);
  return {result,payload};
}

async function openWorkspace(context,urls,record) {
  const page=await context.newPage();
  page.on("pageerror",error=>record.page_errors.push({page:"workspace",error:safeError(error)}));
  page.on("request",request=>recordRequest(record,request,urls.origin,"workspace"));
  page.setDefaultTimeout(TIMEOUT);
  const pending=stateResponse(page);
  await page.goto(urls.workspace,{waitUntil:"domcontentloaded",timeout:TIMEOUT});
  const initial=await readResponse(await pending);
  assert.equal(initial.storage_mode,"browser");
  await waitWorkspaceReady(page);
  await setWorkspaceDate(page);
  return page;
}

async function waitWorkspaceReady(page) {
  await page.waitForFunction(()=>document.querySelector("#stat-resources")?.textContent.trim()==="23"
    && document.querySelector("#main")?.getAttribute("aria-busy")==="false",null,{timeout:TIMEOUT});
}

async function setWorkspaceDate(page) {
  const field=page.locator("#planning-date");
  if(await field.inputValue()===DAY){await waitWorkspaceReady(page);return;}
  const pending=stateResponse(page,DAY);await field.fill(DAY);await field.press("Tab");
  const result=await readResponse(await pending);assert.equal(result.date,DAY);
  await waitWorkspaceReady(page);
}

function recordRequest(record,request,origin,pageName) {
  const url=new URL(request.url());
  if(url.origin===origin && url.pathname.startsWith("/api/"))
    record.api_requests.push({page:pageName,method:request.method(),path:url.pathname});
}

function newViewport(viewport) {
  return {id:`${viewport.width}x${viewport.height}`,viewport,
    emulation:{reduced_motion:"reduce",touch:viewport.width<=768,mobile:viewport.width<=768},
    status:"not_run",phase:"not_started",checks:CHECKS.map(name=>({name,status:"not_run"})),
    screenshots:[],downloads:[],page_errors:[],api_requests:[]};
}

async function runViewport(browser,urls,record,report) {
  record.status="running";record.started_at=new Date().toISOString();record.phase="opening-finder";
  await checkpoint(report);
  const context=await browser.newContext({viewport:record.viewport,acceptDownloads:true,reducedMotion:"reduce",colorScheme:"light",
    locale:"en-GB",isMobile:record.viewport.width<=768,hasTouch:record.viewport.width<=768,deviceScaleFactor:1});
  const page=await context.newPage();let remote,found,resource,workspace;
  page.setDefaultTimeout(TIMEOUT);
  page.on("pageerror",error=>record.page_errors.push({page:"finder",error:safeError(error)}));
  page.on("request",request=>recordRequest(record,request,urls.origin,"finder"));
  async function check(name,action) {
    const item=record.checks.find(c=>c.name===name);const started=Date.now();
    record.phase=name;await checkpoint(report);
    try{item.observed=await action();item.status="passed";}
    catch(error){item.status="failed";item.error=safeError(error);throw error;}
    finally{item.duration_ms=Date.now()-started;await checkpoint(report);}
    console.log(`[finder ${record.id}] passed: ${name}`);
  }
  try {
    await check("inventory-and-personal-browser-scope",async()=>{
      const pending=stateResponse(page);
      const documentResponse=await page.goto(urls.finder,{waitUntil:"domcontentloaded",timeout:TIMEOUT});
      assert(documentResponse?.ok(),`Finder document returned ${documentResponse?.status()}`);
      remote=await readResponse(await pending);
      assert.equal(remote.storage_mode,"browser","This runner writes only personal browser simulations");
      assert.equal(remote.resources.length,23);assert.equal(new Set(remote.resources.map(r=>r.floor)).size,8);
      await waitFinderReady(page);
      assert.equal((await storedBookings(page)).length,0,"A fresh browser profile must have no reservations");
      assert.match(await page.locator("#finder-storage-note").innerText(),/browser/i);
      return {document_status:documentResponse.status(),resources:remote.resources.length,floors:8,storage_mode:remote.storage_mode,initial_bookings:0};
    });
    await check("keyboard-and-labelled-search-form",async()=>{
      await page.keyboard.press("Tab");
      assert(await page.locator(".skip-link").evaluate(el=>el===document.activeElement),"First Tab must focus the skip link");
      const box=await page.locator(".skip-link").boundingBox();
      assert(box && box.x>=-1 && box.y>=-1 && box.x<record.viewport.width && box.y<record.viewport.height);
      await page.keyboard.press("Enter");assert.equal(new URL(page.url()).hash,"#finder-main");
      const ids=["find-kind","find-date","find-start","find-duration","find-people","find-floor","find-title","find-accessible"];
      const labels=await page.evaluate(ids=>Object.fromEntries(ids.map(id=>{
        const el=document.getElementById(id);
        const label=el?.labels?.[0];
        return [id,label?.querySelector(".field-label")?.textContent.trim() || label?.textContent.trim() || ""];
      })),ids);
      for(const id of ids)assert(labels[id],`${id} must have an associated readable label`);
      await page.locator("#find-kind").focus();await page.keyboard.press("Tab");
      assert(await page.evaluate(()=>document.querySelector("#finder-main")?.contains(document.activeElement)
        && document.activeElement?.id!=="find-kind"),"Tab must advance through the main controls");
      assert(await page.locator('a[href="/"]').count()>0,"The original workspace must remain reachable");
      return {first_focus:"skip-link",skip_target:"finder-main",labelled_controls:ids.length,tab_advanced:true};
    });
    await check("initial-horizontal-fit",async()=>{
      const fit=await pageFits(page);await capture(page,record,"initial");return fit;
    });
    await check("visible-ai-topics-and-scope",async()=>{
      const section=page.locator("#ai-methods");assert(await section.isVisible());
      assert.equal(await section.locator(".method-entry").count(),6);
      const text=await section.innerText();
      for(const pattern of [/constraint satisfaction/i,/hill climbing/i,/A\* search/i,/Bayes/i,/hidden Markov model/i,/sequential decisions/i])assert.match(text,pattern);
      assert.match(text,/no new report.*keeps|no new report[\s\S]*prior/i);
      assert.match(text,/not in this simple search/i,"HMM must not be presented as active without a history");
      assert.match(text,/does not rank/i,"Decision advice must be distinguished from room ranking");
      return {method_rows:6,hmm_scope:"workspace sequence lab",bayes_scope:"resource prior retained without a report",decision_scope:"post-search advisory"};
    });
    await check("native-intent-presets-update-the-search-form",async()=>{
      const presets=page.locator(".intent-switcher button[data-intent]");
      assert.equal(await presets.count(),4);
      const before=record.api_requests.filter(r=>r.page==="finder" && r.path==="/api/plan" && r.method==="POST").length;
      const auditorium=page.locator('button[data-intent="auditorium"]');
      await auditorium.click();
      assert.equal(await page.locator("#find-kind").inputValue(),"auditorium");
      assert.equal(await auditorium.getAttribute("aria-pressed"),"true");
      assert.equal(await page.locator('.intent-switcher button[data-intent][aria-pressed="true"]').count(),1);
      const imac=page.locator('button[data-intent="imac"]');
      await imac.click();
      assert.equal(await page.locator("#find-kind").inputValue(),"imac");
      assert.equal(await page.locator("#find-people").inputValue(),"1");
      assert.equal(await page.locator("#find-people").isDisabled(),true);
      assert.equal(await imac.getAttribute("aria-pressed"),"true");
      assert.equal(await auditorium.getAttribute("aria-pressed"),"false");
      assert.equal(await page.locator('.intent-switcher button[data-intent][aria-pressed="true"]').count(),1);
      const after=record.api_requests.filter(r=>r.page==="finder" && r.path==="/api/plan" && r.method==="POST").length;
      assert.equal(after,before,"An intent preset must not search automatically");
      assert.equal((await storedBookings(page)).length,0,"An intent preset must not reserve a space");
      return {native_clicks:["auditorium","imac"],presets:4,exclusive_pressed_state:true,
        selected_kind:"imac",people:1,people_field_disabled:true,additional_plan_requests:0,reservations_created:0};
    });
    await check("native-floor-rail-updates-the-route-origin",async()=>{
      const rail=page.locator("#atlas-floor-controls");
      assert.equal(await rail.locator("button[data-atlas-floor]").count(),8);
      assert.match(await rail.getAttribute("aria-label"),/starting floor.*assumed route/i);
      const before=record.api_requests.filter(r=>r.page==="finder" && r.path==="/api/plan" && r.method==="POST").length;
      async function selectedFloor(floor) {
        const button=rail.locator(`button[data-atlas-floor="${floor}"]`);
        assert.equal(await page.locator("#find-floor").inputValue(),String(floor));
        assert.equal(await button.getAttribute("aria-pressed"),"true");
        assert.equal(await rail.locator('button[aria-pressed="true"]').count(),1);
        assert.equal(await page.locator(`.atlas-slice[data-slice-floor="${floor}"].is-active`).count(),1);
      }
      await rail.locator('button[data-atlas-floor="8"]').click();await selectedFloor(8);
      await page.keyboard.press("ArrowDown");await selectedFloor(7);
      assert(await rail.locator('button[data-atlas-floor="7"]').evaluate(el=>el===document.activeElement));
      await page.keyboard.press("End");await selectedFloor(1);
      await page.keyboard.press("Home");await selectedFloor(8);
      await rail.locator('button[data-atlas-floor="4"]').click();await selectedFloor(4);
      const after=record.api_requests.filter(r=>r.page==="finder" && r.path==="/api/plan" && r.method==="POST").length;
      assert.equal(after,before,"Choosing a route origin must not search automatically");
      assert.equal((await storedBookings(page)).length,0,"Choosing a route origin must not reserve a space");
      const fit=await pageFits(page);await capture(page,record,"atlas-controls");
      return {floor_controls:8,native_clicks:[8,4],native_keys:["ArrowDown","End","Home"],
        keyboard_floor_sequence:[8,7,1,8],selected_route_origin:4,exclusive_pressed_state:true,
        additional_plan_requests:0,reservations_created:0,...fit};
    });
    await check("find-one-imac-through-live-api",async()=>{
      await prepareSearch(page);
      found=await search(page);const request=found.payload.requests?.[0];
      assert.equal(found.payload.date,DAY);assert.equal(found.payload.requests.length,1);
      assert.equal(request.kind,"imac");assert.equal(request.group_size,1);assert.equal(request.title,TITLE);
      assert.equal(request.earliest,600);assert.equal(request.latest,660);assert.equal(request.duration,60);
      assert.deepEqual(found.payload.reports,{});assert.equal(found.result.assignments.length,1);
      const chosen=found.result.assignments[0];resource=remote.resources.find(r=>r.id===chosen.resource_id);
      assert(resource);assert.equal(resource.kind,"imac");assert.equal(resource.capacity,1);
      assert.equal(chosen.start,600);assert.equal(chosen.end,660);
      assert.equal(await page.locator("#find-people").inputValue(),"1");
      assert.equal((await storedBookings(page)).length,0);
      return {api:"POST /api/plan",resource_id:resource.id,people:1,start:chosen.start,end:chosen.end,title_length:TITLE.length,reservations_created:0};
    });
    await check("result-constraints-and-honest-ai-explanation",async()=>{
      assert.equal(await page.locator("#finder-result-title").innerText(),resource.name);
      assert.equal(await page.locator("#find-choose").getAttribute("data-resource-id"),resource.id);
      const ai=page.locator("#result-ai");assert(await ai.isVisible());
      assert.equal(await ai.locator(".ai-proof").count(),6);const text=await ai.innerText();
      assert.match(text,/prior retained \(no report\)/i);assert.match(text,/not active for this search/i);
      assert.match(text,/does not rank spaces/i);assert.match(text,/assumed walking minutes/i);
      assert(Math.abs(found.result.assignments[0].belief-resource.prior)<1e-10,
        "With no report the result must retain the specified prior");
      const detail=ai.locator("details");await detail.locator("summary").click();
      await detail.locator(".route-text").waitFor({state:"visible"});
      assert.match(await detail.locator(".route-text").innerText(),/F4/);
      return {visible_method_rows:6,prior:resource.prior,hmm_active:false,decision_is_advisory:true,route_visible:true};
    });
    await check("result-horizontal-fit",async()=>{
      const fit=await pageFits(page);await capture(page,record,"result");return fit;
    });
    await check("review-without-creating-a-reservation",async()=>{
      await page.locator("#find-choose").click();await page.locator("#find-review").waitFor({state:"visible"});
      const text=await page.locator("#find-review-content").innerText();
      assert(text.includes(resource.name));assert(text.includes(TITLE));assert.match(text,/10:00/);
      assert.equal(await page.locator("#find-confirm").isDisabled(),false);
      assert.equal((await storedBookings(page)).length,0);
      return {review_visible:true,title_length:TITLE.length,resource_id:resource.id,reservations_created:0};
    });
    await check("long-title-review-horizontal-fit",async()=>{
      const fit=await pageFits(page);await capture(page,record,"review");return {title_length:TITLE.length,...fit};
    });
    await check("single-reservation-confirmation",async()=>{
      await page.locator("#find-confirm").click();await waitPhase(page,"saved");await waitFinderReady(page);
      await waitCount(page,"#find-reservations .reservation-card",1);
      const bookings=await storedBookings(page);assert.equal(bookings.length,1);
      assert.equal(bookings[0].resource_id,resource.id);assert.equal(bookings[0].title,TITLE);assert.equal(bookings[0].date,DAY);
      assert.equal(bookings[0].start,600);assert.equal(bookings[0].end,660);
      assert.equal(await page.locator("#find-results .receipt-card").count(),1);
      assert.equal(await page.locator("#find-choose").count(),0);
      assert.equal(await page.locator("#find-review").isVisible(),false);
      assert.equal(await page.locator("#find-confirm").isDisabled(),true);
      return {personal_reservations:1,receipt:true,confirmation_unavailable_after_save:true,
        concurrent_double_submit_tested:false};
    });
    await check("long-title-reservation-horizontal-fit",async()=>{
      assert.equal(await page.locator("#find-reservations .reservation-card h3").innerText(),TITLE);
      const fit=await pageFits(page);await capture(page,record,"saved");return {title_length:TITLE.length,...fit};
    });
    await check("download-simulated-calendar",async()=>{
      const pending=page.waitForEvent("download",{timeout:TIMEOUT});
      await page.locator("#find-export").click();const download=await pending;
      assert.match(download.suggestedFilename(),/\.ics$/i);
      const filename=`finder-${record.id}-reservations.ics`;
      await download.saveAs(path.join(OUTPUT,filename));record.downloads.push(filename);
      const calendar=await fs.readFile(path.join(OUTPUT,filename),"utf8");
      const unfolded=calendar.replace(/\r\n[ \t]/g,"");
      assert(calendar.startsWith("BEGIN:VCALENDAR\r\n"));assert(calendar.endsWith("END:VCALENDAR\r\n"));
      assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,1);
      assert.equal((unfolded.match(/SUMMARY:\[SIMULATION\]/g)||[]).length,1);
      assert(unfolded.includes("SUMMARY:[SIMULATION] "+TITLE+"\r\n"),
        "Unfolding the exported summary must preserve the full 100-character title");
      assert(unfolded.includes("DTSTART:"+DAY.replaceAll("-","")+"T100000\r\n"));
      assert(unfolded.includes("DTEND:"+DAY.replaceAll("-","")+"T110000\r\n"));
      assert(!/(^|[^\r])\n/.test(calendar),"ICS must use CRLF line endings");
      assert(calendar.split("\r\n").every(line=>Buffer.byteLength(line,"utf8")<=75),
        "ICS physical lines must fold at 75 UTF-8 octets");
      assert(!unfolded.includes("TZID="),"The simulation calendar must preserve floating local times");
      assert(!record.api_requests.some(r=>r.path==="/api/export"),"Hosted calendar export must stay in this browser");
      assert.equal((await storedBookings(page)).length,1,"Calendar export must not create or remove a reservation");
      return {download:filename,suggested_filename:download.suggestedFilename(),events:1,simulation_labels:1,
        full_title_preserved:true,title_length:TITLE.length,floating_times:true};
    });
    await check("personal-reservation-survives-reload",async()=>{
      const pending=stateResponse(page);await page.reload({waitUntil:"domcontentloaded"});
      const initial=await readResponse(await pending);assert.equal(initial.storage_mode,"browser");
      await waitFinderReady(page);assert.equal((await storedBookings(page)).length,1);
      await setFinderDate(page);await waitCount(page,"#find-reservations .reservation-card",1);
      assert.equal(await page.locator("#find-reservations .reservation-card h3").innerText(),TITLE);
      return {personal_reservations_after_reload:1,date:DAY};
    });
    await check("original-workspace-sees-the-same-reservation",async()=>{
      workspace=await openWorkspace(context,urls,record);
      await waitCount(workspace,"#reservation-list .reservation-row",1);
      assert.equal(await workspace.locator("#reservation-list .reservation-row h3").innerText(),TITLE);
      const bookings=await storedBookings(workspace);assert.equal(bookings.length,1);assert.equal(bookings[0].resource_id,resource.id);
      await page.bringToFront();return {original_workspace_reservations:1,same_browser_profile:true};
    });
    await check("cancel-reservation-and-refresh-original-workspace",async()=>{
      await page.locator("#find-reservations [data-cancel-id]").click();
      await waitCount(page,"#find-reservations .reservation-card",0);await waitFinderReady(page);
      assert.equal((await storedBookings(page)).length,0);
      const pending=stateResponse(workspace);await workspace.reload({waitUntil:"domcontentloaded"});
      await readResponse(await pending);await waitWorkspaceReady(workspace);await setWorkspaceDate(workspace);
      await waitCount(workspace,"#reservation-list .reservation-row",0);
      assert.equal((await storedBookings(workspace)).length,0);await page.bringToFront();
      return {finder_reservations:0,original_workspace_reservations:0};
    });
    await check("late-window-shows-error-without-api-search",async()=>{
      await prepareSearch(page,{start:"19:30",duration:"60",title:"Invalid late-window example"});
      const before=record.api_requests.filter(r=>r.page==="finder" && r.path==="/api/plan" && r.method==="POST").length;
      await page.locator("#find-submit").click();await page.locator("#find-error").waitFor({state:"visible"});
      assert.match(await page.locator("#find-error").innerText(),/08:00.*20:00|half-hour|duration|window/i);
      const after=record.api_requests.filter(r=>r.page==="finder" && r.path==="/api/plan" && r.method==="POST").length;
      assert.equal(after,before);assert.equal((await storedBookings(page)).length,0);
      return {requested_start:"19:30",duration:60,visible_error:true,additional_plan_requests:0};
    });
    await check("oversized-group-stays-unassigned",async()=>{
      await prepareSearch(page,{kind:"auditorium",people:100,title:"Synthetic 100-person event"});
      const empty=await search(page,"empty");assert.equal(empty.result.assignments.length,0);
      assert.equal(empty.result.unassigned.length,1);assert.equal(await page.locator("#find-choose").count(),0);
      assert.equal(await page.locator("#find-review").isVisible(),false);assert.equal(await page.locator("#find-confirm").isDisabled(),true);
      assert.equal((await storedBookings(page)).length,0);const fit=await pageFits(page);await capture(page,record,"empty-result");
      return {assignments:0,unassigned:1,people:100,confirmation_unavailable:true,...fit};
    });
    await check("no-uncaught-errors-or-server-booking-writes",async()=>{
      assert.deepEqual(record.page_errors,[]);
      const writes=record.api_requests.filter(r=>r.path==="/api/bookings" || r.path.startsWith("/api/bookings/"));
      assert.deepEqual(writes,[],"Hosted reservation commits and cancellation must remain browser-owned");
      return {uncaught_page_errors:0,server_booking_requests:0,remaining_personal_reservations:(await storedBookings(page)).length};
    });
    record.status="passed";record.phase="completed";
  } catch(error) {
    record.status="failed";record.error=safeError(error);record.failure_phase=record.phase;
    try{await capture(page,record,"failure");}catch(captureError){record.capture_error=safeError(captureError);}
  } finally {
    record.finished_at=new Date().toISOString();await checkpoint(report);await context.close();
  }
}

async function main() {
  const report={kind:"actual-playwright-finder-run",runner_revision:"2026-11-23-atlas-1",
    started_at:new Date().toISOString(),planning_date:DAY,status:"running",viewports:VIEWPORTS.map(newViewport),
    note:"Only this invocation creates actual browser observations. No API replies are mocked. Fresh profiles isolate personal simulation reservations.",
    limits:["Chromium only; reduced-motion viewport/touch emulation, not physical devices.",
      "Keyboard checks cover skip-link, form labels, Tab and floor-rail ArrowDown/Home/End, not a complete accessibility audit.",
      "Normal confirmation verifies one saved booking; concurrent double-submit stress is not part of this browser suite."]};
  let browser;
  try {
    const base=new URL(process.env.BASE_URL||DEFAULT_BASE);
    assert(["http:","https:"].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash,
      "BASE_URL must be credential-free HTTP(S), without query parameters or fragments");
    assert(base.hostname.toLowerCase()!=="campus.qairu.edu.kz","QAIRU Campus is not a test target");
    assert(["/","/find.html"].includes(base.pathname),"BASE_URL must be the deployment origin or its /find.html page");
    assert(/^\d{4}-\d{2}-\d{2}$/.test(DAY) && DAY>="2000-01-01" && DAY<="2100-12-31"
      && new Date(DAY+"T12:00:00Z").toISOString().slice(0,10)===DAY,"PLANNING_DATE must be a real date between 2000 and 2100");
    const urls={origin:base.origin,finder:new URL("/find.html",base).href,workspace:new URL("/",base).href};
    report.finder_url=urls.finder;report.workspace_url=urls.workspace;
    report.runner_file="tests/finder_e2e.cjs";
    report.runner_sha256=createHash("sha256").update(await fs.readFile(__filename)).digest("hex");
    await checkpoint(report);
    let playwright;
    try{playwright=require(process.env.PLAYWRIGHT_MODULE||"playwright");}
    catch(error){report.status="blocked";report.blocked_reason="Playwright module unavailable: "+safeError(error);return;}
    try{browser=await playwright.chromium.launch({headless:true,
      ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});}
    catch(error){report.status="blocked";report.blocked_reason="Chromium could not launch: "+safeError(error);return;}
    report.browser_version=browser.version();
    for(const record of report.viewports)await runViewport(browser,urls,record,report);
    report.status=report.viewports.every(v=>v.status==="passed")?"passed":"failed";
  } catch(error) {
    report.status="failed";report.error=safeError(error);
  } finally {
    if(browser)await browser.close();report.finished_at=new Date().toISOString();await checkpoint(report);
    console.log(JSON.stringify(report,null,2));process.exitCode=report.status==="passed"?0:report.status==="blocked"?2:1;
  }
  return report;
}

if(require.main===module)main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
