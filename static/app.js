"use strict";

// Presentation logic only: the Python engine owns plans, probabilities and booking validation.
const $ = id => document.getElementById(id);
const transport = new ExpoBookingTransport();
const state = {resources:[], bookings:[], scenarios:[], reports:{}, queue:[], plan:null, storageMode:"server", storageAvailable:true,
  floor:"all", view:"cards", requestNumber:0, loading:false, planning:false, committing:false};
const floorThemes = {1:"Museum",2:"TUMO",3:"TUMO",4:"Tomorrow School / QAIRU",5:"Network School",6:"Startup Campus",7:"AI Labs",8:"AI-Driven Government"};
const kindNames = {any:"Any suitable space",study_room:"Study room",classroom:"Classroom",auditorium:"Auditorium",imac:"Individual iMac",computer_lab:"Computer lab",meeting_room:"Meeting room",lounge:"Lounge"};
const featureNames = {quiet:"Quiet",projector:"Projector",whiteboard:"Whiteboard",wheelchair:"Step-free access",macOS:"macOS"};
const actionNames = {book:"Book",inspect:"Inspect",wait:"Wait",leave:"Leave"};
const esc = text => String(text??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = (value,digits=1) => Number.isFinite(Number(value))?Number(value).toFixed(digits):"N/A";
const pct = value => Number.isFinite(Number(value))?`${Math.round(Number(value)*100)}%`:"N/A";
const time = value => `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
const parseTime = value => {const [h,m]=value.split(":").map(Number);return h*60+m;};
const resourceById = id => state.resources.find(r=>r.id===id);
const requestById = id => state.queue.find(r=>r.id===id);
const day = () => $("planning-date").value;
const motion = () => matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth";
function explain(value) {
  if(typeof value==="string")return value;
  if(Array.isArray(value))return value.map(explain).join("; ");
  if(value&&typeof value==="object")return Object.entries(value).map(([k,v])=>`${k.replaceAll("_"," ")}: ${explain(v)}`).join("; ");
  return String(value??"");
}
function notify(message,isError=false){const n=$("global-message");n.textContent=message;n.hidden=false;n.classList.toggle("error",isError);}
function errorAt(id,message=""){const n=$(id);n.textContent=message;n.hidden=!message;}
async function api(path,data,method="POST") {
  return transport.request(path,data,method);
}
function assumptions(){return {sensitivity:Number($("lab-sensitivity").value),false_positive:Number($("lab-false-positive").value)};}
function invalidatePlan(){if(state.plan){state.plan.stale=true;renderPlan();}}
function updateStats(){
  $("main").setAttribute("aria-busy",String(state.loading));
  $("stat-types").textContent=new Set(state.resources.map(r=>r.kind)).size;
  $("stat-resources").textContent=state.resources.length;$("stat-bookings").textContent=state.bookings.length;
  $("stat-queue").textContent=state.queue.length;$("nav-queue").textContent=state.queue.length;
  $("generate-plan").disabled=!state.queue.length||state.planning||state.loading||!state.storageAvailable;
  $("add-request").disabled=state.queue.length>=10||state.loading;$("clear-queue").disabled=!state.queue.length;
}
function renderBuilding(floors){
  const ordered=floors.slice().reverse();const mid=(ordered.length-1)/2;
  $("building-stack").innerHTML=ordered.map((f,i)=>{
    const width=Math.round(115+155*Math.sqrt(Math.max(0,1-((i-mid)/(mid+.12))**2)));
    return `<button class="floor-layer ${state.floor===f?"selected":""}" style="--level:${i};--floor-width:${width}px" data-floor="${f}" aria-label="Explore floor ${f}, ${esc(floorThemes[f])}" aria-pressed="${state.floor===f}"><span class="layer-rim"></span><span class="layer-label">${String(f).padStart(2,"0")}</span><span class="layer-window"></span></button>`;
  }).join("");
  $("building-caption").textContent=state.floor==="all"?"Eight floors. One coordinated day.":`Floor ${state.floor}: ${floorThemes[state.floor]}`;
}
function renderFloorControls(){
  const floors=[...new Set(state.resources.map(r=>r.floor))].sort((a,b)=>a-b);
  const tab=(f,title,count)=>`<button class="floor-tab ${state.floor===f?"selected":""}" data-floor="${f}" aria-pressed="${state.floor===f}"><span class="floor-number">${f==="all"?"All":String(f).padStart(2,"0")}</span><span><strong>${esc(title)}</strong><small>${count} resource${count===1?"":"s"}</small></span></button>`;
  $("floor-tabs").innerHTML=tab("all","Every level",state.resources.length)+floors.map(f=>tab(f,`Floor ${f}`,state.resources.filter(r=>r.floor===f).length)).join("");
  const previous=$("request-floor").value||"2";
  $("request-floor").innerHTML=floors.map(f=>`<option value="${f}">Floor ${f}: ${esc(floorThemes[f])}</option>`).join("");
  $("request-floor").value=floors.includes(Number(previous))?previous:String(floors[0]);
  const previousResource=$("forecast-resource").value;
  $("forecast-resource").innerHTML='<option value="">Choose a resource</option>'+state.resources.map(r=>`<option value="${esc(r.id)}">F${r.floor}: ${esc(r.name)}</option>`).join("");
  $("forecast-resource").value=previousResource;renderBuilding(floors);
}
function chooseFloor(value,scroll=false){state.floor=value==="all"?"all":Number(value);renderFloorControls();renderResources();if(scroll)$("spaces").scrollIntoView({behavior:motion()});}
function iconFor(kind){
  const paths=kind==="imac"||kind==="computer_lab"?'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M9 21h6m-3-5v5M3 12h18"/>':kind==="auditorium"?'<path d="M3 8h18M5 8V4h14v4M5 8v4h14V8M4 21v-4h5v4m6 0v-4h5v4m-8-7v7M2 21h20"/>':'<path d="M4 21V4h16v17M2 21h20M8 8h2m4 0h2M8 12h2m4 0h2M10 21v-5h4v5"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
function filteredResources(){const search=$("resource-search").value.trim().toLowerCase();const kind=$("resource-kind").value;return state.resources.filter(r=>(state.floor==="all"||state.floor===r.floor)&&(kind==="all"||kind===r.kind)&&(!search||`${r.name} ${r.id} ${r.features.join(" ")} ${kindNames[r.kind]}`.toLowerCase().includes(search)));}
function renderResources(){
  const resources=filteredResources();$("resource-count").textContent=`${resources.length} of ${state.resources.length} resources`;
  $("resource-cards").hidden=state.view!=="cards";$("resource-timeline").hidden=state.view!=="timeline";
  if(!resources.length){$("resource-cards").innerHTML='<div class="empty-state"><strong>No resources match</strong><p>Try another floor, resource type or search term.</p></div>';$("resource-timeline").innerHTML='<div class="empty-state">No resources match the current filters.</div>';return;}
  $("resource-cards").innerHTML=resources.map(r=>{
    const report=state.reports[r.id]||"unknown";
    return `<article class="resource-card" data-kind="${esc(r.kind)}"><div class="resource-card-top"><div class="resource-icon">${iconFor(r.kind)}</div><span class="resource-id">${esc(r.id)}</span></div><div class="resource-card-body"><h3>${esc(r.name)}</h3><div class="resource-meta"><span>Floor ${r.floor}</span><i class="meta-separator"></i><span>${r.capacity} ${r.capacity===1?"person":"people"}</span><i class="meta-separator"></i><span>${esc(kindNames[r.kind])}</span></div><div class="feature-tags">${r.features.map(f=>`<span class="tag">${esc(featureNames[f]||f)}</span>`).join("")}</div>${r.parent_id?`<p class="resource-parent">Part of ${esc(resourceById(r.parent_id)?.name||r.parent_id)}</p>`:""}<div class="resource-belief"><span>Assumed initial P(free)</span><strong>${pct(r.prior)}</strong></div><div class="probability-bar" role="img" aria-label="Assumed initial availability ${pct(r.prior)}"><i style="width:${Math.round(r.prior*100)}%"></i></div></div><div class="resource-card-footer"><label>HYPOTHETICAL REPORT<select data-report="${esc(r.id)}" aria-label="Hypothetical report for ${esc(r.name)}"><option value="unknown" ${report==="unknown"?"selected":""}>Unknown</option><option value="free" ${report==="free"?"selected":""}>Reported free</option><option value="busy" ${report==="busy"?"selected":""}>Reported busy</option>${Array.isArray(report)?`<option value="sequence" selected>${report.length}-report sequence</option>`:""}</select></label><button class="card-plan" data-prefill="${esc(r.id)}">Plan this type &rarr;</button></div></article>`;
  }).join("");renderTimeline(resources);
}
function related(a,b){if(a===b)return true;const ancestors=id=>{const seen=new Set();let r=resourceById(id);while(r?.parent_id&&!seen.has(r.parent_id)){seen.add(r.parent_id);r=resourceById(r.parent_id);}return seen;};return ancestors(a).has(b)||ancestors(b).has(a);}
function renderTimeline(resources){
  const hours=Array.from({length:7},(_,i)=>`<span style="left:${i/6*100}%">${String(8+i*2).padStart(2,"0")}:00</span>`).join("");
  const rows=resources.map(r=>{const bookings=state.bookings.filter(b=>related(r.id,b.resource_id));const bars=bookings.map(b=>{const left=Math.max(0,(b.start-480)/720*100);const width=Math.min(100-left,(b.end-b.start)/720*100);const inherited=r.id!==b.resource_id;return `<span class="timeline-bar ${inherited?"inherited":""}" style="left:${left}%;width:${width}%" title="${esc(`${b.title}, ${time(b.start)} to ${time(b.end)}${inherited?", blocked by related resource":""}`)}">${esc(b.title)}</span>`;}).join("");const label=`${r.name}: ${bookings.length?bookings.map(b=>`${b.title}, ${time(b.start)} to ${time(b.end)}`).join("; "):"no local reservations"}`;return `<div class="timeline-row"><div class="timeline-resource">${esc(r.name)}<small>${esc(r.id)} / Floor ${r.floor}</small></div><div class="timeline-track" aria-label="${esc(label)}">${bars}</div></div>`;}).join("");
  $("resource-timeline").innerHTML=`<div class="timeline-inner"><div class="timeline-header"><span>Local reservations only</span><div class="timeline-hours">${hours}</div></div>${rows}</div><div class="timeline-key"><span><i></i>Direct reservation</span><span><i></i>Blocked by parent or child reservation</span></div>`;
}
function renderQueue(){
  $("request-queue").innerHTML=state.queue.length?state.queue.map((r,i)=>`<div class="request-item"><span class="request-item-number">${String(i+1).padStart(2,"0")}</span><div class="request-item-main"><h4>${esc(r.title)}</h4><p>${esc(kindNames[r.kind])} / ${r.group_size} ${r.group_size===1?"person":"people"} / ${r.duration} min<br>${time(r.earliest)} to ${time(r.latest)} window / Start F${r.preferred_floor} / Priority ${r.priority}${r.accessible?" / Step-free":""}${r.features.length?`<br>${r.features.map(f=>esc(featureNames[f]||f)).join(" / ")}`:""}</p></div><button class="request-remove" data-remove="${esc(r.id)}" aria-label="Remove ${esc(r.title)}">&times;</button></div>`).join(""):'<div class="empty-state"><strong>Your day starts here</strong><p>Add the sessions you need to fit in, or load an example to see rooms and computers scheduled together.</p></div>';updateStats();
}
function addRequest(event){
  event.preventDefault();errorAt("request-error");if(state.queue.length>=10){errorAt("request-error","A batch can contain up to 10 requests.");return;}
  const earliest=parseTime($("request-earliest").value),latest=parseTime($("request-latest").value),duration=Number($("request-duration").value);
  if(!Number.isFinite(earliest)||!Number.isFinite(latest)||earliest<480||latest>1200||earliest%30||latest%30||latest-earliest<duration){errorAt("request-error","Choose half-hour times between 08:00 and 20:00, with enough room for the full duration.");return;}
  const title=$("request-title").value.trim();if(!title){errorAt("request-error","Give the session a name.");return;}
  state.queue.push({id:`request-${++state.requestNumber}`,title,kind:$("request-kind").value,group_size:Number($("request-people").value),features:[...document.querySelectorAll('input[name="feature"]:checked')].map(c=>c.value),preferred_floor:Number($("request-floor").value),earliest,latest,duration,priority:Number($("request-priority").value),accessible:$("request-accessible").checked});
  invalidatePlan();renderQueue();$("request-title").value="";$("request-title").focus();
}
function exampleScenario(index=0){const scenario=state.scenarios[index];if(!scenario?.requests?.length){notify("The example scenarios could not be loaded. Add your own requests to continue.",true);return;}state.queue=structuredClone(scenario.requests);state.reports=structuredClone(scenario.reports||{});state.requestNumber+=10;invalidatePlan();renderQueue();renderResources();notify(`${scenario.name}: ${scenario.description||"Synthetic requests and evidence."}`);$("planner").scrollIntoView({behavior:motion()});}
function signature(){return JSON.stringify({date:day(),queue:state.queue,reports:state.reports,assumptions:assumptions(),method:$("search-method").value,seed:$("search-seed").value});}
async function generatePlan(){
  errorAt("plan-error");if(!state.queue.length||state.planning)return;
  const seed=Number($("search-seed").value);if(!Number.isSafeInteger(seed)||seed<0||seed>2147483647){errorAt("plan-error","Use an integer seed from 0 to 2147483647.");return;}
  state.planning=true;updateStats();$("generate-plan").textContent="Searching for a better schedule...";const originalSignature=signature();
  try{const result=await api("/api/plan",{date:day(),requests:state.queue,reports:state.reports,assumptions:assumptions(),seed,method:$("search-method").value});result.stale=originalSignature!==signature();result.signature=originalSignature;state.plan=result;renderPlan();$("plan-results").scrollIntoView({behavior:motion(),block:"start"});}
  catch(error){errorAt("plan-error",error.message);}
  finally{state.planning=false;$("generate-plan").innerHTML='Generate a conflict-free plan <span aria-hidden="true">&nearr;</span>';updateStats();}
}
function traceSVG(trace){
  const values=trace.map(Number).filter(Number.isFinite);if(!values.length)return "";
  const minimum=Math.min(...values),maximum=Math.max(...values),range=maximum-minimum||1;
  const points=values.map((v,i)=>`${(i/Math.max(1,values.length-1)*560+4).toFixed(1)},${(50-(v-minimum)/range*42).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 570 58" role="img" aria-label="Accepted objective trace from ${num(values[0])} to ${num(values.at(-1))}, ${values.length} points"><line x1="4" y1="51" x2="566" y2="51" stroke="#eee7f5"/><polyline class="score-trace" fill="none" stroke="#a68abb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points}"/></svg>`;
}
function placement(candidate){return candidate?`${resourceById(candidate.resource_id)?.name||candidate.resource_id}, ${time(candidate.start)} to ${time(candidate.end)}`:"Unassigned";}
function renderPlan(){
  const plan=state.plan;if(!plan){$("plan-results").hidden=true;return;}
  const assignments=plan.assignments||[],unassigned=plan.unassigned||[],baseline=plan.baseline_assignments||[];
  const difference=Number(plan.score)-Number(plan.baseline_score),exact=String(plan.method||"").includes("exact");
  const rows=assignments.map(c=>{
    const request=requestById(c.request_id),resource=resourceById(c.resource_id),route=c.route||{},advice=c.decision_advice;
    const path=Array.isArray(route.path)?route.path:[];
    return `<article class="plan-row"><span class="assignment-check" aria-hidden="true">&#10003;</span><div><h4>${esc(request?.title||c.request_id)}</h4><p class="assignment-location">${esc(resource?.name||c.resource_id)} / Floor ${resource?.floor||"?"} / ${time(c.start)} to ${time(c.end)}</p>${advice?`<span class="decision-advice">Decision advisory: <strong>${esc(actionNames[advice.action]||advice.action)}</strong> / ${num(Math.max(...Object.values(advice.values).filter(v=>typeof v==="number")),2)} utility</span>`:""}</div><div class="assignment-score">${num(c.score)}<small>assumed utility</small></div><details class="assignment-detail"><summary>Why this placement? Route & availability</summary><p>${esc(explain(c.explanation))}</p><p>Modelled P(free): <strong>${pct(c.belief)}</strong>. ${Number.isFinite(route.cost)?`Assumed route cost: ${num(route.cost)} minutes. `:""}These are model assumptions, not measured real-world outcomes.</p>${path.length?`<div class="route-line">${path.map(esc).join(" &rarr; ")}</div>`:""}${advice?`<p><strong>Sequential advisory:</strong> ${esc(explain(advice.explanation))} This is a post-scheduling recommendation. It does not change the schedule objective or prevent a local simulation reservation. Plan advice uses default costs and transitions, not custom lab settings.</p>`:""}</details></article>`;
  }).join("");
  const missing=unassigned.map(item=>`<div class="unassigned-box"><strong>${esc(requestById(item.request_id)?.title||item.request_id)} was not scheduled</strong><p>${esc(item.reason||"No feasible non-conflicting placement was found.")}</p></div>`).join("");
  const comparison=state.queue.map(r=>`<tr><td>${esc(r.title)}</td><td>${esc(placement(baseline.find(c=>c.request_id===r.id)))}</td><td>${esc(placement(assignments.find(c=>c.request_id===r.id)))}</td></tr>`).join("");
  const disabled=plan.stale||plan.committed||!assignments.length||state.committing||!state.storageAvailable;
  const storageNote=state.storageMode==="browser"?"Reservations are saved only in this browser profile. The whole batch is rechecked against its current local data. Other users do not share these reservations. Use one tab when Web Locks are unavailable.":"Every placement is rechecked in one database transaction. A reservation made since this plan was generated can cause a conflict. This only updates the local simulation.";
  $("plan-results").hidden=false;
  $("plan-results").innerHTML=`<div class="results-header"><div><h3>${exact?"Exact constraint search":"Your coordinated plan"}</h3><p>${esc(plan.method||"hill")} / Seed ${esc(plan.seed??42)} / ${esc(plan.date||day())}</p></div><span class="tag success">${assignments.length} scheduled</span></div>${plan.stale?'<div class="stale-note">Your inputs changed. Generate a fresh plan before making simulation reservations.</div>':""}<div class="results-body"><div class="comparison-metrics"><div class="metric"><span>Chosen plan score</span><strong>${num(plan.score)}</strong><small>Assumed utility units</small></div><div class="metric"><span>First-fit baseline</span><strong>${num(plan.baseline_score)}</strong><small>Same requests & constraints</small></div><div class="metric"><span>Objective difference</span><strong>${difference>=0?"+":""}${num(difference)}</strong><small>Not real-world performance</small></div><div class="metric"><span>Unassigned</span><strong>${unassigned.length}</strong><small>Honest constraint outcomes</small></div></div><div class="trace-card"><div><strong>Search objective trace</strong><p>${exact?"Exact search is bounded. Check diagnostics for completion status.":"Accepted improvements. Local search does not guarantee the global optimum."}</p></div>${traceSVG(plan.trace||[])}</div>${rows}${missing}<h4 class="baseline-heading">What changed from first-fit?</h4><div class="baseline-table-wrap"><table class="baseline-table"><thead><tr><th scope="col">Request</th><th scope="col">First-fit</th><th scope="col">Chosen plan</th></tr></thead><tbody>${comparison}</tbody></table></div><details class="method-details"><summary>Search diagnostics</summary><p>${esc(explain(plan.diagnostics))}</p></details><div class="results-footer"><p>${esc(storageNote)}</p><button id="commit-plan" class="button primary" ${disabled?"disabled":""}>${plan.committed?"Simulation reservations saved":state.committing?"Rechecking & saving...":"Reserve plan in simulation"}</button></div></div>`;
  $("commit-plan").addEventListener("click",commitPlan);
}
async function commitPlan(){
  const plan=state.plan;if(!plan||plan.stale||plan.committed||state.committing)return;
  if(plan.signature!==signature()){plan.stale=true;renderPlan();return;}
  state.committing=true;renderPlan();
  try{await api("/api/bookings",{plan_id:plan.plan_id});plan.committed=true;await loadState(false);notify(state.storageMode==="browser"?"Simulation reservations saved only in this browser. They are not shared with other users. No university facilities have been booked.":"Simulation reservations saved on this computer. No university facilities have been booked.");$("reservations").scrollIntoView({behavior:motion()});}
  catch(error){notify(error.message,true);errorAt("plan-error",error.message);plan.stale=true;}
  finally{state.committing=false;renderPlan();}
}
function renderReservations(){
  $("export-calendar").href=`/api/export?date=${encodeURIComponent(day())}`;
  $("export-calendar").setAttribute("aria-disabled",String(!state.storageAvailable));
  if(state.storageMode==="browser"&&!state.storageAvailable){
    $("reservation-list").innerHTML='<div class="empty-state"><strong>Browser reservations unavailable</strong><p>Stored reservations could not be read safely. Review the storage error above. Existing data has not been overwritten.</p></div>';
    updateStats();return;
  }
  const bookings=state.bookings.slice().sort((a,b)=>a.start-b.start||String(a.resource_id).localeCompare(String(b.resource_id)));
  $("reservation-list").innerHTML=bookings.length?bookings.map(b=>`<article class="reservation-row"><div class="reservation-time">${time(b.start)}<span>to ${time(b.end)}</span></div><div><h3>${esc(b.title)}</h3><p>${esc(resourceById(b.resource_id)?.name||b.resource_id)} / ${esc(b.resource_id)} / Local simulation</p></div><button class="cancel-booking" data-cancel="${esc(b.id)}" aria-label="Cancel local simulation reservation ${esc(b.title)}">Cancel</button></article>`).join(""):'<div class="empty-state"><strong>A clear day, for now</strong><p>No local reservations on this date. Generate a plan and reserve it in the simulation to see it here.</p></div>';updateStats();
}
async function cancelBooking(button){button.disabled=true;try{await api(`/api/bookings/${encodeURIComponent(button.dataset.cancel)}`,undefined,"DELETE");invalidatePlan();await loadState(false);notify("Local simulation reservation cancelled. No university booking was affected.");}catch(error){notify(error.message,true);button.disabled=false;}}
function labParameters(){return {prior:Number($("lab-prior").value),...assumptions(),stay_free:Number($("lab-stay-free").value),become_free:Number($("lab-become-free").value)};}
function singlePosterior(prior,report,sensitivity,falsePositive){
  for(const p of [prior,sensitivity,falsePositive])if(!Number.isFinite(p)||p<0||p>1)throw new Error("Probability assumptions must be numbers between 0 and 1.");
  if(report==="unknown")return prior;
  const yes=report==="free"?sensitivity:1-sensitivity,no=report==="free"?falsePositive:1-falsePositive,evidence=prior*yes+(1-prior)*no;
  if(!evidence)throw new Error("That report is impossible under these assumptions. Change the prior or report reliability.");
  return prior*yes/evidence;
}
async function evaluateDecision(event){
  event?.preventDefault();errorAt("decision-error");$("evaluate-decision").disabled=true;
  try{const parameters=labParameters(),belief=singlePosterior(parameters.prior,$("lab-report").value,parameters.sensitivity,parameters.false_positive);const {prior,...other}=parameters;
    const result=await api("/api/decision",{...other,belief,horizon:Number($("lab-horizon").value),success:Number($("lab-success").value),failure:Number($("lab-failure").value),inspect_cost:Number($("lab-inspect-cost").value),wait_cost:Number($("lab-wait-cost").value)});
    const values=result.values||{},finite=Object.values(values).filter(v=>typeof v==="number"&&Number.isFinite(v)),scale=Math.max(1,...finite.map(Math.abs));
    $("decision-result").innerHTML=`<div class="decision-head"><div><span>Recommended next action</span><strong>${esc(actionNames[result.action]||result.action)}</strong></div><div class="belief"><span>Bayesian P(free)</span><strong>${pct(belief)}</strong></div></div><div class="action-values">${["book","inspect","wait","leave"].map(action=>{const value=values[action],available=typeof value==="number"&&Number.isFinite(value);return `<div class="action-value ${result.action===action?"best":""}"><span>${actionNames[action]}</span><div class="action-track"><i style="width:${available?Math.max(0,value)/scale*100:0}%"></i></div><strong>${available?num(value,2):"N/A"}</strong></div>`;}).join("")}</div><p class="decision-explanation">${esc(explain(result.explanation))}</p><p class="form-hint">${esc(result.model||"Finite-horizon belief-state recursion")}. Values are assumed utilities. This calculation does not execute any action or booking.</p>`;
  }catch(error){$("decision-result").innerHTML="";errorAt("decision-error",error.message);}finally{$("evaluate-decision").disabled=false;}
}
function parseReports(){const reports=$("hmm-reports").value.split(",").map(s=>s.trim().toLowerCase());if(!reports.length||reports.length>24||reports.some(r=>!["free","busy","unknown"].includes(r)))throw new Error("Enter 1 to 24 comma-separated reports using free, busy or unknown.");return reports;}
async function evaluateOccupancy(event){
  event?.preventDefault();errorAt("occupancy-error");$("evaluate-occupancy").disabled=true;
  try{const result=await api("/api/occupancy",{...labParameters(),reports:parseReports()});
    $("occupancy-result").innerHTML=`<div class="forecast-next"><span>Next-slot modelled P(free)<br><small>Synthetic occupancy forecast</small></span><strong>${pct(result.predictive_next)}</strong></div><div class="hmm-trace">${(result.trace||[]).map((step,i)=>`<div class="hmm-step"><span>Report ${step.step||i+1}</span><small>${esc(step.report)}</small><strong>${pct(step.posterior)}</strong></div>`).join("")}</div><p class="form-hint">${esc(result.model||"Hidden Markov filtering")}. The first report updates the initial prior. Occupancy transitions before each later report and once more for the next-slot prediction.</p>`;
  }catch(error){$("occupancy-result").innerHTML="";errorAt("occupancy-error",error.message);}finally{$("evaluate-occupancy").disabled=false;}
}
function applyForecast(){
  errorAt("occupancy-error");const id=$("forecast-resource").value;if(!id){errorAt("occupancy-error","Choose a resource first.");return;}
  try{state.reports[id]=parseReports();invalidatePlan();renderResources();const resource=resourceById(id);notify(`Hypothetical report sequence applied to ${resource.name}. The planner uses its own prior (${pct(resource.prior)}) and fixed 0.80 / 0.35 transition assumptions. Custom lab prior and transitions are not copied.`);}catch(error){errorAt("occupancy-error",error.message);}
}
function renderStorageMode(result){
  state.storageMode=result.storage_mode==="browser"?"browser":"server";
  state.storageAvailable=result.storage_available!==false;
  const browser=state.storageMode==="browser";
  $("storage-title").textContent=browser?"Browser simulation":"Local simulation";
  $("storage-description").textContent=browser?"Reservations stay in this browser profile. They are not shared with other users and do not reserve university facilities.":"Bookings stay on this computer. They do not reserve university facilities.";
  $("storage-mode-note").hidden=!browser;
  $("storage-mode-note").textContent=browser?"Public demo: your simulation reservations are saved in this browser only. They are not shared with other users. "+(result.storage_coordination==="same-origin-web-locks"?"Participating tabs on this site coordinate local writes.":"Use one tab for booking; this browser does not provide coordinated tab writes."):"";
  $("reservation-storage-note").textContent=browser?"Saved only in this browser profile for the selected date. Other users have separate simulation reservations. No real bookings are made.":"Saved in the local demo database for the selected date. No real bookings are made.";
  if(result.storage_error)notify(result.storage_error,true);
}
async function exportCalendar(event){
  if(state.storageMode!=="browser")return;
  event.preventDefault();
  try{
    const calendar=await transport.exportCalendar(day());
    const objectURL=URL.createObjectURL(new Blob([calendar],{type:"text/calendar;charset=utf-8"}));
    const link=document.createElement("a");link.href=objectURL;link.download=`expo_browser_simulation_${day()}.ics`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),1000);
  }catch(error){notify(error.message,true);}
}
async function loadState(initial=true){
  if(!day())return;const requestedDate=day();state.loading=true;updateStats();
  try{const result=await api(`/api/state?date=${encodeURIComponent(requestedDate)}`,undefined,"GET");if(requestedDate!==day())return;
    state.resources=result.resources||[];state.bookings=result.bookings||[];state.scenarios=result.scenarios||[];renderStorageMode(result);
    if(result.floors?.floors)for(const floor of result.floors.floors)floorThemes[floor.floor]=floor.theme;
    if(initial||!$("building-stack").children.length)renderFloorControls();renderResources();renderReservations();renderQueue();
    const previous=$("example-select").value;$("example-select").innerHTML=state.scenarios.map((s,i)=>`<option value="${i}">${esc(s.name)}</option>`).join("");$("example-select").value=previous||"0";
  }catch(error){notify(`Cannot reach the demo server. ${error.message} Refresh the page and try again. For a local copy, start python server.py first.`,true);$("resource-cards").innerHTML='<div class="empty-state"><strong>Demo server unavailable</strong><p>Refresh and try again. For a local copy, start python server.py in the project folder.</p></div>';}
  finally{state.loading=false;updateStats();}
}
function initEvents(){
  $("request-form").addEventListener("submit",addRequest);$("generate-plan").addEventListener("click",generatePlan);
  $("load-example").addEventListener("click",()=>exampleScenario(Number($("example-select").value||0)));
  $("hero-example").addEventListener("click",()=>exampleScenario(state.scenarios.length>1?1:0));
  $("clear-queue").addEventListener("click",()=>{state.queue=[];invalidatePlan();renderQueue();});
  $("request-queue").addEventListener("click",event=>{const button=event.target.closest("[data-remove]");if(button){state.queue=state.queue.filter(r=>r.id!==button.dataset.remove);invalidatePlan();renderQueue();}});
  $("floor-tabs").addEventListener("click",event=>{const button=event.target.closest("[data-floor]");if(button)chooseFloor(button.dataset.floor);});
  $("building-stack").addEventListener("click",event=>{const button=event.target.closest("[data-floor]");if(button)chooseFloor(button.dataset.floor,true);});
  $("resource-search").addEventListener("input",renderResources);$("resource-kind").addEventListener("change",renderResources);
  for(const view of ["cards","timeline"])$("view-"+view).addEventListener("click",()=>{state.view=view;for(const other of ["cards","timeline"]){$("view-"+other).classList.toggle("selected",view===other);$("view-"+other).setAttribute("aria-pressed",String(view===other));}renderResources();});
  $("resource-cards").addEventListener("change",event=>{const select=event.target.closest("[data-report]");if(select&&select.value!=="sequence"){state.reports[select.dataset.report]=select.value;invalidatePlan();}});
  $("resource-cards").addEventListener("click",event=>{const button=event.target.closest("[data-prefill]");if(!button)return;const resource=resourceById(button.dataset.prefill);$("request-kind").value=resource.kind;$("request-floor").value=resource.floor;$("request-people").value=resource.kind==="imac"?1:Math.min(4,resource.capacity);$("request-title").value=`${kindNames[resource.kind]} session`;notify(`Request form set to ${kindNames[resource.kind].toLowerCase()} near floor ${resource.floor}. This is a preference, not a reservation of ${resource.name}.`);$("planner").scrollIntoView({behavior:motion()});$("request-title").focus({preventScroll:true});});
  $("planning-date").addEventListener("change",()=>{invalidatePlan();state.reports={};loadState(false);});
  $("search-method").addEventListener("change",invalidatePlan);$("search-seed").addEventListener("input",invalidatePlan);
  for(const id of ["lab-sensitivity","lab-false-positive"])$(id).addEventListener("input",invalidatePlan);
  $("decision-form").addEventListener("submit",evaluateDecision);$("occupancy-form").addEventListener("submit",evaluateOccupancy);$("apply-forecast").addEventListener("click",applyForecast);
  $("export-calendar").addEventListener("click",exportCalendar);
  $("reservation-list").addEventListener("click",event=>{const button=event.target.closest("[data-cancel]");if(button)cancelBooking(button);});
  const explode=$("explode-building");explode.addEventListener("click",()=>{const expanded=$("building-scene").classList.toggle("exploded");explode.setAttribute("aria-pressed",String(expanded));explode.textContent=expanded?"Reassemble floors":"Separate floors";});
  if(!matchMedia("(prefers-reduced-motion: reduce)").matches){const art=$("building-scene");art.addEventListener("pointermove",event=>{if(event.pointerType==="touch")return;const box=art.getBoundingClientRect();art.style.setProperty("--tilt-x",`${(event.clientX-box.left-box.width/2)/box.width*10}deg`);art.style.setProperty("--tilt-y",`${(event.clientY-box.top-box.height/2)/box.height*-6}deg`);});art.addEventListener("pointerleave",()=>{art.style.setProperty("--tilt-x","0deg");art.style.setProperty("--tilt-y","0deg");});}
  if("IntersectionObserver" in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)for(const link of document.querySelectorAll(".nav-link"))link.classList.toggle("active",link.getAttribute("href")==="#"+entry.target.id);},{rootMargin:"-15% 0px -65% 0px"});for(const section of document.querySelectorAll("section.section"))observer.observe(section);}
}
const now=new Date();$("planning-date").value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
initEvents();renderQueue();loadState().then(()=>{evaluateDecision();evaluateOccupancy();});
