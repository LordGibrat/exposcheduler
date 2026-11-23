/* UI enhancer tests: actual controller and HTML, lightweight DOM, fixture API.
 * These are not browser, CSS, pointer-geometry or accessibility measurements. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createFinder} = require("../static/find.js");
const experience = require("../static/experience.js");
const resources = JSON.parse(fs.readFileSync(path.join(__dirname,"../data/resources.json"),"utf8"));
const clone = value => JSON.parse(JSON.stringify(value));

class EventFixture {
  constructor(type,options={}) { this.type=type;this.bubbles=!!options.bubbles;Object.assign(this,options); }
  preventDefault() { this.defaultPrevented=true; }
}
function makeDocument() {
  const elements=new Map(),all=[],misses=[];
  const attributes=source=>Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]||""]));
  class Element {
    constructor(tag,a) {
      this.tagName=tag.toUpperCase();this.id=a.id||"";this.attributes={...a};this.value=a.value||"";this.checked=Object.hasOwn(a,"checked");this.hidden=Object.hasOwn(a,"hidden");this.disabled=Object.hasOwn(a,"disabled");this.textContent="";this.dataset={};this.listeners={};this._html="";
      const classes=new Set((a.class||"").split(/\s+/).filter(Boolean));
      this.classList={contains:name=>classes.has(name),add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),toggle:(name,value)=>{const add=value===undefined?!classes.has(name):!!value;if(add)classes.add(name);else classes.delete(name);return add;}};
      this.style={setProperty(){},removeProperty(){}};
      for(const [key,value]of Object.entries(a))if(key.startsWith("data-"))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
      all.push(this);if(this.id)elements.set(this.id,this);
    }
    set innerHTML(value) { this._html=String(value);parse(this._html); }
    get innerHTML() { return this._html; }
    getAttribute(name) { return this.attributes[name]??null; }
    setAttribute(name,value) { this.attributes[name]=String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name,fn) { (this.listeners[name]||=[]).push(fn); }
    removeEventListener(name,fn) { this.listeners[name]=(this.listeners[name]||[]).filter(f=>f!==fn); }
    dispatchEvent(event) {
      event.target ||= this;event.currentTarget=this;
      for(const fn of this.listeners[event.type]||[])fn(event);
      if(event.bubbles && ["INPUT","SELECT"].includes(this.tagName))elements.get("finder-form")?.dispatchEvent({...event,bubbles:false,target:event.target});
      return !event.defaultPrevented;
    }
    focus() { document.activeElement=this; }
    closest(selector) { return matches(this,selector)?this:null; }
    querySelectorAll(selector) { return all.filter(node=>matches(node,selector)); }
    querySelector(selector) { return all.find(node=>matches(node,selector))||null; }
    getBoundingClientRect() { return {left:0,top:0,width:400,height:300}; }
  }
  function matches(node,selector) {
    if(selector.startsWith("#"))return node.id===selector.slice(1);
    if(selector.startsWith("."))return node.classList.contains(selector.slice(1));
    if(selector==='input[name="feature"]:checked')return node.tagName==="INPUT"&&node.attributes.name==="feature"&&node.checked;
    const attribute=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    return attribute?Object.hasOwn(node.attributes,attribute[1])&&(attribute[2]===undefined||node.attributes[attribute[1]]===attribute[2]):false;
  }
  function parse(source) {
    for(const m of source.matchAll(/<([\w-]+)\b([^>]*)>/g)) {
      const a=attributes(m[2]);if(!a.id&&!a.class&&!Object.keys(a).some(key=>key.startsWith("data-"))&&!(m[1]==="input"&&a.name==="feature"))continue;
      const node=new Element(m[1],a);
      if(node.tagName==="SELECT") {
        const tail=source.slice(m.index+m[0].length).split("</select>")[0], options=[...tail.matchAll(/<option\b([^>]*)>/g)].map(o=>attributes(o[1]));
        node.value=(options.find(o=>Object.hasOwn(o,"selected"))||options[0]||{}).value||"";
      }
    }
  }
  const document={elements,all,misses,activeElement:null,getElementById(id){if(!elements.has(id))misses.push(id);return elements.get(id)||null;},querySelectorAll:selector=>all.filter(node=>matches(node,selector)),querySelector:selector=>all.find(node=>matches(node,selector))||null};
  parse(fs.readFileSync(path.join(__dirname,"../static/find.html"),"utf8"));return document;
}
async function boot() {
  const document=makeDocument(),element=id=>document.elements.get(id),calls=[],observers=[];
  for(const [id,value]of Object.entries({"find-date":"2026-12-01","find-kind":"meeting_room","find-start":"11:30","find-duration":"90","find-people":"8","find-floor":"6","find-title":"My existing session"}))element(id).value=value;
  const transport={mode:"browser",coordinatedTabs:true,async request(url,payload,method="POST"){
    calls.push({url,payload:clone(payload??null),method});
    if(url.startsWith("/api/state"))return {resources:clone(resources),bookings:[],storage_mode:"browser"};
    if(url==="/api/plan") {
      const r=payload.requests[0],resource=resources.find(x=>(r.kind==="any"||x.kind===r.kind)&&x.capacity>=r.group_size);
      return {plan_id:"experience-fixture",assignments:resource?[{request_id:r.id,resource_id:resource.id,start:r.earliest,end:r.latest,score:220,belief:resource.prior,route:{path:["Test lobby","Resource door"],cost:2}}]:[],unassigned:[],score:220,baseline_score:218,diagnostics:{candidate_counts:{[r.id]:3}}};
    }
    throw new Error("Unexpected fixture endpoint "+url);
  }};
  const controller=createFinder({document,transport});await controller.start();
  class ObserverFixture {constructor(callback){this.callback=callback;this.disconnected=false;this.targets=[];observers.push(this);}observe(target,options){this.targets.push({target,options});}disconnect(){this.disconnected=true;}fire(){if(!this.disconnected)this.callback([]);}}
  const window={Event:EventFixture,matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),addEventListener(){},removeEventListener(){},requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){}};
  const enhancer=experience.createExperience({document,window,Event:EventFixture,MutationObserver:ObserverFixture});enhancer.start();
  return {document,element,controller,enhancer,calls,observers,emit:()=>observers.forEach(o=>o.fire()),query:selector=>document.querySelector(selector)};
}

test("journey progress maps actual result/review states without inventing success",()=>{
  assert.equal(experience.journeyPhase("ready",false),"result");assert.equal(experience.journeyPhase("saved",false),"review");assert.equal(experience.journeyPhase("ready",true),"review");
  for(const value of ["initial","stale","loading","empty","error"])assert.equal(experience.journeyPhase(value,false),"search");
});
test("enhancer initialization preserves an existing type, group, time and starting floor",async()=>{
  const f=await boot();assert.deepEqual(f.document.misses,[]);assert.equal(f.element("find-kind").value,"meeting_room");assert.equal(f.element("find-people").value,"8");assert.equal(f.element("find-floor").value,"6");assert.equal(f.element("find-start").value,"11:30");assert.equal(f.element("find-title").value,"My existing session");assert.equal(f.calls.filter(c=>c.url==="/api/plan").length,0);
  assert.equal(f.enhancer.setIntent("invalid"),false);assert.equal(f.element("find-kind").value,"meeting_room");assert.equal(f.enhancer.setFloor(9),false);assert.equal(f.element("find-floor").value,"6");
});
test("iMac intent uses native field events, enforces one person and invalidates the existing plan",async()=>{
  const f=await boot();await f.controller.search();assert.ok(f.controller.state.plan);const button=f.query('[data-intent="imac"]');assert.ok(button);button.dispatchEvent(new EventFixture("click"));assert.equal(f.element("find-kind").value,"imac");assert.equal(f.element("find-people").value,"1");assert.equal(f.element("find-people").disabled,true);assert.equal(f.controller.state.plan,null);assert.equal(f.element("find-results").dataset.phase,"stale");
  f.enhancer.setIntent("meeting_room");assert.equal(f.element("find-people").value,"8");assert.equal(f.element("find-people").disabled,false);
});
test("a floor choice updates the real starting-floor field and invalidates a recommendation",async()=>{
  for(const floor of [1,4,8])assert.equal(experience.normaliseFloor(String(floor)),floor);
  for(const value of [0,9,"",NaN,"4.5","unknown"])assert.equal(experience.normaliseFloor(value),null);
  const f=await boot();await f.controller.search();assert.ok(f.controller.state.plan);const selected=f.query('[data-atlas-floor="4"]');assert.ok(selected);selected.dispatchEvent(new EventFixture("click"));assert.equal(f.element("find-floor").value,"4");assert.equal(f.controller.state.plan,null);assert.match(f.element("atlas-floor-caption").textContent,/4/);assert.equal(selected.getAttribute("aria-pressed"),"true");
});
test("journey UI follows the actual controller result and explicit review state",async()=>{
  const f=await boot();const targets=f.observers.flatMap(o=>o.targets);assert.ok(targets.some(t=>t.target.id==="find-results"&&t.options.attributes&&t.options.attributeFilter.includes("data-phase")));assert.ok(targets.some(t=>t.target.id==="find-review"&&t.options.attributes&&t.options.attributeFilter.includes("hidden")));
  await f.controller.search();f.emit();assert.equal(f.query('[data-journey="result"]').getAttribute("aria-current"),"step");f.controller.choose();f.emit();assert.equal(f.query('[data-journey="review"]').getAttribute("aria-current"),"step");f.controller.back();f.emit();assert.equal(f.query('[data-journey="result"]').getAttribute("aria-current"),"step");
});
test("floor buttons support native keyboard navigation with Home and End",async()=>{
  const f=await boot(),top=f.query('[data-atlas-floor="8"]'),bottom=f.query('[data-atlas-floor="1"]');assert.ok(top&&bottom);
  top.dispatchEvent(new EventFixture("keydown",{key:"End"}));assert.equal(f.element("find-floor").value,"1");assert.equal(f.document.activeElement,bottom);
  bottom.dispatchEvent(new EventFixture("keydown",{key:"Home"}));assert.equal(f.element("find-floor").value,"8");assert.equal(f.document.activeElement,top);
  top.dispatchEvent(new EventFixture("keydown",{key:"ArrowDown"}));assert.equal(f.element("find-floor").value,"7");assert.equal(f.document.activeElement,f.query('[data-atlas-floor="7"]'));
  const seventh=f.query('[data-atlas-floor="7"]');seventh.dispatchEvent(new EventFixture("keydown",{key:"ArrowUp"}));assert.equal(f.element("find-floor").value,"8");
});
test("destroy removes observer activity and leaves original search controls usable",async()=>{
  const f=await boot();f.enhancer.destroy();assert.ok(f.observers.every(o=>o.disconnected));await f.controller.search();assert.equal(f.element("find-results").dataset.phase,"ready");
});
