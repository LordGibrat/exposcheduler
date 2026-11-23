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
const FLOOR_UI_TIMEOUT = 10_000;
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

function safeStack(error) {
  return String(error?.stack || error).replace(/([?&]_vercel_share=)[^&\s]+/g, "$1[redacted]").slice(0, 12000);
}

function progress(id, message) {
  console.log(`[${new Date().toISOString()}] [${id}] ${message}`);
}

function viewportRecord(viewport) {
  return {id:`${viewport.width}x${viewport.height}`,viewport,
    emulation:{reduced_motion:"reduce",touch:viewport.width <= 768,mobile:viewport.width <= 768},
    status:"running",phase:"creating-context",checks:CHECKS.map(name => ({name,status:"not_run"})),
    screenshots:[],page_errors:[],api_requests:[],failures:[]};
}

async function writeReport(report) {
  const checks = report.viewports.flatMap(value => value.checks);
  report.updated_at=new Date().toISOString();
  report.totals={viewports_planned:VIEWPORTS.length,
    viewports_run:report.viewports.filter(value => ["passed","failed"].includes(value.status)).length,
    viewports_in_progress:report.viewports.filter(value => value.status === "running").length,
    checks_passed:checks.filter(value => value.status === "passed").length,
    checks_failed:checks.filter(value => value.status === "failed").length,
    checks_running:checks.filter(value => value.status === "running").length,
    checks_not_run:checks.filter(value => value.status === "not_run").length+(VIEWPORTS.length-report.viewports.length)*CHECKS.length};
  await fs.mkdir(OUTPUT,{recursive:true});
  await fs.writeFile(path.join(OUTPUT,"report.json"),JSON.stringify(report,null,2)+"\n","utf8");
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

async function waitInventory(page, expectedDate) {
  await waitText(page, "#stat-resources", "23");
  await waitCount(page, "#building-stack .floor-layer", 8);
  // Response delivery and the old resource count do not prove that the app has
  // finished applying the requested date. aria-busy is set by updateStats()
  // around loadState's DOM updates, including its finally block.
  await page.waitForFunction(expected => {
    const main = document.querySelector("#main");
    const input = document.querySelector("#planning-date");
    return main?.getAttribute("aria-busy") === "false" && (!expected || input?.value === expected);
  },expectedDate || null,{timeout:TIMEOUT});
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
}

async function waitAttribute(page, selector, attribute, value, timeout=TIMEOUT) {
  await page.waitForFunction(({selector,attribute,value}) => document.querySelector(selector)?.getAttribute(attribute) === value,
    {selector,attribute,value},{timeout});
}

async function startFloorPointerTrace(page) {
  await page.evaluate(() => {
    const key="__expoE2EFloorPointerTrace";
    if (window[key]) throw new Error("A floor pointer trace is already active");
    const types=["pointerdown","pointerup","mousedown","mouseup","click","keydown","keyup"];
    const trace={events:[],dropped_events:0,limit:80,started_at_ms:performance.now(),types};
    const elementInfo=node=>{
      if (!(node instanceof Element)) return null;
      const rect=node.getBoundingClientRect();
      return {tag:node.tagName.toLowerCase(),id:node.id||null,data_floor:node.getAttribute("data-floor"),
        is_connected:node.isConnected,is_active_element:node===document.activeElement,
        bounds:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}};
    };
    trace.listener=event=>{
      if (trace.events.length>=trace.limit) { trace.dropped_events++;return; }
      const target=event.target instanceof Element ? event.target : null;
      trace.events.push({type:event.type,at_ms:performance.now(),is_trusted:event.isTrusted,
        pointer_type:typeof event.pointerType==="string" ? event.pointerType : null,
        key:event.type.startsWith("key") ? event.key : null,button:typeof event.button==="number" ? event.button : null,
        coordinates:typeof event.clientX==="number" ? {client_x:event.clientX,client_y:event.clientY,page_x:event.pageX,page_y:event.pageY} : null,
        scroll_x:window.scrollX,scroll_y:window.scrollY,
        target:elementInfo(target),closest_floor:elementInfo(target?.closest("[data-floor]")),
        active_element:elementInfo(document.activeElement),
        expected_floor_four_button:elementInfo(document.querySelector('#building-stack [data-floor="4"]')),
        composed_path_floors:event.composedPath().filter(node=>node instanceof Element && node.hasAttribute("data-floor"))
          .map(node=>({tag:node.tagName.toLowerCase(),id:node.id||null,data_floor:node.getAttribute("data-floor")}))});
    };
    window[key]=trace;
    for (const type of types) window.addEventListener(type,trace.listener,{capture:true,passive:true});
  });
}

