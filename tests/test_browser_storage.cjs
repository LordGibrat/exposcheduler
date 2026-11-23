/* Browser-personal persistence adapter unit tests, run in Node, not a browser.
 * Fetch replies are fixtures, while resource/parent metadata is real project JSON.
 * These checks do not establish cross-device synchronization or shared bookings.
 */
"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {ExpoBookingTransport} = require("../static/browser-storage.js");
const resources = JSON.parse(fs.readFileSync(path.join(__dirname,"../data/resources.json"),"utf8"));
const KEY = "expo-smart-scheduler-v1";
const DAY = "2026-12-01", OTHER = "2026-12-02";
const clone = value => JSON.parse(JSON.stringify(value));
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const lab = resources.find(r=>r.kind==="computer_lab");
const children = resources.filter(r=>r.parent_id===lab.id);
const room = resources.find(r=>r.kind==="study_room");
function request(id="Q1",changes={}) {
  return {id,title:"Synthetic study request",kind:"any",group_size:1,features:[],
    preferred_floor:4,earliest:540,latest:720,duration:60,priority:1,accessible:false,...changes};
}
function assignment(resource=room.id,start=600,end=660,id="Q1") {
  return {request_id:id,resource_id:resource,start,end,score:120,belief:.7,
    route:{path:["F4 lobby","Resource door"],cost:1},explanation:"Presentation fixture only"};
}
function booking(resource=room.id,start=600,end=660,day=DAY,title="Existing simulated reservation",id=uid(700)) {
  return {id,resource_id:resource,date:day,start,end,title};
}
class MemoryStorage {
  constructor(initial) { this.value=initial; this.writes=0; }
  getItem(key) { assert.equal(key,KEY); return this.value??null; }
  setItem(key,value) { assert.equal(key,KEY); this.value=value; this.writes++; }
  read() { return this.value?JSON.parse(this.value):null; }
}
function locks() {
  const tails=new Map();
  return {request(name,options,callback) {
    const fn=typeof options==="function"?options:callback;
    const before=tails.get(name)||Promise.resolve();
    const result=before.then(fn);tails.set(name,result.catch(()=>{}));return result;
  }};
}
function harness(options={}) {
  const storage=options.storage||new MemoryStorage(options.persisted&&JSON.stringify(options.persisted));
  let count=0,clock=Date.UTC(2026,10,19),placements=[assignment()],planGate=null;
  const calls=[];
  const response=(value,status=200)=>({ok:status<400,status,json:async()=>clone(value)});
  const fetchImpl=async (url,init={})=>{
    const payload=init.body?JSON.parse(init.body):undefined;
    calls.push({url,method:init.method||"GET",payload});
    const route=String(url).split("?")[0];
    if(route==="/api/state")return response({date:new URL(String(url),"https://example.test").searchParams.get("date")||DAY,
      resources,bookings:[],scenarios:[],storage_mode:options.mode||"browser",simulation:true});
    if(route==="/api/plan") {if(planGate)await planGate;return response({plan_id:uid(++count),date:payload.date,method:"hill",seed:42,
      assignments:clone(placements),baseline_assignments:[],unassigned:[],trace:[100,120],score:120,
      baseline_score:100,diagnostics:{optimal:false},simulation:true,storage_mode:options.mode||"browser"});}
    if(route==="/api/decision")return response({action:"inspect",values:{book:1,inspect:2,wait:0,leave:0}});
    if(route==="/api/occupancy")return response({predictive_next:.5,trace:[]});
    if(route==="/api/bookings")return response({bookings:[booking()],simulation:true});
    if(route.startsWith("/api/bookings/"))return response({success:true});
    throw new Error("Unexpected fixture request "+route);
  };
  const adapter=new ExpoBookingTransport({fetchImpl,storage,locks:options.locks||locks(),
    uuid:()=>uid(++count+1000),now:()=>clock,...options.constructor});
  return {adapter,storage,calls,
    placements(value){placements=clone(value);},advance(ms){clock+=ms;},
    holdPlans(){let release;planGate=new Promise(resolve=>{release=resolve;});return ()=>{release();planGate=null;};},
    state:day=>adapter.request(`/api/state?date=${day||DAY}`,undefined,"GET"),
    async plan(day=DAY,requests=[request()]){return adapter.request("/api/plan",{date:day,requests,reports:{},assumptions:{sensitivity:.85,false_positive:.15},seed:42,method:"hill"});},
    commit:plan=>adapter.request("/api/bookings",{plan_id:plan.plan_id})};
}

test("browser mode reads canonical inventory but keeps personal reservations in local storage",async()=>{
  const h=harness();const state=await h.state();
  assert.equal(h.adapter.mode,"browser");assert.equal(h.adapter.storageAvailable,true);
  assert.equal(state.resources.length,resources.length);assert.deepEqual(state.bookings,[]);
  const plan=await h.plan();await h.commit(plan);
  assert.equal(h.storage.read().version,1);assert.equal(h.storage.read().bookings.length,1);
  assert.equal(h.calls.filter(c=>c.url==="/api/bookings").length,0,"commit must not pretend to create a shared server reservation");
  assert.equal((await h.state()).bookings.length,1);
});

