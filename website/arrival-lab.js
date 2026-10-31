/* Arrival Lab (Claude 2026-10-28, migration 0059) — platform owner only.
   Draw or generate a GPS track on the map, or replay a real trip's stored fixes, and run it through the live arrival
   algorithm (arrival_simulate → the same arrival_check_obs / arrival_step / arrival_zone as production) with what-if
   harbour rules and 3_arrival_detection settings. Nothing here writes trips, positions or settings.
   Map: Land & sea (Esri topographic, sea blue / land sand), Satellite (Esri) or Street (OSM); every harbour's zone,
   GPS-uncertainty band and approach ring; fixes coloured by the algorithm's verdict.
   Playback: a boat replays the track on its own clock with a live state card and a state timeline; the Autopilot layer
   shows learned harbours, candidates and stops (harbour_learning_status, 0060). */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };

  var company = null, tz = "Indian/Maldives";
  var harbours = [], trips = [], baseCfg = null;
  var S = {
    hid: "", draft: null,                // selected harbour id, or "draft" with draft = {lat, lng}
    track: [],                           // [{lat, lng, t, accuracy_m, speed_kn, delay_s}]
    start: null,                         // ISO time of t = 0 (replays keep the real one)
    rules: { harbour: {}, cfg: {} },     // what-if overrides (only fields that differ from the saved values)
    mode: "add", layer: "landsea", showAll: true, result: null, error: "", busy: false, replay: null,
    play: { t: null, on: false, speed: 30 },  // playback position (seconds on the track clock)
    learnOn: false, learn: null              // Autopilot layer (0060)
  };
  var map = null, tiles = null, zoneLayer = null, trackLayer = null, boatLayer = null, learnLayer = null, runTimer = null, runSeq = 0;
  var raf = 0, lastFrame = 0, playIdx = -1;

  var HFIELDS = [["radius_m", "Radius (m)", 20, 3000], ["approach_m", "Approach zone (m)", 200, 50000], ["max_accuracy_m", "Worst accuracy (m)", 5, 500],
                 ["dwell_sec", "Time inside (s)", 0, 3600], ["min_obs", "Fixes inside", 2, 50]];
  var CFIELDS = [["assumedAccuracyM", "Assumed accuracy (m)", 5, 500], ["maxDelaySec", "Stale after (s)", 30, 86400], ["maxFutureSec", "Clock skew (s)", 0, 600],
                 ["maxGapSec", "Gap inside resets (s)", 30, 3600], ["trackingGapSec", "Tracking unavailable (s)", 60, 7200],
                 ["maxSpeedKn", "GPS jump above (kn)", 10, 120], ["passThroughKn", "Hold while faster (kn)", 0, 60]];
  var DRAFT_DEFAULTS = { radius_m: 150, approach_m: 2000, max_accuracy_m: 50, dwell_sec: 60, min_obs: 3 };
  var COLORS = { inside: "#16a34a", boundary: "#d97706", approach: "#2563eb", outside: "#64748b", rejected: "#dc2626", confirmed: "#7c3aed", after: "#94a3b8" };
  var STATE_LABEL = { NOT_APPROACHING: "Tracking", APPROACHING_DESTINATION: "Approaching destination", ARRIVAL_PENDING: "Arrival pending",
                      ARRIVED: "Arrived", TRACKING_UNAVAILABLE: "Tracking unavailable" };

  function rpc(name, args) { return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }
  function check(r) { if (r.error) throw new Error(r.error.message); return r.data; }
  function num(v) { return v === "" || v == null || !isFinite(Number(v)) ? null : Number(v); }
  function round(v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; }

  // ---- time (company time zone) ----
  function clock(iso) {
    return iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso)) : "—";
  }

  // ---- geometry (only for drawing and for generating test tracks; the verdicts come from the database) ----
  function move(lat, lng, bearing, m) {
    var R = 6371008.8, b = bearing * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180, d = m / R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: round(p2 * 180 / Math.PI, 7), lng: round(l2 * 180 / Math.PI, 7) };
  }

  // ---- the harbour being tested, with what-if overrides applied ----
  function savedHarbour() { return harbours.filter(function (h) { return h.id === S.hid; })[0] || null; }
  function effHarbour() {
    var h = S.hid === "draft" ? (S.draft ? Object.assign({ name: "Draft harbour", geofence_type: "circle" }, DRAFT_DEFAULTS, S.draft) : null) : savedHarbour();
    if (!h) return null;
    var o = Object.assign({}, h);
    HFIELDS.forEach(function (f) { if (S.rules.harbour[f[0]] != null) o[f[0]] = S.rules.harbour[f[0]]; });
    return o;
  }
  function effCfg() {
    var c = Object.assign({}, baseCfg || {});
    CFIELDS.forEach(function (f) { if (S.rules.cfg[f[0]] != null) c[f[0]] = S.rules.cfg[f[0]]; });
    return c;
  }

  // ---------------------------------------------------------------- page
  function render() {
    var el = $("lab");
    el.innerHTML =
      '<div class="lab">' +
        '<aside class="lab-side card">' +
          '<section><h2>Harbour</h2>' +
            '<select id="labHarbour" aria-label="Harbour to test"><option value="">Choose a harbour…</option>' +
              harbours.map(function (h) { return '<option value="' + esc(h.id) + '"' + (h.id === S.hid ? " selected" : "") + '>' + esc(h.name) + (h.active ? "" : " (inactive)") + '</option>'; }).join("") +
              '<option value="draft"' + (S.hid === "draft" ? " selected" : "") + '>Draft harbour (place a pin)</option></select>' +
            (S.hid === "draft" ? '<p class="note">Choose <b>Place pin</b> and click the map. A draft is a circle; it is never saved.</p>' : "") +
            (!harbours.length ? '<p class="note">This company has no harbours yet. Use a draft harbour, or add harbours under Settings → Operations Settings.</p>' : "") +
          '</section>' +
          '<section><h2>Map</h2><div class="lab-seg" role="group" aria-label="Base map">' +
            [["landsea", "Land & sea"], ["sat", "Satellite"], ["street", "Street"]].map(function (b) {
              return '<button type="button" data-layer="' + b[0] + '" class="' + (S.layer === b[0] ? "on" : "") + '">' + b[1] + '</button>';
            }).join("") + '</div>' +
            '<label class="lab-check"><input type="checkbox" id="labAll"' + (S.showAll ? " checked" : "") + '> Show every harbour of this company</label>' +
            '<label class="lab-check"><input type="checkbox" id="labLearn"' + (S.learnOn ? " checked" : "") + '> Show what the Autopilot learned</label>' +
          '</section>' +
          '<section><h2>Track</h2><div class="lab-seg" role="group" aria-label="Map clicks">' +
            '<button type="button" data-mode="add" class="' + (S.mode === "add" ? "on" : "") + '">Add fixes</button>' +
            '<button type="button" data-mode="pin" class="' + (S.mode === "pin" ? "on" : "") + '"' + (S.hid === "draft" ? "" : " disabled") + '>Place pin</button>' +
            '<button type="button" data-mode="pan" class="' + (S.mode === "pan" ? "on" : "") + '">Just look</button></div>' +
            '<div class="lab-3">' + fld("Every (s)", '<input id="labStep" type="number" min="1" max="3600" value="30">') +
              fld("Accuracy (m)", '<input id="labAcc" type="number" min="0" max="1000" value="10" placeholder="unknown">') +
              fld("Speed (kn)", '<input id="labSpd" type="number" min="0" max="80" placeholder="—">') + '</div>' +
            '<div class="lab-row"><button type="button" class="ghost" data-act="undo"' + (S.track.length ? "" : " disabled") + '>Undo last</button>' +
              '<button type="button" class="ghost" data-act="clear"' + (S.track.length ? "" : " disabled") + '>Clear track</button></div>' +
            '<p class="note">Drag a fix to move it. Times, accuracy, speed and delay can be edited in the table under the map.</p>' +
          '</section>' +
          '<section><h2>Scenarios</h2><div class="lab-scen">' +
            SCENARIOS.map(function (s, i) { return '<button type="button" data-scen="' + i + '" title="' + esc(s[2]) + '"' + (effHarbour() ? "" : " disabled") + '>' + esc(s[1]) + '</button>'; }).join("") +
            '</div><p class="note">Generated around the selected harbour. Synthetic points, not real positions.</p></section>' +
          '<section><h2>Replay a real trip</h2>' +
            (trips.length ? '<select id="labTrip" aria-label="Trip to replay"><option value="">Choose a trip…</option>' + trips.map(function (t) {
              return '<option value="' + esc(t.id) + '"' + (S.replay && S.replay.trip.id === t.id ? " selected" : "") + '>' + esc((t.code || "Trip") + " · " + (t.vessel || "") + " · " + dayText(t.depart_at) + " · " + t.fixes + " fixes") + '</option>';
            }).join("") + '</select>' : '<p class="note">No trips with stored GPS fixes yet.</p>') +
            (S.replay ? replayText() : "") +
          '</section>' +
          '<section><h2>What if…</h2><p class="note">Try other rules without saving them. Changed values are highlighted.</p>' +
            '<h3>Harbour rules</h3><div class="lab-2">' + HFIELDS.map(function (f) { return ruleField("harbour", f); }).join("") + '</div>' +
            '<h3>Detection settings</h3><div class="lab-2">' + CFIELDS.map(function (f) { return ruleField("cfg", f); }).join("") + '</div>' +
            '<button type="button" class="ghost" data-act="reset-rules">Back to saved rules</button>' +
          '</section>' +
        '</aside>' +
        '<div class="lab-main">' +
          '<div class="card lab-mapcard"><div class="lab-mapwrap"><div id="labMap" class="lab-map"></div><div class="lab-live" id="labLive" aria-live="polite"></div></div>' +
            '<div class="lab-player" id="labPlayer"></div>' + legend() + '</div>' +
          '<div id="labResult" aria-live="polite"></div>' +
        '</div>' +
      '</div>';
    drawMap();
    paintResult();
  }
  function fld(label, input) { return '<label class="lab-field"><span>' + label + '</span>' + input + '</label>'; }
  function ruleField(group, f) {
    var base = group === "harbour" ? (savedHarbour() || (S.hid === "draft" ? DRAFT_DEFAULTS : {}))[f[0]] : (baseCfg || {})[f[0]];
    var cur = S.rules[group][f[0]];
    return '<label class="lab-field' + (cur != null ? " changed" : "") + '"><span>' + f[1] + '</span><input type="number" data-rule="' + group + '" name="' + f[0] + '" min="' + f[2] + '" max="' + f[3] + '" value="' + esc(cur != null ? cur : base != null ? base : "") + '"></label>';
  }
  function dayText(iso) {
    return iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "";
  }
  function replayText() {
    var r = S.replay, e = r.event;
    return '<p class="note">Live result: ' + (e ? "arrived " + esc(clock(e.arrived_at)) + " (" + esc(e.method.replace(/_/g, " ")) + ", " + esc(e.algorithm_version || "") + ")" : "no arrival recorded") +
      '. Trip status ' + esc(r.trip.status) + '.' + (r.trip.destination_harbour_id ? "" : " The trip has no destination harbour.") + '</p>';
  }
  function legend() {
    return '<div class="lab-legend" aria-label="Legend">' +
      (S.layer === "landsea" ? '<span><i class="sw sea"></i>Sea</span><span><i class="sw land"></i>Land</span>' : "") +
      '<span><i class="sw zone"></i>Destination zone</span><span><i class="sw band"></i>Edge (GPS uncertainty)</span>' +
      '<span><i class="ring approach"></i>Approach ring</span><span><i class="sw other"></i>Other harbours</span>' +
      '<span><i class="dot" style="background:' + COLORS.inside + '"></i>Inside, counted</span><span><i class="dot" style="background:' + COLORS.boundary + '"></i>Edge, not counted</span>' +
      '<span><i class="dot" style="background:' + COLORS.approach + '"></i>Approaching</span><span><i class="dot" style="background:' + COLORS.outside + '"></i>Outside</span>' +
      '<span><i class="dot" style="background:' + COLORS.rejected + '"></i>Rejected fix</span><span><i class="dot star" style="background:' + COLORS.confirmed + '"></i>Arrival confirmed</span>' +
      '</div>';
  }

  // ---------------------------------------------------------------- map
  var BASES = {
    landsea: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" }],
    sat: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 17, attribution: "Tiles &copy; Esri" }],
    street: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }]
  };
  function drawMap() {
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    var el = $("labMap");
    if (!el || !window.L) return;
    var h = effHarbour() || harbours[0];
    // Canvas renderer: settings.css sizes every <svg> to 20 px, which would hide SVG zones.
    map = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView(h ? [h.lat, h.lng] : [4.2, 73.5], h ? 15 : 9);
    setBase();
    zoneLayer = L.layerGroup().addTo(map);
    trackLayer = L.layerGroup().addTo(map);
    learnLayer = L.layerGroup().addTo(map);
    boatLayer = L.layerGroup().addTo(map);
    map.on("click", onMapClick);
    drawZones();
    drawTrack();
    paintLearn();
    paintBoat();
  }
  function setBase() {
    if (tiles) map.removeLayer(tiles);
    var b = BASES[S.layer];
    tiles = L.tileLayer(b[0], b[1]).addTo(map);
    $("labMap").classList.toggle("landsea", S.layer === "landsea");
  }
  function drawZones() {
    if (!zoneLayer) return;
    zoneLayer.clearLayers();
    var h = effHarbour(), u = Number(effCfg().assumedAccuracyM) || 30;
    if (S.showAll) harbours.forEach(function (o) {
      if (h && o.id === h.id) return;
      zone(o, "#475569", 0.08, o.name + (o.active ? "" : " (inactive)"), false);
      L.circle([o.lat, o.lng], { radius: o.approach_m, color: "#475569", weight: 1, dashArray: "2 6", fill: false, interactive: false }).addTo(zoneLayer);
    });
    if (!h) return;
    zone(h, "#16a34a", 0.18, h.name, true);
    L.circle([h.lat, h.lng], { radius: h.approach_m, color: "#2563eb", weight: 2, dashArray: "6 8", fill: false, interactive: false })
      .addTo(zoneLayer);
    if (h.geofence_type !== "polygon") {
      // Edge band: a fix with the assumed accuracy only counts inside the inner ring, and is clearly out beyond the outer one.
      var inner = Math.max(h.radius_m - u, 0), outer = h.radius_m + u;
      L.circle([h.lat, h.lng], { radius: outer, color: "#d97706", weight: 1, fillColor: "#f59e0b", fillOpacity: 0.16, interactive: false }).addTo(zoneLayer);
      L.circle([h.lat, h.lng], { radius: inner, color: "#15803d", weight: 1, dashArray: "3 4", fillColor: "#16a34a", fillOpacity: 0.22, interactive: false })
        .bindTooltip("Counts with ±" + u + " m accuracy").addTo(zoneLayer);
    }
    L.circleMarker([h.lat, h.lng], { radius: 5, color: "#0f172a", weight: 2, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(h.name + " pin").addTo(zoneLayer);
  }
  function zone(h, color, fill, title, main) {
    var opt = { color: color, weight: main ? 3 : 1.5, fillColor: color, fillOpacity: fill };
    var s = h.geofence_type === "polygon" && h.polygon && h.polygon.length >= 3 ? L.polygon(h.polygon, opt) : L.circle([h.lat, h.lng], Object.assign({ radius: h.radius_m }, opt));
    s.bindTooltip(title + (main ? "" : " — never triggers this test")).addTo(zoneLayer);
  }
  function drawTrack() {
    if (!trackLayer) return;
    trackLayer.clearLayers();
    if (!S.track.length) return;
    L.polyline(S.track.map(function (p) { return [p.lat, p.lng]; }), { color: "#0f172a", weight: 2, opacity: 0.5, dashArray: "4 4", interactive: false }).addTo(trackLayer);
    var steps = (S.result && S.result.steps) || [];
    var firstIn = S.result && S.result.arrival ? S.result.arrival.first_obs_id : null;
    S.track.forEach(function (p, i) {
      var st = steps[i], col = dotColor(st), confirmed = st && st.event === "confirmed";
      var future = S.play.t != null && i > playIdx;
      var m = L.marker([p.lat, p.lng], { draggable: true, keyboard: false, icon: L.divIcon({ className: "lab-fix" + (future ? " future" : "") + (i === playIdx ? " now" : ""),
        html: '<span class="' + (confirmed ? "star" : "") + (st && !st.valid && st.reject !== "after_arrival" ? " x" : "") + (firstIn === i + 1 ? " first" : "") + '" style="background:' + col + '">' + (i + 1) + '</span>',
        iconSize: [22, 22], iconAnchor: [11, 11] }) });
      m.bindTooltip(fixTip(p, st, i));
      m.on("dragend", function (e) { var ll = e.target.getLatLng(); p.lat = round(ll.lat, 7); p.lng = round(ll.lng, 7); S.replay = null; schedule(); });
      m.on("click", function () { highlightRow(i); });
      m.addTo(trackLayer);
    });
  }
  function dotColor(st) {
    if (!st) return "#94a3b8";
    if (st.event === "confirmed") return COLORS.confirmed;
    if (st.reject === "after_arrival") return COLORS.after;
    if (!st.valid) return COLORS.rejected;
    return COLORS[st.zone] || COLORS.outside;
  }
  function fixTip(p, st, i) {
    var s = "#" + (i + 1) + " · +" + p.t + " s" + (p.accuracy_m == null ? " · accuracy unknown" : " · ±" + p.accuracy_m + " m") + (p.speed_kn != null ? " · " + p.speed_kn + " kn" : "");
    if (st) s += "<br>" + esc(st.zone || "—") + (st.distance_m != null ? " · " + Math.round(st.distance_m) + " m from pin" : "") + "<br>" + esc(st.reason || "");
    return s;
  }
  function onMapClick(e) {
    var lat = round(e.latlng.lat, 7), lng = round(e.latlng.lng, 7);
    if (S.mode === "pin" && S.hid === "draft") { S.draft = { lat: lat, lng: lng }; drawZones(); schedule(); renderSideOnly(); return; }
    if (S.mode !== "add") return;
    var stepS = num($("labStep").value) || 30, last = S.track[S.track.length - 1];
    S.track.push({ lat: lat, lng: lng, t: last ? round(last.t + stepS, 1) : 0, accuracy_m: num($("labAcc").value), speed_kn: num($("labSpd").value), delay_s: 0 });
    S.replay = null;
    schedule();
  }
  function renderSideOnly() {
    var c = map ? map.getCenter() : null, z = map ? map.getZoom() : null;
    render();
    if (c && map) map.setView(c, z);
  }

  // ---------------------------------------------------------------- scenarios (synthetic, around the harbour)
  // Each returns fixes [bearing-free offsets from the pin]: [distance m, seconds, accuracy, speed, delay].
  var SCENARIOS = [
    ["clean", "Clean arrival", "Comes in from 3 km, slows down and stays at the berth.", function (h) {
      var r = h.radius_m;
      return path(h, 210, [[h.approach_m + 1000, 0, 10, 22], [h.approach_m, 120, 10, 20], [h.approach_m * 0.5, 240, 10, 18], [r * 3, 330, 10, 10],
        [r * 1.4, 360, 10, 6], [r * 0.35, 390, 10, 3], [r * 0.3, 420, 10, 1], [r * 0.3, 450, 10, 0], [r * 0.25, 480, 10, 0]]);
    }],
    ["pass", "Passes by", "Sails past just outside the zone and carries on.", function (h) {
      var pts = [], d = h.radius_m + 60;
      for (var k = -6; k <= 6; k++) { var q = move(h.lat, h.lng, 180, d); pts.push(fix(move(q.lat, q.lng, 90, k * 150), (k + 6) * 30, 10, 14)); }
      return pts;
    }],
    ["brief", "Brief entry", "Enters for 30 s, leaves before confirmation, then never returns.", function (h) {
      var r = h.radius_m;
      return path(h, 30, [[h.approach_m, 0, 10, 15], [r * 2, 120, 10, 8], [r * 0.4, 150, 10, 5], [r * 0.4, 180, 10, 5], [r * 2.5, 210, 10, 9], [h.approach_m, 330, 10, 15]]);
    }],
    ["edge", "Sits on the edge", "Hovers on the zone boundary with ±20 m GPS: never certain enough to count.", function (h) {
      var pts = [];
      for (var k = 0; k < 10; k++) pts.push(fix(move(h.lat, h.lng, 120 + k * 4, h.radius_m + 5), k * 30, 20, 2));
      return pts;
    }],
    ["poor", "Poor GPS", "At the berth, but every fix is less accurate than the harbour allows.", function (h) {
      var a = h.max_accuracy_m + 30;
      return path(h, 300, [[h.approach_m, 0, a, 15], [h.radius_m * 0.3, 120, a, 2], [h.radius_m * 0.3, 150, a, 0], [h.radius_m * 0.3, 180, a, 0], [h.radius_m * 0.3, 210, a, 0], [h.radius_m * 0.3, 240, a, 0]]);
    }],
    ["unknown", "No accuracy", "Clean arrival from a feed that sends no accuracy (the assumed accuracy applies).", function (h) {
      return SCENARIOS[0][3](h).map(function (p) { p.accuracy_m = null; return p; });
    }],
    ["jump", "GPS jump", "Clean arrival with one wild fix 40 km away in the middle.", function (h) {
      var pts = SCENARIOS[0][3](h), far = move(h.lat, h.lng, 0, 40000);
      pts.splice(6, 0, fix(far, pts[5].t + 15, 10, null));
      return pts;
    }],
    ["gap", "Signal gap", "Enters, then no signal for 7 minutes, then two more fixes inside.", function (h) {
      var r = h.radius_m;
      return path(h, 160, [[h.approach_m, 0, 10, 15], [r * 2, 120, 10, 8], [r * 0.3, 150, 10, 2], [r * 0.3, 570, 10, 0], [r * 0.3, 600, 10, 0], [r * 0.3, 630, 10, 0]]);
    }],
    ["late", "Delivered late", "Clean arrival, but the inside fixes reach the server after the stale limit.", function (h) {
      var late = (Number(effCfg().maxDelaySec) || 900) + 60;
      return SCENARIOS[0][3](h).map(function (p, i) { if (i >= 5) p.delay_s = late; return p; });
    }],
    ["fast", "Too fast inside", "Crosses the zone at 25 kn; confirmation waits until it slows.", function (h) {
      var r = h.radius_m;
      return path(h, 250, [[h.approach_m, 0, 10, 25], [r * 0.5, 150, 10, 25], [r * 0.3, 180, 10, 25], [r * 0.3, 210, 10, 25], [r * 0.3, 240, 10, 3]]);
    }]
  ];
  function fix(p, t, acc, spd, delay) { return { lat: p.lat, lng: p.lng, t: t, accuracy_m: acc, speed_kn: spd == null ? null : spd, delay_s: delay || 0 }; }
  function path(h, bearing, rows) {
    return rows.map(function (r, i) { return fix(move(h.lat, h.lng, bearing + (r[0] < h.radius_m ? i * 7 : 0), r[0]), r[1], r[2], r[3], r[4]); });
  }

  // ---------------------------------------------------------------- run
  function schedule() {
    clearTimeout(runTimer);
    if (S.play.on || S.play.t != null) { S.play.on = false; S.play.t = null; playIdx = -1; cancelAnimationFrame(raf); paintBoat(); }
    drawTrack();
    runTimer = setTimeout(run, 350);
  }
  function rulesPayload() {
    var r = { harbour: Object.assign({}, S.rules.harbour), cfg: Object.assign({}, S.rules.cfg), company: company.id };
    if (S.hid === "draft" && S.draft) r.harbour = Object.assign({}, DRAFT_DEFAULTS, r.harbour, { lat: S.draft.lat, lng: S.draft.lng });
    return r;
  }
  function run() {
    var h = effHarbour();
    if (!h || !S.track.length) { S.result = null; S.error = ""; drawTrack(); paintResult(); return; }
    var seq = ++runSeq;
    S.busy = true; paintResult();
    rpc("arrival_simulate", { p_harbour: S.hid === "draft" ? null : S.hid, p_track: S.track, p_rules: rulesPayload(), p_start: S.start })
      .then(function (r) { if (seq !== runSeq) return; S.result = r; S.error = ""; tz = r.tz || tz; },
            function (e) { if (seq !== runSeq) return; S.result = null; S.error = e.message; })
      .then(function () { if (seq !== runSeq) return; S.busy = false; drawTrack(); paintResult(); });
  }

  function paintResult() {
    var el = $("labResult");
    if (!el) return;
    if (!effHarbour()) { el.innerHTML = '<div class="card lab-empty">Choose a harbour (or place a draft pin) to start.</div>'; return; }
    if (!S.track.length) { el.innerHTML = '<div class="card lab-empty">Click the map to add GPS fixes, or pick a scenario or a real trip.</div>'; return; }
    if (S.error) { el.innerHTML = '<div class="card lab-empty"><p class="msg err">' + esc(S.error) + '</p></div>'; return; }
    var r = S.result;
    if (!r) { el.innerHTML = '<div class="card lab-empty">Running…</div>'; return; }
    var a = r.arrival, steps = r.steps || [];
    el.innerHTML =
      '<div class="card lab-sum' + (S.busy ? " busy" : "") + '">' +
        '<div class="lab-verdict ' + (a ? "ok" : "no") + '"><small>Result</small><strong>' + esc(STATE_LABEL[r.final_state] || r.final_state) + '</strong><span>' + esc(r.final_reason || (r.valid ? "" : "No usable fix: every fix was rejected (see Why)")) + '</span></div>' +
        kv("Arrival time", a ? esc(a.local) : "—") +
        kv("Entered between", a ? (a.arrived_after ? esc(clock(a.arrived_after)) + " and " + esc(clock(a.arrived_at)) + " (±" + a.uncertainty_s + " s)" : "first fix was already inside") : "—") +
        kv("Confirmed by fix", a ? "#" + a.confirm_obs_id + " at " + esc(clock(a.confirmed_obs_at)) + " · " + a.fixes + " fixes over " + a.dwell_s + " s" : "—") +
        kv("Fixes", r.valid + " used · " + r.rejected + " rejected") +
        kv("Rule", "≥ " + r.harbour.min_obs + " fixes over ≥ " + r.harbour.dwell_sec + " s, accuracy ≤ " + r.harbour.max_accuracy_m + " m" + (r.harbour.geofence_type === "polygon" ? ", boundary" : ", " + r.harbour.radius_m + " m radius")) +
        kv("Algorithm", esc(r.version)) +
      '</div>' +
      '<div class="card lab-steps"><div class="lab-steps-head"><h2>Fix by fix</h2><span class="note">Times in ' + esc(tz) + '. Edit a value to re-run.</span></div>' +
        '<div class="lab-tw"><table class="lab-table"><thead><tr><th>#</th><th>+s</th><th>Time</th><th>Accuracy</th><th>Speed</th><th>Delay</th><th>Zone</th><th>Edge</th><th>Used</th><th>State</th><th>Why</th><th></th></tr></thead><tbody>' +
        steps.map(function (s, i) {
          var p = S.track[i] || {};
          return '<tr data-i="' + i + '"' + (s.event === "confirmed" ? ' class="conf"' : "") + '>' +
            '<td><i class="dot" style="background:' + dotColor(s) + '"></i>' + (i + 1) + '</td>' +
            '<td>' + cell(i, "t", p.t, 0.1) + '</td><td>' + esc(clock(s.observed_at)) + '</td>' +
            '<td>' + cell(i, "accuracy_m", p.accuracy_m, 1, s.accuracy_assumed ? "assumed " + s.accuracy_used : "") + '</td>' +
            '<td>' + cell(i, "speed_kn", p.speed_kn, 0.1, "—") + '</td><td>' + cell(i, "delay_s", p.delay_s, 1) + '</td>' +
            '<td>' + esc(s.zone || "—") + (s.other_harbours && s.other_harbours.length ? '<small>' + esc(s.other_harbours.map(function (o) { return o.name + ": " + o.zone; }).join(", ")) + '</small>' : "") + '</td>' +
            '<td>' + (s.edge_m != null ? (s.edge_m <= 0 ? Math.abs(Math.round(s.edge_m)) + " m in" : Math.round(s.edge_m) + " m out") : "—") + '</td>' +
            '<td>' + (s.valid ? "Yes" : s.reject === "after_arrival" ? "—" : "<b>No</b>") + '</td>' +
            '<td>' + esc(STATE_LABEL[s.state] || s.state || "—") + (s.tracking_gap_before ? '<small>Tracking unavailable before this fix</small>' : "") + '</td>' +
            '<td>' + esc(s.reason || "") + (s.event && s.event !== "none" ? ' <span class="lab-ev">' + esc(s.event.replace("_", " ")) + '</span>' : "") + '</td>' +
            '<td><button type="button" class="lab-x" data-del="' + i + '" aria-label="Remove fix ' + (i + 1) + '">×</button></td></tr>';
        }).join("") + '</tbody></table></div></div>';
    paintPlayer();
    paintLive();
  }
  function kv(k, v) { return '<div class="lab-kv"><small>' + k + '</small><span>' + v + '</span></div>'; }
  function cell(i, k, v, step, ph) {
    return '<input class="lab-cell" type="number" step="' + step + '" data-cell="' + k + '" data-i="' + i + '" value="' + (v == null ? "" : esc(v)) + '" placeholder="' + esc(ph || "") + '" aria-label="' + k + ' of fix ' + (i + 1) + '">';
  }
  function highlightRow(i) {
    var tr = document.querySelector('.lab-table tr[data-i="' + i + '"]');
    if (!tr) return;
    [].forEach.call(document.querySelectorAll(".lab-table tr.hl"), function (x) { x.classList.remove("hl"); });
    tr.classList.add("hl");
    // Scroll only the table, never the page (playback calls this many times a second).
    var box = tr.closest(".lab-tw");
    if (box && (tr.offsetTop < box.scrollTop + 30 || tr.offsetTop > box.scrollTop + box.clientHeight - 40)) box.scrollTop = tr.offsetTop - box.clientHeight / 2;
  }

  // ---------------------------------------------------------------- playback (Claude 2026-10-28)
  // Replays the result on the track clock: a boat glides between fixes, fixes light up as they arrive, the live card
  // shows the state the algorithm was in at that moment and the timeline shows every state change.
  function span() {
    var ts = S.track.map(function (p) { return Number(p.t) || 0; });
    return ts.length ? [Math.min.apply(null, ts), Math.max.apply(null, ts)] : [0, 0];
  }
  function idxAt(t) {
    var k = -1;
    S.track.forEach(function (p, i) { if ((Number(p.t) || 0) <= t + 1e-6) k = i; });
    return k;
  }
  function stepAt(i) { return S.result && S.result.steps ? S.result.steps[i] : null; }
  function pct(t, sp) { return sp[1] > sp[0] ? ((t - sp[0]) / (sp[1] - sp[0])) * 100 : 0; }
  var STATE_TONE = { NOT_APPROACHING: "out", APPROACHING_DESTINATION: "appr", ARRIVAL_PENDING: "pend", ARRIVED: "arr", TRACKING_UNAVAILABLE: "gap" };
  function paintPlayer() {
    var el = $("labPlayer");
    if (!el) return;
    var steps = (S.result && S.result.steps) || [];
    if (!steps.length) { el.innerHTML = ""; return; }
    var sp = span(), cur = S.play.t == null ? sp[1] : S.play.t;
    var segs = steps.map(function (st, i) {
      var a = Number(S.track[i].t) || 0, b = i + 1 < steps.length ? Number(S.track[i + 1].t) || 0 : sp[1];
      return '<i class="seg ' + (STATE_TONE[st.state] || "out") + '" style="left:' + pct(a, sp) + '%;width:' + Math.max(pct(b, sp) - pct(a, sp), 0.4) + '%" title="' + esc(STATE_LABEL[st.state] || st.state || "") + '"></i>';
    }).join("");
    var ticks = steps.map(function (st, i) {
      var cls = st.event === "confirmed" ? "conf" : !st.valid && st.reject !== "after_arrival" ? "rej" : st.event && st.event !== "none" ? "ev" : "";
      return cls ? '<b class="tick ' + cls + '" style="left:' + pct(Number(S.track[i].t) || 0, sp) + '%" title="#' + (i + 1) + ' ' + esc(st.reason || "") + '"></b>' : "";
    }).join("");
    el.innerHTML =
      '<button type="button" class="lab-play" data-play aria-label="' + (S.play.on ? "Pause" : "Play") + '">' + (S.play.on ? "❚❚" : "▶") + '</button>' +
      '<div class="lab-tl" data-seek title="Click or drag to move through time">' + segs + ticks +
        '<span class="lab-head" style="left:' + pct(cur, sp) + '%"></span></div>' +
      '<select id="labSpeed" aria-label="Playback speed">' + [10, 30, 60, 120].map(function (v) { return '<option value="' + v + '"' + (S.play.speed === v ? " selected" : "") + '>×' + v + '</option>'; }).join("") + '</select>' +
      '<span class="lab-clock" id="labClock">+' + Math.round(cur - sp[0]) + ' s</span>' +
      (S.play.t != null ? '<button type="button" class="ghost lab-reset" data-play-end>Show all</button>' : "");
  }
  function paintLive() {
    var el = $("labLive");
    if (!el) return;
    var steps = (S.result && S.result.steps) || [];
    if (!steps.length) { el.hidden = true; return; }
    var i = S.play.t == null ? steps.length - 1 : idxAt(S.play.t);
    el.hidden = false;
    if (i < 0) { el.innerHTML = '<div class="lab-live-in"><small>Waiting for the first fix…</small></div>'; return; }
    var st = steps[i], h = S.result.harbour || {}, prog = 0;
    if (st.state === "ARRIVED") prog = 1;
    else if (st.state === "ARRIVAL_PENDING") prog = Math.min(st.pending_count / (h.min_obs || 3), h.dwell_sec ? (st.dwell_s || 0) / h.dwell_sec : 1);
    var c = 2 * Math.PI * 18;
    el.innerHTML = '<div class="lab-live-in ' + (STATE_TONE[st.state] || "out") + '">' +
      '<svg class="lab-live-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" class="bg"/><circle cx="22" cy="22" r="18" class="fg" stroke-dasharray="' + (Math.max(0, Math.min(1, prog)) * c).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg>' +
      '<div><small>Fix #' + (i + 1) + ' · ' + esc(clock(st.observed_at)) + '</small><strong>' + esc(STATE_LABEL[st.state] || st.state || "—") + '</strong>' +
      '<span>' + esc(st.reason || "") + '</span>' +
      (st.state === "ARRIVAL_PENDING" ? '<em>' + st.pending_count + ' of ' + h.min_obs + ' fixes · ' + (st.dwell_s || 0) + ' of ' + h.dwell_sec + ' s</em>' : "") + '</div></div>';
  }
  function boatPos(t) {
    var n = S.track.length;
    if (!n) return null;
    var i = idxAt(t);
    if (i < 0) return { lat: S.track[0].lat, lng: S.track[0].lng, b: 0 };
    if (i >= n - 1) { var q0 = S.track[Math.max(n - 2, 0)], q1 = S.track[n - 1]; return { lat: q1.lat, lng: q1.lng, b: bearing(q0, q1) }; }
    var a = S.track[i], b = S.track[i + 1], ta = Number(a.t) || 0, tb = Number(b.t) || 0, f = tb > ta ? (t - ta) / (tb - ta) : 0;
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, b: bearing(a, b) };
  }
  function bearing(a, b) {
    var y = Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
    var x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180);
    return Math.atan2(y, x) * 180 / Math.PI;
  }
  var boat = null;
  function paintBoat() {
    if (!boatLayer) return;
    if (S.play.t == null || !S.track.length) { boatLayer.clearLayers(); boat = null; return; }
    var p = boatPos(S.play.t);
    if (!p) return;
    var html = '<span style="transform:rotate(' + Math.round(p.b) + 'deg)">➤</span>';
    if (!boat) { boat = L.marker([p.lat, p.lng], { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: "lab-boat", html: html, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(boatLayer); }
    else { boat.setLatLng([p.lat, p.lng]); var el = boat.getElement(); if (el) el.firstChild.style.transform = "rotate(" + Math.round(p.b) + "deg)"; }
  }
  function seek(t) {
    var sp = span();
    S.play.t = Math.max(sp[0], Math.min(sp[1], t));
    var i = idxAt(S.play.t);
    if (i !== playIdx) { playIdx = i; drawTrack(); paintLive(); if (i >= 0) highlightRow(i); }
    var hd = document.querySelector(".lab-head"); if (hd) hd.style.left = pct(S.play.t, sp) + "%";
    var ck = $("labClock"); if (ck) ck.textContent = "+" + Math.round(S.play.t - sp[0]) + " s";
    paintBoat();
  }
  function frame(ts) {
    if (!S.play.on) return;
    var dt = lastFrame ? (ts - lastFrame) / 1000 : 0; lastFrame = ts;
    var sp = span();
    seek((S.play.t == null ? sp[0] : S.play.t) + dt * S.play.speed);
    if (S.play.t >= sp[1]) { S.play.on = false; paintPlayer(); return; }
    raf = requestAnimationFrame(frame);
  }
  function togglePlay() {
    if (!S.result || !S.track.length) return;
    var sp = span();
    S.play.on = !S.play.on;
    if (S.play.on) {
      if (S.play.t == null || S.play.t >= sp[1]) { S.play.t = sp[0] - 0.001; playIdx = -2; }
      lastFrame = 0; seek(S.play.t); raf = requestAnimationFrame(frame);
    } else cancelAnimationFrame(raf);
    paintPlayer();
  }
  function stopPlay() {
    S.play.on = false; S.play.t = null; playIdx = -1; cancelAnimationFrame(raf);
    paintBoat(); drawTrack(); paintPlayer(); paintLive();
  }
  // Drag on the timeline to scrub.
  var scrubbing = false;
  function scrubTo(e) {
    var tl = document.querySelector(".lab-tl"); if (!tl) return;
    var r = tl.getBoundingClientRect(), sp = span(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (S.play.on) { S.play.on = false; cancelAnimationFrame(raf); }
    seek(sp[0] + f * (sp[1] - sp[0]));
    var pb = document.querySelector("[data-play]"); if (pb) pb.textContent = "▶";
  }
  document.addEventListener("pointerdown", function (e) { if (e.target.closest(".lab-tl")) { scrubbing = true; scrubTo(e); e.preventDefault(); } });
  document.addEventListener("pointermove", function (e) { if (scrubbing) scrubTo(e); });
  document.addEventListener("pointerup", function () { if (scrubbing) { scrubbing = false; paintPlayer(); } });

  // ---------------------------------------------------------------- Autopilot layer (0060)
  function paintLearn() {
    if (!learnLayer) return;
    learnLayer.clearLayers();
    if (!S.learnOn || !S.learn) return;
    (S.learn.stops || []).forEach(function (st) {
      L.circleMarker([st.lat, st.lng], { radius: 3, weight: 0, fillColor: st.h ? "#38bdf8" : "#facc15", fillOpacity: 0.85, interactive: false }).addTo(learnLayer);
    });
    (S.learn.candidates || []).forEach(function (c) {
      var col = c.status === "dismissed" ? "#94a3b8" : c.status === "conflict" ? "#ef4444" : "#f59e0b";
      L.circle([c.lat, c.lng], { radius: c.radius_m, color: col, weight: 2, dashArray: "5 6", fillColor: col, fillOpacity: 0.06 + 0.25 * (c.progress || 0) })
        .bindTooltip((c.name_guess || "Unnamed spot") + " · " + c.status + " · " + Math.round((c.progress || 0) * 100) + "% · " + c.stops + " stops").addTo(learnLayer);
    });
    harbours.filter(function (h) { return h.meta && h.meta.auto; }).forEach(function (h) {
      L.circleMarker([h.lat, h.lng], { radius: 7, color: "#a855f7", weight: 3, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(h.name + " · learned automatically").addTo(learnLayer);
    });
  }
  function loadLearn() {
    rpc("harbour_learning_status", { p_company: company.id }).then(function (st) { S.learn = st; paintLearn(); },
      function (e) { S.learn = null; S.learnOn = false; var c = $("labLearn"); if (c) c.checked = false; alertNote("Autopilot data is not available: " + e.message); });
  }
  function alertNote(t) { var el = $("labResult"); if (el) el.insertAdjacentHTML("afterbegin", '<p class="msg err">' + esc(t) + '</p>'); }

  // ---------------------------------------------------------------- events
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t.closest("#lab")) return;
    var b;
    if ((b = t.closest("[data-layer]"))) { S.layer = b.getAttribute("data-layer"); setBase(); [].forEach.call(document.querySelectorAll("[data-layer]"), function (x) { x.classList.toggle("on", x === b); }); var lg = document.querySelector(".lab-legend"); if (lg) lg.outerHTML = legend(); return; }
    if ((b = t.closest("[data-mode]"))) { S.mode = b.getAttribute("data-mode"); [].forEach.call(document.querySelectorAll("[data-mode]"), function (x) { x.classList.toggle("on", x === b); }); return; }
    if ((b = t.closest("[data-scen]"))) {
      var h = effHarbour(); if (!h) return;
      S.track = SCENARIOS[Number(b.getAttribute("data-scen"))][3](h); S.start = null; S.replay = null;
      var ts = $("labTrip"); if (ts) ts.value = "";
      fitTrack(); schedule(); return;
    }
    if (t.closest("[data-play]")) { togglePlay(); return; }
    if (t.closest("[data-play-end]")) { stopPlay(); return; }
    if ((b = t.closest("[data-del]"))) { S.track.splice(Number(b.getAttribute("data-del")), 1); S.replay = null; schedule(); return; }
    if ((b = t.closest("[data-act]"))) {
      var act = b.getAttribute("data-act");
      if (act === "undo") S.track.pop();
      if (act === "clear") { S.track = []; S.replay = null; S.start = null; }
      if (act === "reset-rules") { S.rules = { harbour: {}, cfg: {} }; renderSideOnly(); }
      drawZones(); schedule(); return;
    }
    var row = t.closest(".lab-table tr[data-i]");
    if (row && !t.closest("input, button") && map) { var p = S.track[Number(row.getAttribute("data-i"))]; if (p) map.panTo([p.lat, p.lng]); highlightRow(Number(row.getAttribute("data-i"))); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t.closest("#lab")) return;
    if (t.id === "labHarbour") { S.hid = t.value; S.draft = null; S.rules = { harbour: {}, cfg: {} }; S.mode = t.value === "draft" ? "pin" : "add"; render(); schedule(); return; }
    if (t.id === "labAll") { S.showAll = t.checked; drawZones(); return; }
    if (t.id === "labLearn") { S.learnOn = t.checked; if (S.learnOn && !S.learn) loadLearn(); else paintLearn(); return; }
    if (t.id === "labSpeed") { S.play.speed = Number(t.value) || 30; return; }
    if (t.id === "labTrip") { loadReplay(t.value); return; }
    if (t.hasAttribute("data-rule")) {
      var g = t.getAttribute("data-rule"), v = num(t.value);
      if (v == null) delete S.rules[g][t.name]; else S.rules[g][t.name] = v;
      t.closest(".lab-field").classList.toggle("changed", v != null);
      drawZones(); schedule(); return;
    }
    if (t.hasAttribute("data-cell")) {
      var p = S.track[Number(t.getAttribute("data-i"))], k = t.getAttribute("data-cell");
      if (!p) return;
      p[k] = k === "delay_s" ? (num(t.value) || 0) : k === "t" ? (num(t.value) != null ? num(t.value) : p.t) : num(t.value);
      S.replay = null;
      schedule();
    }
  });
  function fitTrack() {
    if (!map || !S.track.length) return;
    var h = effHarbour(), pts = S.track.map(function (p) { return [p.lat, p.lng]; }).filter(function (p) { return Math.abs(p[0] - (h ? h.lat : p[0])) < 0.2; });
    if (h) pts.push([h.lat, h.lng]);
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
  }
  function loadReplay(id) {
    if (!id) { S.replay = null; renderSideOnly(); return; }
    rpc("arrival_lab_trip_track", { p_trip: id }).then(function (d) {
      S.replay = d; S.start = d.start;
      S.track = (d.track || []).map(function (p) { return { lat: p.lat, lng: p.lng, t: p.t, accuracy_m: p.accuracy_m, speed_kn: p.speed_kn, delay_s: p.delay_s || 0 }; });
      if (d.trip.destination_harbour_id && harbours.some(function (h) { return h.id === d.trip.destination_harbour_id; })) S.hid = d.trip.destination_harbour_id;
      render(); fitTrack(); schedule();
    }, function (e) { S.error = e.message; paintResult(); });
  }

  // ---------------------------------------------------------------- start
  function load() {
    var cid = company.id;
    return Promise.all([
      db.from("harbours").select("*").eq("company_id", cid).order("name").then(check),
      rpc("arrival_cfg", { p_company: cid }),
      rpc("arrival_lab_trips", { p_company: cid })
    ]).then(function (r) {
      harbours = r[0] || []; baseCfg = r[1] || {}; trips = r[2] || [];
      if (!harbours.some(function (h) { return h.id === S.hid; }) && S.hid !== "draft") S.hid = harbours[0] ? harbours[0].id : "draft";
      S.mode = S.hid === "draft" && !S.draft ? "pin" : "add";
    });
  }

  window.VeyoraShell.start({
    active: "Settings",
    onCompany: function (c, info) {
      company = c; tz = c.timezone || tz;
      S.track = []; S.result = null; S.replay = null; S.start = null; S.rules = { harbour: {}, cfg: {} }; S.hid = ""; S.draft = null; S.learn = null;
      if (!info.isPlatform) { $("lab").innerHTML = '<div class="card lab-empty">The Arrival Lab is for the platform owner.</div>'; return; }
      $("lab").innerHTML = '<p class="msg">Loading…</p>';
      return load().then(render, function (e) {
        $("lab").innerHTML = '<div class="card lab-empty"><p class="msg err">' + esc(e.message) + '</p>' +
          (/arrival_|harbours|schema cache/.test(e.message) ? '<p class="note">The database needs migrations 0058 and 0059 on this project.</p>' : "") + '</div>';
      });
    },
    onNone: function (platform) { $("lab").innerHTML = '<div class="card lab-empty">' + (platform ? "Choose a company at the top to test its harbours." : "No company.") + '</div>'; },
    onError: function (e) { $("lab").innerHTML = '<p class="msg err">' + esc(e.message || e) + '</p>'; }
  });
})();
