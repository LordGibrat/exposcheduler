(function (root, factory) {
  "use strict";
  const exported = factory(root);
  if (typeof module === "object" && module.exports) module.exports = exported;
  else {
    root.ExpoFinder = exported;
    if (root.document) exported.createFinder().start();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  // This page only translates one simple search into the existing Python API.
  // Ranking, probability calculations and booking checks remain in the engine.
  const kindNames = {any:"Any suitable space",study_room:"Study room",imac:"Individual iMac",computer_lab:"Whole computer lab",auditorium:"Auditorium",classroom:"Classroom",meeting_room:"Meeting room",lounge:"Lounge"};
  const featureNames = {quiet:"Quiet",projector:"Projector",whiteboard:"Whiteboard",macOS:"macOS",wheelchair:"Step-free access"};
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2,"0")}:${String(minutes % 60).padStart(2,"0")}`;
  const localDate = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const dateLabel = value => {
    const parsed = new Date(value + "T12:00:00Z");
    return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-GB", {weekday:"short",day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(parsed) : value;
  };
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01" || value > "2100-12-31") return false;
    const parsed = new Date(value + "T12:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
  }
  function parseTime(value) {
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return NaN;
    const [hour, minute] = value.split(":").map(Number);
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : NaN;
  }
  function buildPayload(input) {
    if (!validDate(input.date)) throw new Error("Choose a valid date between 2000 and 2100.");
    if (!Object.hasOwn(kindNames, input.kind)) throw new Error("Choose a space type from the list.");
    const start = parseTime(input.start), duration = Number(input.duration);
    if (!Number.isInteger(start) || start < 480 || start > 1170 || start % 30 || ![30,60,90,120,180,240].includes(duration) || start + duration > 1200) {
      throw new Error("Choose a half-hour start and a duration that fits between 08:00 and 20:00. For example, 19:30 allows 30 minutes.");
    }
    const people = Number(input.people), floor = Number(input.floor);
    if (!Number.isInteger(people) || people < 1 || people > 200) throw new Error("Enter a whole number of people from 1 to 200.");
    if (input.kind === "imac" && people !== 1) throw new Error("An individual iMac is for one person. Choose a whole computer lab for a group.");
    if (!Number.isInteger(floor) || floor < 1 || floor > 8) throw new Error("Choose a starting floor from 1 to 8.");
    if (!Array.isArray(input.features) || input.features.some(value => !["quiet","projector","whiteboard","macOS"].includes(value))) throw new Error("Choose equipment from the available options.");
    const rawTitle = String(input.title ?? "").trim();
    if (rawTitle.length > 100 || /[\u0000-\u001f\u007f]/.test(rawTitle)) throw new Error("Use a session name of up to 100 characters, without control characters.");
    const title = rawTitle || (input.kind === "imac" ? "iMac session" : input.kind === "any" ? "Campus session" : `${kindNames[input.kind]} session`);
    return {date:input.date,requests:[{id:"simple-search",title,kind:input.kind,group_size:people,
      features:[...new Set(input.features)].sort(),preferred_floor:floor,earliest:start,latest:start+duration,duration,priority:2,accessible:!!input.accessible}],
      reports:{},assumptions:{sensitivity:.85,false_positive:.15},seed:42,method:"hill"};
  }
  const fact = (label, value) => `<div class="fact"><span class="fact-label">${esc(label)}</span><strong class="fact-value">${esc(value)}</strong></div>`;
  const proof = (number, title, value) => `<div class="ai-proof"><span class="ai-proof-number">${number}</span><div><strong>${esc(title)}</strong><p>${esc(value)}</p></div></div>`;
  function resultMarkup(plan, request, resource, date) {
    const c = plan.assignments[0], route = c.route || {}, diagnostics = plan.diagnostics || {};
    const belief = Number(c.belief), difference = Number(plan.score) - Number(plan.baseline_score);
    const finiteBelief = Number.isFinite(belief) && belief >= 0 && belief <= 1;
    const routeMinutes = Number.isFinite(route.cost) ? route.cost.toFixed(1) : "Not supplied";
    const scoreText = Number.isFinite(difference) ? `${difference >= 0 ? "+" : ""}${difference.toFixed(1)} assumed utility units vs first-fit.` : "Compared with the same first-fit baseline.";
    const count = diagnostics.candidate_counts?.[request.id];
    const advice = c.decision_advice, actionNames = {book:"Book",inspect:"Inspect",wait:"Wait",leave:"Leave"};
    const adviceText = advice && Object.hasOwn(actionNames,advice.action) ? `${actionNames[advice.action]} is the separate occupancy advisory, using a ${advice.horizon || 3}-step belief model. It does not rank spaces or block a simulation reservation.` : "Separate occupancy advice is available in the AI workspace; it is not a ranking term.";
    const features = Array.isArray(resource.features) ? resource.features : [];
    return `<article class="result-card" data-resource-id="${esc(resource.id)}" data-start="${c.start}">
      <div class="result-topline"><span class="result-label">YOUR RECOMMENDED SPACE</span><span class="status-badge">Fits your request</span>
      <h3 class="result-title" id="finder-result-title" tabindex="-1">${esc(resource.name)}</h3>
      <p class="result-subtitle">${esc(kindNames[resource.kind] || resource.kind)} <span aria-hidden="true">/</span> Floor ${esc(resource.floor)} <span aria-hidden="true">/</span> ${esc(resource.id)}</p></div>
      <div class="result-body">
      <div class="result-facts">${fact("When",`${time(c.start)}–${time(c.end)}`)}${fact("Date",dateLabel(date))}${fact("For your group",`${request.group_size} ${request.group_size === 1 ? "person" : "people"} · ${resource.capacity} seats`)}${fact("Duration",`${c.end-c.start} minutes`)}</div>
      <div class="result-features">${features.map(f => `<span class="result-feature">${esc(featureNames[f] || f)}</span>`).join("")}</div>
      <div class="result-why"><strong>Why this space?</strong><p>It fits ${request.group_size} ${request.group_size === 1 ? "person" : "people"}, matches your required equipment${request.accessible ? " and step-free access" : ""}, and has no conflicting reservation in this simulation for ${time(c.start)}–${time(c.end)}. ${Number.isInteger(count) ? `${count} feasible ${count === 1 ? "option was" : "options were"} considered for your request.` : ""}</p></div>
      <div class="result-actions"><button id="find-choose" class="primary-button" type="button" data-resource-id="${esc(resource.id)}" data-start="${c.start}">Choose this space <span aria-hidden="true">↗</span></button><p>Review first. Confirm a simulation reservation next.</p></div>
      <section class="result-ai" id="result-ai" aria-labelledby="result-ai-title"><h3 id="result-ai-title">AI behind this result</h3><p>AI Fundamentals methods and their specific role in this recommendation.</p><div class="ai-proof-grid">
        ${proof("01","Constraint satisfaction",`Capacity, equipment, exact time, local conflicts${request.accessible ? " and step-free access" : ""} checked before ranking.`)}
        ${proof("02","Hill climbing",`${scoreText} Five seeded starts; no general guarantee of a global optimum.`)}
        ${proof("03","A* graph search",`${routeMinutes}${Number.isFinite(route.cost) ? " assumed walking minutes" : ""} from Floor ${request.preferred_floor}. Toy floor graph, not real navigation.`)}
        ${proof("04","Bayesian availability model",finiteBelief ? `Prior retained (no report). Modelled P(free): ${Math.round(belief*100)}%. No noisy-observation update was performed. Not live occupancy.` : "Prior retained (no report). No noisy-observation update was performed; no live occupancy is measured.")}
        ${proof("05","Hidden Markov model","Not active for this search: no report sequence. Try hypothetical sequences in the AI workspace.")}
        ${proof("06","Sequential decision making",adviceText)}
      </div><details><summary>Technical evidence & route</summary><p>${esc(c.explanation || "The Python engine checked the request against the sample inventory.")}</p>${Array.isArray(route.path) ? `<p class="route-text">${route.path.map(esc).join(" → ")}</p>` : ""}<p>Ranking objective: 100 × priority + 30 × P(free) − 1.2 × delay slots − 1.5 × assumed travel minutes − 0.1 × spare seats. This search fixes priority to 2 and delay to zero.</p><p>The sequential advisor uses finite-horizon backward recursion, not value iteration. Inspection adds a noisy observation; waiting changes the occupancy belief. Advice is separate from calendar feasibility.</p></details><a class="text-button" href="/#uncertainty">Explore probabilities & sequential decisions in the AI workspace ↗</a></section></div>
    </article>`;
  }
  function createFinder(options = {}) {
    const document = options.document || root.document;
    const transport = options.transport || new root.ExpoBookingTransport();
    const $ = id => document.getElementById(id);
    const state = {resources:[],bookings:[],date:null,ready:false,available:true,loading:false,searching:false,committing:false,
      version:0,loadVersion:0,plan:null,input:null,planSignature:null,review:false,cancelling:new Set(),previousPeople:"4"};
    const getInput = () => ({date:$("find-date").value,kind:$("find-kind").value,start:$("find-start").value,
      duration:$("find-duration").value,people:$("find-people").value,floor:$("find-floor").value,
      accessible:$("find-accessible").checked,title:$("find-title")?.value || "",
      features:[...document.querySelectorAll('input[name="feature"]:checked')].map(node => node.value)});
    const inputSignature = () => JSON.stringify(getInput());
    const say = message => { $("find-status").textContent = message; };
    const fail = message => { $("find-error").textContent = message; $("find-error").hidden = !message; };
    const phase = value => { $("find-results").dataset.phase = value; $("find-results").setAttribute("aria-busy",String(value === "loading")); };
    function controls() {
      // Search also retries a failed inventory/storage check. Keeping this
      // button usable after an error avoids requiring a page reload to recover.
      $("find-submit").disabled = state.loading || state.searching || state.committing;
      $("find-submit").textContent = state.searching ? "Finding your space…" : "Find my space";
      $("find-confirm").disabled = state.committing || !state.plan || !state.review || !state.available;
      $("find-confirm").textContent = state.committing ? "Saving simulation reservation…" : "Confirm simulation reservation";
      $("find-back").disabled = state.committing;
      $("find-export").disabled = !state.available || !state.ready || state.loading;
    }
    function syncKind() {
      const people = $("find-people");
      if ($("find-kind").value === "imac") {
        if (!people.disabled) state.previousPeople = people.value || "4";
        people.value = "1"; people.disabled = true;
      } else if (people.disabled) { people.disabled = false; people.value = state.previousPeople; }
    }
    function invalidate(message = "Your search details changed. Find a space again to get a current recommendation.") {
      state.version++; state.plan = null; state.input = null; state.planSignature = null; state.review = false;
      $("find-review").hidden = true;
      $("find-results").innerHTML = `<div class="empty-result"><span class="result-label">READY WHEN YOU ARE</span><h3>Find a space that fits.</h3><p>${esc(message)}</p></div>`;
      phase("stale"); fail(""); controls();
    }
    function renderStorage() {
      const browser = transport.mode === "browser";
      $("finder-storage-note").textContent = browser ? `Simulation only. Reservations are saved in this browser and shared with the AI workspace on this device.${transport.coordinatedTabs ? "" : " Use one tab when saving."} No university booking is made.` : "Simulation only. Reservations are saved in the local demo database on this computer. No university booking is made.";
      $("finder-inventory-count").textContent = String(state.resources.length);
    }
    function renderReservations() {
      const target = $("find-reservations"), date = $("find-date").value;
      if (!validDate(date)) { target.innerHTML = '<div class="empty-result"><p>Choose a valid search date to view your simulation reservations.</p></div>'; return; }
      const bookings = state.bookings.filter(b => b.date === date).slice().sort((a,b) => a.start-b.start || a.resource_id.localeCompare(b.resource_id));
      $("reservation-status").textContent = `${dateLabel(date)} · ${bookings.length} simulation ${bookings.length === 1 ? "reservation" : "reservations"}`;
      target.innerHTML = bookings.length ? bookings.map(b => {
        const r = state.resources.find(item => item.id === b.resource_id);
        return `<article class="reservation-card" data-booking-id="${esc(b.id)}"><div><span class="result-label">${time(b.start)}–${time(b.end)} · FLOOR ${esc(r?.floor || "?")}</span><h3>${esc(b.title)}</h3><p class="reservation-meta">${esc(r?.name || b.resource_id)} · ${esc(dateLabel(b.date))}</p><span class="status-badge">Simulation reservation</span></div><button type="button" class="secondary-button" data-cancel-id="${esc(b.id)}" ${state.cancelling.has(b.id) || state.committing ? "disabled" : ""}>${state.cancelling.has(b.id) ? "Cancelling…" : "Cancel simulation"}</button></article>`;
      }).join("") : '<div class="empty-result"><h3>Your day is open.</h3><p>Confirmed simulation reservations for your selected date will appear here.</p></div>';
    }
    async function loadState() {
      const date = $("find-date").value, loadVersion = ++state.loadVersion;
      if (!validDate(date)) { state.ready = false; renderReservations(); controls(); return false; }
      state.loading = true; controls();
      try {
        const result = await transport.request(`/api/state?date=${encodeURIComponent(date)}`,undefined,"GET");
        if (loadVersion !== state.loadVersion || date !== $("find-date").value) return false;
        state.resources = result.resources || []; state.bookings = result.bookings || []; state.date = date;
        state.available = result.storage_available !== false; state.ready = true;
        renderStorage(); renderReservations();
        if (!state.available) fail(result.storage_error || "Allow local browser storage to make simulation reservations.");
        return state.available;
      } catch (error) {
        if (loadVersion === state.loadVersion && date === $("find-date").value) {
          state.ready = false; fail(error.message); $("reservation-status").textContent = "Reservations could not be refreshed. Try again shortly.";
        }
        return false;
      } finally { if (loadVersion === state.loadVersion) { state.loading = false; controls(); } }
    }
    async function search(event) {
      event?.preventDefault();
      if (state.searching || state.committing || state.loading) return;
      fail(""); let payload;
      try { payload = buildPayload(getInput()); } catch (error) { fail(error.message); return; }
      state.plan = null; state.input = null; state.review = false; $("find-review").hidden = true;
      state.searching = true; const version = state.version, signature = inputSignature(); controls(); phase("loading");
      $("find-results").innerHTML = '<div class="empty-result"><span class="result-label">SEARCHING THE SAMPLE CAMPUS</span><h3>Checking what fits…</h3><p>Matching your time, group and equipment, then comparing suitable spaces.</p></div>';
      say("Searching the sample inventory. No reservation has been made.");
      try {
        if (!await loadState()) throw new Error($("find-error").textContent || "The inventory is not ready. Try again.");
        if (version !== state.version || signature !== inputSignature()) return;
        const result = await transport.request("/api/plan",payload);
        if (version !== state.version || signature !== inputSignature()) return;
        if (!Array.isArray(result.assignments) || typeof result.plan_id !== "string") throw new Error("The planner returned an incomplete result. Try a fresh search.");
        if (!result.assignments.length) {
          $("find-results").innerHTML = `<div class="empty-result"><span class="result-label">NO MATCH FOR THESE DETAILS</span><h3>Let’s make a little room.</h3><p>No suitable space fits your exact time, group and equipment without a simulation conflict. Try a different time, fewer people, or fewer required features.</p><p>${esc(result.unassigned?.[0]?.reason || "")}</p></div>`;
          phase("empty"); say("No matching space found. No reservation was made."); return;
        }
        const placement = result.assignments[0], request = payload.requests[0], resource = state.resources.find(r => r.id === placement.resource_id);
        if (result.assignments.length !== 1 || !resource || placement.request_id !== request.id || placement.start !== request.earliest || placement.end !== request.latest) throw new Error("The returned placement does not match this search. Try again.");
        state.plan = result; state.input = payload; state.planSignature = signature;
        $("find-results").innerHTML = resultMarkup(result,request,resource,payload.date); phase("ready");
        say(`Recommended: ${resource.name}, Floor ${resource.floor}, ${time(placement.start)} to ${time(placement.end)}. Choose this space to review it.`);
        $("finder-result-title")?.focus();
      } catch (error) {
        if (version === state.version) {
          fail(error.message); phase("error");
          $("find-results").innerHTML = '<div class="empty-result"><h3>We couldn’t finish this search.</h3><p>Check the message above, then try again. No reservation was made.</p></div>';
          say("Search did not complete. No reservation was made.");
        }
      } finally { state.searching = false; if (version !== state.version) say("Your details changed while searching. Find a space again."); controls(); }
    }
    function choose() {
      if (!state.plan || !state.input || state.committing) return;
      if (state.planSignature !== inputSignature()) { invalidate(); fail("Your details changed. Find a space again before choosing it."); return; }
      const c = state.plan.assignments[0], resource = state.resources.find(r => r.id === c.resource_id), request = state.input.requests[0];
      $("find-review-content").innerHTML = `<h3>${esc(resource.name)}</h3><p>${esc(request.title)}</p><div class="result-facts">${fact("Date",dateLabel(state.input.date))}${fact("Time",`${time(c.start)}–${time(c.end)}`)}${fact("Location",`Floor ${resource.floor}`)}${fact("People",request.group_size)}</div><p>This creates a simulation reservation ${transport.mode === "browser" ? "in this browser" : "in the local demo database"}. It does not reserve a university facility. Conflicts are checked again when you confirm.</p>`;
      state.review = true; $("find-review").hidden = false; controls(); $("find-confirm").focus();
    }
    function back() { if (state.committing) return; state.review = false; $("find-review").hidden = true; controls(); $("find-choose")?.focus(); }
    async function confirm() {
      if (!state.plan || !state.input || !state.review || state.committing) return;
      if (state.planSignature !== inputSignature()) { invalidate(); fail("Your details changed. Find a space again before confirming."); return; }
      const plan = state.plan, input = state.input, resource = state.resources.find(r => r.id === plan.assignments[0].resource_id);
      state.committing = true; controls(); renderReservations(); fail(""); say("Saving your simulation reservation…");
      try {
        const result = await transport.request("/api/bookings",{plan_id:plan.plan_id});
        if (!Array.isArray(result.bookings) || !result.bookings.length) throw new Error("The save response was incomplete. Check My reservations before trying again.");
        const b = result.bookings[0];
        // A successful save must be acknowledged even if inputs changed while it ran.
        state.plan = null; state.input = null; state.review = false; $("find-review").hidden = true;
        $("find-results").innerHTML = `<article class="receipt-card" data-booking-id="${esc(b.id)}"><span class="status-badge">SIMULATION SAVED</span><h3 tabindex="-1" id="finder-receipt-title">Your space is on the calendar.</h3><p>${esc(input.requests[0].title)}</p><div class="result-facts">${fact("Space",resource?.name || b.resource_id)}${fact("Date",dateLabel(b.date || input.date))}${fact("Time",`${time(b.start)}–${time(b.end)}`)}${fact("Floor",resource?.floor || "?")}</div><p>${transport.mode === "browser" ? "Saved in this browser. Other users do not share this reservation." : "Saved in the local demo database on this computer."} No real campus booking has been made.</p><a class="secondary-button" href="#my-reservations">View my simulation reservations</a></article>`;
        phase("saved"); say("Simulation reservation saved. No real campus booking was made."); $("finder-receipt-title")?.focus();
        await loadState();
      } catch (error) {
        // Invalidate after any failed/ambiguous save; never invite a blind retry.
        state.plan = null; state.input = null; state.review = false; $("find-review").hidden = true;
        fail(`${error.message} Refresh My reservations, then run a fresh search before confirming again.`);
        $("find-results").innerHTML = '<div class="empty-result"><h3>Check your simulation calendar.</h3><p>The confirmation could not be completed here. Review My reservations before searching again.</p></div>';
        phase("error"); say("Confirmation needs attention. Check My reservations before trying again."); await loadState();
      } finally { state.committing = false; controls(); renderReservations(); }
    }
    async function cancel(id) {
      if (state.committing || state.cancelling.has(id) || !state.bookings.some(b => b.id === id)) return;
      state.cancelling.add(id); renderReservations(); fail("");
      try {
        await transport.request(`/api/bookings/${encodeURIComponent(id)}`,undefined,"DELETE");
        invalidate("Your simulation calendar changed. Search again for a current recommendation.");
        say("Simulation reservation cancelled. No real campus booking was changed."); await loadState();
      } catch (error) { fail(error.message); }
      finally { state.cancelling.delete(id); renderReservations(); }
    }
    async function exportCalendar() {
      fail(""); const date = $("find-date").value;
      if (!validDate(date)) { fail("Choose a valid date before exporting the calendar."); return; }
      try {
        if (transport.mode !== "browser") { root.location.href = `/api/export?date=${encodeURIComponent(date)}`; return; }
        const text = await transport.exportCalendar(date);
        const blob = new root.Blob([text], {type:"text/calendar;charset=utf-8"}), url = root.URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = `expo_simulation_${date}.ics`;
        document.body.appendChild(link); link.click(); link.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url),1000);
        say("Simulation calendar exported. Times use local wall-clock time.");
      } catch (error) { fail(error.message); }
    }
    async function start() {
      $("find-date").value ||= localDate();
      phase("initial"); syncKind(); controls();
      $("finder-form").addEventListener("submit",search);
      $("finder-form").addEventListener("input",event => { if (event.target.id === "find-kind") syncKind(); invalidate(); if (event.target.id === "find-date") { state.ready = false; state.bookings = []; renderReservations(); controls(); } });
      // Select changes also cover browsers that do not emit input for selects.
      $("find-kind").addEventListener("change",() => { syncKind(); invalidate(); });
      $("find-date").addEventListener("change",() => { invalidate(); loadState(); });
      $("find-results").addEventListener("click",event => { if (event.target.closest("#find-choose")) choose(); });
      $("find-back").addEventListener("click",back); $("find-confirm").addEventListener("click",confirm);
      $("find-reservations").addEventListener("click",event => { const button = event.target.closest("[data-cancel-id]"); if (button) cancel(button.dataset.cancelId); });
      $("find-export").addEventListener("click",event => { event.preventDefault(); exportCalendar(); });
      root.addEventListener?.("storage",event => { if (event.key === "expo-smart-scheduler-v1" || event.key === null) { if (!state.committing) invalidate("Your simulation calendar changed in another tab. Search again to check the latest conflicts."); loadState(); } });
      root.addEventListener?.("pageshow",event => { if (event.persisted) { invalidate(); loadState(); } });
      await loadState();
      if (state.ready && state.available) say("Choose your time and group size. Search returns one recommended space from the sample inventory.");
    }
    return {state,start,search,choose,back,confirm,cancel,loadState,invalidate,getInput,syncKind,exportCalendar};
  }
  return {buildPayload,validDate,parseTime,time,localDate,esc,resultMarkup,createFinder};
});