test("planner receives current personal bookings without changing the submitted request object",async()=>{
  const existing=booking();const h=harness({persisted:{version:1,bookings:[existing]}});await h.state();
  const requests=[request()];await h.plan(DAY,requests);
  const payload=h.calls.filter(c=>c.url==="/api/plan").at(-1).payload;
  assert.deepEqual(payload.bookings||payload.local_bookings,[existing]);assert.deepEqual(requests,[request()]);
});

test("same resource overlap rejects the whole commit without a storage write",async()=>{
  const h=harness();await h.state();const a=await h.plan(),b=await h.plan();
  await h.commit(a);const before=h.storage.value,writes=h.storage.writes;
  await assert.rejects(h.commit(b),/unavailable|conflict|overlap|fresh|changed/i);
  assert.equal(h.storage.value,before);assert.equal(h.storage.writes,writes);
});

test("parent lab and child iMac bookings block each other in both directions",async()=>{
  for(const [existing,next] of [[lab.id,children[0].id],[children[0].id,lab.id]]){
    const h=harness();await h.state();h.placements([assignment(existing)]);const first=await h.plan();
    h.placements([assignment(next)]);const stale=await h.plan();await h.commit(first);
    await assert.rejects(h.commit(stale),/unavailable|conflict|overlap|fresh|changed/i);
    assert.equal(h.storage.read().bookings.length,1);
  }
});

test("siblings and adjacent half-open intervals may coexist",async()=>{
  const h=harness();await h.state();
  h.placements([assignment(children[0].id)]);await h.commit(await h.plan());
  h.placements([assignment(children[1].id)]);await h.commit(await h.plan());
  h.placements([assignment(children[0].id,660,720)]);await h.commit(await h.plan());
  assert.equal(h.storage.read().bookings.length,3);
});

test("a mixed batch with one new conflict is atomic",async()=>{
  const h=harness();await h.state();
  h.placements([assignment(room.id,600,660,"Q1"),assignment(children[0].id,600,660,"Q2")]);
  const batch=await h.plan(DAY,[request("Q1"),request("Q2")]);
  h.placements([assignment(children[0].id)]);await h.commit(await h.plan());
  const before=h.storage.value,writes=h.storage.writes;
  await assert.rejects(h.commit(batch),/unavailable|conflict|overlap|fresh|changed/i);
  assert.equal(h.storage.value,before);assert.equal(h.storage.writes,writes);
  assert.equal(h.storage.read().bookings.length,1,"non-conflicting first assignment must not partially persist");
});

test("cached plan is immutable and has a bounded lifetime",async()=>{
  const h=harness();await h.state();const requests=[request()];const plan=await h.plan(DAY,requests);
  plan.assignments[0].resource_id="invented";requests[0].title="Mutated after planning";
  await h.commit(plan);assert.equal(h.storage.read().bookings[0].resource_id,room.id);
  assert.equal(h.storage.read().bookings[0].title,"Synthetic study request");
  h.placements([assignment(room.id,660,720)]);const expired=await h.plan();h.advance(2*60*60*1000);
  await assert.rejects(h.commit(expired),/expired|fresh|not found|new plan/i);
  await assert.rejects(h.adapter.request("/api/bookings",{plan_id:uid(999999)}),/expired|fresh|not found|new plan/i);
});

test("cached request constraints and title match the snapshot actually sent for planning",async()=>{
  const h=harness();await h.state();const release=h.holdPlans();const requests=[request()];
  const pending=h.plan(DAY,requests);requests[0].title="Edited while server was calculating";
  release();const plan=await pending;await h.commit(plan);
  assert.equal(h.storage.read().bookings[0].title,"Synthetic study request");
});

test("duplicate commit and client-supplied assignment tampering are rejected",async()=>{
  const h=harness();await h.state();const plan=await h.plan();
  await assert.rejects(h.adapter.request("/api/bookings",{plan_id:plan.plan_id,assignments:[assignment(children[0].id)]}),/field|plan.?id|invalid|only/i);
  await h.commit(plan);await assert.rejects(h.commit(plan),/already|expired|not found|fresh|new plan/i);
  assert.equal(h.storage.read().bookings.length,1);
});

test("days are independent and cancellation removes only the requested personal booking",async()=>{
  const h=harness();await h.state();await h.commit(await h.plan());await h.commit(await h.plan(OTHER));
  assert.equal((await h.state(DAY)).bookings.length,1);assert.equal((await h.state(OTHER)).bookings.length,1);
  const id=(await h.state(DAY)).bookings[0].id;
  await h.adapter.request(`/api/bookings/${id}`,undefined,"DELETE");
  assert.equal((await h.state(DAY)).bookings.length,0);assert.equal((await h.state(OTHER)).bookings.length,1);
  assert.equal(h.calls.filter(c=>c.method==="DELETE").length,0);
});

