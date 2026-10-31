/* Schedules: Fixed / Promotional / Temporary (+ company kinds).
   Fixed = weekdays + multiple daily depart times → one schedule_templates row per time, then generate_trips.
   Page: schedules.html
   Cursor 2026-10-23: redesign to mock layout (day strip, KPIs, rich rows, sidebar compose). */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var company = null, canPlan = false;
  var view = "daily", selected = null, calMonth = null, typeF = "", routeF = "", vesselF = "", searchQ = "";
  var loadedFrom = "", loadedTo = ""; // Cursor 2026-10-27: calendar can open past months and fetch that window.
  var compose = null; // { kind, times } when New schedule panel is open
  var trips = [], sumData = { trips: 0, vessels: 0, routes: 0, crew: 0 };
  var routes = [], vessels = [];
  var DEFAULT_KINDS = ["Fixed", "Promotional", "Temporary", "Seasonal", "Charter"];
  var DOW = [{ n: 1, l: "Mon" }, { n: 2, l: "Tue" }, { n: 3, l: "Wed" }, { n: 4, l: "Thu" }, { n: 5, l: "Fri" }, { n: 6, l: "Sat" }, { n: 7, l: "Sun" }];

  function setting(key) { return company && company.settings ? company.settings[key] : undefined; }
  function scheduleKinds() {
    var saved = setting("5_schedule_types"), spec = window.VEYORA_DEFS && window.VEYORA_DEFS["Schedule Types"] || {};
    var rows = Array.isArray(saved) ? saved : (spec.def || DEFAULT_KINDS);
    var list = rows.map(function (r) { return typeof r === "string" ? r : r && r.name; }).filter(Boolean);
    return list.length ? list : DEFAULT_KINDS.slice();
  }
  function defaultWeekdays() {
    var od = setting("5_operating_days") || {};
    var map = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
    var out = [];
    Object.keys(map).forEach(function (k) { if (od[k] !== false) out.push(map[k]); });
    return out.length ? out : [1, 2, 3, 4, 5, 6, 7];
  }
  function horizonDays() {
    var r = setting("5_recurring_trip_rules") || {};
    var h = String(r.horizon || "30 days");
    var n = parseInt(h, 10);
    return n > 0 && n <= 90 ? n : 30;
  }
  function kindHint(k) {
    var m = {
      Fixed: "Recurring service — pick operating days and one or more daily departure times.",
      Promotional: "Special or marketed sailings (offers, events, limited fares).",
      Temporary: "Short-run or one-off cover (diversions, extra boats, peak cover).",
      Seasonal: "High / low season or holiday-period timetables.",
      Charter: "Private or charter sailings outside the public timetable."
    };
    return m[k] || "Company-defined schedule kind.";
  }
  function kindCls(k) {
    var s = String(k || "").toLowerCase();
    if (s.indexOf("promo") >= 0) return "kind-promo";
    if (s.indexOf("temp") >= 0) return "kind-temp";
    if (s.indexOf("season") >= 0) return "kind-season";
    if (s.indexOf("charter") >= 0) return "kind-charter";
    return "kind-fixed";
  }
  function isFixedKind(k) { return String(k || "").toLowerCase() === "fixed"; }
  // Cursor 2026-10-23: Promotional / Temporary / etc. replace Fixed sailings on the same route+day+time.
  function isOverrideKind(k) { return !isFixedKind(k); }
  function tripIsFixed(t) {
    return isFixedKind(t.kind) || !!t.template_id;
  }
  function tripIsOpen(t) {
    return ["Cancelled", "Arrived", "Completed"].indexOf(t.status) < 0;
  }

  function icon(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var I = {
    cal: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    upload: '<path d="M12 16V6M8 10l4-4 4 4M4 18h16"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M8 7v12h8V7"/>',
    dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    play: '<path d="M9 7l9 5-9 5V7z"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    boat: '<path d="M3 15l9 4 9-4M5 15V10l7-4 7 4v5"/>'
  };
  function initials(name) {
    return String(name || "?").split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
  }
  function statusMeta(st, reason) {
    var s = String(st || "Scheduled");
    var low = s.toLowerCase();
    if (low.indexOf("cancel") >= 0) return { label: "Cancelled", tone: "bad", dot: "bad" };
    if (low.indexOf("delay") >= 0) return { label: reason ? "Delayed " + reason : "Delayed", tone: "bad", dot: "bad" };
    if (low.indexOf("arriv") >= 0 || low.indexOf("complet") >= 0) return { label: s, tone: "mute", dot: "mute" };
    if (low.indexOf("board") >= 0 || low.indexOf("depart") >= 0 || low.indexOf("transit") >= 0 || low.indexOf("en route") >= 0)
      return { label: "On time", tone: "ok", dot: "ok" };
    if (low.indexOf("on time") >= 0) return { label: "On time", tone: "ok", dot: "ok" };
    return { label: "Scheduled", tone: "live", dot: "" };
  }
  function dayKpis(day) {
    var list = visibleTripsOnDay(day);
    var vset = {}, rset = {}, cset = {};
    list.forEach(function (t) {
      if (t.vessel_id) vset[t.vessel_id] = 1;
      else if (t.vessel || t.vessel_code) vset[t.vessel || t.vessel_code] = 1;
      if (t.route_id) rset[t.route_id] = 1;
      else if (t.route) rset[t.route] = 1;
      if (t.captain_id) cset[t.captain_id] = 1;
      else if (t.captain) cset[t.captain] = 1;
      (t.crew || []).forEach(function (c) {
        if (c.user_id) cset[c.user_id] = 1;
        else if (c.name) cset[c.name] = 1;
      });
    });
    var prev = trips.filter(function (t) { return dayOfTrip(t) === addDays(day, -1); }).length;
    var delta = list.length - prev;
    var vCount = Object.keys(vset).length;
    var fleet = vessels.length || 0;
    var vPct = fleet ? Math.round((vCount / fleet) * 100) : 0;
    return {
      trips: list.length,
      vessels: vCount,
      routes: Object.keys(rset).length,
      crew: Object.keys(cset).length,
      delta: delta,
      vPct: vPct,
      fleet: fleet
    };
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseIso(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayIso() { return iso(new Date()); }
  function addDays(s, n) { var d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
  function startOfWeek(s) {
    var d = parseIso(s), day = d.getDay();
    var monOffset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + monOffset);
    return iso(d);
  }
  function fmtDay(s) {
    var d = parseIso(s);
    return {
      dow: d.toLocaleDateString("en-GB", { weekday: "short" }),
      day: pad2(d.getDate()),
      mon: d.toLocaleDateString("en-GB", { month: "short" })
    };
  }
  function monthTitle(y, m) {
    return new Date(y, m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }
  function dayOfTrip(t) {
    var d = t.depart_at ? new Date(t.depart_at) : null;
    return d ? iso(d) : "";
  }
  function timeOfTrip(t) {
    if (!t.depart_at) return "—";
    var d = new Date(t.depart_at);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function chip(text, cls) {
    var s = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return '<span class="chip ' + (cls || "st-" + s) + '">' + esc(text) + '</span>';
  }
  function options(list, cur, blank, valKey, labKey) {
    return (blank != null ? '<option value="">' + esc(blank) + '</option>' : "") + list.map(function (p) {
      var v = typeof p === "object" ? p[valKey || "id"] : p;
      var t = typeof p === "object" ? p[labKey || "name"] : p;
      return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + '>' + esc(t) + '</option>';
    }).join("");
  }
  function rpc(name, args) {
    return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; });
  }
  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }

  function visibleTripsOnDay(day) {
    var dayTrips = trips.filter(function (t) { return dayOfTrip(t) === day && tripIsOpen(t); });
    var overridden = {};
    dayTrips.forEach(function (t) {
      if (!tripIsFixed(t) && isOverrideKind(t.kind)) {
        overridden[String(t.route_id || t.route) + "|" + timeOfTrip(t)] = true;
      }
    });
    return dayTrips.filter(function (t) {
      return !(tripIsFixed(t) && overridden[String(t.route_id || t.route) + "|" + timeOfTrip(t)]);
    });
  }

  function tripsForDay(day) {
    var q = String(searchQ || "").trim().toLowerCase();
    return visibleTripsOnDay(day).filter(function (t) {
      if (typeF && t.kind !== typeF) return false;
      if (routeF && String(t.route_id) !== String(routeF) && t.route !== routeF) return false;
      if (vesselF && String(t.vessel_id) !== String(vesselF)) return false;
      if (q) {
        var hay = [t.route, t.origin, t.destination, t.vessel, t.vessel_code, t.captain, t.kind, t.status, timeOfTrip(t)].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function findFixedToReplace(day, routeId, times) {
    var timeSet = {};
    (times || []).forEach(function (tm) { timeSet[String(tm).slice(0, 5)] = true; });
    return trips.filter(function (t) {
      if (!tripIsFixed(t) || !tripIsOpen(t)) return false;
      if (dayOfTrip(t) !== day) return false;
      if (String(t.route_id) !== String(routeId) && (!routeId || t.route !== routeId)) return false;
      return !!timeSet[timeOfTrip(t)];
    });
  }

  function replaceFixedSailings(list) {
    if (!list.length) return Promise.resolve({ deleted: 0, cancelled: 0 });
    var toCancel = list.filter(function (t) { return (Number(t.seats_booked) || 0) > 0; });
    var toDelete = list.filter(function (t) { return (Number(t.seats_booked) || 0) === 0; });
    var chain = toCancel.reduce(function (pr, t) {
      return pr.then(function () {
        return rpc("set_trip_status", {
          p_id: t.id,
          p_status: "Cancelled",
          p_reason: "Replaced by " + (compose && compose.kind ? compose.kind : "special") + " schedule"
        });
      });
    }, Promise.resolve());
    return chain.then(function () {
      if (!toDelete.length) return { deleted: 0, cancelled: toCancel.length };
      var ids = toDelete.map(function (t) { return t.id; });
      return db.from("trips").delete().in("id", ids).eq("company_id", company.id).then(function (del) {
        if (del.error) throw new Error(del.error.message);
        return { deleted: ids.length, cancelled: toCancel.length };
      });
    });
  }

  function weekStrip() {
    var start = startOfWeek(selected), html = "";
    for (var i = 0; i < 7; i++) {
      var day = addDays(start, i), f = fmtDay(day), on = day === selected;
      var n = visibleTripsOnDay(day).length;
      html += '<button type="button" class="sch-day' + (on ? " on" : "") + '" data-day="' + day + '">' +
        '<small>' + f.dow + " " + f.day + '</small><strong>' + n + '</strong><span>' + (n === 1 ? "trip" : "trips") + '</span></button>';
    }
    return html;
  }

  function calendar() {
    var y = calMonth.getFullYear(), m = calMonth.getMonth();
    var first = new Date(y, m, 1), start = new Date(first);
    var dow = (first.getDay() + 6) % 7;
    start.setDate(1 - dow);
    var cells = "", today = todayIso();
    for (var i = 0; i < 42; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var id = iso(d), mute = d.getMonth() !== m;
      cells += '<button type="button" class="' + (id === selected ? "on" : "") + (id === today ? " today" : "") + (mute ? " muted" : "") + '" data-day="' + id + '">' + d.getDate() + '</button>';
    }
    return '<div class="sch-cal"><div class="cal-head"><strong>' + esc(monthTitle(y, m)) + '</strong><div class="cal-nav">' +
      '<button type="button" id="calPrev" aria-label="Previous month">' + icon(I.left) + '</button>' +
      '<button type="button" id="calNext" aria-label="Next month">' + icon(I.right) + '</button></div></div>' +
      '<div class="cal-grid"><span class="dow">Mo</span><span class="dow">Tu</span><span class="dow">We</span><span class="dow">Th</span><span class="dow">Fr</span><span class="dow">Sa</span><span class="dow">Su</span>' + cells + '</div></div>';
  }

  function tripRow(t) {
    var origin = t.origin || "";
    var dest = t.destination || "";
    var routeName = t.route || ((origin && dest) ? origin + " → " + dest : (origin || dest || "Route"));
    var jetty = (origin && dest) ? (origin + " jetty → " + dest + " jetty") : (t.note || "—");
    var vName = t.vessel || t.vessel_code || "Unassigned";
    var vCode = t.vessel_code && t.vessel && t.vessel_code !== t.vessel ? t.vessel_code : "";
    var booked = Number(t.seats_booked) || 0;
    var total = Number(t.seats_total) || 0;
    var pct = total > 0 ? Math.min(100, Math.round((booked / total) * 100)) : 0;
    var loadCls = pct >= 90 ? "hot" : (pct >= 70 ? "warm" : "");
    var sm = statusMeta(t.status, t.status_reason);
    var repeating = !!t.template_id;
    var delLabel = repeating ? "Delete all days" : (booked > 0 ? "Cancel sailing" : "Delete sailing");
    var people = [];
    if (t.captain) people.push({ name: t.captain });
    (t.crew || []).forEach(function (c) {
      if (c.name && (!t.captain || c.name !== t.captain)) people.push(c);
    });
    var show = people.slice(0, 3);
    var extra = people.length - show.length;
    var avs = show.map(function (p) {
      return '<span class="av" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>';
    }).join("") + (extra > 0 ? '<span class="av more">+' + extra + '</span>' : (people.length ? "" : '<span class="av more">—</span>'));

    // Cursor 2026-10-23: rich row — timeline, vessel, kind tag, load bar, crew, menu (delete all for Fixed).
    return '<article class="sch-row" data-trip="' + esc(t.id) + '">' +
      '<div class="sch-row-when"><div class="sch-rail"><span class="sch-dot ' + sm.dot + '"></span></div>' +
        '<div><strong>' + esc(timeOfTrip(t)) + '</strong><small class="' + sm.tone + '">' + esc(sm.label) + '</small></div></div>' +
      '<div class="sch-row-route"><strong>' + esc(routeName) + '</strong><small>' + esc(jetty) + '</small></div>' +
      '<div class="sch-row-vessel"><span class="sch-vthumb">' + icon(I.boat) + '</span>' +
        '<div><strong>' + esc(vName) + '</strong><small>' + esc(vCode || "Vessel") + '</small></div></div>' +
      '<span class="sch-kind-tag ' + kindCls(t.kind) + '">' + esc(t.kind || "Fixed") + '</span>' +
      '<div class="sch-row-load"><div class="sch-load-meta"><span>' + booked + ' / ' + (total || "—") + '</span></div>' +
        '<div class="sch-load-track"><span class="sch-load-fill ' + loadCls + '" style="width:' + pct + '%"></span></div></div>' +
      '<div class="sch-row-crew"><div class="sch-avs">' + avs + '</div></div>' +
      '<div class="sch-row-acts">' +
        '<a class="sch-go" href="operations.html" title="Open Operations">' + icon(I.play) + '</a>' +
        (canPlan
          ? '<button type="button" class="sch-menu-btn" data-menu-trip="' + esc(t.id) + '" aria-label="Actions">' + icon(I.dots) + '</button>' +
            '<div class="sch-menu" hidden data-menu-for="' + esc(t.id) + '">' +
              '<button type="button" data-edit-trip="' + esc(t.id) + '">Edit sailing</button>' +
              '<button type="button" class="danger" data-del-trip="' + esc(t.id) + '"' +
                (booked > 0 ? ' data-has-bookings="1"' : "") +
                (repeating ? ' data-template="' + esc(t.template_id) + '"' : "") + '>' +
                icon(I.trash) + ' ' + esc(delLabel) + '</button>' +
            '</div>'
          : "") +
      '</div></article>';
  }
  function flash(msg, kind) {
    var el = $("schFlash");
    if (!el) return;
    el.hidden = false;
    el.className = "msg sch-flash " + (kind || "");
    el.textContent = msg;
  }
  function tripOpen(st) {
    return ["Cancelled", "Arrived", "Completed"].indexOf(st) < 0;
  }
  function companyZone() { return (company && company.timezone) || "Indian/Maldives"; }
  function dayInZone(isoStamp, tz) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz || companyZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoStamp));
    } catch (e) { return String(isoStamp || "").slice(0, 10); }
  }
  function wallTime(day, hm, tz) {
    tz = tz || companyZone();
    var target = day + "T" + hm + ":00";
    var guess = new Date(target + "Z");
    var fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    function stamp(d) {
      var p = {};
      fmt.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      var hour = p.hour === "24" ? "00" : p.hour;
      return p.year + "-" + p.month + "-" + p.day + "T" + hour + ":" + p.minute + ":" + p.second;
    }
    var shown = stamp(guess);
    return new Date(guess.getTime() + (new Date(target + "Z") - new Date(shown + "Z")));
  }
  function timeInZone(isoStamp, tz) {
    try {
      var p = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: tz || companyZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(isoStamp)).forEach(function (x) { p[x.type] = x.value; });
      return (p.hour === "24" ? "00" : p.hour) + ":" + p.minute;
    } catch (e) { return timeOfTrip({ depart_at: isoStamp }); }
  }
  function openEdit(id) {
    var t = trips.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    if (!tripOpen(t.status)) { flash("This sailing is already " + t.status.toLowerCase() + ".", "err"); return; }
    var day = dayInZone(t.depart_at);
    var time = timeInZone(t.depart_at);
    var routeOpts = routes.slice();
    if (t.route_id && !routeOpts.some(function (r) { return r.id === t.route_id; })) routeOpts.unshift({ id: t.route_id, name: t.route || "Current route" });
    openModal('<h2>Edit sailing</h2><p class="note">' + esc(t.route || "Schedule") + (t.template_id ? " · part of a repeating schedule" : "") + '</p>' +
      '<div class="cards">' +
      '<div class="fld"><label for="eRoute">Route</label><select id="eRoute">' + options(routeOpts, t.route_id, null, "id", "name") + '</select></div>' +
      '<div class="fld"><label for="eVessel">Vessel</label><select id="eVessel">' + options([{ id: "", name: "Unassigned" }].concat(vessels.map(function (v) { return { id: v.id, name: (v.code ? v.code + " · " : "") + v.name }; })), t.vessel_id || "", null, "id", "name") + '</select></div>' +
      '<div class="fld"><label for="eDay">Date</label><input id="eDay" type="date" value="' + esc(day) + '"></div>' +
      '<div class="fld"><label for="eTime">Departure</label><input id="eTime" type="time" value="' + esc(time === "—" ? "08:00" : time) + '"></div>' +
      (t.template_id ? '<div class="fld full"><label class="check"><input type="checkbox" id="eAll"> Also change every future empty day of this repeating schedule</label></div>' : "") +
      '</div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="eGo">Save</button></div>');
    $("eGo").addEventListener("click", function () { saveEdit(t); });
  }
  function saveEdit(t) {
    var routeId = $("eRoute").value;
    var vesselId = $("eVessel").value || null;
    var day = $("eDay").value;
    var time = ($("eTime").value || "").slice(0, 5);
    var all = $("eAll") && $("eAll").checked;
    if (!routeId) { say("Select a route.", "err"); return; }
    if (!day || !/^\d{2}:\d{2}$/.test(time)) { say("Pick a date and a departure time.", "err"); return; }
    var depart = wallTime(day, time);
    if (isNaN(depart.getTime())) { say("That date and time are not valid.", "err"); return; }
    var patch = { route_id: routeId, vessel_id: vesselId, depart_at: depart.toISOString() };
    if (t.arrive_at) {
      var delta = depart.getTime() - new Date(t.depart_at).getTime();
      patch.arrive_at = new Date(new Date(t.arrive_at).getTime() + delta).toISOString();
    }
    say("Saving…");
    db.from("trips").update(patch).eq("id", t.id).eq("company_id", company.id).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      if (!all || !t.template_id) return { updated: 1 };
      return db.from("schedule_templates").update({
        route_id: routeId, vessel_id: vesselId, depart_time: time + ":00"
      }).eq("id", t.template_id).eq("company_id", company.id).then(function (tr) {
        if (tr.error) throw new Error(tr.error.message);
        return db.from("trips").select("id,depart_at,arrive_at,seats_booked,status").eq("template_id", t.template_id).eq("company_id", company.id);
      }).then(function (list) {
        if (list.error) throw new Error(list.error.message);
        var today = dayInZone(new Date().toISOString());
        var future = (list.data || []).filter(function (row) {
          return row.id !== t.id && Number(row.seats_booked) === 0 && row.status === "Scheduled" && dayInZone(row.depart_at) >= today;
        });
        return future.reduce(function (pr, row) {
          return pr.then(function () {
            var rowDay = dayInZone(row.depart_at);
            var next = wallTime(rowDay, time);
            var rowPatch = { route_id: routeId, vessel_id: vesselId, depart_at: next.toISOString() };
            if (row.arrive_at) {
              var gap = new Date(row.arrive_at).getTime() - new Date(row.depart_at).getTime();
              rowPatch.arrive_at = new Date(next.getTime() + gap).toISOString();
            }
            return db.from("trips").update(rowPatch).eq("id", row.id).eq("company_id", company.id).then(function (u) {
              if (u.error) throw new Error(u.error.message);
            });
          });
        }, Promise.resolve()).then(function () { return { updated: 1 + future.length }; });
      });
    }).then(function (stats) {
      closeModal();
      flash("Saved" + (stats && stats.updated > 1 ? " · " + stats.updated + " sailings updated" : "") + ".", "ok");
      return loadData().then(render);
    }).catch(function (e) { say(e.message || "Could not save.", "err"); });
  }
  function deleteSchedule(btn) {
    var id = btn.dataset.delTrip;
    var hasBookings = btn.dataset.hasBookings === "1";
    var templateId = btn.dataset.template || null;
    var trip = trips.filter(function (t) { return t.id === id; })[0];
    var label = trip ? (timeOfTrip(trip) + " · " + (trip.route || trip.code || "trip")) : "this schedule";

    // Repeating Fixed (or any template): remove the schedule on every day.
    if (templateId) {
      if (!window.confirm("Delete this schedule for every day?\n\n" + label + "\n\nEmpty sailings are removed. Sailings with bookings are cancelled (refunds follow your rules). The repeating template is deleted so it will not come back.")) return;
      btn.disabled = true;
      flash("Deleting schedule for all days…");
      db.from("schedule_templates").update({ active: false }).eq("id", templateId).eq("company_id", company.id)
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return db.from("trips").select("id, seats_booked, status").eq("template_id", templateId).eq("company_id", company.id);
        })
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          var list = res.data || [];
          var toCancel = list.filter(function (t) { return Number(t.seats_booked) > 0 && tripOpen(t.status); });
          var toDelete = list.filter(function (t) { return Number(t.seats_booked) === 0; });
          var chain = toCancel.reduce(function (pr, t) {
            return pr.then(function () {
              return rpc("set_trip_status", { p_id: t.id, p_status: "Cancelled", p_reason: "Schedule removed from timetable" });
            });
          }, Promise.resolve());
          return chain.then(function () {
            if (!toDelete.length) return { cancelled: toCancel.length, deleted: 0 };
            var ids = toDelete.map(function (t) { return t.id; });
            return db.from("trips").delete().in("id", ids).eq("company_id", company.id).then(function (del) {
              if (del.error) throw new Error(del.error.message);
              return { cancelled: toCancel.length, deleted: ids.length };
            });
          });
        })
        .then(function (stats) {
          return db.from("schedule_templates").delete().eq("id", templateId).eq("company_id", company.id).then(function (res) {
            if (res.error) throw new Error(res.error.message);
            return stats;
          });
        })
        .then(function (stats) {
          var bits = [];
          if (stats.deleted) bits.push(stats.deleted + " day" + (stats.deleted === 1 ? "" : "s") + " deleted");
          if (stats.cancelled) bits.push(stats.cancelled + " with bookings cancelled");
          flash("Schedule removed for every day" + (bits.length ? " — " + bits.join(", ") : "") + ".", "ok");
          return loadData().then(render);
        }, function (e) {
          btn.disabled = false;
          flash(e.message || "Could not delete schedule.", "err");
        });
      return;
    }

    // One-off Promotional / Temporary / etc.
    if (hasBookings) {
      if (!window.confirm("This sailing has bookings (" + label + "). Cancel it instead? Passengers are refunded per your Cancellation & Refund Rules.")) return;
      btn.disabled = true;
      flash("Cancelling…");
      rpc("set_trip_status", { p_id: id, p_status: "Cancelled", p_reason: "Removed from timetable" }).then(function () {
        flash("Sailing cancelled.", "ok");
        return loadData().then(render);
      }, function (e) {
        btn.disabled = false;
        flash(e.message || "Could not cancel.", "err");
      });
      return;
    }

    if (!window.confirm("Delete " + label + " from the timetable? This cannot be undone.")) return;
    btn.disabled = true;
    flash("Deleting…");
    db.from("trips").delete().eq("id", id).eq("company_id", company.id).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      flash("Schedule deleted.", "ok");
      return loadData().then(render);
    }, function (e) {
      btn.disabled = false;
      var msg = e.message || "Could not delete.";
      if (/foreign key|restrict|referenced/i.test(msg)) {
        flash("This sailing still has linked bookings. Cancel it instead of deleting.", "err");
      } else {
        flash(msg, "err");
      }
    });
  }

  function emptyBlock(dayLabel) {
    return '<div class="sch-empty"><span class="ic">' + icon(I.cal) + '</span>' +
      '<h3>No schedules for ' + esc(dayLabel) + '</h3>' +
      '<p>Create a Fixed timetable with daily departure times, or add a Promotional / Temporary sailing.</p>' +
      '<div class="acts">' +
        (canPlan ? '<button type="button" class="primary-btn" id="emptyNew">' + icon(I.plus) + ' New schedule</button><button type="button" class="btn-soft" id="emptyImport">Import from template</button>' : '<span class="note">Ask an administrator when planning opens.</span>') +
      '</div></div>';
  }

  function dateLabelShort(day) {
    return parseIso(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function dateLabelLong(day) {
    return parseIso(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function kpisHtml(k) {
    var deltaTxt = k.delta === 0 ? "0 vs yesterday" : ((k.delta > 0 ? "↑ " : "↓ ") + Math.abs(k.delta) + " vs yesterday");
    var deltaCls = k.delta > 0 ? "up" : "";
    return '<div class="sch-kpis">' +
      '<div class="sch-kpi"><small>Total trips</small><strong>' + k.trips + '</strong><span class="trend ' + deltaCls + '">' + deltaTxt + '</span></div>' +
      '<div class="sch-kpi"><small>Vessels in use</small><strong>' + k.vessels + '</strong><span class="trend">' + (k.fleet ? (k.vPct + "% of " + k.fleet) : "—") + '</span></div>' +
      '<div class="sch-kpi"><small>Routes</small><strong>' + k.routes + '</strong><span class="trend">Active today</span></div>' +
      '<div class="sch-kpi"><small>Crew assigned</small><strong>' + k.crew + '</strong><span class="trend' + (k.crew ? "" : " warn") + '">' + (k.crew ? "On duty" : "None yet") + '</span></div>' +
      '</div>';
  }

  function toolsPanelHtml() {
    return '<div class="sch-tools-card"><h2>Planning tools</h2><p class="note">Duplicate a day or import rows.</p>' +
      '<div class="sch-tools">' +
        '<button type="button" class="sch-tool-dup"' + (canPlan ? "" : " disabled") + '>' + icon(I.copy) + ' Duplicate day</button>' +
        '<button type="button" class="sch-tool-imp"' + (canPlan ? "" : " disabled") + '>' + icon(I.upload) + ' Import from template</button>' +
      '</div></div>';
  }

  function render() {
    if ((location.hash || "").indexOf("#settings") === 0) {
      $("schActions").innerHTML = '<a class="btn-soft" href="#">Timetable</a>';
      $("sch").innerHTML = '<section class="dash-card" id="pageSettings"></section>';
      if (window.PageSettings) window.PageSettings.mount($("pageSettings"), {
        area: "schedules", pill: (location.hash || "").slice(1).split("/")[1] || "", esc: esc,
        company: function () { return company; }, db: db, rpc: rpc, canEdit: canPlan
      });
      return;
    }
    if (!selected) selected = todayIso();
    if (!calMonth) { var d0 = parseIso(selected); calMonth = new Date(d0.getFullYear(), d0.getMonth(), 1); }
    var dayLabel = dateLabelLong(selected);
    var dayTrips = tripsForDay(selected);
    var kinds = scheduleKinds();
    var k = dayKpis(selected);

    $("schActions").innerHTML =
      '<div class="sch-toolbar">' +
        '<div class="sch-date-nav">' +
          '<button type="button" class="sch-cal-btn" id="schJumpCal" aria-label="Focus calendar">' + icon(I.cal) + '</button>' +
          '<button type="button" class="sch-nav-btn" id="schPrevDay" aria-label="Previous day">' + icon(I.left) + '</button>' +
          '<button type="button" class="sch-date-label" id="schDateLbl">' + esc(dateLabelShort(selected)) + '</button>' +
          '<button type="button" class="sch-nav-btn" id="schNextDay" aria-label="Next day">' + icon(I.right) + '</button>' +
        '</div>' +
        (canPlan
          ? '<div class="sch-new-wrap"><a class="btn-soft" href="#settings">Settings</a><button type="button" class="primary-btn" id="schNew">' + icon(I.plus) + ' New schedule</button></div>'
          : '<a class="btn-soft" href="#settings">Settings</a>') +
      '</div>';

    $("sch").innerHTML =
      '<div class="sch-layout"><section class="sch-main">' +
        '<div class="sch-tabs">' +
          [["daily", "Daily view"], ["weekly", "Weekly view"], ["route", "Route view"], ["vessel", "Vessel view"]].map(function (t) {
            var ready = t[0] === "daily";
            return '<button type="button" class="' + (view === t[0] ? "on" : "") + '" data-view="' + t[0] + '"' + (ready ? "" : " disabled title=\"Coming soon\"") + '>' + t[1] + '</button>';
          }).join("") +
        '</div>' +
        '<div class="sch-days">' + weekStrip() + '</div>' +
        '<div class="sch-bar">' +
          '<div class="sch-filters">' +
            '<label class="fsearch">' + icon(I.search) + '<input type="search" id="schQ" placeholder="Search schedules…" aria-label="Search schedules" value="' + esc(searchQ) + '"></label>' +
            '<select id="schRoute" aria-label="Routes">' + options(routes.map(function (r) { return { id: r.id, name: r.name }; }), routeF, "All routes") + '</select>' +
            '<select id="schVessel" aria-label="Vessels">' + options(vessels.map(function (v) { return { id: v.id, name: (v.code ? v.code + " · " : "") + v.name }; }), vesselF, "All vessels") + '</select>' +
            '<select id="schType" aria-label="Schedule types">' + options(kinds, typeF, "All schedule types") + '</select>' +
            '<button type="button" class="sch-more" id="schMore" title="More filters">' + icon(I.filter) + ' More</button>' +
          '</div>' +
          kpisHtml(k) +
        '</div>' +
        '<div class="sch-list-head"><div><h2>' + esc(dayLabel) + '</h2><p class="note">' + dayTrips.length + ' sailing' + (dayTrips.length === 1 ? "" : "s") + ' shown</p></div>' +
          '<div class="sch-list-acts">' +
            '<button type="button" class="btn-soft sch-tool-dup"' + (canPlan ? "" : " disabled") + '>' + icon(I.copy) + ' Duplicate day</button>' +
            '<button type="button" class="btn-soft sch-tool-imp"' + (canPlan ? "" : " disabled") + '>' + icon(I.upload) + ' Import</button>' +
          '</div></div>' +
        '<p class="msg sch-flash" id="schFlash" hidden></p>' +
        (dayTrips.length ? '<div class="sch-list">' + dayTrips.map(tripRow).join("") + '</div>' : emptyBlock(dayLabel)) +
      '</section><aside class="sch-side" id="schSide">' +
        calendar() +
        toolsPanelHtml() +
      '</aside></div>';

    bind();
  }

  function timesListHtml(times) {
    return '<div class="sch-times" id="sTimes">' +
      '<div class="sch-times-head"><div><strong>Departure times</strong><p class="hint">Each time becomes its own sailing' + (isFixedKind(compose && compose.kind) ? " on every selected day" : "") + '.</p></div>' +
        '<button type="button" class="btn-soft" id="sAddTime">' + icon(I.plus) + ' Add time</button></div>' +
      '<ul id="sTimeList" class="sch-time-chips">' + times.map(function (tm, i) {
        return '<li class="sch-time-chip">' +
          '<span class="tm-ic">' + icon(I.cal) + '</span>' +
          '<input type="time" value="' + esc(tm) + '" data-ti="' + i + '" aria-label="Departure ' + (i + 1) + '">' +
          '<button type="button" class="ghost" data-rm="' + i + '" aria-label="Remove time">' + icon(I.x) + '</button></li>';
      }).join("") + '</ul></div>';
  }

  function fieldsHtml(kind, times, draft) {
    draft = draft || {};
    var wd = draft.weekdays || defaultWeekdays();
    if (isFixedKind(kind)) {
      return '<div class="sch-form-grid">' +
        '<div class="fld full"><label for="sName">Template name</label><input id="sName" maxlength="80" placeholder="e.g. Malé – Maafushi weekday" value="' + esc(draft.name || "") + '"></div>' +
        '<div class="fld"><label for="sRoute">Route</label><select id="sRoute">' + options(routes.map(function (r) { return { id: r.id, name: r.name + (r.code ? " (" + r.code + ")" : "") }; }), draft.routeId || "", "Select a route") + '</select></div>' +
        '<div class="fld"><label for="sVessel">Vessel <span class="opt">optional</span></label><select id="sVessel">' + options(vessels.map(function (v) { return { id: v.id, name: (v.code ? v.code + " · " : "") + v.name }; }), draft.vesselId || "", "Assign later") + '</select></div>' +
        '<div class="fld full"><label>Operating days</label><div class="sch-dows" id="sDows">' +
          DOW.map(function (d) {
            return '<label class="dow-chip"><input type="checkbox" value="' + d.n + '"' + (wd.indexOf(d.n) >= 0 ? " checked" : "") + '><span>' + d.l + '</span></label>';
          }).join("") +
        '</div></div>' +
        '<div class="fld full">' + timesListHtml(times) + '</div>' +
        '<div class="fld"><label for="sHorizon">Generate ahead</label><select id="sHorizon">' +
          [7, 14, 30, 60, 90].map(function (n) {
            var cur = draft.horizon != null ? Number(draft.horizon) : horizonDays();
            return '<option value="' + n + '"' + (n === cur ? " selected" : "") + '>' + n + ' days</option>';
          }).join("") +
        '</select></div>' +
        '<div class="fld"><label for="sNote">Note <span class="opt">optional</span></label><input id="sNote" maxlength="200" placeholder="Pier, fare band…" value="' + esc(draft.note || "") + '"></div>' +
        '</div>' +
        (routes.length ? "" : '<p class="hint sch-need-route">No routes yet — <button type="button" class="linkish" id="sNewRoute">add a route</button> first.</p>');
    }
    return '<div class="sch-form-grid">' +
      '<div class="fld"><label for="sDay">Date</label><input id="sDay" type="date" value="' + esc(draft.day || selected || todayIso()) + '"></div>' +
      '<div class="fld"><label for="sRoute">Route</label><select id="sRoute">' + options(routes.map(function (r) { return { id: r.id, name: r.name }; }), draft.routeId || "", "Select a route") + '</select></div>' +
      '<div class="fld"><label for="sVessel">Vessel <span class="opt">optional</span></label><select id="sVessel">' + options(vessels.map(function (v) { return { id: v.id, name: (v.code ? v.code + " · " : "") + v.name }; }), draft.vesselId || "", "Assign later") + '</select></div>' +
      '<div class="fld"><label for="sNote">Note <span class="opt">optional</span></label><input id="sNote" maxlength="200" placeholder="Promo code, diversion…" value="' + esc(draft.note || "") + '"></div>' +
      '<div class="fld full">' + timesListHtml(times) + '</div>' +
      '</div>';
  }

  function readDraftFromDom() {
    if (!compose) return;
    compose.times = readTimesFromDom();
    if (!compose.times.length) compose.times = ["08:00"];
    compose.name = ($("sName") && $("sName").value) || "";
    compose.routeId = ($("sRoute") && $("sRoute").value) || "";
    compose.vesselId = ($("sVessel") && $("sVessel").value) || "";
    compose.note = ($("sNote") && $("sNote").value) || "";
    compose.horizon = ($("sHorizon") && $("sHorizon").value) || String(horizonDays());
    compose.day = ($("sDay") && $("sDay").value) || (selected || todayIso());
    compose.weekdays = [].map.call(document.querySelectorAll("#sDows input:checked"), function (c) { return Number(c.value); });
  }
  function readTimesFromDom() {
    return [].map.call(document.querySelectorAll("#sTimeList input[type=time]"), function (inp) { return inp.value; }).filter(Boolean);
  }

  function liveSummaryHtml() {
    if (!compose) return "";
    var kind = compose.kind;
    var times = compose.times || [];
    var route = routes.filter(function (r) { return r.id === compose.routeId; })[0];
    var vessel = vessels.filter(function (v) { return v.id === compose.vesselId; })[0];
    var bits = [];
    bits.push('<span class="sum-pill ' + kindCls(kind) + '">' + esc(kind) + '</span>');
    bits.push('<span>' + (route ? esc(route.name) : "Pick a route") + '</span>');
    if (isFixedKind(kind)) {
      var n = (compose.weekdays && compose.weekdays.length) || defaultWeekdays().length;
      bits.push('<span>' + n + ' day' + (n === 1 ? "" : "s") + '/week</span>');
      bits.push('<span>' + times.length + ' time' + (times.length === 1 ? "" : "s") + '</span>');
      bits.push('<span>' + (compose.horizon || horizonDays()) + 'd ahead</span>');
    } else {
      bits.push('<span>' + esc(compose.day || selected || todayIso()) + '</span>');
      bits.push('<span>' + times.length + ' departure' + (times.length === 1 ? "" : "s") + '</span>');
    }
    if (vessel) bits.push('<span>' + esc(vessel.name) + '</span>');
    return '<div class="sch-live-sum" id="schLiveSum">' + bits.join('<i>·</i>') + '</div>';
  }

  function paintCreateModal() {
    if (!compose) return;
    var kinds = scheduleKinds();
    var chosen = compose.kind;
    var kindCards = kinds.map(function (k) {
      return '<button type="button" class="sch-kind-card ' + kindCls(k) + (k === chosen ? " on" : "") + '" data-kind="' + esc(k) + '" role="radio" aria-checked="' + (k === chosen) + '">' +
        '<span class="kc-dot"></span><strong>' + esc(k) + '</strong><small>' + esc(kindHint(k)) + '</small></button>';
    }).join("");

    openCreateModal(
      '<div class="sch-create">' +
        '<header class="sch-create-head">' +
          '<div class="sch-create-ic">' + icon(I.plus) + '</div>' +
          '<div><h2>New schedule</h2><p>Choose a type, set times, and generate sailings.</p></div>' +
          '<button type="button" class="sch-create-x" data-close aria-label="Close">' + icon(I.x) + '</button>' +
        '</header>' +
        '<div class="sch-create-body">' +
          '<p class="sch-sec-label">Schedule type</p>' +
          '<div class="sch-kind-grid" id="schKinds" role="radiogroup">' + kindCards + '</div>' +
          liveSummaryHtml() +
          '<div id="schFields" class="sch-create-fields">' + fieldsHtml(chosen, compose.times, compose) + '</div>' +
          '<p class="msg" id="mMsg" role="status"></p>' +
        '</div>' +
        '<footer class="sch-create-foot">' +
          '<button type="button" class="ghost" data-close>Cancel</button>' +
          '<button type="button" class="save" id="sGo">' + icon(I.plus) + ' Create schedule</button>' +
        '</footer>' +
      '</div>');
    wireCreateModal();
  }

  function refreshLiveSummary() {
    readDraftFromDom();
    var el = $("schLiveSum");
    if (!el) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = liveSummaryHtml();
    if (wrap.firstChild) el.replaceWith(wrap.firstChild);
  }

  // Cursor 2026-10-23: New schedule as modern popup (not sidebar).
  function openCreate(presetKind) {
    var kinds = scheduleKinds();
    var kind = presetKind && kinds.indexOf(presetKind) >= 0 ? presetKind : (kinds.indexOf("Fixed") >= 0 ? "Fixed" : kinds[0] || "Fixed");
    compose = {
      kind: kind,
      times: ["08:00", "12:00", "16:00"],
      name: "",
      routeId: "",
      vesselId: "",
      note: "",
      horizon: String(horizonDays()),
      day: selected || todayIso(),
      weekdays: defaultWeekdays()
    };
    paintCreateModal();
  }
  function closeCompose() {
    compose = null;
    closeModal();
  }
  function wireCreateModal() {
    if (!compose) return;
    [].forEach.call(document.querySelectorAll("#schKinds [data-kind]"), function (b) {
      b.addEventListener("click", function () {
        readDraftFromDom();
        compose.kind = b.dataset.kind;
        paintCreateModal();
      });
    });
    if ($("sAddTime")) $("sAddTime").addEventListener("click", function () {
      readDraftFromDom();
      compose.times.push("18:00");
      paintCreateModal();
    });
    [].forEach.call(document.querySelectorAll("#sTimeList [data-rm]"), function (b) {
      b.addEventListener("click", function () {
        readDraftFromDom();
        var i = Number(b.dataset.rm);
        compose.times.splice(i, 1);
        if (!compose.times.length) compose.times = ["08:00"];
        paintCreateModal();
      });
    });
    ["sName", "sRoute", "sVessel", "sNote", "sHorizon", "sDay"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("change", refreshLiveSummary);
      el.addEventListener("input", refreshLiveSummary);
    });
    [].forEach.call(document.querySelectorAll("#sDows input"), function (c) {
      c.addEventListener("change", refreshLiveSummary);
    });
    [].forEach.call(document.querySelectorAll("#sTimeList input[type=time]"), function (inp) {
      inp.addEventListener("change", refreshLiveSummary);
    });
    if ($("sNewRoute")) $("sNewRoute").addEventListener("click", openQuickRoute);
    if ($("sGo")) $("sGo").addEventListener("click", function () {
      readDraftFromDom();
      saveSchedule(compose.kind, compose.times);
    });
  }

  function resumeCreate() {
    if (compose) {
      compose.kind = compose.kind || "Fixed";
      paintCreateModal();
    } else {
      openCreate("Fixed");
    }
  }
  function openQuickRoute() {
    if (compose) readDraftFromDom();
    openModal('<h2>Add route</h2><p class="note">Needed before you can save a Fixed timetable.</p>' +
      '<div class="cards">' +
        '<div class="fld"><label for="rOrigin">Origin</label><input id="rOrigin" maxlength="80" placeholder="Male"></div>' +
        '<div class="fld"><label for="rDest">Destination</label><input id="rDest" maxlength="80" placeholder="Thulusdhoo"></div>' +
        '<div class="fld full"><label for="rName">Name (optional)</label><input id="rName" maxlength="120" placeholder="Defaults to Origin → Destination"></div>' +
        '<div class="fld"><label for="rCode">Code (optional)</label><input id="rCode" maxlength="20" placeholder="e.g. MT-N"></div>' +
        '<div class="fld"><label for="rDur">Duration (minutes)</label><input id="rDur" type="number" min="1" max="2880" placeholder="45"></div>' +
      '</div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" id="rBack">Back</button><button type="button" class="save" id="rGo">Save route</button></div>');
    $("rBack").addEventListener("click", resumeCreate);
    $("rGo").addEventListener("click", function () {
      var origin = $("rOrigin").value.trim(), dest = $("rDest").value.trim();
      var name = $("rName").value.trim() || (origin && dest ? origin + " → " + dest : "");
      if (origin.length < 1 || dest.length < 1) { say("Enter origin and destination.", "err"); return; }
      if (name.length < 2) { say("Enter a route name.", "err"); return; }
      say("Saving…");
      db.from("routes").insert({
        company_id: company.id,
        name: name,
        origin: origin,
        destination: dest,
        code: $("rCode").value.trim() || null,
        duration_min: $("rDur").value ? Number($("rDur").value) : null,
        active: true
      }).select().single().then(function (r) {
        if (r.error) { say(r.error.message, "err"); return; }
        routes.push(r.data);
        if (compose) compose.routeId = r.data.id;
        resumeCreate();
      });
    });
  }

  function uniqueTimes(list) {
    var seen = {}, out = [];
    list.forEach(function (t) {
      var v = String(t).slice(0, 5);
      if (v && !seen[v]) { seen[v] = true; out.push(v); }
    });
    return out.sort();
  }

  function saveSchedule(kind, times) {
    times = uniqueTimes(times);
    if (!times.length) { say("Add at least one departure time.", "err"); return; }
    var routeId = $("sRoute") && $("sRoute").value;
    if (!routeId) { say("Select a route.", "err"); return; }
    var vesselId = $("sVessel") && $("sVessel").value || null;
    var note = $("sNote") && $("sNote").value.trim() || null;

    if (isFixedKind(kind)) {
      var weekdays = [].map.call(document.querySelectorAll("#sDows input:checked"), function (c) { return Number(c.value); });
      if (!weekdays.length) { say("Pick at least one operating day.", "err"); return; }
      var name = ($("sName") && $("sName").value.trim()) || "";
      var route = routes.filter(function (r) { return r.id === routeId; })[0];
      if (!name) name = (route ? route.name : "Route") + " Fixed";
      var horizon = Number($("sHorizon") && $("sHorizon").value) || 30;
      var from = todayIso(), to = addDays(from, horizon);
      say("Saving " + times.length + " Fixed time" + (times.length === 1 ? "" : "s") + "…");

      var chain = Promise.resolve({ created: 0, templates: 0, skipped: [] });
      times.forEach(function (tm) {
        chain = chain.then(function (acc) {
          var row = {
            company_id: company.id,
            name: name + " · " + tm,
            route_id: routeId,
            vessel_id: vesselId || null,
            kind: "Fixed",
            depart_time: tm.length === 5 ? tm + ":00" : tm,
            weekdays: weekdays,
            valid_from: from,
            active: true,
            meta: note ? { note: note } : {}
          };
          return db.from("schedule_templates").insert(row).select().single().then(function (r) {
            if (r.error) throw new Error(r.error.message);
            acc.templates += 1;
            return rpc("generate_trips", { p_template: r.data.id, p_from: from, p_to: to }).then(function (g) {
              acc.created += (g && g.created) || 0;
              if (g && g.skipped && g.skipped.length) acc.skipped = acc.skipped.concat(g.skipped);
              return acc;
            });
          });
        });
      });
      chain.then(function (acc) {
        var msg = "Saved " + acc.templates + " Fixed time" + (acc.templates === 1 ? "" : "s") + ", created " + acc.created + " trip" + (acc.created === 1 ? "" : "s") + ".";
        if (acc.skipped.length) msg += " " + acc.skipped.length + " day(s) skipped (clash or already exist).";
        say(msg);
        return loadData().then(function () {
          compose = null;
          closeModal();
          render();
          flash(msg, "ok");
        });
      }).catch(function (err) { say(err.message || String(err), "err"); });
      return;
    }

    // One-off kinds: replace matching Fixed sailings, then create
    var day = $("sDay") && $("sDay").value;
    if (!day) { say("Pick a date.", "err"); return; }
    var route = routes.filter(function (r) { return r.id === routeId; })[0];
    var fixedHits = findFixedToReplace(day, routeId, times);
    if (fixedHits.length) {
      var confirmMsg = kind + " will replace " + fixedHits.length + " Fixed sailing" + (fixedHits.length === 1 ? "" : "s") +
        " on " + day + " (same route and time).\n\nEmpty Fixed trips are removed; ones with bookings are cancelled.";
      if (!window.confirm(confirmMsg)) return;
    }
    say((fixedHits.length ? "Replacing Fixed… " : "") + "Creating " + times.length + " trip" + (times.length === 1 ? "" : "s") + "…");
    var rows = times.map(function (tm) {
      return {
        route_id: routeId,
        route: route ? route.name : undefined,
        vessel_id: vesselId || undefined,
        date: day,
        time: tm,
        kind: kind,
        note: note || undefined
      };
    });
    replaceFixedSailings(fixedHits).then(function (rep) {
      return rpc("import_trips", { p_company: company.id, p_rows: rows }).then(function (res) {
        return { res: res, rep: rep };
      });
    }).then(function (pack) {
      var res = pack.res, rep = pack.rep || {};
      var created = (res && res.created) || 0;
      var errs = (res && res.errors) || [];
      if (!created && errs.length) { say(errs[0].error || "Could not create trips.", "err"); return; }
      var msg = "Created " + created + " " + kind + " trip" + (created === 1 ? "" : "s");
      if (rep.deleted || rep.cancelled) {
        var bits = [];
        if (rep.deleted) bits.push(rep.deleted + " Fixed removed");
        if (rep.cancelled) bits.push(rep.cancelled + " Fixed cancelled");
        msg += " — " + bits.join(", ");
      }
      if (errs.length) msg += " (" + errs.length + " failed)";
      msg += ".";
      say(msg);
      return loadData().then(function () {
        compose = null;
        closeModal();
        render();
        flash(msg, "ok");
      });
    }).catch(function (err) { say(err.message || String(err), "err"); });
  }

  function soonImport() {
    openModal('<h2>Import trips</h2><p class="note">Paste CSV later, or create Fixed with multiple daily times from <strong>New schedule</strong>.</p>' +
      '<div class="modal-actions"><button type="button" class="save" data-close>Got it</button></div>');
  }
  function soonDup() {
    if (!canPlan) return;
    var from = selected || todayIso(), to = addDays(from, 1);
    openModal('<h2>Duplicate day</h2><p class="note">Copy all trips from <strong>' + esc(from) + '</strong> to another day.</p>' +
      '<div class="cards"><div class="fld"><label for="dTo">Copy to</label><input id="dTo" type="date" value="' + esc(to) + '"></div></div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="dGo">Duplicate</button></div>');
    $("dGo").addEventListener("click", function () {
      var dest = $("dTo").value;
      if (!dest) { say("Pick a target date.", "err"); return; }
      say("Copying…");
      rpc("copy_trips", { p_company: company.id, p_from_day: from, p_to_day: dest }).then(function (res) {
        say("Created " + ((res && res.created) || 0) + " trip(s).");
        return loadData().then(function () { setTimeout(closeModal, 600); render(); });
      }).catch(function (err) { say(err.message || String(err), "err"); });
    });
  }

  function openModal(html) {
    $("modalCard").className = "modal-card sch-modal";
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;
    $("modal").classList.add("sch-modal-open");
    var f = $("modalCard").querySelector("input:not([type=checkbox]),select,textarea");
    if (f) try { f.focus(); } catch (e) {}
  }
  function openCreateModal(html) {
    $("modalCard").className = "modal-card sch-modal sch-modal-create";
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;
    $("modal").classList.add("sch-modal-open");
  }
  function closeModal() {
    compose = null;
    $("modal").hidden = true;
    $("modal").classList.remove("sch-modal-open");
    $("modalCard").className = "modal-card";
    $("modalCard").innerHTML = "";
  }

  function selectDay(day) {
    selected = day;
    var d = parseIso(selected);
    calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    if (loadedFrom && loadedTo && (day < loadedFrom || day > loadedTo)) {
      $("sch").innerHTML = '<p class="msg">Loading…</p>';
      loadData(addDays(day, -21), addDays(day, 45)).then(function () { render(); }, function (err) {
        $("sch").innerHTML = '<section class="dash-card"><h2>Could not load Schedules</h2><p class="note">' + esc(err.message) + '</p></section>';
      });
      return;
    }
    render();
  }

  function bind() {
    [].forEach.call(document.querySelectorAll("[data-view]"), function (b) {
      b.addEventListener("click", function () {
        if (b.disabled) return;
        view = b.dataset.view;
        render();
      });
    });
    [].forEach.call(document.querySelectorAll("[data-day]"), function (b) {
      b.addEventListener("click", function () { selectDay(b.dataset.day); });
    });
    if ($("calPrev")) $("calPrev").addEventListener("click", function () { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); });
    if ($("calNext")) $("calNext").addEventListener("click", function () { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); });
    if ($("schPrevDay")) $("schPrevDay").addEventListener("click", function () { selectDay(addDays(selected, -1)); });
    if ($("schNextDay")) $("schNextDay").addEventListener("click", function () { selectDay(addDays(selected, 1)); });
    if ($("schJumpCal") || $("schDateLbl")) {
      var jump = function () {
        var cal = document.querySelector(".sch-cal");
        if (cal) cal.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
      if ($("schJumpCal")) $("schJumpCal").addEventListener("click", jump);
      if ($("schDateLbl")) $("schDateLbl").addEventListener("click", jump);
    }
    if ($("schType")) $("schType").addEventListener("change", function () { typeF = $("schType").value; render(); });
    if ($("schRoute")) $("schRoute").addEventListener("change", function () { routeF = $("schRoute").value; render(); });
    if ($("schVessel")) $("schVessel").addEventListener("change", function () { vesselF = $("schVessel").value; render(); });
    if ($("schQ")) {
      var qTimer = null;
      $("schQ").addEventListener("input", function () {
        var v = $("schQ").value;
        clearTimeout(qTimer);
        qTimer = setTimeout(function () {
          searchQ = v;
          render();
          var inp = $("schQ");
          if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
        }, 220);
      });
    }
    if ($("schMore")) $("schMore").addEventListener("click", function () {
      flash("Route, vessel, and type filters are above. Weekly / Route / Vessel views are next.", "");
    });
    if ($("schNew")) $("schNew").addEventListener("click", function () { openCreate("Fixed"); });
    if ($("emptyNew")) $("emptyNew").addEventListener("click", function () { openCreate("Fixed"); });
    if ($("emptyImport")) $("emptyImport").addEventListener("click", soonImport);
    [].forEach.call(document.querySelectorAll(".sch-tool-dup"), function (b) {
      b.addEventListener("click", soonDup);
    });
    [].forEach.call(document.querySelectorAll(".sch-tool-imp"), function (b) {
      b.addEventListener("click", soonImport);
    });
    [].forEach.call(document.querySelectorAll("[data-menu-trip]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = b.dataset.menuTrip;
        var menu = document.querySelector('[data-menu-for="' + id + '"]');
        var open = menu && !menu.hidden;
        [].forEach.call(document.querySelectorAll(".sch-menu"), function (m) { m.hidden = true; });
        [].forEach.call(document.querySelectorAll(".sch-menu-btn"), function (x) { x.classList.remove("on"); });
        if (menu && !open) { menu.hidden = false; b.classList.add("on"); }
      });
    });
    [].forEach.call(document.querySelectorAll("[data-edit-trip]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        [].forEach.call(document.querySelectorAll(".sch-menu"), function (m) { m.hidden = true; });
        openEdit(b.dataset.editTrip);
      });
    });
    [].forEach.call(document.querySelectorAll("[data-del-trip]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        deleteSchedule(b);
      });
    });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest && (e.target.closest(".sch-menu") || e.target.closest("[data-menu-trip]"))) return;
    [].forEach.call(document.querySelectorAll(".sch-menu"), function (m) { m.hidden = true; });
    [].forEach.call(document.querySelectorAll(".sch-menu-btn"), function (x) { x.classList.remove("on"); });
  });

  function loadData(from, to) {
    // Cursor 2026-10-27: schedule_trips allows ~93 days. -90/+60 was 150 and the page failed to load.
    from = from || addDays(todayIso(), -21);
    to = to || addDays(todayIso(), 60);
    if (to < from) { var swap = from; from = to; to = swap; }
    if (Math.round((parseIso(to) - parseIso(from)) / 86400000) > 90) to = addDays(from, 90);
    loadedFrom = from;
    loadedTo = to;
    return Promise.all([
      db.from("routes").select("id,name,code,origin,destination,duration_min,active").eq("company_id", company.id).eq("active", true).order("name"),
      db.from("vessels").select("id,name,code,status,standby,passenger_capacity").eq("company_id", company.id).order("name"),
      rpc("schedule_trips", { p_company: company.id, p_from: from + "T00:00:00Z", p_to: addDays(to, 1) + "T00:00:00Z" })
    ]).then(function (res) {
      if (res[0].error) throw new Error(res[0].error.message);
      if (res[1].error) throw new Error(res[1].error.message);
      routes = res[0].data || [];
      vessels = (res[1].data || []).filter(function (v) { return v.status !== "Out of service"; });
      var pack = res[2] || {};
      trips = pack.trips || [];
      sumData = pack.summary || { trips: 0, vessels: 0, routes: 0, crew: 0 };
    });
  }

  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  window.addEventListener("hashchange", function () { if (company) render(); });

  window.VeyoraShell.start({
    active: "Schedules",
    onCompany: function (c, info) {
      company = c;
      canPlan = !!(info.canAll || info.canOps || info.isPlatform || info.isAdmin || info.myRole === "operations");
      selected = todayIso();
      var d = parseIso(selected);
      calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      $("sch").innerHTML = '<p class="msg">Loading…</p>';
      loadData().then(function () {
        render();
        if (window.VeyoraTip) window.VeyoraTip("sch3", [
          "**Fixed** schedules use operating days plus **multiple daily departure times** — each time is saved and trips are generated ahead.",
          "Add a route if you don’t have one yet, then use **New schedule** → Fixed.",
          "Promotional and Temporary still use a single date with one or more times."
        ]);
      }).catch(function (err) {
        $("sch").innerHTML = '<section class="dash-card"><h2>Could not load Schedules</h2><p class="note">' + esc(err.message) + '</p></section>';
      });
    },
    onNone: function () { $("sch").innerHTML = '<section class="dash-card"><h2>No company yet</h2><p class="note">Ask your administrator for an invite.</p></section>'; },
    onError: function (err) { $("sch").innerHTML = '<section class="dash-card"><h2>Could not load Schedules</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
