/* Shared page shell: sidebar, top bar, user menu, and the platform owner's company switcher.
   Pages call VeyoraShell.start({ active, onCompany, onNone }). */
(function () {
  var db = window.veyoraDb;
  var VIEW_KEY = "veyora-view-company";
  var NAV_KEY = "veyora-nav-collapsed";
  var SUB_KEY = "veyora-nav-subs"; // Cursor 2026-10-23: per-section submenu open/closed
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cap(t) { return t === "hr" ? "HR" : t === "it" ? "IT" : t ? t.charAt(0).toUpperCase() + t.slice(1) : ""; }

  var ICONS = {
    Dashboard: "M3 11 12 4l9 7v9H3z", Operations: "M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4", Schedules: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
    Fleet: "M12 4v12M8 8h8M4 14c1 5 4 6 8 6s7-1 8-6", Passengers: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6",
    "HR & Crew": "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3 3-5 6-5s6 2 6 5M17 6a3 3 0 0 1 0 6M21 20c0-2-1-4-3-4.6",
    IT: "M3 5h18v11H3zM8 20h8M12 16v4", Finance: "M4 6h16v12H4zM4 10h16M8 15h3", Maintenance: "M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-3-1-1-3z", Reports: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
    Settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12l2-1-2-4-2 .6-1.5-1L15 4H9l-.5 2.6-1.5 1L5 7l-2 4 2 1v1l-2 1 2 4 2-.6 1.5 1L9 20h6l.5-2.6 1.5-1 2 .6 2-4-2-1z"
  };
  var PAGES = { Dashboard: "dashboard.html", Operations: "operations.html", Schedules: "schedules.html", Fleet: "fleet.html", Passengers: "passengers.html", "HR & Crew": "hr.html", IT: "it.html", Finance: "finance.html", Maintenance: "maintenance.html", Reports: "reports.html", Settings: "settings.html" };
  // Cursor 2026-10-24: pdf-layouts.html is a Finance/HR sub-page (not a top-level nav item).
  // HR sections. A third item "soon" marks parts that are planned but not built yet.
  var SUB = {
    // Cursor 2026-10-27: live overview is the Operations home; dispatch is #board.
    Operations: [["Operations overview", "operations.html"], ["Dispatch board", "operations.html#board"], ["Settings", "operations.html#settings"]],
    Schedules: [["Service timetable", "schedules.html"], ["Settings", "schedules.html#settings"]],
    Fleet: [["Fleet overview", "fleet.html"], ["Vessels in Maintenance", "maintenance.html#vessels"], ["Settings", "fleet.html#settings"]],
    Passengers: [["Passenger registry", "passengers.html"], ["Settings", "passengers.html#settings"]],
    // Cursor 2026-10-24: Finance Settings + shared PDF Layout Maker.
    // Cursor 2026-10-24: Invoices, Expenses, PDF Layouts under Finance.
    Finance: [["Finance overview", "finance.html#overview"], ["Refunds", "finance.html#refunds"], ["Tickets", "finance.html#tickets"], ["Invoices", "finance.html#invoices"], ["Expenses", "finance.html#expenses"], ["Ticket fares", "finance.html#fares"], ["Finance Settings", "finance.html#settings/general"], ["PDF Layouts", "pdf-layouts.html"]],
    Reports: [["Report library", "reports.html"]],
    // Cursor 2026-10-23: Departments & Designations under HR.
    "HR & Crew": [["HR Overview", "hr.html#overview"], ["Employees", "hr.html#employees"], ["Departments & Designations", "hr.html#organization"], ["Documents", "hr.html#documents"], ["Allowances", "hr.html#allowances"], ["Duty Roster", "roster.html"], ["Duty & Attendance", "hr.html#attendance"],
    ["Crew Management", "hr.html#crew"], ["Leave & Absence", "hr.html#leave"], ["Payroll & Overtime", "hr.html#payroll"], ["HR Reports", "hr.html#reports"]],
    Maintenance: [["Maintenance Overview", "maintenance.html#overview"], ["Vessels", "maintenance.html#vessels"], ["Preventive schedules", "maintenance.html#schedules"], ["Work orders", "maintenance.html#workorders"],
      ["Defects & breakdowns", "maintenance.html#defects"], ["Inspections", "maintenance.html#inspections"], ["Spare parts", "maintenance.html#parts"], ["Purchasing", "maintenance.html#purchasing"], ["Settings", "maintenance.html#settings"]],
    IT: [["IT Overview", "it.html#overview"], ["Networks", "it.html#networks"], ["Devices", "it.html#devices"], ["Assets", "it.html#assets"], ["Support tickets", "it.html#tickets"], ["Activity log", "it.html#log"], ["Who has access", "it.html#people"], ["Geofences", "it.html#geofences"], ["Domains", "it.html#domains"], ["App config", "it.html#appconfig"], ["Settings", "it.html#settings"]] };
  function subHere(href) {
    var page = location.pathname.split("/").pop() || "index.html", hash = location.hash.split("/")[0] || "", h = href.split("#"), q = h[0].split("?");
    if (q[0] !== page || (q[1] || "") !== location.search.slice(1)) return false;
    if (page === "operations.html") {
      var ops = hash === "#board" ? "#board" : hash === "#settings" ? "#settings" : "#";
      return ("#" + (h[1] || "")) === ops;
    }
    if (page === "schedules.html" || page === "fleet.html" || page === "passengers.html") {
      return ("#" + (h[1] || "")) === (hash === "#settings" ? "#settings" : "#");
    }
    if (page === "hr.html") {
      var cur = hash === "#employee" ? "#employees" : (hash === "#jobs" ? "#documents" : (hash || "#overview"));
      return ("#" + (h[1] || "overview")) === cur;
    }
    if (page === "finance.html") {
      var want = "#" + (h[1] || "overview"), cur = hash || "#overview";
      if (want.indexOf("#settings") === 0) return cur.indexOf("#settings") === 0;
      return want === cur;
    }
    if (page === "it.html" || page === "maintenance.html") return ("#" + (h[1] || "overview")) === (hash === "#vessel" ? "#vessels" : hash === "#part" ? "#parts" : hash === "#pr" || hash === "#po" || hash === "#suppliers" ? "#purchasing" : hash || "#overview");
    return true;
  }

  var state = { me: null, isPlatform: false, company: null, myRole: "", all: [] };

  // IT Settings → Module & Feature Management. Defaults on when unset. Owners/admins always keep Settings.
  function modsOf(c) {
    var m = (c && c.settings && c.settings["17_module_and_feature_management"]) || {};
    return { hr: m.hr !== false, agreements: m.agreements !== false, payroll: m.payroll !== false, reports: m.reports !== false, reportHub: m.reportHub !== false, it: m.it !== false, maintenance: m.maintenance !== false, fleet: m.fleet !== false, schedules: m.schedules !== false, operations: m.operations !== false, passengers: m.passengers !== false, finance: m.finance !== false };
  }
  /* Cursor 2026-10-23: company owners (and platform) always have full product access. */
  function isFullAccess() { return state.isPlatform || state.myRole === "owner"; }
  function canManageMods() { return isFullAccess() || state.myRole === "admin"; }
  function pageAllowed(n, mods) {
    if (isFullAccess() || n === "Dashboard" || n === "Settings" || !PAGES[n]) return true;
    if (n === "Operations") return mods.operations || canManageMods();
    if (n === "Schedules") return mods.schedules || canManageMods();
    if (n === "Fleet") return mods.fleet || canManageMods();
    if (n === "Passengers") return mods.passengers || canManageMods();
    if (n === "Finance") return mods.finance || canManageMods();
    if (n === "Reports") return mods.reportHub || canManageMods();
    if (n === "HR & Crew") return mods.hr || canManageMods();
    if (n === "IT") return mods.it || canManageMods();
    if (n === "Maintenance") return mods.maintenance || canManageMods();
    return true;
  }
  function hrSubAllowed(href, mods) {
    if (isFullAccess()) return true;
    if (href.indexOf("#documents") >= 0) return mods.hr;
    if (href.indexOf("#payroll") >= 0) return mods.payroll;
    if (href.indexOf("#reports") >= 0) return mods.reports;
    return true;
  }

  function loadSubOpen() {
    try {
      var raw = localStorage.getItem(SUB_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveSubOpen(map) {
    try { localStorage.setItem(SUB_KEY, JSON.stringify(map)); } catch (e) {}
  }
  function isSubOpen(map, name, isActive) {
    if (map[name] === true) return true;
    if (map[name] === false) return false;
    return !!isActive; // default: only the current section is open
  }

  function buildNav(active) {
    var mods = modsOf(state.company);
    var openMap = loadSubOpen();
    buildNav.active = active;
    $("nav").innerHTML = Object.keys(ICONS).map(function (n) {
      var href = PAGES[n] || "#", on = n === active, show = pageAllowed(n, mods);
      if (!show) return "";
      var items = SUB[n];
      var hasSub = !!(items && items.length);
      var open = hasSub && isSubOpen(openMap, n, on);
      var sub = "";
      if (hasSub) {
        sub = '<div class="subnav"' + (open ? "" : " hidden") + '>' + items.filter(function (x) {
          return n !== "HR & Crew" || hrSubAllowed(x[1], mods) || canManageMods();
        }).map(function (x) {
          if (x[2] === "soon") return '<a href="#" class="off">' + x[0] + '<span class="soon">Soon</span></a>';
          var here = subHere(x[1]);
          return '<a href="' + x[1] + '"' + (here ? ' class="here" aria-current="page"' : "") + '>' + x[0] + "</a>";
        }).join("") + "</div>";
      }
      // Cursor 2026-10-23: chevron is a real expand/collapse control (only when section has links).
      var chev = hasSub
        ? '<button type="button" class="nav-chev' + (open ? " open" : "") + '" data-nav-toggle="' + esc(n) +
          '" aria-expanded="' + (open ? "true" : "false") + '" aria-label="' + (open ? "Collapse " : "Expand ") + esc(n) +
          '"><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>'
        : "";
      // Cursor 2026-10-23: nav-ic wells for a clearer, modern sidebar hierarchy.
      return '<div class="nav-sec' + (on ? " is-active" : "") + (open ? " is-open" : "") + '">' +
        '<a href="' + href + '" class="' + (on ? "on" : href === "#" ? "off" : "") + '" title="' + esc(n) + '"' +
          (on ? ' aria-current="page"' : "") + '>' +
          '<span class="nav-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="' + ICONS[n] + '"/></svg></span>' +
          '<span class="nav-label">' + n + "</span>" +
          (href === "#" ? '<span class="soon">Soon</span>' : "") +
        "</a>" + chev + sub + "</div>";
    }).join("");
    if (!buildNav.bound) {
      buildNav.bound = true;
      $("nav").addEventListener("click", function (e) {
        var tog = e.target.closest("[data-nav-toggle]");
        if (tog) {
          e.preventDefault();
          e.stopPropagation();
          var name = tog.getAttribute("data-nav-toggle");
          var map = loadSubOpen();
          var item = tog.closest(".nav-sec");
          var willOpen = !(item && item.classList.contains("is-open"));
          map[name] = willOpen;
          saveSubOpen(map);
          buildNav(buildNav.active || active);
          return;
        }
        if (e.target.closest("a.off")) e.preventDefault();
      });
      window.addEventListener("hashchange", function () { buildNav(buildNav.active || active); });
    }
  }

  function navCollapsed() {
    try { return localStorage.getItem(NAV_KEY) === "1"; } catch (e) { return false; }
  }
  function applyNavCollapse(on) {
    var side = $("side");
    if (!side) return;
    var mobile = window.matchMedia("(max-width:900px)").matches;
    var active = !mobile && !!on;
    side.classList.toggle("is-collapsed", active);
    document.documentElement.classList.toggle("nav-collapsed", active);
    var btn = $("navCollapse");
    if (btn) {
      btn.setAttribute("aria-expanded", active ? "false" : "true");
      btn.setAttribute("aria-label", active ? "Expand navigation" : "Collapse navigation");
      btn.title = active ? "Expand menu" : "Collapse menu";
    }
  }
  function initSideCollapse() {
    var side = $("side");
    if (!side || initSideCollapse.done) return;
    initSideCollapse.done = true;
    if (!$("navCollapse")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-collapse";
      btn.id = "navCollapse";
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6 9 12l6 6"/></svg>';
      side.insertBefore(btn, side.firstChild);
      btn.addEventListener("click", function () {
        var next = !navCollapsed();
        try { localStorage.setItem(NAV_KEY, next ? "1" : "0"); } catch (e) {}
        applyNavCollapse(next);
      });
    }
    applyNavCollapse(navCollapsed());
    window.addEventListener("resize", function () { applyNavCollapse(navCollapsed()); });
  }

  // Block a module page when Module & Feature Management turned it off (owners always pass; admins may still open Settings).
  function moduleGate(c) {
    if (isFullAccess()) return false;
    var mods = modsOf(c), page = location.pathname.split("/").pop() || "index.html", hash = (location.hash || "").split("/")[0];
    var off = null;
    if (page === "operations.html" && !mods.operations && !canManageMods()) off = "Operations";
    else if (page === "schedules.html" && !mods.schedules && !canManageMods()) off = "Schedules";
    else if (page === "fleet.html" && !mods.fleet && !canManageMods()) off = "Fleet";
    else if (page === "passengers.html" && !mods.passengers && !canManageMods()) off = "Passengers";
    else if (page === "finance.html" && !mods.finance && !canManageMods()) off = "Finance";
    else if (page === "reports.html" && !mods.reportHub && !canManageMods()) off = "Reports";
    else if ((page === "hr.html" || page === "roster.html") && !mods.hr && !canManageMods()) off = "HR & Crew";
    else if (page === "agreements.html" && (!mods.hr || !mods.agreements) && !canManageMods()) off = "Agreements";
    else if (page === "hr.html" && hash === "#payroll" && !mods.payroll && !canManageMods()) off = "Payroll & Overtime";
    else if (page === "hr.html" && hash === "#reports" && !mods.reports && !canManageMods()) off = "HR Reports";
    else if (page === "it.html" && !mods.it && !canManageMods()) off = "IT";
    else if (page === "maintenance.html" && !mods.maintenance && !canManageMods()) off = "Maintenance";
    if (!off) return false;
    var main = document.querySelector("main.page");
    if (main) main.innerHTML = '<section class="dash-card it-gate"><h2>' + esc(off) + ' is switched off</h2><p class="note">' + esc(c.name) + ' has turned this module off in IT Settings → Module &amp; Feature Management.</p><p><a class="btn-soft" href="dashboard.html">Go to the dashboard</a></p></section>';
    return true;
  }

  // IT Settings → Network & IP Restrictions + Security Policies.
  // gate: HR/admins/IT need an approved network for HR, roster, agreements and IT.
  // adminNetwork: admins/HR/IT also need an approved network for Settings (and the same pages).
  // bypass / emergency: owners (and IT when bypass is on) are not locked out.
  function networkGate(c) {
    var cfg = (c.settings || {})["17_network_and_ip_restrictions"] || {};
    var pol = (c.settings || {})["17_security_policies"] || {};
    var page = location.pathname.split("/").pop() || "index.html";
    var r = state.myRole;
    var staffPages = ["hr.html", "roster.html", "it.html", "agreements.html"];
    var sens = staffPages.concat(["settings.html"]);
    var pageGate = cfg.gate === true && staffPages.indexOf(page) >= 0;
    var adminGate = pol.adminNetwork === true && sens.indexOf(page) >= 0;
    if ((!pageGate && !adminGate) || state.isPlatform || isFullAccess()) return Promise.resolve(false);
    if ((pol.emergency !== false && r === "owner") || (cfg.bypass !== false && (r === "owner" || r === "it"))) return Promise.resolve(false);
    if (["admin", "hr", "it"].indexOf(r) < 0) return Promise.resolve(false);
    if (!pageGate && adminGate && page !== "settings.html" && staffPages.indexOf(page) < 0) return Promise.resolve(false);
    // Not on an approved network: a device inside an "access" geofence (IT → Geofences) is approved too, so ask for its location once.
    function status(coords) {
      var a = { p_company: c.id };
      if (coords) { a.p_lat = coords.latitude; a.p_lng = coords.longitude; a.p_acc = coords.accuracy; }
      return db.rpc("it_network_status", a);
    }
    function withLocation(res) {
      var s = res.data || {};
      if (s.approved || s.zones !== true || !navigator.geolocation) return Promise.resolve(res);
      return new Promise(function (ok) {
        navigator.geolocation.getCurrentPosition(function (p) { status(p.coords).then(ok, function () { ok(res); }); }, function () { ok(res); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
      });
    }
    return status().then(withLocation).then(function (res) {
      var s = res.data || {}; if (s.approved) return false;
      var main = document.querySelector("main.page");
      if (main) main.innerHTML = '<section class="dash-card it-gate"><h2>Office network needed</h2><p class="note">' + esc(c.name) + ' only opens this page on an approved office or VPN network. You are on ' + esc(s.ip || "an unknown network") + '.</p><p class="note">Connect to the office Wi-Fi or VPN, or ask IT.</p><p><a class="btn-soft" href="dashboard.html">Go to the dashboard</a></p></section>';
      return true;
    }, function () { return false; });
  }
  // Security & Authentication → Session Timeout (only once a company has saved it): sign out after that many idle minutes.
  var idleTimer = null;
  function idleWatch(st) {
    var cfg = st && st["13_session_timeout"], mins = cfg && Number(cfg.idle);
    if (idleTimer) clearTimeout(idleTimer);
    if (!mins || mins < 1) return;
    var arm = function () { clearTimeout(idleTimer); idleTimer = setTimeout(function () { db.auth.signOut().then(function () { location.replace("index.html?timeout=1"); }); }, mins * 6e4); };
    if (!idleWatch.bound) { idleWatch.bound = true; ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach(function (ev) { document.addEventListener(ev, function () { if (idleTimer) arm(); }, { passive: true }); }); }
    arm();
  }

  function hostCompanyHint() {
    var h = (location.hostname || "").toLowerCase();
    if (!h || h === "localhost" || h === "127.0.0.1" || /\.local$/.test(h)) return Promise.resolve(null);
    var apex = h.indexOf("www.") === 0 ? h.slice(4) : h;
    var platform = (window.VEYORA_CONFIG && window.VEYORA_CONFIG.domainCnameTarget) || "";
    if (platform && (h === platform.toLowerCase() || apex === platform.toLowerCase())) return Promise.resolve(null);
    return db.rpc("resolve_company_by_host", { p_host: h }).then(function (r) {
      if (r.error || !r.data) return null;
      return r.data;
    }).catch(function () { return null; });
  }

  function start(opts) {
    buildNav(opts.active);
    initSideCollapse();
    $("burger").addEventListener("click", function () {
      // Mobile drawer, or expand a collapsed desktop rail
      if (window.matchMedia("(max-width:900px)").matches) $("side").classList.toggle("open");
      else if ($("side").classList.contains("is-collapsed")) setNavCollapsed(false);
      else $("side").classList.toggle("open");
    });
    $("me").addEventListener("click", function (e) { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; });
    document.addEventListener("click", function () { $("menu").hidden = true; });
    $("signOut").addEventListener("click", function () { db.auth.signOut().then(function () { location.replace("index.html"); }); });

    var sw = $("cswitch"), btn = $("csBtn"), panel = $("csPanel"), search = $("csSearch"), list = $("csList");
    function draw() {
      var q = search.value.trim().toLowerCase();
      var rows = state.all.filter(function (c) { return !q || (c.name + " " + c.code + " " + c.type + " " + c.status).toLowerCase().indexOf(q) > -1; });
      list.innerHTML = rows.length ? rows.map(function (c) {
        return '<li role="option" tabindex="0" data-cid="' + c.id + '"' + (state.company && c.id === state.company.id ? ' aria-selected="true"' : "") + '><span class="grow"><strong>' + esc(c.name) + '</strong><small>' + esc(c.code) + ' · ' + esc(c.type) + '</small></span><span class="tag">' + esc(c.status) + '</span></li>';
      }).join("") : '<li class="cs-empty">No companies match.</li>';
    }
    function close() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    function open() { panel.hidden = false; btn.setAttribute("aria-expanded", "true"); search.value = ""; draw(); search.focus(); }
    function pick(li) { if (li && li.dataset.cid) { close(); openCompany(li.dataset.cid); } }
    btn.addEventListener("click", function (e) { e.stopPropagation(); if (panel.hidden) open(); else close(); });
    panel.addEventListener("click", function (e) { e.stopPropagation(); pick(e.target.closest("[data-cid]")); });
    search.addEventListener("input", draw);
    search.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); pick(list.querySelector("[data-cid]")); }
      if (e.key === "ArrowDown") { var f = list.querySelector("[data-cid]"); if (f) f.focus(); }
      if (e.key === "Escape") close();
    });
    list.addEventListener("keydown", function (e) {
      var li = e.target.closest("[data-cid]"); if (!li) return;
      if (e.key === "Enter") pick(li);
      if (e.key === "ArrowDown" && li.nextElementSibling && li.nextElementSibling.dataset.cid) li.nextElementSibling.focus();
      if (e.key === "ArrowUp") { if (li.previousElementSibling) li.previousElementSibling.focus(); else search.focus(); }
      if (e.key === "Escape") { close(); btn.focus(); }
    });
    document.addEventListener("click", close);

    function info() {
      var r = state.myRole;
      var full = state.isPlatform || r === "owner";
      // Cursor 2026-10-23: owners get every capability flag so any page can treat them as full access.
      return {
        me: state.me,
        isPlatform: state.isPlatform,
        myRole: r,
        isOwner: r === "owner",
        canAll: full,
        isAdmin: full || r === "admin",
        canHr: full || r === "admin" || r === "hr",
        canOps: full || r === "admin" || r === "operations",
        canIT: full || r === "admin" || r === "it",
        canMaint: full || r === "admin" || r === "operations",
        canFinance: full || r === "admin" || r === "operations",
        canReports: full || r === "admin" || r === "operations" || r === "hr"
      };
    }

    function openCompany(id) {
      try { localStorage.setItem(VIEW_KEY, id); } catch (e) {}
      return Promise.all([
        db.from("companies").select("*").eq("id", id).single(),
        db.from("company_members").select("role").eq("company_id", id).eq("user_id", state.me).maybeSingle()
      ]).then(function (r) {
        if (r[0].error) throw new Error(r[0].error.message);
        state.company = r[0].data; state.myRole = (r[1].data && r[1].data.role) || "";
        btn.querySelector("span").textContent = state.company.name;
        $("userRole").textContent = state.isPlatform && !state.myRole ? "Platform owner" : cap(state.myRole);
        buildNav(opts.active);
        var i = info();
        if (window.VeyoraSub) window.VeyoraSub.watch(db, state.company.id, i.isAdmin);
        if (window.VeyoraBell) window.VeyoraBell.watch(db, state.company.id, state.company.settings);
        idleWatch(state.company.settings);
        if (moduleGate(state.company)) return;
        return networkGate(state.company).then(function (blocked) { if (!blocked) return opts.onCompany(state.company, i); });
      }).catch(function (err) { opts.onError && opts.onError(err); });
    }

    db.auth.getSession().then(function (r) {
      var session = r.data.session;
      if (!session) { location.replace("index.html"); return; }
      state.me = session.user.id;
      var mail = session.user.email || "", nm = (session.user.user_metadata && session.user.user_metadata.full_name) || mail.split("@")[0];
      $("userName").textContent = nm;
      $("avatar").textContent = nm.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(function (s) { return s[0].toUpperCase(); }).join("") || "?";
      return Promise.all([
        db.from("platform_admins").select("user_id"),
        hostCompanyHint()
      ]).then(function (pack) {
        var a = pack[0], hostCo = pack[1];
        state.isPlatform = !!(a.data && a.data.length);
        state.hostCompany = hostCo;
        if (state.isPlatform) {
          var l = document.createElement("button"); l.type = "button"; l.textContent = "Platform owner";
          l.addEventListener("click", function () { location.href = "platform.html"; });
          $("menu").insertBefore(l, $("signOut"));
          return db.from("companies").select("id, name, code, type, status").order("name").then(function (c) {
            if (c.error) throw new Error(c.error.message);
            state.all = c.data || []; sw.hidden = false; $("userRole").textContent = "Platform owner";
            var stored = null; try { stored = localStorage.getItem(VIEW_KEY); } catch (e) {}
            var fromHost = hostCo && state.all.filter(function (x) { return x.id === hostCo.company_id; })[0];
            var chosen = fromHost || state.all.filter(function (x) { return x.id === stored; })[0];
            if (chosen) return openCompany(chosen.id);
            btn.querySelector("span").textContent = state.all.length ? "Select a company" : "No companies";
            opts.onNone && opts.onNone(true);
            if (state.all.length) open();
          });
        }
        return db.from("company_members").select("company_id").eq("user_id", state.me).eq("active", true).order("created_at", { ascending: true }).then(function (m) {
          if (m.error) throw new Error(m.error.message);
          if (!m.data.length) { opts.onNone && opts.onNone(false); return; }
          var ids = m.data.map(function (x) { return x.company_id; });
          var prefer = hostCo && ids.indexOf(hostCo.company_id) > -1 ? hostCo.company_id : ids[0];
          return openCompany(prefer);
        });
      });
    }).catch(function (err) { opts.onError && opts.onError(err); });
  }

  function setNavCollapsed(on) {
    try { localStorage.setItem(NAV_KEY, on ? "1" : "0"); } catch (e) {}
    applyNavCollapse(!!on);
  }
  /* Cursor 2026-10-23: dashboard can sync company into shell so nav mods + chevrons work. */
  function setViewCompany(c, role, platform) {
    state.company = c || null;
    if (role != null) state.myRole = role;
    if (platform != null) state.isPlatform = !!platform;
  }
  var SAMPLE_BOAT = "assets/boat%20sample.png";
  // Cursor 2026-10-27: vessel photo, or the sample boat when none is stored.
  function vesselPhotoUrl(v) {
    var m = v && v.meta && typeof v.meta === "object" && !Array.isArray(v.meta) ? v.meta : {};
    var u = (v && (v.photo_url || v.image_url || v.photo || v.image)) || m.photo_url || m.image_url || m.photo || m.image || "";
    u = String(u || "").trim();
    return u || SAMPLE_BOAT;
  }
  function vesselPhotoImg(v, cls) {
    var src = vesselPhotoUrl(v);
    var alt = (v && (v.name || v.code)) || "Vessel";
    return '<img class="' + (cls || "") + '" src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + SAMPLE_BOAT + '\'">';
  }
  window.VeyoraShell = {
    start: start, esc: esc, cap: cap, nav: buildNav, modsOf: modsOf,
    initSideCollapse: initSideCollapse, setNavCollapsed: setNavCollapsed, setViewCompany: setViewCompany,
    vesselPhotoUrl: vesselPhotoUrl, vesselPhotoImg: vesselPhotoImg
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSideCollapse);
  else initSideCollapse();
})();

