/*
 * Presentation/controller unit tests in Node's VM. This is NOT a browser test.
 * The lightweight DOM checks app wiring, generated markup, state, and API calls.
 * It cannot validate rendering, CSS, actual layout, native form constraints,
 * keyboard/pointer behavior, browser accessibility, or network integration.
 * Resources/scenarios are real project JSON. API replies below are explicitly
 * presentation-only fixtures; they do not establish algorithm performance.
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
const script = fs.readFileSync(path.join(ROOT, "static/app.js"), "utf8");
const transportScript = fs.readFileSync(path.join(ROOT, "static/browser-storage.js"), "utf8");
const resources = JSON.parse(fs.readFileSync(path.join(ROOT, "data/resources.json"), "utf8"));
const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, "data/scenarios.json"), "utf8"));
const floors = JSON.parse(fs.readFileSync(path.join(ROOT, "data/floors.json"), "utf8"));
const copy = value => JSON.parse(JSON.stringify(value));
const decode = text => String(text).replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function attributes(source) {
  const answer = {};
  for (const m of source.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    answer[m[1]] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return answer;
}

class Classes {
  constructor(initial = "") { this.values = new Set(initial.split(/\s+/).filter(Boolean)); }
  toggle(name, force) {
    const add = force === undefined ? !this.values.has(name) : Boolean(force);
    if (add) this.values.add(name); else this.values.delete(name);
    return add;
  }
  add(...names) { names.forEach(n => this.values.add(n)); }
  remove(...names) { names.forEach(n => this.values.delete(n)); }
  contains(name) { return this.values.has(name); }
}

function makeDocument() {
  const elements = new Map();
  const all = [];
  const lookupMisses = [];
  class Element {
    constructor(tag, attrs = {}) {
      this.tagName = tag.toUpperCase(); this.attributes = {...attrs}; this.id = attrs.id || "";
      this.dataset = {}; this.value = attrs.value || ""; this.checked = "checked" in attrs;
      this.disabled = "disabled" in attrs; this.hidden = "hidden" in attrs; this.children = [];
      this.classList = new Classes(attrs.class); this.listeners = new Map(); this._html = "";
      this.textContent = ""; this.style = {setProperty() {}};
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith("data-")) {
        this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
      all.push(this); if (this.id) elements.set(this.id, this);
    }
    set innerHTML(value) {
      this._html = String(value);
      // Register generated IDs such as commit-plan. This is not a full HTML DOM.
      this.children = parse(this._html);
      if (this.tagName === "SELECT") this.value = selectValue(this._html);
    }
    get innerHTML() { return this._html; }
    addEventListener(name, fn) {
      const handlers = this.listeners.get(name) || []; handlers.push(fn); this.listeners.set(name, handlers);
    }
    async fire(name, values = {}) {
      const event = {target:this, preventDefault() {}, ...values};
      for (const fn of this.listeners.get(name) || []) await fn(event);
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    focus() { this.focused = true; }
    scrollIntoView() { this.scrolled = true; }
    getBoundingClientRect() { return {left:0,top:0,width:300,height:400}; }
    closest(selector) {
      const key = selector.match(/^\[data-([^\]]+)\]$/)?.[1]?.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return key && Object.hasOwn(this.dataset, key) ? this : null;
    }
  }
  function selectValue(source) {
    const options = [...source.matchAll(/<option\b([^>]*)>/g)].map(m => attributes(m[1]));
    const selected = options.find(o => "selected" in o) || options[0];
    return selected?.value ?? "";
  }
  function parse(source) {
    const created = [];
    for (const m of source.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
      const attrs = attributes(m[2]);
      if (!attrs.id && m[1] !== "input") continue;
      const element = new Element(m[1], attrs); created.push(element);
      if (element.tagName === "SELECT") {
        const tail = source.slice(m.index + m[0].length);
        element.value = selectValue(tail.slice(0, tail.indexOf("</select>")));
      }
    }
    return created;
  }
  parse(html);
  return {elements, lookupMisses, Element,
    getElementById(id) {
      if (!elements.has(id)) lookupMisses.push(id);
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="feature"]:checked') return all.filter(e => e.tagName === "INPUT" && e.attributes.name === "feature" && e.checked);
      if (selector === ".nav-link") return all.filter(e => e.classList.contains("nav-link"));
      if (selector === "section.section") return all.filter(e => e.tagName === "SECTION" && e.classList.contains("section"));
      throw new Error(`Mock selector not implemented: ${selector}`);
    }};
}

function planFixture(requests, date, id = "fixture-plan") {
  const resource = resources.find(r => r.kind === "study_room");
  return {plan_id:id,date,method:"hill",seed:42,score:223.5,baseline_score:210,
    assignments:[{request_id:requests[0].id,resource_id:resource.id,start:600,end:660,
      score:223.5,belief:.75,route:{path:["F2 lobby","Resource door"],cost:1,expanded:1},
      explanation:"Presentation fixture only. Not an algorithm result."}],
    baseline_assignments:[{request_id:requests[0].id,resource_id:resource.id,start:630,end:690}],
    unassigned:[],trace:[210,223.5],diagnostics:{optimal:false},simulation:true};
}

async function settle() {
  // Drain pending fetch/json and startup .then callbacks without timer sleeps.
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
}

async function boot() {
  const document = makeDocument(); const calls = []; const bookings = []; const failures = new Map();
  const decisions = {horizon:3,action:"inspect",values:{book:2.8,inspect:3.9,wait:2.3,leave:0},
    explanation:"Presentation fixture only.",model:"Finite-horizon belief-state POMDP"};
  const forecast = {predictive_next:.62,posterior:.6,trace:[{step:1,report:"free",posterior:.8}],model:"Specified HMM fixture"};
  const context = vm.createContext({document,window:{},console,structuredClone,Date,encodeURIComponent,URL,TextEncoder,Blob,setTimeout,clearTimeout,
    matchMedia:() => ({matches:true}),
    fetch:async (url, options) => {
      const payload = options.body ? JSON.parse(options.body) : undefined;
      const call = {url,method:options.method,payload}; calls.push(call);
      const key = String(url).split("?")[0];
      if (failures.has(key)) {
        const message = failures.get(key); failures.delete(key);
        return {ok:false,status:409,json:async () => ({error:message})};
      }
      let answer;
      if (key === "/api/state") answer = {resources,bookings,scenarios,floors,simulation:true};
      else if (key === "/api/plan") answer = planFixture(payload.requests,payload.date);
      else if (key === "/api/bookings") { const r = resources.find(r => r.kind === "study_room"); bookings.push({id:"fixture-booking",resource_id:r.id,date:"2026-12-01",start:600,end:660,title:'A "quoted" <test>'}); answer = {bookings,simulation:true}; }
      else if (key === "/api/decision") answer = {...decisions,horizon:payload.horizon};
      else if (key === "/api/occupancy") answer = forecast;
      else if (key.startsWith("/api/bookings/") && options.method === "DELETE") {bookings.length=0;answer={success:true};}
      else throw new Error(`Unexpected fixture endpoint ${key}`);
      return {ok:true,status:200,json:async () => copy(answer)};
    }});
  vm.runInContext(transportScript, context, {filename:"static/browser-storage.js"});
  vm.runInContext(script, context, {filename:"static/app.js"}); await settle();
  return {context,document,calls,bookings,failures,decisions,forecast,
    element:id => document.elements.get(id),
    run:expression => vm.runInContext(expression,context),
    read:expression => copy(vm.runInContext(expression,context))};
}

test("initialization uses actual HTML IDs and loads inventory, controls and labs", async () => {
  const app = await boot();
  assert.deepEqual(app.document.lookupMisses,[]);
  assert.equal(app.read("state.resources.length"), resources.length);
  assert.equal(Number(app.element("stat-resources").textContent),resources.length);
  assert.equal(app.element("main").getAttribute("aria-busy"),"false");
  let releaseState;
  const originalFetch=app.context.fetch;
  app.context.fetch=async (...args)=>{
    if(String(args[0]).startsWith("/api/state"))await new Promise(resolve=>{releaseState=resolve;});
    return originalFetch(...args);
  };
  const pendingState=app.run("loadState(false)");
  assert.equal(app.element("main").getAttribute("aria-busy"),"true");
  assert.equal(typeof releaseState,"function");
  releaseState();await pendingState;
  assert.equal(app.element("main").getAttribute("aria-busy"),"false");
  assert.equal((app.element("building-stack").innerHTML.match(/class="floor-layer/g)||[]).length,8);
  assert.match(app.element("request-floor").innerHTML,/value="8"/);
  assert.ok(app.calls.some(c=>c.url.startsWith("/api/state?date=")));
  assert.ok(app.calls.some(c=>c.url==="/api/decision"));
  assert.ok(app.calls.some(c=>c.url==="/api/occupancy"));
  assert.equal(app.element("generate-plan").disabled,true);
});

test("floor, resource type and text filters combine without affecting inventory", async () => {
  const app = await boot(); await app.run('chooseFloor("4")');
  assert.equal(app.read("state.floor"),4);
  assert.equal(app.read("filteredResources().length"),resources.filter(r=>r.floor===4).length);
  app.element("resource-kind").value="imac"; app.run("renderResources()");
  assert.equal(app.read("filteredResources().length"),6);
  app.element("resource-search").value="iMac 02"; app.run("renderResources()");
  assert.equal(app.read("filteredResources().length"),1);
  assert.match(app.element("building-caption").textContent,/Floor 4/);
  app.element("resource-search").value="no-match-expected"; app.run("renderResources()");
  assert.match(app.element("resource-cards").innerHTML,/No resources match/);
  assert.equal(app.read("state.resources.length"),resources.length);
});

test("examples clone real scenarios and request form validates the time window", async () => {
  const app = await boot(); app.run("exampleScenario(1)");
  assert.deepEqual(app.read("state.queue"),scenarios[1].requests);
  app.run('state.queue[0].title="Edited copy"');
  assert.notEqual(app.read("state.scenarios[1].requests[0].title"),"Edited copy");
  app.element("request-title").value="Form session";
  app.element("request-earliest").value="10:15";
  await app.element("request-form").fire("submit");
  assert.match(app.element("request-error").textContent,/half-hour/);
  assert.equal(app.read("state.queue.length"),scenarios[1].requests.length);
  app.element("request-earliest").value="10:00";
  await app.element("request-form").fire("submit");
  assert.equal(app.read("state.queue.length"),scenarios[1].requests.length+1);
  assert.equal(app.read("state.queue.at(-1).title"),"Form session");
});

test("planner sends documented payload and reservation sends only issued plan_id", async () => {
  const app = await boot(); app.run("exampleScenario(0)"); await app.run("generatePlan()");
  const planned=app.calls.filter(c=>c.url==="/api/plan").at(-1);
  assert.deepEqual(Object.keys(planned.payload).sort(),["assumptions","date","method","reports","requests","seed"]);
  assert.deepEqual(planned.payload.requests,scenarios[0].requests);
  assert.deepEqual(planned.payload.reports,scenarios[0].reports);
  assert.equal(app.element("commit-plan").disabled,false);
  await app.run("commitPlan()");
  const committed=app.calls.filter(c=>c.url==="/api/bookings").at(-1);
  assert.deepEqual(committed.payload,{plan_id:"fixture-plan"});
  assert.equal(app.read("state.plan.committed"),true);
  assert.equal(app.element("commit-plan").disabled,true);
  assert.match(app.element("global-message").textContent,/No university facilities/);
  assert.equal(app.read("state.bookings.length"),1);
});

test("changed probability inputs invalidate a plan and prevent stale reservation", async () => {
  const app = await boot(); app.run("exampleScenario(0)"); await app.run("generatePlan()");
  app.element("lab-sensitivity").value="0.70";
  await app.element("lab-sensitivity").fire("input");
  assert.equal(app.read("state.plan.stale"),true);
  assert.equal(app.element("commit-plan").disabled,true);
  await app.run("commitPlan()");
  assert.equal(app.calls.filter(c=>c.url==="/api/bookings").length,0);
  assert.match(app.element("plan-results").innerHTML,/Generate a fresh plan/);
});

test("request changes during asynchronous search mark its result stale", async () => {
  const app=await boot(); app.run("exampleScenario(0)");
  let release; const oldFetch=app.context.fetch;
  app.context.fetch=async (...args)=>{if(args[0]==="/api/plan")await new Promise(r=>{release=r;});return oldFetch(...args);};
  const pending=app.run("generatePlan()");
  assert.equal(typeof release,"function");
  app.run('state.queue[0].title="Edited during search"'); release(); await pending;
  assert.equal(app.read("state.plan.stale"),true);
  assert.equal(app.element("commit-plan").disabled,true);
  assert.equal(app.read("state.planning"),false);
});

test("quoted user titles stay escaped in queue, plan, reservation and timeline markup", async () => {
  const app=await boot(); app.run("exampleScenario(0)");
  const title='Quote " autofocus onfocus="test <img src=x> & end';
  app.context.testTitle=title; app.run("state.queue[0].title=testTitle; renderQueue()");
  await app.run("generatePlan()");
  app.bookings.push({id:"quoted-id",resource_id:resources.find(r=>r.kind==="study_room").id,
    date:"2026-12-01",start:600,end:660,title});
  await app.run("loadState(false)");
  for(const id of ["request-queue","plan-results","reservation-list","resource-timeline"]){
    const markup=app.element(id).innerHTML;
    assert.ok(!markup.includes(title),`${id} must not interpolate raw input`);
    assert.match(markup,/&quot;/,id); assert.match(markup,/&lt;img/,id);
    assert.ok(!markup.includes("<img src=x>"),id);
  }
  assert.match(app.element("resource-timeline").innerHTML,/aria-label="[^"]*&quot; autofocus onfocus=&quot;test &lt;img/);
});

test("horizon-one null inspect/wait values render as N/A, with no action executed", async () => {
  const app=await boot(); const beforeBookings=app.calls.filter(c=>c.url==="/api/bookings").length;
  app.decisions.values={book:2.8,inspect:null,wait:null,leave:0}; app.decisions.action="book";
  app.element("lab-horizon").value="1"; await app.run("evaluateDecision()");
  assert.equal((app.element("decision-result").innerHTML.match(/N\/A/g)||[]).length,2);
  assert.equal(app.calls.filter(c=>c.url==="/api/bookings").length,beforeBookings);
  assert.equal(app.calls.filter(c=>c.url==="/api/decision").at(-1).payload.horizon,1);
  assert.match(app.element("decision-result").innerHTML,/does not execute any action/);
});

test("search, reservation and lab errors restore controls and show visible messages", async () => {
  const app=await boot(); app.run("exampleScenario(0)");
  app.failures.set("/api/plan","Synthetic test search failure"); await app.run("generatePlan()");
  assert.equal(app.read("state.planning"),false); assert.equal(app.element("generate-plan").disabled,false);
  assert.match(app.element("plan-error").textContent,/Synthetic test search failure/);
  assert.equal(app.element("plan-error").hidden,false);
  await app.run("generatePlan()"); app.failures.set("/api/bookings","Synthetic stale-plan conflict");
  await app.run("commitPlan()"); assert.equal(app.read("state.committing"),false);
  assert.equal(app.read("state.plan.stale"),true);
  assert.match(app.element("global-message").textContent,/Synthetic stale-plan conflict/);
  app.failures.set("/api/decision","Synthetic decision error"); await app.run("evaluateDecision()");
  assert.equal(app.element("evaluate-decision").disabled,false);
  assert.equal(app.element("decision-error").hidden,false);
  app.element("hmm-reports").value="bad-report"; await app.run("evaluateOccupancy()");
  assert.equal(app.element("evaluate-occupancy").disabled,false);
  assert.match(app.element("occupancy-error").textContent,/free, busy or unknown/);
});

test("HMM sequence is validated, passed to planner, and creates no booking", async () => {
  const app=await boot(); app.run("exampleScenario(0)"); await app.run("generatePlan()");
  const resource=resources.find(r=>r.kind==="imac");
  app.element("forecast-resource").value=resource.id;
  app.element("hmm-reports").value="free, UNKNOWN, busy";
  await app.run("evaluateOccupancy()");
  assert.deepEqual(app.calls.filter(c=>c.url==="/api/occupancy").at(-1).payload.reports,["free","unknown","busy"]);
  app.run("applyForecast()");
  assert.deepEqual(app.read(`state.reports[${JSON.stringify(resource.id)}]`),["free","unknown","busy"]);
  assert.equal(app.read("state.plan.stale"),true);
  assert.equal(app.calls.filter(c=>c.url==="/api/bookings").length,0);
  assert.match(app.element("global-message").textContent,/Custom lab prior and transitions are not copied/);
  await app.run("generatePlan()");
  assert.deepEqual(app.calls.filter(c=>c.url==="/api/plan").at(-1).payload.reports[resource.id],["free","unknown","busy"]);
});

test("simulation cancellation uses DELETE and calendar export tracks selected date", async () => {
  const app=await boot(); app.run("exampleScenario(0)"); await app.run("generatePlan()"); await app.run("commitPlan()");
  const button=new app.document.Element("button",{"data-cancel":"fixture-booking"});
  await app.run("Promise.resolve()");
  app.context.cancelButton=button; await app.run("cancelBooking(cancelButton)");
  assert.equal(app.calls.at(-2).method,"DELETE");
  assert.equal(app.read("state.bookings.length"),0);
  assert.equal(app.element("export-calendar").href,`/api/export?date=${app.element("planning-date").value}`);
  assert.match(app.element("global-message").textContent,/No university booking was affected/);
});
