/*
 * Node controller tests for the simple finder. API replies are presentation
 * fixtures, not algorithm measurements. The small DOM below verifies wiring,
 * payloads, state transitions and escaping; it cannot verify CSS or real input
 * accessibility. tests/finder_e2e.cjs is the separate actual-browser runner.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {buildPayload,validDate,parseTime,esc,resultMarkup,createFinder} = require("../static/find.js");
const resources = JSON.parse(fs.readFileSync(path.join(__dirname,"../data/resources.json"),"utf8"));
const initial = () => ({date:"2026-12-01",kind:"study_room",start:"10:00",duration:"60",people:"4",floor:"4",features:[],title:"Study session",accessible:false});
const clone = value => JSON.parse(JSON.stringify(value));
const attrs = source => Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1],m[2] || ""]));

function documentFixture() {
  const html = fs.readFileSync(path.join(__dirname,"../static/find.html"),"utf8"), elements = new Map(), inputs = [], misses = [];
  class Element {
    constructor(tag,a) { this.id=a.id; this.tagName=tag.toUpperCase();this.value=a.value||"";this.attributes=a;this.dataset={};this.checked=Object.hasOwn(a,"checked");this.disabled=Object.hasOwn(a,"disabled");this.hidden=Object.hasOwn(a,"hidden");this.listeners={};this._html="";this.textContent=""; }
    set innerHTML(value) { this._html=String(value); parse(this._html); }
    get innerHTML() { return this._html; }
    setAttribute(name,value) { this.attributes[name]=String(value); }
    focus() { this.focused=true; }
    addEventListener(name,fn) { (this.listeners[name] ||= []).push(fn); }
    async fire(name,extra={}) { for (const fn of this.listeners[name]||[]) await fn({target:this,preventDefault(){},...extra}); }
    closest(selector) { return selector === "#find-choose" && this.id === "find-choose" ? this : selector === "[data-cancel-id]" && this.dataset.cancelId ? this : null; }
  }
  function parse(source) {
    for (const m of source.matchAll(/<([\w-]+)\b([^>]*)>/g)) {
      const a=attrs(m[2]); if (!a.id && !(m[1]==="input" && a.name==="feature")) continue;
      const node=new Element(m[1],a);
      if (node.tagName === "SELECT") {
        const tail=source.slice(m.index+m[0].length).split("</select>")[0];
        const options=[...tail.matchAll(/<option\b([^>]*)>/g)].map(n=>attrs(n[1]));
        node.value=(options.find(o=>Object.hasOwn(o,"selected"))||options[0]||{}).value||"";
      }
      if (a.id) elements.set(a.id,node); if (a.name==="feature") inputs.push(node);
    }
  }
  parse(html);
  return {elements,misses,getElementById(id){if (!elements.has(id)) misses.push(id);return elements.get(id)||null;},querySelectorAll(selector){assert.equal(selector,'input[name="feature"]:checked');return inputs.filter(x=>x.checked);}};
}
function planFixture(request,date) {
  const resource=resources.find(r=>r.kind === request.kind && r.capacity >= request.group_size) || resources.find(r=>r.kind==="study_room");
  return {plan_id:"fixture-plan",date,method:"hill",score:220,baseline_score:215,
    diagnostics:{candidate_counts:{[request.id]:3},restarts:5},assignments:[{request_id:request.id,resource_id:resource.id,start:request.earliest,end:request.latest,belief:resource.prior,score:220,
      route:{path:[`F${request.preferred_floor} lobby`,"Resource door"],cost:2.8},explanation:"Presentation fixture, not algorithm evidence.",
      decision_advice:{action:"inspect",horizon:3,values:{book:2,inspect:3,wait:1,leave:0}}}],unassigned:[]};
}
async function boot() {
  const document=documentFixture(),calls=[],bookings=[],failures=new Map(),gates=new Map();
  const transport={mode:"browser",coordinatedTabs:true,async request(url,payload,method="POST") {
    calls.push({url,payload:clone(payload??null),method});const key=url.split("?")[0];
    if (gates.has(key)) await gates.get(key);
    if (failures.has(key)) {const error=failures.get(key);failures.delete(key);throw new Error(error);}
    if (key==="/api/state") return {resources:clone(resources),bookings:clone(bookings),storage_mode:"browser",storage_available:true};
    if (key==="/api/plan") return planFixture(payload.requests[0],payload.date);
    if (key==="/api/bookings") {const request=app.state.input.requests[0],assignment=app.state.plan.assignments[0];const saved={id:"fixture-booking",resource_id:assignment.resource_id,date:app.state.input.date,start:assignment.start,end:assignment.end,title:request.title};bookings.push(saved);return {bookings:[clone(saved)]};}
    if (key.startsWith("/api/bookings/") && method==="DELETE") {const index=bookings.findIndex(b=>b.id===decodeURIComponent(key.split("/").at(-1)));if(index>=0)bookings.splice(index,1);return {success:true};}
    throw new Error("Unexpected fixture endpoint "+url);
  }};
  const app=createFinder({document,transport});await app.start();
  const element=id=>document.elements.get(id);
  const fill=(changes={})=>{const v={...initial(),...changes};for(const [key,id]of Object.entries({date:"find-date",kind:"find-kind",start:"find-start",duration:"find-duration",people:"find-people",floor:"find-floor",title:"find-title"}))if(element(id))element(id).value=v[key];element("find-accessible").checked=v.accessible;};
  fill(); return {app,document,calls,bookings,failures,gates,transport,element,fill};
}
function deferred() { let release; const promise=new Promise(resolve=>{release=resolve;});return {promise,release}; }

test("simple search produces one exact-window request using the existing hill method",()=>{
  const payload=buildPayload(initial());assert.equal(payload.method,"hill");assert.equal(payload.seed,42);
  assert.deepEqual(payload.reports,{});assert.deepEqual(payload.assumptions,{sensitivity:.85,false_positive:.15});
  assert.equal(payload.requests.length,1);const r=payload.requests[0];assert.equal(r.earliest,600);assert.equal(r.latest,660);assert.equal(r.duration,60);assert.equal(r.priority,2);
});
test("calendar validation handles leap dates, invalid dates and supported years",()=>{
  assert.ok(validDate("2028-02-29"));for(const date of ["2026-02-29","2026-02-30","2026-2-01","1999-12-31","2101-01-01","<script>",""])assert.equal(validDate(date),false,date);
  assert.ok(Number.isNaN(parseTime("24:00")));assert.ok(Number.isNaN(parseTime("10:60")));
});
test("opening and closing half-hour boundaries are valid but overflow is rejected",()=>{
  assert.equal(buildPayload({...initial(),start:"08:00",duration:"30"}).requests[0].earliest,480);
  assert.equal(buildPayload({...initial(),start:"19:30",duration:"30"}).requests[0].latest,1200);
  for(const changes of [{start:"07:30"},{start:"19:30"},{start:"10:15"},{start:"20:00",duration:"30"},{start:"10:00:00"},{duration:"45"}])assert.throws(()=>buildPayload({...initial(),...changes}),/half-hour/);
});
test("people, kind, equipment, floor and title inputs are validated explicitly",()=>{
  for(const changes of [{people:"0"},{people:"201"},{people:"4.5"},{people:""},{kind:"__proto__"},{kind:"bad"},{floor:"9"},{features:["unknown"]},{title:"X".repeat(101)},{title:"line\nline"}])assert.throws(()=>buildPayload({...initial(),...changes}));
  assert.equal(buildPayload({...initial(),people:"200"}).requests[0].group_size,200);
  assert.equal(buildPayload({...initial(),title:""}).requests[0].title,"Study room session");
  assert.throws(()=>buildPayload({...initial(),kind:"imac"}),/one person/);
  assert.equal(buildPayload({...initial(),kind:"imac",people:"1"}).requests[0].group_size,1);
});
test("generated results escape text and distinguish active AI from inactive histories",()=>{
  const payload=buildPayload(initial()),plan=planFixture(payload.requests[0],payload.date),r={...resources.find(r=>r.id===plan.assignments[0].resource_id),name:'<img src=x onerror="bad">'};
  plan.assignments[0].explanation='<script>alert("x")</script>';
  const markup=resultMarkup(plan,payload.requests[0],r,payload.date);
  assert.doesNotMatch(markup,/<img|<script>/);assert.match(markup,/&lt;img/);assert.match(markup,/Prior retained \(no report\)/);assert.match(markup,/No noisy-observation update/);assert.match(markup,/Not active for this search/);assert.match(markup,/separate occupancy advisory/);assert.match(markup,/assumed utility units vs first-fit/);assert.equal((markup.match(/class="ai-proof"/g)||[]).length,6);
  assert.equal(esc('"<&'),'&quot;&lt;&amp;');
});
test("startup wires the actual page IDs and loads the shared sample inventory",async()=>{
  const f=await boot();assert.deepEqual(f.document.misses,[]);assert.equal(f.app.state.resources.length,resources.length);assert.equal(f.element("find-submit").disabled,false);assert.equal(f.element("find-confirm").disabled,true);assert.match(f.element("finder-storage-note").textContent,/in this browser/);
});
test("search refreshes state then plans once and confirms only the issued plan ID",async()=>{
  const f=await boot();await f.app.search();assert.equal(f.element("find-results").dataset.phase,"ready");assert.equal(f.calls.at(-2).method,"GET");assert.equal(f.calls.at(-1).url,"/api/plan");
  f.app.choose();assert.equal(f.element("find-review").hidden,false);await f.app.confirm();
  const writes=f.calls.filter(c=>c.url==="/api/bookings");assert.equal(writes.length,1);assert.deepEqual(writes[0].payload,{plan_id:"fixture-plan"});assert.equal(f.element("find-results").dataset.phase,"saved");assert.match(f.element("find-results").innerHTML,/No real campus booking/);assert.equal(f.bookings.length,1);
  await f.app.confirm();assert.equal(f.calls.filter(c=>c.url==="/api/bookings").length,1);
});
test("iMac selection fixes one person and leaving the type restores previous group size",async()=>{
  const f=await boot();f.element("find-people").value="12";f.element("find-kind").value="imac";f.app.syncKind();assert.equal(f.element("find-people").value,"1");assert.ok(f.element("find-people").disabled);
  f.element("find-kind").value="computer_lab";f.app.syncKind();assert.equal(f.element("find-people").value,"12");assert.equal(f.element("find-people").disabled,false);
});
test("changing inputs after choosing invalidates the plan and confirmation",async()=>{
  const f=await boot();await f.app.search();f.app.choose();f.element("find-start").value="11:00";await f.element("finder-form").fire("input",{target:f.element("find-start")});assert.equal(f.app.state.plan,null);assert.equal(f.element("find-review").hidden,true);assert.equal(f.element("find-confirm").disabled,true);await f.app.confirm();assert.equal(f.bookings.length,0);
  await f.app.search();f.app.choose();f.element("find-title").value="Programmatic change without an input event";await f.app.confirm();assert.equal(f.bookings.length,0);assert.equal(f.app.state.plan,null);assert.match(f.element("find-error").textContent,/details changed/);
});
test("late search replies are discarded when details change during the request",async()=>{
  const f=await boot(),gate=deferred();f.gates.set("/api/plan",gate.promise);const pending=f.app.search();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.element("find-results").dataset.phase,"loading");
  f.element("find-people").value="8";f.app.invalidate();gate.release();await pending;assert.equal(f.app.state.plan,null);assert.equal(f.element("find-results").dataset.phase,"stale");assert.match(f.element("find-status").textContent,/changed while searching/);
});
test("duplicate confirmation is blocked while one save is pending",async()=>{
  const f=await boot();await f.app.search();f.app.choose();const gate=deferred();f.gates.set("/api/bookings",gate.promise);const pending=f.app.confirm();await f.app.confirm();assert.equal(f.calls.filter(c=>c.url==="/api/bookings").length,1);assert.ok(f.element("find-confirm").disabled);gate.release();await pending;assert.equal(f.bookings.length,1);
});
test("conflicting or expired confirmation requires a fresh search and refreshes reservations",async()=>{
  const f=await boot();await f.app.search();f.app.choose();f.failures.set("/api/bookings","This plan conflicts with another simulation reservation.");await f.app.confirm();assert.equal(f.app.state.plan,null);assert.equal(f.element("find-results").dataset.phase,"error");assert.match(f.element("find-error").textContent,/fresh search/);assert.equal(f.calls.at(-1).method,"GET");assert.equal(f.bookings.length,0);
});
test("empty results are explicit and cannot be reserved",async()=>{
  const f=await boot(),request=f.transport.request;f.transport.request=async(url,payload,method)=>url==="/api/plan"?{plan_id:"empty",assignments:[],unassigned:[{reason:"No candidate fits."}]}:request(url,payload,method);
  await f.app.search();assert.equal(f.element("find-results").dataset.phase,"empty");assert.match(f.element("find-results").innerHTML,/No suitable space/);assert.equal(f.app.state.plan,null);f.app.choose();assert.equal(f.element("find-review").hidden,true);
});
test("cancellation updates the same simulation store and invalidates recommendations",async()=>{
  const f=await boot();await f.app.search();f.app.choose();await f.app.confirm();await f.app.search();await f.app.cancel("fixture-booking");assert.equal(f.bookings.length,0);assert.equal(f.app.state.plan,null);assert.ok(f.calls.some(c=>c.url==="/api/bookings/fixture-booking"&&c.method==="DELETE"));assert.match(f.element("find-reservations").innerHTML,/Your day is open/);
});
test("invalid search inputs do not send a planning request",async()=>{
  const f=await boot();f.element("find-start").value="19:30";await f.app.search();assert.equal(f.calls.filter(c=>c.url==="/api/plan").length,0);assert.match(f.element("find-error").textContent,/20:00/);
});
test("a failed inventory request leaves search available and the next search retries",async()=>{
  const f=await boot();f.failures.set("/api/state","Temporary network failure.");assert.equal(await f.app.loadState(),false);assert.equal(f.app.state.ready,false);assert.equal(f.element("find-submit").disabled,false);assert.match(f.element("find-error").textContent,/Temporary network/);
  await f.app.search();assert.equal(f.element("find-results").dataset.phase,"ready");assert.equal(f.app.state.ready,true);assert.equal(f.element("find-error").hidden,true);
});
test("blocked storage prevents planning but can recover after the next state check",async()=>{
  const f=await boot(),request=f.transport.request;let blocked=true;
  f.transport.request=async(url,payload,method)=>url.startsWith("/api/state")&&blocked?{resources:clone(resources),bookings:[],storage_mode:"browser",storage_available:false,storage_error:"Browser storage is blocked."}:request(url,payload,method);
  await f.app.search();assert.equal(f.app.state.available,false);assert.equal(f.calls.filter(c=>c.url==="/api/plan").length,0);assert.match(f.element("find-error").textContent,/storage is blocked/);assert.equal(f.element("find-submit").disabled,false);
  blocked=false;await f.app.search();assert.equal(f.element("find-results").dataset.phase,"ready");assert.equal(f.app.state.available,true);
});
test("reservations from a different search date are not displayed",async()=>{
  const f=await boot();await f.app.search();f.app.choose();await f.app.confirm();assert.match(f.element("find-reservations").innerHTML,/Study session/);
  f.element("find-date").value="2026-12-02";await f.app.loadState();assert.doesNotMatch(f.element("find-reservations").innerHTML,/Study session/);assert.match(f.element("reservation-status").textContent,/0 simulation reservations/);
});
