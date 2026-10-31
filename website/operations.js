/* Operations: live overview (satellite map + schedule + fleet) and dispatch board (#board).
   Data: ops_board, schedule_trips, vessels. Cursor 2026-10-27: home matches live-view mockup. */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  // Cursor 2026-10-27: overlay date/time fields need showPicker — opacity:0 inputs do not open on Windows.
  function bindPicker(el) {
    if (!el) return;
    el.addEventListener("click", function () {
      try { if (el.showPicker) el.showPicker(); } catch (e) {}
    });
  }
  var company = null, canOps = false;
  var tab = "today", q = "", statusF = "", routeF = "", vesselF = "", dayF = "";
  var viewDay = "";    // Cursor 2026-10-27: home calendar day (blank = today); past dates load from the API.
  var tripFrom = "", tripTo = "";
  var trips = [];      // schedule_trips rows mapped by view()
  var queue = [];      // ops_board.queue
  var kp = null;       // ops_board.kpis
  var routes = [], vessels = [], staff = []; // staff: [{id, name, jobTitle, crewGroup}] active employees (captain picker)
  var heldReasons = {}; // tripId -> latest "Held at departure" trip_events detail, for trips stuck past their time
  var rosterByDay = {}; // iso day -> {uid: shiftCode}, loaded on demand for the seat picker
  var pageView = "home"; // home | board — Cursor 2026-10-27: mockup live view vs dispatch board
  var ntx = null; // Cursor 2026-10-27: Add New Trip wizard draft
  var liveMap = null, liveMapBase = "sat", liveMapView = { center: [4.25, 73.55], zoom: 9 }; // Cursor 2026-10-27: free Esri satellite on Live Vessel Map

  function icon(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; }
  function kpiIcon(p, filled) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (filled ? ' class="is-fill"' : "") + '>' + p + '</svg>';
  }
  var I = {
    boat: '<path d="M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 4 3 20h18L12 4ZM12 10v4M12 17h.01"/>',
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    person: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    more: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    warn: '<path d="M12 4 3 20h18L12 4ZM12 10v4M12 17h.01"/>',
    ok: '<path d="m5 12 5 5 9-10"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    pin: '<path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    vessel: '<path d="M3 16h18l-2 4H5l-2-4ZM6 16V9h12v7M9 9V6h6v3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    phone: '<path d="M5 4h4l1.5 4L8 9.5a12 12 0 0 0 6.5 6.5L16 14l4 1.5V20a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M13 10h5M13 14h3"/>',
    print: '<path d="M6 9V4h12v5M6 14H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2M6 14h12v6H6z"/>',
    hourglass: '<path d="M6 4h12M6 20h12M8 4v3l4 5-4 5v3M16 4v3l-4 5 4 5v3"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    // Cursor 2026-10-27: KPI glyphs for the solid round wells (white on colour).
    kpiBoat: '<path fill="currentColor" d="M4 14.2h16l-1.5 3.4A2 2 0 0 1 16.6 19H7.4a2 2 0 0 1-1.9-1.4L4 14.2Zm2-1.1V8.4h3.1V5.8h5.8v2.6H18v4.7H6Z"/>',
    kpiOk: '<path d="M7 12.2 10.4 16 17.2 8"/>',
    kpiAlert: '<path fill="currentColor" fill-rule="evenodd" d="M12 3.4 21.7 20.2H2.3L12 3.4Zm0 5.8c.5 0 .9.4.9.9v4.3a.9.9 0 1 1-1.8 0V10c0-.5.4-.9.9-.9Zm0 7.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/>',
    kpiOff: '<path d="M8 8l8 8M16 8l-8 8"/>',
    // Cursor 2026-10-27: Add New Trip wizard (back chevron + info well).
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    swap: '<path d="M7 7h11M15 4l3 3-3 3M17 17H6M9 14l-3 3 3 3"/>',
    hdots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    bag: '<rect x="6" y="8" width="12" height="12" rx="2"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    money: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M8 14h3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
  };
  function slug(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function chip(text, cls) { return '<span class="chip ' + (cls || "st-" + slug(text)) + '">' + esc(text) + '</span>'; }
  function initials(name) {
    var s = String(name == null || name === "" ? "?" : name).trim();
    return s.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase() || "?";
  }
  function seatPct(booked, total) {
    if (total == null || total <= 0 || booked == null) return null;
    return Math.max(0, Math.round((Number(booked) / Number(total)) * 100));
  }
  // Passenger load vs vessel seats: ok → almost (≥85%) → full (≥100%).
  function loadState(booked, total) {
    var pct = seatPct(booked, total);
    if (pct == null) return { pct: null, level: "", label: "", cls: "" };
    if (pct >= 100) return { pct: pct, level: "full", label: "Vessel full", cls: "load-full" };
    if (pct >= 85) return { pct: pct, level: "almost", label: "Almost full", cls: "load-almost" };
    return { pct: pct, level: "ok", label: "", cls: "" };
  }
  function loadChip(booked, total) {
    var s = loadState(booked, total);
    if (!s.level || s.level === "ok") return "";
    return '<span class="ops-load-chip ' + s.cls + '">' + esc(s.label) + '</span>';
  }
  function loadBanner(booked, total, vesselName) {
    var s = loadState(booked, total);
    if (!s.level || s.level === "ok") return "";
    var who = vesselName ? esc(vesselName) : "This vessel";
    var msg = s.level === "full"
      ? who + " is full — no seats left for more passengers."
      : who + " is almost full (" + s.pct + "% of seats booked).";
    return '<div class="ops-load-banner ' + s.cls + '" role="status">' + icon(I.alert) + '<span>' + msg + '</span></div>';
  }
  function statusTone(status) {
    var s = slug(status);
    if (s === "delayed") return "amber";
    if (s === "cancelled") return "rose";
    if (s === "on-time" || s === "arrived" || s === "completed") return "teal";
    if (s === "boarding" || s === "departed" || s === "in-transit" || s === "en-route") return "live";
    return "slate";
  }
  function loadBar(booked, total) {
    var s = loadState(booked, total);
    var label = (booked != null ? booked : "—") + " / " + (total != null ? total : "—");
    if (s.pct == null) return '<span class="ops-load ops-load-na">' + icon(I.person) + ' ' + esc(label) + '</span>';
    var fill = s.level === "full" ? " hot" : s.level === "almost" ? " warm" : (s.pct >= 70 ? " warm" : "");
    var tip = s.label ? s.label + " · " + s.pct + "%" : s.pct + "% full";
    return '<span class="ops-load ' + s.cls + '" title="' + esc(tip) + '">' +
      '<span class="ops-load-track"><span class="ops-load-fill' + fill + '" style="width:' + Math.min(100, s.pct) + '%"></span></span>' +
      '<span class="ops-load-txt">' + esc(label) + '</span>' +
      (s.label ? '<span class="ops-load-tag">' + esc(s.label) + '</span>' : "") +
    '</span>';
  }
  function journeyStrip(origin, dest, compact) {
    var a = origin || "Origin", b = dest || "Destination";
    return '<div class="ops-journey' + (compact ? " compact" : "") + '">' +
      '<span class="ops-port"><span class="ops-dot"></span><span class="ops-port-name">' + esc(a) + '</span></span>' +
      '<span class="ops-rail" aria-hidden="true"><span class="ops-rail-line"></span><span class="ops-rail-boat">' + icon(I.boat) + '</span></span>' +
      '<span class="ops-port end"><span class="ops-dot"></span><span class="ops-port-name">' + esc(b) + '</span></span>' +
      '</div>';
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayIso() { return iso(new Date()); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); }
  function viewDayIso() { return viewDay || todayIso(); }
  function isViewingToday() { return viewDayIso() === todayIso(); }
  function dayLoaded(day) { return !!(tripFrom && tripTo && day >= tripFrom && day <= tripTo); }
  function tripWindow(focus) {
    var today = todayIso();
    var from = addDays(today, -14);
    var to = addDays(today, 32);
    if (focus && focus < from) from = addDays(focus, -7);
    if (focus && focus > to) to = addDays(focus, 14);
    return { from: from, to: to };
  }
  function rpc(name, args) {
    return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; });
  }
  var CLOSED = ["Cancelled", "Arrived", "Completed"];

  // schedule_trips row → board row. "On time" is shown for a cleared trip that is still Scheduled (not stored).
  function view(t) {
    var d = new Date(t.depart_at);
    var arr = t.arrive_at ? new Date(t.arrive_at) : null;
    var crewList = Array.isArray(t.crew) ? t.crew : [];
    var status = t.status === "Scheduled" && t.cleared_at ? "On time" : t.status;
    if (status === "Departed" || status === "In transit") status = "En Route";
    return {
      id: t.id, code: t.code, day: iso(d), time: pad2(d.getHours()) + ":" + pad2(d.getMinutes()),
      arrive: arr ? pad2(arr.getHours()) + ":" + pad2(arr.getMinutes()) : "",
      route: t.route, route_id: t.route_id,
      origin: t.origin || "", destination: t.destination || "",
      corridor: (t.origin || "") + " → " + (t.destination || ""),
      vessel: t.vessel || "", vessel_id: t.vessel_id, vesselCode: t.vessel_code || "", vesselKind: t.kind, captain: t.captain,
      crewCount: crewList.length, crewList: crewList, departTs: d.getTime(), arriveTs: arr ? arr.getTime() : null, reason: t.status_reason || "",
      booked: t.seats_booked, capacity: t.seats_total, cleared: !!t.cleared_at,
      status: status, raw: t
    };
  }

  /* ---------- modern board helpers ---------- */
  function vesselOf(t) { return (vessels || []).filter(function (v) { return v.id === t.vessel_id; })[0]; }
  function mixOf(t) { var v = vesselOf(t), m = v && v.meta && v.meta.crew_mix; return Array.isArray(m) ? m : []; }
  // Crew needed on a trip (vessel crew needs, captain included) and how many are on it now.
  function crewFill(t) {
    var need = mixOf(t).reduce(function (n, x) { return n + (Number(x.n) || 0); }, 0);
    return { have: (t.captain ? 1 : 0) + (t.crewCount || 0), need: need };
  }
  function avatars(t, max) {
    var names = (t.captain ? [{ name: t.captain, role: "Captain" }] : []).concat((t.crewList || []).map(function (c) { return { name: c.name, role: c.role }; }));
    if (!names.length) return '<span class="ops-av-empty">No crew</span>';
    var shown = names.slice(0, max || 4);
    return '<span class="ops-avs">' + shown.map(function (x, i) {
      return '<span class="ops-av r-' + slug(x.role || "crew") + '" style="z-index:' + (10 - i) + '" title="' + esc((x.name || "") + " · " + (x.role || "")) + '">' + esc(initials(x.name)) + '</span>';
    }).join("") + (names.length > shown.length ? '<span class="ops-av more">+' + (names.length - shown.length) + '</span>' : "") + '</span>';
  }
  function fillChip(t) {
    var f = crewFill(t); if (!f.need) return "";
    var cls = f.have >= f.need ? "full" : f.have ? "part" : "none";
    return '<span class="ops-fill ' + cls + '" title="Crew on this trip / crew the vessel needs">' + f.have + "/" + f.need + ' crew</span>';
  }
  function untilText(ms) {
    var m = Math.round(ms / 60000); if (m <= 0) return "now";
    if (m < 60) return "in " + m + " min";
    var h = Math.floor(m / 60), r = m % 60; return "in " + h + "h" + (r ? " " + pad2(r) + "m" : "");
  }
  function progressOf(t) {
    if (!t.arriveTs) return null; var now = Date.now();
    if (now <= t.departTs) return 0; if (now >= t.arriveTs) return 100;
    return Math.round((now - t.departTs) * 100 / (t.arriveTs - t.departTs));
  }
  function isLive(t) { return t.status === "Boarding" || t.status === "En Route"; }
  // Scheduled/Boarding past departure are "held" (the DB holds them, it does not auto-delay — see 0045).
  function isHeld(t) {
    if (!t.departTs || t.departTs > Date.now()) return false;
    var raw = (t.raw && t.raw.status) || t.status;
    if (CLOSED.indexOf(raw) >= 0 || raw === "Cancelled" || raw === "Delayed") return false;
    if (raw === "Departed" || raw === "In transit") return false;
    return true;
  }
  function holdReasonText(detail) {
    if (!detail) return "";
    var m = /Held at departure\s*—\s*([^(]+)/i.exec(detail);
    return (m ? m[1] : detail).trim();
  }
  // Best-effort reason when no trip_events row has landed yet (cron logs hourly) — mirrors ops_auto()'s checks.
  function fallbackHoldReason(t) {
    if (!t.vessel_id) return "no vessel assigned";
    var v = vesselOf(t);
    if (v && v.status === "Out of service") return "vessel out of service";
    if (!t.raw.captain_id) return "no captain assigned";
    if (!t.cleared) return "not cleared for dispatch";
    return "waiting to depart";
  }
  function heldReasonFor(t) { return holdReasonText(heldReasons[t.id]) || fallbackHoldReason(t); }
  function tabCounts() {
    var today = todayIso(), c = { today: 0, upcoming: 0, crew: 0, completed: 0, cancelled: 0 };
    trips.forEach(function (t) {
      var st = t.raw.status;
      if (t.day === today) c.today++;
      if (t.day > today && CLOSED.indexOf(st) < 0) c.upcoming++;
      if (t.day === (dayF || today) && CLOSED.indexOf(st) < 0) { var f = crewFill(t); if (!f.need || f.have < f.need) c.crew++; }
      if (st === "Arrived" || st === "Completed") c.completed++;
      if (st === "Cancelled") c.cancelled++;
    });
    return c;
  }
  // Today: the next sailing and anything under way right now.
  function liveStrip() {
    if (tab !== "today" || dayF) return "";
    var now = Date.now(), today = todayIso();
    var live = trips.filter(function (t) { return t.day === today && isLive(t); });
    var next = trips.filter(function (t) { return t.departTs > now && CLOSED.indexOf(t.raw.status) < 0 && t.raw.status !== "Cancelled"; }).sort(function (a, b) { return a.departTs - b.departTs; })[0];
    if (!live.length && !next) return "";
    return '<div class="ops-live">' +
      (next ? '<button type="button" class="ops-next" data-trip="' + esc(next.id) + '">' +
        '<span class="ops-next-k">Next departure</span>' +
        '<span class="ops-next-time"><strong>' + esc(next.time) + '</strong><em data-until="' + next.departTs + '">' + esc(untilText(next.departTs - now)) + '</em></span>' +
        '<span class="ops-next-route">' + esc(next.origin || "") + ' ' + icon(I.arrow) + ' ' + esc(next.destination || "") + '</span>' +
        '<span class="ops-next-meta">' + icon(I.vessel) + esc(next.vesselCode || next.vessel || "No vessel") + ' · ' + esc(next.code || "") + '</span>' +
        '<span class="ops-next-crew">' + avatars(next, 5) + fillChip(next) + '</span></button>' : "") +
      (live.length ? '<div class="ops-under-way"><span class="ops-next-k"><i class="ops-pulse"></i>Under way now</span>' + live.map(function (t) {
        var p = progressOf(t), held = isHeld(t);
        return '<button type="button" class="ops-uw' + (held ? " is-held" : "") + '" data-trip="' + esc(t.id) + '"><span class="ops-uw-top"><strong>' + esc(t.vesselCode || t.vessel || t.code) + '</strong><small>' + esc(t.origin) + ' → ' + esc(t.destination) + '</small>' + chip(statusLabel(t.status)) + '</span>' +
          (held ? '<span class="ops-uw-reason">' + icon(I.alert) + ' Held — ' + esc(heldReasonFor(t)) + '</span>' : "") +
          '<span class="ops-uw-bar"><span style="width:' + (p == null ? 0 : p) + '%"></span><i style="left:' + (p == null ? 0 : p) + '%">' + icon(I.boat) + '</i></span>' +
          '<span class="ops-uw-foot"><small>' + esc(t.time) + '</small><small>' + (t.arrive ? "arr " + esc(t.arrive) : "") + '</small></span></button>';
      }).join("") + '</div>' : "") +
    '</div>';
  }
  function dayLabel(day) {
    var d = new Date(day + "T00:00:00"), today = todayIso();
    if (day === today) return "Today";
    if (day === addDays(today, 1)) return "Tomorrow";
    if (day === addDays(today, -1)) return "Yesterday";
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  }
  // Upcoming / Completed / Cancelled: trips grouped under day headers.
  function listByDay(list) {
    if (tab === "today" && !dayF) return '<div class="ops-list">' + list.map(tripRow).join("") + '</div>';
    var days = [], by = {};
    list.forEach(function (t) { if (!by[t.day]) { by[t.day] = []; days.push(t.day); } by[t.day].push(t); });
    if (tab === "completed" || tab === "cancelled") days.reverse();
    return days.map(function (d) {
      return '<div class="ops-day"><div class="ops-day-head"><strong>' + esc(dayLabel(d)) + '</strong><span>' + by[d].length + (by[d].length === 1 ? " trip" : " trips") + '</span></div>' +
        '<div class="ops-list">' + by[d].map(tripRow).join("") + '</div></div>';
    }).join("");
  }

  function statusLabel(s) {
    if (s === "Departed" || s === "In transit") return "En Route";
    return s;
  }
  function kpis() {
    var k = kp || {};
    var active = k.active || 0, delayed = k.delayed || 0, crew = k.crew_on_duty || 0;
    var avail = (vessels || []).filter(function (v) { return v.status !== "Out of service" && v.status !== "Maintenance"; }).length;
    return {
      active: active, activeHint: "Live sailings",
      delayed: delayed, delayedHint: delayed ? "Need attention" : "None delayed",
      vessels: avail, vesselsHint: "Ready to assign",
      crew: crew, crewHint: crew ? "On duty now" : "Ready for duty"
    };
  }

  function opsHash() {
    return (location.hash || "#").slice(1).split("/")[0];
  }
  function readPageView() {
    var h = opsHash();
    if (h === "board") return "board";
    if (h === "settings") return "settings";
    return "home";
  }
  function clockLabel() {
    var d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function dateLabel() {
    return new Date(viewDayIso() + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }
  function skedTitle() {
    var day = viewDayIso(), today = todayIso();
    if (day === today) return "Today's Schedule";
    if (day === addDays(today, -1)) return "Yesterday's Schedule";
    if (day === addDays(today, 1)) return "Tomorrow's Schedule";
    return "Schedule";
  }
  function liveMetaHtml() {
    return '<div class="ops-live-meta">' +
      '<label class="ops-datechip' + (isViewingToday() ? " is-today" : "") + '">' + icon(I.calendar) +
        '<span>' + esc(dateLabel()) + '</span>' +
        '<input type="date" id="opsHomeDay" value="' + esc(viewDayIso()) + '" aria-label="Choose date">' +
      '</label>' +
      '<span class="ops-timechip" id="opsClock">' + esc(clockLabel()) + '</span>' +
      (isViewingToday() ? '<span class="ops-livechip"><i></i> Live</span>' : "") +
      '</div>';
  }
  // Cursor 2026-10-27: home toolbar sits between the calendar and the Out of Service KPI.
  function homeActsHtml() {
    if (!canOps) return "";
    // Cursor 2026-10-27: Assign lives on Today's Schedule rows, not a separate home button.
    return '<div class="ops-home-acts">' +
      '<a class="btn-soft" href="#settings">Settings</a>' +
      '<button type="button" class="btn-soft" id="opsAddPax">' + icon(I.plus) + ' Add passenger</button>' +
      '<button type="button" class="primary-btn" id="opsNew">' + icon(I.plus) + ' Add New Trip</button>' +
    '</div>';
  }
  function setPageHead() {
    var h1 = document.querySelector(".dash-head h1");
    var sub = document.querySelector(".dash-head .sub");
    if (pageView === "settings") {
      if (h1) h1.textContent = "Operations";
      if (sub) sub.textContent = "Trip rules, harbours, routes and how dispatch works.";
    } else if (pageView === "board") {
      if (h1) h1.textContent = "Operations";
      if (sub) sub.textContent = "Dispatch trips, assign vessels and crew, and manage service changes.";
    } else {
      if (h1) h1.textContent = "Operations";
      if (sub) sub.textContent = "Live view of vessels, trips and fleet status";
    }
  }
  function delayMins(t) {
    if (t.status !== "Delayed" && t.raw.status !== "Delayed") return 0;
    var n = Date.now() - t.departTs;
    return n > 0 ? Math.max(1, Math.round(n / 60000)) : 0;
  }
  // Cursor 2026-10-27: white timeline — colour only on the rail dot and status chip.
  function schedTone(t) {
    var st = statusLabel(t.status);
    if (st === "Cancelled") return { label: "Cancelled", cls: "off", bar: "off" };
    if (st === "Delayed") {
      var m = delayMins(t);
      return { label: m ? "Delayed +" + m + "m" : "Delayed", cls: "late", bar: "late" };
    }
    if (isHeld(t)) return { label: "Held", cls: "late", bar: "late" }; // Cursor 2026-10-27: don't fake Departed when stuck
    if (st === "Arrived" || st === "Completed") return { label: "Completed", cls: "done", bar: "done" };
    if (st === "En Route" || st === "Departed") return { label: "Departed", cls: "gone", bar: "gone" };
    if (st === "Boarding") return { label: "Boarding", cls: "board", bar: "board" };
    var now = Date.now();
    var dep = t.departTs;
    var arr = t.arriveTs || (dep + 40 * 60000);
    if (dep && now >= arr) return { label: "Completed", cls: "done", bar: "done" };
    if (dep && now >= dep) return { label: "Departed", cls: "gone", bar: "gone" };
    if (dep && now >= dep - 20 * 60000) return { label: "Boarding", cls: "board", bar: "board" };
    return { label: "Scheduled", cls: "wait", bar: "wait" };
  }
  function schedWhy(t) {
    if (t.reason && (t.raw.status === "Delayed" || t.raw.status === "Cancelled")) return t.reason;
    if (isHeld(t)) return "Held — " + heldReasonFor(t);
    return "";
  }
  function vesselShort(t) {
    var s = t.vesselCode || t.vessel || "";
    s = String(s).replace(/^MV\s+/i, "").trim();
    return s || "—";
  }
  function vesselFace(v) {
    if (v.status === "Restricted") return { label: "Restricted", cls: "bad" };
    if (v.status === "Out of service") return { label: "Out of service", cls: "bad" };
    if (v.status === "Maintenance") return { label: "Restricted", cls: "bad" };
    return { label: "In Service", cls: "ok" };
  }
  function homeStats() {
    var today = viewDayIso();
    var list = trips.filter(function (t) { return t.day === today; }).slice().sort(function (a, b) { return a.departTs - b.departTs; });
    var total = list.length;
    var live = list.filter(function (t) {
      var s = t.raw.status;
      return s === "Boarding" || s === "Departed" || s === "In transit" || t.status === "En Route";
    }).length;
    var delayed = list.filter(function (t) { return t.raw.status === "Delayed" || t.status === "Delayed"; });
    var cancelled = list.filter(function (t) { return t.raw.status === "Cancelled"; }).length;
    var onTime = Math.max(0, total - delayed.length - cancelled);
    var late15 = delayed.filter(function (t) { return delayMins(t) >= 15; }).length;
    var oos = (vessels || []).filter(function (v) {
      return v.status === "Out of service" || v.status === "Restricted" || v.status === "Maintenance";
    });
    var restricted = oos.filter(function (v) { return v.status === "Restricted" || v.status === "Maintenance"; }).length;
    var tones = list.map(function (t) { return schedTone(t); });
    var done = tones.filter(function (x) { return x.bar === "done"; }).length;
    var livePaint = tones.filter(function (x) { return x.bar === "gone" || x.bar === "board"; }).length;
    var left = tones.filter(function (x) { return x.bar === "wait" || x.bar === "late"; }).length;
    var next = list.filter(function (t, i) {
      return tones[i].bar === "wait" || tones[i].bar === "board";
    })[0];
    if (!next) next = list.filter(function (t, i) { return tones[i].bar === "gone"; })[0];
    return {
      total: total, active: Math.max(live, livePaint), delayed: delayed.length, late15: late15,
      onTime: onTime, onPct: total ? Math.round(onTime * 100 / total) : 0,
      oos: oos.length, restricted: restricted, todayList: list,
      done: done, left: left, nextId: next ? next.id : null, tones: tones
    };
  }
  // Cursor 2026-10-27: Live Vessel Map uses free Esri World Imagery (no API key) plus OSM.
  // Claude 2026-10-28: vessel markers on the Live Vessel Map from vessel_live_positions (0066): phones checked in to the vessel,
  // or FollowMe when it was polled. A phone is an estimate of the vessel position; the popup says which and how old.
  var liveBoats = null, livePosTimer = null, liveFitted = false;
  function ageText(s) { s = Math.max(0, Math.round(s || 0)); return s < 90 ? s + " s ago" : s < 5400 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago"; }
  // Boat marker status: no recent fix = offline; sailing = moving; delayed or restricted = idle; otherwise stopped (at port).
  function liveBoatStatus(p) {
    if (p.stale) return "offline";
    if (p.held) return "idle";
    if (p.state === "Underway" || (p.speed_kn != null && p.speed_kn >= 1)) return "moving";
    if (p.state === "Delayed" || p.state === "Restricted") return "idle";
    return "stopped";
  }
  function livePopup(p) {
    return "<strong>" + esc(p.name) + "</strong><br>" + (p.held ? "<em>Phone is on land: showing the last position at sea (" + ageText(p.age_s) + ")</em><br>" : "") + esc(p.state) + (p.trip ? " · " + esc(p.trip.code) : "") + "<br>" +
      (p.speed_kn != null ? Math.round(p.speed_kn * 10) / 10 + " kn · " : "") + ageText(p.age_s) + (p.stale ? " (stale)" : "") + "<br>" +
      "<small>" + (p.source === "followme" ? "FollowMe Tracking Service" : "Crew phone (estimate)") + (p.accuracy_m != null ? " · ±" + Math.round(p.accuracy_m) + " m" : "") + "</small>";
  }
  function drawLivePositions(list) {
    if (!liveMap) return;
    if (!window.VeyoraVesselMarkers) return;
    if (!liveBoats) liveBoats = window.VeyoraVesselMarkers.create(liveMap, { popupHtml: function (d) { return livePopup(d.raw); } });
    var boats = (list || []).map(function (p) {
      return { id: p.vessel_id || p.code || p.name, lat: Number(p.lat), lng: Number(p.lng), heading: p.heading == null ? NaN : Number(p.heading),
        status: liveBoatStatus(p), name: p.name, stale: !!p.stale, raw: p };
    });
    liveBoats.update(boats);
    var pts = boats.filter(function (b) { return isFinite(b.lat) && isFinite(b.lng); }).map(function (b) { return [b.lat, b.lng]; });
    if (pts.length && !liveFitted) { liveFitted = true; try { liveMap.fitBounds(pts, { padding: [60, 60], maxZoom: 13 }); } catch (e) {} }
  }
  var liveBusy = false, liveLast = {}, liveChan = null, liveRt = false, livePolledAt = 0;
  // Live feed: the database broadcasts every stored fix on a private channel for this company (migration 0074); each one moves
  // the boat at once. The 3 s read below is only the safety net (and supplies names, trips and state), so it slows to 15 s
  // while the live channel is connected.
  function liveStamp() {
    var st = $("opsLiveStamp"), n = Object.keys(liveLast).length;
    if (st) st.textContent = (liveRt ? "Live \u00b7 instant" : "Live") + " \u00b7 " + n + (n === 1 ? " vessel" : " vessels");
  }
  function drawLive() { drawLivePositions(Object.keys(liveLast).map(function (k) { return liveLast[k]; })); liveStamp(); }
  function onLiveFix(f) {
    if (!f || !liveMap) return;
    var cur = liveLast[f.vessel_id];
    if (!cur) { refreshLivePositions(true); return; }                       // a vessel we have not listed yet
    if (f.at && cur.observed_at && new Date(f.at) < new Date(cur.observed_at)) return;   // older than what is on the map
    cur.lat = Number(f.lat); cur.lng = Number(f.lng); cur.heading = f.heading == null ? cur.heading : f.heading;
    cur.speed_kn = f.speed_kn; cur.accuracy_m = f.accuracy_m; cur.source = f.source || cur.source;
    cur.observed_at = f.at || cur.observed_at; cur.age_s = 0; cur.stale = false; cur.held = false;
    drawLive();
  }
  function subscribeLive() {
    if (liveChan || !company || !canOps || !db.channel) return;
    try {
      liveChan = db.channel("vessel-pos:" + company.id, { config: { private: true } })
        .on("broadcast", { event: "position" }, function (m) { onLiveFix(m && m.payload); })
        .subscribe(function (status) { liveRt = status === "SUBSCRIBED"; liveStamp(); });
    } catch (e) { liveChan = null; }
  }
  function refreshLivePositions(force) {
    if (!liveMap || !company || !canOps || liveBusy || document.hidden) return;   // one read at a time; idle while the tab is hidden
    if (force !== true && liveRt && Date.now() - livePolledAt < 15000) return;
    liveBusy = true; livePolledAt = Date.now();
    Promise.resolve(db.rpc("vessel_live_positions", { p_company: company.id })).then(function (r) {
      if (!r.error && Array.isArray(r.data)) {
        var m = {}; r.data.forEach(function (p) { m[p.vessel_id || p.code || p.name] = p; });
        liveLast = m; drawLive();
      }
    }, function () {}).then(function () { liveBusy = false; });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshLivePositions(true); });
  function destroyLiveMap() {
    if (livePosTimer) { clearInterval(livePosTimer); livePosTimer = null; }
    if (liveChan) { try { db.removeChannel(liveChan); } catch (e) {} liveChan = null; liveRt = false; }
    liveLast = {};
    if (liveBoats) { liveBoats.destroy(); liveBoats = null; }
    if (!liveMap) return;
    try {
      var c = liveMap.getCenter();
      liveMapView = { center: [c.lat, c.lng], zoom: liveMap.getZoom() };
      liveMap.remove();
    } catch (e) {}
    liveMap = null;
  }
  function liveOsmLayer() {
    return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
  }
  function liveSatLayer() {
    return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, maxNativeZoom: 17, attribution: "Tiles &copy; Esri"
    });
  }
  function liveSatLabels() {
    return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, maxNativeZoom: 16, attribution: ""
    });
  }
  function applyLiveMapBase(mode) {
    liveMapBase = mode === "map" ? "map" : "sat";
    if (liveMap) {
      if (liveMap._opsBase) { liveMap.removeLayer(liveMap._opsBase); liveMap._opsBase = null; }
      if (liveMap._opsLabels) { liveMap.removeLayer(liveMap._opsLabels); liveMap._opsLabels = null; }
      if (liveMapBase === "sat") {
        liveMap._opsBase = liveSatLayer().addTo(liveMap);
        liveMap._opsLabels = liveSatLabels().addTo(liveMap);
      } else {
        liveMap._opsBase = liveOsmLayer().addTo(liveMap);
      }
    }
    [].forEach.call(document.querySelectorAll("#ops [data-map-base]"), function (b) {
      b.classList.toggle("on", b.dataset.mapBase === liveMapBase);
    });
  }
  function paintLiveMap() {
    destroyLiveMap();
    var el = $("opsLiveMap");
    if (!el || !window.L) return;
    var c = liveMapView && liveMapView.center ? liveMapView.center : [4.25, 73.55];
    liveMap = L.map(el, { zoomControl: false, scrollWheelZoom: true, attributionControl: true })
      .setView(c, (liveMapView && liveMapView.zoom) || 9);
    L.control.zoom({ position: "bottomright" }).addTo(liveMap);
    applyLiveMapBase(liveMapBase);
    setTimeout(function () { if (liveMap) liveMap.invalidateSize(); }, 80);
    setTimeout(function () { if (liveMap) liveMap.invalidateSize(); }, 320);
    refreshLivePositions(true);
    subscribeLive();
    livePosTimer = setInterval(refreshLivePositions, 3000);   // follows the vessel live: a fresh read every 3 s while the page is open
  }
  function renderHome() {
    var s = homeStats();
    var fleet = (vessels || []).slice();
    setPageHead();
    destroyLiveMap();
    $("opsActions").innerHTML = liveMetaHtml();
    $("ops").innerHTML =
      '<div class="ops-home">' +
        homeActsHtml() +
        '<div class="ops-home-kpis">' +
          '<div class="ops-hk"><i class="ops-hk-ic blue">' + kpiIcon(I.kpiBoat, true) + '</i><div><small>Active Trips</small><strong>' + s.active + '</strong><span>of ' + s.total + ' today</span></div></div>' +
          '<div class="ops-hk"><i class="ops-hk-ic green">' + kpiIcon(I.kpiOk) + '</i><div><small>On Time</small><strong>' + s.onPct + '%</strong><span>' + s.onTime + ' / ' + s.total + ' trips</span></div></div>' +
          '<div class="ops-hk"><i class="ops-hk-ic amber">' + kpiIcon(I.kpiAlert, true) + '</i><div><small>Delays</small><strong>' + s.delayed + '</strong><span>' + (s.late15 ? s.late15 + ' over 15 minutes' : (s.delayed ? "Need attention" : "None delayed")) + '</span></div></div>' +
          '<div class="ops-hk"><i class="ops-hk-ic rose">' + kpiIcon(I.kpiOff) + '</i><div><small>Vessels Out of Service</small><strong>' + s.oos + '</strong><span>' + (s.restricted ? s.restricted + " restricted" : (s.oos ? "Out of service" : "All in service")) + '</span></div></div>' +
        '</div>' +
        homeWeatherHtml() +
        '<div id="opsArrivals"></div>' + // Claude 2026-10-27: GPS arrival detection panel, filled by arrivals.js
        '<div class="ops-home-mid">' +
          '<section class="ops-home-card ops-home-map">' +
            '<div class="ops-home-h"><span>' + icon(I.pin) + '<h2>Live Vessel Map</h2></span>' +
              '<span class="ops-live-stamp" id="opsLiveStamp" role="status">Live</span><div class="ops-map-basemap" role="group" aria-label="Map style">' +
                '<button type="button" data-map-base="map"' + (liveMapBase === "map" ? ' class="on"' : "") + '>Map</button>' +
                '<button type="button" data-map-base="sat"' + (liveMapBase !== "map" ? ' class="on"' : "") + '>Satellite</button>' +
              '</div></div>' +
            '<div class="ops-live-map">' +
              '<div id="opsLiveMap" class="ops-live-map-el" role="img" aria-label="Live vessel map"></div>' +
              '<div class="ops-map-legend">' +
                '<span><i class="lg mov"></i> Moving</span>' +
                '<span><i class="lg stp"></i> Stopped</span>' +
                '<span><i class="lg delay"></i> Idle</span>' +
                '<span><i class="lg stop"></i> Offline</span>' +
              '</div>' +
            '</div>' +
          '</section>' +
          '<section class="ops-home-card ops-home-sked">' +
            '<div class="ops-home-h"><span>' + icon(I.calendar) + '<h2>' + esc(skedTitle()) + '</h2></span>' +
              '<button type="button" class="ops-viewall" id="opsGoBoard">View All</button></div>' +
            (s.todayList.length
              ? '<ol class="ops-sked">' + s.todayList.map(function (t, i) {
                  var tone = (s.tones && s.tones[i]) || schedTone(t);
                  var vLab = vesselShort(t);
                  var openTrip = CLOSED.indexOf(t.raw.status) < 0 && t.raw.status !== "Cancelled";
                  var needV = !t.vessel_id && canOps && openTrip; // Cursor 2026-10-27: Assign on unassigned schedule rows
                  var why = schedWhy(t);
                  return '<li>' +
                    '<div class="ops-sked-row' + (why ? " has-why" : "") + '" role="button" tabindex="0" data-trip="' + esc(t.id) + '">' +
                    '<span class="ops-sked-rail" aria-hidden="true"><i class="ops-sked-dot ' + tone.bar + '"></i></span>' +
                    '<strong class="ops-sked-time">' + esc(t.time) + '</strong>' +
                    '<span class="ops-sked-route">' + esc(t.origin || "Origin") + ' <span class="ops-sked-arrow">→</span> ' + esc(t.destination || "Destination") + '</span>' +
                    (needV
                      ? '<button type="button" class="ops-sked-assign" data-assign="' + esc(t.id) + '">' + icon(I.vessel) + ' Assign</button>'
                      : '<span class="ops-sked-v" title="' + esc(t.vessel || t.vesselCode || "") + '">' + esc(vLab) + '</span>') +
                    '<span class="ops-sked-st ' + tone.cls + '">' + (tone.bar === "late" ? icon(I.alert) : "<i></i>") + esc(tone.label) + '</span>' +
                    '<span class="ops-sked-go">' + icon(I.chev) + '</span>' +
                    (why ? '<span class="ops-sked-why">' + icon(I.alert) + ' ' + esc(why) + '</span>' : "") +
                  '</div></li>';
                }).join("") + '</ol>'
              : '<div class="ops-home-empty">' + (isViewingToday() ? "No trips scheduled today." : "No trips on this date.") + ' <button type="button" class="ops-viewall" id="opsGoBoardEmpty">Open dispatch</button></div>') +
          '</section>' +
        '</div>' +
        '<section class="ops-home-card ops-home-fleet">' +
          '<div class="ops-home-h"><span>' + icon(I.vessel) + '<h2>Fleet Status</h2></span>' +
            '<a class="ops-viewall" href="fleet.html">View All</a></div>' +
          (fleet.length
            ? '<div class="ops-fv-row">' + fleet.map(function (v) {
                var face = vesselFace(v);
                var cap = v.passenger_capacity != null ? Number(v.passenger_capacity) : null;
                return '<a class="ops-fv" href="maintenance.html#vessel/' + esc(v.id) + '">' +
                  '<div class="ops-fv-pic">' + window.VeyoraShell.vesselPhotoImg(v) + /* Cursor 2026-10-27: real photo, else sample boat */
                    '<span class="ops-fv-st ' + face.cls + '">' + (face.cls === "ok" ? "<i></i> " : "") + esc(face.label) + '</span></div>' +
                  '<div class="ops-fv-meta"><strong>' + esc(v.code || "—") + '</strong><span>' + esc(v.name || "") + '</span>' +
                    (cap != null ? '<small>' + icon(I.people) + ' ' + cap + '</small>' : "") +
                  '</div></a>';
              }).join("") + '</div>'
            : '<div class="ops-home-empty">No vessels yet. Add them under Fleet.</div>') +
        '</section>' +
      '</div>';
    bind();
    loadHomeWeather();
    paintLiveMap();
  }
  function boardTitle() {
    if (tab === "crew") return "Crew management";
    if (dayF) return "Trips · " + dayF.slice(8) + "/" + dayF.slice(5, 7) + "/" + dayF.slice(0, 4);
    if (tab === "upcoming") return "Upcoming trips";
    if (tab === "completed") return "Completed trips";
    if (tab === "cancelled") return "Cancelled trips";
    return "Today's Trips";
  }
  function crewDayTrips() {
    var day = dayF || todayIso();
    return trips.filter(function (t) {
      return t.day === day && CLOSED.indexOf(t.raw.status) < 0 && t.raw.status !== "Cancelled";
    });
  }
  function crewBoard() {
    var list = crewDayTrips();
    if (!list.length) {
      return '<div class="ops-empty"><span class="ic">' + icon(I.people) + '</span>' +
        '<h3>No open trips to crew</h3><p>Pick another date or publish sailings from Schedules.</p></div>';
    }
    var full = list.filter(function (t) { var f = crewFill(t); return f.need && f.have >= f.need; }).length, sized = list.filter(function (t) { return crewFill(t).need; }).length;
    var pct = sized ? Math.round(full * 100 / sized) : 0;
    return '<div class="ops-crew-board">' +
      '<div class="ops-crew-hero"><div class="ops-ring" style="--p:' + pct + '"><span><strong>' + pct + '%</strong><small>crewed</small></span></div>' +
        '<div class="grow"><strong>' + full + ' of ' + sized + ' sailings fully crewed</strong><p class="note">' + (dayF ? "Sailings on " + esc(dayLabel(dayF)) : "Today’s open sailings") + '. Crew fill themselves from the Duty Roster using each boat’s crew needs; you can change anyone here.</p></div></div>' +
      (canOps ? '<p style="margin:0 0 14px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn-soft" id="crewAutoAll">' + icon(I.people) + ' Fill empty places from roster</button><button type="button" class="btn-soft" id="vesselCrewNeeds">' + icon(I.boat) + ' Vessel crew needs</button></p>' : "") +
      list.map(function (t) {
        var crew = Array.isArray(t.raw.crew) ? t.raw.crew : [];
        var closed = CLOSED.indexOf(t.raw.status) >= 0;
        var mix = mixOf(t), seatsHtml = "";
        if (mix.length) {
          var pool = crew.slice();
          seatsHtml = '<div class="ops-seats">' + mix.map(function (m) {
            var role = String(m.role), n = Number(m.n) || 0, out = [], isCapt = /^(captain|master|skipper)s?$/i.test(role.trim());
            for (var k = 0; k < n; k++) {
              var who = null;
              if (isCapt && k === 0 && t.captain) who = { name: t.captain };
              else { var ix = -1; pool.forEach(function (c, j) { if (ix < 0 && String(c.role || "").toLowerCase() === role.toLowerCase()) ix = j; }); if (ix > -1) who = pool.splice(ix, 1)[0]; }
              out.push(who ? '<span class="ops-seat on r-' + slug(role) + '" title="' + esc(who.name + " · " + role) + '"><b>' + esc(initials(who.name)) + '</b><small>' + esc(String(who.name).split(/\s+/)[0]) + '</small></span>'
                : '<span class="ops-seat open" title="Needs a ' + esc(role) + '"><b>+</b><small>' + esc(role) + '</small></span>');
            }
            return out.join("");
          }).join("") + '</div>';
        }
        var f = crewFill(t);
        return '<article class="ops-crew-trip' + (t.status === "Arrived" ? " is-arrived" : "") + (f.need ? (f.have >= f.need ? " is-full" : " is-short") : "") + '" data-trip-card="' + esc(t.id) + '">' +
          '<header class="ops-crew-trip-head">' +
            '<div class="ops-crew-when"><span class="ops-crew-time">' + esc(t.time) + '</span><div><strong>' + esc((t.origin || "?") + " → " + (t.destination || "?")) + '</strong>' +
              '<small>' + esc(t.code || "Trip") + (t.vesselCode || t.vessel ? " · " + (t.vesselCode || t.vessel) : "") + '</small></div></div>' +
            '<div class="ops-crew-trip-acts">' + fillChip(t) + chip(statusLabel(t.status)) +
              '<button type="button" class="btn-soft" data-trip="' + esc(t.id) + '" data-opentab="crew">Open</button></div>' +
          '</header>' + seatsHtml +
          '<div class="ops-crew-fields">' +
            '<div class="fld"><label>Captain</label>' +
              (canOps && !closed
                ? '<select data-captain-trip="' + esc(t.id) + '">' + options(staff || [], t.raw.captain_id || "", "No captain") + '</select>'
                : '<strong class="ops-crew-static">' + esc(t.captain || "Unassigned") + '</strong>') +
            '</div>' +
            '<div class="fld grow"><label>Crew on this trip</label>' +
              '<div class="ops-crew-chips">' +
                (crew.length ? crew.map(function (c) {
                  return '<span class="ops-crew-chip"><span class="av">' + esc(initials(c.name)) + '</span>' +
                    '<span><strong>' + esc(c.name || "Crew") + '</strong><small>' + esc(c.role || "Crew") + '</small></span>' +
                    (canOps && !closed ? '<button type="button" class="ghost" data-board-uncrew="' + esc(t.id) + '" data-uid="' + esc(c.user_id) + '" title="Remove">×</button>' : "") +
                  '</span>';
                }).join("") : '<span class="note">No crew yet</span>') +
              '</div>' +
              (canOps && !closed ?
                '<div class="ops-crew-add">' +
                  '<select data-add-user="' + esc(t.id) + '">' + options(staff || [], "", "Add person") + '</select>' +
                  '<select data-add-role="' + esc(t.id) + '"><option>Crew</option><option>Cashier</option><option>Deck</option><option>Engineering</option><option>Cabin</option></select>' +
                  '<button type="button" class="btn-soft" data-board-add="' + esc(t.id) + '">Add</button>' +
                '</div>' : "") +
            '</div>' +
          '</div></article>';
      }).join("") +
    '</div>';
  }
  function filtered() {
    var today = todayIso();
    return trips.filter(function (t) {
      var st = t.raw.status;
      if (dayF) {
        if (t.day !== dayF) return false;
      } else {
        if (tab === "today" && t.day !== today) return false;
        if (tab === "upcoming" && !(t.day > today && CLOSED.indexOf(st) < 0)) return false;
      }
      if (tab === "completed" && st !== "Arrived" && st !== "Completed") return false;
      if (tab === "cancelled" && st !== "Cancelled") return false;
      if (statusF && t.status !== statusF) return false;
      if (routeF && t.route_id !== routeF) return false;
      if (vesselF && t.vessel_id !== vesselF) return false;
      if (q) {
        var hay = (t.route + " " + t.vessel + " " + (t.captain || "") + " " + (t.code || "")).toLowerCase();
        if (hay.indexOf(q.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  function emptyBoard() {
    var labels = { today: "today", upcoming: "upcoming", completed: "completed", cancelled: "cancelled" };
    var when = dayF ? ("on " + dayF.slice(8) + "/" + dayF.slice(5, 7) + "/" + dayF.slice(0, 4)) : (labels[tab] || "");
    return '<div class="ops-empty"><span class="ic">' + icon(I.boat) + '</span>' +
      '<h3>No trips ' + esc(when) + '</h3>' +
      '<p>' + (dayF ? "Nothing matches this date. Clear the date filter or pick another day." : (tab === "today" ? "Nothing is sailing today. Create a one-off trip or publish sailings from Schedules." : "Nothing to show here for the last two weeks and the next month.")) + '</p>' +
      '<div class="acts">' +
        (dayF ? '<button type="button" class="btn-soft" id="clearDay">Clear date</button>' : "") +
        (canOps ? '<button type="button" class="primary-btn" id="emptyNew">' + icon(I.plus) + ' Add New Trip</button><a class="btn-soft" href="schedules.html">Open Schedules</a>' : '<a class="btn-soft" href="schedules.html">Open Schedules</a>') +
      '</div></div>';
  }

  function vesselSlot(t) {
    var closed = CLOSED.indexOf(t.raw.status) >= 0 || t.raw.status === "Cancelled";
    if (t.vessel_id || t.vessel) {
      return '<div class="ops-vslot has' + (canOps && !closed ? " clickable" : "") + '"' +
        (canOps && !closed ? ' role="button" tabindex="0" data-assign="' + esc(t.id) + '"' : "") +
        ' title="' + esc(t.vessel || "Change vessel") + '">' +
        '<span class="ops-vslot-ic">' + icon(I.vessel) + '</span>' +
        '<span class="ops-vslot-txt"><strong>' + esc(t.vesselCode || t.vessel) + '</strong>' +
          '<small><i class="ops-dot-ok"></i> Assigned</small></span>' +
        (canOps && !closed
          ? '<button type="button" class="ops-vslot-x" data-unassign="' + esc(t.id) + '" title="Remove vessel" aria-label="Remove vessel">' + icon(I.x) + '</button>'
          : "") +
      '</div>';
    }
    if (!canOps || closed) return '<div class="ops-vslot empty muted">No vessel</div>';
    return '<button type="button" class="ops-vslot assign" data-assign="' + esc(t.id) + '">' +
      icon(I.vessel) + '<span>Assign Vessel</span></button>';
  }

  function tripRow(t) {
    var tone = statusTone(t.status);
    var showDay = !!dayF || tab !== "today" || t.day !== todayIso();
    var label = (t.code ? t.code + " · " : "") + t.route + " " + t.time;
    var capt = t.captain ? ("Capt. " + String(t.captain).split(/\s+/).slice(0, 2).join(" ")) : "Unassigned";
    var crewBit = capt + (t.crewCount ? " / " + t.crewCount : "");
    var st = statusLabel(t.status);
    var load = loadState(t.booked, t.capacity);
    return '<article class="ops-row tone-' + tone + (t.status === "Arrived" ? " is-arrived" : "") + (load.cls ? " " + load.cls : "") + '" role="button" tabindex="0" data-trip="' + esc(t.id) + '" aria-label="Open trip ' + esc(label) + '">' +
      '<div class="ops-row-id"><span class="ops-row-ic">' + window.VeyoraShell.vesselPhotoImg(vesselOf(t)) + '</span>' +
        '<div><strong>' + esc(t.code || "Trip") + '</strong>' +
        (showDay ? '<small>' + esc(t.day.slice(8) + "/" + t.day.slice(5, 7)) + '</small>' : "") +
      '</div></div>' +
      '<div class="ops-row-time"><strong>' + esc(t.time) + '</strong>' + (t.arrive ? '<small>arr ' + esc(t.arrive) + '</small>' : "") + '</div>' +
      '<div class="ops-row-route">' +
        '<strong>' + esc(t.origin || "Origin") + '</strong>' +
        '<span class="ops-row-arrow" aria-hidden="true">' + icon(I.arrow) + '</span>' +
        '<strong>' + esc(t.destination || "Destination") + '</strong>' +
      '</div>' +
      '<div class="ops-row-meta">' +
        '<span class="ops-row-crew" title="' + esc(crewBit) + '">' + avatars(t, 4) + fillChip(t) + '</span>' +
        loadBar(t.booked, t.capacity) +
        loadChip(t.booked, t.capacity) +
        (t.reason && (t.raw.status === "Delayed" || t.raw.status === "Cancelled") ? '<span class="ops-row-reason">' + icon(I.alert) + ' ' + esc(t.reason) + '</span>'
          : isHeld(t) ? '<span class="ops-row-reason">' + icon(I.alert) + ' Held — ' + esc(heldReasonFor(t)) + '</span>' : "") +
      '</div>' +
      vesselSlot(t) +
      '<div class="ops-row-status">' + (isLive(t) ? '<i class="ops-pulse"></i>' : "") + chip(st) + '<span class="ops-row-open" aria-hidden="true">' + icon(I.chev) + '</span></div>' +
      (t.status === "En Route" && progressOf(t) != null ? '<span class="ops-row-prog" aria-hidden="true"><span style="width:' + progressOf(t) + '%"></span></span>' : "") +
    '</article>';
  }

  function queueBlock() {
    if (!queue.length) return '<div class="empty-side">No dispatch tasks right now.</div>';
    return '<div class="ops-queue">' + queue.map(function (x) {
      var pri = x.priority === "High" ? "pri-high" : x.priority === "Due" ? "pri-due" : "pri-review";
      var priLabel = x.priority === "Due" ? "Medium" : (x.priority === "Review" ? "Info" : (x.priority || "Info"));
      var attr = x.trip_id ? ' data-trip="' + esc(x.trip_id) + '"' : (x.id ? ' data-task="' + esc(x.id) + '"' : "");
      var when = x.due_at ? fmtTime(x.due_at) : (x.sub || "");
      return '<div class="ops-qitem"' + attr + ' role="button" tabindex="0">' +
        '<div class="grow"><strong>' + esc(x.title) + '</strong><small>' + esc(when) + '</small></div>' +
        '<span class="pri ' + pri + '">' + esc(priLabel) + '</span></div>';
    }).join("") + '</div>';
  }

  function options(list, val, all) {
    return '<option value="">' + esc(all) + '</option>' + list.map(function (o) {
      return '<option value="' + esc(o.id) + '"' + (val === o.id ? " selected" : "") + '>' + esc(o.name) + '</option>';
    }).join("");
  }

  function unassignedTrips() {
    return trips.filter(function (t) {
      return !t.vessel_id && CLOSED.indexOf(t.raw.status) < 0 && t.raw.status !== "Cancelled";
    });
  }
  function paxOpenTrips() {
    return trips.filter(function (t) {
      var s = t.raw.status;
      return CLOSED.indexOf(s) < 0 && s !== "Departed" && s !== "In transit";
    }).sort(function (a, b) { return a.departTs - b.departTs; });
  }
  function stepsHtml(cur, l1, l2) {
    return '<div class="ap-steps">' +
      '<div class="ap-step-item' + (cur >= 1 ? " on" : "") + '"><span class="ap-step-dot">' + (cur > 1 ? icon(I.check) : "1") + '</span><small>' + esc(l1) + '</small></div>' +
      '<i class="ap-step-line' + (cur > 1 ? " fill" : "") + '"></i>' +
      '<div class="ap-step-item' + (cur >= 2 ? " on" : "") + '"><span class="ap-step-dot">2</span><small>' + esc(l2) + '</small></div>' +
    '</div>';
  }
  // Cursor 2026-10-27: Add Passengers 3-step wizard (select sailing → passengers → confirm).
  function openAddPaxPicker() {
    if (!canOps) return;
    var list = paxOpenTrips();
    if (!list.length) { boardToast("No open trips to add a passenger to."); return; }
    var today = todayIso();
    var ap = {
      step: 1, tripId: null, day: null, routeKey: "",
      passengers: [{ name: "", phone: "", email: "", idNumber: "", category: "Adult" }],
      seats: 1, guests: [], // seats = number of passengers on this booking; guests = optional names for the other seats
      method: "", markPaid: false, saving: false, err: null
    };
    ap.day = list.some(function (t) { return t.day === today; })
      ? today
      : (list.filter(function (t) { return t.day > today; })[0] || list[0]).day;

    function tripById(id) { return list.filter(function (t) { return t.id === id; })[0] || trips.filter(function (t) { return t.id === id; })[0]; }
    function corridor(t) { return (t.origin || "Origin") + " → " + (t.destination || "Destination"); }
    function apxDur(t) {
      if (t.arriveTs && t.departTs) return Math.max(1, Math.round((t.arriveTs - t.departTs) / 60000));
      var r = (routes || []).filter(function (x) { return x.id === t.route_id; })[0];
      return r && r.duration_min ? Number(r.duration_min) : null;
    }
    function apxTone(t) {
      if (t.raw && t.raw.status === "Delayed") return { label: "Delayed", cls: "late" };
      if (t.status === "On time") return { label: "On Time", cls: "ok" };
      var tone = schedTone(t);
      return { label: tone.label, cls: tone.cls };
    }
    function apxLeft(t) {
      return t.capacity != null ? Math.max(0, Number(t.capacity) - (t.booked || 0)) : null;
    }
    function dayTrips() {
      return list.filter(function (t) {
        if (t.day !== ap.day) return false;
        if (ap.routeKey && corridor(t) !== ap.routeKey) return false;
        return true;
      }).sort(function (a, b) { return a.departTs - b.departTs; });
    }
    function corridors() {
      var seen = {}, out = [];
      list.filter(function (t) { return t.day === ap.day; }).forEach(function (t) {
        var k = corridor(t);
        if (!seen[k]) { seen[k] = 1; out.push({ id: k, name: k }); }
      });
      return out;
    }
    function cats() {
      return listSetting("7_passenger_categories", ["Adult", "Child", "Infant", "Senior", "Student", "Resident", "Tourist"]);
    }
    function ensureTrip() {
      var shown = dayTrips();
      if (ap.tripId && shown.some(function (t) { return t.id === ap.tripId; })) return;
      ap.tripId = shown.length ? shown[0].id : null;
    }
    function readPax() {
      var lead = ap.passengers[0];
      var row = document.querySelector("[data-apx-lead]");
      if (row) {
        var g = function (f) { var el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value : ""; };
        lead.name = g("name"); lead.phone = g("phone"); lead.email = g("email"); lead.idNumber = g("id"); lead.category = g("category") || "Adult";
      }
      [].forEach.call(document.querySelectorAll("[data-apx-guest]"), function (el) { ap.guests[Number(el.dataset.apxGuest)] = el.value; });
      if ($("apMarkPaid")) ap.markPaid = $("apMarkPaid").checked;
    }
    function seatsLeft() {
      var t = tripById(ap.tripId), left = t ? apxLeft(t) : null;
      return left == null ? 50 : Math.max(0, left);
    }
    // The people on the booking: the lead passenger, then one per extra seat (their own name if given, otherwise "<lead> (guest 2)").
    function namedPax() {
      var lead = ap.passengers[0];
      if (!String(lead.name || "").trim()) return [];
      var out = [{ name: lead.name.trim(), phone: String(lead.phone || "").trim(), email: lead.email, idNumber: lead.idNumber, category: lead.category || "Adult" }];
      for (var i = 1; i < ap.seats; i++) {
        var nm = String(ap.guests[i - 1] || "").trim();
        out.push({ name: nm || (lead.name.trim() + " (guest " + (i + 1) + ")"), phone: out[0].phone, email: "", idNumber: "", category: lead.category || "Adult" });
      }
      return out;
    }

    function shell() {
      return '<div class="ntx-shell apx-shell">' +
        '<button type="button" class="ntx-back" data-close>' + icon(I.back) + ' Back to Operations</button>' +
        '<header class="ntx-head"><h2>Add Passengers</h2><p>Select a trip schedule and add passenger details</p></header>' +
        '<ol class="ntx-steps" id="apxSteps"></ol>' +
        '<div class="ntx-grid"><div class="ntx-main" id="apxMain"></div><aside class="ntx-sum apx-side" id="apxSide"></aside></div>' +
        '<footer class="ntx-foot">' +
          '<button type="button" class="ghost ntx-cancel" data-close>Cancel</button>' +
          '<p class="msg" id="mMsg" role="status"></p>' +
          '<div class="ntx-nav">' +
            '<button type="button" class="ghost" id="apxPrev">Previous</button>' +
            '<button type="button" class="primary-btn" id="apxNext">Next ' + icon(I.arrow) + '</button>' +
          '</div>' +
        '</footer></div>';
    }
    function paintSteps() {
      var labels = ["Select Trip Schedule", "Add Passengers", "Review & Confirm"];
      $("apxSteps").innerHTML = labels.map(function (lab, i) {
        var n = i + 1, cls = ap.step === n ? "on" : (n < ap.step ? "done" : "");
        return '<li class="' + cls + '"><span>' + n + '</span> ' + lab + '</li>';
      }).join("");
    }
    function tripRow(t) {
      var tone = apxTone(t);
      var v = vesselOf(t);
      var code = t.vesselCode || (v && v.code) || "—";
      var vname = t.vessel && t.vessel !== code ? t.vessel : ((v && v.name) || "");
      var seats = t.capacity != null ? (t.booked || 0) + " / " + t.capacity : "—";
      return '<button type="button" class="apx-row' + (ap.tripId === t.id ? " on" : "") + '" data-apx-trip="' + esc(t.id) + '">' +
        '<i class="apx-radio" aria-hidden="true"></i>' +
        '<strong class="apx-time">' + esc(t.time) + '</strong>' +
        '<span class="apx-cor">' + esc(corridor(t)) + '</span>' +
        '<span class="apx-ves"><b>' + esc(code) + '</b><small>' + esc(vname) + '</small></span>' +
        '<span class="apx-seats">' + esc(seats) + '</span>' +
        '<span class="apx-st ' + tone.cls + '">' + esc(tone.label) + '</span>' +
        '<span class="apx-go">' + icon(I.chev) + '</span>' +
      '</button>';
    }
    function sideHtml() {
      var t = tripById(ap.tripId);
      if (!t) {
        return '<div class="ntx-sum-head"><span class="ntx-ic">' + icon(I.vessel) + '</span><div><h3>Trip Details</h3><p>Select a sailing to see details</p></div></div>' +
          '<p class="ntx-hint" style="padding:12px 18px">Choose a trip from the list.</p>';
      }
      var v = vesselOf(t);
      var dur = apxDur(t);
      var left = apxLeft(t);
      var code = t.vesselCode || (v && v.code) || "";
      var vname = (v && v.name) || t.vessel || "";
      return '<div class="ntx-sum-head"><span class="ntx-ic">' + icon(I.vessel) + '</span><div><h3>Trip Details</h3><p>Details of the selected trip</p></div></div>' +
        '<div class="apx-facts">' +
          '<div>' + icon(I.pin) + '<span>Route</span><b>' + esc(corridor(t)) + '</b></div>' +
          '<div>' + icon(I.calendar) + '<span>Date</span><b>' + esc(ntxPrettyDay(t.day)) + '</b></div>' +
          '<div>' + icon(I.clock) + '<span>Departure Time</span><b>' + esc(t.time) + '</b></div>' +
          '<div>' + icon(I.clock) + '<span>Estimated Arrival</span><b>' + esc(t.arrive || "—") + (dur ? ' <em>(' + dur + ' min)</em>' : "") + '</b></div>' +
          '<div>' + icon(I.vessel) + '<span>Vessel</span><b>' + esc((code ? code + " " : "") + vname || "—") + '</b></div>' +
          '<div>' + icon(I.people) + '<span>Total Seats</span><b>' + (t.capacity != null ? t.capacity : "—") + '</b></div>' +
          '<div>' + icon(I.ok) + '<span>Available Seats</span><b class="' + (left === 0 ? "is-full" : "is-ok") + '">' + (left != null ? left : "—") + '</b></div>' +
        '</div>' +
        '<div class="apx-boat">' + window.VeyoraShell.vesselPhotoImg(v) + '</div>' +
        '<p class="apx-note">' + icon(I.info) + '<span>Next you enter the passenger name, phone number and how many seats to book.</span></p>';
    }
    function step1() {
      ensureTrip();
      var shown = dayTrips();
      var routesOpts = corridors();
      return '<section class="ntx-card">' +
        '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.calendar) + '</span><div><h3>Select Trip Schedule</h3><p>Choose the trip you want to add passengers to</p></div></header>' +
        '<div class="apx-filters">' +
          '<label class="ntx-combo apx-date">' + icon(I.calendar) + '<strong id="apxDayLab">' + esc(ntxPrettyDay(ap.day)) + '</strong>' + icon('<path d="m6 9 6 6 6-6"/>') +
            '<input id="apxDay" type="date" value="' + esc(ap.day) + '" aria-label="Date"></label>' +
          '<button type="button" class="apx-swap" id="apxSwap" aria-label="Swap route">' + icon(I.swap) + '</button>' +
          '<div class="apx-route"><select id="apxRoute" aria-label="Route">' + options(routesOpts, ap.routeKey, "All routes") + '</select></div>' +
        '</div>' +
        '<div class="apx-table">' +
          '<div class="apx-cols"><span></span><span>Time</span><span>Route</span><span>Vessel</span><span>Seats</span><span>Status</span><span></span></div>' +
          (shown.length ? shown.map(tripRow).join("") : '<div class="apx-empty">No open trips on this date.</div>') +
        '</div>' +
      '</section>';
    }
    function step2() {
      var methods = payMethods(), lead = ap.passengers[0], left = seatsLeft(), t = tripById(ap.tripId);
      if (ap.seats > left) ap.seats = Math.max(1, left);
      var optionsCat = cats().map(function (c) { return '<option' + (lead.category === c ? " selected" : "") + '>' + esc(c) + '</option>'; }).join("");
      var guests = "";
      for (var i = 1; i < ap.seats; i++) {
        guests += '<div class="ntx-fld"><label>Passenger ' + (i + 1) + ' name <small>(optional)</small></label><input data-apx-guest="' + (i - 1) + '" maxlength="120" placeholder="Leave blank to use ' + esc((lead.name || "the name above").trim() || "the name above") + ' (guest ' + (i + 1) + ')" value="' + esc(ap.guests[i - 1] || "") + '"></div>';
      }
      return '<section class="ntx-card">' +
        '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.people) + '</span><div><h3>Passenger details</h3><p>' + (t ? esc(corridor(t) + " · " + ntxPrettyDay(t.day) + " · " + t.time) : "") + '</p></div></header>' +
        '<div class="apx-pax" data-apx-lead="1"><div class="ntx-fields">' +
          '<div class="ntx-fld"><label>Passenger name <i>*</i></label><input data-f="name" maxlength="120" placeholder="Full name" value="' + esc(lead.name) + '" autocomplete="off"></div>' +
          '<div class="ntx-fld"><label>Phone number <i>*</i></label><input data-f="phone" type="tel" inputmode="tel" maxlength="40" placeholder="7xxxxxx" value="' + esc(lead.phone) + '" autocomplete="off"></div>' +
          '<div class="ntx-fld ntx-fld-full"><label>Number of seats <i>*</i></label>' +
            '<div class="apx-seats-pick"><button type="button" class="apx-step" data-seat="-1" aria-label="One seat fewer"' + (ap.seats <= 1 ? " disabled" : "") + '>−</button><strong id="apxSeatN">' + ap.seats + '</strong>' +
            '<button type="button" class="apx-step" data-seat="1" aria-label="One seat more"' + (ap.seats >= left ? " disabled" : "") + '>+</button>' +
            '<span class="apx-seat-note">' + (t && t.capacity != null ? left + ' seat' + (left === 1 ? "" : "s") + ' left on this trip' : 'seats on this booking') + '</span></div></div>' +
          guests +
        '</div>' +
        '<details class="apx-more"><summary>More details (optional)</summary><div class="ntx-fields">' +
          '<div class="ntx-fld"><label>Category</label><select data-f="category">' + optionsCat + '</select></div>' +
          '<div class="ntx-fld"><label>ID / Passport</label><input data-f="id" maxlength="60" placeholder="Optional" value="' + esc(lead.idNumber) + '"></div>' +
          '<div class="ntx-fld ntx-fld-full"><label>Email</label><input data-f="email" type="email" maxlength="160" placeholder="Optional" value="' + esc(lead.email) + '"></div>' +
        '</div></details></div>' +
        '<div class="ap-pay">' +
          '<label class="ap-pay-label">Payment method</label>' +
          '<div class="ap-pay-chips">' + methods.map(function (m) {
            return '<button type="button" class="ap-chip ap-pay-chip' + (ap.method === m ? " on" : "") + '" data-method="' + esc(m) + '"><small>' + esc(m) + '</small></button>';
          }).join("") + '</div>' +
          '<label class="ap-paid-toggle"><input type="checkbox" id="apMarkPaid"' + (ap.markPaid ? " checked" : "") + '><span class="ap-switch"><i></i></span>' +
            '<span class="ap-paid-txt"><strong>Mark as paid</strong><small>Booking starts Pending — this records the payment now</small></span></label>' +
        '</div>' +
      '</section>';
    }
    function step3() {
      var t = tripById(ap.tripId);
      var people = namedPax();
      return '<section class="ntx-card">' +
        '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.check) + '</span><div><h3>Review &amp; Confirm</h3><p>Check the sailing and passengers before saving</p></div></header>' +
        (t ? '<div class="ntx-journey">' +
          '<div class="ntx-journey-end"><small>Departure</small><strong>' + esc(t.origin || "Origin") + '</strong><span>' + esc(ntxPrettyDay(t.day)) + ' · ' + esc(t.time) + '</span></div>' +
          '<div class="ntx-journey-mid"><i></i><span>' + esc(apxDur(t) ? apxDur(t) + " min" : "—") + '</span></div>' +
          '<div class="ntx-journey-end"><small>Arrival</small><strong>' + esc(t.destination || "Destination") + '</strong><span>' + esc(t.arrive || "—") + '</span></div>' +
        '</div>' : "") +
        '<div class="apx-review">' +
          people.map(function (p) {
            return '<div><strong>' + esc(p.name) + '</strong><span>' + esc([p.category, p.phone, p.idNumber].filter(Boolean).join(" · ") || "No extra details") + '</span></div>';
          }).join("") +
        '</div>' +
        '<p class="ntx-hint">' + (ap.method ? "Payment: " + esc(ap.method) : "No payment method") + (ap.markPaid ? " · marked paid" : "") + '</p>' +
      '</section>';
    }
    function paintSide() { if ($("apxSide")) $("apxSide").innerHTML = sideHtml(); }
    function paint() {
      ensureTrip();
      paintSteps();
      $("apxMain").innerHTML = ap.step === 1 ? step1() : ap.step === 2 ? step2() : step3();
      paintSide();
      var prev = $("apxPrev"), next = $("apxNext");
      if (prev) prev.disabled = ap.step <= 1;
      if (next) {
        next.disabled = ap.saving || (ap.step === 1 && !ap.tripId);
        next.innerHTML = ap.step === 3 ? (ap.saving ? "Saving…" : "Confirm") : ("Next " + icon(I.arrow));
      }
      if (ap.err) say(ap.err, "err");
      bindInner();
    }
    function go(delta) {
      if (ap.step === 2) readPax();
      if (delta > 0) {
        if (ap.step === 1 && !ap.tripId) { say("Choose a trip first.", "err"); return; }
        if (ap.step === 2) {
          var lead = ap.passengers[0];
          if (!String(lead.name || "").trim() || String(lead.name).trim().length < 2) { say("Enter the passenger name.", "err"); return; }
          if (String(lead.phone || "").replace(/[^0-9+]/g, "").length < 6) { say("Enter a phone number (required).", "err"); return; }
          if (ap.seats < 1) { say("Choose at least 1 seat.", "err"); return; }
          if (ap.seats > seatsLeft()) { say("Only " + seatsLeft() + " seat" + (seatsLeft() === 1 ? "" : "s") + " left on this trip.", "err"); return; }
          ap.step = 3; ap.err = null; say(""); paint(); return;
        }
        if (ap.step === 3) { save(); return; }
        ap.step = Math.min(3, ap.step + 1);
      } else {
        ap.step = Math.max(1, ap.step - 1);
      }
      ap.err = null; say(""); paint();
    }
    function save() {
      readPax();
      var people = namedPax();
      if (!people.length || !ap.tripId) { ap.step = 2; paint(); say("Enter at least one passenger name.", "err"); return; }
      var t = tripById(ap.tripId);
      if (opsOn("capacity") && t) {
        var left = tripPaxLeft(t);
        if (left != null && people.length > left) {
          ap.saving = false; ap.err = "Only " + left + " seat" + (left === 1 ? "" : "s") + " left on this trip."; paint(); return;
        }
      }
      var pax = people.map(function (p) {
        var o = { full_name: p.name.trim(), category: p.category || "Adult", phone: p.phone || first.phone };
        if (p.idNumber) o.id_number = p.idNumber.trim();
        return o;
      });
      var first = people[0];
      if (!first.phone) { ap.step = 2; paint(); say("Enter a phone number (required).", "err"); return; }
      ap.saving = true; ap.err = null; paint();
      rpc("create_booking_quick", {   // name + phone are enough (migration 0080); ID is optional here
        p_company: company.id, p_trip: ap.tripId,
        p_booking: {
          contact_name: first.name.trim(), contact_phone: first.phone || null, contact_email: first.email || null,
          source: "Manual", status: "Pending", paid_amount: 0, payment_method: ap.method || null
        },
        p_passengers: pax
      }).then(function (res) {
        var bookingId = res && res.id;
        return (ap.markPaid && bookingId) ? markBookingPaid(bookingId, ap.method) : null;
      }).then(function () {
        closeModal();
        reload();
        boardToast(people.length === 1 ? (first.name + " booked.") : (people.length + " passengers booked."));
      }, function (e) {
        ap.saving = false; ap.err = (e && e.message) || "Could not save this booking."; paint();
      });
    }
    function bindInner() {
      if ($("apxDay")) {
        bindPicker($("apxDay"));
        $("apxDay").addEventListener("change", function () {
          ap.day = this.value || today; ap.tripId = null; paint();
        });
      }
      if ($("apxRoute")) $("apxRoute").addEventListener("change", function () { ap.routeKey = this.value; ap.tripId = null; paint(); });
      if ($("apxSwap")) $("apxSwap").addEventListener("click", function () {
        if (ap.routeKey && ap.routeKey.indexOf(" → ") >= 0) {
          var p = ap.routeKey.split(" → ");
          ap.routeKey = p[1] + " → " + p[0];
        }
        ap.tripId = null; paint();
      });
      [].forEach.call(document.querySelectorAll("[data-apx-trip]"), function (b) {
        b.addEventListener("click", function () {
          ap.tripId = b.dataset.apxTrip;
          [].forEach.call(document.querySelectorAll("[data-apx-trip]"), function (x) { x.classList.toggle("on", x === b); });
          paintSide();
        });
      });
      [].forEach.call(document.querySelectorAll("[data-seat]"), function (b) {
        b.addEventListener("click", function () {
          readPax();
          ap.seats = Math.max(1, Math.min(seatsLeft(), ap.seats + Number(b.dataset.seat)));
          paint();
        });
      });
      [].forEach.call(document.querySelectorAll("[data-method]"), function (b) {
        b.addEventListener("click", function () {
          readPax();
          ap.method = ap.method === b.dataset.method ? "" : b.dataset.method;
          paint();
        });
      });
    }

    openModal(shell(), "apx");
    $("apxPrev").addEventListener("click", function () { go(-1); });
    $("apxNext").addEventListener("click", function () { go(1); });
    paint();
  }
  // Cursor 2026-10-27: Operations Controls — each check defaults on; company can toggle off.
  var OPS_CTRL_KEYS = ["vesselClash", "maintLock", "crewAvail", "capacity", "readiness", "disruption", "actualTimes", "completeCheck", "paxTransfer", "trackFresh", "tasks", "audit"];
  function opsCtrl() {
    var s = company && company.settings ? company.settings["3_operations_controls"] : null;
    var out = {};
    OPS_CTRL_KEYS.forEach(function (k) { out[k] = true; });
    if (s && typeof s === "object") {
      OPS_CTRL_KEYS.forEach(function (k) { if (k in s) out[k] = s[k] !== false; });
    } else {
      var v = company && company.settings ? company.settings["3_vessel_conflict_detection"] : null;
      if (v && typeof v === "object" && "block" in v) out.vesselClash = v.block !== false;
      var old = company && company.settings ? company.settings["5_schedule_conflict_rules"] : null;
      if (old && typeof old === "object" && old.vessel === false) out.vesselClash = false;
    }
    return out;
  }
  function opsOn(k) { return opsCtrl()[k] !== false; }
  function preventVesselClash() { return opsOn("vesselClash"); }
  function tripEndTs(t) {
    if (!t || t.departTs == null) return 0;
    if (t.arriveTs) return t.arriveTs;
    return t.departTs + 3600000;
  }
  function tripOverlaps(a, b) {
    if (!a || !b || a.departTs == null || b.departTs == null) return false;
    return a.departTs < tripEndTs(b) && b.departTs < tripEndTs(a);
  }
  function vesselClashes(vesselId, trip) {
    if (!vesselId || !trip || trip.departTs == null) return [];
    return trips.filter(function (t) {
      return t.vessel_id === vesselId && t.id !== trip.id &&
        CLOSED.indexOf(t.raw.status) < 0 && t.raw.status !== "Cancelled" && tripOverlaps(t, trip);
    }).sort(function (a, b) { return a.departTs - b.departTs; });
  }
  function clashText(hits) {
    if (!hits || !hits.length) return "";
    var t = hits[0];
    var line = (t.time || "") + " " + (t.origin || "Origin") + " → " + (t.destination || "Destination");
    return hits.length > 1 ? line + " (+" + (hits.length - 1) + " more)" : line;
  }
  function vesselBusyBlock(vesselId, trip) {
    if (!preventVesselClash()) return "";
    var hits = vesselClashes(vesselId, trip);
    return hits.length ? "This vessel is already on " + clashText(hits) + "." : "";
  }
  function vesselMaintBlock(v) {
    if (!opsOn("maintLock") || !v || !vesselHasIssue(v)) return "";
    return (v.name || "This vessel") + " is " + (v.status || "unavailable") + " and cannot be dispatched.";
  }
  function vesselCapBlock(v, trip) {
    if (!opsOn("capacity") || !v || !trip || trip.booked == null || v.passenger_capacity == null) return "";
    if (Number(trip.booked) <= Number(v.passenger_capacity)) return "";
    return "Booked seats (" + trip.booked + ") exceed this vessel (" + v.passenger_capacity + ").";
  }
  function vesselAssignBlock(vesselId, trip) {
    var v = (vessels || []).filter(function (x) { return x.id === vesselId; })[0];
    return [vesselBusyBlock(vesselId, trip), vesselMaintBlock(v), vesselCapBlock(v, trip)].filter(Boolean).join(" ");
  }
  function personOnTrip(t, uid) {
    if (!t || !uid) return false;
    if (t.raw && t.raw.captain_id === uid) return true;
    var crew = t.raw && Array.isArray(t.raw.crew) ? t.raw.crew : (t.crewList || []);
    return crew.some(function (c) { return c.user_id === uid || c.id === uid; });
  }
  function crewClashHits(uid, trip) {
    if (!uid || !trip || trip.departTs == null) return [];
    return trips.filter(function (t) {
      return t.id !== trip.id && CLOSED.indexOf(t.raw.status) < 0 && t.raw.status !== "Cancelled" &&
        personOnTrip(t, uid) && tripOverlaps(t, trip);
    }).sort(function (a, b) { return a.departTs - b.departTs; });
  }
  function crewAvailNote(uid, trip) {
    if (!opsOn("crewAvail") || !uid || !trip) return "";
    var hits = crewClashHits(uid, trip);
    if (hits.length) return "Already on " + clashText(hits) + ".";
    var dayMap = rosterByDay[trip.day];
    if (dayMap) {
      var code = dayMap[uid];
      if (code === "OFF") return "Rostered off on this day.";
      if (code === "L") return "On leave this day.";
    }
    return "";
  }
  function tripPaxLeft(t) {
    if (!t || t.capacity == null) return null;
    return Math.max(0, Number(t.capacity) - (Number(t.booked) || 0));
  }
  function readinessPack(t) {
    if (!window.VeyoraOpsReadiness) return null;
    var f = crewFill(t);
    return window.VeyoraOpsReadiness.compute(t, {
      vessels: vessels, crewMixFn: mixOf, tripCrewCount: f.have, booked: t.booked, capacity: t.capacity,
      rules: { crew: true, weather: true, checklist: true }
    });
  }
  function vesselSchedule(v, trip) {
    var onBoat = trips.filter(function (t) {
      return t.vessel_id === v.id && t.id !== trip.id && CLOSED.indexOf(t.raw.status) < 0 && t.raw.status !== "Cancelled";
    }).sort(function (a, b) { return a.departTs - b.departTs; });
    var clashes = vesselClashes(v.id, trip);
    var clash = clashes.length > 0;
    var prev = null, next = null;
    onBoat.forEach(function (t) {
      if (t.departTs <= trip.departTs) prev = t;
      if (t.departTs > trip.departTs && !next) next = t;
    });
    var avail = v.status === "Out of service" || v.status === "Restricted" ? "maint" : (clash ? "busy" : "ok");
    return {
      avail: avail,
      label: avail === "ok" ? "Available" : avail === "busy" ? "Busy" : (v.status || "Unavailable"),
      last: prev ? prev.time : "—",
      next: next ? next.time : "—",
      clash: clash,
      clashNote: clash ? "Overlaps " + clashText(clashes) : ""
    };
  }
  function avTripRow(t) {
    var dur = tripDuration(t);
    return '<span class="ap-time">' + esc(t.time) + '<small>' + esc(dayPretty(t.day)) + '</small></span>' +
      '<span class="ap-route">' +
        '<span class="ap-corridor"><strong>' + esc(t.origin || "Origin") + '</strong>' + icon(I.arrow) + '<strong>' + esc(t.destination || "Destination") + '</strong></span>' +
        '<span class="ap-meta">' +
          (t.code ? '<span>' + esc(t.code) + '</span>' : "") +
          (dur != null ? '<span>' + dur + ' min</span>' : "") +
        '</span>' +
      '</span>';
  }
  function openAssign(tripId) {
    if (!canOps) return;
    var needVessel = unassignedTrips();
    var av = { step: "vessel", tripId: null, vesselId: null, q: "", err: null, saving: false, fromPick: false };
    if (tripId) {
      var t0 = trips.filter(function (x) { return x.id === tripId; })[0];
      if (!t0) return;
      av.tripId = tripId;
      av.vesselId = t0.vessel_id || null;
    } else {
      if (!needVessel.length) { boardToast("Every open trip already has a vessel."); return; }
      av.tripId = needVessel[0].id;
      av.fromPick = needVessel.length > 1;
      av.step = av.fromPick ? "pick" : "vessel";
    }

    function tripById(id) { return trips.filter(function (x) { return x.id === id; })[0]; }

    function renderPick() {
      var ts = needVessel.slice().sort(function (a, b) { return a.departTs - b.departTs; });
      return '<div class="ap-pop">' +
        '<header class="ap-pop-head"><h2>' + icon(I.vessel) + ' Assign vessel</h2><p class="note">Pick a trip that needs a boat.</p></header>' +
        stepsHtml(1, "Trip", "Vessel") +
        '<div class="ap-list">' + ts.map(function (t, i) {
          return '<button type="button" class="ap-card" style="--i:' + i + '" data-pick-trip="' + esc(t.id) + '">' + avTripRow(t) + chip(t.status) + '<span class="ap-chev">' + icon(I.chev) + '</span></button>';
        }).join("") + '</div>' +
        '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button></div>' +
      '</div>';
    }
    function renderVessel() {
      var t = tripById(av.tripId);
      if (!t) { av.step = "pick"; return renderPick(); }
      var qv = av.q.trim().toLowerCase();
      var vlist = (vessels || []).filter(function (v) {
        if (!qv) return true;
        return (v.name + " " + (v.code || "") + " " + (v.kind || "")).toLowerCase().indexOf(qv) >= 0;
      });
      return '<div class="ap-pop">' +
        '<header class="ap-pop-head ap-pop-head-form">' +
          (av.fromPick ? '<button type="button" class="ap-back" id="avBack" aria-label="Back to trips">' + icon(I.chev) + '</button>' : "") +
          '<div><h2>' + icon(I.vessel) + ' Assign vessel</h2><p class="note">Pick a boat for this sailing.</p></div>' +
        '</header>' +
        (av.fromPick ? stepsHtml(2, "Trip", "Vessel") : "") +
        '<div class="ap-trip-chip">' + avTripRow(t) + '</div>' +
        '<label class="ap-search">' + icon(I.search) + '<input id="avQ2" type="search" placeholder="Search vessel…" value="' + esc(av.q) + '"></label>' +
        '<div class="av-list">' +
          (vlist.length ? vlist.map(function (v) {
            var sch = vesselSchedule(v, t);
            var cap = v.passenger_capacity != null ? (v.passenger_capacity + " pax") : "—";
            var on = av.vesselId === v.id;
            var tight = t.booked != null && v.passenger_capacity != null && Number(t.booked) > Number(v.passenger_capacity);
            return '<button type="button" class="av-card' + (on ? " on" : "") + (sch.avail !== "ok" ? " dim" : "") + (sch.clash ? " clash" : "") + '" data-pick="' + esc(v.id) + '">' +
              '<span class="av-boat">' + window.VeyoraShell.vesselPhotoImg(v) + '</span>' +
              '<span class="grow"><strong>' + esc(v.name) + '</strong>' +
                '<small>' + esc([v.kind || "Vessel", cap].join(" · ")) +
                  (v.crew_capacity != null ? " · " + v.crew_capacity + " crew" : "") + '</small>' +
                '<span class="av-times">Last ' + esc(sch.last) + ' · Next ' + esc(sch.next) + '</span>' +
                (sch.clashNote ? '<span class="av-warn">' + esc(sch.clashNote) + '</span>' : "") +
                (tight ? '<span class="av-warn">Booked seats exceed this vessel</span>' : "") +
              '</span>' +
              '<span class="av-badge av-' + sch.avail + '">' + esc(sch.label) + '</span>' +
              '<span class="av-radio" aria-hidden="true">' + (on ? icon(I.check) : "") + '</span>' +
            '</button>';
          }).join("") : '<div class="ap-empty">' + icon(I.boat) + '<p>No vessels match.</p></div>') +
        '</div>' +
        (av.err ? '<p class="msg err">' + esc(av.err) + '</p>' : "") +
        '<p class="av-hint">' + icon(I.alert) + ' This vessel will be assigned to <strong>' + esc(t.code || "this trip") + '</strong>.</p>' +
        '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button>' +
          '<button type="button" class="save' + (av.saving ? " is-busy" : "") + '" id="avGo2"' +
            (av.vesselId && !av.saving && !vesselAssignBlock(av.vesselId, t) ? "" : " disabled") + '>' +
            (av.saving ? '<i class="ap-spin"></i>Assigning…' : (icon(I.check) + ' Assign Vessel')) + '</button></div>' +
      '</div>';
    }
    function renderSuccess(t, v) {
      return '<div class="ap-pop ap-pop-success">' +
        '<div class="ap-success"><span class="ap-success-ring">' + icon(I.check) + '</span>' +
          '<h2>Vessel assigned</h2>' +
          '<p class="note">' + esc(v.name || "Vessel") + ' is assigned to ' + esc(t.time) + ' &middot; ' + esc(t.origin || "") + ' &rarr; ' + esc(t.destination || "") + '</p>' +
        '</div>' +
      '</div>';
    }

    function bind() {
      if (av.step === "pick") {
        [].forEach.call($("modalCard").querySelectorAll("[data-pick-trip]"), function (b) {
          b.addEventListener("click", function () {
            av.tripId = b.dataset.pickTrip; av.vesselId = null; av.q = ""; av.err = null; av.step = "vessel";
            paint("fwd");
          });
        });
      } else if (av.step === "vessel") {
        if ($("avBack")) $("avBack").addEventListener("click", function () { av.step = "pick"; av.err = null; paint("back"); });
        if ($("avQ2")) $("avQ2").addEventListener("input", function () {
          av.q = $("avQ2").value; paint();
          var n = $("avQ2"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
        });
        [].forEach.call($("modalCard").querySelectorAll("[data-pick]"), function (b) {
          b.addEventListener("click", function () {
            av.vesselId = b.dataset.pick;
            av.err = vesselAssignBlock(av.vesselId, tripById(av.tripId)) || null;
            paint();
          });
        });
        if ($("avGo2")) $("avGo2").addEventListener("click", function () {
          if (!av.vesselId) return;
          var t = tripById(av.tripId), v = (vessels || []).filter(function (x) { return x.id === av.vesselId; })[0];
          var block = vesselAssignBlock(av.vesselId, t);
          if (block) { av.err = block; paint(); return; }
          av.saving = true; av.err = null; paint();
          db.from("trips").update({ vessel_id: av.vesselId }).eq("id", av.tripId).then(function (res) {
            if (res.error) { av.saving = false; av.err = res.error.message; paint(); return; }
            openModal(renderSuccess(t, v || {}));
            reload();
            setTimeout(function () { closeModal(); }, 1400);
          });
        });
      }
    }
    function paint(dir) {
      openModal(av.step === "vessel" ? renderVessel() : renderPick());
      if (dir) { var el = $("modalCard").querySelector(".ap-pop"); if (el) el.classList.add("anim-" + dir); }
      bind();
    }
    paint();
  }

  function renderSettings(area, canEdit) {
    var pill = (location.hash || "").slice(1).split("/")[1] || "";
    $("ops").innerHTML = '<section class="dash-card" id="pageSettings"></section>';
    if (window.PageSettings) window.PageSettings.mount($("pageSettings"), { area: area, pill: pill, esc: esc, company: function () { return company; }, db: db, rpc: rpc, canEdit: canEdit });
  }
  function render() {
    pageView = readPageView();
    destroyLiveMap();
    if (pageView === "settings") {
      setPageHead();
      $("opsActions").innerHTML = '<a class="btn-soft" href="#">Overview</a>';
      renderSettings("operations", canOps);
      return;
    }
    if (pageView === "home") { renderHome(); return; }

    var k = kpis();
    var list = filtered();
    var statuses = ["Scheduled", "On time", "Boarding", "Delayed", "En Route", "Arrived", "Completed", "Cancelled"];
    var counts = tabCounts();
    var needVessel = unassignedTrips().length;
    setPageHead();

    $("opsActions").innerHTML =
      '<button type="button" class="btn-soft" id="opsGoHome">Overview</button>' +
      '<a class="btn-soft" href="#settings">Settings</a>' +
      (canOps
        ? '<button type="button" class="btn-soft" id="opsAddPax">' + icon(I.plus) + ' Add passenger</button>' +
          '<button type="button" class="btn-soft" id="opsAssign">' + icon(I.vessel) + ' Assign vessel' +
            (needVessel ? '<b class="ops-act-badge">' + needVessel + '</b>' : "") + '</button>' +
          '<button type="button" class="primary-btn" id="opsNew">' + icon(I.plus) + ' Add New Trip</button>'
        : "");

    $("ops").innerHTML =
      '<div class="ops-kpis">' +
        '<div class="ops-kpi"><span class="tile tone-blue">' + icon(I.vessel) + '</span><div><small>Active Trips</small><strong>' + k.active + '</strong><span class="sub">' + esc(k.activeHint) + '</span></div></div>' +
        '<div class="ops-kpi"><span class="tile tone-amber">' + icon(I.alert) + '</span><div><small>Delayed Trips</small><strong>' + k.delayed + '</strong><span class="sub">' + esc(k.delayedHint) + '</span></div></div>' +
        '<div class="ops-kpi"><span class="tile tone-teal">' + icon(I.boat) + '</span><div><small>Available Vessels</small><strong>' + k.vessels + '</strong><span class="sub">' + esc(k.vesselsHint) + '</span></div></div>' +
        '<div class="ops-kpi"><span class="tile tone-violet">' + icon(I.people) + '</span><div><small>Crew on Duty</small><strong>' + k.crew + '</strong><span class="sub">' + esc(k.crewHint) + '</span></div></div>' +
      '</div>' +
      '<div class="ops-layout">' +
        '<section class="ops-main">' +
          '<div class="card-head">' +
            '<div><h2>' + esc(boardTitle()) + '</h2>' +
              '<div class="ops-tabs seg">' +
                [["today", "Today"], ["upcoming", "Upcoming"], ["crew", "Crew"], ["completed", "Completed"], ["cancelled", "Cancelled"]].map(function (t) {
                  var n = counts[t[0]];
                  return '<button type="button" class="' + (tab === t[0] ? "on" : "") + '" data-tab="' + t[0] + '">' + t[1] + (n ? '<b class="' + (t[0] === "crew" ? "warn" : "") + '" title="' + (t[0] === "crew" ? "Trips still short of crew" : n + " trips") + '">' + n + '</b>' : "") + '</button>';
                }).join("") +
              '</div>' +
            '</div>' +
            '<div class="ops-head-acts">' +
              '<label class="ops-date"><input type="date" id="opsDay" value="' + esc(dayF) + '" aria-label="Filter by date"></label>' +
              (dayF ? '<button type="button" class="btn-soft" id="clearDayTop">Clear</button>' : "") +
            '</div>' +
          '</div>' +
          (tab === "crew" ? "" :
            '<div class="ops-filters">' +
              '<select id="opsRoute" aria-label="Routes">' + options(routes, routeF, "All routes") + '</select>' +
              '<select id="opsVessel" aria-label="Vessels">' + options(vessels, vesselF, "All vessels") + '</select>' +
              '<select id="opsStatus" aria-label="Statuses"><option value="">All statuses</option>' +
                statuses.map(function (s) { return '<option value="' + esc(s) + '"' + (statusF === s ? " selected" : "") + '>' + esc(s) + '</option>'; }).join("") +
              '</select>' +
              '<label class="fsearch">' + icon(I.search) + '<input type="search" id="opsQ" placeholder="Find a trip" value="' + esc(q) + '" aria-label="Find a trip"></label>' +
            '</div>') +
          (tab === "crew" ? "" : liveStrip()) +
          (tab === "crew" ? crewBoard() : (list.length ? listByDay(list) : emptyBoard())) +
        '</section>' +
      '</div>';

    bind();
  }

  function loadData() {
    var today = todayIso();
    var focus = viewDay || dayF || today;
    var win = tripWindow(focus);
    tripFrom = win.from;
    tripTo = win.to;
    var from = new Date(win.from + "T00:00:00"), to = new Date(addDays(win.to, 1) + "T00:00:00");
    // Don't block the board on scan_operations — it can run slowly; cron already covers most of it.
    rpc("scan_operations", { p_company: company.id }).then(function () {}, function () {});
    return Promise.all([
      rpc("ops_board", { p_company: company.id, p_day: today }),
      rpc("schedule_trips", { p_company: company.id, p_from: from.toISOString(), p_to: to.toISOString() }),
      db.from("routes").select("id,name,origin,destination,duration_min").eq("company_id", company.id).eq("active", true).order("name"),
      db.from("vessels").select("id,name,code,kind,status,passenger_capacity,crew_capacity,registration,meta").eq("company_id", company.id).order("name")
    ]).then(function (res) {
      var board = res[0] || {};
      kp = board.kpis || null;
      queue = board.queue || [];
      trips = ((res[1] || {}).trips || []).map(view);
      if (res[2].error) throw new Error(res[2].error.message);
      if (res[3].error) throw new Error(res[3].error.message);
      routes = res[2].data || [];
      vessels = res[3].data || [];
      var heldIds = trips.filter(isHeld).map(function (t) { return t.id; });
      return Promise.all([
        db.from("company_members").select("user_id, job_title_id").eq("company_id", company.id).eq("active", true).eq("employment_status", "Active"),
        heldIds.length
          ? soft(db.from("trip_events").select("trip_id, detail, created_at").in("trip_id", heldIds).ilike("detail", "Held at departure%").order("created_at", { ascending: false }), { data: [] }, 8000)
          : Promise.resolve({ data: [] })
      ]);
    }).then(function (res) {
      var m = res[0];
      heldReasons = {};
      ((res[1] && res[1].data) || []).forEach(function (ev) {
        if (!heldReasons[ev.trip_id]) heldReasons[ev.trip_id] = ev.detail;
      });
      if (m && m.error) { staff = []; return; }
      var members = (m && m.data) || [];
      var ids = members.map(function (x) { return x.user_id; });
      if (!ids.length) { staff = []; return; }
      var jobTitleByUser = {};
      members.forEach(function (x) { if (x.job_title_id) jobTitleByUser[x.user_id] = x.job_title_id; });
      return Promise.all([
        db.from("profiles").select("id, full_name, email").in("id", ids),
        db.from("job_titles").select("id, title, crew_group").eq("company_id", company.id)
      ]).then(function (res) {
        var jobTitles = {};
        ((res[1] && res[1].data) || []).forEach(function (jt) { jobTitles[jt.id] = jt; });
        staff = ((res[0] && res[0].data) || []).map(function (x) {
          var jt = jobTitleByUser[x.id] ? jobTitles[jobTitleByUser[x.id]] : null;
          return {
            id: x.id, name: x.full_name || (x.email || "").split("@")[0] || "Staff",
            jobTitle: jt ? jt.title : "", crewGroup: jt ? jt.crew_group : ""
          };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      });
    });
  }

  function reload() {
    return loadData().then(function () {
      try { render(); } catch (e) {
        destroyLiveMap();
        $("ops").innerHTML = '<section class="dash-card"><h2>Could not load Operations</h2><p class="note">' + esc((e && e.message) || String(e)) + '</p></section>';
      }
    }, function (err) {
      destroyLiveMap();
      $("ops").innerHTML = '<section class="dash-card"><h2>Could not load Operations</h2><p class="note">' + esc(err.message) + '</p></section>';
    });
  }

  // Cursor 2026-10-27: Add New Trip is a 4-step fullscreen wizard (mockup). Saves one-off trips.insert; Delayed stays manual.
  function ntxDash(v) { return v ? esc(v) : "—"; }
  function ntxPrettyDay(day) {
    if (!day) return "Select date";
    return new Date(day + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }
  function ntxFmtDur(min) {
    min = Number(min) || 0;
    if (!min) return "";
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + "h " + m + "m";
    if (h) return h + "h";
    return m + "m";
  }
  function ntxParseDur(s) {
    s = String(s || "").trim().toLowerCase();
    if (!s) return 0;
    var h = 0, m = 0, hm = s.match(/(\d+)\s*h/), mm = s.match(/(\d+)\s*m/);
    if (hm) h = +hm[1];
    if (mm) m = +mm[1];
    if (!hm && !mm) {
      if (/^\d+$/.test(s)) m = +s;
      else if (/^\d+\s*:\s*\d+$/.test(s)) { var p = s.split(":"); h = +p[0]; m = +p[1]; }
    }
    return h * 60 + m;
  }
  function ntxRoute() { return (routes || []).filter(function (r) { return r.id === ntx.routeId; })[0]; }
  // Cursor 2026-10-27: Schedule & Route recap labels (1hr 30min, origin - dest).
  function ntxDurLabel() {
    var min = ntxParseDur(ntx.duration);
    var r = ntxRoute();
    if (!min && r) min = Number(r.duration_min) || 0;
    if (!min) return "—";
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + "hr " + m + "min";
    if (h) return h + "hr";
    return m + "min";
  }
  function ntxCorridor() {
    var r = ntxRoute();
    var origin = ntx.origin || (r && r.origin) || "";
    var dest = ntx.dest || (r && r.destination) || "";
    if (origin && dest) return origin + " - " + dest;
    return (r && r.name) || "";
  }
  function ntxVessel() { return (vessels || []).filter(function (v) { return v.id === ntx.vesselId; })[0]; }
  function ntxArriveDate() {
    var min = ntxParseDur(ntx.duration);
    if (!ntx.day || !ntx.time || !min) return null;
    var d = new Date(ntx.day + "T" + ntx.time + ":00");
    d.setMinutes(d.getMinutes() + min);
    return d;
  }
  function ntxArriveClock() {
    var d = ntxArriveDate();
    return d ? pad2(d.getHours()) + ":" + pad2(d.getMinutes()) : "";
  }
  function ntxPortOpts(which) {
    var seen = {}, list = [], val = which === "origin" ? ntx.origin : ntx.dest;
    (routes || []).forEach(function (r) {
      var p = which === "origin" ? r.origin : r.destination;
      if (p && !seen[p]) { seen[p] = 1; list.push({ id: p, name: p }); }
    });
    list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return options(list, val, which === "origin" ? "Select departure port" : "Select arrival port");
  }
  function ntxKinds() { return ["Scheduled", "Extra", "Charter"].map(function (k) { return { id: k, name: k }; }); }
  function ntxServices() { return ["Passenger", "Cargo", "Mixed"].map(function (k) { return { id: k, name: k }; }); }
  function ntxCaptains() {
    var caps = (staff || []).filter(function (s) {
      return /captain|skipper|master/.test(((s.jobTitle || "") + " " + (s.crewGroup || "")).toLowerCase());
    });
    return caps.length ? caps : (staff || []);
  }
  function ntxCrewPool() {
    return (staff || []).filter(function (s) { return s.id !== ntx.captainId && ntx.crew.indexOf(s.id) < 0; });
  }
  // Cursor 2026-10-27: crew dropdown + chips show job title (designation).
  function ntxDesignation(s) {
    var t = s && s.jobTitle ? String(s.jobTitle).trim() : "";
    return t || "No designation";
  }
  function ntxStaffOf(uid) {
    return (staff || []).filter(function (x) { return x.id === uid; })[0];
  }
  function ntxStaffOpts(list, val, all) {
    return options((list || []).map(function (s) {
      return { id: s.id, name: (s.name || "Staff member") + " · " + ntxDesignation(s) };
    }), val, all);
  }
  function ntxRoleOf(uid) {
    var s = (staff || []).filter(function (x) { return x.id === uid; })[0];
    var r = s && s.jobTitle ? String(s.jobTitle).trim() : "";
    return r.length >= 2 && r.length <= 40 ? r : "Crew";
  }
  function ntxLiveVessels() {
    return (vessels || []).filter(function (v) {
      if (v.status === "Out of service") return false;
      if (opsOn("maintLock") && vesselHasIssue(v)) return false;
      return true;
    });
  }
  function ntxAsTrip() {
    if (!ntx || !ntx.day || !ntx.time) return { id: null, departTs: null, arriveTs: null };
    var dep = new Date(ntx.day + "T" + ntx.time + ":00");
    var arr = ntxArriveDate();
    return { id: null, departTs: dep.getTime(), arriveTs: arr ? arr.getTime() : null };
  }
  function ntxFld(id, label, req, inner) {
    return '<div class="ntx-fld"><label for="' + id + '">' + label + (req ? " <i>*</i>" : "") + "</label>" + inner + "</div>";
  }
  function ntxSyncArrive() {
    var el = $("ntxArrive");
    if (el) el.value = ntxArriveClock() || "Auto-calculated";
  }
  function ntxSyncSel(id) {
    var el = $(id);
    if (el && window.VeyoraSelect) window.VeyoraSelect.sync(el);
  }
  function ntxApplyRoute(fromPorts) {
    var r = ntxRoute();
    if (!r) return;
    if (!fromPorts) {
      ntx.origin = r.origin || "";
      ntx.dest = r.destination || "";
      if ($("ntxOrigin")) { $("ntxOrigin").value = ntx.origin; ntxSyncSel("ntxOrigin"); }
      if ($("ntxDest")) { $("ntxDest").value = ntx.dest; ntxSyncSel("ntxDest"); }
    }
    if (ntx.durationFromRoute) {
      ntx.duration = ntxFmtDur(r.duration_min);
      if ($("ntxDur")) $("ntxDur").value = ntx.duration;
    }
    ntxSyncArrive();
    ntxPaintSum();
  }
  function ntxMatchPorts() {
    var hit = (routes || []).filter(function (r) { return r.origin === ntx.origin && r.destination === ntx.dest; })[0];
    if (!hit || hit.id === ntx.routeId) { ntxPaintSum(); return; }
    ntx.routeId = hit.id;
    if ($("ntxRoute")) { $("ntxRoute").value = hit.id; ntxSyncSel("ntxRoute"); }
    ntxApplyRoute(true);
  }
  function ntxRead() {
    if (!ntx) return;
    if ($("ntxRoute")) ntx.routeId = $("ntxRoute").value;
    if ($("ntxKind")) ntx.tripType = $("ntxKind").value || "Scheduled";
    if ($("ntxService")) ntx.service = $("ntxService").value || "Passenger";
    if ($("ntxOrigin")) ntx.origin = $("ntxOrigin").value;
    if ($("ntxDest")) ntx.dest = $("ntxDest").value;
    if ($("ntxDay")) ntx.day = $("ntxDay").value;
    if ($("ntxTime")) ntx.time = $("ntxTime").value;
    if ($("ntxDur")) ntx.duration = $("ntxDur").value;
    if ($("ntxCap")) ntx.captainId = $("ntxCap").value;
    if ($("ntxPax")) ntx.pax = $("ntxPax").value;
    if ($("ntxNote")) ntx.note = $("ntxNote").value;
  }
  function ntxValid(step) {
    if (step === 1) {
      if (!ntx.routeId) { say("Choose a route.", "err"); return false; }
      if (!ntx.day || !ntx.time) { say("Set departure date and time.", "err"); return false; }
    }
    if (step === 2 && ntx.vesselId) {
      var block = vesselAssignBlock(ntx.vesselId, ntxAsTrip());
      if (block) { say(block, "err"); return false; }
    }
    return true;
  }
  function ntxShell() {
    return '<div class="ntx-shell">' +
      '<button type="button" class="ntx-back" data-close>' + icon(I.back) + ' Back to Operations</button>' +
      '<header class="ntx-head"><h2>Add New Trip</h2><p>Create a new trip and assign vessel, crew and schedule</p></header>' +
      '<ol class="ntx-steps" id="ntxSteps"></ol>' +
      '<div class="ntx-grid"><div class="ntx-main" id="ntxMain"></div><aside class="ntx-sum" id="ntxSum"></aside></div>' +
      '<footer class="ntx-foot">' +
        '<button type="button" class="ghost ntx-cancel" data-close>Cancel</button>' +
        '<p class="msg" id="mMsg" role="status"></p>' +
        '<div class="ntx-nav">' +
          '<button type="button" class="ghost" id="ntxPrev">Previous</button>' +
          '<button type="button" class="primary-btn" id="ntxNext">Next ' + icon(I.arrow) + '</button>' +
        '</div>' +
      '</footer></div>';
  }
  function ntxPaintSteps() {
    var labels = ["Trip Details", "Vessel & Crew", "Schedule & Route", "Passengers & Notes"];
    $("ntxSteps").innerHTML = labels.map(function (lab, i) {
      var n = i + 1, cls = ntx.step === n ? "on" : (n < ntx.step ? "done" : "");
      return '<li class="' + cls + '"><span>' + n + '</span> ' + lab + '</li>';
    }).join("");
  }
  function ntxStepHtml() {
    if (ntx.step === 1) {
      return '<section class="ntx-card">' +
          '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.info) + '</span><div><h3>Trip Details</h3><p>Enter the basic information for this trip</p></div></header>' +
          '<div class="ntx-fields">' +
            ntxFld("ntxRoute", "Route", true, '<select id="ntxRoute" aria-label="Route">' + options(routes, ntx.routeId, "Select route") + '</select>') +
            ntxFld("ntxKind", "Trip Type", true, '<select id="ntxKind" aria-label="Trip type">' + options(ntxKinds(), ntx.tripType, "Select type") + '</select>') +
            ntxFld("ntxCode", "Trip Number", false, '<input id="ntxCode" value="Auto-generated" disabled>') +
            ntxFld("ntxService", "Service Type", true, '<select id="ntxService" aria-label="Service type">' + options(ntxServices(), ntx.service, "Select service") + '</select>') +
            ntxFld("ntxOrigin", "Departure Port", true, '<select id="ntxOrigin" aria-label="Departure port">' + ntxPortOpts("origin") + '</select>') +
            ntxFld("ntxDest", "Arrival Port", true, '<select id="ntxDest" aria-label="Arrival port">' + ntxPortOpts("dest") + '</select>') +
          '</div>' +
        '</section>' +
        '<section class="ntx-card">' +
          '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.calendar) + '</span><div><h3>Date &amp; Time</h3><p>Set the departure date and time for this trip</p></div></header>' +
          '<div class="ntx-fields">' +
            ntxFld("ntxDay", "Departure Date", true, '<span class="ntx-combo">' + icon(I.calendar) + '<strong id="ntxDayLab">' + esc(ntxPrettyDay(ntx.day)) + '</strong>' + icon(I.calendar) + '<input id="ntxDay" type="date" value="' + esc(ntx.day) + '" aria-label="Departure date"></span>') +
            ntxFld("ntxTime", "Departure Time", true, '<span class="ntx-combo">' + icon(I.clock) + '<strong id="ntxTimeLab">' + esc(ntx.time || "08:00") + '</strong>' + icon(I.clock) + '<input id="ntxTime" type="time" value="' + esc(ntx.time) + '" aria-label="Departure time"></span>') +
            ntxFld("ntxDur", "Estimated Duration", false, '<input id="ntxDur" placeholder="e.g. 1h 30m" value="' + esc(ntx.duration) + '">') +
            ntxFld("ntxArrive", "Expected Arrival Time", false, '<input id="ntxArrive" value="' + esc(ntxArriveClock() || "Auto-calculated") + '" disabled>') +
          '</div>' +
        '</section>';
    }
    if (ntx.step === 2) {
      var live = ntxLiveVessels();
      var caps = ntxCaptains();
      var pool = ntxCrewPool();
      return '<section class="ntx-card">' +
          '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.vessel) + '</span><div><h3>Vessel</h3><p>Assign a vessel to this sailing</p></div></header>' +
          (live.length
            ? '<div class="ntx-vessels">' + live.map(function (v) {
                var cap = v.passenger_capacity != null ? Number(v.passenger_capacity) : null;
                var sch = vesselSchedule(v, ntxAsTrip());
                return '<button type="button" class="ntx-vcard' + (ntx.vesselId === v.id ? " on" : "") + (sch.clash ? " busy" : "") + '" data-nv="' + esc(v.id) + '">' +
                  window.VeyoraShell.vesselPhotoImg(v) +
                  '<strong>' + esc(v.name || v.code || "Vessel") + '</strong>' +
                  '<small>' + esc([v.code && v.code !== v.name ? v.code : "", v.kind || "", cap != null ? cap + " pax" : ""].filter(Boolean).join(" · ")) + '</small>' +
                  (sch.clashNote ? '<em class="av-warn">' + esc(sch.clashNote) + '</em>' : "") +
                '</button>';
              }).join("") + '</div>'
            : '<p class="note">No vessels in service. You can still create the trip and assign one later.</p>') +
        '</section>' +
        '<section class="ntx-card">' +
          '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.people) + '</span><div><h3>Crew</h3><p>Captain and extra crew for this trip</p></div></header>' +
          '<div class="ntx-fields">' +
            ntxFld("ntxCap", "Captain", false, '<select id="ntxCap" aria-label="Captain">' + ntxStaffOpts(caps, ntx.captainId, "Select captain") + '</select>') +
            '<div class="ntx-fld ntx-fld-full"><span>Crew</span><div class="ntx-crew-add"><select id="ntxCrewPick" aria-label="Add crew">' + ntxStaffOpts(pool, "", "Add a crew member") + '</select><button type="button" class="ghost" id="ntxCrewAdd">Add</button></div>' +
              (ntx.crew.length ? '<div class="ntx-chips">' + ntx.crew.map(function (uid) {
                var person = ntxStaffOf(uid);
                return '<span class="ntx-chip"><span class="ntx-chip-who"><strong>' + esc(person ? person.name : staffName(uid)) + '</strong><small>' + esc(ntxDesignation(person)) + '</small></span><button type="button" data-uncrew="' + esc(uid) + '" aria-label="Remove">&times;</button></span>';
              }).join("") + '</div>' : '<p class="ntx-hint">Optional — you can crew the trip from dispatch later.</p>') +
            '</div></div></section>';
    }
    if (ntx.step === 3) {
      var r = ntxRoute();
      var origin = ntx.origin || (r && r.origin) || "";
      var dest = ntx.dest || (r && r.destination) || "";
      return '<section class="ntx-card">' +
          '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.clock) + '</span><div><h3>Schedule &amp; Route</h3><p>Check the sailing before you add passengers</p></div></header>' +
          '<div class="ntx-journey">' +
            '<div class="ntx-journey-end">' +
              '<small>Departure</small>' +
              '<strong>' + ntxDash(origin) + '</strong>' +
              '<span>' + ntxDash(ntxPrettyDay(ntx.day)) + ' · ' + ntxDash(ntx.time) + '</span>' +
            '</div>' +
            '<div class="ntx-journey-mid" aria-hidden="true"><i></i><span>' + esc(ntxDurLabel()) + '</span></div>' +
            '<div class="ntx-journey-end ntx-journey-arr">' +
              '<small>Arrival</small>' +
              '<strong>' + ntxDash(dest) + '</strong>' +
              '<span>' + ntxDash(ntxArriveClock() || "Auto") + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="ntx-meta3">' +
            '<div><small>Route</small><strong>' + ntxDash(ntxCorridor()) + '</strong></div>' +
            '<div><small>Trip type</small><strong>' + ntxDash(ntx.tripType) + '</strong></div>' +
            '<div><small>Service</small><strong>' + ntxDash(ntx.service) + '</strong></div>' +
          '</div>' +
          '<p class="ntx-hint">Use Previous to change ports, date or duration.</p>' +
        '</section>';
    }
    return '<section class="ntx-card">' +
        '<header class="ntx-card-h"><span class="ntx-ic">' + icon(I.people) + '</span><div><h3>Passengers &amp; Notes</h3><p>Expected load and anything the crew should know</p></div></header>' +
        '<div class="ntx-fields ntx-fields-1">' +
          ntxFld("ntxPax", "Expected Passengers", false, '<input id="ntxPax" type="number" min="0" max="5000" placeholder="e.g. 48" value="' + esc(ntx.pax) + '">') +
          ntxFld("ntxNote", "Notes", false, '<textarea id="ntxNote" rows="5" maxlength="500" placeholder="Internal notes for this sailing">' + esc(ntx.note) + '</textarea>') +
        '</div>' +
      '</section>';
  }
  function ntxSumRow(lab, val) {
    return '<div><span>' + lab + '</span><b>' + ntxDash(val) + '</b></div>';
  }
  function ntxPaintSum() {
    if (!$("ntxSum") || !ntx) return;
    var r = ntxRoute(), v = ntxVessel();
    var cap = ntx.captainId ? staffName(ntx.captainId) : "";
    var crewN = ntx.crew.length;
    $("ntxSum").innerHTML =
      '<div class="ntx-sum-head"><span class="ntx-ic">' + icon(I.vessel) + '</span><div><h3>Trip Summary</h3><p>Details will be updated as you complete each step</p></div></div>' +
      '<section class="ntx-sum-sec' + (ntx.step === 1 ? " on" : "") + '"><h4>Trip Details</h4>' +
        ntxSumRow("Route", r && r.name) + ntxSumRow("Departure", ntx.origin) + ntxSumRow("Arrival", ntx.dest) + ntxSumRow("Trip Type", ntx.tripType) +
      '</section>' +
      '<section class="ntx-sum-sec' + (ntx.step === 2 ? " on" : "") + '"><h4>Vessel &amp; Crew</h4>' +
        ntxSumRow("Vessel", v && (v.name || v.code)) + ntxSumRow("Captain", cap) + ntxSumRow("Crew", crewN ? String(crewN) : "") +
      '</section>' +
      '<section class="ntx-sum-sec' + (ntx.step === 3 ? " on" : "") + '"><h4>Schedule &amp; Route</h4>' +
        ntxSumRow("Departure", ntx.time) + ntxSumRow("Arrival", ntxArriveClock()) + ntxSumRow("Duration", ntx.duration) +
      '</section>' +
      '<section class="ntx-sum-sec' + (ntx.step === 4 ? " on" : "") + '"><h4>Passengers &amp; Notes</h4>' +
        ntxSumRow("Expected Passengers", ntx.pax) + ntxSumRow("Notes", ntx.note) +
      '</section>';
  }
  function ntxBind() {
    if ($("ntxRoute")) $("ntxRoute").addEventListener("change", function () { ntx.routeId = this.value; ntxApplyRoute(false); });
    if ($("ntxKind")) $("ntxKind").addEventListener("change", function () { ntx.tripType = this.value || "Scheduled"; ntxPaintSum(); });
    if ($("ntxService")) $("ntxService").addEventListener("change", function () { ntx.service = this.value || "Passenger"; ntxPaintSum(); });
    if ($("ntxOrigin")) $("ntxOrigin").addEventListener("change", function () { ntx.origin = this.value; ntxMatchPorts(); });
    if ($("ntxDest")) $("ntxDest").addEventListener("change", function () { ntx.dest = this.value; ntxMatchPorts(); });
    if ($("ntxDay")) {
      bindPicker($("ntxDay"));
      $("ntxDay").addEventListener("change", function () {
        ntx.day = this.value;
        if ($("ntxDayLab")) $("ntxDayLab").textContent = ntxPrettyDay(ntx.day);
        ntxSyncArrive(); ntxPaintSum();
      });
    }
    if ($("ntxTime")) {
      bindPicker($("ntxTime"));
      $("ntxTime").addEventListener("change", function () {
        ntx.time = this.value;
        if ($("ntxTimeLab")) $("ntxTimeLab").textContent = ntx.time || "08:00";
        ntxSyncArrive(); ntxPaintSum();
      });
    }
    if ($("ntxDur")) $("ntxDur").addEventListener("input", function () {
      ntx.duration = this.value; ntx.durationFromRoute = false; ntxSyncArrive(); ntxPaintSum();
    });
    if ($("ntxCap")) $("ntxCap").addEventListener("change", function () { ntx.captainId = this.value; ntxPaintSum(); });
    if ($("ntxPax")) $("ntxPax").addEventListener("input", function () { ntx.pax = this.value; ntxPaintSum(); });
    if ($("ntxNote")) $("ntxNote").addEventListener("input", function () { ntx.note = this.value; ntxPaintSum(); });
    [].forEach.call(document.querySelectorAll("[data-nv]"), function (btn) {
      btn.addEventListener("click", function () {
        if (ntx.vesselId === btn.dataset.nv) ntx.vesselId = "";
        else ntx.vesselId = btn.dataset.nv;
        var block = ntx.vesselId ? vesselAssignBlock(ntx.vesselId, ntxAsTrip()) : "";
        say(block, block ? "err" : "");
        ntxPaint();
      });
    });
    if ($("ntxCrewAdd")) $("ntxCrewAdd").addEventListener("click", function () {
      var pick = $("ntxCrewPick");
      if (!pick || !pick.value) return;
      if (ntx.crew.indexOf(pick.value) < 0) ntx.crew.push(pick.value);
      ntxPaint();
    });
    [].forEach.call(document.querySelectorAll("[data-uncrew]"), function (btn) {
      btn.addEventListener("click", function () {
        ntx.crew = ntx.crew.filter(function (id) { return id !== btn.dataset.uncrew; });
        ntxPaint();
      });
    });
  }
  function ntxPaint() {
    if (!ntx || !$("ntxMain")) return;
    ntxPaintSteps();
    $("ntxMain").innerHTML = ntxStepHtml();
    ntxPaintSum();
    var prev = $("ntxPrev"), next = $("ntxNext");
    if (prev) prev.disabled = ntx.step <= 1;
    if (next) {
      next.disabled = false;
      next.innerHTML = ntx.step === 4 ? "Create trip" : ("Next " + icon(I.arrow));
    }
    ntxBind();
  }
  function ntxGo(delta) {
    ntxRead();
    if (delta > 0) {
      if (ntx.step === 4) { ntxSave(); return; }
      if (!ntxValid(ntx.step)) return;
      ntx.step = Math.min(4, ntx.step + 1);
    } else {
      ntx.step = Math.max(1, ntx.step - 1);
    }
    say("");
    ntxPaint();
  }
  function ntxSave() {
    ntxRead();
    if (!ntxValid(1)) { ntx.step = 1; ntxPaint(); return; }
    if (!ntxValid(2)) { ntx.step = 2; ntxPaint(); return; }
    var dep = new Date(ntx.day + "T" + ntx.time + ":00");
    var arr = ntxArriveDate();
    var v = ntxVessel();
    var pax = ntx.pax === "" || ntx.pax == null ? null : Number(ntx.pax);
    if (pax != null && !isFinite(pax)) pax = null;
    if (pax == null && v && v.passenger_capacity != null) pax = Number(v.passenger_capacity);
    var note = String(ntx.note || "").trim().slice(0, 500);
    var next = $("ntxNext");
    if (next) next.disabled = true;
    say("Saving…");
    var row = {
      company_id: company.id,
      route_id: ntx.routeId,
      vessel_id: ntx.vesselId || null,
      captain_id: ntx.captainId || null,
      kind: ntx.tripType || "Scheduled",
      depart_at: dep.toISOString(),
      arrive_at: arr ? arr.toISOString() : null,
      seats_total: pax,
      note: note || null,
      meta: { service_type: ntx.service || "Passenger" }
    };
    db.from("trips").insert(row).select("id,code").single().then(function (r) {
      if (r.error) { if (next) next.disabled = false; say(r.error.message, "err"); return; }
      var id = r.data && r.data.id;
      var jobs = ntx.crew.filter(function (uid) { return uid && uid !== ntx.captainId; }).map(function (uid) {
        return db.from("trip_crew").insert({ trip_id: id, company_id: company.id, user_id: uid, role: ntxRoleOf(uid) });
      });
      return Promise.all(jobs).then(function () {
        closeModal();
        tab = iso(dep) === todayIso() ? "today" : "upcoming";
        reload();
      }, function (e) {
        closeModal();
        tab = iso(dep) === todayIso() ? "today" : "upcoming";
        boardToast((e && e.message) || "Trip saved; crew could not be added.", true);
        reload();
      });
    }, function (e) {
      if (next) next.disabled = false;
      say((e && e.message) || "Could not create the trip.", "err");
    });
  }
  function openNewTrip() {
    if (!routes.length) {
      openModal('<h2>Add New Trip</h2><p class="note">Add a route first. Routes are set up under <a href="schedules.html">Schedules</a>.</p>' +
        '<div class="modal-actions"><button type="button" class="ghost" data-close>Close</button></div>');
      return;
    }
    ntx = {
      step: 1, routeId: "", tripType: "Scheduled", service: "Passenger",
      origin: "", dest: "", day: viewDayIso(), time: "08:00", duration: "", durationFromRoute: true,
      vesselId: "", captainId: "", crew: [], pax: "", note: ""
    };
    openModal(ntxShell(), "ntx");
    $("ntxPrev").addEventListener("click", function () { ntxGo(-1); });
    $("ntxNext").addEventListener("click", function () { ntxGo(1); });
    ntxPaint();
  }

  // Trip detail view: Overview (assign, clear, status), Passengers (manifest, check-in, boarding, manual booking),
  // Crew (captain + crew, roster auto-assign) and History (trip_events). Data: trip_manifest, trip_crew, trip_events.
  // Cursor 2026-10-23: passenger board uses paxSort / paxView for sort + density.
  var detail = { id: null, tab: "overview", man: null, crew: [], events: [], addPax: false, paxId: null, paxExtra: null, track: null, paxF: "all", paxQ: "", paxSort: "name", paxView: "cards", seatPicker: null };
  var trackMap = null, trackTimer = null;
  var wxCache = {}; // Cursor 2026-10-27: WeatherAPI.com answers keyed by query
  var homeWx = null;

  function soft(p, fallback, ms) {
    var done = Promise.resolve(p).then(function (v) { return v; }, function () { return fallback; });
    if (!ms) return done;
    return Promise.race([
      done,
      new Promise(function (resolve) { setTimeout(function () { resolve(fallback); }, ms); })
    ]);
  }
  function loadDetail(id) {
    // Soft + timed: hung trip_manifest must not leave the modal on “Loading…”.
    return Promise.all([
      soft(rpc("trip_manifest", { p_trip: id }), null, 8000),
      soft(db.from("trip_crew").select("user_id, role, meta").eq("trip_id", id), { data: [] }, 8000),
      soft(db.from("trip_events").select("kind, detail, created_at").eq("trip_id", id).order("created_at", { ascending: false }).limit(60), { data: [] }, 8000)
    ]).then(function (res) {
      var man = res[0];
      detail.man = man && typeof man === "object"
        ? { passengers: man.passengers || [], counts: man.counts || {}, sellable: man.sellable, seats_booked: man.seats_booked }
        : { passengers: [], counts: {}, _err: true };
      detail.crew = (res[1] && !res[1].error && res[1].data) || [];
      detail.events = (res[2] && !res[2].error && res[2].data) || [];
    });
  }

  function openTrip(id, tabSel, openAdd) {
    detail.id = id; detail.tab = tabSel || "overview"; detail.addPax = !!openAdd;
    detail.panel = null; detail.swap = null; // Cursor 2026-10-27: vessel/delay sheets on trip detail
    detail.paxId = null; detail.paxExtra = null;
    detail.track = null; detail.seatPicker = null;
    destroyTrackMap();
    if (!trips.some(function (x) { return x.id === id; })) return;
    // Paint the trip shell immediately from board data; enrich when detail RPCs return.
    detail.man = { passengers: [], counts: {}, _loading: true };
    detail.crew = [];
    detail.events = [];
    try { renderTrip(); } catch (e) {
      openModal('<p class="msg err">' + esc((e && e.message) || "Could not open this trip.") + '</p><div class="modal-actions"><button type="button" class="ghost" data-close>Close</button></div>');
      return;
    }
    loadDetail(id).then(function () {
      if (detail.id !== id || $("modal").hidden) return;
      try { renderTrip(); } catch (e) { say((e && e.message) || "Could not refresh trip.", "err"); }
    }, function (e) {
      if (detail.id !== id || $("modal").hidden) return;
      detail.man = { passengers: [], counts: {}, _err: true };
      try { renderTrip(); } catch (err) {}
      say((e && e.message) || "Some trip details could not load.", "err");
    });
  }

  function staffName(uid) { var s = staff.filter(function (x) { return x.id === uid; })[0]; return s ? s.name : "Staff member"; }
  function fmtTime(ts) { var d = new Date(ts); return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function listSetting(key, def) {
    var v = company && company.settings ? company.settings[key] : null;
    var rows = Array.isArray(v) ? v : def;
    return rows.map(function (r) { return typeof r === "string" ? r : r && r.name; }).filter(Boolean);
  }
  // Cursor 2026-10-24: money + methods from Finance Settings (9_base_currency / 9_payment_methods / 9_supported_currencies).
  function baseCurrency() {
    var s = company && company.settings ? company.settings["9_base_currency"] : null;
    var code = (s && typeof s === "object" && s.base) || (company && company.currency) || "MVR";
    var dec = s && typeof s === "object" && Number(s.decimals) >= 0 ? Number(s.decimals) : 2;
    return { code: String(code || "MVR"), dec: Math.min(4, Math.max(0, dec)) };
  }
  function payMethods() {
    var m = listSetting("9_payment_methods", ["Cash", "Card", "Bank transfer", "Mobile wallet", "Invoice"]);
    return m.length ? m : ["Cash", "Card", "Bank transfer", "Mobile wallet", "Invoice"];
  }
  function acceptedCurrencies() {
    var base = baseCurrency().code;
    var list = listSetting("9_supported_currencies", [base]);
    if (list.indexOf(base) < 0) list = [base].concat(list);
    return list.length ? list : [base];
  }
  function fmtMoney(n) {
    var c = baseCurrency(), x = Number(n) || 0;
    return c.code + " " + x.toLocaleString(undefined, { minimumFractionDigits: c.dec, maximumFractionDigits: c.dec });
  }
  function payMethodsHtml(selected) {
    var methods = payMethods(), cur = selected || methods[0] || "Cash";
    if (methods.indexOf(cur) < 0) cur = methods[0] || "Cash";
    return methods.map(function (x) { return '<option' + (x === cur ? " selected" : "") + '>' + esc(x) + '</option>'; }).join("");
  }
  function payCurrencyNote() {
    var cur = acceptedCurrencies(), base = baseCurrency().code;
    if (cur.length <= 1) return '<small class="plx-pay-cur">Amounts in ' + esc(base) + '</small>';
    return '<small class="plx-pay-cur">Amounts in ' + esc(base) + ' · Accepted: ' + esc(cur.join(", ")) + '</small>';
  }
  function tripDuration(t) {
    if (t.departTs && t.arriveTs) {
      var m0 = Math.round((t.arriveTs - t.departTs) / 60000);
      if (m0 > 0) return m0;
    }
    if (!t.raw || !t.raw.depart_at || !t.raw.arrive_at) return null;
    var m = Math.round((new Date(t.raw.arrive_at) - new Date(t.raw.depart_at)) / 60000);
    return m > 0 ? m : null;
  }
  function durWords(min) {
    min = Number(min) || 0;
    if (!min) return "";
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + " hr " + m + " min";
    if (h) return h === 1 ? "1 hour" : h + " hours";
    return min + " minute" + (min === 1 ? "" : "s");
  }
  function vesselHasIssue(v) {
    if (!v) return false;
    return v.status === "Out of service" || v.status === "Restricted" || v.status === "Maintenance";
  }
  function vesselSpeed(v) {
    var m = vesselMetaOf(v);
    return m.max_speed || m.speed_knots || m.speed || "";
  }
  function dayPretty(day) {
    try { return new Date(day + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return day; }
  }
  function loadPct(booked, total) {
    var p = seatPct(booked, total);
    return p == null ? 0 : p;
  }

  function progressBar(pct) {
    return '<span class="td-bar"><span style="width:' + Math.max(0, Math.min(100, pct || 0)) + '%"></span></span>';
  }

  // Cursor 2026-10-27: trip detail matches the light mockup; Change vessel / Delay / Resume live here.
  function tripHero(t) {
    var r = t.raw || {}, st = statusLabel(t.status);
    var showActual = opsOn("actualTimes");
    var actDep = r.actual_depart ? fmtTime(r.actual_depart).split(" ").pop() : "";
    var actArr = r.actual_arrive ? fmtTime(r.actual_arrive).split(" ").pop() : "";
    var dep = (showActual && actDep) ? actDep : t.time;
    var arr = (showActual && actArr) ? actArr : (t.arrive || "—");
    var dur = tripDuration(t), durLab = durWords(dur) || (dur != null ? dur + " min" : "—");
    var v = vesselOf(t), closed = CLOSED.indexOf(r.status) >= 0;
    var delayed = r.status === "Delayed";
    var issue = vesselHasIssue(v);
    var why = delayed && r.status_reason ? r.status_reason : (isHeld(t) ? "Held — " + heldReasonFor(t) : "");
    return '<header class="tdv-hero">' +
      '<div class="tdv-top">' +
        '<div class="tdv-id">' + icon(I.vessel) + '<strong>' + esc(t.code || "Trip") + '</strong>' + chip(st) +
          (why ? '<span class="tdv-why">' + icon(I.alert) + esc(why) + '</span>' : "") +
        '</div>' +
        '<div class="tdv-tools">' +
          (canOps && !closed ? '<button type="button" class="tdv-btn' + (issue ? " primary" : "") + '" data-tdv-panel="vessel">' + icon(I.swap) + ' Change vessel</button>' : "") +
          (canOps && !closed && delayed ? '<button type="button" class="tdv-btn primary" data-act="Scheduled">' + icon(I.ok) + ' Resume</button>' : "") +
          (canOps && !closed && !delayed && opsOn("disruption") ? '<button type="button" class="tdv-btn warn" data-tdv-panel="delay">' + icon(I.alert) + ' Delay</button>' : "") +
          '<span class="tdv-morewrap">' +
            '<button type="button" class="tdv-icon" id="tdvMoreBtn" data-tdv-more aria-haspopup="true" aria-label="More">' + icon(I.hdots) + '</button>' +
            tdvMoreMenu(t, closed) +
          '</span>' +
          '<button type="button" class="tdv-icon" data-close aria-label="Close">' + icon(I.close) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="tdv-journey">' +
        '<div class="tdv-end">' +
          '<span class="tdv-end-ic from">' + icon(I.boat) + '</span>' +
          '<strong>' + esc(dep) + '</strong><span>' + esc(t.origin || "Origin") + '</span>' +
          (showActual && actDep ? '<small class="tdv-sched">Scheduled ' + esc(t.time) + '</small>' : "") +
        '</div>' +
        '<div class="tdv-rail"><i></i><span class="tdv-boat">' + icon(I.boat) + '</span><i></i><em>' + esc(durLab) + '</em></div>' +
        '<div class="tdv-end right">' +
          '<span class="tdv-end-ic to">' + icon(I.pin) + '</span>' +
          '<strong>' + esc(arr) + '</strong><span>' + esc(t.destination || "Destination") + '</span>' +
          (showActual && actArr ? '<small class="tdv-sched">Scheduled ' + esc(t.arrive || "—") + '</small>' : "") +
        '</div>' +
      '</div>' +
      '<div class="tdv-meta">' +
        '<span>' + icon(I.calendar) + esc(dayPretty(t.day)) + '</span>' +
        '<span>' + icon(I.clock) + esc(durLab) + '</span>' +
        '<span>' + icon(I.vessel) + esc(t.vessel || t.vesselCode || "No vessel") + '</span>' +
        '<span>' + icon(I.person) + esc(t.captain ? "Capt. " + t.captain : "No captain") + '</span>' +
        '<span>' + icon(I.pin) + esc((t.origin || "") + (t.destination ? " → " + t.destination : "") || "—") + '</span>' +
      '</div>' +
      stepper(t) +
      (issue ? '<div class="tdv-issue">' + icon(I.alert) + '<span><strong>' + esc(v.name || t.vessel || "Vessel") + '</strong> is ' + esc(v.status) + '. Change vessel to continue this sailing.</span>' +
        (canOps && !closed ? '<button type="button" class="tdv-btn primary" data-tdv-panel="vessel">Change vessel</button>' : "") +
      '</div>' : "") +
    '</header>';
  }
  function tdvMoreMenu(t, closed) {
    var r = t.raw || {}, items = [];
    if (canOps && !closed) {
      if (!r.cleared_at) items.push(["clear", "Clear to sail"]);
      else if (["Scheduled", "Delayed"].indexOf(r.status) >= 0) items.push(["Boarding", "Start boarding"]);
      else if (r.status === "Boarding") items.push(["Departed", "Mark departed"]);
      else if (["Departed", "In transit"].indexOf(r.status) >= 0) items.push(["Arrived", "Mark arrived"]);
      items.push(["vessel", "Change vessel"]);
      if (r.status === "Delayed") items.push(["Scheduled", "Resume (clear delay)"]);
      else if (opsOn("disruption")) items.push(["delay", "Delay trip"]);
      items.push(["Cancelled", "Cancel trip"]);
    }
    return '<div class="tdv-menu" id="tdvMenu" hidden>' +
      items.map(function (x) {
        var attr = x[0] === "vessel" || x[0] === "delay" || x[0] === "clear"
          ? ' data-tdv-panel="' + x[0] + '"'
          : ' data-act="' + x[0] + '"';
        return '<button type="button"' + attr + '>' + esc(x[1]) + '</button>';
      }).join("") +
      '<button type="button" data-print="manifest">' + icon(I.print) + ' Print manifest</button>' +
    '</div>';
  }
  // Scheduled → Cleared → Boarding → Departed → Arrived, with the current step lit.
  function stepper(t) {
    var r = t.raw || {};
    if (r.status === "Cancelled") return "";
    var steps = ["Scheduled", "Cleared", "Boarding", "Departed", "Arrived"];
    var at = r.status === "Arrived" || r.status === "Completed" ? 4 : (r.status === "Departed" || r.status === "In transit") ? 3 : r.status === "Boarding" ? 2 : r.cleared_at ? 1 : 0;
    return '<ol class="tdv-steps">' + steps.map(function (x, k) {
      return '<li class="' + (k < at ? "done" : k === at ? "now" : "") + '"><span>' + (k + 1) + '</span>' + x + '</li>';
    }).join("") + '</ol>';
  }

  function dispatchBar(t, closed) {
    if (!canOps || closed) return "";
    var r = t.raw || {};
    var pack = opsOn("readiness") ? readinessPack(t) : null;
    var primary = "";
    if (!r.cleared_at) primary = '<button type="button" class="save" data-act="clear">Clear to sail</button>';
    else if (["Scheduled", "Delayed"].indexOf(r.status) >= 0) primary = '<button type="button" class="save" data-act="Boarding">Start boarding</button>';
    else if (r.status === "Boarding") primary = '<button type="button" class="save" data-act="Departed">Mark departed</button>';
    else if (["Departed", "In transit"].indexOf(r.status) >= 0) primary = '<button type="button" class="save" data-act="Arrived">Mark arrived</button>';
    return '<div class="td-actions td-actions-foot">' +
      (!r.cleared_at
        ? '<div class="tdx-checks">' +
            '<div class="tdx-checks-head"><strong>Before you clear to sail</strong><span class="tdx-checks-count" id="cCount">0 of 2 done</span></div>' +
            (pack && pack.issues && pack.issues.length
              ? '<ul class="tdx-ready">' + pack.issues.map(function (i) {
                  return '<li class="' + (i.severity === "blocking" ? "block" : "warn") + '">' + esc(i.message) + '</li>';
                }).join("") + '</ul>' : "") +
            '<div class="tdx-checks-grid">' +
              '<label class="tdx-check"><input type="checkbox" id="cWeather"><span class="tdx-check-ic">' + icon('<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18Z"/>') + '</span>' +
                '<span class="grow"><strong>Weather checked</strong><small>Wind, waves and visibility are fine for this crossing</small></span><span class="tdx-tick">' + icon(I.ok) + '</span></label>' +
              '<label class="tdx-check"><input type="checkbox" id="cCheck"><span class="tdx-check-ic">' + icon(I.shield || '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/>') + '</span>' +
                '<span class="grow"><strong>Safety done</strong><small>Life jackets, exits, fire kit and headcount checked</small></span><span class="tdx-tick">' + icon(I.ok) + '</span></label>' +
            '</div></div>' : "") +
      '<div class="td-actions-main">' +
        primary +
        (["Scheduled", "Delayed", "Boarding"].indexOf(r.status) >= 0 && r.cleared_at
          ? '<button type="button" class="btn-soft" data-act="Departed">Depart now</button>' : "") +
        (r.status === "Delayed" ? '<button type="button" class="btn-soft" data-act="Scheduled">Resume</button>' : (opsOn("disruption") ? '<button type="button" class="ghost" data-tdv-panel="delay">Delay</button>' : "")) +
        '<button type="button" class="ghost td-danger" data-act="Cancelled">Cancel</button>' +
      '</div>' +
      '<details class="tdx-why" id="cWhy"><summary><span class="tdx-why-ic">' + icon(I.alert) + '</span><span class="grow"><strong>Delay or cancel this trip</strong><small id="cWhyHint">Pick a reason first, then press Delay or Cancel</small></span><span class="tdx-why-chev">' + icon(I.chev) + '</span></summary>' +
        '<div class="tdx-why-body">' +
          '<div class="tdx-reasons" role="radiogroup" aria-label="Reason">' +
            listSetting("3_delay_reasons", ["Weather", "Technical fault", "Late crew", "Late passengers", "Port congestion", "Fuel delay", "Safety inspection", "Other"]).map(function (x) {
              return '<button type="button" class="tdx-reason" role="radio" aria-checked="false" data-reason="' + esc(x) + '">' + esc(x) + '</button>';
            }).join("") +
          '</div>' +
          '<select id="cReason" aria-label="Reason" hidden><option value=""></option>' +
            listSetting("3_delay_reasons", ["Weather", "Technical fault", "Late crew", "Late passengers", "Port congestion", "Fuel delay", "Safety inspection", "Other"]).map(function (x) {
              return '<option>' + esc(x) + '</option>';
            }).join("") +
          '</select>' +
          '<label class="tdx-why-other">' + icon('<path d="M4 20h4L18 10l-4-4L4 16v4ZM14 6l4 4"/>') + '<input id="cReasonOther" maxlength="200" placeholder="Or type your own reason (passengers see it)"></label>' +
        '</div></details>' +
    '</div>';
  }
  function delayReasons() {
    return listSetting("3_delay_reasons", ["Weather", "Technical fault", "Late crew", "Late passengers", "Port congestion", "Fuel delay", "Safety inspection", "Other"]);
  }
  function tdvSheet(t) {
    var panel = detail.panel;
    if (!panel) return "";
    if (panel === "delay") return tdvDelaySheet(t);
    if (panel === "vessel") return tdvVesselSheet(t);
    if (panel === "clear") return tdvClearSheet(t);
    return "";
  }
  function tdvDelaySheet(t) {
    return '<div class="tdv-sheet" id="tdvSheet">' +
      '<div class="tdv-sheet-card">' +
        '<header><h3>' + icon(I.alert) + ' Delay this trip</h3><button type="button" class="tdv-icon" data-tdv-panel="" aria-label="Close">' + icon(I.close) + '</button></header>' +
        '<p class="note">Passengers and crew will see this reason. Delayed is never set automatically.</p>' +
        '<div class="tdx-reasons" role="radiogroup" aria-label="Reason">' +
          delayReasons().map(function (x) {
            return '<button type="button" class="tdx-reason" role="radio" aria-checked="false" data-reason="' + esc(x) + '">' + esc(x) + '</button>';
          }).join("") +
        '</div>' +
        '<select id="cReason" hidden><option value=""></option>' + delayReasons().map(function (x) { return '<option>' + esc(x) + '</option>'; }).join("") + '</select>' +
        '<label class="tdx-why-other">' + icon('<path d="M4 20h4L18 10l-4-4L4 16v4ZM14 6l4 4"/>') +
          '<input id="cReasonOther" maxlength="200" placeholder="Or type your own reason (passengers see it)"></label>' +
        '<div class="tdv-sheet-acts">' +
          '<button type="button" class="ghost" data-tdv-panel="">Cancel</button>' +
          '<button type="button" class="save" data-act="Delayed">Confirm delay</button>' +
        '</div>' +
      '</div></div>';
  }
  function tdvClearSheet(t) {
    return '<div class="tdv-sheet" id="tdvSheet">' +
      '<div class="tdv-sheet-card">' +
        '<header><h3>' + icon(I.ok) + ' Clear to sail</h3><button type="button" class="tdv-icon" data-tdv-panel="" aria-label="Close">' + icon(I.close) + '</button></header>' +
        '<div class="tdx-checks-grid">' +
          '<label class="tdx-check"><input type="checkbox" id="cWeather"><span class="tdx-check-ic">' + icon('<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18Z"/>') + '</span>' +
            '<span class="grow"><strong>Weather checked</strong><small>Wind, waves and visibility are fine for this crossing</small></span><span class="tdx-tick">' + icon(I.ok) + '</span></label>' +
          '<label class="tdx-check"><input type="checkbox" id="cCheck"><span class="tdx-check-ic">' + icon(I.shield || '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/>') + '</span>' +
            '<span class="grow"><strong>Safety done</strong><small>Life jackets, exits, fire kit and headcount checked</small></span><span class="tdx-tick">' + icon(I.ok) + '</span></label>' +
        '</div>' +
        '<div class="tdv-sheet-acts">' +
          '<button type="button" class="ghost" data-tdv-panel="">Cancel</button>' +
          '<button type="button" class="save" data-act="clear">Clear to sail</button>' +
        '</div>' +
      '</div></div>';
  }
  function tdvVesselSheet(t) {
    var swap = detail.swap || (detail.swap = { vesselId: t.vessel_id || null, captainId: (t.raw && t.raw.captain_id) || null, q: "" });
    var qv = String(swap.q || "").trim().toLowerCase();
    var vlist = (vessels || []).filter(function (v) {
      if (!qv) return true;
      return (v.name + " " + (v.code || "") + " " + (v.kind || "")).toLowerCase().indexOf(qv) > -1;
    });
    return '<div class="tdv-sheet" id="tdvSheet">' +
      '<div class="tdv-sheet-card tdv-sheet-wide">' +
        '<header><h3>' + icon(I.vessel) + ' Change vessel</h3><button type="button" class="tdv-icon" data-tdv-panel="" aria-label="Close">' + icon(I.close) + '</button></header>' +
        '<p class="note">Pick a boat and continue this sailing. The trip stays on its current status.</p>' +
        '<label class="ap-search">' + icon(I.search) + '<input id="tdvVessQ" type="search" placeholder="Search vessel…" value="' + esc(swap.q || "") + '"></label>' +
        '<div class="av-list tdv-vlist">' +
          (vlist.length ? vlist.map(function (v) {
            var sch = vesselSchedule(v, t);
            var cap = v.passenger_capacity != null ? (v.passenger_capacity + " pax") : "—";
            var on = swap.vesselId === v.id;
            var issue = vesselHasIssue(v);
            return '<button type="button" class="av-card' + (on ? " on" : "") + (sch.avail !== "ok" || issue ? " dim" : "") + (sch.clash ? " clash" : "") + '" data-tdv-pick="' + esc(v.id) + '">' +
              '<span class="av-boat">' + window.VeyoraShell.vesselPhotoImg(v) + '</span>' +
              '<span class="grow"><strong>' + esc(v.name) + '</strong>' +
                '<small>' + esc([v.kind || "Vessel", cap].join(" · ")) + '</small>' +
                (sch.clashNote ? '<span class="av-warn">' + esc(sch.clashNote) + '</span>' : "") +
              '</span>' +
              '<span class="av-badge av-' + (issue ? "maint" : sch.avail) + '">' + esc(issue ? (v.status || "Unavailable") : sch.label) + '</span>' +
            '</button>';
          }).join("") : '<div class="ap-empty">' + icon(I.boat) + '<p>No vessels match.</p></div>') +
        '</div>' +
        '<div class="fld"><label for="aCaptain">Captain</label><select id="aCaptain">' + options(staff || [], swap.captainId || "", "No captain") + '</select></div>' +
        '<div class="tdv-sheet-acts">' +
          '<button type="button" class="ghost" data-tdv-panel="">Cancel</button>' +
          '<button type="button" class="save" id="tdvSaveVessel"' + (swap.vesselId && !vesselAssignBlock(swap.vesselId, t) ? "" : " disabled") + '>Save and continue</button>' +
        '</div>' +
      '</div></div>';
  }
  function tdvSeatMap(t, c) {
    var cap = Number(t.capacity) || 0, boarded = c.boarded || 0, chk = c.checked_in || 0;
    var booked = Math.max(0, (c.booked || 0));
    var avail = Math.max(0, cap - booked);
    if (!cap) return '<p class="note">Assign a vessel to see its seats.</p>';
    function seatCls(i) { return i < boarded ? "b" : i < boarded + chk ? "c" : i < booked ? "k" : "f"; }
    // Cursor 2026-10-27: hull uses tdv-hull so it is not the journey rail circle.
    var perRow = cap <= 10 ? 2 : cap <= 28 ? 4 : 6;
    var leftN = Math.ceil(perRow / 2), rightN = Math.floor(perRow / 2);
    var rows = [], i = 0;
    while (i < cap) {
      var L = [], R = [];
      for (var a = 0; a < leftN && i < cap; a++, i++) L.push('<i class="tdv-dot ' + seatCls(i) + '"></i>');
      for (var b = 0; b < rightN && i < cap; b++, i++) R.push('<i class="tdv-dot ' + seatCls(i) + '"></i>');
      rows.push('<div class="tdv-hull-row"><span class="bank">' + L.join("") + '</span><span class="aisle" aria-hidden="true"></span><span class="bank">' + R.join("") + '</span></div>');
    }
    return '<div class="tdv-seat">' +
      '<div class="tdv-seat-leg">' +
        '<span><i class="tdv-dot f"></i>Available <b>' + avail + '</b></span>' +
        '<span><i class="tdv-dot k"></i>Booked <b>' + Math.max(0, booked - boarded - chk) + '</b></span>' +
        '<span><i class="tdv-dot c"></i>Checked In <b>' + chk + '</b></span>' +
        '<span><i class="tdv-dot b"></i>Boarded <b>' + boarded + '</b></span>' +
      '</div>' +
      '<div class="tdv-seat-body">' +
        '<div class="tdv-hull" style="--rows:' + rows.length + '">' +
          '<svg class="tdv-hull-shape" viewBox="0 0 240 420" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs><linearGradient id="tdvHullFill" x1="0" y1="0" x2="0" y2="1">' +
              '<stop offset="0" stop-color="#eaf4fc"/><stop offset=".55" stop-color="#d7e8f5"/><stop offset="1" stop-color="#c9dcec"/>' +
            '</linearGradient></defs>' +
            '<path fill="url(#tdvHullFill)" stroke="#8aa7c0" stroke-width="3" stroke-linejoin="round" d="M120 10C152 26 180 56 196 100c16 46 22 98 20 162-2 62-12 114-28 148H52C36 376 26 324 24 262 22 198 28 146 44 100 60 56 88 26 120 10z"/>' +
            '<path fill="#9ec4de" opacity=".55" d="M120 46c14 8 26 22 30 38H90c4-16 16-30 30-38z"/>' +
            '<path fill="none" stroke="#b7cce0" stroke-width="1.4" d="M58 118c22 10 40 12 62 12s40-2 62-12"/>' +
          '</svg>' +
          '<div class="tdv-hull-inner">' +
            '<div class="tdv-hull-bow"><span>Bow</span></div>' +
            '<div class="tdv-hull-deck">' + rows.join("") + '</div>' +
            '<div class="tdv-hull-stern"><span>Stern</span></div>' +
          '</div>' +
        '</div>' +
        '<aside class="tdv-seat-stats">' +
          '<div><small>Total Seats</small><strong>' + cap + '</strong></div>' +
          '<div><small>Available</small><strong class="ok">' + avail + '</strong></div>' +
          '<div><small>Checked In</small><strong class="amb">' + chk + '</strong></div>' +
          '<div><small>Boarded</small><strong class="go">' + boarded + '</strong></div>' +
        '</aside>' +
      '</div></div>';
  }
  function tdvFunnel(c, cap) {
    var total = Math.max(1, cap || c.booked || 0);
    var booked = c.booked || 0, chk = c.checked_in || 0, boarded = c.boarded || 0;
    var steps = [
      ["Booked", booked, "k", I.person],
      ["Checked In", chk, "c", I.ok],
      ["Boarded", boarded, "b", I.bag]
    ];
    return '<div class="tdv-funnel">' + steps.map(function (s) {
      var pct = total ? Math.round(s[1] * 100 / total) : 0;
      return '<div class="tdv-funnel-row">' + icon(s[3]) +
        '<span class="lbl">' + s[0] + '</span>' +
        '<span class="tdv-funnel-bar"><span class="' + s[2] + '" style="width:' + pct + '%"></span></span>' +
        '<strong>' + s[1] + ' / ' + (cap || booked || 0) + ' <em>(' + pct + '%)</em></strong>' +
      '</div>';
    }).join("") + '</div>';
  }
  function tdvCrewPeople(t) {
    var out = [], seen = {};
    if (t.captain) {
      out.push({ name: t.captain, role: "Captain", id: t.raw && t.raw.captain_id });
      if (t.raw && t.raw.captain_id) seen[t.raw.captain_id] = true;
    }
    (detail.crew || []).forEach(function (c) {
      if (seen[c.user_id]) return;
      seen[c.user_id] = true;
      out.push({ name: staffName(c.user_id), role: c.role || "Crew", id: c.user_id });
    });
    if (!out.length && t.crewList) {
      t.crewList.forEach(function (c) { out.push({ name: c.name, role: c.role || "Crew" }); });
    }
    return out;
  }
  function tdvCrewTab(t, closed) {
    var f = crewFill({ captain: t.captain, crewCount: (detail.crew || []).length, vessel_id: t.vessel_id });
    var people = [];
    if (t.captain) people.push({ name: t.captain, role: "Captain", uid: t.raw && t.raw.captain_id, isCapt: true });
    (detail.crew || []).forEach(function (x) {
      if (t.raw && t.raw.captain_id && x.user_id === t.raw.captain_id) return;
      people.push({ name: staffName(x.user_id), role: x.role || "Crew", uid: x.user_id, auto: x.meta && x.meta.auto });
    });
    var onTrip = {};
    people.forEach(function (p) { if (p.uid) onTrip[p.uid] = true; });
    var avail = (staff || []).filter(function (s) { return !onTrip[s.id]; });
    var roleOpts = ["Crew", "Cashier", "Deck", "Engineering", "Cabin"];
    mixOf(t).forEach(function (m) {
      var role = String(m.role || "");
      if (role && roleOpts.indexOf(role) < 0 && !isCaptainRole(role)) roleOpts.push(role);
    });
    var opens = [];
    var pool = (detail.crew || []).map(function (x) { return { role: x.role }; });
    mixOf(t).forEach(function (m) {
      var role = String(m.role), n = Number(m.n) || 0, isCapt = isCaptainRole(role);
      for (var k = 0; k < n; k++) {
        var filled = false;
        if (isCapt && k === 0 && t.captain) filled = true;
        else {
          var ix = -1;
          pool.forEach(function (c, j) { if (ix < 0 && String(c.role || "").toLowerCase() === role.toLowerCase()) ix = j; });
          if (ix > -1) { pool.splice(ix, 1); filled = true; }
        }
        if (!filled) opens.push(role);
      }
    });
    var openN = Math.max(0, (f.need || 0) - people.length);
    var pct = f.need ? Math.round(people.length * 100 / f.need) : (people.length ? 100 : 0);
    var rolesSel = function (cur, uid) {
      return '<select class="tdv-cp-sel" data-role-user="' + esc(uid) + '" aria-label="Role">' +
        roleOpts.map(function (role) { return '<option' + (cur === role ? " selected" : "") + '>' + esc(role) + '</option>'; }).join("") +
        (roleOpts.indexOf(cur) < 0 ? '<option selected>' + esc(cur) + '</option>' : "") +
      '</select>';
    };
    return '<div class="tdv-crewtab">' +
      '<div class="tdv-kpis tdv-crew-kpis">' +
        tdvKpi(I.people, "blue", "Crew on board", people.length + (f.need ? " / " + f.need : ""), pct) +
        tdvKpi(I.plus, "violet", "Open seats", opens.length || openN, null) +
        tdvKpi(I.person, "green", "Captain", t.captain ? t.captain : "Unassigned", null) +
      '</div>' +
      '<div class="tdv-grid">' +
        '<section class="td-block tdv-card">' +
          '<div class="td-block-head"><h3>' + icon(I.people) + ' Crew on Board</h3>' +
            '<span class="tdv-crew-n">' + people.length + (f.need ? " / " + f.need : "") + ' crew</span></div>' +
          '<div class="tdv-cp-grid">' +
            people.map(function (p) {
              var person = p.uid ? ntxStaffOf(p.uid) : null;
              var des = person ? ntxDesignation(person) : "";
              return '<article class="tdv-cp">' +
                '<span class="ops-av r-' + slug(p.role || "crew") + '">' + esc(initials(p.name)) + '</span>' +
                '<div class="tdv-cp-who"><strong>' + esc(p.name) + '</strong>' +
                  '<small>' + esc([p.role, des && des !== "No designation" ? des : ""].filter(Boolean).join(" · ") || p.role) +
                    (p.auto ? " · roster" : "") + '</small></div>' +
                '<span class="tdv-cp-role r-' + slug(p.role || "crew") + '">' + esc(String(p.role || "Crew").toUpperCase()) + '</span>' +
                (canOps && !closed && p.uid && !p.isCapt ? rolesSel(p.role, p.uid) : "") +
                (canOps && !closed && p.uid && !p.isCapt ? '<button type="button" class="tdv-cp-x" data-uncrew="' + esc(p.uid) + '" title="Remove">×</button>' : "") +
              '</article>';
            }).join("") +
            opens.map(function (role) {
              return canOps && !closed
                ? '<button type="button" class="tdv-cp is-open" data-seat-role="' + esc(role) + '"><span class="tdv-cp-plus">+</span><div class="tdv-cp-who"><strong>Open seat</strong><small>Needs a ' + esc(role) + '</small></div><span class="tdv-cp-role">' + esc(role.toUpperCase()) + '</span></button>'
                : '<div class="tdv-cp is-open"><span class="tdv-cp-plus">+</span><div class="tdv-cp-who"><strong>Open seat</strong><small>' + esc(role) + '</small></div></div>';
            }).join("") +
            (canOps && !closed ? '<button type="button" class="tdv-cp is-add" data-tdv-addcrew>' + icon(I.plus) + '<strong>Add Crew</strong></button>' : "") +
          '</div>' +
          (!people.length && !opens.length ? '<p class="note">No crew needs on this vessel yet. Set them under Vessel crew needs, or add someone here.</p>' : "") +
        '</section>' +
        (canOps && !closed
          ? '<div class="tdv-col">' +
              '<section class="td-block tdv-card" id="tdvAddCrew">' +
                '<div class="td-block-head"><h3>' + icon(I.plus) + ' Add Crew</h3></div>' +
                '<div class="tdv-add-flds">' +
                  '<div class="fld"><label for="cwUser">Person</label><select id="cwUser">' + ntxStaffOpts(avail, "", "Choose…") + '</select></div>' +
                  '<div class="fld"><label for="cwRole">Role</label><select id="cwRole">' + roleOpts.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join("") + '</select></div>' +
                '</div>' +
                '<button type="button" class="tdv-btn primary" id="cwAdd">' + icon(I.plus) + ' Add to trip</button>' +
                '<p class="note">Manual picks are kept. Roster fill only adds empty places.</p>' +
              '</section>' +
              '<section class="td-block tdv-card">' +
                '<div class="td-block-head"><h3>' + icon(I.person) + ' Captain</h3></div>' +
                '<div class="fld"><label for="aCaptain">Assigned captain</label><select id="aCaptain">' + ntxStaffOpts(staff || [], (t.raw && t.raw.captain_id) || "", "No captain") + '</select></div>' +
                '<button type="button" class="tdv-btn" id="aSave">Save captain</button>' +
              '</section>' +
              '<section class="td-block tdv-card">' +
                '<div class="td-block-head"><h3>' + icon(I.people) + ' Duty roster</h3></div>' +
                '<p class="note">Fill empty seats from people rostered today. People you added by hand stay.</p>' +
                '<button type="button" class="tdv-btn primary" id="cwAuto2">' + icon(I.people) + ' Fill open seats</button>' +
              '</section>' +
            '</div>'
          : "") +
      '</div>' +
    '</div>';
  }
  function tdvKpi(ic, tone, label, value, sub) {
    return '<div class="tdv-kpi">' +
      '<span class="tdv-kpi-ic ' + tone + '">' + icon(ic) + '</span>' +
      '<div><small>' + esc(label) + '</small><strong>' + esc(String(value)) + '</strong>' +
        (sub != null ? '<span class="tdv-kpi-bar"><i style="width:' + Math.min(100, sub) + '%"></i></span><em>' + sub + '%</em>' : "") +
      '</div></div>';
  }

  function kpi(label, value, tip, ic, tone) {
    return '<div class="td-kpi' + (tone ? " tone-" + tone : "") + '"' + (tip ? ' title="' + esc(tip) + '"' : "") + '>' + (ic ? '<span class="tdx-kic">' + icon(ic) + '</span>' : "") + '<span><small>' + esc(label) + '</small><strong>' + esc(String(value)) + '</strong></span></div>';
  }
  function isCaptainRole(role) { return /^(captain|master|skipper)s?$/i.test(String(role || "").trim()); }
  // Which crew_group(s) (from job_titles) count as a match for a free-text seat role.
  function roleGroups(role) {
    var r = String(role || "").trim().toLowerCase();
    if (isCaptainRole(r)) return ["Captain"];
    if (r === "deck") return ["Deck"];
    if (r === "engineering") return ["Engineering"];
    if (r === "crew") return ["Deck", "Engineering"];
    return null; // Cabin/Cashier/custom roles have no fixed crew_group — match on job title text instead.
  }
  function staffMatchesRole(person, role) {
    var groups = roleGroups(role);
    if (groups) return groups.indexOf(person.crewGroup) >= 0;
    var r = String(role || "").trim().toLowerCase();
    return !!(r && person.jobTitle && person.jobTitle.toLowerCase().indexOf(r) >= 0);
  }
  // Same colour names as Settings > Shift Definitions (VEYORA_SHIFT_COLORS), resolved to a bg/fg pair for the chip.
  var SHIFT_PALETTE = {
    green: ["#dcf5e8", "#128a55"], lime: ["#e7f7d4", "#5c8a12"], teal: ["#daf5f0", "#12897a"],
    cyan: ["#d9f3fb", "#0e7490"], sky: ["#e0f0ff", "#0369a1"], blue: ["#e3f0ff", "#1677e8"],
    indigo: ["#e6e6fd", "#4338ca"], purple: ["#ece7fd", "#7a5af5"], violet: ["#f0e6fd", "#7c3aed"],
    pink: ["#fde7f3", "#be185d"], rose: ["#fde7e9", "#d64555"], coral: ["#fde3db", "#c2410c"],
    orange: ["#fde9d9", "#c2680c"], amber: ["#fdf0d9", "#b7791f"], gold: ["#fdf4d0", "#92700a"],
    navy: ["#dde6f5", "#1e3a6e"], slate: ["#e7ebf1", "#475569"], grey: ["#eef1f6", "#6b7a96"]
  };
  function shiftDefsByCode() {
    var raw = company && company.settings && company.settings["8_shift_definitions"];
    var by = {};
    (Array.isArray(raw) ? raw : []).forEach(function (s) {
      var code = String(s.code || (s.name || "?").charAt(0)).trim().toUpperCase().slice(0, 4);
      if (code && !by[code]) by[code] = { name: s.name || code, color: String(s.color || "Grey").toLowerCase(), start: s.start || "", end: s.end || "" };
    });
    by.OFF = by.OFF || { name: "Off duty", color: "rose" };
    by.L = by.L || { name: "Leave", color: "purple" };
    by.TRN = by.TRN || { name: "Training", color: "slate" };
    return by;
  }
  function toMin(hhmm) { var p = String(hhmm || "").split(":"); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  // Is a shift's start–end window covering the current clock time (handles shifts that cross midnight)?
  function isShiftNowActive(sh) {
    if (!sh || !sh.start || !sh.end) return false;
    var s = toMin(sh.start), e = toMin(sh.end);
    if (e <= s) e += 1440;
    var now = new Date(), n = now.getHours() * 60 + now.getMinutes();
    if (n < s) n += 1440;
    return n >= s && n < e;
  }
  // Rostered AND their shift's time window covers right now — only meaningful for today's trips.
  function workingNowFlag(uid, day, defs) {
    if (day !== todayIso()) return false;
    var dayMap = rosterByDay[day]; if (!dayMap) return false;
    var code = dayMap[uid];
    if (!code || code === "OFF" || code === "L" || code === "TRN") return false;
    return isShiftNowActive(defs[code]);
  }
  // The shift a person is rostered for on the trip's day — "" when the roster for that day hasn't loaded yet.
  function shiftChip(uid, day, defs) {
    var dayMap = rosterByDay[day];
    if (!dayMap) return '<span class="ops-seat-pick-shift loading">···</span>';
    var code = dayMap[uid];
    if (!code) return '<span class="ops-seat-pick-shift none">Not rostered</span>';
    var sh = defs[code] || { name: code, color: "grey" };
    var pal = SHIFT_PALETTE[sh.color] || SHIFT_PALETTE.grey;
    var now = workingNowFlag(uid, day, defs);
    return '<span class="ops-seat-pick-shift' + (now ? " is-now" : "") + '" style="background:' + pal[0] + ';color:' + pal[1] + '" title="' + (now ? "Working now" : "Rostered shift") + '">' + (now ? '<i class="ops-seat-pick-live"></i>' : "") + esc(sh.name) + '</span>';
  }
  // Loads once per day shown, then re-renders the open popup so the shift chips fill in.
  var rosterLoading = {};
  function ensureRosterDay(day) {
    if (rosterByDay[day] || rosterLoading[day]) return;
    rosterLoading[day] = true;
    db.from("roster_entries").select("user_id, shift").eq("company_id", company.id).eq("day", day).then(function (r) {
      var map = {};
      ((r && r.data) || []).forEach(function (row) { map[row.user_id] = row.shift; });
      rosterByDay[day] = map;
      delete rosterLoading[day];
      syncSeatPopup();
    }, function () { rosterByDay[day] = {}; delete rosterLoading[day]; syncSeatPopup(); });
  }
  // Split active staff into "matches this seat's designation" vs everyone else, already-crewed people excluded.
  // role === "" means the generic "add staff" button — no designation filter, everyone free counts as matched.
  function staffForSeat(t, role) {
    var onTrip = {}; if (t.raw && t.raw.captain_id) onTrip[t.raw.captain_id] = true;
    (detail.crew || []).forEach(function (c) { onTrip[c.user_id] = true; });
    var free = (staff || []).filter(function (p) { return !onTrip[p.id]; });
    if (role === "") return { matched: free, others: [] };
    var matched = free.filter(function (p) { return staffMatchesRole(p, role); });
    var others = free.filter(function (p) { return matched.indexOf(p) < 0; });
    return { matched: matched, others: others };
  }
  function seatPickItem(t, role, p, defs) {
    var assignRole = role === "" ? (p.jobTitle || "Crew") : role;
    var rcls = slug(p.crewGroup || p.jobTitle || "crew");
    var search = (p.name + " " + (p.jobTitle || "")).toLowerCase();
    var designation = p.jobTitle || "No designation";
    var now = workingNowFlag(p.id, t.day, defs);
    var warn = crewAvailNote(p.id, t);
    return '<button type="button" class="ops-seat-pick' + (now ? " is-now" : "") + (warn ? " is-warn" : "") + '" data-seat-pick="' + esc(t.id) + '" data-uid="' + esc(p.id) + '" data-role="' + esc(assignRole) + '" data-search="' + esc(search) + '" data-designation="' + esc(designation) + '">' +
      '<span class="av r-' + rcls + '">' + esc(initials(p.name)) + (now ? '<i class="ops-seat-pick-dot" title="Working now"></i>' : "") + '</span>' +
      '<span class="grow"><strong>' + esc(p.name) + '</strong><small>' + esc(p.jobTitle || "No designation set") + '</small>' +
        (warn ? '<em class="av-warn">' + esc(warn) + '</em>' : "") +
      '</span>' +
      shiftChip(p.id, t.day, defs) +
    '</button>';
  }
  // Quick-filter pills for the designations actually present in the list shown right now.
  function designationPills(list) {
    if (list.length < 2) return "";
    var counts = {}, order = [];
    list.forEach(function (p) {
      var d = p.jobTitle || "No designation";
      if (!counts[d]) { counts[d] = 0; order.push(d); }
      counts[d]++;
    });
    if (order.length < 2) return "";
    order.sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    return '<div class="ops-seat-pills" data-seat-pills>' +
      '<button type="button" class="on" data-seat-pill="">All<b>' + list.length + '</b></button>' +
      order.map(function (d) { return '<button type="button" data-seat-pill="' + esc(d) + '">' + esc(d) + '<b>' + counts[d] + '</b></button>'; }).join("") +
    '</div>';
  }
  // Rendered as a popup (fixed, centered, over a scrim) so the staff list never pushes the trip layout around.
  // role === "": one flat list of everyone free. Otherwise a Suggested/Everyone toggle plus designation pills and a live search filter.
  function seatPickerPanel(t, role) {
    var s = staffForSeat(t, role), showAll = !!(detail.seatPicker && detail.seatPicker.showAll);
    var err = detail.seatPicker && detail.seatPicker.error;
    var defs = shiftDefsByCode();
    var byNowThenName = function (a, b) {
      var an = workingNowFlag(a.id, t.day, defs) ? 0 : 1, bn = workingNowFlag(b.id, t.day, defs) ? 0 : 1;
      return an - bn || a.name.localeCompare(b.name);
    };
    var list = role === "" ? s.matched.slice().sort(byNowThenName)
      : (showAll ? s.matched.concat(s.others).sort(byNowThenName) : s.matched.slice().sort(byNowThenName));
    var title = role === "" ? "Add staff to this trip" : "Assign " + role;
    var emptyNote = role === "" ? "No one else is free to add."
      : (showAll ? "No one else is free to add." : "No one on staff is designated " + esc(role) + ".");
    return '<div class="ops-seat-scrim" data-seat-close></div>' +
      '<div class="ops-seat-picker" role="dialog" aria-modal="true">' +
        '<div class="ops-seat-picker-head">' +
          '<div><strong>' + esc(title) + '</strong><small>' + esc((t.vesselCode || t.vessel || "") + " · " + (t.time || "") + " · " + (t.origin || "") + " → " + (t.destination || "")) + '</small></div>' +
          '<button type="button" class="ghost" data-seat-close aria-label="Close">×</button>' +
        '</div>' +
        (err ? '<p class="msg err">' + esc(err) + '</p>' : "") +
        '<label class="ops-seat-search"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
          '<input type="text" placeholder="Search staff…" data-seat-search autocomplete="off"></label>' +
        (role !== "" && s.others.length
          ? '<div class="ops-seat-scope" role="tablist">' +
              '<button type="button" class="' + (showAll ? "" : "on") + '" data-seat-scope="suggested" role="tab" aria-selected="' + (!showAll) + '">Suggested<b>' + s.matched.length + '</b></button>' +
              '<button type="button" class="' + (showAll ? "on" : "") + '" data-seat-scope="all" role="tab" aria-selected="' + showAll + '">Everyone<b>' + (s.matched.length + s.others.length) + '</b></button>' +
            '</div>'
          : "") +
        designationPills(list) +
        (list.length
          ? '<div class="ops-seat-pick-list" data-seat-list>' + list.map(function (p) { return seatPickItem(t, role, p, defs); }).join("") + '</div>' +
            '<p class="ops-seat-pick-empty" data-seat-no-match hidden>No staff match your filters.</p>'
          : '<p class="note">' + emptyNote + '</p>') +
      '</div>';
  }
  // Keeps the seat-picker popup as a direct child of <body> (a true portal), not of the trip modal —
  // the modal card and its sections animate with `transform`, which makes a position:fixed popup inside
  // them get trapped to that card's box instead of covering the viewport.
  function closeSeatPopup() {
    var el = document.getElementById("opsSeatPopup");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function syncSeatPopup() {
    closeSeatPopup();
    var picker = detail.seatPicker;
    if (!canOps || !picker) return;
    var t = trips.filter(function (x) { return x.id === detail.id; })[0];
    if (!t) return;
    ensureRosterDay(t.day);
    var host = document.createElement("div");
    host.id = "opsSeatPopup";
    host.innerHTML = seatPickerPanel(t, picker.role);
    document.body.appendChild(host);
    [].forEach.call(host.querySelectorAll("[data-seat-close]"), function (btn) {
      btn.addEventListener("click", function () { detail.seatPicker = null; renderTrip(); });
    });
    [].forEach.call(host.querySelectorAll("[data-seat-scope]"), function (btn) {
      btn.addEventListener("click", function () { detail.seatPicker.showAll = btn.dataset.seatScope === "all"; syncSeatPopup(); });
    });
    var search = host.querySelector("[data-seat-search]");
    function applyFilters() {
      var q = (search && search.value || "").trim().toLowerCase();
      var pillBtn = host.querySelector("[data-seat-pill].on");
      var pill = pillBtn ? pillBtn.dataset.seatPill : "";
      var any = false;
      [].forEach.call(host.querySelectorAll("[data-seat-pick]"), function (btn) {
        var hit = (!q || btn.dataset.search.indexOf(q) >= 0) && (!pill || btn.dataset.designation === pill);
        btn.hidden = !hit; if (hit) any = true;
      });
      var none = host.querySelector("[data-seat-no-match]");
      if (none) none.hidden = any || (!q && !pill);
    }
    if (search) search.addEventListener("input", applyFilters);
    [].forEach.call(host.querySelectorAll("[data-seat-pill]"), function (btn) {
      btn.addEventListener("click", function () {
        [].forEach.call(host.querySelectorAll("[data-seat-pill]"), function (b) { b.classList.remove("on"); });
        btn.classList.add("on");
        applyFilters();
      });
    });
    [].forEach.call(host.querySelectorAll("[data-seat-pick]"), function (btn) {
      btn.addEventListener("click", function () {
        var uid = btn.dataset.uid, role = btn.dataset.role;
        var tt = trips.filter(function (x) { return x.id === t.id; })[0];
        var note = crewAvailNote(uid, tt || t);
        if (detail.seatPicker) detail.seatPicker.error = null;
        if (note && !window.confirm(note + " Assign anyway?")) return;
        var write = (isCaptainRole(role) && !(tt && tt.raw && tt.raw.captain_id))
          ? db.from("trips").update({ captain_id: uid }).eq("id", t.id)
          : db.from("trip_crew").insert({ trip_id: t.id, company_id: company.id, user_id: uid, role: role });
        write.then(function (res) {
          if (res.error) { if (detail.seatPicker) detail.seatPicker.error = res.error.message; syncSeatPopup(); return; }
          detail.seatPicker = null;
          return Promise.all([loadData(), loadDetail(t.id)]).then(function () { render(); renderTrip(); });
        }, function (e) {
          if (detail.seatPicker) detail.seatPicker.error = e.message;
          syncSeatPopup();
        });
      });
    });
  }
  // Seats by role from the vessel's crew needs, filled from the captain and trip_crew.
  function crewSeats(t) {
    var mix = mixOf(t); if (!mix.length) return "";
    var pool = (detail.crew || []).map(function (x) { return { name: staffName(x.user_id), role: x.role }; });
    var picker = detail.seatPicker;
    var html = '<div class="ops-seats tdx-seats">' + mix.map(function (m) {
      var role = String(m.role), n = Number(m.n) || 0, out = [], isCapt = isCaptainRole(role);
      for (var k = 0; k < n; k++) {
        var who = null;
        if (isCapt && k === 0 && t.captain) who = { name: t.captain };
        else { var ix = -1; pool.forEach(function (c, j) { if (ix < 0 && String(c.role || "").toLowerCase() === role.toLowerCase()) ix = j; }); if (ix > -1) who = pool.splice(ix, 1)[0]; }
        out.push(who ? '<span class="ops-seat on r-' + slug(role) + '" title="' + esc(who.name + " · " + role) + '"><b>' + esc(initials(who.name)) + '</b><small>' + esc(String(who.name).split(/\s+/)[0]) + '</small><em>' + esc(role) + '</em></span>'
          : (canOps
            ? '<button type="button" class="ops-seat open' + (picker && picker.role === role ? " active" : "") + '" data-seat-role="' + esc(role) + '" title="Needs a ' + esc(role) + ' — click to assign"><b>+</b><small>Open</small><em>' + esc(role) + '</em></button>'
            : '<span class="ops-seat open" title="Needs a ' + esc(role) + '"><b>+</b><small>Open</small><em>' + esc(role) + '</em></span>'));
      }
      return out.join("");
    }).join("") +
      (canOps
        ? '<button type="button" class="ops-seat add' + (picker && picker.role === "" ? " active" : "") + '" data-seat-role="" title="Add staff to this trip"><b>+</b><small>Add</small><em>Staff</em></button>'
        : "") +
    '</div>';
    // The picker itself renders as a page-level popup (see syncSeatPopup) — a position:fixed overlay
    // embedded here would get trapped inside this card's entrance animation (transform: containing block).
    return html;
  }

  function crewCards(t, closed) {
    var rows = [];
    if (t.captain) rows.push({ name: t.captain, role: "Captain", uid: null, isCapt: true });
    (detail.crew || []).forEach(function (x) { rows.push({ name: staffName(x.user_id), role: x.role, uid: x.user_id, auto: x.meta && x.meta.auto }); });
    if (!rows.length) return '<p class="note">No crew assigned yet.</p>';
    var roles = ["Crew", "Cashier", "Deck", "Engineering", "Cabin"];
    return '<ul class="td-people">' + rows.map(function (x) {
      return '<li>' +
        '<span class="av r-' + slug(x.role) + '">' + esc(initials(x.name)) + '</span>' +
        '<div class="grow"><strong>' + esc(x.name) + '</strong>' +
          (canOps && !closed && x.uid
            ? '<select class="td-role-sel" data-role-user="' + esc(x.uid) + '" aria-label="Role">' +
                roles.map(function (role) { return '<option' + (x.role === role ? " selected" : "") + '>' + role + '</option>'; }).join("") +
                (roles.indexOf(x.role) < 0 ? '<option selected>' + esc(x.role) + '</option>' : "") +
              '</select>'
            : '<small>' + esc(x.role + (x.auto ? " · roster" : "")) + '</small>') +
        '</div>' +
        (x.isCapt ? '<span class="chip st-on-time">Captain</span>' : "") +
        (canOps && !closed && x.uid ? '<button type="button" class="ghost" data-uncrew="' + esc(x.uid) + '">Remove</button>' : "") +
      '</li>';
    }).join("") + '</ul>';
  }

  function payChip(status) {
    var s = status || "Unpaid";
    var cls = s === "Paid" || s === "Confirmed" ? "st-on-time"
      : s === "Partly paid" || s === "Refund due" ? "st-delayed"
      : s === "Refunded" || s === "Cancelled" ? "st-cancelled"
      : "st-scheduled";
    return chip(s, cls);
  }
  function paxTable(pax, closed) {
    if (!pax.length) return '<p class="note">No passengers booked yet. Use <strong>Add new passenger</strong> to book someone.</p>';
    return '<div class="td-table-wrap"><table class="td-table"><thead><tr>' +
      '<th>Passenger</th><th>Ticket</th><th>Payment</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + pax.map(function (p) {
        var gone = p.status === "Cancelled" || p.booking_status === "Cancelled" || p.booking_status === "Refunded";
        var phone = p.phone || p.contact_phone || "";
        var pay = gone ? (p.booking_status === "Refunded" ? "Refunded" : "Cancelled") : (p.payment_status || "Unpaid");
        return '<tr class="' + (gone ? "gone" : "") + '">' +
          '<td><strong>' + esc(p.full_name) + '</strong>' +
            '<small class="td-subline">' + esc([p.category || "Adult", phone].filter(Boolean).join(" · ")) + '</small></td>' +
          '<td>' + esc(p.reference || "—") + '</td>' +
          '<td>' + payChip(pay) + '</td>' +
          '<td>' + chip(gone ? "Cancelled" : p.status) + '</td>' +
          '<td class="td-row-acts">' + (gone || closed ? "" :
            (p.status === "Booked" ? '<button type="button" class="btn-soft" data-pax="' + esc(p.id) + '" data-st="Checked in">Check in</button>' : "") +
            (p.status !== "Boarded" && p.status !== "Cancelled" ? '<button type="button" class="btn-soft" data-pax="' + esc(p.id) + '" data-st="Boarded">Board</button>' : "") +
            '<button type="button" class="ghost" data-cancelbk="' + esc(p.booking_id) + '">Cancel</button>') +
          '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  /* ---------- trip window tab helpers (modern layout) ---------- */
  // Cursor 2026-10-23: live boarding board — hero KPIs, sort/density, stepper cards.
  var PAX_FILTERS = [["all", "All"], ["Booked", "Booked"], ["Checked in", "Checked in"], ["Boarded", "Boarded"], ["No-show", "No-show"], ["Cancelled", "Cancelled"]];
  var PAX_FLOW = { Booked: 0, "Checked in": 1, Boarded: 2, "No-show": 3, Cancelled: 4 };
  function paxGone(p) { return p.status === "Cancelled" || p.booking_status === "Cancelled" || p.booking_status === "Refunded"; }
  function paxState(p) { return paxGone(p) ? "Cancelled" : (p.status || "Booked"); }
  function paxStepIdx(st) {
    if (st === "Boarded") return 2;
    if (st === "Checked in") return 1;
    if (st === "Booked") return 0;
    return -1;
  }
  function paxStepper(st, compact) {
    if (st === "Cancelled" || st === "No-show") {
      return '<div class="plx-step bad' + (compact ? " sm" : "") + '"><span class="plx-step-dot">' + icon(I.close) + '</span><span>' + esc(st) + '</span></div>';
    }
    var cur = paxStepIdx(st), labels = ["Booked", "Checked in", "Boarded"];
    return '<ol class="plx-stepper' + (compact ? " sm" : "") + '" aria-label="Boarding progress">' + labels.map(function (lab, i) {
      var cls = i < cur ? "done" : i === cur ? "now" : "";
      return '<li class="' + cls + '"><i></i>' + (compact ? "" : '<span>' + lab + '</span>') + '</li>';
    }).join("") + '</ol>';
  }
  function paxCounts(list) {
    var cnt = { all: list.length, Booked: 0, "Checked in": 0, Boarded: 0, "No-show": 0, Cancelled: 0 };
    list.forEach(function (p) { var k = paxState(p); cnt[k] = (cnt[k] || 0) + 1; });
    return cnt;
  }
  function paxRing(boarded, total) {
    var t = Math.max(0, Number(total) || 0), b = Math.max(0, Number(boarded) || 0);
    var pct = t ? Math.min(100, Math.round(b * 100 / t)) : 0;
    var r = 42, circ = 2 * Math.PI * r, dash = (pct / 100) * circ;
    return '<div class="plx-ring" style="--pct:' + pct + '" aria-hidden="true">' +
      '<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="' + r + '"/><circle class="val" cx="50" cy="50" r="' + r + '" stroke-dasharray="' + dash.toFixed(1) + ' ' + circ.toFixed(1) + '"/></svg>' +
      '<div class="plx-ring-txt"><strong>' + pct + '%</strong><small>boarded</small></div></div>';
  }
  function paxBoardHero(list, c, trip) {
    var cnt = paxCounts(list), f = detail.paxF || "all";
    var booked = c.booked != null ? c.booked : cnt.all;
    var boarded = c.boarded != null ? c.boarded : (cnt.Boarded || 0);
    var chk = c.checked_in != null ? c.checked_in : (cnt["Checked in"] || 0);
    var cap = trip && trip.capacity != null ? Number(trip.capacity) : null;
    var fillPct = cap && cap > 0 ? Math.min(100, Math.round((booked || 0) * 100 / cap)) : null;
    var primary = [["all", "All", cnt.all, "all"], ["Booked", "Booked", cnt.Booked || 0, "booked"], ["Checked in", "Checked in", cnt["Checked in"] || 0, "chk"], ["Boarded", "Boarded", cnt.Boarded || 0, "brd"]];
    var secondary = [["No-show", "No-show", cnt["No-show"] || 0], ["Cancelled", "Cancelled", cnt.Cancelled || 0]].filter(function (x) { return x[2] > 0; });
    return '<section class="plx-hero">' +
      '<div class="plx-hero-ring">' + paxRing(boarded, booked || 1) +
        '<div class="plx-hero-meta"><strong>' + boarded + ' <span>of</span> ' + (booked || 0) + '</strong><small>Passengers boarded</small>' +
          (fillPct != null ? '<div class="plx-seatfill" title="Seat fill"><span style="width:' + fillPct + '%"></span></div><em>' + (booked || 0) + ' / ' + cap + ' seats filled · ' + fillPct + '%</em>' : "") +
        '</div></div>' +
      '<div class="plx-kpis">' + primary.map(function (x) {
        return '<button type="button" class="plx-kpi k-' + x[3] + ((f === x[0]) ? " on" : "") + '" data-pxf="' + esc(x[0]) + '"><small>' + esc(x[1]) + '</small><strong>' + x[2] + '</strong></button>';
      }).join("") + '</div>' +
      (secondary.length ? '<div class="plx-sec">' + secondary.map(function (x) {
        return '<button type="button" class="tdx-chip' + (f === x[0] ? " on" : "") + '" data-pxf="' + esc(x[0]) + '">' + esc(x[1]) + '<b>' + x[2] + '</b></button>';
      }).join("") + '</div>' : "") +
    '</section>';
  }
  function paxCommandBar(canAdd, closed, waiting) {
    var sort = detail.paxSort || "name", view = detail.paxView || "cards";
    return '<div class="plx-bar">' +
      '<label class="tdx-search plx-search">' + icon(I.search) + '<input id="pxQ" type="search" placeholder="Search name, booking, ID or phone" value="' + esc(detail.paxQ || "") + '" autocomplete="off"></label>' +
      '<div class="plx-bar-right">' +
        '<label class="plx-sort"><span>Sort</span><select id="pxSort">' +
          [['name', 'Name'], ['status', 'Status flow'], ['ref', 'Booking ref']].map(function (o) {
            return '<option value="' + o[0] + '"' + (sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join("") +
        '</select></label>' +
        '<div class="plx-density" role="group" aria-label="List density">' +
          '<button type="button" class="plx-den' + (view === "cards" ? " on" : "") + '" data-pxview="cards" title="Comfortable">' + icon(I.people) + '</button>' +
          '<button type="button" class="plx-den' + (view === "compact" ? " on" : "") + '" data-pxview="compact" title="Compact">' + icon('<path d="M4 7h16M4 12h16M4 17h16"/>') + '</button>' +
        '</div>' +
        (canOps && !closed && waiting ? '<button type="button" class="btn-soft tdx-bulk" id="pxCheckAll">' + icon(I.ok) + ' Check in all ' + waiting + '</button>' : "") +
        (canAdd
          ? (detail.addPax
            ? '<button type="button" class="ghost" id="bAddCancel">Cancel</button>'
            : '<button type="button" class="primary-btn" id="bAddOpen">' + icon(I.plus) + ' Add passenger</button>')
          : "") +
      '</div></div>';
  }
  function paxSkeleton() {
    return '<div class="plx-list skel" aria-busy="true">' +
      [0, 1, 2, 3, 4].map(function (i) {
        return '<div class="plx-skel" style="--i:' + i + '"><span class="av"></span><span class="ln w60"></span><span class="ln w40"></span><span class="pill"></span></div>';
      }).join("") +
    '</div>';
  }
  // Seat map: one dot per seat — boarded, checked in, booked, free.
  function seatMap(t, c) {
    var cap = Number(t.capacity) || 0, boarded = c.boarded || 0, chk = c.checked_in || 0, booked = Math.max(0, (c.booked || 0) - boarded - chk);
    if (!cap) return '<p class="note">Assign a vessel to see its seats.</p>';
    var out = [];
    for (var i = 0; i < cap; i++) out.push('<i class="tdx-dot ' + (i < boarded ? "b" : i < boarded + chk ? "c" : i < boarded + chk + booked ? "k" : "f") + '" style="animation-delay:' + Math.min(i * 8, 400) + 'ms"></i>');
    return '<div class="tdx-seatmap" style="--cols:' + (cap > 40 ? 12 : cap > 20 ? 10 : 8) + '">' + out.join("") + '</div>' +
      '<div class="tdx-legend"><span><i class="tdx-dot b"></i>Boarded ' + boarded + '</span><span><i class="tdx-dot c"></i>Checked in ' + chk + '</span><span><i class="tdx-dot k"></i>Booked ' + booked + '</span><span><i class="tdx-dot f"></i>Free ' + Math.max(0, cap - (c.booked || 0)) + '</span></div>';
  }
  function boardingFunnel(c) {
    var total = Math.max(1, c.booked || 0), steps = [["Booked", c.booked || 0, "k"], ["Checked in", (c.checked_in || 0) + (c.boarded || 0), "c"], ["Boarded", c.boarded || 0, "b"]];
    return '<div class="tdx-funnel">' + steps.map(function (s) {
      var pct = Math.round(s[1] * 100 / total);
      return '<div class="tdx-funnel-row"><span class="lbl">' + s[0] + '</span><span class="tdx-funnel-bar"><span class="' + s[2] + '" style="width:' + (c.booked ? pct : 0) + '%"></span></span><strong>' + s[1] + '</strong></div>';
    }).join("") + '</div>';
  }
  function eventKind(e) {
    var d = String(e.detail || "").toLowerCase();
    if (e.kind === "status" || /→|departed|arrived|boarding|delay|cancel/.test(d)) return "status";
    if (/captain|crew|cashier|roster/.test(d)) return "crew";
    if (/booking|passenger|refund|seat/.test(d) || e.kind === "booking") return "booking";
    if (e.kind === "auto") return "auto";
    if (e.kind === "created") return "created";
    return "other";
  }
  var LOG_ICONS = { status: I.arrow, crew: I.people, booking: I.person, auto: I.clock, created: I.plus, other: I.clock };
  function logItem(e) {
    var k = eventKind(e), d = new Date(e.created_at);
    return '<li class="k-' + k + '"><span class="tdx-log-ic">' + icon(LOG_ICONS[k]) + '</span><div class="grow"><strong>' + esc(e.detail || e.kind) + '</strong>' +
      '<small>' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + (e.kind === "auto" ? ' · <em>automatic</em>' : '') + '</small></div></li>';
  }
  function paxNeedsPay(p, payOverride) {
    if (paxGone(p) || p.booking_status === "Refunded") return false;
    var pay = payOverride || p.payment_status || "Unpaid";
    return pay === "Unpaid" || pay === "Partly paid" || pay === "Refund due";
  }
  // Cursor 2026-10-23: mark booking paid via update_booking (paid_amount → fare_total).
  function markBookingPaid(bookingId, method) {
    return soft(db.from("bookings").select("fare_total, paid_amount, payment_status, payment_method").eq("id", bookingId).maybeSingle(), { data: null }, 6000)
      .then(function (res) {
        var b = res && res.data;
        if (!b) throw new Error("Booking not found.");
        if (b.payment_status === "Paid" || b.payment_status === "Refunded") throw new Error("This booking is already " + String(b.payment_status).toLowerCase() + ".");
        var due = Number(b.fare_total) || 0;
        var patch = { paid_amount: due };
        var allowed = payMethods();
        var meth = method || b.payment_method || allowed[0] || "Cash";
        if (allowed.length && allowed.indexOf(meth) < 0) meth = allowed[0];
        if (meth) patch.payment_method = meth;
        return rpc("update_booking", { p_id: bookingId, p_patch: patch });
      });
  }
  // Cursor 2026-10-23: passenger card — identity / progress / pay+board footer (no detail needed for pay).
  function paxPayBlock(p, pay) {
    if (!canOps || !paxNeedsPay(p, pay)) {
      return '<div class="plx-c-paystat">' + payChip(pay) + '</div>';
    }
    return '<div class="plx-c-pay" data-stop-open>' +
      '<span class="plx-c-pay-lab">Payment</span>' +
      payCurrencyNote() +
      '<div class="plx-c-pay-row">' +
        '<select class="plx-list-meth" aria-label="Payment method">' + payMethodsHtml() + '</select>' +
        '<button type="button" class="plx-mark-paid" data-markpaid="' + esc(p.booking_id) + '">' +
          icon('<path d="M4 7h16v12H4zM4 11h16M8 15h3"/>') + '<span>Mark paid</span></button>' +
      '</div></div>';
  }
  function paxBoardBlock(p, closed) {
    var st = paxState(p), gone = st === "Cancelled" || st === "No-show";
    if (gone || closed || !canOps) return "";
    var primary = "";
    if (p.status === "Booked") {
      primary = '<button type="button" class="plx-c-btn chk" data-pax="' + esc(p.id) + '" data-st="Checked in">' + icon(I.ok) + '<span>Check in</span></button>';
    } else if (p.status !== "Boarded" && p.status !== "Cancelled") {
      primary = '<button type="button" class="plx-c-btn brd" data-pax="' + esc(p.id) + '" data-st="Boarded">' + icon(I.boat) + '<span>Board</span></button>';
    } else if (st === "Boarded") {
      primary = '<span class="plx-c-done">' + icon(I.ok) + ' On board</span>';
    }
    return '<div class="plx-c-board" data-stop-open>' +
      primary +
      '<button type="button" class="plx-c-btn ghost del" data-cancelbk="' + esc(p.booking_id) + '" title="Cancel booking">' + icon(I.close) + '<span>Cancel</span></button>' +
    '</div>';
  }
  function paxCard(p, closed, idx) {
    var st = paxState(p), gone = st === "Cancelled";
    var pay = gone ? (p.booking_status === "Refunded" ? "Refunded" : "Cancelled") : (p.payment_status || "Unpaid");
    var phone = p.phone || p.contact_phone || "";
    var compact = (detail.paxView || "cards") === "compact";
    var needPay = canOps && paxNeedsPay(p, pay);
    var boardHtml = paxBoardBlock(p, closed);
    var payHtml = paxPayBlock(p, pay);
    var hasFoot = !!(boardHtml || needPay || (canOps && !paxNeedsPay(p, pay)));
    return '<article class="plx-card s-' + slug(st) + (compact ? " compact" : "") + (needPay ? " needs-pay" : "") + (gone ? " is-gone" : "") + '" style="--i:' + (idx || 0) + '" data-pax-open="' + esc(p.id) + '" role="button" tabindex="0" title="View passenger details">' +
      '<div class="plx-c-top">' +
        '<span class="plx-av" aria-hidden="true">' + esc(initials(p.full_name)) + '</span>' +
        '<div class="plx-c-id">' +
          '<div class="plx-name"><strong>' + esc(p.full_name || "Passenger") + '</strong><span class="plx-cat">' + esc(p.category || "Adult") + '</span></div>' +
          '<div class="plx-c-meta">' +
            (phone ? '<span class="plx-meta-i">' + esc(phone) + '</span>' : "") +
            (p.id_number ? '<span class="plx-meta-i">ID ' + esc(p.id_number) + '</span>' : "") +
            (!phone && !p.id_number ? '<span class="plx-meta-i muted">Tap for full details</span>' : "") +
          '</div>' +
        '</div>' +
        '<div class="plx-c-tags">' +
          '<span class="tdx-pill s-' + slug(st) + '">' + esc(st) + '</span>' +
          (!needPay ? payChip(pay) : '<span class="chip st-delayed">' + esc(pay) + '</span>') +
        '</div>' +
      '</div>' +
      '<div class="plx-c-mid">' +
        '<div class="plx-c-chips">' +
          '<span class="plx-chip ref" title="Booking reference">' + esc(p.reference || "—") + '</span>' +
          (p.seat_no ? '<span class="plx-chip seat">Seat ' + esc(p.seat_no) + '</span>' : '<span class="plx-chip muted">No seat</span>') +
          (p.source ? '<span class="plx-chip src">' + esc(p.source) + '</span>' : "") +
        '</div>' +
        (compact ? "" : '<div class="plx-c-progress">' + paxStepper(st, false) + '</div>') +
      '</div>' +
      (hasFoot
        ? '<div class="plx-c-foot" data-stop-open>' + payHtml + boardHtml + '</div>'
        : "") +
      '<span class="plx-c-open" aria-hidden="true">' + icon(I.chev) + '</span>' +
    '</article>';
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    } catch (e) { return String(iso); }
  }
  // Cursor 2026-10-23: detail fields/panels — high contrast so sections don’t blend.
  function paxField(label, value, empty) {
    var blank = value == null || value === "";
    var v = blank ? "—" : String(value);
    return '<div class="plx-field' + (blank || empty ? " is-empty" : "") + '"><span class="plx-field-lab">' + esc(label) + '</span><strong class="plx-field-val">' + esc(v) + '</strong></div>';
  }
  function paxPanel(title, ico, bodyHtml, tone) {
    return '<section class="plx-panel' + (tone ? " t-" + tone : "") + '">' +
      '<header class="plx-panel-h">' +
        '<span class="plx-panel-ic" aria-hidden="true">' + icon(ico) + '</span>' +
        '<h3>' + title + '</h3>' +
      '</header>' +
      '<div class="plx-panel-b">' + bodyHtml + '</div>' +
    '</section>';
  }
  function paxDetailTimeline(p, st) {
    var steps = [
      { lab: "Booked", done: true, when: null },
      { lab: "Checked in", done: st === "Checked in" || st === "Boarded", when: p.checked_in_at },
      { lab: "Boarded", done: st === "Boarded", when: p.boarded_at }
    ];
    if (st === "Cancelled" || st === "No-show") {
      return '<div class="plx-tl bad"><span class="plx-tl-dot">' + icon(I.close) + '</span><div><strong>' + esc(st) + '</strong><small>This passenger is not boarding.</small></div></div>';
    }
    var doneN = steps.filter(function (x) { return x.done; }).length;
    return '<ol class="plx-tl" style="--steps:3;--done:' + Math.max(0, doneN - 1) + '">' + steps.map(function (s, i) {
      var cls = s.done ? (i === doneN - 1 ? "now" : "done") : "todo";
      return '<li class="' + cls + '"><span class="plx-tl-node"><i></i></span><div><strong>' + s.lab + '</strong><small>' + (s.when ? esc(fmtWhen(s.when)) : (s.done ? "Done" : "Pending")) + '</small></div></li>';
    }).join("") + '</ol>';
  }
  function paxDetailView(p, closed, trip) {
    var ex = detail.paxExtra || {};
    var st = paxState(p), gone = st === "Cancelled";
    var pay = gone ? (p.booking_status === "Refunded" ? "Refunded" : "Cancelled") : (ex.payment_status || p.payment_status || "Unpaid");
    var mobile = p.phone || ex.phone_registry || "";
    var contactPhone = ex.contact_phone || p.contact_phone || "";
    var phone = mobile || contactPhone || "";
    var fare = p.fare != null ? fmtMoney(p.fare) : null;
    var paid = ex.paid_amount != null ? fmtMoney(ex.paid_amount) : null;
    var total = ex.fare_total != null ? fmtMoney(ex.fare_total) : null;
    var route = trip ? ((trip.origin || "") + (trip.destination ? " → " + trip.destination : "")) : "";
    var ref = p.reference || ex.reference || "—";
    var needPay = canOps && !gone && paxNeedsPay(p, pay);
    var methods = payMethods();
    var curMeth = ex.payment_method || methods[0] || "Cash";
    if (methods.indexOf(curMeth) < 0) curMeth = methods[0] || "Cash";
    var acts =
      (needPay ? '<button type="button" class="save plx-pay-btn" data-markpaid="' + esc(p.booking_id) + '">' + icon('<path d="M4 7h16v12H4zM4 11h16M8 15h3"/>') + ' Mark as paid' + (total ? ' · ' + esc(total) : "") + '</button>' : "") +
      (gone || closed ? "" :
        (p.status === "Booked" ? '<button type="button" class="btn-soft" data-pax="' + esc(p.id) + '" data-st="Checked in">' + icon(I.ok) + ' Check in</button>' : "") +
        (p.status !== "Boarded" && p.status !== "Cancelled" ? '<button type="button" class="btn-soft" data-pax="' + esc(p.id) + '" data-st="Boarded">' + icon(I.boat) + ' Board</button>' : "") +
        (opsOn("paxTransfer") ? '<button type="button" class="btn-soft" data-pax-move="' + esc(p.id) + '">' + icon(I.arrow) + ' Move to another trip</button>' : "") +
        '<button type="button" class="ghost td-danger" data-cancelbk="' + esc(p.booking_id) + '">Cancel booking</button>');
    return '<div class="plx-pd s-' + slug(st) + '">' +
      '<div class="plx-pd-bar">' +
        '<button type="button" class="plx-back" id="paxBack">' + icon(I.chev) + '<span>Back to list</span></button>' +
        '<div class="tdx-pd-acts plx-pd-acts">' + acts + '</div>' +
      '</div>' +
      (opsOn("paxTransfer") && detail.paxMove === p.id && trip
        ? '<div class="plx-move">' +
            '<label for="paxMoveTo">Move to another trip</label>' +
            '<select id="paxMoveTo">' +
              trips.filter(function (x) {
                return x.id !== trip.id && CLOSED.indexOf(x.raw.status) < 0 && x.raw.status !== "Cancelled" && x.raw.status !== "Departed" && x.raw.status !== "In transit";
              }).map(function (x) {
                var left = tripPaxLeft(x);
                return '<option value="' + esc(x.id) + '">' + esc(x.time + " · " + (x.origin || "") + " → " + (x.destination || "") + (left != null ? " · " + left + " seats" : "")) + "</option>";
              }).join("") +
            '</select>' +
            '<button type="button" class="save" id="paxMoveGo">Transfer</button>' +
            '<button type="button" class="ghost" id="paxMoveCancel">Cancel</button>' +
          '</div>'
        : "") +
      '<header class="plx-pd-hero s-' + slug(st) + '">' +
        '<div class="plx-pd-band" aria-hidden="true"></div>' +
        '<div class="plx-pd-hero-in">' +
          '<span class="tdx-pax-av lg plx-av">' + esc(initials(p.full_name)) + '</span>' +
          '<div class="grow">' +
            '<p class="plx-pd-kicker">' + esc(ref) + (p.seat_no ? ' · Seat ' + esc(p.seat_no) : "") + '</p>' +
            '<strong>' + esc(p.full_name || "Passenger") + '</strong>' +
            '<small>' + esc([p.category || "Adult", phone || "No phone"].filter(Boolean).join(" · ")) + '</small>' +
          '</div>' +
          '<div class="tdx-pd-badges plx-pd-badges">' +
            '<span class="tdx-pill s-' + slug(st) + '">' + esc(st) + '</span>' +
            payChip(pay) +
          '</div>' +
        '</div>' +
      '</header>' +
      paxPanel("Boarding timeline", I.boat, paxDetailTimeline(p, st), "timeline") +
      (ex._loading ? '<p class="note plx-pd-note">Loading booking details…</p>' : "") +
      (ex._err ? '<p class="note td-err plx-pd-note">Some booking fields could not load.</p>' : "") +
      '<div class="plx-pd-cols">' +
        paxPanel("Passenger", I.person,
          '<div class="plx-fields">' +
            paxField("Full name", p.full_name) +
            paxField("Mobile number", mobile || contactPhone || null) +
            (mobile && contactPhone && mobile !== contactPhone ? paxField("Booking contact phone", contactPhone) : "") +
            paxField("Category", p.category || "Adult") +
            paxField("ID / passport", p.id_number) +
            paxField("Nationality", p.nationality || ex.nationality) +
            paxField("Email", ex.email || ex.contact_email) +
            paxField("Date of birth", ex.dob ? fmtWhen(ex.dob).split(" ")[0] : null) +
            paxField("Emergency contact", ex.emergency_contact) +
            paxField("Seat", p.seat_no) +
            paxField("Fare", fare) +
            paxField("Passenger note", ex.pax_note || (p.meta && p.meta.note)) +
          '</div>') +
        paxPanel("Trip & boarding", I.clock,
          '<div class="plx-fields">' +
            paxField("Status", st) +
            paxField("Checked in", p.checked_in_at ? fmtWhen(p.checked_in_at) : (st === "Checked in" || st === "Boarded" ? "Yes" : "Not yet")) +
            paxField("Boarded", p.boarded_at ? fmtWhen(p.boarded_at) : (st === "Boarded" ? "Yes" : "Not yet")) +
            paxField("Trip", trip ? (trip.code || "Trip") : null) +
            paxField("Route", route || null) +
            paxField("Departure", trip && trip.departTs ? fmtTime(trip.departTs) : (trip && trip.time)) +
          '</div>', "board") +
      '</div>' +
      paxPanel("Booking & payment", '<path d="M4 7h16v12H4zM4 11h16M8 15h3"/>',
        (needPay
          ? '<div class="plx-paybox">' +
              '<div class="plx-paybox-copy"><strong>Collect payment</strong><small>Sets paid amount to the fare total (' + esc(total || fmtMoney(0)) + ') and marks the booking Paid. Methods come from Finance Settings.</small>' + payCurrencyNote() + '</div>' +
              '<label class="plx-pay-meth"><span>Method</span><select id="pxPayMethod">' + payMethodsHtml(curMeth) + '</select></label>' +
              '<button type="button" class="save" data-markpaid="' + esc(p.booking_id) + '">' + icon('<path d="M4 7h16v12H4zM4 11h16M8 15h3"/>') + ' Mark as paid</button>' +
            '</div>'
          : (pay === "Paid" ? '<div class="plx-paybox is-paid"><strong>Paid in full</strong><small>' + esc(ex.payment_method || "Payment recorded") + (paid ? " · " + esc(paid) : "") + '</small></div>' : "")) +
        '<div class="plx-fields cols-3">' +
          paxField("Booking reference", ref) +
          paxField("Booking status", p.booking_status || ex.status) +
          paxField("Source", p.source || ex.source) +
          paxField("Contact name", ex.contact_name) +
          paxField("Contact phone", contactPhone || phone) +
          paxField("Contact email", ex.contact_email) +
          paxField("Ticket type", ex.ticket_type) +
          paxField("Payment status", pay) +
          paxField("Payment method", ex.payment_method) +
          paxField("Fare total", total) +
          paxField("Paid amount", paid) +
          paxField("Refund", ex.refund_amount != null ? fmtMoney(ex.refund_amount) : null) +
          paxField("Booked at", ex.created_at ? fmtWhen(ex.created_at) : null) +
          paxField("Cancel reason", ex.cancel_reason) +
          paxField("Booking note", ex.note) +
        '</div>', "pay") +
    '</div>';
  }

  function openPaxDetail(paxId) {
    detail.paxId = paxId;
    detail.addPax = false;
    detail.paxExtra = { _loading: true };
    var list = (detail.man && detail.man.passengers) || [];
    var p = list.filter(function (x) { return x.id === paxId; })[0];
    renderTrip();
    if (!p || !p.booking_id) {
      detail.paxExtra = { _loading: false };
      renderTrip();
      return;
    }
    var jobs = [
      soft(db.from("bookings").select("reference, status, source, contact_name, contact_phone, contact_email, ticket_type, fare_total, paid_amount, payment_method, payment_status, refund_amount, cancel_reason, cancelled_at, note, created_at").eq("id", p.booking_id).maybeSingle(), { data: null }, 6000)
    ];
    if (p.passenger_id) {
      jobs.push(soft(db.from("passengers").select("email, phone, nationality, dob, emergency_contact, note").eq("id", p.passenger_id).maybeSingle(), { data: null }, 6000));
    }
    Promise.all(jobs).then(function (res) {
      if (detail.paxId !== paxId) return;
      var b = res[0] && res[0].data ? res[0].data : null;
      var reg = res[1] && res[1].data ? res[1].data : null;
      detail.paxExtra = Object.assign({}, b || {}, {
        email: (reg && reg.email) || (b && b.contact_email) || null,
        nationality: (reg && reg.nationality) || null,
        dob: reg && reg.dob,
        emergency_contact: reg && reg.emergency_contact,
        pax_note: reg && reg.note,
        phone_registry: reg && reg.phone,
        _loading: false,
        _err: !b
      });
      renderTrip();
    }, function () {
      if (detail.paxId !== paxId) return;
      detail.paxExtra = { _loading: false, _err: true };
      renderTrip();
    });
  }
  function paxList(pax, closed) {
    if (!pax.length) return '<div class="tdx-empty">' + icon(I.people) + '<strong>No passengers yet</strong><small>Use <b>Add passenger</b> to make the first booking.</small></div>';
    var f = detail.paxF || "all", q = (detail.paxQ || "").toLowerCase(), sort = detail.paxSort || "name";
    var shown = pax.filter(function (p) {
      return (f === "all" || paxState(p) === f) && (!q || (p.full_name + " " + (p.reference || "") + " " + (p.id_number || "") + " " + (p.phone || p.contact_phone || "")).toLowerCase().indexOf(q) > -1);
    }).slice();
    shown.sort(function (a, b) {
      if (sort === "status") {
        var da = PAX_FLOW[paxState(a)] != null ? PAX_FLOW[paxState(a)] : 9;
        var dbv = PAX_FLOW[paxState(b)] != null ? PAX_FLOW[paxState(b)] : 9;
        if (da !== dbv) return da - dbv;
      } else if (sort === "ref") {
        var ra = String(a.reference || ""), rb = String(b.reference || "");
        if (ra !== rb) return ra < rb ? -1 : 1;
      }
      return String(a.full_name || "").localeCompare(String(b.full_name || ""));
    });
    var view = detail.paxView || "cards";
    return shown.length
      ? '<div class="tdx-pax-list plx-list' + (view === "compact" ? " is-compact" : "") + '">' + shown.map(function (p, i) { return paxCard(p, closed, i); }).join("") + '</div>'
      : '<div class="tdx-empty">' + icon(I.search) + '<strong>No one matches</strong><small>Try another filter or search.</small></div>';
  }

  function vesselMetaOf(v) {
    return v && v.meta && typeof v.meta === "object" && !Array.isArray(v.meta) ? v.meta : {};
  }
  function followmeLinked(v) {
    var m = vesselMetaOf(v);
    return !!(m.followme_set || m.followme_url || m.followme);
  }
  function followmeHintOf(v) {
    var m = vesselMetaOf(v);
    return String(m.followme_hint || "").trim();
  }
  function numOrNull(x) {
    if (x == null || x === "") return null;
    var n = Number(x);
    return isFinite(n) ? n : null;
  }
  function pickLatLng(o) {
    if (!o || typeof o !== "object") return null;
    var lat = numOrNull(o.lat != null ? o.lat : (o.la != null ? o.la : (o.latitude != null ? o.latitude : (o.Latitude != null ? o.Latitude : o.LAT))));
    var lng = numOrNull(o.lng != null ? o.lng : (o.lon != null ? o.lon : (o.lo != null ? o.lo : (o.longitude != null ? o.longitude : (o.Longitude != null ? o.Longitude : o.LONG)))));
    if (lat == null || lng == null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return {
      lat: lat, lng: lng,
      name: o.name || o.Name || o.vessel || o.Vessel || "",
      speed: numOrNull(o.speed != null ? o.speed : (o.Speed != null ? o.Speed : (o["Speed(kn)"] != null ? o["Speed(kn)"] : o["speed_kn"]))),
      heading: numOrNull(o.heading != null ? o.heading : (o.course != null ? o.course : (o.Course != null ? o.Course : o.Heading))),
      port: o.port || o.Port || o.last_port || "",
      updated: o.updated || o.Updated || o.time || o.Time || o.date || o.Date || o.timestamp || ""
    };
  }
  function parseFollowmePayload(raw) {
    var text = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (typeof raw === "string" && /<!doctype\s+html|<html[\s>]/i.test(raw) && !/"lat"\s*:|"latitude"\s*:|"la"\s*:/i.test(raw)) {
      return { error: "This vessel’s FollowMe link is a share page (HTML), not the API — no coordinates to plot. Re-save the vessel with https://followme.mv/api/v5/public/<key>/ (Fleet / Maintenance → Edit)." };
    }
    var data = raw;
    if (typeof raw === "string") {
      try {
        var m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        data = JSON.parse(m ? m[0] : raw);
      } catch (e) { return { error: "FollowMe returned data that is not JSON." }; }
    }
    var items = [];
    if (Array.isArray(data)) items = data;
    else if (data && Array.isArray(data.data)) items = data.data;
    else if (data && data.data && typeof data.data === "object") {
      Object.keys(data.data).forEach(function (k) {
        var v = data.data[k];
        if (v && typeof v === "object") items.push(Object.assign({ id: k }, v));
      });
    } else if (data && typeof data === "object") {
      var one = pickLatLng(data);
      if (one) return { pos: one, count: 1 };
      Object.keys(data).forEach(function (k) {
        if (k === "data" || k === "status" || k === "message") return;
        var v = data[k];
        if (v && typeof v === "object") items.push(Object.assign({ id: k }, v));
      });
    }
    var found = null;
    items.forEach(function (it) { if (!found) found = pickLatLng(it); });
    if (found) return { pos: found, count: items.length };
    if (items.length) return { error: "FollowMe responded, but no latitude/longitude was found.", count: items.length, sample: items[0] };
    return { error: "No vessel position in the FollowMe response." };
  }
  function destroyTrackMap() {
    if (trackTimer) { clearInterval(trackTimer); trackTimer = null; }
    if (trackMap) { try { trackMap.remove(); } catch (e) {} trackMap = null; }
  }
  function clearTrackMapOnly() {
    if (trackMap) { try { trackMap.remove(); } catch (e) {} trackMap = null; }
  }
  function trackingView(t) {
    var v = vesselOf(t), linked = followmeLinked(v), hint = followmeHintOf(v) || (detail.track && detail.track.hint) || "";
    var tr = detail.track || { sub: "map" };
    var sub = tr.sub === "info" ? "info" : "map";
    if (!t.vessel_id) {
      return '<section class="td-block tdx-track"><div class="tdx-empty">' + icon(I.vessel) + '<strong>No vessel assigned</strong><small>Assign a vessel on Overview or Crew, then open Tracking again.</small></div></section>';
    }
    if (!linked) {
      return '<section class="td-block tdx-track"><div class="tdx-empty">' + icon(I.pin) + '<strong>No FollowMe link yet</strong><small>Add a followme.mv <em>API</em> URL on <a href="maintenance.html#vessel/' + esc(t.vessel_id) + '">this vessel</a> (e.g. https://followme.mv/api/v5/public/…/).</small></div></section>';
    }
    var pos = tr.pos, err = tr.err, loading = tr.loading, warn = tr.warning, nextIn = tr.next_in;
    var attr = tr.attribution || "FollowMe Tracking Service";
    var mini = '<div class="tdx-track-tabs" role="tablist">' +
      '<button type="button" class="' + (sub === "map" ? "on" : "") + '" data-track-sub="map">Map</button>' +
      '<button type="button" class="' + (sub === "info" ? "on" : "") + '" data-track-sub="info">Details</button>' +
    '</div>';
    var head = '<div class="tdx-track-head"><div><h3>Live tracking</h3><p class="note">' + esc(v ? (v.code || v.name) : "Vessel") +
      (pos && pos.name ? " · " + esc(pos.name) : "") +
      (hint ? " · " + esc(hint) : "") + '</p></div>' +
      '<div class="tdx-track-acts">' +
        '<button type="button" class="btn-soft" id="trRefresh"' + (loading ? " disabled" : "") + '>' + (loading ? "Refreshing…" : "Refresh") + '</button>' +
        '<a class="btn-soft" href="maintenance.html#vessel/' + esc(t.vessel_id) + '">Edit link</a>' +
      '</div></div>';
    var lastGps = "";
    if (opsOn("trackFresh")) {
      if (pos && pos.updated) lastGps = String(pos.updated);
      else if (tr.at) lastGps = new Date(tr.at).toLocaleString();
    }
    var notes = (opsOn("trackFresh") && lastGps ? '<p class="note tdx-track-fresh' + (tr.stale ? " stale" : "") + '">' + (tr.stale ? "Stale GPS · last fix " : "Last GPS ") + esc(lastGps) + (nextIn ? " · next in " + nextIn + "s" : "") + '</p>' : "") +
      (warn ? '<p class="note tdx-track-warn">' + esc(warn) + (nextIn && !opsOn("trackFresh") ? " Next update in " + nextIn + "s." : "") + '</p>' : "") +
      (err ? '<p class="note td-err">' + esc(err) + '</p>' : "") +
      (nextIn && !warn && !opsOn("trackFresh") ? '<p class="note">Next FollowMe update in ' + nextIn + "s.</p>" : "");
    var attrHtml = '<p class="tdx-track-attr"><img src="https://followme.mv/api/images/icon_50.png" alt=""> ' + esc(attr) + '</p>';
    if (sub === "info") {
      return '<section class="td-block tdx-track">' + head + mini + notes +
        '<div class="tdx-pd-grid">' +
          paxField("Vessel", v ? ((v.code ? v.code + " · " : "") + (v.name || "")) : "—") +
          paxField("FollowMe", hint || "Linked") +
          paxField("Latitude", pos ? pos.lat.toFixed(5) : null) +
          paxField("Longitude", pos ? pos.lng.toFixed(5) : null) +
          paxField("Speed", pos && pos.speed != null ? pos.speed + " kn" : null) +
          paxField("Heading", pos && pos.heading != null ? Math.round(pos.heading) + "°" : null) +
          paxField("Port / area", pos && pos.port ? pos.port : null) +
          paxField("Last update", pos && pos.updated ? String(pos.updated) : (tr.at ? new Date(tr.at).toLocaleString() : null)) +
        '</div>' + attrHtml +
      '</section>';
    }
    var waiting = loading || (!pos && !err && !tr.at);
    return '<section class="td-block tdx-track">' + head + mini + notes +
      (waiting && !pos ? '<p class="note">Fetching position from FollowMe…</p>' : "") +
      '<div class="tdx-track-map-wrap"><div id="tripTrackMap" class="tdx-track-map" aria-label="Vessel map"></div>' +
        (!pos && !waiting ? '<div class="tdx-track-overlay"><span><strong>Position unavailable</strong>' +
          esc(err || "Tap Refresh, or re-save this vessel with a FollowMe API URL (not the public share page).") +
          '</span></div>' : "") +
      '</div>' + attrHtml +
    '</section>';
  }
  function paintTrackMap() {
    clearTrackMapOnly();
    if (detail.tab !== "tracking" || (detail.track && detail.track.sub === "info")) return;
    var el = $("tripTrackMap");
    if (!el || !window.L) return;
    var pos = detail.track && detail.track.pos;
    var center = pos ? [pos.lat, pos.lng] : [4.25, 73.55];
    var zoom = pos ? 11 : 8;
    trackMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView(center, zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(trackMap);
    if (pos && window.VeyoraVesselMarkers) {
      // Same boat marker as the Live Vessel Map; stale or missing signal shows as offline.
      var speed = pos.speed != null ? Number(pos.speed) : null, stale = !!(detail.track && detail.track.stale);
      var boats = window.VeyoraVesselMarkers.create(trackMap, { popupHtml: function (d) {
        return '<strong>' + esc(pos.name || "Vessel") + '</strong><br>' + pos.lat.toFixed(5) + ", " + pos.lng.toFixed(5) +
          (speed != null ? "<br>" + speed.toFixed(1) + " kn" : "") + (pos.port ? "<br>" + esc(pos.port) : ""); } });
      boats.update([{ id: "trip", lat: Number(pos.lat), lng: Number(pos.lng), heading: pos.heading == null ? NaN : Number(pos.heading),
        status: stale ? "offline" : (speed != null && speed >= 1 ? "moving" : "stopped"), name: pos.name || "Vessel", stale: stale }]);
    }
    setTimeout(function () { if (trackMap) trackMap.invalidateSize(); }, 80);
  }
  function applyTrackResult(t, keepSub, prevPos, meta, parsed) {
    if (detail.id !== t.id) return;
    var base = {
      sub: keepSub, loading: false, pos: (parsed && parsed.pos) || prevPos,
      err: (parsed && parsed.error && !(parsed && parsed.pos)) ? parsed.error : ((parsed && parsed.error) || null),
      at: meta.at ? new Date(meta.at).getTime() : Date.now(),
      hint: meta.hint || null, attribution: meta.attribution || null,
      warning: meta.warning || null, next_in: meta.next_in != null ? meta.next_in : null,
      stale: !!meta.stale, cached: !!meta.cached
    };
    detail.track = base;
    if (detail.tab === "tracking") renderTrip();
  }
  function loadTripTracking(force) {
    var t = trips.filter(function (x) { return x.id === detail.id; })[0];
    if (!t) return;
    var v = vesselOf(t);
    if (!followmeLinked(v)) { detail.track = { sub: (detail.track && detail.track.sub) || "map", err: null, loading: false }; return; }
    if (detail.track && detail.track.loading && !force) return;
    var now = Date.now();
    if (!force && detail.track && detail.track.at && (now - detail.track.at) < 55000 && (detail.track.pos || detail.track.err) && !detail.track.stale) return;
    var keepSub = (detail.track && detail.track.sub) || "map";
    var prevPos = detail.track && detail.track.pos;
    detail.track = Object.assign({}, detail.track || {}, { sub: keepSub, loading: true, pos: prevPos, err: null });
    var btn = $("trRefresh"); if (btn) { btn.disabled = true; btn.textContent = "Refreshing…"; }
    rpc("followme_fetch", { p_vessel: t.vessel_id }).then(function (data) {
      if (detail.id !== t.id) return;
      data = data || {};
      var meta = {
        at: data.at, hint: data.hint, attribution: data.attribution,
        warning: data.warning, next_in: data.next_in, stale: data.stale, cached: data.cached
      };
      if (data.error && data.body == null) {
        applyTrackResult(t, keepSub, prevPos, meta, { error: data.error });
        return;
      }
      var text = String(data.body == null ? "" : data.body);
      if (/your key is invalid|invalid key/i.test(text)) {
        applyTrackResult(t, keepSub, prevPos, meta, { error: "FollowMe says this API key is invalid. Re-save the vessel link." });
        return;
      }
      if (!text.trim()) {
        applyTrackResult(t, keepSub, prevPos, meta, { error: data.error || "FollowMe returned an empty response." });
        return;
      }
      var parsed = parseFollowmePayload(text);
      if (data.warning && parsed.pos) parsed.error = null;
      applyTrackResult(t, keepSub, prevPos, meta, parsed);
    }, function (e) {
      if (detail.id !== t.id) return;
      detail.track = { sub: keepSub, loading: false, pos: prevPos, err: (e && e.message) || "Could not load FollowMe.", at: Date.now() };
      if (detail.tab === "tracking") renderTrip();
    });
  }

  // Cursor 2026-10-27: Operations home weather from WeatherAPI.com, under KPI cards / above the map.
  function wxConfig() {
    var s = company && company.settings ? company.settings["3_weather"] : null;
    s = s && typeof s === "object" ? s : {};
    var cfg = window.VEYORA_CONFIG || {};
    return {
      enabled: s.enabled !== false,
      key: String(cfg.weatherApiKey || "").trim(),
      suffix: String(s.suffix != null ? s.suffix : "Maldives").trim()
    };
  }
  function wxSpeedUnit() {
    var s = company && company.settings ? company.settings["4_distance_units"] : null;
    return (s && s.speed) || "Knots";
  }
  function wxFromKph(kph) {
    if (kph == null || isNaN(Number(kph))) return null;
    var n = Number(kph);
    if (wxSpeedUnit() === "km/h") return { n: Math.round(n), u: "km/h", kph: n };
    return { n: Math.round(n / 1.852), u: "kt", kph: n };
  }
  function wxQuery(place, suffix) {
    var p = String(place || "").trim();
    if (!p) return "";
    if (/,/.test(p) || !suffix) return p;
    return p + ", " + suffix;
  }
  function wxMins(clock) {
    var m = String(clock || "").match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 8 * 60;
  }
  function wxIconUrl(url) {
    if (!url) return "";
    return url.indexOf("//") === 0 ? "https:" + url : url;
  }
  function wxPick(payload, day, time) {
    var days = payload && payload.forecast && payload.forecast.forecastday ? payload.forecast.forecastday : [];
    var match = days.filter(function (d) { return d.date === day; })[0];
    var hours = match && match.hour ? match.hour : [];
    var want = wxMins(time), best = null, bestDiff = 1e9;
    hours.forEach(function (h) {
      var part = String(h.time || "").split(" ").pop();
      var diff = Math.abs(wxMins(part) - want);
      if (diff < bestDiff) { bestDiff = diff; best = h; }
    });
    if (best) return { kind: "hour", src: best, day: match && match.day, hours: hours, when: String(best.time || "").split(" ").pop() };
    if (payload && payload.current && day === todayIso()) return { kind: "current", src: payload.current, day: match && match.day, hours: hours, when: "Now" };
    if (match && match.day) return { kind: "day", src: wxDirFromHours(match.day, hours), day: match.day, hours: hours, when: "Daily" };
    if (payload && payload.current) return { kind: "current", src: payload.current, day: null, hours: hours, when: "Now" };
    return null;
  }
  function wxDirFromHours(src, hours) {
    if (src && src.wind_dir) return src;
    var best = null, bestK = -1;
    (hours || []).forEach(function (h) {
      var k = Number(h && h.wind_kph);
      if (h && h.wind_dir && !isNaN(k) && k > bestK) { bestK = k; best = h; }
    });
    if (!best) return src;
    var out = {};
    Object.keys(src || {}).forEach(function (k) { out[k] = src[k]; });
    out.wind_dir = best.wind_dir;
    out.wind_degree = best.wind_degree;
    return out;
  }
  function wxCompassName(dir) {
    var names = {
      N: "North", NNE: "North-northeast", NE: "Northeast", ENE: "East-northeast",
      E: "East", ESE: "East-southeast", SE: "Southeast", SSE: "South-southeast",
      S: "South", SSW: "South-southwest", SW: "Southwest", WSW: "West-southwest",
      W: "West", WNW: "West-northwest", NW: "Northwest", NNW: "North-northwest"
    };
    return names[String(dir || "").toUpperCase()] || "";
  }
  function wxNorm(pick, loc) {
    if (!pick || !pick.src) return null;
    var s = pick.src, isDay = pick.kind === "day";
    var cond = s.condition || {};
    return {
      name: (loc && loc.name) || "",
      region: (loc && loc.region) || "",
      country: (loc && loc.country) || "",
      temp: isDay ? s.avgtemp_c : s.temp_c,
      tempHi: isDay ? s.maxtemp_c : null,
      tempLo: isDay ? s.mintemp_c : null,
      feels: s.feelslike_c,
      text: cond.text || "",
      icon: wxIconUrl(cond.icon),
      wind: wxFromKph(isDay ? s.maxwind_kph : s.wind_kph),
      gust: wxFromKph(s.gust_kph),
      dir: s.wind_dir || "",
      deg: s.wind_degree != null && s.wind_degree !== "" ? Number(s.wind_degree) : null,
      vis: isDay ? s.avgvis_km : s.vis_km,
      humidity: isDay ? s.avghumidity : s.humidity,
      rain: isDay ? s.totalprecip_mm : s.precip_mm,
      rainChance: isDay ? s.daily_chance_of_rain : s.chance_of_rain,
      when: pick.when || "",
      approx: pick.kind === "current" && pick.when === "Now"
    };
  }
  function wxTone(row) {
    var kph = row && row.wind && row.wind.kph;
    if (kph == null) return "";
    if (kph >= 40.7) return "bad";   // ~22 kt
    if (kph >= 29.6) return "warn";  // ~16 kt
    return "";
  }
  function wxFetchPlace(cfg, query) {
    var cacheKey = query.toLowerCase();
    var hit = wxCache[cacheKey];
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve(hit);
    var url = "https://api.weatherapi.com/v1/forecast.json?key=" + encodeURIComponent(cfg.key) +
      "&q=" + encodeURIComponent(query) + "&days=3&aqi=no&alerts=yes";
    return fetch(url).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || (j && j.error)) throw new Error((j && j.error && j.error.message) || "Weather request failed.");
        var out = { at: Date.now(), data: j };
        wxCache[cacheKey] = out;
        return out;
      }, function () { throw new Error("WeatherAPI did not return JSON."); });
    }, function () { throw new Error("Could not reach WeatherAPI.com from this browser."); });
  }
  function wxLoadPlace(cfg, place, day, time) {
    var q = wxQuery(place, cfg.suffix);
    if (!q) return Promise.resolve({ place: place, err: "No location." });
    return wxFetchPlace(cfg, q).then(function (hit) {
      var data = hit.data || {};
      var pick = wxPick(data, day, time);
      var row = wxNorm(pick, data.location);
      if (!row) return { place: place, query: q, err: "No forecast for this day." };
      var alerts = (data.alerts && data.alerts.alert) || [];
      return { place: place, query: q, row: row, alerts: alerts, loc: data.location };
    }, function (e) {
      return { place: place, query: q, err: (e && e.message) || "Weather failed." };
    });
  }
  function wxAlertLines(packs) {
    var seen = {}, out = [];
    (packs || []).forEach(function (pack) {
      ((pack && pack.alerts) || []).forEach(function (a) {
        var t = String((a && (a.headline || a.event || a.desc)) || "").trim();
        if (t && !seen[t]) { seen[t] = true; out.push(t); }
      });
    });
    return out;
  }
  function wxStat(label, value) {
    return '<div><small>' + esc(label) + '</small><b>' + esc(value == null || value === "" ? "—" : String(value)) + '</b></div>';
  }
  // Cursor 2026-10-27: Apple Weather-style circle + dart arrow; points to where the wind comes from.
  function wxCompass(deg, title) {
    if (deg == null || isNaN(Number(deg))) return "";
    var rot = Math.round(Number(deg));
    return '<span class="tdv-wx-compass" title="' + esc(title || "") + '" aria-hidden="true">' +
      '<svg viewBox="0 0 32 32">' +
        '<circle cx="16" cy="16" r="13.5" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
        '<g transform="rotate(' + rot + ' 16 16)">' +
          '<path d="M16 5.6 21.2 23.2 16 19.6 10.8 23.2Z" fill="currentColor"/>' +
        '</g>' +
      '</svg></span>';
  }
  function wxWindStat(r) {
    var wind = r && r.wind ? r.wind.n + " " + r.wind.u : "—";
    var code = String((r && r.dir) || "").toUpperCase();
    var name = wxCompassName(code);
    var deg = r && r.deg != null && !isNaN(Number(r.deg)) ? Number(r.deg) : null;
    var sub = name ? code + " · from " + name : (code ? "from " + code : "");
    return '<div class="tdv-wx-wind"><small>Wind</small>' +
      '<b class="tdv-wx-dirb">' + wxCompass(deg, sub || code) + esc(wind) + '</b>' +
      (sub ? '<em>' + esc(sub) + '</em>' : "") + '</div>';
  }
  function wxCol(pack) {
    if (!pack) return '<article class="tdv-wx-col"><header><small>Location</small><strong>—</strong></header><p class="note">No location.</p></article>';
    if (pack.err) return '<article class="tdv-wx-col"><header><small>Location</small><strong>' + esc(pack.place || "—") + '</strong></header><p class="note">' + esc(pack.err) + '</p></article>';
    var r = pack.row, tone = wxTone(r);
    var gust = r.gust ? r.gust.n + " " + r.gust.u : "—";
    var vis = r.vis != null && r.vis !== "" ? Number(r.vis).toFixed(r.vis < 10 ? 1 : 0) + " km" : "—";
    var rain = r.rainChance != null && r.rainChance !== "" ? r.rainChance + "%" : (r.rain != null ? Number(r.rain).toFixed(1) + " mm" : "—");
    var temp = r.temp != null ? Math.round(r.temp) + "°" : (r.tempHi != null ? Math.round(r.tempHi) + "°" : "—");
    var loc = pack.place || r.name || "—";
    return '<article class="tdv-wx-col' + (tone ? " " + tone : "") + '">' +
      '<header><small>' + esc(r.when || "Now") + '</small><strong>' + esc(loc) + '</strong></header>' +
      '<div class="tdv-wx-main">' +
        (r.icon ? '<img class="tdv-wx-ico" src="' + esc(r.icon) + '" alt="">' : '<span class="tdv-wx-ico">' + icon(I.sun) + '</span>') +
        '<div><strong class="tdv-wx-temp">' + esc(temp) + '</strong><span class="tdv-wx-cond">' + esc(r.text || "—") + '</span></div>' +
      '</div>' +
      '<div class="tdv-wx-stats">' +
        wxWindStat(r) + wxStat("Gust", gust) + wxStat("Visibility", vis) + wxStat("Rain", rain) +
      '</div>' +
      (r.approx ? '<p class="note">Showing conditions now — this date is outside the 3-day forecast.</p>' : "") +
      '</article>';
  }
  function wxHomePlaces() {
    var day = viewDayIso(), seen = {}, list = [];
    trips.filter(function (t) { return t.day === day; }).forEach(function (t) {
      [t.origin, t.destination].forEach(function (p) {
        var name = String(p || "").trim();
        var k = name.toLowerCase();
        if (name && !seen[k]) { seen[k] = true; list.push(name); }
      });
    });
    if (!list.length) {
      var cfg = wxConfig();
      list.push((company && company.region) || cfg.suffix || "Malé");
    }
    return list.slice(0, 4);
  }
  function wxHomeClock() {
    if (viewDayIso() !== todayIso()) return "12:00";
    var d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function homeWeatherHtml() {
    var cfg = wxConfig();
    if (!cfg.enabled) return "";
    var places = wxHomePlaces();
    var inner;
    if (!cfg.key) {
      inner = '<div class="tdv-wx-setup">' + icon(I.sun) +
        '<div><strong>Weather is not configured</strong><p>The shared WeatherAPI.com key is missing from this build.</p></div></div>';
    } else if (homeWx && homeWx.err && !(homeWx.places && homeWx.places.length)) {
      inner = '<div class="tdv-wx-setup">' + icon(I.alert) +
        '<div><strong>Weather could not load</strong><p>' + esc(homeWx.err) + '</p>' +
        '<button type="button" class="linkish" data-wx-refresh>Try again</button></div></div>';
    } else if (!homeWx || homeWx.loading || !homeWx.places) {
      inner = '<div class="tdv-wx-cols n' + Math.max(1, places.length) + '">' +
        places.map(function () { return '<div class="tdv-wx-skel"></div>'; }).join("") + '</div>';
    } else {
      var alerts = wxAlertLines(homeWx.places);
      inner = (alerts.length ? '<div class="tdv-wx-alert" role="status">' + icon(I.alert) + '<span>' + esc(alerts[0]) + '</span></div>' : "") +
        '<div class="tdv-wx-cols n' + homeWx.places.length + '">' + homeWx.places.map(wxCol).join("") + '</div>';
    }
    return '<section class="ops-home-card ops-wx" id="opsWx">' +
      '<div class="ops-home-h"><span>' + icon(I.sun) + '<h2>Weather</h2></span>' +
        '<span class="ops-wx-acts">' +
          '<span class="tdv-wx-when">' + esc(dayPretty(viewDayIso())) + '</span>' +
          (cfg.key ? '<button type="button" class="ops-viewall" data-wx-refresh>Refresh</button>' : "") +
        '</span></div>' + inner +
      '<p class="tdv-wx-src">WeatherAPI.com</p></section>';
  }
  function bindHomeWx() {
    [].forEach.call(document.querySelectorAll("#opsWx [data-wx-refresh]"), function (b) {
      b.addEventListener("click", function () { loadHomeWeather(true); });
    });
  }
  function paintHomeWx() {
    var el = $("opsWx");
    if (!el) return;
    el.outerHTML = homeWeatherHtml();
    bindHomeWx();
  }
  function loadHomeWeather(force) {
    if (pageView !== "home") return;
    var cfg = wxConfig();
    if (!cfg.enabled) return;
    var places = wxHomePlaces();
    var stamp = viewDayIso() + "|" + places.join("|");
    if (!force && homeWx && homeWx.stamp === stamp && (homeWx.loading || homeWx.at || homeWx.needKey || homeWx.err)) return;
    if (!cfg.key) { homeWx = { stamp: stamp, needKey: true }; return; }
    if (force) places.forEach(function (p) { delete wxCache[wxQuery(p, cfg.suffix).toLowerCase()]; });
    homeWx = { stamp: stamp, loading: true };
    if (force) paintHomeWx();
    var day = viewDayIso(), time = wxHomeClock();
    Promise.all(places.map(function (p) { return wxLoadPlace(cfg, p, day, time); })).then(function (rows) {
      if (pageView !== "home" || !homeWx || homeWx.stamp !== stamp) return;
      homeWx = { stamp: stamp, at: Date.now(), places: rows };
      paintHomeWx();
    }, function (e) {
      if (pageView !== "home" || !homeWx || homeWx.stamp !== stamp) return;
      homeWx = { stamp: stamp, err: (e && e.message) || "Weather could not load." };
      paintHomeWx();
    });
  }

  function renderTrip() {
    var id = detail.id, t = trips.filter(function (x) { return x.id === id; })[0];
    if (!t) { closeModal(); return; }
    var r = t.raw || {}, closed = CLOSED.indexOf(r.status) >= 0, m = detail.man || {}, c = m.counts || {};
    var paxCount = c.booked != null ? c.booked : (t.booked != null ? t.booked : 0);
    var crewN = (t.captain ? 1 : 0) + (detail.crew || []).length;
    if (detail.tab === "payments") detail.tab = "overview";
    var tabs = [
      ["overview", "Overview"],
      ["passengers", "Passengers", paxCount],
      ["crew", "Crew", crewN],
      ["tracking", "Tracking"]
    ];
    if (opsOn("audit")) tabs.push(["history", "Log"]);
    if (detail.tab === "history" && !opsOn("audit")) detail.tab = "overview";
    var pct = loadPct(paxCount, t.capacity);
    var body = "";
    var loadingNote = m._loading ? '<p class="note">Loading…</p>' : "";
    var errNote = m._err ? '<p class="note td-err">Some passenger data could not load.</p>' : "";

    if (detail.tab === "overview") {
      var tasks = (queue || []).filter(function (x) { return x.trip_id === id && x.id; });
      var vCap = vesselOf(t);
      var f = crewFill({ captain: t.captain, crewCount: (detail.crew || []).length, vessel_id: t.vessel_id });
      var recent = (detail.events || []).slice(0, 6);
      var crewPeople = tdvCrewPeople(t);
      var face = vCap ? vesselFace(vCap) : null;
      var speed = vesselSpeed(vCap);
      var capN = t.capacity != null ? Number(t.capacity) : 0;
      var seatPct = capN ? Math.round((paxCount || 0) * 100 / capN) : 0;
      var chkN = c.checked_in || 0, brdN = c.boarded || 0;
      var chkPct = capN ? Math.round(chkN * 100 / capN) : 0;
      var brdPct = capN ? Math.round(brdN * 100 / capN) : 0;
      var dur = tripDuration(t);
      body =
        loadingNote + errNote +
        loadBanner(paxCount, t.capacity, t.vessel || t.vesselCode) +
        '<div class="tdv-kpis">' +
          tdvKpi(I.people, "blue", "Passenger Seats", (paxCount || 0) + " / " + (capN || "—"), seatPct) +
          tdvKpi(I.ok, "green", "Checked In", chkN, chkPct) +
          tdvKpi(I.bag, "blue", "Boarded", brdN, brdPct) +
          tdvKpi(I.money, "violet", "Revenue", fmtMoney(c.revenue || 0), null) +
        '</div>' +
        '<div class="tdv-grid">' +
          '<div class="tdv-col">' +
            '<section class="td-block tdv-card">' +
              '<div class="td-block-head"><h3>' + icon(I.boat) + ' Seat Map</h3></div>' + tdvSeatMap(t, c) +
            '</section>' +
            '<section class="td-block tdv-card tdv-vessel">' +
              '<div class="td-block-head"><h3>' + icon(I.vessel) + ' Vessel &amp; Captain</h3>' +
                (canOps && !closed ? '<button type="button" class="linkish" data-tdv-panel="vessel">Change</button>' : "") +
              '</div>' +
              (vCap
                ? '<div class="tdv-vcard">' +
                    '<div class="tdv-vpic">' + window.VeyoraShell.vesselPhotoImg(vCap) + '</div>' +
                    '<div class="tdv-vmeta">' +
                      '<div class="tdv-vname"><strong>' + esc(vCap.name || t.vessel || "Vessel") + '</strong>' +
                        (face ? '<span class="tdv-vst ' + face.cls + '">' + esc(face.label) + '</span>' : "") + '</div>' +
                      '<p>' + esc([vCap.kind || "Vessel", vCap.passenger_capacity != null ? vCap.passenger_capacity + " seats" : ""].filter(Boolean).join(" · ")) + '</p>' +
                      '<div class="tdv-vstats">' +
                        '<div><small>Vessel Code</small><b>' + esc(vCap.code || t.vesselCode || "—") + '</b></div>' +
                        '<div><small>Registration</small><b>' + esc(vCap.registration || vCap.code || "—") + '</b></div>' +
                        (speed ? '<div><small>Max Speed</small><b>' + esc(speed) + (/\d$/.test(String(speed)) ? " knots" : "") + '</b></div>' : "") +
                      '</div>' +
                    '</div>' +
                    '<div class="tdv-capt">' +
                      '<small>Captain</small>' +
                      '<strong>' + esc(t.captain || "No captain") + '</strong>' +
                      (canOps && !closed ? '<button type="button" class="ghost" data-tdv-panel="vessel">Change</button>' : "") +
                    '</div>' +
                  '</div>'
                : '<div class="tdv-novessel">' + icon(I.vessel) + '<p>No vessel assigned.</p>' +
                    (canOps && !closed ? '<button type="button" class="tdv-btn primary" data-tdv-panel="vessel">Assign vessel</button>' : "") +
                  '</div>') +
            '</section>' +
            '<section class="td-block tdv-card">' +
              '<div class="td-block-head"><h3>' + icon(I.pin) + ' Route &amp; Schedule</h3></div>' +
              '<div class="tdv-route">' +
                '<div class="tdv-route-txt">' +
                  '<strong>' + esc((t.origin || "Origin") + " → " + (t.destination || "Destination")) + '</strong>' +
                  '<div class="tdv-route-times">' +
                    '<div><small>Departure Time</small><b>' + esc(t.time) + '</b><em>' + esc(dayPretty(t.day)) + '</em></div>' +
                    '<div><small>Estimated Arrival</small><b>' + esc(t.arrive || "—") + '</b><em>' + esc(dayPretty(t.day)) + '</em></div>' +
                    '<div><small>Duration</small><b>' + esc(durWords(dur) || "—") + '</b></div>' +
                  '</div>' +
                '</div>' +
                '<div class="tdv-mini-map" aria-hidden="true">' +
                  '<i class="isl a"></i><i class="isl b"></i><span class="pin from">' + esc(t.origin || "Origin") + '</span>' +
                  '<span class="pin to">' + esc(t.destination || "Destination") + '</span>' +
                '</div>' +
              '</div>' +
            '</section>' +
          '</div>' +
          '<div class="tdv-col">' +
            '<section class="td-block tdv-card">' +
              '<div class="td-block-head"><h3>' + icon(I.people) + ' Boarding Progress</h3></div>' + tdvFunnel(c, capN) +
            '</section>' +
            '<section class="td-block tdv-card">' +
              '<div class="td-block-head"><h3>' + icon(I.person) + ' Crew on Board</h3>' +
                '<span class="tdv-crew-n">' + crewPeople.length + (f.need ? " / " + f.need : "") + ' crew</span>' +
                '<button type="button" class="linkish" data-dtab="crew">Manage Crew</button>' +
              '</div>' +
              '<div class="tdv-crew">' +
                (crewPeople.length
                  ? crewPeople.map(function (p) {
                      return '<div class="tdv-crew-p"><span class="ops-av r-' + slug(p.role || "crew") + '">' + esc(initials(p.name)) + '</span>' +
                        '<span><strong>' + esc(p.name) + '</strong><small>' + esc(String(p.role || "Crew").toUpperCase()) + '</small></span></div>';
                    }).join("")
                  : '<p class="note">No crew assigned yet.</p>') +
                (canOps && !closed ? '<button type="button" class="tdv-addcrew" data-dtab="crew">' + icon(I.plus) + ' Add Crew</button>' : "") +
              '</div>' +
            '</section>' +
            (opsOn("audit") ? '<section class="td-block tdv-card">' +
              '<div class="td-block-head"><h3>' + icon(I.clock) + ' Latest Activity</h3><button type="button" class="linkish" data-dtab="history">View Full Log</button></div>' +
              (recent.length ? '<ol class="tdx-log compact">' + recent.map(logItem).join("") + '</ol>' : '<p class="note">' + (m._loading ? "Loading…" : "Nothing logged yet.") + '</p>') +
            '</section>' : "") +
            (opsOn("tasks") && tasks.length
              ? '<section class="td-block tdv-card"><div class="td-block-head"><h3>Open tasks</h3><span class="chip st-delayed">' + tasks.length + '</span></div><div class="ops-tasks">' + tasks.map(function (x) {
                  return '<div class="ops-task"><span class="grow"><strong>' + esc(x.title) + '</strong><small>' + esc(x.sub || "Dispatch task") + '</small></span>' +
                    (canOps ? '<button type="button" class="btn-soft" data-done="' + esc(x.id) + '">Done</button>' : "") + '</div>';
                }).join("") + '</div></section>' : "") +
          '</div>' +
        '</div>' +
        (detail.panel ? "" : dispatchBar(t, closed));
    } else if (detail.tab === "passengers") {
      var canAddPax = canOps && !closed && r.status !== "Departed" && r.status !== "In transit" && !m._loading;
      var openPax = detail.paxId
        ? (m.passengers || []).filter(function (x) { return x.id === detail.paxId; })[0]
        : null;
      if (detail.paxId && !openPax && !m._loading) { detail.paxId = null; detail.paxExtra = null; }
      if (openPax) {
        body = errNote + paxDetailView(openPax, closed, t);
        // Flag for CSS: detail canvas vs list board.
        detail._paxDetail = true;
      } else {
        detail._paxDetail = false;
        var allPax = m.passengers || [];
        var waiting = allPax.filter(function (p) { return !paxGone(p) && p.status === "Booked"; }).length;
        body = errNote +
          (m._loading
            ? '<section class="plx-hero skel"><div class="plx-hero-ring"><div class="plx-skel-ring"></div><div class="plx-hero-meta"><span class="ln w50"></span><span class="ln w30"></span></div></div><div class="plx-kpis">' +
                [0, 1, 2, 3].map(function () { return '<div class="plx-kpi sk"></div>'; }).join("") + '</div></section>'
            : paxBoardHero(allPax, c, t)) +
          paxCommandBar(canAddPax, closed, waiting) +
          (canAddPax && detail.addPax
            ? '<section class="td-block td-add plx-add" id="bAddForm">' +
                '<div class="td-block-head"><h3>New passenger booking</h3></div>' +
                '<div class="cards">' +
                  '<div class="fld"><label for="bName">Contact name</label><input id="bName" maxlength="120"></div>' +
                  '<div class="fld"><label for="bPhone">Phone</label><input id="bPhone" maxlength="40"></div>' +
                '</div><div id="bPax"></div>' +
                '<p class="td-inline-act"><button type="button" class="btn-soft" id="bAddPax">+ Another passenger</button></p>' +
                '<div class="cards">' +
                  '<div class="fld"><label for="bPaid">Paid now (' + esc(baseCurrency().code) + ')</label><input id="bPaid" type="number" min="0" step="0.01" placeholder="0"></div>' +
                  '<div class="fld"><label for="bMethod">Payment method</label><select id="bMethod"><option value="">—</option>' +
                    payMethods().map(function (x) { return '<option>' + esc(x) + '</option>'; }).join("") + '</select></div>' +
                '</div>' + payCurrencyNote() +
                '<p class="td-inline-act"><button type="button" class="save" id="bSave">Save booking</button></p>' +
              '</section>'
            : "") +
          '<div class="td-pax-scroll">' +
            (m._loading ? paxSkeleton() : paxList(allPax, closed)) +
          '</div>';
      }
    } else if (detail.tab === "crew") {
      body = tdvCrewTab(t, closed); // Cursor 2026-10-27: crew tab matches trip-detail cards
    } else if (detail.tab === "tracking") {
      if (!detail.track) detail.track = { sub: "map", loading: false };
      body = '<div id="tdArrival" data-trip="' + esc(t.id) + '"></div>' + trackingView(t); // Claude 2026-10-27: arrival detection (arrivals.js)
    } else {
      var evs = detail.events || [], lf = detail.logF || "all", kinds = {};
      evs.forEach(function (e) { var k = eventKind(e); kinds[k] = (kinds[k] || 0) + 1; });
      var shownEv = evs.filter(function (e) { return lf === "all" || eventKind(e) === lf; }), days = [], byDay = {};
      shownEv.forEach(function (e) { var d = iso(new Date(e.created_at)); if (!byDay[d]) { byDay[d] = []; days.push(d); } byDay[d].push(e); });
      body = '<section class="td-block tdx-logbox"><div class="td-block-head"><h3>Trip log</h3><span class="muted-cell">' + evs.length + ' entries</span></div>' +
        '<div class="tdx-chips">' + [["all", "All"], ["status", "Status"], ["crew", "Crew"], ["booking", "Bookings"], ["auto", "Automatic"], ["created", "Created"]].filter(function (x) { return x[0] === "all" || kinds[x[0]]; }).map(function (x) {
          return '<button type="button" class="tdx-chip' + (lf === x[0] ? " on" : "") + '" data-logf="' + x[0] + '">' + x[1] + '<b>' + (x[0] === "all" ? evs.length : kinds[x[0]]) + '</b></button>';
        }).join("") + '</div>' +
        (shownEv.length ? days.map(function (d) {
          return '<div class="tdx-logday"><span class="tdx-logday-h">' + esc(dayLabel(d)) + '</span><ol class="tdx-log">' + byDay[d].map(logItem).join("") + '</ol></div>';
        }).join("") : (m._loading ? '<p class="note">Loading…</p>' : '<div class="tdx-empty">' + icon(I.clock) + '<strong>Nothing logged yet</strong></div>')) +
      '</section>';
    }

    var tabsHtml = '<div class="tdv-tabs">' +
      '<div class="ops-tabs seg ops-dtabs td-tabs">' + tabs.map(function (x) {
        return '<button type="button" class="' + (detail.tab === x[0] ? "on" : "") + '" data-dtab="' + x[0] + '">' + esc(x[1]) + (x[2] != null ? '<b>' + x[2] + '</b>' : "") + '</button>';
      }).join("") + '</div>' +
      (detail.tab === "passengers" ? "" :
        '<div class="tdv-tab-acts">' +
          '<button type="button" class="tdv-btn" data-print="manifest">' + icon(I.print) + ' Print</button>' +
        '</div>') +
    '</div>';
    // Passengers tab: only tabs + list. Overview keeps dispatch actions at the bottom of the body.
    var chrome = detail.tab === "passengers"
      ? '<header class="td-pax-top">' +
          '<div class="td-pax-top-id"><strong>' + esc(t.code || "Trip") + '</strong>' +
            '<span>' + esc((t.origin || "") + (t.destination ? " → " + t.destination : "")) + '</span></div>' +
          '<button type="button" class="td-close" data-close aria-label="Close">' + icon(I.close) + '</button>' +
        '</header>' + tabsHtml
      : tripHero(t) + tabsHtml;
    openModal(
      chrome +
      '<div class="td-body' + (detail.tab === "passengers" ? " is-pax" : "") + (detail._paxDetail ? " is-pax-detail" : "") + '">' + body + '<p class="msg" id="mMsg" role="status"></p></div>' +
      tdvSheet(t),
      true,
      detail.tab === "passengers"
    );
    bindTrip(id);
    syncSeatPopup();
    if (detail.tab === "tracking") {
      paintTrackMap();
      if (!detail.track || (!detail.track.loading && !detail.track.at)) loadTripTracking(false);
      if (!trackTimer) trackTimer = setInterval(function () {
        if (detail.tab !== "tracking" || $("modal").hidden) { destroyTrackMap(); return; }
        loadTripTracking(true);
      }, 60000);
    } else {
      destroyTrackMap();
    }
  }

  function paxRow() {
    var cats = listSetting("7_passenger_categories", ["Adult", "Child", "Infant", "Senior", "Student", "Resident", "Tourist"]);
    var el = document.createElement("div");
    el.className = "cards ops-paxin";
    el.innerHTML = '<div class="fld"><label>Passenger name</label><input data-f="full_name" maxlength="120"></div>' +
      '<div class="fld"><label>ID / passport</label><input data-f="id_number" maxlength="60"></div>' +
      '<div class="fld"><label>Category</label><select data-f="category">' + cats.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join("") + '</select></div>' +
      '<div class="fld"><label>Fare (blank = route fare)</label><input data-f="fare" type="number" min="0" step="0.01"></div>';
    $("bPax").appendChild(el);
  }

  function bindTrip(id) {
    function after(p, keepTab) {
      p.then(function () { return Promise.all([loadData(), loadDetail(id)]); })
       .then(function () { render(); renderTrip(); }, function (e) { say(e.message, "err"); });
    }
    [].forEach.call($("modalCard").querySelectorAll("[data-dtab]"), function (b) {
      b.addEventListener("click", function () {
        detail.tab = b.dataset.dtab;
        detail.panel = null;
        if (detail.tab === "passengers" && b.dataset.openAdd === "1") { detail.addPax = true; }
        else if (detail.tab !== "passengers") { detail.addPax = false; detail.paxId = null; detail.paxExtra = null; }
        if (detail.tab !== "tracking") destroyTrackMap();
        renderTrip();
      });
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-tdv-panel]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var p = b.getAttribute("data-tdv-panel");
        detail.panel = p || null;
        if (p === "vessel") {
          var trip = trips.filter(function (x) { return x.id === id; })[0];
          detail.swap = { vesselId: trip && trip.vessel_id || null, captainId: trip && trip.raw && trip.raw.captain_id || null, q: "" };
        }
        renderTrip();
      });
    });
    if ($("tdvMoreBtn")) {
      $("tdvMoreBtn").addEventListener("click", function (e) {
        e.stopPropagation();
        var m = $("tdvMenu");
        if (m) m.hidden = !m.hidden;
      });
    }
    if ($("tdvMenu")) $("tdvMenu").addEventListener("click", function (e) { e.stopPropagation(); });
    [].forEach.call($("modalCard").querySelectorAll("[data-tdv-pick]"), function (b) {
      b.addEventListener("click", function () {
        detail.swap = detail.swap || {};
        detail.swap.vesselId = b.dataset.tdvPick;
        var trip = trips.filter(function (x) { return x.id === id; })[0];
        var block = vesselAssignBlock(b.dataset.tdvPick, trip);
        renderTrip();
        if (block) say(block, "err");
      });
    });
    if ($("tdvVessQ")) $("tdvVessQ").addEventListener("input", function () {
      detail.swap = detail.swap || {};
      detail.swap.q = this.value;
      renderTrip();
      var n = $("tdvVessQ"); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (err) {} }
    });
    if ($("aCaptain")) $("aCaptain").addEventListener("change", function () {
      detail.swap = detail.swap || {};
      detail.swap.captainId = this.value || null;
    });
    if ($("tdvSaveVessel")) $("tdvSaveVessel").addEventListener("click", function () {
      var swap = detail.swap || {};
      if (!swap.vesselId) return;
      var trip = trips.filter(function (x) { return x.id === id; })[0];
      var block = vesselAssignBlock(swap.vesselId, trip);
      if (block) { say(block, "err"); return; }
      say("Saving…");
      after(db.from("trips").update({
        vessel_id: swap.vesselId,
        captain_id: swap.captainId || null
      }).eq("id", id).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        detail.panel = null;
        boardToast("Vessel updated — trip can continue.");
      }));
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-track-sub]"), function (b) {
      b.addEventListener("click", function () {
        detail.track = detail.track || {};
        detail.track.sub = b.dataset.trackSub;
        renderTrip();
      });
    });
    if ($("trRefresh")) $("trRefresh").addEventListener("click", function () { loadTripTracking(true); });
    if ($("bAddOpen")) $("bAddOpen").addEventListener("click", function () { detail.addPax = true; detail.paxId = null; renderTrip(); });
    if ($("paxBack")) $("paxBack").addEventListener("click", function () { detail.paxId = null; detail.paxExtra = null; detail.paxMove = null; renderTrip(); });
    [].forEach.call($("modalCard").querySelectorAll("[data-pax-move]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        detail.paxMove = b.dataset.paxMove;
        renderTrip();
      });
    });
    if ($("paxMoveCancel")) $("paxMoveCancel").addEventListener("click", function () { detail.paxMove = null; renderTrip(); });
    if ($("paxMoveGo")) $("paxMoveGo").addEventListener("click", function () {
      var toId = $("paxMoveTo") && $("paxMoveTo").value;
      var p = ((detail.man || {}).passengers || []).filter(function (x) { return x.id === detail.paxId; })[0];
      var dest = trips.filter(function (x) { return x.id === toId; })[0];
      if (!toId || !p || !dest) { say("Choose a trip.", "err"); return; }
      if (opsOn("capacity")) {
        var left = tripPaxLeft(dest);
        if (left != null && left < 1) { say("That trip has no seats left.", "err"); return; }
      }
      say("Moving passenger…");
      after(rpc("create_booking", {
        p_company: company.id, p_trip: toId,
        p_booking: {
          contact_name: p.full_name, contact_phone: p.phone || p.contact_phone || null, source: "Transfer",
          status: "Pending", paid_amount: 0, payment_method: p.payment_method || null
        },
        p_passengers: [{ full_name: p.full_name, category: p.category || "Adult", id_number: p.id_number || null }]
      }).then(function () {
        return rpc("cancel_booking", { p_id: p.booking_id, p_reason: "Transferred to " + (dest.code || dest.time) });
      }).then(function () {
        detail.paxMove = null; detail.paxId = null; detail.paxExtra = null;
        boardToast((p.full_name || "Passenger") + " moved to " + dest.time + " " + (dest.origin || "") + " → " + (dest.destination || "") + ".");
      }));
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-pax-open]"), function (card) {
      function go() { openPaxDetail(card.dataset.paxOpen); }
      card.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("button, a, select, input, [data-stop-open], .plx-c-pay, .plx-c-board, .plx-c-foot")) return;
        go();
      });
      card.addEventListener("keydown", function (e) {
        if (e.target.closest && e.target.closest("button, a, select, input, .plx-c-pay, .plx-c-board, .plx-c-foot")) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-pxf]"), function (b) { b.addEventListener("click", function () { detail.paxF = b.dataset.pxf; renderTrip(); }); });
    [].forEach.call($("modalCard").querySelectorAll("[data-pxview]"), function (b) {
      b.addEventListener("click", function () { detail.paxView = b.dataset.pxview; renderTrip(); });
    });
    if ($("pxSort")) $("pxSort").addEventListener("change", function () { detail.paxSort = this.value; renderTrip(); });
    [].forEach.call($("modalCard").querySelectorAll("[data-logf]"), function (b) { b.addEventListener("click", function () { detail.logF = b.dataset.logf; renderTrip(); }); });
    if ($("pxQ")) $("pxQ").addEventListener("input", function () {
      var v = this.value, pos = this.selectionStart; detail.paxQ = v; renderTrip();
      var n = $("pxQ"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
    });
    if ($("pxCheckAll")) $("pxCheckAll").addEventListener("click", function () {
      var ids = ((detail.man || {}).passengers || []).filter(function (p) { return !paxGone(p) && p.status === "Booked"; }).map(function (p) { return p.id; });
      if (!ids.length) return;
      this.disabled = true; say("Checking in " + ids.length + "…");
      after(ids.reduce(function (pr, pid) { return pr.then(function () { return rpc("set_passenger_status", { p_id: pid, p_status: "Checked in" }); }); }, Promise.resolve()));
    });
    if ($("cwAuto2")) $("cwAuto2").addEventListener("click", function () { this.disabled = true; say("Checking the roster…"); after(rpc("assign_trip_crew", { p_company: company.id })); });
    if ($("bAddCancel")) $("bAddCancel").addEventListener("click", function () { detail.addPax = false; renderTrip(); });
    [].forEach.call($("modalCard").querySelectorAll("[data-print]"), function (b) {
      b.addEventListener("click", function () {
        detail.tab = "passengers";
        renderTrip();
        setTimeout(function () { window.print(); }, 120);
      });
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-act]"), function (b) {
      b.addEventListener("click", function () {
        var a = b.dataset.act;
        var reason = "";
        if ($("cReason") && $("cReason").value) reason = $("cReason").value.trim();
        if ($("cReasonOther") && $("cReasonOther").value.trim()) reason = $("cReasonOther").value.trim();
        if ((a === "Delayed" || a === "Cancelled") && !reason) {
          var why = $("cWhy"); if (why) { why.open = true; why.classList.remove("need"); void why.offsetWidth; why.classList.add("need"); why.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
          say("Pick or type a reason first.", "err"); return;
        }
        if (a === "Cancelled") {
          var nPax = (detail.man && detail.man.counts && detail.man.counts.booked) || (trips.filter(function (x) { return x.id === id; })[0] || {}).booked || 0;
          var cancelMsg = nPax ? ("Cancel this trip? " + nPax + " passenger" + (nPax === 1 ? "" : "s") + " will be refunded per your Cancellation rules.") : "Cancel this trip? Booked passengers will be refunded per your Cancellation rules.";
          if (!window.confirm(cancelMsg)) return;
        }
        if (a === "Scheduled") {
          if (!window.confirm("Resume this trip and clear the delay?")) return;
        }
        if (a === "clear") {
          var tripC = trips.filter(function (x) { return x.id === id; })[0];
          var vC = vesselOf(tripC);
          var mLock = vesselMaintBlock(vC);
          if (mLock) { say(mLock, "err"); return; }
          if (opsOn("readiness")) {
            var pack = readinessPack(tripC);
            var blocking = pack && pack.issues ? pack.issues.filter(function (i) { return i.severity === "blocking"; }) : [];
            if (blocking.length) { say(blocking[0].message, "err"); return; }
            if (!($("cWeather") && $("cWeather").checked && $("cCheck") && $("cCheck").checked)) {
              say("Confirm weather and safety before clearance.", "err"); return;
            }
          }
        }
        if (a === "Arrived" && opsOn("completeCheck")) {
          var issues = [];
          var paxList = (detail.man && detail.man.passengers) || [];
          var livePax = paxList.filter(function (p) { return !paxGone(p); });
          var notBoard = livePax.filter(function (p) { return p.status !== "Boarded"; }).length;
          var unpaid = livePax.filter(function (p) { return paxNeedsPay(p); }).length;
          var openT = (queue || []).filter(function (x) { return x.trip_id === id && x.id; }).length;
          if (notBoard) issues.push(notBoard + " passenger" + (notBoard === 1 ? "" : "s") + " not boarded");
          if (unpaid) issues.push(unpaid + " unpaid booking" + (unpaid === 1 ? "" : "s"));
          if (openT) issues.push(openT + " open dispatch task" + (openT === 1 ? "" : "s"));
          if (issues.length && !window.confirm("Still open: " + issues.join(", ") + ". Mark arrived anyway?")) return;
        }
        say("Saving…");
        detail.panel = null;
        if (a === "clear") {
          after(rpc("clear_trip", { p_id: id, p_checks: { weather: !!($("cWeather") && $("cWeather").checked), checklist: !!($("cCheck") && $("cCheck").checked) } }));
        } else {
          after(rpc("set_trip_status", { p_id: id, p_status: a, p_reason: reason || null }));
        }
      });
    });
    // Pre-departure checks: live "x of 2 done" count.
    function countChecks() {
      var boxes = [$("cWeather"), $("cCheck")].filter(Boolean), done = boxes.filter(function (x) { return x.checked; }).length;
      if ($("cCount")) { $("cCount").textContent = done + " of " + boxes.length + " done"; $("cCount").classList.toggle("all", done === boxes.length); }
    }
    ["cWeather", "cCheck"].forEach(function (k) { if ($(k)) $(k).addEventListener("change", countChecks); });
    // Reason chips drive the (hidden) reason select; typing your own clears the chip.
    [].forEach.call($("modalCard").querySelectorAll("[data-reason]"), function (b) {
      b.addEventListener("click", function () {
        var on = b.getAttribute("aria-checked") !== "true";
        [].forEach.call($("modalCard").querySelectorAll("[data-reason]"), function (o) { o.setAttribute("aria-checked", "false"); });
        b.setAttribute("aria-checked", on ? "true" : "false");
        if ($("cReason")) $("cReason").value = on ? b.dataset.reason : "";
        if (on && $("cReasonOther")) $("cReasonOther").value = "";
        if ($("cWhyHint")) $("cWhyHint").textContent = on ? "Reason: " + b.dataset.reason + ". Now press Delay or Cancel." : "Pick a reason first, then press Delay or Cancel";
        if ($("cWhy")) $("cWhy").classList.remove("need");
      });
    });
    if ($("cReasonOther")) $("cReasonOther").addEventListener("input", function () {
      if (!this.value.trim()) return;
      [].forEach.call($("modalCard").querySelectorAll("[data-reason]"), function (o) { o.setAttribute("aria-checked", "false"); });
      if ($("cReason")) $("cReason").value = "";
      if ($("cWhyHint")) $("cWhyHint").textContent = "Your reason is ready. Now press Delay or Cancel.";
      if ($("cWhy")) $("cWhy").classList.remove("need");
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-role-user]"), function (sel) {
      sel.addEventListener("change", function () {
        say("Updating role…");
        after(db.from("trip_crew").update({ role: sel.value }).eq("trip_id", id).eq("user_id", sel.dataset.roleUser)
          .then(function (res) { if (res.error) throw new Error(res.error.message); }));
      });
    });
    // Open-seat "+": click to see who's designated for that role, with "Add other staff" to pick from everyone.
    // The picker panel itself is a page-level popup (see syncSeatPopup), bound separately from this card.
    [].forEach.call($("modalCard").querySelectorAll("[data-seat-role]"), function (btn) {
      btn.addEventListener("click", function () {
        var role = btn.dataset.seatRole;
        detail.seatPicker = (detail.seatPicker && detail.seatPicker.role === role) ? null : { role: role, showAll: false };
        renderTrip();
      });
    });
    if ($("aSave")) $("aSave").addEventListener("click", function () {
      var patch = {};
      if ($("aVessel")) patch.vessel_id = $("aVessel").value || null;
      if ($("aCaptain")) patch.captain_id = $("aCaptain").value || null;
      if (patch.vessel_id) {
        var trip = trips.filter(function (x) { return x.id === id; })[0];
        var block = vesselAssignBlock(patch.vessel_id, trip);
        if (block) { say(block, "err"); return; }
      }
      say("Saving…");
      after(db.from("trips").update(patch).eq("id", id)
        .then(function (res) { if (res.error) throw new Error(res.error.message); }));
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-tdv-addcrew]"), function (b) {
      b.addEventListener("click", function () {
        var box = $("tdvAddCrew"), sel = $("cwUser");
        if (box) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
        if (sel) sel.focus();
      });
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-done]"), function (b) {
      b.addEventListener("click", function () { after(rpc("finish_dispatch_task", { p_id: b.dataset.done })); });
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-pax]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        say("Saving…"); after(rpc("set_passenger_status", { p_id: b.dataset.pax, p_status: b.dataset.st }));
      });
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-cancelbk]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!window.confirm("Cancel this whole booking? The refund is worked out from your Cancellation & Refund Rules.")) return;
        say("Cancelling…");
        after(rpc("cancel_booking", { p_id: b.dataset.cancelbk, p_reason: "Cancelled at the counter" }).then(function (res) {
          detail.paxId = null; detail.paxExtra = null;
          return res;
        }));
      });
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-markpaid]"), function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var cell = b.closest(".plx-c-pay, .plx-pay-cell");
        var listMeth = cell && cell.querySelector(".plx-list-meth");
        var method = (listMeth && listMeth.value) || ($("pxPayMethod") && $("pxPayMethod").value) || null;
        b.disabled = true;
        say("Recording payment…");
        after(markBookingPaid(b.dataset.markpaid, method).then(function (res) {
          if (detail.paxId && res) {
            detail.paxExtra = Object.assign({}, detail.paxExtra || {}, {
              payment_status: res.payment_status,
              paid_amount: res.paid_amount,
              payment_method: res.payment_method,
              fare_total: res.fare_total,
              _loading: false,
              _err: false
            });
          }
          return res;
        }, function (err) {
          b.disabled = false;
          throw err;
        }));
      });
    });
    if ($("bPax")) { paxRow(); $("bAddPax").addEventListener("click", paxRow); }
    if ($("bSave")) $("bSave").addEventListener("click", function () {
      var pax = [].map.call($("bPax").querySelectorAll(".ops-paxin"), function (row) {
        var o = {};
        [].forEach.call(row.querySelectorAll("[data-f]"), function (i) { if (i.value.trim() !== "") o[i.dataset.f] = i.value.trim(); });
        return o;
      }).filter(function (o) { return o.full_name; });
      if (!pax.length) { say("Add at least one passenger name.", "err"); return; }
      var trip = trips.filter(function (x) { return x.id === id; })[0];
      if (opsOn("capacity") && trip) {
        var left = tripPaxLeft(trip);
        if (left != null && pax.length > left) { say("Only " + left + " seat" + (left === 1 ? "" : "s") + " left on this trip.", "err"); return; }
      }
      var nextBooked = (trip && trip.booked != null ? Number(trip.booked) : 0) + pax.length;
      var nextLoad = trip ? loadState(nextBooked, trip.capacity) : { level: "" };
      say("Saving booking…");
      after(rpc("create_booking", {
        p_company: company.id, p_trip: id,
        p_booking: { contact_name: $("bName").value.trim() || pax[0].full_name, contact_phone: $("bPhone").value.trim(), source: "Manual",
                     status: "Pending", paid_amount: $("bPaid").value || 0, payment_method: $("bMethod").value || null },
        p_passengers: pax
      }).then(function (res) {
        detail.addPax = false;
        var boat = (trip && (trip.vessel || trip.vesselCode)) || "Vessel";
        if (nextLoad.level === "full") boardToast(boat + " is now full.");
        else if (nextLoad.level === "almost") boardToast(boat + " is almost full.");
        return res;
      }));
    });
    [].forEach.call($("modalCard").querySelectorAll("[data-uncrew]"), function (b) {
      b.addEventListener("click", function () {
        after(db.from("trip_crew").delete().eq("trip_id", id).eq("user_id", b.dataset.uncrew).then(function (res) { if (res.error) throw new Error(res.error.message); }));
      });
    });
    if ($("cwAdd")) $("cwAdd").addEventListener("click", function () {
      if (!$("cwUser").value) { say("Choose a person.", "err"); return; }
      after(db.from("trip_crew").insert({ trip_id: id, company_id: company.id, user_id: $("cwUser").value, role: $("cwRole").value })
        .then(function (res) { if (res.error) throw new Error(res.error.message); }));
    });
    if ($("cwAuto")) $("cwAuto").addEventListener("click", function () {
      say("Checking the roster…");
      after(rpc("assign_trip_crew", { p_company: company.id }));
    });
  }

  function openTask(taskId) {
    var x = queue.filter(function (k) { return k.id === taskId; })[0];
    if (!x) return;
    openModal('<h2>' + esc(x.title) + '</h2><p class="note">' + esc(x.sub || "") + '</p><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Close</button>' +
      (canOps ? '<button type="button" class="ghost" id="kSkip">Dismiss</button><button type="button" class="save" id="kDone">Mark done</button>' : "") + '</div>');
    function fin(ok) {
      rpc("finish_dispatch_task", { p_id: taskId, p_done: ok }).then(function () { closeModal(); reload(); }, function (e) { say(e.message, "err"); });
    }
    if ($("kDone")) $("kDone").addEventListener("click", function () { fin(true); });
    if ($("kSkip")) $("kSkip").addEventListener("click", function () { fin(false); });
  }

  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  function openModal(html, tripFull, paxOnly) {
    var isNtx = tripFull === "ntx" || tripFull === "apx"; // Cursor 2026-10-27: Add New Trip + Add Passengers wizards.
    $("modal").classList.toggle("is-trip", !!tripFull);
    document.documentElement.classList.toggle("ops-trip-open", !!tripFull);
    document.body.classList.toggle("ops-trip-open", !!tripFull);
    $("modalCard").className = isNtx
      ? ("modal-card ntx" + (tripFull === "apx" ? " apx" : ""))
      : tripFull
        ? ("modal-card ops-detail tdx" + (paxOnly ? " is-pax" : ""))
        : "modal-card sch-modal";
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;
    var f = !tripFull && $("modalCard").querySelector("input,select,textarea");
    if (f) f.focus();
  }
  function closeModal() {
    destroyTrackMap();
    detail.seatPicker = null;
    closeSeatPopup();
    $("modal").hidden = true;
    $("modal").classList.remove("is-trip");
    document.documentElement.classList.remove("ops-trip-open");
    document.body.classList.remove("ops-trip-open");
    $("modalCard").className = "modal-card";
    $("modalCard").innerHTML = "";
  }

  function clearDay() { dayF = ""; render(); }
  function boardToast(msg, err) {
    var el = document.createElement("p");
    el.className = "msg" + (err ? " err" : "");
    el.textContent = msg;
    var host = document.querySelector(".ops-main");
    if (host) { host.insertBefore(el, host.firstChild.nextSibling); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4000); }
  }
  // Error from an action on one trip: show it on that trip's card(s) — the board row and/or the Crew tab card —
  // instead of a page-level toast, so it's obvious which trip failed. Falls back to boardToast if no card is on screen.
  function cardError(tripId, msg) {
    // Scoped to actual trip cards only — data-trip is reused on small buttons (Open, Next departure, Under way) that can't host a message.
    var hosts = document.querySelectorAll('.ops-row[data-trip="' + tripId + '"], [data-trip-card="' + tripId + '"]');
    if (!hosts.length) { boardToast(msg, true); return; }
    [].forEach.call(hosts, function (host) {
      var old = host.querySelector(".ops-card-err");
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var el = document.createElement("p");
      el.className = "ops-card-err";
      el.textContent = msg;
      host.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 6000);
    });
  }
  function bind() {
    [].forEach.call(document.querySelectorAll("#ops [data-tab]"), function (b) {
      b.addEventListener("click", function () { tab = b.dataset.tab; render(); });
    });
    if ($("opsHomeDay")) {
      bindPicker($("opsHomeDay"));
      $("opsHomeDay").addEventListener("change", function () {
        var day = $("opsHomeDay").value || todayIso();
        viewDay = day === todayIso() ? "" : day;
        if (!dayLoaded(viewDayIso())) { destroyLiveMap(); $("ops").innerHTML = '<p class="msg">Loading…</p>'; reload(); return; }
        render();
      });
    }
    if ($("opsDay")) $("opsDay").addEventListener("change", function () {
      dayF = $("opsDay").value || "";
      if (dayF && tab !== "crew") {
        var today = todayIso();
        if (dayF === today) tab = "today";
        else if (dayF > today) tab = "upcoming";
      }
      if (dayF && !dayLoaded(dayF)) { destroyLiveMap(); $("ops").innerHTML = '<p class="msg">Loading…</p>'; reload(); return; }
      render();
    });
    if ($("clearDay")) $("clearDay").addEventListener("click", clearDay);
    if ($("clearDayTop")) $("clearDayTop").addEventListener("click", clearDay);
    if ($("opsStatus")) $("opsStatus").addEventListener("change", function () { statusF = $("opsStatus").value; render(); });
    if ($("opsRoute")) $("opsRoute").addEventListener("change", function () { routeF = $("opsRoute").value; render(); });
    if ($("opsVessel")) $("opsVessel").addEventListener("change", function () { vesselF = $("opsVessel").value; render(); });
    if ($("opsQ")) $("opsQ").addEventListener("input", function () {
      q = $("opsQ").value.trim(); render();
      var i = $("opsQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
    });
    bindHomeWx();
    [].forEach.call(document.querySelectorAll("#ops [data-map-base]"), function (b) {
      b.addEventListener("click", function () { applyLiveMapBase(b.dataset.mapBase); });
    });
    if ($("opsGoBoard")) $("opsGoBoard").addEventListener("click", function () { dayF = viewDay; location.hash = "board"; });
    if ($("opsGoBoardEmpty")) $("opsGoBoardEmpty").addEventListener("click", function () { dayF = viewDay; location.hash = "board"; });
    if ($("opsGoHome")) $("opsGoHome").addEventListener("click", function () { location.hash = ""; });
    if ($("opsNew")) $("opsNew").addEventListener("click", openNewTrip);
    if ($("emptyNew")) $("emptyNew").addEventListener("click", openNewTrip);
    if ($("opsAssign")) $("opsAssign").addEventListener("click", function () { openAssign(null); });
    if ($("opsAddPax")) $("opsAddPax").addEventListener("click", openAddPaxPicker);
    [].forEach.call(document.querySelectorAll("#ops [data-assign]"), function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); openAssign(b.dataset.assign); });
    });
    [].forEach.call(document.querySelectorAll("#ops [data-unassign]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        db.from("trips").update({ vessel_id: null }).eq("id", b.dataset.unassign).then(function (res) {
          if (res.error) { cardError(b.dataset.unassign, res.error.message); return; }
          boardToast("Vessel removed.");
          reload();
        });
      });
    });
    if ($("vesselCrewNeeds")) $("vesselCrewNeeds").addEventListener("click", function () { window.VeyoraVesselCrew.open({ db: db, company: company, onSaved: reload }); });
    if ($("crewAutoAll") && canOps) {
      $("crewAutoAll").addEventListener("click", function () {
        boardToast("Filling empty crew places from the roster…");
        rpc("assign_trip_crew", { p_company: company.id }).then(function () { return reload(); }, function (e) { boardToast(e.message, true); });
      });
    }
    [].forEach.call(document.querySelectorAll("#ops [data-captain-trip]"), function (sel) {
      sel.addEventListener("change", function () {
        var tid = sel.dataset.captainTrip;
        db.from("trips").update({ captain_id: sel.value || null }).eq("id", tid).then(function (res) {
          if (res.error) { cardError(tid, res.error.message); return; }
          boardToast("Captain updated");
          reload();
        });
      });
    });
    [].forEach.call(document.querySelectorAll("#ops [data-board-add]"), function (btn) {
      btn.addEventListener("click", function () {
        var tid = btn.dataset.boardAdd;
        var user = document.querySelector('[data-add-user="' + tid + '"]');
        var role = document.querySelector('[data-add-role="' + tid + '"]');
        if (!user || !user.value) { cardError(tid, "Choose a person first."); return; }
        db.from("trip_crew").insert({ trip_id: tid, company_id: company.id, user_id: user.value, role: (role && role.value) || "Crew" })
          .then(function (res) {
            if (res.error) { cardError(tid, res.error.message); return; }
            boardToast("Crew member added");
            reload();
          });
      });
    });
    [].forEach.call(document.querySelectorAll("#ops [data-board-uncrew]"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        db.from("trip_crew").delete().eq("trip_id", btn.dataset.boardUncrew).eq("user_id", btn.dataset.uid).then(function (res) {
          if (res.error) { cardError(btn.dataset.boardUncrew, res.error.message); return; }
          boardToast("Removed from trip");
          reload();
        });
      });
    });
    [].forEach.call(document.querySelectorAll("#ops [data-trip]"), function (b) {
      function go() { openTrip(b.dataset.trip, b.dataset.opentab || null, b.dataset.openadd === "1"); }
      b.addEventListener("click", function (e) { e.stopPropagation(); go(); });
      b.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
    [].forEach.call(document.querySelectorAll("#ops [data-task]"), function (b) {
      function go() { openTask(b.dataset.task); }
      b.addEventListener("click", go);
      b.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
  }

  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("modal").hidden) closeModal();
  });
  window.addEventListener("hashchange", function () {
    if (!company) return;
    if (!$("modal").hidden) closeModal();
    pageView = readPageView();
    render();
    window.scrollTo(0, 0);
  });

  window.VeyoraShell.start({
    active: "Operations",
    onCompany: function (c, info) {
      company = c;
      canOps = !!(info.canAll || info.canOps || info.isPlatform || info.isAdmin || info.myRole === "operations");
      // Claude 2026-10-27: arrivals.js (GPS arrival detection + Harbours) needs the company and a way to open a trip.
      window.VeyoraOps = { company: c, canOps: canOps, openTrip: function (id, tabSel) { openTrip(id, tabSel); }, reload: reload };
      document.dispatchEvent(new CustomEvent("veyora:ops-company"));
      pageView = readPageView();
      destroyLiveMap();
      $("ops").innerHTML = '<p class="msg">Loading…</p>';
      reload();
      // The database moves trips on by the clock every minute; refresh the board to match (not while a window is open).
      setInterval(function () { if ($("modal").hidden && !document.hidden) reload(); }, 60000);
      // Countdowns tick every 15 seconds without redrawing the board.
      setInterval(function () { [].forEach.call(document.querySelectorAll("[data-until]"), function (el) { if (el.dataset.until) el.textContent = (el.dataset.prefix || "") + untilText(Number(el.dataset.until) - Date.now()); }); }, 15000);
      setInterval(function () { if ($("opsClock")) $("opsClock").textContent = clockLabel(); }, 1000);
      if (window.VeyoraTip) window.VeyoraTip("ops4", [
        "**Operations** is the live view of today’s trips and fleet. The map opens on a free satellite view of the Maldives.",
        "Open **View All** on Today’s Schedule for the full dispatch board — assign vessels, crew, boarding and delays.",
        "**Delayed** is only set when you mark it yourself with a reason — never automatically."
      ]);
    },
    onNone: function () { $("ops").innerHTML = '<section class="dash-card"><h2>No company yet</h2><p class="note">Ask your administrator for an invite.</p></section>'; },
    onError: function (err) { $("ops").innerHTML = '<section class="dash-card"><h2>Could not load Operations</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