async function stopFloorPointerTrace(page) {
  return page.evaluate(() => {
    const key="__expoE2EFloorPointerTrace",trace=window[key];
    if (!trace) return {events:[],error:"Trace was unavailable during cleanup"};
    try {
      return {events:trace.events,dropped_events:trace.dropped_events,limit:trace.limit,
        started_at_ms:trace.started_at_ms,finished_at_ms:performance.now()};
    } finally {
      for (const type of trace.types) window.removeEventListener(type,trace.listener,true);
      delete window[key];
    }
  });
}

async function setPlanningDate(page) {
  const input = page.locator("#planning-date");
  if (await input.inputValue() === DAY) { await waitInventory(page,DAY);return; }
  const [response] = await Promise.all([
    page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.pathname === "/api/state" && url.searchParams.get("date") === DAY;
    }, {timeout:TIMEOUT}),
    (async () => { await input.fill(DAY);await input.press("Tab"); })(),
  ]);
  const state = await readResponse(response);
  assert.equal(state.date, DAY);
  await waitInventory(page,DAY);
}

async function overflowDiagnostics(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const round = value => Math.round(value*100)/100;
    const selector = el => {
      if (el.id) return "#"+CSS.escape(el.id);
      const parts=[];
      for (let node=el;node && node!==document.body && parts.length<4;node=node.parentElement) {
        if (node.id) { parts.unshift("#"+CSS.escape(node.id));break; }
        const tag=node.tagName.toLowerCase();
        let part=tag+[...node.classList].slice(0,2).map(name=>"."+CSS.escape(name)).join("");
        const siblings=node.parentElement ? [...node.parentElement.children].filter(child=>child.tagName===node.tagName) : [];
        if (siblings.length>1) part+=`:nth-of-type(${siblings.indexOf(node)+1})`;
        parts.unshift(part);
      }
      return parts.join(" > ");
    };
    const bounds = el => {
      const r=el.getBoundingClientRect();
      return {left:round(r.left),right:round(r.right),top:round(r.top),width:round(r.width),height:round(r.height)};
    };
    const describe = el => {
      const s=getComputedStyle(el);
      return {selector:selector(el),bounds:bounds(el),client_width:el.clientWidth,scroll_width:el.scrollWidth,
        style:{display:s.display,position:s.position,width:s.width,min_width:s.minWidth,max_width:s.maxWidth,
          box_sizing:s.boxSizing,overflow_x:s.overflowX,white_space:s.whiteSpace,flex_basis:s.flexBasis,
          flex_shrink:s.flexShrink,grid_columns:s.gridTemplateColumns,transform:s.transform}};
    };
    const offenders=[],excluded=[];
    for (const el of document.querySelectorAll("body *")) {
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      if (!r.width || !r.height || s.display==="none" || s.visibility==="hidden" || (r.left>=-1 && r.right<=viewport+1)) continue;
      let closestScroll=null,containedClip=null;
      for (let parent=el.parentElement;parent && parent!==document.body;parent=parent.parentElement) {
        const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
        const clips=["auto","scroll","hidden","clip"].includes(style.overflowX);
        if (!clips || !parent.clientWidth) continue;
        if (!closestScroll) closestScroll=describe(parent);
        if (box.left>=-1 && box.right<=viewport+1) { containedClip=describe(parent);break; }
      }
      const item={...describe(el),closest_internal_scroll_ancestor:closestScroll};
      if (containedClip) excluded.push({...item,excluded_because:"Clipped by an internal container within the viewport",clipping_ancestor:containedClip});
      else offenders.push({...item,overshoot_px:round(Math.max(0,r.right-viewport,-r.left))});
    }
    offenders.sort((a,b)=>b.overshoot_px-a.overshoot_px);
    return {viewport_width:viewport,unclipped_offender_count:offenders.length,
      offenders:offenders.slice(0,30),excluded_internal_overflow_count:excluded.length,
      excluded_internal_overflow_examples:excluded.slice(0,10)};
  });
}

async function pageFits(page) {
  const result = await page.evaluate(() => ({
    viewport_width:document.documentElement.clientWidth,
    document_width:document.documentElement.scrollWidth,
    body_width:document.body.scrollWidth,
  }));
  if (result.document_width > result.viewport_width+1 || result.body_width > result.viewport_width+1) {
    const error=new Error(`Document/body overflows horizontally: ${JSON.stringify(result)}`);
    error.name="LayoutOverflowError";
    error.diagnostics=await overflowDiagnostics(page);
    throw error;
  }
  return result;
}

