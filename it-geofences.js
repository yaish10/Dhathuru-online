/* IT → Geofences: draw areas on a map. Standing inside one counts as being on the approved network for
   clocking in (allow_checkin) and for pages limited to an approved network (allow_access), even when the device
   is not on the internal network. Table it_geofences (migration 0110); IT, owners and admins edit it.
   Draw a box by pressing and dragging. Box / circle / freehand zones, corners and handles, a "try a point" tester.
   window.ItGeofences.mount(host, { db, company, esc }) */
(function () {
  var st = null;   // editor state while mounted

  function $(id) { return document.getElementById(id); }
  function icon(p) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var IC = {
    pan: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
    box: '<rect x="4" y="6" width="16" height="12" rx="1.5" stroke-dasharray="3 3"/><path d="M4 6h3M4 6v3M20 18h-3M20 18v-3"/>',
    circle: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2"/>',
    poly: '<path d="M5 17 8 6l8 2 3 9-7 3z"/>',
    test: '<circle cx="12" cy="12" r="7"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>'
  };

  // ---------------------------------------------------------------- geometry (metres around a point)
  var M_LAT = 111320;
  function toXY(c, p) { return [(p[1] - c[1]) * M_LAT * Math.cos(c[0] * Math.PI / 180), (p[0] - c[0]) * M_LAT]; }
  function fromXY(c, x, y) { return [c[0] + y / M_LAT, c[1] + x / (M_LAT * Math.cos(c[0] * Math.PI / 180))]; }
  function r6(p) { return [+p[0].toFixed(6), +p[1].toFixed(6)]; }
  function distM(a, b) { var d = toXY(a, b); return Math.sqrt(d[0] * d[0] + d[1] * d[1]); }
  function boxCorners(b) {
    var a = b.ang * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), hw = b.w / 2, hh = b.h / 2;
    return [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(function (q) { return r6(fromXY(b.c, q[0] * c + q[1] * s, -q[0] * s + q[1] * c)); });
  }
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
  function boxFromDrag(a, b) { var d = toXY(a, b); return { c: fromXY(a, d[0] / 2, d[1] / 2), w: Math.abs(d[0]), h: Math.abs(d[1]), ang: 0 }; }
  function insidePoly(lat, lng, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function polyAreaM2(poly) {
    if (!poly || poly.length < 3) return 0;
    var v = poly.map(function (p) { return toXY(poly[0], p); }), a = 0;
    for (var i = 0, j = v.length - 1; i < v.length; j = i++) a += v[j][0] * v[i][1] - v[i][0] * v[j][1];
    return Math.abs(a) / 2;
  }
  function centreOf(poly) {
    var n = poly.length, c = poly.reduce(function (a, p) { return [a[0] + p[0] / n, a[1] + p[1] / n]; }, [0, 0]);
    return insidePoly(c[0], c[1], poly) ? r6(c) : poly[0];
  }
  function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m"; }
  function fmtArea(a) { return a >= 1e6 ? (a / 1e6).toFixed(1) + " km²" : a >= 10000 ? (a / 10000).toFixed(1) + " ha" : Math.round(a) + " m²"; }
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    var a = pts[0], b = pts[pts.length - 1], best = 0, k = 0;
    for (var i = 1; i < pts.length - 1; i++) { var d = segDist(pts[i], a, b); if (d > best) { best = d; k = i; } }
    if (best <= tol) return [a, b];
    var l = simplify(pts.slice(0, k + 1), tol), r = simplify(pts.slice(k), tol);
    return l.slice(0, -1).concat(r);
  }
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    var t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    var x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
    return Math.sqrt(x * x + y * y);
  }

  // ---------------------------------------------------------------- mount
  function mount(host, env) {
    if (st && st.map) { try { st.map.remove(); } catch (e) {} }
    st = { host: host, db: env.db, cid: env.company.id, esc: env.esc, list: [], sel: null, mode: "box", box: null, poly: [], circ: null, view: null, space: false, test: null, busy: false, canEdit: env.canEdit !== false };
    host.innerHTML = '<p class="msg">Loading…</p>';
    load();
  }
  function load() {
    return st.db.from("it_geofences").select("*").eq("company_id", st.cid).order("name").then(function (r) {
      if (r.error) {
        var setup = /relation|schema cache|does not exist/.test(r.error.message);
        st.host.innerHTML = '<div class="gf-setup"><div class="gf-empty-ic">' + icon(IC.circle) + '</div><h2>' + (setup ? "Geofences need one database step" : "Could not load geofences") + '</h2><p class="note">' + st.esc(setup ? "Run migration 0110_it_geofences.sql in the Supabase SQL editor, then reload this page." : r.error.message) + '</p></div>';
        return;
      }
      st.list = r.data || [];
      if (st.sel && st.sel.id) st.sel = st.list.filter(function (x) { return x.id === st.sel.id; })[0] || null;
      paint();
    });
  }

  // ---------------------------------------------------------------- layout
  function chip(on, text) { return '<span class="gf-chip' + (on ? " on" : "") + '">' + text + '</span>'; }
  function listHtml() {
    var esc = st.esc, sel = st.sel || {};
    return '<div class="gf-ph"><strong>Geofences</strong><span class="gf-count">' + st.list.length + '</span><button type="button" class="gf-x" data-gf-fold="left" aria-label="Hide list">‹</button></div>' +
      (st.canEdit ? '<button type="button" class="save gf-new" data-gf-new>+ New geofence</button>' : '') +
      (st.list.length > 4 ? '<input class="gf-search" type="search" placeholder="Search zones" data-gf-search>' : '') +
      (st.list.length ? '<ul>' + st.list.map(function (z) {
        var kind = z.geofence_type === "circle" ? "Circle · " + fmtM(z.radius_m || 0) : fmtArea(polyAreaM2(z.polygon || []));
        return '<li data-name="' + esc(z.name.toLowerCase()) + '"><button type="button" data-gf-pick="' + esc(z.id) + '" class="' + (sel.id === z.id ? "on" : "") + (z.active ? "" : " off") + '">' +
          '<span class="gf-pin ' + (z.active ? "live" : "") + '"></span><span class="gf-txt"><strong>' + esc(z.name) + '</strong><small>' + kind + '</small>' +
          '<span class="gf-chips">' + chip(z.allow_checkin, "Check-in") + chip(z.allow_access, "Access") + (z.active ? "" : '<em class="gf-off">Paused</em>') + '</span></span></button></li>';
      }).join("") + '</ul>' : '<div class="gf-empty"><div class="gf-empty-ic">' + icon(IC.box) + '</div><p><strong>No geofences yet</strong></p><p class="note">Press Box and drag on the map. Staff inside it can check in and open protected pages, even on mobile data.</p></div>');
  }
  function statsHtml() {
    var l = st.list, on = l.filter(function (z) { return z.active; });
    function card(n, label, tone) { return '<div class="gf-stat ' + tone + '"><b>' + n + '</b><span>' + label + '</span></div>'; }
    return card(l.length, "Geofences", "") + card(on.filter(function (z) { return z.allow_checkin; }).length, "Allow check-in", "g") + card(on.filter(function (z) { return z.allow_access; }).length, "Allow page access", "b") + card(l.length - on.length, "Paused", l.length - on.length ? "a" : "");
  }
  function dockHtml() {
    function tool(m, label) { return '<button type="button" class="arr-dock-btn' + (st.mode === m ? " on" : "") + '" data-gf-mode="' + m + '">' + icon(IC[m]) + '<span>' + label + '</span></button>'; }
    return '<div class="arr-dock" role="toolbar" aria-label="Geofence tools">' + tool("pan", "Move") + (st.canEdit ? tool("box", "Box") + tool("circle", "Circle") + tool("poly", "Freehand") : "") + tool("test", "Try a point") +
      '<span class="arr-dock-sep"></span><button type="button" class="arr-dock-act" data-gf-fit>Fit</button>' + (st.canEdit ? '<button type="button" class="arr-dock-act danger" data-gf-clear>Clear</button>' : '') + '</div>';
  }
  function formHtml() {
    var z = st.sel || {}, esc = st.esc, isNew = !z.id;
    var dis = st.canEdit ? "" : " disabled";
    return '<form class="gf-form" id="gfForm" novalidate><div class="gf-ph"><strong>' + (isNew ? "New geofence" : esc(z.name)) + '</strong><button type="button" class="gf-x" data-gf-fold="right" aria-label="Hide settings">›</button></div>' +
      '<label class="arr-field"><span>Name</span><input name="name" maxlength="80" autocomplete="off" placeholder="e.g. Head office, Male terminal"' + dis + ' value="' + esc(z.name || "") + '"></label>' +
      '<div class="arr-zone" id="gfZone">' + zoneHtml() + '</div>' +
      '<div class="gf-allow"><p>What does being inside allow?</p>' +
        '<label class="gf-sw"><input type="checkbox" name="allow_checkin"' + (z.allow_checkin === false ? "" : " checked") + dis + '><span><strong>Check in and out</strong><small>Staff can clock in from the apps and the website here, without the office network.</small></span></label>' +
        '<label class="gf-sw"><input type="checkbox" name="allow_access"' + (z.allow_access === false ? "" : " checked") + dis + '><span><strong>Open protected pages</strong><small>HR, IT, Settings and the other pages that need an approved network open here.</small></span></label>' +
        '<label class="gf-sw"><input type="checkbox" name="active"' + (z.active === false ? "" : " checked") + dis + '><span><strong>Active</strong><small>Switch off to pause this zone without deleting it.</small></span></label></div>' +
      '<details class="arr-adv"><summary>More settings (optional)</summary>' +
        '<label class="arr-field"><span>Worst GPS accuracy accepted (m)</span><input name="max_accuracy_m" type="number" min="5" max="1000" step="1"' + dis + ' value="' + (z.max_accuracy_m != null ? z.max_accuracy_m : 100) + '"></label>' +
        '<label class="arr-field"><span>Note</span><textarea name="note" rows="2" maxlength="300"' + dis + '>' + esc(z.note || "") + '</textarea></label>' +
        '<p class="note">A weak GPS reading (accuracy worse than this) never counts as being inside.</p></details>' +
      (st.canEdit ? '<div class="arr-actions"><button type="submit" class="save">' + (isNew ? "Create geofence" : "Save changes") + '</button>' +
        (isNew ? "" : '<button type="button" class="ghost danger" data-gf-delete>Delete</button>') + '<span class="arr-msg" id="gfMsg" aria-live="polite"></span></div>' : "") +
      '<p class="note">Location comes from the device. It can be faked, so this is a convenience rule; every check is written to the activity log.</p></form>';
  }
  function zoneHtml() {
    var kind = st.circ ? "circle " + fmtM(st.circ.r) + " radius" : st.box ? fmtM(st.box.w) + " × " + fmtM(st.box.h) : st.poly.length >= 3 ? st.poly.length + "-corner area · " + fmtArea(polyAreaM2(st.poly)) : "";
    return kind ? '<i class="dot on"></i><span><strong>Zone ready</strong> ' + st.esc(kind) + '. Drag the handles on the map to adjust.</span>'
                : '<i class="dot"></i><span><strong>Draw the zone</strong> Press on the map and drag a box around the area. Zoom in first for accuracy.</span>';
  }
  function hintText() {
    if (!st.canEdit) return "You can look at the geofences. Only IT, owners and admins can change them.";
    if (st.mode === "pan") return "Drag the map to move around · scroll or pinch to zoom";
    if (st.mode === "test") return st.test ? st.test : "Click the map to see which geofence a point is inside";
    if (st.mode === "box") return st.box ? "Corners resize · middle moves · round handle turns · press Box again to draw a new one" : "Press and drag to draw a box · hold Space (or pick Move) to drag the map";
    if (st.mode === "circle") return st.circ ? "Drag the middle to move · drag the round handle to change the radius · press Circle again to redraw" : "Press where the centre is and drag outward to set the radius";
    return "Press and drag around the area, or pick Move to drag the map";
  }
  function hudHtml() {
    var chips = [];
    if (st.circ) chips = [fmtM(st.circ.r) + " radius", fmtArea(Math.PI * st.circ.r * st.circ.r)];
    else if (st.box) chips = [fmtM(st.box.w) + " × " + fmtM(st.box.h), fmtArea(st.box.w * st.box.h), "turned " + Math.round(((st.box.ang % 360) + 360) % 360) + "°"];
    else if (st.poly.length >= 3) chips = [st.poly.length + " corners", fmtArea(polyAreaM2(st.poly))];
    return chips.map(function (c, i) { return i === 0 ? '<b>' + st.esc(c) + '</b>' : '<span>' + st.esc(c) + '</span>'; }).join("");
  }
  function paintBits() {
    var d = st.host.querySelector(".arr-dock"); if (d) d.outerHTML = dockHtml();
    var h = $("gfHud"); if (h) { h.innerHTML = hudHtml(); h.classList.toggle("on", !!h.innerHTML); }
    var t = $("gfHint"); if (t) t.textContent = hintText();
    var z = $("gfZone"); if (z) z.innerHTML = zoneHtml();
    syncPan();
  }
  function paint() {
    if (st.map) { try { st.view = { c: st.map.getCenter(), z: st.map.getZoom() }; st.map.remove(); } catch (e) {} st.map = null; }
    st.host.innerHTML = '<div class="gf-stats">' + statsHtml() + '</div><div class="gf' + (st.foldL ? " fold-l" : "") + (st.foldR ? " fold-r" : "") + '"><div class="arr-map-wrap gf-wrap">' + dockHtml() +
      '<div id="gfMap" class="arr-map"></div><div class="arr-hud" id="gfHud">' + hudHtml() + '</div><div class="arr-hint" id="gfHint">' + hintText() + '</div>' +
      '<aside class="gf-panel gf-left">' + listHtml() + '</aside><button type="button" class="gf-tab gf-tab-l" data-gf-fold="left" aria-label="Show list">Zones</button>' +
      '<div class="gf-panel gf-right">' + formHtml() + '</div><button type="button" class="gf-tab gf-tab-r" data-gf-fold="right" aria-label="Show settings">Settings</button></div></div>';
    drawMap();
  }

  // ---------------------------------------------------------------- map
  function drawMap() {
    var el = $("gfMap"); if (!el || !window.L) { if (el) el.innerHTML = '<p class="msg">The map could not load.</p>'; return; }
    var z = st.sel || {}, centre = z.lat != null ? [z.lat, z.lng] : (st.list[0] ? [st.list[0].lat, st.list[0].lng] : [4.2, 73.5]);
    st.map = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView(st.view ? st.view.c : centre, st.view ? st.view.z : (z.lat != null ? 17 : 9));
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 17, attribution: "Tiles &copy; Esri" }).addTo(st.map);
    st.layer = L.layerGroup().addTo(st.map);
    st.map.on("zoomend", placeRot);
    st.map.on("click", function (e) {
      if (st.justDrew) { st.justDrew = false; return; }
      if (st.mode === "test") testPoint([e.latlng.lat, e.latlng.lng]);
    });
    if (st.canEdit) { drawTools(el); }
    redraw();
    if ((st.box || st.poly.length >= 3 || st.circ) && !st.view) fit(true);
  }
  function fit(instant) {
    if (!st.map) return;
    var b = null;
    if (st.circ) b = L.circle(st.circ.c, { radius: st.circ.r }).getBounds();
    else if (st.poly.length >= 3) b = L.latLngBounds(st.poly);
    if (b) st.map[instant ? "fitBounds" : "flyToBounds"](b.pad(0.8), { maxZoom: 19, animate: !instant, duration: 0.6 });
  }
  function syncPan() {
    var m = st.map; if (!m) return;
    var draws = st.canEdit && !st.space && ((st.mode === "box" && !st.box) || (st.mode === "circle" && !st.circ) || st.mode === "poly");
    if (draws) m.dragging.disable(); else m.dragging.enable();
    m.getContainer().classList.toggle("arr-drawing", draws);
  }
  function shapeOf(z, color, weight) {
    if (z.geofence_type === "polygon" && z.polygon && z.polygon.length >= 3) return L.polygon(z.polygon, { color: color, weight: weight, fillOpacity: 0.12, interactive: false });
    return L.circle([z.lat, z.lng], { radius: z.radius_m || 50, color: color, weight: weight, fillOpacity: 0.12, interactive: false });
  }
  function redraw() {
    if (!st.layer) return;
    st.layer.clearLayers();
    st.list.forEach(function (z) {
      if (st.sel && z.id === st.sel.id) return;
      shapeOf(z, z.active ? "#94a3b8" : "#cbd5e1", 2).bindTooltip(z.name).addTo(st.layer);
    });
    if (st.circ) drawCircleHandles();
    else if (st.box) drawBoxHandles();
    else if (st.poly.length >= 3) {
      L.polygon(st.poly, { color: "#1677e8", weight: 3, fillColor: "#1677e8", fillOpacity: 0.18, interactive: false }).addTo(st.layer);
      if (st.mode === "poly" && st.canEdit) st.poly.forEach(function (pt, i) {
        L.marker(pt, { draggable: true, keyboard: false, zIndexOffset: 500, icon: L.divIcon({ className: "arr-corner", html: "<span>" + (i + 1) + "</span>", iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .on("dragend", function (e) { var ll = e.target.getLatLng(); st.poly[i] = r6([ll.lat, ll.lng]); redraw(); }).addTo(st.layer);
      });
    }
    paintBits();
  }

  // drawing: box / circle / freehand all use pointer events on the map container
  function drawTools(el) {
    var m = st.map, a0 = null, px = null, prev = null, pts = null, line = null;
    m.doubleClickZoom.disable(); m.boxZoom.disable();
    function clearPrev() { if (prev) { st.map.removeLayer(prev); prev = null; } if (line) { st.map.removeLayer(line); line = null; } }
    function hud(html) { var h = $("gfHud"); if (h) { h.innerHTML = html; h.classList.add("on"); } }
    st.cancelDraw = function () { a0 = null; px = null; pts = null; clearPrev(); paintBits(); };
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || st.space || e.target.closest(".arr-handle, .arr-corner, .leaflet-control, .arr-dock, .arr-hud, .arr-hint, .gf-panel, .gf-tab")) return;
      var drawsBox = st.mode === "box" && !st.box, drawsCircle = st.mode === "circle" && !st.circ, drawsPoly = st.mode === "poly";
      if (!drawsBox && !drawsCircle && !drawsPoly) return;
      var ll = m.mouseEventToLatLng(e);
      a0 = [ll.lat, ll.lng]; px = [e.clientX, e.clientY]; if (drawsPoly) pts = [m.mouseEventToContainerPoint(e)];
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault();
    });
    el.addEventListener("pointermove", function (e) {
      if (!a0) return;
      var ll = m.mouseEventToLatLng(e), p = [ll.lat, ll.lng];
      if (st.mode === "box") {
        var b = boxFromDrag(a0, p), c = boxCorners(b);
        if (prev) prev.setLatLngs(c); else prev = L.polygon(c, { color: "#1677e8", weight: 3, dashArray: "8 6", fillColor: "#1677e8", fillOpacity: 0.16, interactive: false, className: "arr-box-draw" }).addTo(m);
        hud('<b>' + st.esc(fmtM(b.w) + " × " + fmtM(b.h)) + '</b><span>' + st.esc(fmtArea(b.w * b.h)) + '</span>');
      } else if (st.mode === "circle") {
        var r = Math.max(5, distM(a0, p));
        if (prev) { prev.setLatLng(a0); prev.setRadius(r); } else prev = L.circle(a0, { radius: r, color: "#1677e8", weight: 3, dashArray: "8 6", fillColor: "#1677e8", fillOpacity: 0.16, interactive: false, className: "arr-box-draw" }).addTo(m);
        hud('<b>' + st.esc(fmtM(r) + " radius") + '</b>');
      } else if (pts) {
        var q = m.mouseEventToContainerPoint(e), last = pts[pts.length - 1];
        if (Math.abs(q.x - last.x) + Math.abs(q.y - last.y) < 4) return;
        pts.push(q);
        if (pts.length >= 3) { var ll2 = pts.map(function (z) { return m.containerPointToLatLng(z); }); if (line) line.setLatLngs(ll2); else line = L.polyline(ll2, { color: "#1677e8", weight: 3, interactive: false }).addTo(m); }
      }
    });
    function end(e, cancel) {
      if (!a0) return;
      var start = a0, moved = px && e ? Math.hypot(e.clientX - px[0], e.clientY - px[1]) : 0, stroke = pts;
      a0 = null; px = null; pts = null; clearPrev();
      if (cancel || !e || moved < 10) { paintBits(); return; }
      var ll = m.mouseEventToLatLng(e), p = [ll.lat, ll.lng];
      st.justDrew = true; setTimeout(function () { st.justDrew = false; }, 400);
      if (st.mode === "box") {
        var b = boxFromDrag(start, p); if (b.w < 3 || b.h < 3) { paintBits(); return; }
        b.c = r6(b.c); st.box = b; st.circ = null; st.poly = boxCorners(b);
      } else if (st.mode === "circle") {
        st.circ = { c: r6(start), r: Math.max(10, Math.round(distM(start, p))) }; st.box = null; st.poly = [];
      } else if (stroke && stroke.length >= 6) {
        var tol = 3, simple = simplify(stroke, tol);
        while (simple.length > 100) { tol *= 1.5; simple = simplify(stroke, tol); }
        if (simple.length < 3) { paintBits(); return; }
        st.poly = simple.map(function (q) { var l = m.containerPointToLatLng(q); return r6([l.lat, l.lng]); }); st.box = null; st.circ = null;
      } else { paintBits(); return; }
      redraw();
    }
    el.addEventListener("pointerup", function (e) { end(e, false); });
    el.addEventListener("pointercancel", function () { end(null, true); });
  }

  // handles
  function hIcon(cls) { return L.divIcon({ className: "arr-handle " + cls, html: "<i></i>", iconSize: [22, 22], iconAnchor: [11, 11] }); }
  function hMk(pos, cls) { return L.marker(pos, { draggable: true, keyboard: false, icon: hIcon(cls), zIndexOffset: 800 }).addTo(st.layer); }
  function placeRot() {
    var b = st && st.box, hs = st && st.hs;
    if (!b || !hs || !hs.rot || !st.map) return;
    var a = b.ang * Math.PI / 180, mpp = 156543.03392 * Math.cos(b.c[0] * Math.PI / 180) / Math.pow(2, st.map.getZoom()), d = b.h / 2 + mpp * 36;
    var p = fromXY(b.c, d * Math.sin(a), d * Math.cos(a)), top = fromXY(b.c, (b.h / 2) * Math.sin(a), (b.h / 2) * Math.cos(a));
    hs.rot.setLatLng(p); if (hs.stem) hs.stem.setLatLngs([top, p]);
  }
  function syncBox(skip) {
    var b = st.box, hs = st.hs, pts = boxCorners(b);
    st.poly = pts; hs.poly.setLatLngs(pts);
    hs.corners.forEach(function (mk, i) { if (skip !== "c" + i) mk.setLatLng(pts[i]); });
    if (skip !== "mid") hs.mid.setLatLng(b.c);
    if (skip !== "rot") placeRot();
    var h = $("gfHud"); if (h) { h.innerHTML = hudHtml(); h.classList.add("on"); }
    var z = $("gfZone"); if (z) z.innerHTML = zoneHtml();
  }
  function drawBoxHandles() {
    var b = st.box, hs = st.hs = { corners: [] };
    hs.poly = L.polygon(boxCorners(b), { color: "#1677e8", weight: 3, fillColor: "#1677e8", fillOpacity: 0.18, interactive: false, className: "arr-box-shape" }).addTo(st.layer);
    if (!st.canEdit) return;
    boxCorners(b).forEach(function (p, i) {
      var corner = hMk(p, "arr-h-corner"), opp = null;
      corner.on("dragstart", function () { opp = boxCorners(st.box)[(i + 2) % 4]; });
      corner.on("drag", function (e) {
        if (!opp) return;
        var ll = e.target.getLatLng(), d = toXY(opp, [ll.lat, ll.lng]), a = st.box.ang * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
        var u = d[0] * c - d[1] * s, v = d[0] * s + d[1] * c, w = Math.max(2, Math.abs(u)), h = Math.max(2, Math.abs(v)), uu = (u < 0 ? -w : w) / 2, vv = (v < 0 ? -h : h) / 2;
        st.box = { c: r6(fromXY(opp, uu * c + vv * s, -uu * s + vv * c)), w: w, h: h, ang: st.box.ang }; syncBox("c" + i);
      });
      corner.on("dragend", function () { redraw(); });
      hs.corners.push(corner);
    });
    hs.mid = hMk(b.c, "arr-h-move");
    hs.mid.on("drag", function (e) { var ll = e.target.getLatLng(); st.box.c = [ll.lat, ll.lng]; syncBox("mid"); });
    hs.mid.on("dragend", function () { st.box.c = r6(st.box.c); st.poly = boxCorners(st.box); redraw(); });
    hs.stem = L.polyline([b.c, b.c], { color: "#1677e8", weight: 2, dashArray: "3 4", interactive: false }).addTo(st.layer);
    hs.rot = hMk(b.c, "arr-h-rot");
    hs.rot.on("drag", function (e) {
      var ll = e.target.getLatLng(), d = toXY(st.box.c, [ll.lat, ll.lng]), ang = Math.atan2(d[0], d[1]) * 180 / Math.PI, snap = Math.round(ang / 15) * 15;
      if (e.originalEvent && !e.originalEvent.shiftKey && Math.abs(ang - snap) < 2.5) ang = snap;
      st.box.ang = ang; syncBox("rot");
    });
    hs.rot.on("dragend", function () { redraw(); });
    placeRot();
  }
  function drawCircleHandles() {
    var c = st.circ, ring = L.circle(c.c, { radius: c.r, color: "#1677e8", weight: 3, fillColor: "#1677e8", fillOpacity: 0.18, interactive: false, className: "arr-box-shape" }).addTo(st.layer);
    if (!st.canEdit) return;
    var edge = hMk(fromXY(c.c, c.r, 0), "arr-h-rot"), mid = hMk(c.c, "arr-h-move");
    function refresh(skip) {
      ring.setLatLng(st.circ.c); ring.setRadius(st.circ.r);
      if (skip !== "edge") edge.setLatLng(fromXY(st.circ.c, st.circ.r, 0));
      var h = $("gfHud"); if (h) { h.innerHTML = hudHtml(); h.classList.add("on"); }
      var z = $("gfZone"); if (z) z.innerHTML = zoneHtml();
    }
    edge.on("drag", function (e) { var ll = e.target.getLatLng(); st.circ.r = Math.max(10, Math.round(distM(st.circ.c, [ll.lat, ll.lng]))); refresh("edge"); });
    edge.on("dragend", function () { redraw(); });
    mid.on("drag", function (e) { var ll = e.target.getLatLng(); st.circ.c = [ll.lat, ll.lng]; refresh(); });
    mid.on("dragend", function () { st.circ.c = r6(st.circ.c); redraw(); });
  }
  function testPoint(p) {
    var hit = st.list.filter(function (z) {
      return z.active && (z.geofence_type === "polygon" ? insidePoly(p[0], p[1], z.polygon || []) : distM([z.lat, z.lng], p) <= (z.radius_m || 0));
    });
    st.test = hit.length ? "Inside: " + hit.map(function (z) { return z.name + " (" + [z.allow_checkin ? "check-in" : "", z.allow_access ? "access" : ""].filter(Boolean).join(" + ") + ")"; }).join(", ") : "Outside every active geofence";
    if (st.testMark) st.layer.removeLayer(st.testMark);
    st.testMark = L.circleMarker(p, { radius: 7, color: hit.length ? "#16a34a" : "#dc2626", weight: 3, fillOpacity: .9 }).addTo(st.layer);
    var t = $("gfHint"); if (t) t.textContent = st.test;
  }

  // ---------------------------------------------------------------- save / delete
  function save(f) {
    var msg = $("gfMsg"), name = f.name.value.trim();
    if (!name) { msg.textContent = "Give the geofence a name."; return; }
    var row = { company_id: st.cid, name: name, allow_checkin: f.allow_checkin.checked, allow_access: f.allow_access.checked, active: f.active.checked,
      max_accuracy_m: Number(f.max_accuracy_m.value) || 100, note: f.note.value.trim() || null };
    if (st.circ) { row.geofence_type = "circle"; row.lat = st.circ.c[0]; row.lng = st.circ.c[1]; row.radius_m = Math.round(st.circ.r); row.polygon = null; }
    else if (st.poly.length >= 3) { var c = st.box ? st.box.c : centreOf(st.poly); row.geofence_type = "polygon"; row.lat = c[0]; row.lng = c[1]; row.polygon = st.poly; row.radius_m = null; }
    else { msg.textContent = "Draw the zone on the map first: press and drag a box."; return; }
    if (!row.allow_checkin && !row.allow_access) { msg.textContent = "Tick at least one thing this zone allows."; return; }
    msg.textContent = "Saving…";
    var q = st.sel && st.sel.id ? st.db.from("it_geofences").update(row).eq("id", st.sel.id) : st.db.from("it_geofences").insert(row);
    q.select("*").single().then(function (r) {
      if (r.error) { msg.textContent = /duplicate|unique/.test(r.error.message) ? "A geofence with this name already exists." : r.error.message; return; }
      st.sel = r.data; load().then(function () { var m = $("gfMsg"); if (m) m.textContent = "Saved."; });
    });
  }
  function pick(z) {
    st.sel = z; st.test = null; st.view = null;
    st.box = null; st.circ = null; st.poly = [];
    if (z) {
      if (z.geofence_type === "circle") { st.circ = { c: [z.lat, z.lng], r: z.radius_m || 50 }; st.mode = "circle"; }
      else { st.poly = z.polygon || []; st.box = polyToBox(st.poly); st.mode = st.box ? "box" : "poly"; if (!st.canEdit) st.mode = "pan"; }
    } else st.mode = st.canEdit ? "box" : "pan";
    paint();
  }
  function switchMode(m) {
    var keep = st.sel; var f = $("gfForm");
    if (f) { keep = Object.assign({}, st.sel || {}, { name: f.name.value, allow_checkin: f.allow_checkin.checked, allow_access: f.allow_access.checked, active: f.active.checked }); st.sel = keep.id ? st.sel : null; st.draft = keep; }
    st.mode = m; st.test = null;
    paintBits(); redraw();
  }

  document.addEventListener("click", function (e) {
    if (!st || !st.host || !document.body.contains(st.host)) return;
    var t = e.target;
    var p = t.closest("[data-gf-pick]"); if (p) { pick(st.list.filter(function (z) { return z.id === p.getAttribute("data-gf-pick"); })[0] || null); return; }
    var fo = t.closest("[data-gf-fold]");
    if (fo) { var side = fo.getAttribute("data-gf-fold"); if (side === "left") st.foldL = !st.foldL; else st.foldR = !st.foldR; var g = st.host.querySelector(".gf"); g.classList.toggle("fold-l", !!st.foldL); g.classList.toggle("fold-r", !!st.foldR); return; }
    if (t.closest("[data-gf-new]")) { st.foldR = false; pick(null); return; }
    var mo = t.closest("[data-gf-mode]");
    if (mo) {
      var want = mo.getAttribute("data-gf-mode");
      if ((want === "box" && st.mode === "box" && st.box) || (want === "circle" && st.mode === "circle" && st.circ)) { st.box = null; st.circ = null; st.poly = []; redraw(); return; }
      if (want !== st.mode) { st.mode = want; st.test = null; redraw(); }
      return;
    }
    if (t.closest("[data-gf-fit]")) { fit(false); return; }
    if (t.closest("[data-gf-clear]")) { st.box = null; st.circ = null; st.poly = []; redraw(); return; }
    if (t.closest("[data-gf-delete]")) {
      var z = st.sel; if (!z || !z.id) return;
      if (!window.confirm("Delete “" + z.name + "”? Staff inside it will need the office network again.")) return;
      st.db.from("it_geofences").delete().eq("id", z.id).then(function (r) { if (r.error) { var m = $("gfMsg"); if (m) m.textContent = r.error.message; return; } st.sel = null; pick(null); load(); });
    }
  });
  document.addEventListener("input", function (e) {
    if (!st || !e.target.matches || !e.target.matches("[data-gf-search]")) return;
    var q = e.target.value.trim().toLowerCase();
    [].forEach.call(st.host.querySelectorAll(".gf-left li"), function (li) { li.style.display = !q || li.getAttribute("data-name").indexOf(q) > -1 ? "" : "none"; });
  });
  document.addEventListener("submit", function (e) { if (st && e.target.id === "gfForm") { e.preventDefault(); save(e.target); } });
  document.addEventListener("keydown", function (e) {
    if (!st || !st.map) return;
    if (e.key === "Escape" && st.cancelDraw) st.cancelDraw();
    if (e.code === "Space" && !e.target.closest("input, textarea, select, button") && !st.space) { st.space = true; e.preventDefault(); syncPan(); }
  });
  document.addEventListener("keyup", function (e) { if (st && e.code === "Space" && st.space) { st.space = false; syncPan(); } });

  window.ItGeofences = { mount: mount };
})();
