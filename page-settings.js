/* Settings for each module, edited on that module's page. Same keys as the Settings catalogue.
   Company, users, notifications, approvals and system preferences stay on the Settings page. */
(function () {
  function slug(t) { return String(t).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48); }
  function rows(prefix, titles) {
    return titles.map(function (t) { return [slug(t), t, prefix + "_" + slug(t)]; });
  }
  var AREAS = {
    operations: { hash: "#settings/", pills: rows("3", ["Trip setup", "Dispatch & checks", "Harbours & locations", "Trip messages"]).concat(rows("4", ["Route setup"])) },
    schedules: { hash: "#settings/", pills: rows("5", ["Timetable", "Calendar", "Schedule rules"]) },
    fleet: { hash: "#settings/", pills: rows("6", ["Vessel types", "Vessel rules"]) },
    passengers: { hash: "#settings/", pills: rows("7", ["Booking setup", "Booking rules"]) },
    maintenance: { hash: "#settings/", pills: rows("10", ["Maintenance jobs", "Maintenance schedule", "Work orders"]) },
    it: { hash: "#settings/", pills: rows("17", ["Access", "Networks & devices", "Sign-in", "Records & backups", "Connections", "IT desk"]) }
  };
  var FIN = {
    "General & Currency": "general", "Base Currency": "general", "Supported Currencies": "general", "Financial Periods": "general",
    "Categories": "categories", "Revenue Categories": "categories", "Expense Categories": "categories", "Category Defaults": "categories",
    "Payments & Accounts": "payments", "Payment Methods": "payments", "Finance Accounts": "payments", "Reconciliation Settings": "payments",
    "Invoices & Receipts": "invoices", "Invoice Number Format": "invoices", "Receipt Number Format": "invoices", "Document Branding": "invoices", "Payment Terms": "invoices",
    "Tax": "tax", "Tax Configuration": "tax", "Tax Rates": "tax",
    "Approvals": "approvals", "Financial Approval Limits": "approvals",
    "Budgets & Periods": "budgets", "Budget Categories": "budgets",
    "Payroll Integration": "payroll", "Payroll Finance Posting": "payroll",
    "Reports": "reports", "Financial Report Preferences": "reports"
  };
  var HOME = {};
  Object.keys(AREAS).forEach(function (area) {
    var page = area === "operations" ? "operations.html" : area === "schedules" ? "schedules.html" : area === "fleet" ? "fleet.html" : area === "passengers" ? "passengers.html" : area === "maintenance" ? "maintenance.html" : "it.html";
    AREAS[area].pills.forEach(function (p) { HOME[p[1]] = page + "#settings/" + p[0]; });
  });
  Object.keys(FIN).forEach(function (t) { HOME[t] = "finance.html#settings/" + FIN[t]; });
  var LOC = "harbours_and_locations";
  var LOC_LEGACY = {
    harbour_autopilot: { tab: "auto" },
    arrival_detection: { tab: "settings" },
    vessel_map: { tab: "map" },
    harbours_and_geofences: { tab: "harbours" },
    route_harbours: { tab: "routes" },
    island_and_location_directory: { tab: "places", place: "island_and_location_directory" },
    atoll_management: { tab: "places", place: "atoll_management" },
    terminals_and_jetties: { tab: "places", place: "terminals_and_jetties" },
    boarding_locations: { tab: "places", place: "boarding_locations" },
    location_activation_and_deactivation: { tab: "places", place: "location_activation_and_deactivation" }
  };
  var LOC_PLACES = [
    ["island_and_location_directory", "Islands", "Island & Location Directory", "4_island_and_location_directory"],
    ["atoll_management", "Atolls", "Atoll Management", "4_atoll_management"],
    ["terminals_and_jetties", "Terminals & jetties", "Terminals & Jetties", "4_terminals_and_jetties"],
    ["boarding_locations", "Boarding points", "Boarding Locations", "4_boarding_locations"],
    ["location_activation_and_deactivation", "Switched off", "Location Activation & Deactivation", "4_location_activation_and_deactivation"]
  ];
  var LOC_TABS = { harbours: "Harbours & geofences", routes: "Route harbours", auto: "Autopilot", settings: "Detection", map: "Vessel map", places: "Places" };
  function locHref(tab, place) {
    return "operations.html#settings/" + LOC + "/" + tab + (tab === "places" ? "/" + (place || LOC_PLACES[0][0]) : "");
  }
  HOME["Harbours & locations"] = locHref("harbours");
  HOME["Harbour Autopilot"] = locHref("auto");
  HOME["Arrival Detection"] = locHref("settings");
  HOME["Vessel Map"] = locHref("map");
  HOME["Harbours & Geofences"] = locHref("harbours");
  HOME["Route Harbours"] = locHref("routes");
  LOC_PLACES.forEach(function (p) { HOME[p[2]] = locHref("places", p[0]); });
  var GROUP_LEGACY = {};
  var PAGE_OF = { operations: "operations.html", schedules: "schedules.html", fleet: "fleet.html", passengers: "passengers.html", maintenance: "maintenance.html", it: "it.html" };
  Object.keys(AREAS).forEach(function (area) {
    AREAS[area].pills.forEach(function (p) {
      var spec = (window.VEYORA_DEFS || {})[p[1]];
      if (!spec || spec.type !== "group") return;
      var base = PAGE_OF[area] + "#settings/" + p[0] + "/";
      HOME[p[1]] = base + spec.tabs[0][0];
      spec.tabs.forEach(function (t) {
        HOME[t[2]] = base + t[0];
        GROUP_LEGACY[slug(t[2])] = { group: p[0], tab: t[0] };
      });
    });
  });

  function escHref(h) {
    var m = /open=([^&#]+)/.exec(h || "");
    if (!m) return h;
    var title = decodeURIComponent(m[1].replace(/\+/g, " "));
    var dest = HOME[title] || (window.HrSettings && window.HrSettings.home(title)) || "";
    if (!dest) return h;
    var page = (location.pathname.split("/").pop() || "");
    if (page && dest.indexOf(page + "#") === 0) return dest.slice(page.length);
    return dest;
  }

  function mount(el, env) {
    var area = AREAS[env.area];
    if (!area) { el.innerHTML = '<p class="msg">Unknown settings area.</p>'; return; }
    var esc = env.esc, company = env.company(), edit = !!env.canEdit;
    var asked = env.pill || "";
    var legacy = LOC_LEGACY[asked];
    var grpLegacy = GROUP_LEGACY[asked];
    if (legacy) asked = LOC;
    else if (grpLegacy) asked = grpLegacy.group;
    var pill = area.pills.filter(function (p) { return p[0] === asked; })[0] ? asked : area.pills[0][0];
    if (window.VeyoraArrivals && window.VeyoraArrivals.unmountAdmin) window.VeyoraArrivals.unmountAdmin();
    function save(key, val) {
      return env.rpc("set_company_setting", { p_company: company.id, p_key: key, p_value: val }).then(function () {
        company.settings = company.settings || {}; company.settings[key] = val;
        if (env.onSaved) env.onSaved(key);
      });
    }
    el.innerHTML = '<div class="ls"><nav class="ls-nav" aria-label="Settings">' + area.pills.map(function (p) {
      var spec = (window.VEYORA_DEFS || {})[p[1]];
      var note = (spec && spec.note) || "";
      if (note.length > 110) note = note.slice(0, 107) + "…";
      var tail = p[0] === LOC ? "/harbours" : (spec && spec.type === "group" ? "/" + spec.tabs[0][0] : "");
      return '<a href="' + area.hash + p[0] + tail + '" class="ls-pill' + (p[0] === pill ? " on" : "") + '"' + (p[0] === pill ? ' aria-current="page"' : "") + '><strong>' + esc(p[1]) + '</strong>' + (note ? '<small>' + esc(note) + '</small>' : "") + '</a>';
    }).join("") + '</nav><div class="ls-body" id="pageSetBody"></div></div>';
    var body = document.getElementById("pageSetBody");
    var cur = area.pills.filter(function (p) { return p[0] === pill; })[0];
    var title = cur[1], key = cur[2];
    var spec = (window.VEYORA_DEFS || {})[title];
    if (!spec) { body.innerHTML = '<p class="msg">This setting is not available.</p>'; return; }
    function childKey(tab) { return tab[3] + "_" + slug(tab[2]); }
    function renderPiece(host, pieceTitle, pieceKey) {
      var piece = (window.VEYORA_DEFS || {})[pieceTitle];
      if (!piece) { host.innerHTML = '<p class="msg">This setting is not available.</p>'; return; }
      if (piece.type === "it") {
        host.innerHTML = (piece.managed ? '<div class="it-managed"><strong>Managed by KAHDHU</strong><p>' + esc(piece.managed) + '</p></div>' : "") +
          (piece.note ? '<p class="note">' + esc(piece.note) + '</p>' : "") +
          (piece.links && piece.links.length ? '<ul class="rows">' + piece.links.map(function (l) { return '<li class="row"><span class="grow"><strong>' + esc(l[0]) + '</strong></span><a class="ghost" href="' + esc(escHref(l[1])) + '">Open →</a></li>'; }).join("") + '</ul>' : "") +
          (piece.base ? '<div id="pageSetBase"></div>' : "");
        if (piece.base) window.VeyoraEngine.render(document.getElementById("pageSetBase"), { title: pieceTitle, spec: piece.base, key: pieceKey, canEdit: edit, embed: true, help: (window.VEYORA_HELP || {})[pieceTitle], value: company.settings ? company.settings[pieceKey] : undefined, company: company, db: env.db, save: function (v) { return save(pieceKey, v); } });
        return;
      }
      var use = piece.base && (piece.type === "org-ids" || piece.type === "org-categories" || piece.type === "org-employment") ? piece.base : piece;
      window.VeyoraEngine.render(host, { title: pieceTitle, spec: use, key: pieceKey, canEdit: edit, embed: true, help: (window.VEYORA_HELP || {})[pieceTitle], value: company.settings ? company.settings[pieceKey] : undefined, company: company, db: env.db, save: function (v) { return save(pieceKey, v); } });
    }
    if (spec.type === "group") {
      var gBits = (location.hash || "").replace(/^#/, "").split("/");
      var gId = (grpLegacy && grpLegacy.tab) || gBits[2] || spec.tabs[0][0];
      var gTab = spec.tabs.filter(function (t) { return t[0] === gId; })[0] || spec.tabs[0];
      body.innerHTML = '<div class="arr-tabs" role="tablist" style="margin:0 0 16px;flex-wrap:wrap">' + spec.tabs.map(function (t) {
        return '<button type="button" data-grp="' + t[0] + '"' + (t[0] === gTab[0] ? ' class="on" aria-current="page"' : "") + '>' + esc(t[1]) + '</button>';
      }).join("") + '</div><div id="grpBody"></div>';
      body.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-grp]");
        if (!b || b.getAttribute("data-grp") === gTab[0]) return;
        location.hash = "#settings/" + pill + "/" + b.getAttribute("data-grp");
      });
      renderPiece(document.getElementById("grpBody"), gTab[2], childKey(gTab));
      return;
    }
    if (spec.type === "locations") {
      var bits = (location.hash || "").replace(/^#/, "").split("/");
      var tab = (legacy && legacy.tab) || bits[2] || "harbours";
      if (!LOC_TABS[tab]) tab = "harbours";
      var place = (legacy && legacy.place) || bits[3] || LOC_PLACES[0][0];
      if (!LOC_PLACES.some(function (p) { return p[0] === place; })) place = LOC_PLACES[0][0];
      body.innerHTML = '<div class="arr-tabs" role="tablist" style="margin:0 0 16px;flex-wrap:wrap">' + Object.keys(LOC_TABS).map(function (id) {
        return '<button type="button" data-loc="' + id + '"' + (id === tab ? ' class="on" aria-current="page"' : "") + '>' + esc(LOC_TABS[id]) + '</button>';
      }).join("") + '</div><div id="locBody"></div>';
      body.addEventListener("click", function (e) {
        var b = e.target.closest("[data-loc]");
        if (!b || b.getAttribute("data-loc") === tab) return;
        var next = b.getAttribute("data-loc");
        location.hash = "#settings/" + LOC + "/" + next + (next === "places" ? "/" + LOC_PLACES[0][0] : "");
      });
      var host = document.getElementById("locBody");
      if (tab === "map") {
        window.VeyoraEngine.render(host, { title: "Vessel map", spec: (window.VEYORA_DEFS || {})["Vessel Map"], key: "3_vessel_map", canEdit: edit, embed: true, help: (window.VEYORA_HELP || {})["Vessel Map"], value: company.settings ? company.settings["3_vessel_map"] : undefined, company: company, db: env.db, save: function (v) { return save("3_vessel_map", v); } });
        return;
      }
      if (tab === "places") {
        host.innerHTML = '<div class="arr-tabs" role="tablist" style="margin:0 0 14px;flex-wrap:wrap">' + LOC_PLACES.map(function (p) {
          return '<button type="button" data-place="' + p[0] + '"' + (p[0] === place ? ' class="on" aria-current="page"' : "") + '>' + esc(p[1]) + '</button>';
        }).join("") + '</div><div id="locForm"></div>';
        host.addEventListener("click", function (e) {
          var b = e.target.closest("[data-place]");
          if (!b || b.getAttribute("data-place") === place) return;
          location.hash = "#settings/" + LOC + "/places/" + b.getAttribute("data-place");
        });
        var row = LOC_PLACES.filter(function (p) { return p[0] === place; })[0];
        window.VeyoraEngine.render(document.getElementById("locForm"), { title: row[1], spec: (window.VEYORA_DEFS || {})[row[2]], key: row[3], canEdit: edit, embed: true, help: (window.VEYORA_HELP || {})[row[2]], value: company.settings ? company.settings[row[3]] : undefined, company: company, db: env.db, save: function (v) { return save(row[3], v); } });
        return;
      }
      if (!window.VeyoraArrivals) { host.innerHTML = '<p class="msg">Harbour tools are not loaded on this page.</p>'; return; }
      window.VeyoraArrivals.mountAdmin(host, company, tab === "auto" || tab === "routes" || tab === "settings" ? tab : "harbours", edit);
      return;
    }
    if (spec.type === "arrivals") {
      if (!window.VeyoraArrivals) { body.innerHTML = '<p class="msg">Harbour tools are not loaded on this page.</p>'; return; }
      body.innerHTML = '<div id="arrHost"></div>';
      window.VeyoraArrivals.mountAdmin(document.getElementById("arrHost"), company, spec.tab, edit);
      return;
    }
    if (spec.type === "it") {
      body.innerHTML = (spec.managed ? '<div class="it-managed"><strong>Managed by KAHDHU</strong><p>' + esc(spec.managed) + '</p></div>' : "") +
        (spec.note ? '<p class="note">' + esc(spec.note) + '</p>' : "") +
        (spec.links && spec.links.length ? '<ul class="rows">' + spec.links.map(function (l) { return '<li class="row"><span class="grow"><strong>' + esc(l[0]) + '</strong></span><a class="ghost" href="' + esc(escHref(l[1])) + '">Open →</a></li>'; }).join("") + '</ul>' : "") +
        (spec.base ? '<div id="pageSetBase"></div>' : "");
      if (spec.base) window.VeyoraEngine.render(document.getElementById("pageSetBase"), { title: title, spec: spec.base, key: key, canEdit: edit, embed: true, help: (window.VEYORA_HELP || {})[title], value: company.settings ? company.settings[key] : undefined, company: company, db: env.db, save: function (v) { return save(key, v); } });
      return;
    }
    var use = spec.base && (spec.type === "org-ids" || spec.type === "org-categories" || spec.type === "org-employment") ? spec.base : spec;
    window.VeyoraEngine.render(body, { title: title, spec: use, key: key, canEdit: edit, embed: true, help: (window.VEYORA_HELP || {})[title],
      value: company.settings ? company.settings[key] : undefined, company: company, db: env.db, save: function (v) { return save(key, v); } });
  }

  window.PageSettings = { mount: mount, home: function (title) { return HOME[title] || ""; } };
})();