async function loadExample(page, label, count) {
  await page.locator("#example-select").selectOption({label});
  await page.locator("#load-example").click();
  await waitCount(page, "#request-queue .request-item", count);
}

async function generatePlan(page) {
  const [response] = await Promise.all([apiResponse(page,"/api/plan"),page.locator("#generate-plan").click()]);
  const result = await readResponse(response);
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

async function runViewport(browser, viewport, record) {
  let context,page;
  async function check(name, action, {critical=true}={}) {
    const item = record.checks.find(value => value.name === name);
    const start = Date.now();
    item.status="running";item.critical=critical;record.phase=`check:${name}`;
    progress(record.id,`START ${name}`);
    try { item.observed = await action(); item.status = "passed"; }
    catch (error) {
      item.status="failed";item.error=safeError(error);item.failure_phase=record.phase;item.failure_stack=safeStack(error);
      if (error.diagnostics) item.diagnostics=error.diagnostics;
      if (page) {
        if (name==="floor-four-and-six-imacs") try {
          item.ui_state=await page.evaluate(()=>({
            planning_date:document.querySelector("#planning-date")?.value,
            workspace_busy:document.querySelector("#main")?.getAttribute("aria-busy"),
            selected_floor:[...document.querySelectorAll('#floor-tabs [aria-pressed="true"]')].map(el=>el.dataset.floor),
            separated_floors:document.querySelector("#explode-building")?.getAttribute("aria-pressed"),
          }));
        } catch (captureError) { item.ui_state_error=safeError(captureError); }
        try { await screenshot(page,record,`${name}-failure`); } catch (captureError) { item.capture_error=safeError(captureError); }
      }
      record.failures.push({check:name,phase:record.phase,error:item.error});
      error.check_name=name;
      if (critical) throw error;
    } finally {
      item.duration_ms=Date.now()-start;
      progress(record.id,`${item.status.toUpperCase()} ${name} (${item.duration_ms} ms)${item.error ? ": "+item.error : ""}`);
    }
  }
  try {
    progress(record.id,"START viewport");
    context=await browser.newContext({viewport,acceptDownloads:true,reducedMotion:"reduce",colorScheme:"light",
      locale:"en-GB",isMobile:viewport.width <= 768,hasTouch:viewport.width <= 768,deviceScaleFactor:1});
    page=await context.newPage();
    page.setDefaultTimeout(TIMEOUT);
    page.on("pageerror",error=>record.page_errors.push(safeError(error)));
    page.on("request",request=>{
      const url=new URL(request.url());
      if (url.origin===BASE.origin && url.pathname.startsWith("/api/"))
        record.api_requests.push({method:request.method(),path:url.pathname});
    });
    record.phase="initial-navigation-and-inventory";
    const [initialState]=await Promise.all([
      page.waitForResponse(r=>new URL(r.url()).pathname==="/api/state",{timeout:TIMEOUT}),
      page.goto(BASE.href,{waitUntil:"domcontentloaded",timeout:TIMEOUT}),
    ]);
    const remote=await readResponse(initialState);
    record.style_snapshot=await page.evaluate(()=>{
      const sample=selector=>{
        const element=document.querySelector(selector);
        if(!element)return null;
        const style=getComputedStyle(element),rect=element.getBoundingClientRect();
        return {width:style.width,height:style.height,left:style.left,top:style.top,
          transform:style.transform,scale:style.scale,
          bounds:{left:rect.left,right:rect.right,width:rect.width}};
      };
      return {workspace_busy:document.querySelector("#main")?.getAttribute("aria-busy"),
        stack:sample("#building-stack"),scene:sample("#building-scene"),orbit:sample(".scene-orbit.orbit-two")};
    });
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
    },{critical:false});
    await check("initial-horizontal-fit", () => pageFits(page),{critical:false});
    await screenshot(page,record,"initial");
    record.phase="planning-date-ui-readiness";
    await setPlanningDate(page);

    await check("floor-four-and-six-imacs", async () => {
      const item=record.checks.find(value=>value.name==="floor-four-and-six-imacs");
      try {
        await startFloorPointerTrace(page);
        record.phase="floor-ui:select-floor-four";
        await page.locator('#building-stack [data-floor="4"]').click();
        await waitAttribute(page,'#floor-tabs [data-floor="4"]',"aria-pressed","true",FLOOR_UI_TIMEOUT);
        await waitAttribute(page,'#building-stack [data-floor="4"]',"aria-pressed","true",FLOOR_UI_TIMEOUT);
        // Keyboard activation is an additional assertion after the physical
        // pointer selection succeeds. It is never a fallback for a failed click.
        record.phase="floor-ui:keyboard-enter-floor-three";
        await page.locator('#building-stack [data-floor="3"]').press("Enter");
        await waitAttribute(page,'#floor-tabs [data-floor="3"]',"aria-pressed","true",FLOOR_UI_TIMEOUT);
        await waitAttribute(page,'#building-stack [data-floor="3"]',"aria-pressed","true",FLOOR_UI_TIMEOUT);
        record.phase="floor-ui:keyboard-space-floor-four";
        await page.locator('#building-stack [data-floor="4"]').press("Space");
        await waitAttribute(page,'#floor-tabs [data-floor="4"]',"aria-pressed","true",FLOOR_UI_TIMEOUT);
        await waitAttribute(page,'#building-stack [data-floor="4"]',"aria-pressed","true",FLOOR_UI_TIMEOUT);
        record.phase="floor-ui:separate-floors";
        await page.locator("#explode-building").click();
        await waitAttribute(page,"#explode-building","aria-pressed","true",FLOOR_UI_TIMEOUT);
        record.phase="floor-ui:filter-six-imacs";
        await page.locator("#resource-kind").selectOption("imac");
        await waitCount(page,'#resource-cards .resource-card[data-kind="imac"]',6);
        assert.equal(await page.locator("#resource-cards .resource-card").count(),6);
        return {selected_floor:4,imacs:6,exploded:true,keyboard_enter_floor:3,keyboard_space_floor:4};
      } finally {
        try { item.pointer_trace=await stopFloorPointerTrace(page); }
        catch (error) { item.pointer_trace_error=safeError(error); }
      }
    },{critical:false});
    await check("timeline-contained-overflow", async () => {
      await page.locator('#floor-tabs [data-floor="all"]').click();
      await page.locator("#resource-kind").selectOption("all");
      await page.locator("#view-timeline").click();
      try {
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
        return observed;
      } finally { await page.locator("#view-cards").click(); }
    },{critical:false});

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
    },{critical:false});
    await check("planned-horizontal-fit", () => pageFits(page),{critical:false});
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
      const [download]=await Promise.all([
        page.waitForEvent("download",{timeout:TIMEOUT}),page.locator("#export-calendar").click(),
      ]);
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
    },{critical:false});
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
      const [response]=await Promise.all([
        apiResponse(page,"/api/decision",r=>JSON.parse(r.postData()||"{}").horizon===1),
        page.locator("#evaluate-decision").click(),
      ]);
      const result=await readResponse(response);
      assert.equal(result.values.inspect,null);
      assert.equal(result.values.wait,null);
      await page.waitForFunction(() => [...document.querySelectorAll("#decision-result .action-value strong")].filter(el => el.textContent === "N/A").length === 2);
      const values = await page.locator("#decision-result .action-value").evaluateAll(rows =>
        Object.fromEntries(rows.map(row => [row.querySelector("span").textContent,row.querySelector("strong").textContent])));
      assert.equal(values.Inspect,"N/A");assert.equal(values.Wait,"N/A");
      return {horizon:1,inspect:values.Inspect,wait:values.Wait};
    },{critical:false});
    await check("hmm-three-report-forecast", async () => {
      await page.locator("#hmm-reports").fill("free, busy, free");
      const [response]=await Promise.all([apiResponse(page,"/api/occupancy"),page.locator("#evaluate-occupancy").click()]);
      const result=await readResponse(response);
      assert.equal(result.trace.length,3);
      assert(result.predictive_next >= 0 && result.predictive_next <= 1);
      await waitCount(page,"#occupancy-result .hmm-step",3);
      return {reports:3,predictive_next:result.predictive_next};
    },{critical:false});
    await check("apply-hmm-sequence-to-resource", async () => {
      await page.locator("#forecast-resource").selectOption("F4-IM01");
      await page.locator("#apply-forecast").click();
      const report = page.locator('#resource-cards select[data-report="F4-IM01"]');
      assert.equal(await report.inputValue(),"sequence");
      assert.match(await report.locator("option:checked").innerText(),/3-report sequence/);
      assert.equal(await storedBookingCount(page),0);
      return {resource_id:"F4-IM01",report_count:3,reservations_created:0};
    },{critical:false});
    await check("impossible-request-stays-unassigned", async () => {
      await loadExample(page,"Explain an impossible request",1);
      const result = await generatePlan(page);
      assert.equal(result.assignments.length,0);assert.equal(result.unassigned.length,1);
      assert.equal(await page.locator("#commit-plan").isDisabled(),true);
      assert.equal(await page.locator("#plan-results .unassigned-box").count(),1);
      return {assignments:0,unassigned:1,commit_disabled:true};
    },{critical:false});
    await check("invalid-time-ui-error", async () => {
      if (await page.locator("#clear-queue").isEnabled()) await page.locator("#clear-queue").click();
      await waitCount(page,"#request-queue .request-item",0);
      await page.locator("#request-title").fill("Invalid time window");
      await page.locator("#request-earliest").fill("13:00");
      await page.locator("#request-latest").fill("12:00");
      await page.locator("#request-duration").selectOption("60");
      await page.locator("#add-request").click();
      await page.locator("#request-error").waitFor({state:"visible"});
      assert.match(await page.locator("#request-error").innerText(),/half-hour|full duration/i);
      assert.equal(await page.locator("#request-queue .request-item").count(),0);
      return {invalid_request_added:false,visible_error:true};
    },{critical:false});
    await check("long-title-horizontal-fit", async () => {
      if (await page.locator("#clear-queue").isEnabled()) await page.locator("#clear-queue").click();
      await waitCount(page,"#request-queue .request-item",0);
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
    },{critical:false});
    await check("no-uncaught-page-errors", async () => {
      assert.deepEqual(record.page_errors,[]);
      return {uncaught_errors:0};
    });
    record.status=record.checks.some(item=>item.status==="failed") ? "failed" : "passed";
    if (record.status==="failed") {
      const first=record.checks.find(item=>item.status==="failed");
      record.error=first.error;record.failure_phase=first.failure_phase;record.failure_stack=first.failure_stack;
    }
    record.phase="completed";
  } catch (error) {
    record.status="failed";record.error=safeError(error);record.failure_phase=record.phase;record.failure_stack=safeStack(error);
    if (!error.check_name) record.failures.push({check:null,phase:record.phase,error:record.error});
    if (page) try { await screenshot(page,record,"failure"); } catch (captureError) { record.capture_error=safeError(captureError); }
  } finally {
    if (context) try { await context.close(); } catch (error) {
      record.status="failed";record.cleanup_error=safeError(error);
      record.failures.push({check:null,phase:"closing-context",error:record.cleanup_error});
    }
    progress(record.id,`END viewport: ${record.status.toUpperCase()}`);
  }
  return record;
}

