/* Top-down speedboat markers for Leaflet maps (Operations > Live Vessel Map).
   One marker per vessel id, updated in place from live position data: position, compass heading (0 = north, 90 = east),
   status colour, selection and zoom size. The boat is rotated with CSS inside the marker, so the map never rotates it twice.
   Styles live in vessel-markers.css and are scoped to `.vsl`. */
(function () {
  var STATUSES = ["moving", "stopped", "idle", "offline"];
  var STATUS_TEXT = { moving: "Moving", stopped: "Stopped", idle: "Idle", offline: "Offline" };
  var uid = 0;

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* Marker size in pixels for a map zoom: small when zoomed out, up to 64 px close in; the selected boat is a little larger. */
  function sizeFor(zoom, selected) {
    var s = Math.max(16, Math.min(64, 14 + (zoom - 6) * 5));
    return Math.min(96, selected ? s * 1.25 : s);
  }

  /* The boat artwork. Gradient ids carry a per-marker prefix so several boats on one page never share ids. */
  function boatSvg(p) {
    var hull = "M50 5C37 12 30 31 25 49L15 96C12 115 19 137 32 149L42 155 58 155 68 149C81 137 88 115 85 96L75 49C70 31 63 12 50 5Z";
    return '<svg class="vsl-boat" viewBox="0 0 100 160" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>' +
      '<linearGradient id="' + p + 'h" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#aebdcb"/><stop offset="22%" stop-color="#fff"/><stop offset="78%" stop-color="#f5f9fd"/><stop offset="100%" stop-color="#8b9bad"/></linearGradient>' +
      '<linearGradient id="' + p + 'g" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0%" stop-color="#526f8a"/><stop offset="100%" stop-color="#142b40"/></linearGradient></defs>' +
      '<path d="' + hull + '" fill="#061a2e" opacity=".45" transform="translate(1 3)"/>' +
      '<path d="' + hull + '" fill="url(#' + p + 'h)" stroke="#8295a8" stroke-width="2"/>' +
      '<path d="M50 10C42 25 39 33 38 43L62 43C61 33 58 25 50 10Z" fill="#fff"/>' +
      '<path d="M31 51Q50 39 69 51L76 100Q75 120 63 137L37 137Q25 120 24 100Z" fill="#dce5ed" stroke="#9aaaba" stroke-width="1.5"/>' +
      '<path d="M39 48Q50 43 61 48L58 67Q50 72 42 67Z" fill="url(#' + p + 'g)" stroke="#9aaebe" stroke-width="2"/>' +
      '<path d="M31 78Q50 70 69 78L68 112Q67 121 59 125L41 125Q33 121 32 112Z" fill="url(#' + p + 'g)" stroke="#8da5b9" stroke-width="2"/>' +
      '<path d="M37 84L37 108Q38 115 43 117" fill="none" stroke="#b5d9f5" stroke-width="2" opacity=".5"/>' +
      '<path d="M27 67L21 101Q20 116 30 130" fill="none" stroke="#fff" stroke-width="2"/><path d="M73 67L79 101Q80 116 70 130" fill="none" stroke="#fff" stroke-width="2"/>' +
      '<path d="M35 130L65 130L61 143L55 148L45 148L39 143Z" fill="#c6d2de" stroke="#8195a8" stroke-width="1.5"/>' +
      '<rect x="34" y="140" width="13" height="17" rx="5" fill="#182b3d" stroke="#73899d" stroke-width="2"/><rect x="53" y="140" width="13" height="17" rx="5" fill="#182b3d" stroke="#73899d" stroke-width="2"/>' +
      '<circle cx="24" cy="91" r="2.5" fill="#28a9ff"/><circle cx="76" cy="91" r="2.5" fill="#28a9ff"/><circle cx="50" cy="20" r="2.5" fill="#1688ff"/></svg>';
  }
  function coneSvg(p) {
    return '<svg viewBox="0 0 100 160" aria-hidden="true" focusable="false"><defs><linearGradient id="' + p + 'c" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="currentColor" stop-opacity="0.02"/><stop offset="100%" stop-color="currentColor" stop-opacity="0.35"/></linearGradient></defs>' +
      '<path d="M50 5L17 70L83 70Z" fill="url(#' + p + 'c)"/></svg>';
  }
  function markerHtml(p) {
    return '<div class="vsl" role="button" tabindex="0">' +
      '<div class="vsl-glow"></div><div class="vsl-ring"></div><div class="vsl-cone">' + coneSvg(p) + '</div>' +
      '<div class="vsl-rot">' + boatSvg(p) + '</div><div class="vsl-off">×</div><div class="vsl-speed" hidden></div><div class="vsl-label"></div></div>';
  }

  /* One manager per map. opts: { onSelect(id, data|null), popupHtml(data) -> html, selectedId } */
  function create(map, opts) {
    opts = opts || {};
    var items = {};            // vessel id -> { marker, root, data, heading }
    var selectedId = opts.selectedId || null;

    function root(it) { return it.root; }
    function paintSize(it) {
      var sel = it.id === selectedId, w = sizeFor(map.getZoom(), sel);
      it.root.style.setProperty("--w", w + "px"); it.root.style.setProperty("--h", (w * 1.375) + "px");
      it.root.classList.toggle("selected", sel);
      it.marker.setZIndexOffset(sel ? 2000 : 1000);
    }
    function paint(it) {
      var d = it.data, r = it.root, status = STATUSES.indexOf(d.status) >= 0 ? d.status : "moving";
      STATUSES.forEach(function (s) { r.classList.remove(s); }); r.classList.add(status);
      r.classList.toggle("live", !!d.live && status !== "offline");
      var altN = d.alt_m != null ? Number(d.alt_m) : NaN;
      var freeze = !!d.noRotate || !!d.on_land || d.surface === "land" || (isFinite(altN) && altN > 5);
      var hasHeading = !freeze && Number.isFinite(d.heading);
      if (freeze) it.heading = 0;
      else if (hasHeading) {   // turn the short way round: 350° to 10° is a 20° turn, not a full spin back
        var to = ((d.heading % 360) + 360) % 360;
        it.heading = it.heading == null ? to : it.heading + ((to - (((it.heading % 360) + 360) % 360) + 540) % 360) - 180;
      }
      r.classList.toggle("no-heading", freeze || (!hasHeading && it.heading == null));
      r.style.setProperty("--heading", (freeze ? 0 : (it.heading || 0)) + "deg");
      var from = d.device || "";
      var spd = d.speedText || "";
      var alt = d.altText || (isFinite(altN) ? (Math.round(altN * 10) / 10) + " m" : "— m");
      var text = (d.name || "Vessel") + " · " + STATUS_TEXT[status] + (spd ? " · " + spd : "") + " · " + alt + (d.stale ? " (no recent signal)" : "") + (from ? " · " + from : "");
      var sig = text + "\t" + status + "\t" + !!d.live + "\t" + freeze + "\t" + (freeze ? 0 : (it.heading || 0));
      if (it.sig !== sig) {
        it.sig = sig;
        r.setAttribute("aria-label", text); r.setAttribute("title", text);
        var lab = r.querySelector(".vsl-label");
        lab.innerHTML = "<b>" + esc(d.name || "Vessel") + "</b>" +
          "<small>" + (spd ? esc(spd) : "— kn") + "</small>" +
          "<small class=\"vsl-alt" + (freeze ? " high" : "") + "\">" + esc(alt) + "</small>";
      }
      var chip = r.querySelector(".vsl-speed");
      if (chip) { chip.hidden = true; }
      paintSize(it);
      if (opts.popupHtml) {
        var html = opts.popupHtml(d);
        if (it.popupHtml !== html) { it.popupHtml = html; it.marker.setPopupContent(html); }
      }
    }
    function add(d) {
      var p = "vsl" + (++uid) + "-";
      var marker = L.marker([d.lat, d.lng], { keyboard: false, riseOnHover: true, icon: L.divIcon({ className: "vsl-icon", html: markerHtml(p), iconSize: [0, 0], iconAnchor: [0, 0] }) });
      marker.bindPopup("", { offset: [0, -24], autoPanPadding: [40, 40] });
      marker.addTo(map);
      var it = { id: d.id, marker: marker, root: marker.getElement().querySelector(".vsl"), data: d, heading: null };
      marker.on("click", function () { select(d.id); });
      it.root.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(d.id); marker.openPopup(); } });
      items[d.id] = it; paint(it);
    }
    function select(id) {
      selectedId = id || null;
      Object.keys(items).forEach(function (k) { paintSize(items[k]); });
      if (opts.onSelect) opts.onSelect(selectedId, selectedId && items[selectedId] ? items[selectedId].data : null);
    }

    /* Slide a boat to its new position over about a second instead of jumping, so a live feed looks like movement. */
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function glide(it, lat, lng) {
      if (it.toLat != null && Math.abs(it.toLat - lat) < 1e-6 && Math.abs(it.toLng - lng) < 1e-6) return;
      it.toLat = lat; it.toLng = lng;
      if (it.raf) { cancelAnimationFrame(it.raf); it.raf = 0; }
      var from = it.marker.getLatLng(), dLat = lat - from.lat, dLng = lng - from.lng;
      if (calm || (Math.abs(dLat) < 1e-7 && Math.abs(dLng) < 1e-7) || from.distanceTo([lat, lng]) > 5000) { it.marker.setLatLng([lat, lng]); return; }
      var t0 = performance.now(), ms = 1100;
      (function step(now) {
        var k = Math.min(1, (now - t0) / ms); k = k * (2 - k);   // ease out
        it.marker.setLatLng([from.lat + dLat * k, from.lng + dLng * k]);
        it.raf = k < 1 ? requestAnimationFrame(step) : 0;
      })(t0);
    }

    /* list: [{ id, lat, lng, heading, status, name, stale, ... }]. Adds new vessels, moves and restyles known ones, removes the rest. */
    function update(list) {
      var seen = {};
      (list || []).forEach(function (d) {
        if (d.id == null || !Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return;
        seen[d.id] = true;
        var it = items[d.id];
        if (!it) { add(d); return; }
        var moved = Math.abs(it.data.lat - d.lat) > 1e-6 || Math.abs(it.data.lng - d.lng) > 1e-6;
        it.data = d;
        if (moved) glide(it, d.lat, d.lng);
        paint(it);
      });
      Object.keys(items).forEach(function (k) {
        if (seen[k]) return;
        if (items[k].raf) cancelAnimationFrame(items[k].raf);
        items[k].marker.remove(); delete items[k];
        if (selectedId === k) { selectedId = null; if (opts.onSelect) opts.onSelect(null, null); }
      });
    }
    function onZoom() { Object.keys(items).forEach(function (k) { paintSize(items[k]); }); }
    map.on("zoomend", onZoom);
    map.on("click", function () { if (selectedId) select(null); });

    function destroy() {
      map.off("zoomend", onZoom);
      Object.keys(items).forEach(function (k) { if (items[k].raf) cancelAnimationFrame(items[k].raf); items[k].marker.remove(); });
      items = {};
    }
    return { update: update, select: select, destroy: destroy, selected: function () { return selectedId; }, count: function () { return Object.keys(items).length; } };
  }

  window.VeyoraVesselMarkers = { create: create, sizeFor: sizeFor, statusText: STATUS_TEXT, esc: esc };
})();
