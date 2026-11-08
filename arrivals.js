/* GPS arrival detection on Operations (Claude 2026-10-27, migration 0058).
   - Home: "Arrival detection" card in #opsArrivals (status, last fix, freshness, early/late) — refreshed every 30 s
     on its own (ops_arrivals), without reloading the dashboard. A toast when a trip's arrival is confirmed.
   - Trip detail → Tracking: #tdArrival explains why a trip arrived or is still pending (trip_arrival_detail),
     and Operations can correct the arrival time (correct_trip_arrival, audited).
   - Harbours (Operations only): harbour registry with geofences on a Leaflet map, a point tester, route ↔ harbour
     links and the 3_arrival_detection settings.
   - Settings → Operations Settings (Claude 2026-10-28): window.VeyoraArrivals.mountAdmin(host, company, tab, canEdit)
     draws one of those tabs inline (harbours / routes / settings) for the platform owner, owners and admins.
   Needs operations.js to set window.VeyoraOps (company, canOps, openTrip, reload) for the Operations parts. */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var ops = null, tz = "Indian/Maldives";
  var board = null, seenEvents = null, pollTimer = null;
  var detailCache = {};   // trip id -> { at, data }
  var admin = null;       // harbour admin state while open

  function rpc(name, args) {
    return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; });
  }
  function tbl(name) { return db.from(name); }
  function check(r) { if (r.error) throw new Error(r.error.message); return r.data; }
  // Harbour pins and geofences are set by the KAHDHU platform owner only (2026-11-03). Everyone else sees them read-only.
  // The database enforces it too (policy hbr_write, migration 0109); this only decides what the screen offers.
  var platformP = null;
  function isPlatformAdmin() {
    if (!platformP) platformP = db.auth.getSession().then(function (r) {
      var u = r.data && r.data.session && r.data.session.user;
      if (!u) return false;
      return db.from("platform_admins").select("user_id").eq("user_id", u.id).then(function (x) { return !!(x.data && x.data.length); });
    }).then(null, function () { return false; });
    return platformP;
  }

  // ---- time (always the company's time zone, Maldives by default) ----
  function hm(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  }
  function hms(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function dayHm(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function ago(sec) {
    if (sec == null) return "no fix yet";
    if (sec < 90) return Math.max(0, Math.round(sec)) + " s ago";
    if (sec < 5400) return Math.round(sec / 60) + " min ago";
    return Math.round(sec / 3600) + " h ago";
  }
  function deltaText(min) {
    if (min == null) return "";
    if (min === 0) return "on time";
    return Math.abs(min) + " min " + (min < 0 ? "early" : "late");
  }
  // datetime-local value in the company time zone, and back to an ISO instant.
  function toLocalInput(iso) {
    var p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso)).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
    return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
  }
  function fromLocalInput(v) {
    // Interpret v as wall time in tz: start from UTC guess, correct by the zone offset at that instant.
    var guess = new Date(v + ":00Z");
    var back = new Date(toLocalInput(guess.toISOString()) + ":00Z");
    return new Date(guess.getTime() - (back.getTime() - guess.getTime())).toISOString();
  }

  var CHIP = {
    NOT_APPROACHING: "arr-chip-track", APPROACHING_DESTINATION: "arr-chip-appr", ARRIVAL_PENDING: "arr-chip-pend",
    ARRIVED: "arr-chip-ok", TRACKING_UNAVAILABLE: "arr-chip-lost", NOT_CONFIGURED: "arr-chip-cfg"
  };
  function chip(state, label) { return '<span class="arr-chip ' + (CHIP[state] || "arr-chip-cfg") + '">' + esc(label || state) + '</span>'; }
  var METHOD = { gps_geofence: "Vessel GPS", crew_device_geofence: "Crew phones (estimated)", manual: "Marked by hand",
                 manual_correction: "Corrected by Operations", schedule_fallback: "Clock (no GPS evidence)" };

  function toast(text) {
    var el = document.createElement("div");
    el.className = "arr-toast";
    el.setAttribute("role", "status");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add("out"); }, 7000);
    setTimeout(function () { el.remove(); }, 7600);
  }

  // ---------------------------------------------------------------- home card
  function loadBoard() {
    if (!ops || document.hidden) return Promise.resolve();
    return rpc("ops_arrivals", { p_company: ops.company.id, p_day: null }).then(function (d) {
      tz = d.tz || tz;
      var fresh = {};
      (d.trips || []).forEach(function (x) { if (x.event_id) fresh[x.event_id] = x; });
      if (seenEvents) {
        Object.keys(fresh).forEach(function (id) {
          var x = fresh[id];
          if (!seenEvents[id] && x.method && x.method !== "manual" && x.method !== "manual_correction") {
            toast((x.vessel || "Vessel") + " arrived at " + (x.destination_harbour || x.destination || "the destination") + " at " + x.local_arrival + ".");
          }
        });
      }
      seenEvents = fresh;
      board = d;
      paintHome();
    }, function (e) {
      board = { error: e.message };
      paintHome();
    });
  }

  function paintHome() {
    var el = $("opsArrivals");
    if (!el || !board) return;
    if (board.error) { el.innerHTML = '<section class="ops-home-card arr-card"><p class="note">Arrival detection could not load: ' + esc(board.error) + '</p></section>'; return; }
    var rows = (board.trips || []).filter(function (x) { return x.state; });
    var notSet = rows.filter(function (x) { return x.state === "NOT_CONFIGURED"; }).length;
    el.innerHTML = '<section class="ops-home-card arr-card">' +
      '<div class="ops-home-h"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg><h2>Arrival detection</h2></span>' +
        (ops.canOps ? '<button type="button" class="ops-viewall" data-arr-admin>Harbours</button>' : "") + '</div>' +
      (notSet ? '<p class="arr-warn">' + notSet + ' trip' + (notSet > 1 ? "s have" : " has") + ' no destination harbour, so arrival cannot be detected.' +
        (ops.canOps ? ' <button type="button" class="arr-link" data-arr-admin="routes">Set up harbours</button>' : "") + '</p>' : "") +
      (rows.length
        ? '<div class="arr-list">' + rows.map(rowHtml).join("") + '</div>'
        : '<p class="note arr-empty">No trips under way. Arrivals confirmed by GPS today will show here.</p>') +
      '</section>';
  }

  function rowHtml(x) {
    var fresh = x.fresh_s != null && x.fresh_s < 300;
    var arrived = x.state === "ARRIVED";
    return '<button type="button" class="arr-row" data-arr-trip="' + esc(x.trip_id) + '">' +
      '<span class="arr-main"><strong>' + esc(x.origin || "") + ' <span class="arr-arrow">→</span> ' + esc(x.destination || "") + '</strong>' +
        '<small>' + esc([x.code, x.vessel || "No vessel", x.destination_harbour ? "to " + x.destination_harbour : "harbour not set"].filter(Boolean).join(" · ")) + '</small></span>' +
      '<span class="arr-times"><small>Scheduled</small><strong>' + hm(x.arrive_at) + '</strong></span>' +
      '<span class="arr-times"><small>Actual</small><strong>' + (arrived ? hm(x.arrived_at || x.actual_arrive) : "—") + '</strong>' +
        (arrived && x.delta_min != null ? '<em class="' + (x.delta_min > 5 ? "late" : x.delta_min < 0 ? "early" : "") + '">' + esc(deltaText(x.delta_min)) + '</em>' : "") + '</span>' +
      '<span class="arr-fix"><small>Last GPS</small><strong class="' + (arrived ? "" : fresh ? "ok" : "stale") + '">' + (x.last_fix_at ? hm(x.last_fix_at) : "—") + '</strong>' +
        (arrived ? "" : '<em>' + esc(ago(x.fresh_s)) + '</em>') + '</span>' +
      chip(x.state, x.label) +
    '</button>';
  }

  // ---------------------------------------------------------------- trip detail (Tracking tab)
  function fillDetail(el) {
    var id = el.getAttribute("data-trip");
    if (!id || el.dataset.filled === id) return;
    el.dataset.filled = id;
    var c = detailCache[id];
    if (c) el.innerHTML = detailHtml(c.data);
    else el.innerHTML = '<section class="td-block arr-detail"><p class="note">Loading arrival detection…</p></section>';
    if (c && Date.now() - c.at < 20000) return;
    rpc("trip_arrival_detail", { p_trip: id }).then(function (d) {
      detailCache[id] = { at: Date.now(), data: d };
      var cur = $("tdArrival");
      if (cur && cur.getAttribute("data-trip") === id) cur.innerHTML = detailHtml(d);
    }, function (e) {
      var cur = $("tdArrival");
      if (cur && cur.getAttribute("data-trip") === id) cur.innerHTML = '<section class="td-block arr-detail"><p class="note">' + esc(e.message) + '</p></section>';
    });
  }

  function detailHtml(d) {
    var s = d.state || {}, h = d.harbour, t = d.trip || {};
    var cur = (d.events || []).filter(function (e) { return !e.superseded_at; })[0];
    var state = cur ? "ARRIVED" : (!h ? "NOT_CONFIGURED" : (s.state || "NOT_APPROACHING"));
    var labels = { NOT_APPROACHING: "Tracking", APPROACHING_DESTINATION: "Approaching destination", ARRIVAL_PENDING: "Arrival pending",
                   ARRIVED: "Arrived", TRACKING_UNAVAILABLE: "Tracking unavailable", NOT_CONFIGURED: "Harbour not set" };
    var out = '<section class="td-block arr-detail">' +
      '<div class="arr-detail-h"><h3>Arrival detection</h3>' + chip(state, labels[state]) + '</div>';
    if (!h) {
      out += '<p class="note">This trip has no destination harbour, so its arrival cannot be detected. Operations can link the route to a harbour under <strong>Harbours</strong>.</p>';
    } else {
      out += '<p class="arr-why">' + esc(cur ? (cur.reason || "") : (s.reason || (d.gps_managed ? "Waiting for the first GPS fix." : "No tracking source: add a FollowMe link to the vessel, or crew can share their position."))) + '</p>' +
        '<dl class="arr-kv">' +
          '<div><dt>Destination</dt><dd>' + esc(h.name) + ' · ' + (h.geofence_type === "polygon" ? "boundary" : h.radius_m + " m radius") + '</dd></div>' +
          '<div><dt>Rule</dt><dd>' + h.min_obs + ' fixes over ' + h.dwell_sec + ' s, accuracy ≤ ' + h.max_accuracy_m + ' m</dd></div>' +
          '<div><dt>Last valid fix</dt><dd>' + (s.last_obs_at ? hms(s.last_obs_at) + (s.last_distance_m != null ? " · " + Math.round(s.last_distance_m) + " m from the pin" : "") : "—") + '</dd></div>' +
          (s.pending_since && !cur ? '<div><dt>Inside since</dt><dd>' + hms(s.pending_since) + ' · ' + s.pending_count + ' of ' + h.min_obs + ' fixes</dd></div>' : "") +
        '</dl>';
    }
    if (cur) {
      out += '<dl class="arr-kv arr-event">' +
        '<div><dt>Arrived</dt><dd><strong>' + dayHm(cur.arrived_at) + '</strong>' + (t.arrive_at ? ' · scheduled ' + hm(t.arrive_at) : "") + '</dd></div>' +
        '<div><dt>How</dt><dd>' + esc(METHOD[cur.method] || cur.method) + (cur.time_basis === "received" ? " · time = when the server got the fix" : "") + '</dd></div>' +
        (cur.arrived_after ? '<div><dt>Entered between</dt><dd>' + hms(cur.arrived_after) + ' and ' + hms(cur.arrived_at) + ' (±' + Math.round((cur.uncertainty_s || 0)) + ' s)</dd></div>' : "") +
        (cur.confirmed_obs_at ? '<div><dt>Confirmed</dt><dd>by the fix at ' + hms(cur.confirmed_obs_at) + ', saved ' + hms(cur.confirmed_at) + '</dd></div>' : "") +
      '</dl>';
    }
    if (ops && ops.canOps && t.status !== "Cancelled") {
      out += '<details class="arr-fixbox"><summary>' + (cur ? "Correct the arrival time" : "Record the arrival time by hand") + '</summary>' +
        '<form class="arr-correct" data-arr-correct="' + esc(t.id) + '">' +
          '<label>Arrival time (' + esc(tz) + ')<input type="datetime-local" name="at" required value="' + esc(toLocalInput(cur ? cur.arrived_at : new Date().toISOString())) + '"></label>' +
          '<label>Reason<input name="why" required maxlength="300" placeholder="e.g. Captain’s log: alongside at 07:52"></label>' +
          '<button type="submit" class="save">Save</button><span class="arr-msg" aria-live="polite"></span>' +
        '</form></details>';
    }
    if ((d.fixes || []).length) {
      out += '<details class="arr-fixbox"><summary>Recent GPS fixes (' + d.fixes.length + ')</summary><div class="arr-table-wrap"><table class="arr-table"><thead><tr>' +
        '<th>Observed</th><th>Received</th><th>Source</th><th>Accuracy</th><th>Zone</th><th>Distance</th><th>Used?</th></tr></thead><tbody>' +
        d.fixes.map(function (f) {
          return '<tr><td>' + hms(f.observed_at) + '</td><td>' + hms(f.received_at) + '</td><td>' + esc(f.source === "crew_device" ? "Crew phone" : "FollowMe") + '</td>' +
            '<td>' + (f.accuracy_m != null ? Math.round(f.accuracy_m) + " m" : "unknown") + '</td><td>' + esc(f.zone || "—") + '</td>' +
            '<td>' + (f.distance_m != null ? Math.round(f.distance_m) + " m" : "—") + '</td>' +
            '<td>' + (f.validity === "valid" ? "Yes" : '<span class="arr-bad">' + esc(f.validity.replace(/_/g, " ")) + '</span>') + '</td></tr>';
        }).join("") + '</tbody></table></div></details>';
    }
    if ((d.diagnostics || []).length) {
      out += '<details class="arr-fixbox"><summary>Detection log</summary><ul class="arr-log">' +
        d.diagnostics.map(function (g) { return '<li><time>' + dayHm(g.at) + '</time> <b>' + esc(g.kind.replace(/_/g, " ")) + '</b> ' + esc(g.detail || "") + '</li>'; }).join("") +
        '</ul></details>';
    }
    if ((d.events || []).length > 1) {
      out += '<details class="arr-fixbox"><summary>Arrival history</summary><ul class="arr-log">' +
        d.events.map(function (e) {
          return '<li><time>' + dayHm(e.confirmed_at) + '</time> <b>' + esc(METHOD[e.method] || e.method) + '</b> ' + dayHm(e.arrived_at) +
            (e.reason ? ' — ' + esc(e.reason) : "") + (e.superseded_at ? ' <em>(replaced)</em>' : "") + '</li>';
        }).join("") + '</ul></details>';
    }
    return out + '</section>';
  }

  document.addEventListener("submit", function (e) {
    var f = e.target.closest && e.target.closest("[data-arr-correct]");
    if (!f) return;
    e.preventDefault();
    var id = f.getAttribute("data-arr-correct"), msg = f.querySelector(".arr-msg");
    msg.textContent = "Saving…";
    rpc("correct_trip_arrival", { p_trip: id, p_arrived_at: fromLocalInput(f.at.value), p_reason: f.why.value }).then(function () {
      delete detailCache[id];
      msg.textContent = "Saved.";
      if (ops.reload) ops.reload();
      loadBoard();
    }, function (err) { msg.textContent = err.message; });
  });

  // ---------------------------------------------------------------- Harbours admin (Operations)
  function openAdmin(tab) {
    if (!ops || !ops.canOps) return;
    var wrap = document.createElement("div");
    wrap.className = "arr-admin";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "Harbours");
    wrap.innerHTML = '<div class="arr-admin-card">' +
      '<div class="arr-admin-top"><h2>Harbours</h2>' +
        '<div class="arr-tabs" role="tablist">' +
          '<button type="button" data-arr-tab="auto">Autopilot</button><button type="button" data-arr-tab="harbours">Harbours</button><button type="button" data-arr-tab="routes">Routes</button><button type="button" data-arr-tab="settings">Detection rules</button>' +
        '</div><button type="button" class="arr-x" data-arr-close aria-label="Close">×</button></div>' +
      '<div class="arr-admin-body" id="arrAdminBody"><p class="note">Loading…</p></div></div>';
    document.body.appendChild(wrap);
    document.documentElement.classList.add("arr-admin-open");
    admin = { el: wrap, cid: ops.company.id, tab: tab || "auto", harbours: [], islands: [], routes: [], gaps: null, sel: null, map: null, layer: null, mode: "box", poly: [], test: null };
    loadAdmin();
  }
  // Settings page (Claude 2026-10-28): one tab drawn inside a settings panel, no dialog and no tab bar.
  // canEdit false shows everything read-only; the database still decides who may write (is_company_ops).
  function mountAdmin(host, company, tab, canEdit) {
    dropInline();
    tz = (company && company.timezone) || tz;
    host.innerHTML = '<div class="arr-inline" id="arrAdminBody"><p class="note">Loading…</p></div>';
    admin = { el: host, inline: true, baseRO: !canEdit, readOnly: !canEdit, cid: company.id, tab: tab || "harbours", harbours: [], islands: [], routes: [], gaps: null, sel: null, map: null, layer: null, mode: "box", poly: [], test: null };
    loadAdmin();
  }
  // The settings panel is redrawn when another setting opens; forget an inline editor that is no longer on the page.
  function dropInline() {
    if (!admin || !admin.inline) return;
    if (admin.map) { try { admin.map.remove(); } catch (e) {} }
    document.documentElement.classList.remove("arr-map-fs");
    admin = null;
  }
  function liveAdmin() {
    if (admin && admin.inline && !document.body.contains(admin.el.querySelector("#arrAdminBody"))) dropInline();
    return admin;
  }
  function closeAdmin() {
    if (!admin || admin.inline) return;
    if (admin.map) { try { admin.map.remove(); } catch (e) {} }
    document.documentElement.classList.remove("arr-map-fs");
    admin.el.remove();
    admin = null;
    document.documentElement.classList.remove("arr-admin-open");
    loadBoard();
  }
  function loadAdmin() {
    var cid = admin.cid;
    return Promise.all([
      tbl("harbours").select("*").eq("company_id", cid).order("name").then(check),
      tbl("islands").select("*").eq("company_id", cid).order("name").then(check),
      tbl("routes").select("id, name, origin, destination, active, origin_harbour_id, destination_harbour_id").eq("company_id", cid).order("name").then(check),
      rpc("harbour_config_gaps", { p_company: cid }),
      rpc("arrival_cfg", { p_company: cid }),
      rpc("harbour_learning_status", { p_company: cid }).then(null, function () { return null; }),
      isPlatformAdmin()
    ]).then(function (r) {
      if (!admin) return;
      admin.isPlatform = !!r[6];
      admin.harbours = r[0] || []; admin.islands = r[1] || []; admin.routes = r[2] || []; admin.gaps = r[3]; admin.cfg = r[4]; admin.learn = r[5];
      paintAdmin();
    }, function (e) { if (admin) $("arrAdminBody").innerHTML = '<p class="note">' + esc(e.message) + '</p>'; });
  }
  function paintAdmin() {
    // Harbours and geofences: platform owner only. The other tabs keep their usual rule.
    admin.readOnly = !!admin.baseRO || (admin.tab === "harbours" && !admin.isPlatform);
    if (admin.tab !== "harbours" && admin.fs) setFs(false);
    [].forEach.call(admin.el.querySelectorAll("[data-arr-tab]"), function (b) { b.classList.toggle("on", b.getAttribute("data-arr-tab") === admin.tab); });
    if (admin.map) { try { admin.view = { c: admin.map.getCenter(), z: admin.map.getZoom() }; admin.map.remove(); } catch (e) {} admin.map = null; }
    var body = $("arrAdminBody");
    if (admin.tab === "auto") { body.innerHTML = autoHtml(); drawAutoMap(); }
    else if (admin.tab === "routes") body.innerHTML = routesHtml();
    else if (admin.tab === "settings") body.innerHTML = settingsHtml();
    else { body.innerHTML = harboursHtml(); drawMap(); if (admin.fs) setFs(true); }
    if (admin.readOnly) {
      [].forEach.call(body.querySelectorAll("form input, form select, form button, .arr-table select, [data-arr-route-save], [data-arr-sugg], [data-arr-new], [data-arr-add], [data-arr-edit], [data-arr-mode], [data-arr-poly-clear], [data-arr-poly-undo], [data-arr-toggle], [data-arr-learn]"), function (x) { x.disabled = true; });
      body.insertAdjacentHTML("afterbegin", admin.tab === "harbours" && !admin.isPlatform
        ? '<p class="msg arr-lock"><strong>Set by the KAHDHU platform owner.</strong> Harbour pins and geofences can be seen here but only the platform owner can add or change them. Ask them if a zone needs moving.</p>'
        : '<p class="msg">Only owners, admins and the platform owner can change this here.</p>');
    }
  }

  function harbourName(id) { var h = admin.harbours.filter(function (x) { return x.id === id; })[0]; return h ? h.name : ""; }
  function islandName(id) { var i = admin.islands.filter(function (x) { return x.id === id; })[0]; return i ? i.name : ""; }

  function harboursHtml() {
    var h = admin.sel || {};
    var isNew = !h.id;
    var poly = h.geofence_type === "polygon";
    return '<div class="arr-hb">' +
      '<aside class="arr-hb-list"><button type="button" class="save arr-new" data-arr-new>+ New harbour</button>' +
        (admin.harbours.length ? '<ul>' + admin.harbours.map(function (x) {
          return '<li><button type="button" data-arr-pick="' + esc(x.id) + '" class="' + (h.id === x.id ? "on" : "") + (x.active ? "" : " off") + '">' +
            '<strong>' + esc(x.name) + (x.meta && x.meta.auto ? ' <em class="arr-badge auto">Auto</em>' : "") + '</strong><small>' + esc([islandName(x.island_id), x.geofence_type === "polygon" ? "boundary" : x.radius_m + " m", x.active ? "" : "inactive"].filter(Boolean).join(" · ")) + '</small></button></li>';
        }).join("") + '</ul>' : '<p class="note">No harbours yet. Each terminal or jetty gets its own harbour with its own zone.</p>') +
      '</aside>' +
      '<div class="arr-hb-map"><div class="arr-map-wrap">' +
        dockHtml() +
        '<div id="arrMap" class="arr-map"></div>' +
        '<div class="arr-hud" id="arrHud" aria-live="polite">' + hudHtml() + '</div>' +
        '<div class="arr-hint" id="arrHint">' + hintText() + '</div>' +
      '</div><p class="arr-test" id="arrTest" aria-live="polite">' + testText() + '</p></div>' +
      '<form class="arr-hb-form" id="arrHbForm" novalidate>' +
        '<h3>' + (isNew ? "New harbour" : esc(h.name)) + '</h3>' +
        field("Harbour name", '<input name="name" required maxlength="80" autocomplete="off" placeholder="e.g. Male Commercial Harbour" value="' + esc(h.name || "") + '">') +
        '<div class="arr-zone" id="arrZoneState">' + zoneStateHtml() + '</div>' +
        '<div class="arr-actions"><button type="submit" class="save">' + (isNew ? "Add harbour" : "Save changes") + '</button><span class="arr-msg" id="arrHbMsg" aria-live="polite"></span></div>' +
        '<details class="arr-adv"><summary>More settings (optional)</summary>' +
          field("Code", '<input name="code" maxlength="12" value="' + esc(h.code || "") + '" placeholder="e.g. MLE-T1">') +
          field("Island", '<input name="island" list="arrIslands" maxlength="80" value="' + esc(islandName(h.island_id)) + '"><datalist id="arrIslands">' +
            admin.islands.map(function (i) { return '<option value="' + esc(i.name) + '">'; }).join("") + '</datalist>') +
          '<div class="arr-2">' + field("Latitude", '<input name="lat" inputmode="decimal" required value="' + (h.lat != null ? h.lat : "") + '">') +
            field("Longitude", '<input name="lng" inputmode="decimal" required value="' + (h.lng != null ? h.lng : "") + '">') + '</div>' +
          field("Zone shape", '<select name="geofence_type"><option value="circle"' + (poly ? "" : " selected") + '>Circle</option><option value="polygon"' + (poly ? " selected" : "") + '>Box or boundary</option></select>') +
          '<div class="arr-2">' + field("Radius (m)", num("radius_m", h.radius_m, 150, 20, 3000)) + field("Approach zone (m)", num("approach_m", h.approach_m, 2000, 200, 50000)) + '</div>' +
          '<div class="arr-3">' + field("Worst accuracy (m)", num("max_accuracy_m", h.max_accuracy_m, 50, 5, 500)) +
            field("Time inside (s)", num("dwell_sec", h.dwell_sec, 60, 0, 3600)) + field("Fixes inside", num("min_obs", h.min_obs, 3, 2, 50)) + '</div>' +
          (poly || admin.mode === "poly" ? '<p class="note" id="arrPolyNote">' + polyNote() + '</p>' : "") +
          '<label class="arr-check"><input type="checkbox" name="allow_overlap"' + (h.allow_overlap ? " checked" : "") + '> Allow overlap with another harbour’s zone</label>' +
          '<label class="arr-check"><input type="checkbox" name="active"' + (h.active === false ? "" : " checked") + '> Active</label>' +
          '<p class="note">Keep the zone just big enough to cover the berths. Poor GPS is handled by the accuracy rule, not by a bigger zone.</p>' +
        '</details>' +
      '</form></div>';
  }
  function field(label, input) { return '<label class="arr-field"><span>' + label + '</span>' + input + '</label>'; }
  function num(name, v, dflt, min, max) {
    return '<input name="' + name + '" type="number" min="' + min + '" max="' + max + '" step="1" value="' + (v != null ? v : dflt) + '">';
  }
  function testText() {
    var t = admin && admin.test;
    if (!t) return admin && admin.mode === "test" ? "Click the map to see what detection would decide there." : "";
    if (t.error) return esc(t.error);
    var words = { inside: "Inside — counts towards arrival", boundary: "On the edge — too uncertain, never counts", approach: "Outside, approaching", outside: "Outside" };
    return '<strong>' + esc(words[t.zone] || t.zone) + '</strong> · ' + Math.round(t.distance_m) + ' m from the pin, ' +
      Math.abs(Math.round(t.edge_m)) + ' m ' + (t.edge_m < 0 ? "inside" : "outside") + ' the edge (GPS ±' + Math.round(t.uncertainty_m) + ' m' + (t.accuracy_assumed ? ", assumed" : "") + ')' +
      (t.other_harbours && t.other_harbours.length ? ' · nearby: ' + esc(t.other_harbours.map(function (o) { return o.name + " (" + o.zone + ")"; }).join(", ")) : "");
  }

  function drawMap() {
    var el = $("arrMap");
    if (!el || !window.L) return;
    var h = admin.sel || {};
    var center = h.lat != null ? [h.lat, h.lng] : (admin.harbours[0] ? [admin.harbours[0].lat, admin.harbours[0].lng] : [4.2, 73.5]);
    // Canvas renderer: settings.css sizes every <svg> to 20 px, which would hide SVG zones.
    admin.map = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView(admin.view ? admin.view.c : center, admin.view ? admin.view.z : (h.lat != null ? 15 : 9));
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, maxNativeZoom: 17, attribution: "Tiles &copy; Esri"
    }).addTo(admin.map);
    admin.layer = L.layerGroup().addTo(admin.map);
    admin.box = admin.mode === "box" ? ((admin.box && admin.poly.length === 4) ? admin.box : polyToBox(admin.poly)) : null;
    if (admin.poly.length >= 3 && !admin.view) { try { admin.map.fitBounds(L.latLngBounds(admin.poly).pad(0.7), { maxZoom: 18, animate: false }); } catch (x) {} }
    redrawShapes();
    admin.map.on("zoomend", placeRot);
    if (!admin.readOnly) { freehand(el); boxDraw(el); }
    syncPan();
    admin.map.on("click", function (e) {
      if (admin.justDrew) { admin.justDrew = false; return; }   // the click that ends a freehand stroke
      var lat = +e.latlng.lat.toFixed(6), lng = +e.latlng.lng.toFixed(6), f = $("arrHbForm");
      if ((admin.mode === "pin" || (admin.mode === "box" && !admin.box)) && f) {
        f.lat.value = lat; f.lng.value = lng; redrawShapes();
      } else if (admin.mode === "poly") {
        admin.poly.push([lat, lng]); fixPin(); redrawShapes();
      } else if (admin.mode === "test" && h.id) {
        var acc = window.prompt("GPS accuracy in metres (leave empty for “unknown”)", "");
        rpc("harbour_test_point", { p_harbour: h.id, p_lat: lat, p_lng: lng, p_accuracy_m: acc ? Number(acc) : null }).then(function (r) {
          admin.test = r; $("arrTest").innerHTML = testText();
          L.circleMarker([lat, lng], { radius: 6, color: r.zone === "inside" ? "#16a34a" : r.zone === "boundary" ? "#d97706" : "#dc2626" }).addTo(admin.layer);
        }, function (err) { admin.test = { error: err.message }; $("arrTest").innerHTML = testText(); });
      }
    });
  }
  // Boundary drawing (fixed 2026-10-28): the outline shows from the first corner, corners can be dragged, and the pin
  // is moved to the middle when there is none yet or it falls outside (the database requires it inside).
  // Freehand: press, drag around the berths, release. The stroke is simplified to at most 100 corners (the database
  // limit) and replaces the boundary. A press without a drag still adds a single corner (the map click above).
  function freehand(el) {
    var m = admin.map, pts = null, line = null;
    m.doubleClickZoom.disable();
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || admin.mode !== "poly" || admin.space || e.target.closest(".arr-corner, .leaflet-control, .arr-dock, .arr-hud, .arr-hint")) return;
      pts = [m.mouseEventToContainerPoint(e)];
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
    });
    el.addEventListener("pointermove", function (e) {
      if (!pts) return;
      var p = m.mouseEventToContainerPoint(e), last = pts[pts.length - 1];
      if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 4) return;
      pts.push(p);
      if (pts.length === 3) admin.layer.clearLayers();
      if (pts.length >= 3) {
        var ll = pts.map(function (q) { return m.containerPointToLatLng(q); });
        if (line) line.setLatLngs(ll); else line = L.polyline(ll, { color: "#1677e8", weight: 3, interactive: false }).addTo(admin.layer);
      }
    });
    function end() {
      if (!pts) return;
      var stroke = pts; pts = null; line = null;
      if (stroke.length < 6) { redrawShapes(); return; }              // too short: treat it as a click
      admin.justDrew = true; setTimeout(function () { admin.justDrew = false; }, 400);
      var tol = 3, simple = simplify(stroke, tol);
      while (simple.length > 100) { tol *= 1.5; simple = simplify(stroke, tol); }
      if (simple.length >= 3) {
        admin.poly = simple.map(function (q) { var ll = m.containerPointToLatLng(q); return [+ll.lat.toFixed(6), +ll.lng.toFixed(6)]; });
        var f = $("arrHbForm"); if (f) { f.lat.value = ""; f.lng.value = ""; }   // re-centre the pin on the new shape
        fixPin();
      }
      redrawShapes();
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
  // Ramer–Douglas–Peucker on screen points (tolerance in pixels).
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    var a = pts[0], b = pts[pts.length - 1], best = 0, k = 0;
    for (var i = 1; i < pts.length - 1; i++) {
      var d = segDist(pts[i], a, b);
      if (d > best) { best = d; k = i; }
    }
    if (best <= tol) return [a, b];
    var left = simplify(pts.slice(0, k + 1), tol), right = simplify(pts.slice(k), tol);
    return left.slice(0, -1).concat(right);
  }
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    var t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    var x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
    return Math.sqrt(x * x + y * y);
  }

  // ---------------------------------------------------------------- Box tool (2026-11-03)
  // Click on the map and drag: a box follows the pointer and is saved as a 4-corner boundary (no database change).
  // Afterwards: drag a corner to resize, the middle to move, the round handle to turn it. Press and drag again to redraw.
  var DOCK_ICON = {
    pan: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="1.5" stroke-dasharray="3 3"/><path d="M4 6h3M4 6v3M20 18h-3M20 18v-3"/></svg>',
    poly: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17 8 6l8 2 3 9-7 3z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2"/></svg>',
    test: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></svg>'
  };
  function dockHtml() {
    var isNew = !(admin.sel && admin.sel.id);
    return '<div class="arr-dock" role="toolbar" aria-label="Zone tools">' +
      dockTool("pan", "Move", DOCK_ICON.pan, false) + dockTool("box", "Box", DOCK_ICON.box, false) + dockTool("poly", "Freehand", DOCK_ICON.poly, false) + dockTool("pin", "Circle", DOCK_ICON.pin, false) +
      dockTool("test", "Test a point", DOCK_ICON.test, isNew) + '<span class="arr-dock-sep"></span>' +
      (admin.mode === "poly" ? '<button type="button" class="arr-dock-act" data-arr-poly-undo title="Remove the last corner">Undo</button>' : '') +
      '<button type="button" class="arr-dock-act" data-arr-fit title="Zoom to the zone">Fit</button>' +
      '<button type="button" class="arr-dock-act danger" data-arr-poly-clear title="Remove the box or boundary">Clear</button>' +
      '<span class="arr-dock-sep"></span>' +
      dockAct("data-arr-new", "New", !(admin.sel && admin.sel.id), "Start a new harbour and draw its zone") +
      dockAct("data-arr-add", "Add", !(admin.sel && admin.sel.id), "Save this drawing as a new harbour") +
      dockAct("data-arr-edit", "Edit", !!(admin.sel && admin.sel.id) || !!admin.armEdit, "Change a harbour. Click one on the map if none is open") +
      dockAct("data-arr-fs", admin.fs ? "Exit" : "Full screen", !!admin.fs, "Use the whole screen to pick and draw harbours") +
    '</div>';
  }
  function dockAct(attr, label, hot, title) {
    return '<button type="button" class="arr-dock-act' + (hot ? " hot" : "") + '" ' + attr + ' title="' + esc(title) + '">' + label + '</button>';
  }
  function setFs(on) {
    if (!admin) return;
    admin.fs = !!on;
    document.documentElement.classList.toggle("arr-map-fs", admin.fs);
    var b = admin.el && admin.el.querySelector("[data-arr-fs]");
    if (b) {
      b.textContent = admin.fs ? "Exit" : "Full screen";
      b.classList.toggle("hot", admin.fs);
    }
    if (admin.map) {
      setTimeout(function () { if (admin && admin.map) admin.map.invalidateSize(); }, 40);
      setTimeout(function () { if (admin && admin.map) admin.map.invalidateSize(); }, 240);
    }
  }
  function selectHarbour(id) {
    var h = admin.harbours.filter(function (x) { return x.id === id; })[0];
    if (!h) return;
    admin.armEdit = false;
    admin.sel = h;
    admin.poly = h.polygon || [];
    admin.box = null;
    admin.test = null;
    admin.view = null;
    admin.mode = h.geofence_type === "polygon" ? (polyToBox(admin.poly) ? "box" : "poly") : "pin";
    paintAdmin();
  }
  function harbourPickable() {
    if (!admin || admin.mode === "poly" || admin.mode === "test") return false;
    if (!admin.readOnly && admin.mode === "box" && !admin.box) return false;
    return !!(admin.readOnly || admin.armEdit || admin.mode === "pan");
  }
  function dockTool(mode, label, icon, disabled) {
    return '<button type="button" class="arr-dock-btn' + (admin.mode === mode ? " on" : "") + '" data-arr-mode="' + mode + '"' + (disabled ? " disabled" : "") + '>' + icon + '<span>' + label + '</span></button>';
  }
  function hintText() {
    if (admin.armEdit) return "Click a harbour on the map to edit it. Full screen stays open while you pick.";
    if (admin.readOnly) return admin.tab === "harbours" && !admin.isPlatform ? "Geofences are set by the KAHDHU platform owner. You can look but not change. Drag the map to move around." : "You can look at the zones here. Drag the map to move around.";
    if (admin.mode === "pan") return "Drag the map to move around · scroll or pinch to zoom · pick Box to draw";
    if (admin.mode === "box") return admin.box
      ? "Drag the map to move around · corners resize · middle moves the box · round handle turns · press Box again to draw a new one"
      : "Click and drag to draw a box around the berths · hold Space (or pick Move) to drag the map";
    if (admin.mode === "poly") return "Press and drag around the berths, or click corner by corner · hold Space (or pick Move) to drag the map";
    if (admin.mode === "test") return "Click the map to see what detection would decide there. Drag to move around.";
    return "Click the map to put the harbour pin. Drag to move around. The circle follows the radius on the right.";
  }
  var M_LAT = 111320;
  function toXY(c, p) { return [(p[1] - c[1]) * M_LAT * Math.cos(c[0] * Math.PI / 180), (p[0] - c[0]) * M_LAT]; }   // [east, north] metres from c
  function fromXY(c, x, y) { return [c[0] + y / M_LAT, c[1] + x / (M_LAT * Math.cos(c[0] * Math.PI / 180))]; }
  function r6(p) { return [+p[0].toFixed(6), +p[1].toFixed(6)]; }
  /** Corners in the box's own frame: top-left, top-right, bottom-right, bottom-left. ang = degrees clockwise from north. */
  function boxCorners(b) {
    var a = b.ang * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), hw = b.w / 2, hh = b.h / 2;
    return [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(function (q) { return r6(fromXY(b.c, q[0] * c + q[1] * s, -q[0] * s + q[1] * c)); });
  }
  /** A saved 4-corner boundary that is a rectangle opens as a box again. Anything else stays a free boundary. */
  function polyToBox(poly) {
    if (!poly || poly.length !== 4) return null;
    var c = [0, 0]; poly.forEach(function (p) { c[0] += p[0] / 4; c[1] += p[1] / 4; });
    var v = poly.map(function (p) { return toXY(c, p); });
    function sub(a, b) { return [b[0] - a[0], b[1] - a[1]]; }
    function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
    var e1 = sub(v[0], v[1]), e2 = sub(v[1], v[2]), e3 = sub(v[2], v[3]), e4 = sub(v[3], v[0]), l1 = len(e1), l2 = len(e2);
    if (l1 < 1 || l2 < 1 || Math.abs((e1[0] * e2[0] + e1[1] * e2[1]) / (l1 * l2)) > 0.06) return null;
    if (Math.abs(len(e3) - l1) / l1 > 0.06 || Math.abs(len(e4) - l2) / l2 > 0.06) return null;
    return { c: r6(c), w: l1, h: l2, ang: Math.atan2(-e1[1], e1[0]) * 180 / Math.PI };
  }
  function boxFromDrag(a, b) {
    var d = toXY(a, b);
    return { c: fromXY(a, d[0] / 2, d[1] / 2), w: Math.abs(d[0]), h: Math.abs(d[1]), ang: 0 };
  }
  function polyAreaM2(poly) {
    if (!poly || poly.length < 3) return 0;
    var v = poly.map(function (p) { return toXY(poly[0], p); }), a = 0;
    for (var i = 0, j = v.length - 1; i < v.length; j = i++) a += v[j][0] * v[i][1] - v[i][0] * v[j][1];
    return Math.abs(a) / 2;
  }
  function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m"; }
  function fmtArea(a) { return a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + " km²" : a >= 10000 ? (a / 10000).toFixed(a >= 100000 ? 0 : 1) + " ha" : Math.round(a) + " m²"; }
  function hudHtml() {
    if (!admin) return "";
    var f = $("arrHbForm"), chips = [];
    if (admin.mode === "box" && admin.box) {
      var b = admin.box;
      chips = [fmtM(b.w) + " × " + fmtM(b.h), fmtArea(b.w * b.h), "turned " + Math.round(((b.ang % 360) + 360) % 360) + "°"];
      if (Math.max(b.w, b.h) > 1500) chips.push("⚠ very large for a harbour — zoom in and keep it to the berths");
    } else if (admin.poly.length >= 3 && (admin.mode === "poly" || admin.mode === "box" || (f && f.geofence_type.value === "polygon"))) {
      chips = [admin.poly.length + " corners", fmtArea(polyAreaM2(admin.poly))];
    } else if (f && f.radius_m && f.lat.value) {
      chips = ["Circle · " + (Number(f.radius_m.value) || 150) + " m radius"];
    }
    return chips.map(function (c, i) { return i === 0 ? '<b>' + esc(c) + '</b>' : '<span' + (c.charAt(0) === "⚠" ? ' class="warn"' : "") + '>' + esc(c) + '</span>'; }).join("");
  }
  function zoneStateHtml() {
    var f = $("arrHbForm"), h = admin && admin.sel || {};
    var drawn = (admin.poly && admin.poly.length >= 3) || (f ? (f.lat.value && f.lng.value) : h.lat != null);
    if (!drawn) return '<i class="dot"></i><span><strong>Draw the zone</strong> Click on the map and drag a box around the berths.</span>';
    var b = admin.mode === "box" && admin.box;
    var what = b ? fmtM(admin.box.w) + " × " + fmtM(admin.box.h) : admin.poly.length >= 3 ? admin.poly.length + "-corner boundary" : "circle";
    return '<i class="dot on"></i><span><strong>Zone ready</strong> ' + esc(what) + '. Drag the handles on the map to adjust.</span>';
  }
  function paintHud() {
    var el = $("arrHud"), h = $("arrHint");
    if (el) { el.innerHTML = hudHtml(); el.classList.toggle("on", !!el.innerHTML); }
    if (h) h.textContent = hintText();
    var z = $("arrZoneState"); if (z) z.innerHTML = zoneStateHtml();
  }
  /** Change tool without rebuilding the map: the view stays where you panned and zoomed. */
  function switchMode(mode) {
    keepForm();
    admin.mode = mode; admin.test = null;
    if (mode !== "pan") admin.armEdit = false;
    if (mode === "poly" || (mode === "box" && admin.poly.length)) admin.sel = Object.assign(admin.sel || {}, { geofence_type: "polygon" });
    admin.box = mode === "box" ? polyToBox(admin.poly) : null;
    var f = $("arrHbForm");
    if (f && admin.sel && admin.sel.geofence_type) f.geofence_type.value = admin.sel.geofence_type;
    var dock = admin.el.querySelector(".arr-dock"); if (dock) dock.outerHTML = dockHtml();
    redrawShapes();
  }
  /** Dragging moves the map, except while a box (no box yet) or a freehand boundary is being drawn. Hold Space to move the map anyway. */
  function syncPan() {
    var m = admin && admin.map; if (!m) return;
    var draws = !admin.readOnly && !admin.space && ((admin.mode === "box" && !admin.box) || admin.mode === "poly");
    if (draws) { m.dragging.disable(); } else { m.dragging.enable(); }
    m.getContainer().classList.toggle("arr-drawing", draws);
  }
  function boxDraw(el) {
    var m = admin.map, start = null, px = null, prev = null;
    m.doubleClickZoom.disable(); m.boxZoom.disable();
    function finish(e, cancel) {
      if (!start) return;
      var a = start, moved = px && e ? Math.hypot(e.clientX - px[0], e.clientY - px[1]) : 0;
      start = null; px = null; admin.cancelDraw = null;
      if (prev) { admin.map.removeLayer(prev); prev = null; }
      if (cancel || !e) { paintHud(); return; }
      if (moved < 10) return;                                    // a plain click: the map click handler places the pin
      var ll = m.mouseEventToLatLng(e), b = boxFromDrag(a, [ll.lat, ll.lng]);
      if (b.w < 3 || b.h < 3) { paintHud(); return; }
      admin.justDrew = true; setTimeout(function () { admin.justDrew = false; }, 400);
      b.c = r6(b.c); admin.box = b; commitBox(true);
    }
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || admin.mode !== "box" || admin.space || admin.box || e.target.closest(".arr-handle, .leaflet-control, .arr-dock, .arr-hud, .arr-hint")) return;
      var ll = m.mouseEventToLatLng(e);
      start = [ll.lat, ll.lng]; px = [e.clientX, e.clientY];
      admin.cancelDraw = function () { finish(null, true); };
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault();
    });
    el.addEventListener("pointermove", function (e) {
      if (!start) return;
      var ll = m.mouseEventToLatLng(e), b = boxFromDrag(start, [ll.lat, ll.lng]), pts = boxCorners(b);
      if (prev) prev.setLatLngs(pts); else prev = L.polygon(pts, { color: "#1677e8", weight: 3, dashArray: "8 6", fillColor: "#1677e8", fillOpacity: 0.16, interactive: false, className: "arr-box-draw" }).addTo(m);
      var h = $("arrHud"); if (h) { h.innerHTML = '<b>' + esc(fmtM(b.w) + " × " + fmtM(b.h)) + '</b><span>' + esc(fmtArea(b.w * b.h)) + '</span>'; h.classList.add("on"); }
    });
    el.addEventListener("pointerup", function (e) { finish(e, false); });
    el.addEventListener("pointercancel", function () { finish(null, true); });
  }
  /** Write the box into the boundary and the form, then redraw it with its handles. */
  function commitBox(recentre) {
    var f = $("arrHbForm"), b = admin.box;
    if (!b) return;
    admin.poly = boxCorners(b);
    if (f) {
      f.geofence_type.value = "polygon";
      if (recentre || !f.lat.value) { f.lat.value = b.c[0]; f.lng.value = b.c[1]; }
    }
    fixPin();
    redrawShapes();
  }
  function placeRot() {
    var b = admin && admin.box, hs = admin && admin.hs;
    if (!b || !hs || !hs.rot || !admin.map) return;
    var a = b.ang * Math.PI / 180, mpp = 156543.03392 * Math.cos(b.c[0] * Math.PI / 180) / Math.pow(2, admin.map.getZoom()), d = b.h / 2 + mpp * 36;
    var p = fromXY(b.c, d * Math.sin(a), d * Math.cos(a)), top = fromXY(b.c, (b.h / 2) * Math.sin(a), (b.h / 2) * Math.cos(a));
    hs.rot.setLatLng(p); if (hs.stem) hs.stem.setLatLngs([top, p]);
  }
  function syncBox(skip) {
    var b = admin.box, hs = admin.hs, pts = boxCorners(b);
    admin.poly = pts;
    hs.poly.setLatLngs(pts);
    hs.corners.forEach(function (mk, i) { if (skip !== "c" + i) mk.setLatLng(pts[i]); });
    if (skip !== "mid") hs.mid.setLatLng(b.c);
    if (skip !== "rot") placeRot();
    var h = $("arrHud"); if (h) { h.innerHTML = hudHtml(); h.classList.add("on"); }
  }
  function drawBoxHandles() {
    var b = admin.box, m = admin.map, edit = !admin.readOnly;
    if (!b || !m) return;
    var hs = admin.hs = { corners: [] };
    hs.poly = L.polygon(boxCorners(b), { color: "#1677e8", weight: 3, fillColor: "#1677e8", fillOpacity: 0.18, interactive: false, className: "arr-box-shape" }).addTo(admin.layer);
    if (!edit) return;
    function icon(cls) { return L.divIcon({ className: "arr-handle " + cls, html: "<i></i>", iconSize: [22, 22], iconAnchor: [11, 11] }); }
    function mk(pos, cls) { return L.marker(pos, { draggable: true, keyboard: false, icon: icon(cls), zIndexOffset: 800 }).addTo(admin.layer); }
    var pts = boxCorners(b);
    pts.forEach(function (p, i) {
      var corner = mk(p, "arr-h-corner"), opp = null;
      corner.on("dragstart", function () { opp = boxCorners(admin.box)[(i + 2) % 4]; });
      corner.on("drag", function (e) {
        if (!opp) return;
        var ll = e.target.getLatLng(), d = toXY(opp, [ll.lat, ll.lng]), a = admin.box.ang * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
        var u = d[0] * c - d[1] * s, v = d[0] * s + d[1] * c;
        var w = Math.max(2, Math.abs(u)), h = Math.max(2, Math.abs(v)), uu = (u < 0 ? -w : w) / 2, vv = (v < 0 ? -h : h) / 2;
        admin.box = { c: r6(fromXY(opp, uu * c + vv * s, -uu * s + vv * c)), w: w, h: h, ang: admin.box.ang };
        syncBox("c" + i);
      });
      corner.on("dragend", function () { commitBox(false); });
      hs.corners.push(corner);
    });
    hs.mid = mk(b.c, "arr-h-move");
    hs.mid.on("drag", function (e) { var ll = e.target.getLatLng(); admin.box.c = [ll.lat, ll.lng]; syncBox("mid"); });
    hs.mid.on("dragend", function () { admin.box.c = r6(admin.box.c); commitBox(false); });
    hs.stem = L.polyline([b.c, b.c], { color: "#1677e8", weight: 2, dashArray: "3 4", interactive: false }).addTo(admin.layer);
    hs.rot = mk(b.c, "arr-h-rot");
    hs.rot.on("drag", function (e) {
      var ll = e.target.getLatLng(), d = toXY(admin.box.c, [ll.lat, ll.lng]), ang = Math.atan2(d[0], d[1]) * 180 / Math.PI;
      var snap = Math.round(ang / 15) * 15;
      if (e.originalEvent && !e.originalEvent.shiftKey && Math.abs(ang - snap) < 2.5) ang = snap;     // sticks near 0°, 15°, 30°…; hold Shift for free turning
      admin.box.ang = ang; syncBox("rot");
    });
    hs.rot.on("dragend", function () { commitBox(false); });
    placeRot();
  }

  function isPolyMode() { var f = $("arrHbForm"); return admin.mode === "poly" || (f && f.geofence_type.value === "polygon"); }
  function polyNote() {
    var n = admin.poly.length;
    return n >= 3 ? "Boundary: " + n + " corners. Save to keep it." : "Boundary: " + n + " of at least 3 corners. With “Draw boundary” on, click and drag around the berths, or click corner by corner.";
  }
  function insidePoly(lat, lng, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function fixPin() {
    var f = $("arrHbForm"), n = admin.poly.length;
    if (!f || !n) return;
    var la = Number(f.lat.value), lo = Number(f.lng.value), has = f.lat.value !== "" && f.lng.value !== "" && isFinite(la) && isFinite(lo);
    if (has && (n < 3 || insidePoly(la, lo, admin.poly))) return;
    var c = admin.poly.reduce(function (a, p) { return [a[0] + p[0] / n, a[1] + p[1] / n]; }, [0, 0]);
    if (n >= 3 && !insidePoly(c[0], c[1], admin.poly)) c = admin.poly[0];
    f.lat.value = +c[0].toFixed(6); f.lng.value = +c[1].toFixed(6);
  }
  function redrawShapes() {
    if (!admin || !admin.layer) return;
    admin.layer.clearLayers();
    var f = $("arrHbForm");
    admin.harbours.forEach(function (x) {
      if (admin.sel && x.id === admin.sel.id) return;
      shape(x.geofence_type, x.lat, x.lng, x.radius_m, x.polygon, "#94a3b8", x.name, x.id);
    });
    var note = $("arrPolyNote"); if (note) note.textContent = polyNote();
    paintHud(); syncPan();
    if (f && admin.mode === "box" && admin.box) {
      drawBoxHandles();
    } else if (f && isPolyMode() && admin.poly.length) {
      if (admin.poly.length >= 3) L.polygon(admin.poly, { color: "#1677e8", weight: 3, fillOpacity: 0.2 }).addTo(admin.layer);
      else L.polyline(admin.poly, { color: "#1677e8", weight: 3, dashArray: "6 6" }).addTo(admin.layer);
      if (admin.mode === "poly") admin.poly.forEach(function (pt, i) {
        L.marker(pt, { draggable: admin.mode === "poly" && !admin.readOnly, keyboard: false, zIndexOffset: 500,
          icon: L.divIcon({ className: "arr-corner", html: "<span>" + (i + 1) + "</span>", iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .on("dragend", function (e) { var ll = e.target.getLatLng(); admin.poly[i] = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)]; fixPin(); redrawShapes(); })
          .addTo(admin.layer);
      });
    }
    if (f && f.lat.value && f.lng.value) {
      var la = Number(f.lat.value), lo = Number(f.lng.value);
      if (isFinite(la) && isFinite(lo)) {
        if (!isPolyMode()) shape("circle", la, lo, Number(f.radius_m.value) || 150, null, "#1677e8", f.name.value || "New harbour");
        L.circleMarker([la, lo], { radius: 5, color: "#0f172a", weight: 2, fillColor: "#fff", fillOpacity: 1 }).bindTooltip("Harbour pin").addTo(admin.layer);
        L.circle([la, lo], { radius: Number(f.approach_m.value) || 2000, color: "#1677e8", weight: 1, dashArray: "4 6", fill: false }).addTo(admin.layer);
      }
    }
  }
  function shape(type, lat, lng, radius, poly, color, title, id) {
    var pick = !!(id && harbourPickable());
    var layer = (type === "polygon" && poly && poly.length >= 3)
      ? L.polygon(poly, { color: color, weight: 2, interactive: pick })
      : L.circle([lat, lng], { radius: radius, color: color, weight: 2, interactive: pick });
    layer.bindTooltip(title);
    if (pick) layer.on("click", function (ev) { L.DomEvent.stopPropagation(ev); selectHarbour(id); });
    layer.addTo(admin.layer);
    L.circleMarker([lat, lng], { radius: 4, color: color, fillOpacity: 1, interactive: false }).addTo(admin.layer);
  }

  function saveHarbour(f) {
    var msg = $("arrHbMsg"), cid = admin.cid, h = admin.sel || {};
    if (!admin.isPlatform) { msg.textContent = "Only the KAHDHU platform owner can change harbours and geofences."; return; }
    var lat = Number(f.lat.value), lng = Number(f.lng.value);
    if (!f.name.value.trim()) { msg.textContent = "Give the harbour a name."; return; }
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      msg.textContent = "Draw the zone on the map first: click and drag a box around the berths."; return;
    }
    if (f.geofence_type.value === "polygon" && admin.poly.length < 3) { msg.textContent = "Draw at least 3 boundary points."; return; }
    msg.textContent = "Saving…";
    var islandText = f.island.value.trim();
    var island = admin.islands.filter(function (i) { return i.name.toLowerCase() === islandText.toLowerCase(); })[0];
    var getIsland = !islandText ? Promise.resolve(null)
      : island ? Promise.resolve(island.id)
      : tbl("islands").insert({ company_id: cid, name: islandText }).select("id").single().then(check).then(function (r) { return r.id; });
    getIsland.then(function (islandId) {
      var row = {
        company_id: cid, name: f.name.value.trim(), code: f.code.value.trim() || null, island_id: islandId, lat: lat, lng: lng,
        geofence_type: f.geofence_type.value, radius_m: Number(f.radius_m.value), approach_m: Number(f.approach_m.value),
        max_accuracy_m: Number(f.max_accuracy_m.value), dwell_sec: Number(f.dwell_sec.value), min_obs: Number(f.min_obs.value),
        polygon: admin.poly.length >= 3 ? admin.poly : null, allow_overlap: f.allow_overlap.checked, active: f.active.checked
      };
      return (h.id ? tbl("harbours").update(row).eq("id", h.id) : tbl("harbours").insert(row)).select("*").single().then(check);
    }).then(function (saved) {
      admin.sel = saved; admin.poly = saved.polygon || [];
      return loadAdmin();
    }).then(function () { var m = $("arrHbMsg"); if (m) m.textContent = "Saved."; }, function (e) { var m = $("arrHbMsg"); if (m) m.textContent = e.message; });
  }

  // ---------------------------------------------------------------- Autopilot (Claude 2026-10-28, migration 0060)
  // Harbours and route links learned from GPS: live status, map of learned harbours / candidates / stops, activity feed
  // with undo. Refreshes itself every 20 s while open without redrawing the map.
  function ago2(iso) {
    if (!iso) return "never";
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
  }
  function ring(p, label) {
    var a = Math.max(0, Math.min(1, p || 0)), c = 2 * Math.PI * 16;
    return '<svg class="arr-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" class="bg"/>' +
      '<circle cx="20" cy="20" r="16" class="fg" stroke-dasharray="' + (a * c).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg><b>' + esc(label) + '</b>';
  }
  function autoHtml() {
    var L0 = admin.learn;
    if (!L0) return '<div class="arr-ap-empty"><h3>Autopilot is not installed yet</h3><p class="note">Harbour learning needs database migration 0060 on this project.</p></div>';
    return '<div class="arr-ap">' +
      '<div class="arr-ap-hero" id="arrApHero">' + heroHtml() + '</div>' +
      '<div class="arr-ap-grid">' +
        '<div class="arr-ap-mapcard"><div id="arrApMap" class="arr-map arr-ap-map"></div>' +
          '<div class="arr-ap-legend"><span><i class="lg h"></i>Harbour</span><span><i class="lg a"></i>Learned automatically</span>' +
          '<span><i class="lg c"></i>Learning (ring = progress)</span><span><i class="lg s"></i>Recent stop</span><span><i class="lg d"></i>Dismissed</span></div></div>' +
        '<aside class="arr-ap-side"><div id="arrApCands">' + candsHtml() + '</div><h3>Activity</h3><ol class="arr-feed" id="arrApFeed">' + feedHtml() + '</ol></aside>' +
      '</div></div>';
  }
  function heroHtml() {
    var L0 = admin.learn, c = L0.cfg || {}, on = c.autoLearn !== false, sm = L0.summary || {};
    var routesP = L0.routes_total ? L0.routes_complete / L0.routes_total : 0;
    var learned = admin.harbours.filter(function (h) { return h.meta && h.meta.auto && h.active; }).length;
    return '<div class="arr-ap-state ' + (on ? "on" : "off") + '"><i class="pulse"></i><div><strong>' + (on ? "Learning automatically" : "Autopilot is off") + '</strong>' +
        '<small>Last run ' + esc(ago2(L0.last_run_at)) + (sm.new_stops != null ? " · " + sm.new_stops + " new stops" : "") + '</small></div></div>' +
      '<div class="arr-ap-kpis">' +
        kpi2(L0.tracked_vessels + "/" + L0.vessels, "vessels sending GPS", L0.tracked_vessels ? "" : "warn") +
        kpi2(L0.fixes_24h, "GPS fixes, 24 h") +
        kpi2(L0.stops_total, "stops found") +
        kpi2(learned, "harbours learned") +
        '<div class="arr-kpi ring">' + ring(routesP, Math.round(routesP * 100) + "%") + '<small>' + L0.routes_complete + ' of ' + L0.routes_total + ' routes ready</small></div>' +
      '</div>' +
      '<div class="arr-ap-actions">' +
        '<label class="arr-switch"><input type="checkbox" data-arr-toggle="autoLearn"' + (on ? " checked" : "") + '><span></span>Learn harbours</label>' +
        '<label class="arr-switch"><input type="checkbox" data-arr-toggle="autoLink"' + (c.autoLink !== false ? " checked" : "") + '><span></span>Link routes</label>' +
        '<button type="button" class="save" data-arr-learn>Learn now</button></div>' +
      (L0.tracked_vessels ? "" : '<p class="arr-warn arr-ap-hint">No vessel has a FollowMe link yet, so there is no GPS to learn from. Add the links under Fleet → Edit vessel.</p>') +
      (L0.open_trips_without_harbour ? '<p class="arr-ap-hint">' + L0.open_trips_without_harbour + ' open trips are still waiting for a harbour. They keep the clock arrival until then.</p>' : "");
  }
  function kpi2(v, label, tone) { return '<div class="arr-kpi ' + (tone || "") + '"><strong>' + esc(v) + '</strong><small>' + esc(label) + '</small></div>'; }
  function candsHtml() {
    var list = (admin.learn.candidates || []).filter(function (c) { return c.status !== "dismissed"; });
    var need = admin.learn.cfg || {};
    if (!list.length) return '<h3>Learning</h3><p class="note">No new spots yet. Wherever boats stop at the start or end of trips, a candidate appears here and becomes a harbour once it has ' +
      esc(need.learnMinStops) + ' stops on ' + esc(need.learnMinDays) + ' days.</p>';
    return '<h3>Learning <small>' + list.length + '</small></h3><ul class="arr-cands">' + list.slice(0, 8).map(function (c) {
      return '<li><button type="button" data-arr-cand="' + esc(c.id) + '" class="' + (c.status === "conflict" ? "conf" : "") + '">' +
        '<span class="arr-cring">' + ring(c.progress, Math.round(c.progress * 100) + "%") + '</span>' +
        '<span class="grow"><strong>' + esc(c.name_guess || "Unnamed spot") + '</strong><small>' + c.stops + ' stop' + (c.stops === 1 ? "" : "s") + ' · ' + c.days + ' day' + (c.days === 1 ? "" : "s") + ' · ' + c.vessels + ' vessel' + (c.vessels === 1 ? "" : "s") +
        (c.trip_stops ? "" : " · no trip yet") + '</small>' + (c.status === "conflict" ? '<small class="err">' + esc(c.detail || "") + '</small>' : "") + '</span></button></li>';
    }).join("") + '</ul>';
  }
  function feedHtml() {
    var log = admin.learn.log || [];
    if (!log.length) return '<li class="arr-feed-empty">Nothing learned yet.</li>';
    return log.map(function (l) {
      var ic = l.kind === "harbour_created" ? "⚓" : l.kind === "route_linked" ? "↔" : "!";
      return '<li class="' + (l.undone_at ? "undone" : "") + '"><i class="k-' + esc(l.kind) + '">' + ic + '</i><div><p>' + esc(l.detail) + '</p><small>' + esc(ago2(l.at)) +
        (l.method ? " · " + (l.method === "gps" ? "from GPS" : "name match") : "") + (l.undone_at ? " · undone" : "") + '</small></div>' +
        (!l.undone_at && l.kind !== "candidate_conflict" && !admin.readOnly ? '<button type="button" class="arr-link" data-arr-undo="' + l.id + '">Undo</button>' : "") + '</li>';
    }).join("");
  }
  function drawAutoMap() {
    var el = $("arrApMap");
    if (!el || !window.L) return;
    var pts = admin.harbours.map(function (h) { return [h.lat, h.lng]; }).concat((admin.learn.candidates || []).map(function (c) { return [c.lat, c.lng]; }));
    // Canvas renderer: settings.css sizes every <svg> to 20 px, which would hide SVG zones.
    admin.map = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView(pts[0] || [4.2, 73.5], pts.length ? 13 : 9);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 17, attribution: "Tiles &copy; Esri" }).addTo(admin.map);
    admin.layer = L.layerGroup().addTo(admin.map);
    paintAutoLayers();
    if (pts.length > 1) admin.map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
  }
  function paintAutoLayers() {
    if (!admin || !admin.layer || !admin.learn) return;
    admin.layer.clearLayers();
    (admin.learn.stops || []).forEach(function (s) {
      L.circleMarker([s.lat, s.lng], { radius: 3, weight: 0, fillColor: s.h ? "#38bdf8" : "#facc15", fillOpacity: 0.8, interactive: false }).addTo(admin.layer);
    });
    admin.harbours.forEach(function (h) {
      var auto = h.meta && h.meta.auto, col = !h.active ? "#94a3b8" : auto ? "#a855f7" : "#22c55e";
      shape(h.geofence_type, h.lat, h.lng, h.radius_m, h.polygon, col, h.name + (auto ? " · learned automatically" : ""));
    });
    (admin.learn.candidates || []).forEach(function (c) {
      var dis = c.status === "dismissed", col = dis ? "#94a3b8" : c.status === "conflict" ? "#ef4444" : "#f59e0b";
      L.circle([c.lat, c.lng], { radius: c.radius_m, color: col, weight: 2, dashArray: "5 6", fillColor: col, fillOpacity: dis ? 0.04 : 0.08 + 0.25 * (c.progress || 0) })
        .bindTooltip((c.name_guess || "Unnamed spot") + (dis ? " · dismissed" : " · " + Math.round((c.progress || 0) * 100) + "% learned, " + c.stops + " stops")).addTo(admin.layer);
      if (!dis) L.marker([c.lat, c.lng], { interactive: false, icon: L.divIcon({ className: "arr-cand-pin", html: '<span style="--p:' + (c.progress || 0) + '"></span>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(admin.layer);
    });
  }
  // Light refresh: status only; harbours are reloaded when something new was learned.
  function refreshAuto() {
    if (!liveAdmin() || admin.tab !== "auto" || document.hidden) return;
    var before = admin.learn && admin.learn.log && admin.learn.log[0] && admin.learn.log[0].id;
    rpc("harbour_learning_status", { p_company: admin.cid }).then(function (st) {
      if (!liveAdmin() || admin.tab !== "auto") return;
      admin.learn = st;
      var after = st.log && st.log[0] && st.log[0].id;
      if (after !== before) return loadAdmin();
      var h = $("arrApHero"), c = $("arrApCands"), f = $("arrApFeed");
      if (h) h.innerHTML = heroHtml(); if (c) c.innerHTML = candsHtml(); if (f) f.innerHTML = feedHtml();
      paintAutoLayers();
    }, function () {});
  }
  setInterval(refreshAuto, 20000);
  function saveLearnToggle(key, on) {
    var cur = Object.assign({}, admin.cfg || {}, (admin.learn && admin.learn.cfg) || {});
    delete cur.version;
    cur[key] = on;
    return rpc("set_company_setting", { p_company: admin.cid, p_key: "3_arrival_detection", p_value: cur });
  }

  function routesHtml() {
    var opts = function (sel) {
      return '<option value="">— Not set —</option>' + admin.harbours.filter(function (h) { return h.active || h.id === sel; }).map(function (h) {
        return '<option value="' + esc(h.id) + '"' + (h.id === sel ? " selected" : "") + '>' + esc(h.name) + (islandName(h.island_id) ? " · " + esc(islandName(h.island_id)) : "") + '</option>';
      }).join("");
    };
    var gaps = {};
    ((admin.gaps && admin.gaps.routes) || []).forEach(function (g) { gaps[g.id] = g; });
    var open = admin.gaps ? admin.gaps.open_trips_without_harbour : 0;
    var how = {};
    ((admin.learn && admin.learn.log) || []).forEach(function (l) { if (l.kind === "route_linked" && !l.undone_at && !how[l.route_id + l.field]) how[l.route_id + l.field] = l.method; });
    var act = admin.routes.filter(function (r) { return r.active; }), done = act.filter(function (r) { return r.origin_harbour_id && r.destination_harbour_id; }).length;
    var badge = function (r, f) { var m = how[r.id + f]; return m ? '<em class="arr-badge auto">Auto · ' + (m === "gps" ? "GPS" : "name") + '</em>' : ""; };
    return '<div class="arr-routes">' +
      '<div class="arr-progress"><div><strong>' + done + ' of ' + act.length + '</strong> routes have both harbours</div><span><i style="width:' + (act.length ? Math.round(done / act.length * 100) : 0) + '%"></i></span></div>' +
      '<p class="note">' + (admin.learn ? "Autopilot fills empty ends from where trips really start and end (or an exact name match) and never changes one you set. " : "") +
        'Upcoming and open trips follow the route.</p>' +
      (open ? '<p class="arr-warn">' + open + ' open trip' + (open > 1 ? "s" : "") + ' cannot detect arrival yet.</p>' : "") +
      (admin.harbours.length ? "" : '<p class="arr-warn">Create harbours first (' + (admin.inline ? "Harbours &amp; Geofences" : "Harbours tab") + ').</p>') +
      '<div class="arr-table-wrap"><table class="arr-table"><thead><tr><th>Route</th><th>From</th><th>Origin harbour</th><th>To</th><th>Destination harbour</th><th></th></tr></thead><tbody>' +
      admin.routes.filter(function (r) { return r.active; }).map(function (r) {
        var g = gaps[r.id] || {};
        var sugg = function (list, which) {
          return (list || []).length ? '<small class="arr-sugg">Suggested: ' + list.map(function (s) {
            return '<button type="button" class="arr-link" data-arr-sugg="' + esc(r.id) + '" data-which="' + which + '" data-h="' + esc(s.id) + '">' + esc(s.name) + '</button>';
          }).join(", ") + '</small>' : "";
        };
        return '<tr data-route="' + esc(r.id) + '"><td><strong>' + esc(r.name) + '</strong></td><td>' + esc(r.origin) + '</td>' +
          '<td><select name="o">' + opts(r.origin_harbour_id) + '</select>' + badge(r, "origin") + sugg(g.origin_suggestions, "o") + '</td>' +
          '<td>' + esc(r.destination) + '</td><td><select name="d">' + opts(r.destination_harbour_id) + '</select>' + badge(r, "destination") + sugg(g.destination_suggestions, "d") + '</td>' +
          '<td><button type="button" class="save" data-arr-route-save>Save</button><span class="arr-msg"></span></td></tr>';
      }).join("") + '</tbody></table></div></div>';
  }

  var SETTINGS = [
    ["enabled", "Detect arrivals from GPS", "bool"],
    ["assumedAccuracyM", "Accuracy assumed when a fix has none (m)", 5, 500],
    ["maxDelaySec", "A fix older than this is stale (s)", 30, 86400],
    ["maxGapSec", "Longest gap between fixes inside the zone (s)", 30, 3600],
    ["trackingGapSec", "Tracking unavailable after no fix for (s)", 60, 7200],
    ["maxSpeedKn", "Faster than this between fixes is a GPS jump (kn)", 10, 120],
    ["passThroughKn", "Hold confirmation while faster than (kn, 0 = ignore speed)", 0, 60],
    ["fallbackAfterMin", "Ask Operations to confirm this long after the arrival time (min)", 5, 1440],
    ["clockFallback", "If GPS never confirms, mark Arrived at the scheduled time (labelled “clock”)", "bool"],
    ["completeBookings", "GPS arrival also completes bookings", "bool"],
    ["allowCrewDevices", "Accept crew phone positions (estimated)", "bool"],
    ["autoLearn", "Autopilot: learn harbours from where boats stop", "bool"],
    ["autoLink", "Autopilot: link routes to learned harbours", "bool"],
    ["nameLinks", "Autopilot: link by exact name when there is no GPS yet", "bool"],
    ["learnMinStops", "Stops needed before a spot becomes a harbour", 2, 50],
    ["learnMinDays", "…on at least this many different days", 1, 30],
    ["stopRadiusM", "A stop: boat stays within (m)", 20, 500],
    ["stopMinSec", "…for at least (s)", 60, 7200],
    ["mergeRadiusM", "Stops closer than this are the same spot (m)", 50, 1000]
  ];
  function settingsHtml() {
    var c = Object.assign({}, admin.cfg || {}, (admin.learn && admin.learn.cfg) || {});
    return '<form class="arr-settings" id="arrSetForm">' +
      '<p class="note">Defaults are a starting point for testing. Tune them against real trips: watch the detection log on a few arrivals before relying on it. Per-harbour rules (zone, accuracy, time inside, fixes) are on each harbour.</p>' +
      SETTINGS.map(function (s) {
        if (s[2] === "bool") return '<label class="arr-check"><input type="checkbox" name="' + s[0] + '"' + (c[s[0]] ? " checked" : "") + '> ' + esc(s[1]) + '</label>';
        return field(esc(s[1]), '<input type="number" name="' + s[0] + '" min="' + s[2] + '" max="' + s[3] + '" value="' + esc(c[s[0]]) + '">');
      }).join("") +
      '<div class="arr-actions"><button type="submit" class="save">Save rules</button><span class="arr-msg" id="arrSetMsg" aria-live="polite"></span></div>' +
      '<p class="note">Algorithm ' + esc(c.version || "") + '</p></form>';
  }
  function saveSettings(f) {
    var v = {};
    SETTINGS.forEach(function (s) {
      if (s[2] === "bool") v[s[0]] = f[s[0]].checked;
      else if (f[s[0]].value !== "") v[s[0]] = Number(f[s[0]].value);
    });
    $("arrSetMsg").textContent = "Saving…";
    var cid = admin.cid;
    rpc("set_company_setting", { p_company: cid, p_key: "3_arrival_detection", p_value: v }).then(function () {
      return rpc("arrival_cfg", { p_company: cid });
    }).then(function (c) {
      admin.cfg = c; $("arrSetMsg").textContent = "Saved.";
      return rpc("harbour_learning_status", { p_company: cid }).then(function (st) { if (admin) admin.learn = st; }, function () {});
    }, function (e) { $("arrSetMsg").textContent = e.message; });
  }

  // ---------------------------------------------------------------- events
  document.addEventListener("click", function (e) {
    var t = e.target;
    var a = t.closest("[data-arr-admin]");
    if (a) { e.preventDefault(); openAdmin(a.getAttribute("data-arr-admin") || "auto"); return; }
    var row = t.closest("[data-arr-trip]");
    if (row && ops && ops.openTrip) { ops.openTrip(row.getAttribute("data-arr-trip"), "tracking"); return; }
    if (!liveAdmin()) return;
    if (!admin.inline && (t.closest("[data-arr-close]") || t === admin.el)) { closeAdmin(); return; }
    var tab = t.closest("[data-arr-tab]");
    if (tab) { admin.tab = tab.getAttribute("data-arr-tab"); admin.view = null; paintAdmin(); return; }
    var pick = t.closest("[data-arr-pick]");
    if (pick) { selectHarbour(pick.getAttribute("data-arr-pick")); return; }
    if (t.closest("[data-arr-new]")) { admin.armEdit = false; admin.sel = null; admin.poly = []; admin.box = null; admin.test = null; admin.mode = "box"; admin.view = null; paintAdmin(); return; }
    if (t.closest("[data-arr-fs]")) { setFs(!admin.fs); return; }
    if (t.closest("[data-arr-add]")) {
      var addForm = $("arrHbForm");
      if (!addForm || admin.readOnly) return;
      if (admin.sel && admin.sel.id) {
        var addMsg = $("arrHbMsg");
        if (addMsg) addMsg.textContent = "This harbour is already saved. Press Edit to change it, or New to draw another.";
        if (!admin.fs) addForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      if (!addForm.name.value.trim()) {
        addForm.name.focus();
        var needName = $("arrHbMsg");
        if (needName) needName.textContent = "Name the harbour, draw its zone, then press Add.";
        if (!admin.fs) addForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      if (addForm.requestSubmit) addForm.requestSubmit();
      else addForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return;
    }
    if (t.closest("[data-arr-edit]")) {
      if (admin.readOnly) return;
      if (admin.sel && admin.sel.id) {
        setFs(true);
        var editName = $("arrHbForm");
        if (editName && editName.name) editName.name.focus();
        return;
      }
      admin.armEdit = true;
      if (admin.mode !== "pan") switchMode("pan");
      else redrawShapes();
      setFs(true);
      return;
    }
    var mode = t.closest("[data-arr-mode]");
    if (mode) {
      var want = mode.getAttribute("data-arr-mode");
      if (want === "box" && admin.mode === "box" && admin.box && !admin.readOnly) {   // Box pressed again: draw a new one
        admin.box = null; admin.poly = []; var bf = $("arrHbForm"); if (bf) bf.geofence_type.value = "circle";
        redrawShapes(); return;
      }
      if (want !== admin.mode) switchMode(want);
      return;
    }
    if (t.closest("[data-arr-poly-clear]")) {
      admin.poly = []; admin.box = null;
      var cf = $("arrHbForm"); if (cf && admin.mode === "box") cf.geofence_type.value = "circle";
      redrawShapes(); return;
    }
    if (t.closest("[data-arr-fit]")) {
      if (admin.map && admin.poly.length >= 3) admin.map.flyToBounds(L.latLngBounds(admin.poly).pad(0.7), { maxZoom: 18, duration: 0.6 });
      else { var ff = $("arrHbForm"); if (admin.map && ff && ff.lat.value) admin.map.flyTo([Number(ff.lat.value), Number(ff.lng.value)], 16, { duration: 0.6 }); }
      return;
    }
    if (t.closest("[data-arr-poly-undo]")) { admin.poly.pop(); redrawShapes(); return; }
    var lb = t.closest("[data-arr-learn]");
    if (lb) {
      lb.disabled = true; lb.textContent = "Learning…";
      rpc("harbour_learn_now", { p_company: admin.cid }).then(function (r) {
        toast(r.skipped ? "Autopilot is off." : "Learning done: " + r.harbours_created + " harbour" + (r.harbours_created === 1 ? "" : "s") + ", " + r.routes_linked + " route link" + (r.routes_linked === 1 ? "" : "s") + ", " + r.new_stops + " new stops.");
        return loadAdmin();
      }, function (err) { toast(err.message); lb.disabled = false; lb.textContent = "Learn now"; });
      return;
    }
    var ub = t.closest("[data-arr-undo]");
    if (ub) {
      ub.disabled = true;
      rpc("harbour_learning_undo", { p_log: Number(ub.getAttribute("data-arr-undo")) }).then(function (r) { toast(r.message); return loadAdmin(); },
        function (err) { toast(err.message); ub.disabled = false; });
      return;
    }
    var cb = t.closest("[data-arr-cand]");
    if (cb && admin.map) {
      var cand = (admin.learn.candidates || []).filter(function (x) { return x.id === cb.getAttribute("data-arr-cand"); })[0];
      if (cand) admin.map.flyTo([cand.lat, cand.lng], 16, { duration: 0.8 });
      return;
    }
    var sg = t.closest("[data-arr-sugg]");
    if (sg) { var tr = sg.closest("tr"); tr.querySelector('select[name="' + sg.getAttribute("data-which") + '"]').value = sg.getAttribute("data-h"); return; }
    var rs = t.closest("[data-arr-route-save]");
    if (rs) {
      var r = rs.closest("tr"), m = r.querySelector(".arr-msg");
      m.textContent = " Saving…";
      tbl("routes").update({ origin_harbour_id: r.querySelector('select[name="o"]').value || null, destination_harbour_id: r.querySelector('select[name="d"]').value || null })
        .eq("id", r.getAttribute("data-route")).then(check).then(function () { m.textContent = " Saved."; return loadAdmin(); }, function (err) { m.textContent = " " + err.message; });
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && admin && admin.cancelDraw) { admin.escDraw = true; admin.cancelDraw(); }
    if (e.code === "Space" && admin && admin.map && !e.target.closest("input, textarea, select, button") && !admin.space) { admin.space = true; e.preventDefault(); syncPan(); }
  });
  document.addEventListener("keyup", function (e) { if (e.code === "Space" && admin && admin.space) { admin.space = false; syncPan(); } });
  // Keep typed values when the harbour form is redrawn (mode switch).
  function keepForm() {
    var f = $("arrHbForm");
    if (!f) return;
    var cur = admin.sel ? Object.assign({}, admin.sel) : {};
    ["name", "code", "geofence_type"].forEach(function (k) { cur[k] = f[k].value; });
    ["lat", "lng", "radius_m", "approach_m", "max_accuracy_m", "dwell_sec", "min_obs"].forEach(function (k) { cur[k] = f[k].value === "" ? null : Number(f[k].value); });
    cur.allow_overlap = f.allow_overlap.checked; cur.active = f.active.checked;
    var isl = admin.islands.filter(function (i) { return i.name.toLowerCase() === f.island.value.trim().toLowerCase(); })[0];
    cur.island_id = isl ? isl.id : null;
    admin.sel = cur;
  }
  document.addEventListener("input", function (e) { if (liveAdmin() && e.target.closest("#arrHbForm")) redrawShapes(); });
  document.addEventListener("change", function (e) {
    if (!liveAdmin()) return;
    if (e.target.name === "geofence_type") { switchMode(e.target.value === "polygon" ? (polyToBox(admin.poly) || !admin.poly.length ? "box" : "poly") : "pin"); return; }
    var tg = e.target.getAttribute && e.target.getAttribute("data-arr-toggle");
    if (tg) {
      var on = e.target.checked;
      saveLearnToggle(tg, on).then(function () { toast((tg === "autoLearn" ? "Harbour learning " : "Route linking ") + (on ? "on." : "off.")); return loadAdmin(); },
        function (err) { toast(err.message); e.target.checked = !on; });
    }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "arrHbForm" && e.target.id !== "arrSetForm") return;
    e.preventDefault();
    if (!liveAdmin() || admin.readOnly) return;
    if (e.target.id === "arrHbForm") saveHarbour(e.target); else saveSettings(e.target);
  });
  document.addEventListener("keydown", function (e) {
    if (!admin || e.key !== "Escape" || e.target.closest("input, textarea, select")) return;
    if (admin.escDraw) { admin.escDraw = false; return; }
    if (admin.fs) { setFs(false); return; }
    closeAdmin();
  });

  // ---------------------------------------------------------------- wiring
  // operations.js redraws #ops and the trip window often; refill our placeholders whenever they reappear.
  function watch() {
    var mo = new MutationObserver(function () {
      var home = $("opsArrivals");
      if (home && !home.firstChild && board) paintHome();
      var td = $("tdArrival");
      if (td) fillDetail(td);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  function begin() {
    if (ops || !window.VeyoraOps) return;
    ops = window.VeyoraOps;
    tz = (ops.company && ops.company.timezone) || tz;
    watch();
    loadBoard();
    pollTimer = setInterval(function () {
      loadBoard();
      Object.keys(detailCache).forEach(function (k) { if (Date.now() - detailCache[k].at > 20000) delete detailCache[k]; });
      // Refresh the trip panel unless someone is reading an expanded section or typing a correction.
      var td = $("tdArrival");
      if (td && !td.contains(document.activeElement) && !td.querySelector("details[open]")) { td.dataset.filled = ""; fillDetail(td); }
    }, 30000);
  }
  // A page opened in a background tab skips loading until it is shown.
  document.addEventListener("visibilitychange", function () { if (ops && !document.hidden) loadBoard(); });
  document.addEventListener("veyora:ops-company", begin);
  window.VeyoraArrivals = { mountAdmin: mountAdmin, unmountAdmin: dropInline };
  begin();
})();