async function main() {
  const report = {kind:"actual-playwright-browser-run",runner_revision:"2026-11-21-responsive-3",started_at:new Date().toISOString(),
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
    report.execution_phase="loading-playwright";
    progress("runner",`Report: ${path.join(OUTPUT,"report.json")}`);
    await writeReport(report);
    let playwright;
    try { playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright"); }
    catch (error) { report.status="blocked";report.blocked_reason="Playwright module unavailable: "+safeError(error);return report; }
    try {
      report.execution_phase="launching-chromium";
      browser = await playwright.chromium.launch({headless:true,
        ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
    } catch (error) {
      report.status="blocked";report.blocked_reason="Chromium could not launch: "+safeError(error);return report;
    }
    report.browser_version = browser.version();
    for (const viewport of VIEWPORTS) {
      const record=viewportRecord(viewport);
      report.viewports.push(record);report.current_viewport=record.id;report.execution_phase="viewport-checks";
      await writeReport(report);
      await runViewport(browser,viewport,record);
      report.current_viewport=null;
      await writeReport(report);
    }
    report.status = report.viewports.every(item => item.status === "passed") ? "passed" : "failed";
    report.execution_phase="completed";
    return report;
  } catch (error) {
    report.status="failed";report.error=safeError(error);report.failure_phase=report.execution_phase;report.failure_stack=safeStack(error);
    return report;
  } finally {
    if (browser) try { await browser.close(); } catch (error) {
      report.status="failed";report.cleanup_error=safeError(error);
    }
    report.finished_at=new Date().toISOString();
    await writeReport(report);
    progress("runner",`FINISHED ${report.status.toUpperCase()}`);
    console.log(JSON.stringify({status:report.status,totals:report.totals,report:path.join(OUTPUT,"report.json")},null,2));
    process.exitCode=report.status==="passed"?0:report.status==="blocked"?2:1;
  }
}

if (require.main === module) main().catch(error => { console.error(safeError(error));process.exitCode=1; });
