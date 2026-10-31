/* Dashboard: the normal landing page after sign-in. Platform owners pick a company here first. */
(function () {
  var db = window.veyoraDb;
  var VIEW_KEY = "veyora-view-company";
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cap(t) { return t === "hr" ? "HR" : t === "it" ? "IT" : t ? t.charAt(0).toUpperCase() + t.slice(1) : ""; }

  var me = null, isPlatform = false, company = null, myRole = "", allCompanies = [];

  /* ---- shell: nav, user menu ---- */
  var icons = {
    Dashboard: "M3 11 12 4l9 7v9H3z", Operations: "M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4", Schedules: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
    Fleet: "M12 4v12M8 8h8M4 14c1 5 4 6 8 6s7-1 8-6", Passengers: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6",
    "HR & Crew": "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3 3-5 6-5s6 2 6 5M17 6a3 3 0 0 1 0 6M21 20c0-2-1-4-3-4.6",
    IT: "M3 5h18v11H3zM8 20h8M12 16v4", Finance: "M4 6h16v12H4zM4 10h16M8 15h3", Maintenance: "M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-3-1-1-3z", Reports: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
    Settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12l2-1-2-4-2 .6-1.5-1L15 4H9l-.5 2.6-1.5 1L5 7l-2 4 2 1v1l-2 1 2 4 2-.6 1.5 1L9 20h6l.5-2.6 1.5-1 2 .6 2-4-2-1z"
  };
  function modsOf(c) {
    var m = (c && c.settings && c.settings["17_module_and_feature_management"]) || {};
    return { fleet: m.fleet !== false, schedules: m.schedules !== false, operations: m.operations !== false, passengers: m.passengers !== false, finance: m.finance !== false, reportHub: m.reportHub !== false, hr: m.hr !== false, it: m.it !== false, maintenance: m.maintenance !== false };
  }
  /* Cursor 2026-10-23: use shared shell nav so section arrows expand/collapse. */
  function drawDashNav() {
    if (window.VeyoraShell && window.VeyoraShell.nav) {
      if (window.VeyoraShell.setViewCompany) window.VeyoraShell.setViewCompany(company, myRole, isPlatform);
      window.VeyoraShell.nav("Dashboard");
      return;
    }
    var mods = modsOf(company), manage = isPlatform || myRole === "owner" || myRole === "admin";
    $("nav").innerHTML = ["Dashboard", "Operations", "Schedules", "Fleet", "Passengers", "HR & Crew", "IT", "Finance", "Maintenance", "Reports", "Settings"].filter(function (n) {
      if (n === "Operations") return mods.operations || manage;
      if (n === "Schedules") return mods.schedules || manage;
      if (n === "Fleet") return mods.fleet || manage;
      if (n === "Passengers") return mods.passengers || manage;
      if (n === "Finance") return mods.finance || manage;
      if (n === "Reports") return mods.reportHub || manage;
      if (n === "HR & Crew") return mods.hr || manage;
      if (n === "IT") return mods.it || manage;
      if (n === "Maintenance") return mods.maintenance || manage;
      return true;
    }).map(function (n) {
      var href = n === "Dashboard" ? "dashboard.html" : n === "Settings" ? "settings.html" : n === "Operations" ? "operations.html" : n === "Schedules" ? "schedules.html" : n === "Fleet" ? "fleet.html" : n === "Passengers" ? "passengers.html" : n === "Finance" ? "finance.html" : n === "Reports" ? "reports.html" : n === "HR & Crew" ? "hr.html" : n === "IT" ? "it.html" : n === "Maintenance" ? "maintenance.html" : "#", on = n === "Dashboard";
      return '<a href="' + href + '" class="' + (on ? "on" : href === "#" ? "off" : "") + '" title="' + n + '"' + (on ? ' aria-current="page"' : "") + '><svg viewBox="0 0 24 24"><path d="' + icons[n] + '"/></svg><span class="nav-label">' + n + '</span>' + (href === "#" ? '<span class="soon">Soon</span>' : "") + "</a>";
    }).join("");
  }
  drawDashNav();
  $("nav").addEventListener("click", function (e) { if (e.target.closest("a.off")) e.preventDefault(); });
  $("burger").addEventListener("click", function () {
    if (window.matchMedia("(max-width:900px)").matches) $("side").classList.toggle("open");
    else if ($("side").classList.contains("is-collapsed") && window.VeyoraShell && window.VeyoraShell.setNavCollapsed) window.VeyoraShell.setNavCollapsed(false);
    else $("side").classList.toggle("open");
  });
  if (window.VeyoraShell && window.VeyoraShell.initSideCollapse) window.VeyoraShell.initSideCollapse();
  $("me").addEventListener("click", function (e) { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; });
  document.addEventListener("click", function () { $("menu").hidden = true; });
  $("signOut").addEventListener("click", function () { db.auth.signOut().then(function () { location.replace("index.html"); }); });

  /* ---- company switcher (platform owner) ---- */
  var sw = $("cswitch"), swBtn = $("csBtn"), swPanel = $("csPanel"), swSearch = $("csSearch"), swList = $("csList");
  function drawSwitchList() {
    var q = swSearch.value.trim().toLowerCase();
    var rows = allCompanies.filter(function (c) { return !q || (c.name + " " + c.code + " " + c.type + " " + c.status).toLowerCase().indexOf(q) > -1; });
    swList.innerHTML = rows.length ? rows.map(function (c) {
      return '<li role="option" tabindex="0" data-cid="' + c.id + '"' + (company && c.id === company.id ? ' aria-selected="true"' : "") + '><span class="grow"><strong>' + esc(c.name) + '</strong><small>' + esc(c.code) + ' · ' + esc(c.type) + '</small></span><span class="tag">' + esc(c.status) + '</span></li>';
    }).join("") : '<li class="cs-empty">No companies match.</li>';
  }
  function closeSwitch() { swPanel.hidden = true; swBtn.setAttribute("aria-expanded", "false"); }
  function openSwitch() { swPanel.hidden = false; swBtn.setAttribute("aria-expanded", "true"); swSearch.value = ""; drawSwitchList(); swSearch.focus(); }
  function pick(li) { if (!li || !li.dataset.cid) return; closeSwitch(); openCompany(li.dataset.cid); }
  swBtn.addEventListener("click", function (e) { e.stopPropagation(); if (swPanel.hidden) openSwitch(); else closeSwitch(); });
  swPanel.addEventListener("click", function (e) { e.stopPropagation(); pick(e.target.closest("[data-cid]")); });
  swSearch.addEventListener("input", drawSwitchList);
  swSearch.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); pick(swList.querySelector("[data-cid]")); }
    if (e.key === "ArrowDown") { var f = swList.querySelector("[data-cid]"); if (f) f.focus(); }
    if (e.key === "Escape") closeSwitch();
  });
  swList.addEventListener("keydown", function (e) {
    var li = e.target.closest("[data-cid]"); if (!li) return;
    if (e.key === "Enter") pick(li);
    if (e.key === "ArrowDown" && li.nextElementSibling && li.nextElementSibling.dataset.cid) li.nextElementSibling.focus();
    if (e.key === "ArrowUp") { if (li.previousElementSibling) li.previousElementSibling.focus(); else swSearch.focus(); }
    if (e.key === "Escape") { closeSwitch(); swBtn.focus(); }
  });
  document.addEventListener("click", closeSwitch);

  /* ---- dashboard content ---- */
  var SAMPLE_KEY = "veyora-dash-sample";
  var sampleOn = false;
  try { sampleOn = localStorage.getItem(SAMPLE_KEY) === "1"; } catch (e) {}
  var view = null; // { company, sub, real } for re-rendering when the sample switch changes

  var P = {
    ship: '<path d="M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4"/>', people: '<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 3-5.5 6-5.5s6 2.2 6 5.5M16 5a3.5 3.5 0 0 1 0 6.5M21 20c0-2.4-1.5-4.2-3.6-5"/>',
    calendar: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>', user: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    route: '<path d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
    alert: '<path d="M12 4 2.5 20h19zM12 10v4M12 17v.5"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
  };
  function ic(name) { return '<svg viewBox="0 0 24 24">' + P[name] + '</svg>'; }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-"); }

  function count(table, build) {
    var q = db.from(table).select("*", { count: "exact", head: true });
    return build(q).then(function (r) { return r.error ? null : r.count; });
  }

  function staffName(profile, member) {
    var preferred = member && member.hr_meta && String(member.hr_meta.preferred_name || "").trim();
    var full = profile && String(profile.full_name || "").trim();
    return preferred || full || "";
  }
  function initialsOf(name) {
    return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map(function (s) { return s.charAt(0).toUpperCase(); }).join("") || "?";
  }
  function greet(name) {
    var h = new Date().getHours(), part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    var first = String(name || "").trim().split(/\s+/)[0] || "";
    $("greeting").textContent = "Good " + part + (first ? ", " + first : "");
    $("todayDate").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function platformHome() {
    $("dashSub").textContent = "Choose a company to see its data.";
    $("setupBanner").hidden = true;
    return db.rpc("platform_stats").then(function (r) {
      var s = (r.data || [])[0] || {};
      $("dash").innerHTML = '<div class="kpis">' + [["people", "purple", "Companies", s.companies, "On the platform"], ["calendar", "teal", "Pending approval", s.pending, "Waiting for review"], ["user", "blue", "Users", s.users, "Across all companies"], ["ship", "orange", "Memberships", s.memberships, "Company seats"]].map(function (x) {
        return '<div class="kpi"><span class="tile tone-' + x[1] + '">' + ic(x[0]) + '</span><span><small>' + x[2] + '</small><strong>' + (x[3] == null ? "–" : x[3]) + '</strong><span class="kpi-sub">' + x[4] + '</span></span></div>';
      }).join("") + '</div><section class="dash-card"><h2>Select a company</h2><p class="note">Use the company menu at the top left to search and open any company on the platform. Manage approvals and billing in the <a href="platform.html">Platform owner</a> area.</p></section>';
    });
  }

  function activityText(a) {
    var d = a.detail || "", act = String(a.action);
    if (act === "setting_changed") return { text: "Setting updated: " + d.replace(/^\d+_/, "").replace(/_/g, " "), tag: "Settings" };
    if (act === "member_org_changed") return { text: "Staff details updated", tag: "HR & Crew" };
    if (act === "employee_no_assigned") return { text: "Employee ID " + d + " assigned", tag: "HR & Crew" };
    if (act.indexOf("subscription") === 0 || act.indexOf("renewal") === 0 || act === "redeem_failed") return { text: act.replace(/_/g, " ") + (d ? ": " + d : ""), tag: "Billing" };
    return { text: act.replace(/_/g, " ") + (d ? ": " + d : ""), tag: "Company" };
  }
  function fmtTime(iso) {
    var d = new Date(iso), now = new Date(), t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === now.toDateString() ? t : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + t;
  }

  function dataset(real) {
    if (sampleOn) return window.VEYORA_SAMPLE;
    return {
      kpis: [
        { icon: "ship", tone: "blue", label: "Active vessels", value: "0", sub: "No vessels added yet" },
        { icon: "people", tone: "purple", label: "Passengers today", value: "0", sub: "No bookings today" },
        { icon: "calendar", tone: "teal", label: "Scheduled trips", value: "0", sub: "No trips scheduled" },
        { icon: "user", tone: "orange", label: "Crew on duty", value: String(real.onDuty), sub: real.rostered ? "Detected from today's Duty Roster" : "Nobody on the roster today" }
      ],
      trips: [], upcoming: [], fleet: [], vessels: [], activity: real.activity
    };
  }


  /* ---- fleet map (provider-neutral vessel shape: id, name, lat, lng, speed, heading, updated, state) ---- */
  var fleetMap = null;
  function trackingOpts() {
    var t = (company && company.settings && company.settings["6_vessel_tracking"]) || {};
    return {
      enabled: t.enabled === true,
      view: t.view === "Maldives overview" ? "overview" : "fit",
      height: { Compact: 170, Standard: 230, Large: 320 }[t.height] || 230,
      labels: t.labels === true, docked: t.docked !== false, maintenance: t.maintenance !== false,
      stale: Math.max(1, Number(t.stale) || 15)
    };
  }
  var STATE_COLOR = { moving: "#1677e8", docked: "#6b7a96", maintenance: "#f59e0b" };
  function ago(mins) { return mins <= 0 ? "just now" : mins === 1 ? "1 minute ago" : mins + " minutes ago"; }
  function fleetCard(vessels) {
    var o = trackingOpts();
    if (!o.enabled) return "";
    vessels = vessels.filter(function (v) { return (o.docked || v.state !== "docked") && (o.maintenance || v.state !== "maintenance"); });
    var moving = vessels.filter(function (v) { return v.state === "moving"; }).length;
    var live = vessels.length > 0;
    return '<section class="dash-card fleet-card"><div class="fleet-head"><div><h2>Fleet map</h2><div class="fleet-count">' +
      (live ? vessels.length + " vessels · " + moving + " moving" : "No vessels tracked") + '</div></div>' +
      (sampleOn ? '<span class="tag">Sample</span>' : "") + '</div>' +
      '<div class="fleet-map-wrap"><div id="fleetMap" class="fleet-map" style="height:' + o.height + 'px" aria-label="Map of your vessels"></div>' +
      (live ? "" : '<div class="fleet-overlay"><span><strong>Vessel tracking isn’t connected</strong>Your vessels will appear here once live tracking is set up for this company.</span></div>') + '</div>' +
      '<div class="fleet-foot"><span class="fleet-legend"><span><i style="background:#1677e8"></i>Moving</span><span><i style="background:#6b7a96"></i>Docked</span><span><i style="background:#f59e0b"></i>Maintenance</span></span>' +
      (live && !sampleOn ? '<span><img src="https://followme.mv/api/images/icon_50.png" alt="">FollowMe Tracking Service</span>' : "") + '</div></section>';
  }
  function vesselIcon(v) {
    var col = STATE_COLOR[v.state] || STATE_COLOR.docked;
    var shape = v.state === "moving"
      ? '<path d="M12 2 19 21l-7-4-7 4z" fill="' + col + '" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>'
      : '<circle cx="12" cy="12" r="7" fill="' + col + '" stroke="#fff" stroke-width="2"/>';
    return L.divIcon({ className: "vmark", iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12],
      html: '<svg viewBox="0 0 24 24" style="transform:rotate(' + (Number(v.heading) || 0) + 'deg)">' + shape + '</svg>' });
  }
  function initFleetMap(vessels) {
    if (fleetMap) { fleetMap.remove(); fleetMap = null; }
    var o = trackingOpts();
    if (!o.enabled) return;
    vessels = vessels.filter(function (v) { return (o.docked || v.state !== "docked") && (o.maintenance || v.state !== "maintenance"); });
    var el = $("fleetMap");
    if (!el || !window.L) return;
    fleetMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView([4.25, 73.55], 9);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(fleetMap);
    var pts = [];
    vessels.forEach(function (v) {
      if (typeof v.lat !== "number" || typeof v.lng !== "number") return;
      pts.push([v.lat, v.lng]);
      var offline = (Number(v.updated) || 0) >= o.stale;
      var mk = L.marker([v.lat, v.lng], { icon: vesselIcon(v), title: v.name, opacity: offline ? 0.45 : 1 });
      if (o.labels) mk.bindTooltip(v.name, { permanent: true, direction: "right", offset: [10, 0], className: "vlabel" });
      mk
        .bindPopup('<div class="vpop"><strong>' + esc(v.name) + '</strong><span>' + esc(v.state === "moving" ? "Speed " + Number(v.speed).toFixed(1) + " kn · heading " + Math.round(v.heading) + "°" : v.state === "maintenance" ? "In maintenance" : "Docked") + '</span><span>' + (offline ? "Offline · last seen " : "Updated ") + esc(ago(Number(v.updated) || 0)) + '</span></div>').addTo(fleetMap);
    });
    if (o.view === "fit" && pts.length > 1) fleetMap.fitBounds(pts, { padding: [28, 28], maxZoom: 12 });
    else if (o.view === "fit" && pts.length === 1) fleetMap.setView(pts[0], 12);
    setTimeout(function () { if (fleetMap) fleetMap.invalidateSize(); }, 200);
  }

  function tripRow(t) {
    return '<li class="trip" data-route="' + esc(t.route) + '" data-status="' + esc(t.status) + '" data-text="' + esc((t.from + " " + t.to + " " + t.vessel + " " + t.captain).toLowerCase()) + '">' +
      '<span class="t">' + esc(t.time) + '<small>' + esc(t.mode) + '</small></span>' +
      '<span class="r"><strong>' + esc(t.from) + ' <span class="arrow">→</span> ' + esc(t.to) + '</strong><small><span>' + ic("route") + ' ' + esc(t.route) + '</span><span>' + ic("ship") + ' ' + esc(t.vessel) + '</span></small></span>' +
      '<span class="cap"><span class="ini">' + esc(t.captain.replace(/^Capt\.\s*/, "").slice(0, 2).toUpperCase()) + '</span>' + esc(t.captain) + '</span>' +
      '<span class="seat">' + ic("people") + esc(t.seats) + '</span>' +
      '<span><span class="chip st-' + slug(t.status) + '">' + esc(t.status) + '</span></span>' +
      '<button type="button" class="dots" aria-label="More">•••</button></li>';
  }

  function render() {
    if (!view) return;
    var c = view.company, real = view.real, d = dataset(real);
    var routes = [], statuses = [];
    d.trips.forEach(function (t) { if (routes.indexOf(t.route) < 0) routes.push(t.route); if (statuses.indexOf(t.status) < 0) statuses.push(t.status); });
    $("dashSub").textContent = isPlatform && !myRole ? c.name + " · viewing as platform owner" : "Here’s what’s happening across your transport network today.";
    $("sampleToggle").setAttribute("aria-checked", sampleOn);

    var banner = $("setupBanner");
    /* Cursor 2026-10-24: banner only while onboarding is incomplete — hide once 0_setup_wizard.done. */
    var wiz = c.settings && c.settings["0_setup_wizard"];
    var wizDone = !!(wiz && typeof wiz === "object" && (wiz.done === true || wiz.done === "true" || wiz.done === 1 || Number(wiz.phase) >= 5));
    var wizOpen = !sampleOn && real.admin && wiz && typeof wiz === "object" && !wizDone;
    var PHASE_LABELS = ["Company details", "Departments & designations", "Access control", "Department details", "Payroll"];
    if (wizOpen) {
      banner.hidden = false;
      banner.className = "setup-banner setup-banner-wiz";
      var step = Math.min(4, Math.max(0, Number(wiz.phase) || 0));
      var stepLabel = PHASE_LABELS[step] || "Setup";
      banner.innerHTML =
        '<span class="setup-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg></span>' +
        '<span class="setup-copy"><strong>Finish setting up ' + esc(c.name) + '</strong>' +
        '<span>Company onboarding is incomplete — next: <em>' + esc(stepLabel) + '</em> (step ' + (step + 1) + ' of 5).</span></span>' +
        '<a class="setup-cta" href="onboarding.html">Finish setup →</a>';
    } else {
      banner.hidden = true;
      banner.className = "setup-banner";
    }

    $("dash").innerHTML =
      '<div class="kpis">' + d.kpis.map(function (k) {
        return '<div class="kpi"><span class="tile tone-' + k.tone + '">' + ic(k.icon) + '</span><span class="kbody"><small>' + esc(k.label) + '</small><strong>' + esc(k.value) + '</strong><span class="kpi-row"><span class="kpi-sub">' + esc(k.sub) + '</span>' + (k.trend ? '<span class="trend">' + esc(k.trend) + '</span>' : "") + '</span></span></div>';
      }).join("") + '</div>' +
      '<div class="dash-grid"><section class="dash-card"><div class="card-head"><div><h2>Today’s operations</h2><p class="note">Live overview of scheduled and active services</p></div><button type="button" class="btn-soft" ' + (d.trips.length ? "" : "disabled") + '>View all trips</button></div>' +
      '<div class="filters"><select id="fRoute" aria-label="Route"><option value="">All routes</option>' + routes.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join("") + '</select>' +
      '<select id="fStatus" aria-label="Status"><option value="">All statuses</option>' + statuses.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join("") + '</select>' +
      '<label class="fsearch">' + ic("search") + '<input id="fText" type="search" placeholder="Search trips" aria-label="Search trips"></label></div>' +
      (d.trips.length ? '<ul class="trips" id="tripList">' + d.trips.map(tripRow).join("") + '</ul><div class="empty-dash" id="tripNone" hidden>No trips match your filters.</div>' : '<div class="empty-dash">No trips scheduled today. Trips will appear here once the Operations module is in use.</div>') + '</section>' +
      '<div style="display:flex;flex-direction:column;gap:18px">' + fleetCard(d.vessels) +
      '<section class="dash-card"><h2>Upcoming departures</h2><p class="note">Next scheduled movements</p>' + (d.upcoming.length ? '<ul class="upc">' + d.upcoming.map(function (u) {
        return '<li><span class="ic">' + ic("calendar") + '</span><span class="grow"><strong>' + esc(u.time) + ' · ' + esc(u.from) + ' → ' + esc(u.to) + '</strong><small>' + esc(u.sub) + '</small></span><span class="chip st-' + slug(u.status) + '">' + esc(u.status) + '</span></li>';
      }).join("") + '</ul>' : '<div class="empty-dash">No upcoming departures.</div>') + '</section>' +
      '<section class="dash-card"><h2>Quick actions</h2><div class="qa" style="margin-top:14px">' + [["calendar", "Create trip"], ["people", "Assign crew"], ["user", "Add passenger"], ["alert", "Report issue"]].map(function (q) {
        return '<button type="button" data-qa="' + q[1] + '">' + ic(q[0]) + q[1] + '</button>';
      }).join("") + '</div><p class="soon" id="qaMsg" role="status"></p></section></div></div>' +
      '<div class="dash-bottom"><section class="dash-card"><h2>Fleet readiness</h2><p class="note">Next planned departures and availability</p>' + (d.fleet.length ? '<ul class="list">' + d.fleet.map(function (f) {
        return '<li><span class="grow">' + esc(f.name) + '</span><span class="chip st-' + slug(f.status) + '">' + esc(f.status) + '</span><span class="muted">' + esc(f.note) + '</span></li>';
      }).join("") + '</ul>' : '<div class="empty-dash">No vessels added yet.</div>') + '</section>' +
      '<section class="dash-card"><h2>Latest activity</h2><p class="note">Updates from the transport network</p>' + (d.activity.length ? '<ul class="list">' + d.activity.map(function (a) {
        return '<li><span class="time">' + esc(a.time) + '</span><span class="grow">' + esc(a.text) + '</span><span class="muted">' + esc(a.tag) + '</span></li>';
      }).join("") + '</ul>' : '<div class="empty-dash">' + (real.admin ? "No activity yet." : "Only owners and admins see activity.") + '</div>') + '</section></div>';

    initFleetMap(d.vessels);
    if (window.VeyoraTip) window.VeyoraTip("dashboard", [
      "This is your company at a glance. Most numbers fill in as you use HR & Crew and the other modules.",
      "Turn on **Example data** (top right) to see how the page looks when everything is in use. It is never saved.",
      "Use the menu on the left. Items marked **Soon** are not built yet."
    ]);

    function filter() {
      var r = $("fRoute").value, s = $("fStatus").value, q = $("fText").value.trim().toLowerCase(), shown = 0;
      [].forEach.call(document.querySelectorAll("#tripList .trip"), function (li) {
        var ok = (!r || li.dataset.route === r) && (!s || li.dataset.status === s) && (!q || li.dataset.text.indexOf(q) > -1);
        li.hidden = !ok; if (ok) shown++;
      });
      var none = $("tripNone"); if (none) none.hidden = shown > 0;
    }
    ["fRoute", "fStatus"].forEach(function (id) { $(id).addEventListener("change", filter); });
    $("fText").addEventListener("input", filter);
    [].forEach.call(document.querySelectorAll("[data-qa]"), function (b) {
      b.addEventListener("click", function () { $("qaMsg").textContent = b.dataset.qa + " will be available when its module launches."; });
    });
  }

  $("sampleToggle").addEventListener("click", function () {
    sampleOn = !sampleOn;
    try { localStorage.setItem(SAMPLE_KEY, sampleOn ? "1" : "0"); } catch (e) {}
    render();
  });

  function todayIso() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }

  function gather(c, admin) {
    return Promise.all([
      count("company_members", function (q) { return q.eq("company_id", c.id).eq("active", true); }),
      count("departments", function (q) { return q.eq("company_id", c.id).eq("active", true); }),
      count("job_titles", function (q) { return q.eq("company_id", c.id).eq("active", true); }),
      admin ? count("company_invites", function (q) { return q.eq("company_id", c.id).is("accepted_at", null).gt("expires_at", new Date().toISOString()); }) : Promise.resolve(null),
      admin ? db.from("company_audit").select("action, detail, created_at").eq("company_id", c.id).order("created_at", { ascending: false }).limit(6) : Promise.resolve({ data: [] }),
      db.from("roster_entries").select("user_id, shift").eq("company_id", c.id).eq("day", todayIso()),
      db.from("company_members").select("user_id, duty_status").eq("company_id", c.id).eq("active", true),
      db.from("leave_requests").select("user_id").eq("company_id", c.id).eq("status", "Approved").lte("start_date", todayIso()).gte("end_date", todayIso())
    ]).then(function (r) {
      // Same rule as HR & Crew: today's roster decides (a real shift = on duty, not Off, Leave or Training);
      // approved leave always wins; people not on today's roster count by the status set by hand.
      var today = (r[5] && r[5].data) || [], shift = {}, away = {};
      today.forEach(function (e) { shift[e.user_id] = e.shift; });
      ((r[7] && r[7].data) || []).forEach(function (l) { away[l.user_id] = true; });
      var onDuty = ((r[6] && r[6].data) || []).filter(function (m) {
        if (away[m.user_id]) return false;
        var code = shift[m.user_id];
        return code ? ["OFF", "L", "TRN"].indexOf(code) < 0 : m.duty_status === "On duty";
      }).length;
      var members = r[0], depts = r[1], titles = r[2], invites = r[3];
      var steps = [
        ["company profile", !!(c.region && (c.email || c.phone))], ["logo", !!c.logo_path], ["departments", (depts || 0) > 0],
        ["job titles", (titles || 0) > 0], ["invite staff", (members || 0) > 1 || (invites || 0) > 0]
      ];
      return {
        admin: admin, members: members, rostered: today.length,
        onDuty: onDuty, total: steps.length, done: steps.filter(function (s) { return s[1]; }).length,
        todo: steps.filter(function (s) { return !s[1]; }).map(function (s) { return s[0]; }),
        activity: ((r[4] && r[4].data) || []).map(function (a) { var m = activityText(a); return { time: fmtTime(a.created_at), text: m.text, tag: m.tag }; })
      };
    });
  }

  function openCompany(id) {
    try { localStorage.setItem(VIEW_KEY, id); } catch (e) {}
    $("dash").innerHTML = '<p class="msg">Loading company…</p>';
    return Promise.all([
      db.from("companies").select("*").eq("id", id).single(),
      db.from("company_members").select("role").eq("company_id", id).eq("user_id", me).maybeSingle(),
      db.rpc("company_subscription", { p_company: id })
    ]).then(function (r) {
      if (r[0].error) throw new Error(r[0].error.message);
      company = r[0].data; myRole = (r[1].data && r[1].data.role) || "";
      swBtn.querySelector("span").textContent = company.name;
      $("userRole").textContent = isPlatform && !myRole ? "Platform owner" : cap(myRole);
      drawDashNav();
      var sub = r[2].error ? null : r[2].data;
      var admin = isPlatform || myRole === "owner" || myRole === "admin";
      if (window.VeyoraSub) window.VeyoraSub.watch(db, company.id, admin);
      if (window.VeyoraBell) window.VeyoraBell.watch(db, company.id, company.settings);
      return gather(company, admin).then(function (real) { view = { company: company, sub: sub, real: real }; render(); });
    }).catch(function (err) { $("dash").innerHTML = '<section class="card"><h2>Could not load company</h2><p class="note">' + esc(err.message) + '</p></section>'; });
  }

  // Keep "Crew on duty" current: re-check the roster when you come back to this tab, and every minute while it is open.
  function refresh() {
    if (!view || document.hidden) return;
    var v = view;
    gather(v.company, v.real.admin).then(function (real) {
      if (view !== v || (real.onDuty === v.real.onDuty && real.rostered === v.real.rostered)) return;
      v.real = real; render();
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", refresh);
  setInterval(refresh, 60000);

  db.auth.getSession().then(function (r) {
    var session = r.data.session;
    if (!session) { location.replace("index.html"); return; }
    me = session.user.id;
    var mail = session.user.email || "";
    greet("");
    return Promise.all([
      db.from("profiles").select("full_name").eq("id", me).maybeSingle(),
      db.from("company_members").select("hr_meta").eq("user_id", me).eq("active", true).order("created_at", { ascending: true }).limit(1)
    ]).then(function (rows) {
      var real = staffName(rows[0].data, rows[1].data && rows[1].data[0]);
      var header = real || mail.split("@")[0] || "…";
      $("userName").textContent = header;
      $("avatar").textContent = initialsOf(real || header);
      greet(real);
      return db.from("platform_admins").select("user_id");
    }).then(function (a) {
      isPlatform = !!(a.data && a.data.length);
      if (isPlatform) {
        var l = document.createElement("button"); l.type = "button"; l.textContent = "Platform owner";
        l.addEventListener("click", function () { location.href = "platform.html"; });
        $("menu").insertBefore(l, $("signOut"));
        return db.from("companies").select("id, name, code, type, status").order("name").then(function (c) {
          if (c.error) throw new Error(c.error.message);
          allCompanies = c.data || [];
          sw.hidden = false;
          $("userRole").textContent = "Platform owner";
          var stored = null; try { stored = localStorage.getItem(VIEW_KEY); } catch (e) {}
          var chosen = allCompanies.filter(function (x) { return x.id === stored; })[0];
          if (chosen) return openCompany(chosen.id);
          swBtn.querySelector("span").textContent = allCompanies.length ? "Select a company" : "No companies";
          return platformHome().then(function () { if (allCompanies.length) openSwitch(); });
        });
      }
      return db.from("company_members").select("role, company_id").eq("user_id", me).eq("active", true).order("created_at", { ascending: true }).limit(1).then(function (m) {
        if (m.error) throw new Error(m.error.message);
        if (!m.data.length) { $("dash").innerHTML = '<section class="card"><h2>No company yet</h2><p class="note">Create a company from the sign-in page, or ask your administrator for an invite.</p></section>'; return; }
        return openCompany(m.data[0].company_id);
      });
    });
  }).catch(function (err) {
    $("dash").innerHTML = '<section class="card"><h2>Could not load the dashboard</h2><p class="note">' + esc(err.message) + '</p></section>';
  });
})();