test("malformed, unknown-resource and overlapping persisted data fail visibly without being overwritten",async()=>{
  const badDocs=["invalid JSON",JSON.stringify({version:99,bookings:[]}),JSON.stringify({version:1,bookings:[booking("unknown")]}),
    JSON.stringify({version:1,bookings:[booking(),booking(room.id,630,690,DAY,"Overlap",uid(701))]})];
  for(const raw of badDocs){const storage=new MemoryStorage(raw);const h=harness({storage});const state=await h.state();
    assert.equal(state.storage_available,false);assert.ok(state.storage_error);
    assert.equal(state.resources.length,resources.length,"inventory should remain inspectable");
    assert.equal(storage.value,raw);assert.equal(storage.writes,0,"a corrupt document must not be silently reset");
    await assert.rejects(h.plan(),/storage|saved|invalid|unavailable|corrupt|data/i);
  }
});

test("blocked localStorage reads and writes are errors, not false persistence success",async()=>{
  const blockedRead={getItem(){throw new Error("Storage denied");},setItem(){throw new Error("Storage denied");}};
  const h=harness({storage:blockedRead});const state=await h.state();
  assert.equal(state.storage_available,false);assert.ok(state.storage_error);
  await assert.rejects(h.plan(),/storage|denied|unavailable/i);
  const storage=new MemoryStorage();const quota=harness({storage});await quota.state();const plan=await quota.plan();
  storage.setItem=()=>{throw new Error("Quota exceeded");};
  await assert.rejects(quota.commit(plan),/quota|storage|save|unavailable/i);
  assert.equal(storage.read()?.bookings?.length||0,0);
});

test("ICS export escapes user text, preserves Unicode and identifies simulation scope",async()=>{
  const title='Unicode Ғибрат, "study"; slash\\';
  const h=harness({persisted:{version:1,bookings:[booking(room.id,600,660,DAY,title)]}});await h.state();
  const ics=await h.adapter.exportCalendar(DAY);const unfolded=ics.replace(/\r\n[ \t]/g,"");
  assert.match(unfolded,/BEGIN:VCALENDAR/);assert.match(unfolded,/BEGIN:VEVENT/);
  assert.match(unfolded,/SIMULATION/i);assert.match(unfolded,/Ғибрат\\,/);
  assert.match(unfolded,/study"\\; slash\\\\/);
  assert.match(unfolded,/DTSTART:20261201T100000/);assert.match(unfolded,/DTEND:20261201T110000/);
  assert.ok(!unfolded.includes("DTSTART;TZID="),"calendar must not invent an unconfigured time zone");
  for(const line of ics.split("\r\n"))assert.ok(Buffer.byteLength(line,"utf8")<=75,"ICS physical lines must fold at75UTF8bytes");
  assert.equal((await h.adapter.exportCalendar(OTHER)).includes("BEGIN:VEVENT"),false);
});

test("ICS byte folding preserves long Unicode text across physical lines",async()=>{
  const title="Ғ".repeat(85)+",finish";
  const h=harness({persisted:{version:1,bookings:[booking(room.id,600,660,DAY,title)]}});await h.state();
  const ics=await h.adapter.exportCalendar(DAY);const unfolded=ics.replace(/\r\n[ \t]/g,"");
  assert.match(ics,/\r\n /);assert.ok(unfolded.includes("Ғ".repeat(85)+"\\,finish"));
  for(const line of ics.split("\r\n"))assert.ok(Buffer.byteLength(line,"utf8")<=75);
});

test("shared web-lock provider serializes competing commits across adapter instances",async()=>{
  const storage=new MemoryStorage(),sharedLocks=locks();
  const a=harness({storage,locks:sharedLocks}),b=harness({storage,locks:sharedLocks});
  await a.state();await b.state();const pa=await a.plan(),pb=await b.plan();
  const results=await Promise.allSettled([a.commit(pa),b.commit(pb)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(results.filter(r=>r.status==="rejected").length,1);
  assert.equal(storage.read().bookings.length,1);
});

test("without Web Locks the adapter labels coordination single-tab-only",async()=>{
  const h=harness({constructor:{locks:null}});const state=await h.state();
  assert.equal(h.adapter.coordinatedTabs,false);assert.equal(state.storage_coordination,"single-tab-only");
  const first=await h.plan(),second=await h.plan();
  const result=await Promise.allSettled([h.commit(first),h.commit(second)]);
  assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(h.storage.read().bookings.length,1);
});

test("server mode preserves the SQLite API transport instead of creating local browser bookings",async()=>{
  const h=harness({mode:"server"});const state=await h.state();assert.equal(h.adapter.mode,"server");
  const plan=await h.plan();await h.commit(plan);
  assert.equal(h.calls.filter(c=>c.url==="/api/bookings").length,1);
  assert.equal(h.storage.writes,0);
  assert.equal(state.simulation,true);
});
