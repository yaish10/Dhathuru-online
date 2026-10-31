/* Settings for each module, edited on that module's page. Same keys as the Settings catalogue.
   Company, users, notifications, approvals and system preferences stay on the Settings page. */
(function () {
  function slug(t) { return String(t).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48); }
  function rows(prefix, titles) {
    return titles.map(function (t) { return [slug(t), t, prefix + "_" + slug(t)]; });
  }
  var AREAS = {
    operations: { hash: "#settings/", pills: rows("3", [
      "Trip Statuses", "Trip Number Format", "Dispatch Rules", "Weather", "Operations Controls", "Departure & Arrival Rules",
      "Harbour Autopilot", "Arrival Detection", "Vessel Map", "Harbours & Geofences", "Route Harbours", "Trip Cancellation Rules",
      "Auto Crew Rules", "Delay Reasons", "Incident Categories", "Operational Approval Rules", "Passenger Capacity Rules",
      "Operations Check-in", "Seating", "Operational Notifications"
    ]).concat(rows("4", [
      "Island & Location Directory", "Atoll Management", "Terminals & Jetties", "Route Management Settings", "Route Naming Format",
      "Default Journey Durations", "Distance Units", "Boarding Locations", "Location Activation & Deactivation"
    ])) },
    schedules: { hash: "#settings/", pills: rows("5", [
      "Schedule Types", "Schedule Templates", "Recurring Trip Rules", "Default Departure Intervals", "Operating Days",
      "Holiday Calendar", "Seasonal Schedules", "Schedule Change Approvals", "Departure Cut-off Times", "Schedule Conflict Rules"
    ]) },
    fleet: { hash: "#settings/", pills: rows("6", [
      "Vessel Categories", "Vessel Type Definitions", "Vessel Registration Format", "Vessel Statuses", "Vessel Capacity Rules",
      "Engine Type Categories", "Vessel Document Types", "Vessel Availability Rules", "Vessel Assignment Restrictions", "Vessel Tracking"
    ]) },
    passengers: { hash: "#settings/", pills: rows("7", [
      "Booking Reference Format", "Passenger Categories", "Ticket Types", "Booking Statuses", "Check-in Rules",
      "Cancellation & Refund Rules", "Passenger Manifest Settings", "Booking Cut-off Times", "Passenger Notifications", "Required Passenger Information"
    ]) },
    maintenance: { hash: "#settings/", pills: rows("10", [
      "Maintenance Categories", "Maintenance Job Types", "Service Interval Rules", "Preventive Maintenance Schedules", "Maintenance Reminder Rules",
      "Work Order Statuses", "Priority Levels", "Work Order Number Format", "Inspection Checklist Templates", "Defect Categories",
      "Maintenance Approval Rules", "Return to Service Rules", "Maintenance Permissions", "Spare Parts Categories", "Units of Measurement",
      "Labour Rates & Cost Categories", "Maintenance Document Requirements"
    ]) },
    it: { hash: "#settings/", pills: rows("17", [
      "Access Controls", "Network & IP Restrictions", "Mobile Check-in & Check-out", "Device Management", "User & Role Management",
      "Authentication & Login Security", "Security & Audit Logs", "Module & Feature Management", "API & Integration Management",
      "Database & Backup Management", "System Monitoring & Maintenance", "Alerts & Notifications", "IT Asset Management",
      "Temporary Access & Approvals", "Network Diagnostics", "Data Access & Retention", "Configuration Management",
      "IT Support & Incident Management", "Email & System Services", "Security Policies"
    ]).concat(rows("13", [
      "Password Policy", "Two-Factor Authentication", "Single Sign-On", "Session Timeout", "Login Restrictions",
      "Failed Login Protection", "Active Sessions", "Trusted Devices", "API Access", "Security Event Logs"
    ])).concat(rows("14", [
      "Email Service Configuration", "SMS Provider Configuration", "Microsoft 365 Integration", "External API Connections",
      "Import Data", "Export Data", "Backup Configuration", "Data Retention Policy", "Document Storage Settings", "Data Import History", "Integration Logs"
    ])) }
  };
  var FIN = {
    "Base Currency": "general", "Supported Currencies": "general", "Financial Periods": "general",
    "Revenue Categories": "categories", "Expense Categories": "categories", "Category Defaults": "categories",
    "Payment Methods": "payments", "Finance Accounts": "payments", "Reconciliation Settings": "payments",
    "Invoice Number Format": "invoices", "Receipt Number Format": "invoices", "Document Branding": "invoices", "Payment Terms": "invoices",
    "Tax Configuration": "tax", "Tax Rates": "tax", "Financial Approval Limits": "approvals", "Budget Categories": "budgets",
    "Payroll Finance Posting": "payroll", "Financial Report Preferences": "reports"
  };
  var HOME = {};
  Object.keys(AREAS).forEach(function (area) {
    var page = area === "operations" ? "operations.html" : area === "schedules" ? "schedules.html" : area === "fleet" ? "fleet.html" : area === "passengers" ? "passengers.html" : area === "maintenance" ? "maintenance.html" : "it.html";
    AREAS[area].pills.forEach(function (p) { HOME[p[1]] = page + "#settings/" + p[0]; });
  });
  Object.keys(FIN).forEach(function (t) { HOME[t] = "finance.html#settings/" + FIN[t]; });

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
    var pill = area.pills.filter(function (p) { return p[0] === env.pill; })[0] ? env.pill : area.pills[0][0];
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
      return '<a href="' + area.hash + p[0] + '" class="ls-pill' + (p[0] === pill ? " on" : "") + '"' + (p[0] === pill ? ' aria-current="page"' : "") + '><strong>' + esc(p[1]) + '</strong>' + (note ? '<small>' + esc(note) + '</small>' : "") + '</a>';
    }).join("") + '</nav><div class="ls-body" id="pageSetBody"></div></div>';
    var body = document.getElementById("pageSetBody");
    var cur = area.pills.filter(function (p) { return p[0] === pill; })[0];
    var title = cur[1], key = cur[2];
    var spec = (window.VEYORA_DEFS || {})[title];
    if (!spec) { body.innerHTML = '<p class="msg">This setting is not available.</p>'; return; }
    if (spec.type === "arrivals") {
      if (!window.VeyoraArrivals) { body.innerHTML = '<p class="msg">Harbour tools are not loaded on this page.</p>'; return; }
      body.innerHTML = '<div id="arrHost"></div>';
      window.VeyoraArrivals.mountAdmin(document.getElementById("arrHost"), company, spec.tab, edit);
      return;
    }
    if (spec.type === "it") {
      body.innerHTML = (spec.managed ? '<div class="it-managed"><strong>Managed by VEYORA</strong><p>' + esc(spec.managed) + '</p></div>' : "") +
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
