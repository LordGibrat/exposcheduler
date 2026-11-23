(function (root, factory) {
  "use strict";
  const exported = factory(root);
  if (typeof module === "object" && module.exports) module.exports = exported;
  else root.ExpoBookingTransport = exported.ExpoBookingTransport;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const STORAGE_KEY = "expo-smart-scheduler-v1";
  const LOCK_KEY = STORAGE_KEY + ":write";
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  function freeze(value) {
    if (value && typeof value === "object") { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
    return value;
  }
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function validTime(start, end) {
    return Number.isInteger(start) && Number.isInteger(end) && start >= 480 && end <= 1200 && end > start && start % 30 === 0 && end % 30 === 0;
  }
  function overlaps(a, b) { return a.date === b.date && a.start < b.end && b.start < a.end; }
  function related(a, b, resources) {
    if (a === b) return true;
    const parents = id => {
      const result = new Set(); let r = resources.find(item => item.id === id);
      while (r && r.parent_id && !result.has(r.parent_id)) {
        result.add(r.parent_id); r = resources.find(item => item.id === r.parent_id);
      }
      return result;
    };
    return parents(a).has(b) || parents(b).has(a);
  }
  function conflicts(a, b, resources) { return overlaps(a, b) && related(a.resource_id, b.resource_id, resources); }
  function calendarEscape(value) { return String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,"); }
  function foldLine(value) {
    const encoder = new TextEncoder(); const lines = []; let current = "", bytes = 0;
    for (const char of value) {
      const size = encoder.encode(char).length;
      if (bytes + size > 75) { lines.push(current); current = " "; bytes = 1; }
      current += char; bytes += size;
    }
    lines.push(current); return lines.join("\r\n");
  }

  class ExpoBookingTransport {
    constructor(options = {}) {
      this.mode = "server";
      this.storageAvailable = true;
      this.resources = [];
      this._fetch = options.fetchImpl || ((...args) => root.fetch(...args));
      this._getStorage = options.getStorage || (() => options.storage || root.localStorage);
      this._locks = options.locks === undefined ? root.navigator?.locks : options.locks;
      this._uuid = options.uuid || (() => root.crypto?.randomUUID ? root.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      this._now = options.now || (() => Date.now());
      this._plans = new Map();
      this._pendingWrite = Promise.resolve();
    }
    get coordinatedTabs() { return !!this._locks?.request; }
    _storage() {
      try {
        const storage = this._getStorage();
        if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") throw new Error("unavailable");
        return storage;
      } catch { throw new Error("Browser storage is unavailable. Allow local site storage to use simulation reservations. No reservation was saved."); }
    }
    _validateBooking(item) {
      if (!object(item) || typeof item.id !== "string" || !item.id || item.id.length > 120 || typeof item.resource_id !== "string" || !this.resources.some(r => r.id === item.resource_id) || !validDate(item.date) || !validTime(item.start, item.end) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 100) {
        throw new Error("Stored browser reservation data is invalid or no longer matches this inventory. It has not been overwritten. Use this site's browser storage settings to review or remove the demo data.");
      }
      return {id:item.id,resource_id:item.resource_id,date:item.date,start:item.start,end:item.end,title:item.title};
    }
    _readDocument() {
      let raw;
      try { raw = this._storage().getItem(STORAGE_KEY); }
      catch (error) { this.storageAvailable = false; throw error; }
      if (raw === null) { this.storageAvailable = true; return {version:1,bookings:[]}; }
      let parsed;
      try { if (typeof raw !== "string" || raw.length > 2000000) throw new Error(); parsed = JSON.parse(raw); }
      catch { this.storageAvailable = false; throw new Error("Stored browser reservation data cannot be read. It has not been overwritten. Review this site's local storage before continuing."); }
      if (!object(parsed) || parsed.version !== 1 || !Array.isArray(parsed.bookings) || parsed.bookings.length > 2000) {
        this.storageAvailable = false; throw new Error("Stored browser reservations use an unsupported format. No data was overwritten.");
      }
      let bookings;
      try {
        bookings = parsed.bookings.map(item => this._validateBooking(item));
        const ids = new Set();
        for (let i = 0; i < bookings.length; i++) {
          if (ids.has(bookings[i].id)) throw new Error("Duplicate browser reservation IDs were found. No data was overwritten.");
          ids.add(bookings[i].id);
          for (let j = 0; j < i; j++) if (conflicts(bookings[i], bookings[j], this.resources)) throw new Error("Conflicting browser reservations were found in stored data. No data was overwritten.");
        }
      } catch (error) { this.storageAvailable = false; throw error; }
      this.storageAvailable = true; return {version:1,bookings};
    }
    _bookings(date) {
      if (!validDate(date)) throw new Error("Choose a valid planning date.");
      return this._readDocument().bookings.filter(b => b.date === date);
    }
    _save(document) {
      try { this._storage().setItem(STORAGE_KEY, JSON.stringify(document)); this.storageAvailable = true; }
      catch { this.storageAvailable = false; throw new Error("The browser could not save simulation reservations. Storage may be blocked or full. No reservation was saved."); }
    }
    _write(action) {
      // Web Locks coordinate participating tabs on the same origin. This is not
      // a shared university booking service or a cross-user database transaction.
      if (this._locks?.request) return this._locks.request(LOCK_KEY, {mode:"exclusive"}, action);
      const result = this._pendingWrite.then(action, action);
      this._pendingWrite = result.catch(() => {});
      return result;
    }
    async _remote(path, data, method) {
      const options = {method,headers:{Accept:"application/json"}};
      if (data !== undefined) { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(data); }
      const response = await this._fetch(path, options); let result;
      try { result = await response.json(); } catch { throw new Error("The server returned an unreadable response. Try again or check the demo server."); }
      if (!response.ok) throw new Error(result.error || `The request failed (${response.status}).`);
      return result;
    }
    async request(path, data, method = "POST") {
      const url = new URL(path, "https://expo.invalid"); const endpoint = url.pathname;
      if (method === "GET" && endpoint === "/api/state") {
        const result = await this._remote(path, data, method);
        this.mode = result.storage_mode === "browser" ? "browser" : "server";
        this.resources = clone(result.resources || []);
        if (this.mode === "browser") {
          result.storage_coordination = this.coordinatedTabs ? "same-origin-web-locks" : "single-tab-only";
          try { result.bookings = clone(this._bookings(result.date || url.searchParams.get("date"))); result.storage_available = true; }
          catch (error) { result.bookings = []; result.storage_available = false; result.storage_error = error.message; }
        }
        return result;
      }
      if (this.mode !== "browser") return this._remote(path, data, method);
      if (method === "POST" && endpoint === "/api/plan") {
        if (!object(data) || !validDate(data.date) || !Array.isArray(data.requests)) throw new Error("A dated planning batch is required.");
        const input = clone(data); input.bookings = clone(this._bookings(data.date));
        const result = await this._remote(path, input, method);
        if (!object(result) || typeof result.plan_id !== "string" || !Array.isArray(result.assignments)) throw new Error("The planner returned an invalid plan. No reservation was saved.");
        while (this._plans.size >= 64) this._plans.delete(this._plans.keys().next().value);
        this._plans.set(result.plan_id, freeze({result:clone(result),requests:clone(input.requests),date:input.date,expires:this._now()+15*60*1000}));
        return result;
      }
      if (method === "POST" && endpoint === "/api/bookings") return this._commit(data);
      if (method === "DELETE" && endpoint.startsWith("/api/bookings/")) {
        const id = decodeURIComponent(endpoint.slice("/api/bookings/".length));
        return this._write(() => {
          const document = this._readDocument(); const index = document.bookings.findIndex(b => b.id === id);
          if (index < 0) throw new Error("This browser simulation reservation no longer exists.");
          document.bookings.splice(index, 1); this._save(document); return {success:true,simulation:true,storage_mode:"browser"};
        });
      }
      return this._remote(path, data, method);
    }
    _commit(payload) {
      if (!object(payload) || Object.keys(payload).length !== 1 || typeof payload.plan_id !== "string") return Promise.reject(new Error("Reserve a generated plan using its plan ID."));
      return this._write(() => {
        const cached = this._plans.get(payload.plan_id);
        if (!cached || cached.expires < this._now()) throw new Error("This plan has expired or was already saved. Generate a fresh plan.");
        const document = this._readDocument(); const additions = []; const assigned = new Set();
        if (!cached.result.assignments.length) throw new Error("This plan contains no placements to reserve.");
        for (const c of cached.result.assignments) {
          const request = cached.requests.find(r => r.id === c.request_id);
          const resource = this.resources.find(r => r.id === c.resource_id);
          if (!request || !resource || assigned.has(c.request_id) || !validTime(c.start,c.end) || c.end-c.start !== request.duration || c.start < request.earliest || c.end > request.latest || request.group_size > resource.capacity || (request.kind !== "any" && request.kind !== resource.kind) || !Array.isArray(request.features) || request.features.some(f => !resource.features.includes(f)) || (request.accessible && !resource.features.includes("wheelchair"))) {
            throw new Error("The cached plan failed validation. Generate a new plan. No reservation was saved.");
          }
          assigned.add(c.request_id);
          const booking = this._validateBooking({id:this._uuid(),resource_id:c.resource_id,date:cached.date,start:c.start,end:c.end,title:request.title});
          if (document.bookings.concat(additions).some(existing => conflicts(booking,existing,this.resources))) throw new Error("The plan now conflicts with a browser reservation. Generate a fresh plan. No placements from this plan were saved.");
          if (document.bookings.concat(additions).some(existing => existing.id === booking.id)) throw new Error("A reservation ID collision occurred. Generate a fresh plan.");
          additions.push(booking);
        }
        if (document.bookings.length+additions.length > 2000) throw new Error("This browser demo has reached its reservation limit. Cancel old demo reservations first.");
        this._save({version:1,bookings:document.bookings.concat(additions)});
        this._plans.delete(payload.plan_id);
        return {bookings:clone(additions),simulation:true,storage_mode:"browser"};
      });
    }
    async exportCalendar(date) {
      if (this.mode !== "browser") throw new Error("Local-server calendars are exported by the server.");
      const bookings = this._bookings(date).slice().sort((a,b) => a.start-b.start);
      const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Expo Smart Scheduler//Browser Simulation//EN","CALSCALE:GREGORIAN"];
      const stamp = new Date(this._now()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      for (const b of bookings) {
        const d = b.date.replaceAll("-", "");
        const t = value => `${String(Math.floor(value/60)).padStart(2,"0")}${String(value%60).padStart(2,"0")}00`;
        const resource = this.resources.find(r => r.id === b.resource_id);
        lines.push("BEGIN:VEVENT","UID:"+calendarEscape(b.id)+"@expo-simulation.local","DTSTAMP:"+stamp,"DTSTART:"+d+"T"+t(b.start),"DTEND:"+d+"T"+t(b.end),"SUMMARY:"+calendarEscape("[SIMULATION] "+b.title),"LOCATION:"+calendarEscape(resource?.name||b.resource_id),"DESCRIPTION:Browser simulation only. No real booking exists. Floating local times.","END:VEVENT");
      }
      lines.push("END:VCALENDAR"); return lines.map(foldLine).join("\r\n")+"\r\n";
    }
  }
  return {ExpoBookingTransport,STORAGE_KEY};
});
