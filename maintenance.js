/* Maintenance: maintenance.html#overview, #vessels, #vessel/<id>, #schedules, #workorders[/<id>], #defects[/<id>], #inspections[/<id>],
   #parts, #part/<id>, #purchasing, #pr/<id>, #po/<id>, #suppliers.
   Owners, admins, Operations and the people named for Maintenance approvals run it (is_company_maint); everyone can see vessels,
   report defects, log engine hours and submit inspections. Rules come from Maintenance Settings (keys 10_). */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var company = null, ctx = null, d = null, isMaint = false, isApprover = false;
  var woFilter = "active", defFilter = "open", schFilter = "", partFilter = "active", prFilter = "waiting", poFilter = "open";
  var cache = {};

  /* ---------- helpers ---------- */
  function setting(key) { return company && company.settings ? company.settings[key] : undefined; }
  function formSetting(key, title) {
    var saved = setting(key), spec = window.VEYORA_DEFS && window.VEYORA_DEFS[title], base = spec && (spec.base || spec), out = {};
    (base && base.fields || []).forEach(function (f) { out[f.k] = f.d; });
    if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function listSetting(key, title) { var saved = setting(key), spec = window.VEYORA_DEFS && window.VEYORA_DEFS[title] || {}; var rows = Array.isArray(saved) ? saved : (spec.def || []); return rows.map(function (r) { return typeof r === "string" ? r : r && r.name; }).filter(Boolean); }
  function labourRates() { return formSetting("10_labour_rates_and_cost_categories", "Labour Rates & Cost Categories"); }
  function docReqs() { return formSetting("10_maintenance_document_requirements", "Maintenance Document Requirements"); }
  function labourRateFor(w) { var r = labourRates(); return Number(w && w.contractor ? (r.contractorRate || r.rate) : r.rate) || 0; }
  function suggestLabourCost(w, hours) { var rate = labourRateFor(w), h = Number(hours); if (!rate || !(h > 0)) return null; return Math.round(h * rate * 100) / 100; }
  function costCats() { return String(labourRates().cats || "").split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function iso(x) { return x.getFullYear() + "-" + pad2(x.getMonth() + 1) + "-" + pad2(x.getDate()); }
  function todayIso() { return iso(new Date()); }
  function addDays(s, n) { var x = new Date(s + "T00:00:00"); x.setDate(x.getDate() + n); return iso(x); }
  function fmtDate(s) { return s ? new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
  function when(ts) { if (!ts) return "—"; var x = new Date(ts); return x.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
  function ago(ts) { if (!ts) return "never"; var m = Math.round((Date.now() - new Date(ts)) / 6e4); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
  function initials(n) { return String(n).split(/\s+/).filter(Boolean).slice(0, 2).map(function (s) { return s[0]; }).join("").toUpperCase(); }
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  var I = {
    ship: '<path d="M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4"/>', wrench: '<path d="M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-3-1-1-3z"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>', alert: '<path d="M12 4 3 20h18L12 4ZM12 10v4M12 17h.01"/>', check: '<path d="m5 12 5 5 9-10"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>', plus: '<path d="M12 5v14M5 12h14"/>', back: '<path d="M15 6l-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', file: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>', gauge: '<path d="M4 16a8 8 0 1 1 16 0M12 16l4-5"/>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/>', coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
  };
  function chip(text, cls) { return '<span class="chip ' + (cls || "st-" + slug(text)) + '">' + esc(text) + '</span>'; }
  function empty(t) { return '<div class="empty-hr">' + t + '</div>'; }
  function kpi(tone, ic, label, value, sub, href) {
    return '<' + (href ? 'a href="' + href + '" class="kpi kpi-link"' : 'div class="kpi"') + '><span class="tile tone-' + tone + '">' + icon(ic) + '</span><span class="kbody"><small>' + label + '</small><strong>' + value + '</strong><span class="kpi-row"><span class="kpi-sub">' + sub + '</span></span></span></' + (href ? "a" : "div") + '>';
  }
  function options(list, cur, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : "") + list.map(function (p) { var v = Array.isArray(p) ? p[0] : p, t = Array.isArray(p) ? p[1] : p; return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + '>' + esc(t) + '</option>'; }).join(""); }
  function rpc(name, args) { return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }
  function nameOf(uid) { var p = d && d.people[uid]; return p ? p.name : uid ? "Someone" : "—"; }
  function vessel(id) { return d.vessels.filter(function (v) { return v.id === id; })[0]; }
  function comp(id) { return d.comps.filter(function (c) { return c.id === id; })[0]; }
  function money(n) { var b = formSetting("9_base_currency", "Base Currency"); return (b.base || "MVR") + " " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function maintOnly(what) { return '<section class="dash-card">' + empty(what + " is for maintenance staff: owners, admins, Operations and the people named for Maintenance approvals.") + '</section>'; }
  var ST_CLS = { "Operational": "st-present", "Restricted": "st-late", "Out of service": "st-absent" };
  var PRI = ["Critical", "High", "Medium", "Low"], WO_ST = ["Draft", "Open", "Assigned", "In progress", "Awaiting parts", "Awaiting approval", "Completed", "Closed"];
  var COMP_KINDS = ["Engine", "Gearbox", "Generator", "Propeller", "Steering", "Electrical", "Cooling", "Hull", "Navigation", "Safety equipment", "Other"];

  // Preventive schedule state, the same way as maint_schedule_state() in the database.
  function schState(s) {
    var r = formSetting("10_maintenance_reminder_rules", "Maintenance Reminder Rules"), wd = Number(r.first) || 14, wh = Number(r.hoursWarn) || 25, c = s.component_id ? comp(s.component_id) : null;
    var nd = s.interval_days ? addDays((s.last_done_on || String(s.created_at).slice(0, 10)), s.interval_days) : null;
    var nh = s.interval_hours && c ? Number(s.last_done_hours || 0) + Number(s.interval_hours) : null, h = c ? Number(c.hours) : null;
    var st = "ok", t = todayIso();
    if ((nd && nd < t) || (nh != null && h >= nh)) st = "overdue"; else if ((nd && nd <= addDays(t, wd)) || (nh != null && h >= nh - wh)) st = "due";
    return { state: st, next_on: nd, next_hours: nh, hours: h, label: st === "overdue" ? "Overdue" : st === "due" ? "Due soon" : "OK" };
  }
  function dueText(s, x) { return [x.next_on ? "by " + fmtDate(x.next_on) : "", x.next_hours != null ? "at " + x.next_hours + " h (now " + x.hours + " h)" : ""].filter(Boolean).join(" or "); }
  function openWO(w) { return ["Completed", "Closed"].indexOf(w.status) < 0; }
  function openDef(x) { return x.status === "Open" || x.status === "Temporary fix"; }

  /* ---------- data ---------- */
  function load() {
    var c = company.id;
    return Promise.all([
      db.from("vessels").select("*").eq("company_id", c).order("code"),
      db.from("vessel_components").select("*").eq("company_id", c).order("name"),
      db.from("maint_schedules").select("*").eq("company_id", c).order("title"),
      db.from("work_orders").select("*").eq("company_id", c).order("number", { ascending: false }).limit(500),
      db.from("defects").select("*").eq("company_id", c).order("number", { ascending: false }).limit(500),
      db.from("maint_checklists").select("*").eq("company_id", c).order("name"),
      db.from("maint_inspections").select("id, vessel_id, checklist_id, name, kind, failed, submitted_by, submitted_at").eq("company_id", c).order("submitted_at", { ascending: false }).limit(200),
      db.from("company_members").select("user_id, role, active, assigned_vessel").eq("company_id", c),
      db.rpc("is_company_maint", { cid: c }), db.rpc("is_maint_approver", { cid: c }),
      db.from("parts").select("*").eq("company_id", c).order("part_no"), db.from("part_stock").select("*").eq("company_id", c),
      db.from("suppliers").select("*").eq("company_id", c).order("name"), db.from("purchase_requests").select("*").eq("company_id", c).order("number", { ascending: false }).limit(300),
      db.from("purchase_orders").select("*").eq("company_id", c).order("number", { ascending: false }).limit(300)
    ]).then(function (r) {
      for (var i = 0; i < 15; i++) if (i !== 8 && i !== 9 && r[i].error) throw new Error(r[i].error.message);
      /* Cursor 2026-10-23: owners always count as maintenance + approver. */
      isMaint = r[8].data === true || !!(ctx && ctx.canAll); isApprover = r[9].data === true || !!(ctx && ctx.canAll);
      var ids = r[7].data.map(function (m) { return m.user_id; });
      return db.from("profiles").select("id, full_name, email").in("id", ids).then(function (p) {
        var people = {}; r[7].data.forEach(function (m) { people[m.user_id] = { uid: m.user_id, role: m.role, active: m.active, vessel: m.assigned_vessel, name: "Unknown" }; });
        (p.data || []).forEach(function (x) { if (people[x.id]) people[x.id].name = x.full_name || (x.email || "").split("@")[0]; });
        d = { vessels: r[0].data, comps: r[1].data, schedules: r[2].data, wos: r[3].data, defects: r[4].data, checklists: r[5].data, inspections: r[6].data, people: people,
          parts: r[10].data, stock: r[11].data, suppliers: r[12].data, prs: r[13].data, pos: r[14].data };
      });
    });
  }
  function reload() { cache = {}; return load().then(render); }
  function staffList() { return Object.keys(d.people).map(function (k) { return d.people[k]; }).filter(function (p) { return p.active; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); }

  /* ---------- routing ---------- */
  var VIEWS = ["overview", "vessels", "vessel", "schedules", "workorders", "defects", "inspections", "parts", "part", "purchasing", "pr", "po", "suppliers", "settings"];
  function route() { var h = (location.hash || "#overview").slice(1).split("/"); return { view: VIEWS.indexOf(h[0]) > -1 ? h[0] : "overview", id: h[1] || "" }; }
  var TITLES = { overview: ["Maintenance", "Vessels, preventive maintenance, work orders, defects and inspections."], vessels: ["Vessels", "Every vessel with its engines and components, status and maintenance history."],
    vessel: ["Vessel", "Components, running hours, schedules, jobs, defects and history."], schedules: ["Preventive schedules", "Recurring services by date or engine running hours."],
    workorders: ["Work orders", "Maintenance jobs from report to sign-off."], defects: ["Defects & breakdowns", "Problems reported on vessels, from report to repair."],
    inspections: ["Inspections", "Daily, weekly, pre-departure and post-arrival checks. Failed items become defects."],
    parts: ["Spare parts", "The parts catalogue, stock in each store, and what is running low."], part: ["Spare part", "Stock per location, movements and details."],
    purchasing: ["Purchasing", "Purchase requests, approval, purchase orders, deliveries and supplier invoices."], pr: ["Purchase request", "Parts someone has asked for, waiting for approval and ordering."],
    po: ["Purchase order", "What was ordered, delivery into the store and the supplier invoice."], suppliers: ["Suppliers", "The companies you buy parts from."],
    settings: ["Maintenance settings", "Job types, intervals, work orders, parts and approvals."] };
  function render() {
    if (!d) return;
    var rt = route(), t = TITLES[rt.view];
    $("mtTitle").textContent = rt.view === "vessel" && vessel(rt.id) ? vessel(rt.id).name : t[0]; $("mtSub").textContent = t[1];
    var v = rt.view;
    if (v === "settings") {
      if (!isMaint) { location.hash = "#overview"; return; }
      $("mt").innerHTML = '<section class="dash-card" id="pageSettings"></section>';
      if (window.PageSettings) window.PageSettings.mount($("pageSettings"), {
        area: "maintenance", pill: rt.id, esc: esc, company: function () { return company; }, db: db, rpc: rpc, canEdit: isMaint
      });
      return;
    }
    $("mt").innerHTML = v === "vessels" ? vesselsView() : v === "vessel" ? vesselView(rt.id) : v === "schedules" ? schedulesView() : v === "workorders" ? (rt.id ? woView(rt.id) : woList()) :
      v === "defects" ? (rt.id ? defView(rt.id) : defList()) : v === "inspections" ? (rt.id ? inspView(rt.id) : inspList()) :
      v === "parts" ? partsView() : v === "part" ? partView(rt.id) : v === "purchasing" ? purchasingView() : v === "pr" ? prView(rt.id) : v === "po" ? (isMaint ? poView(rt.id) : maintOnly("Purchase orders")) : v === "suppliers" ? suppliersView() : overview();
    if (v === "part" && part(rt.id)) $("mtTitle").textContent = part(rt.id).part_no;
    bind(rt); bindParts(rt);
    if (v === "vessel" && rt.id) loadVesselExtras(rt.id);
    if ((v === "workorders" || v === "defects") && rt.id) loadFiles(v === "workorders" ? "work_order" : "defect", rt.id);
    if (v === "workorders" && rt.id) loadWoParts(rt.id);
    if (v === "part" && rt.id) { loadPartMoves(rt.id); loadFiles("part", rt.id); }
    if (v === "po" && rt.id && isMaint) loadFiles("purchase_order", rt.id);
  }

  /* ---------- overview ---------- */
  function overview() {
    var openWos = d.wos.filter(openWO), sch = d.schedules.filter(function (s) { return s.active; }).map(function (s) { return { s: s, x: schState(s) }; });
    var due = sch.filter(function (z) { return z.x.state !== "ok"; }), over = due.filter(function (z) { return z.x.state === "overdue"; });
    var crit = d.defects.filter(function (x) { return openDef(x) && (x.severity === "Critical" || x.stops_operation); });
    var down = d.vessels.filter(function (v) { return v.status !== "Operational"; });
    var appr = d.wos.filter(function (w) { return w.status === "Awaiting approval"; });
    var items = [];
    crit.forEach(function (x) { var v = vessel(x.vessel_id); items.push(['<a href="#defects/' + x.id + '">', x.title, (v ? v.name : "") + " · D-" + x.number + " · " + x.status, chip(x.severity === "Critical" ? "Critical" : x.severity, "st-sev-" + slug(x.severity))]); });
    over.forEach(function (z) { var v = vessel(z.s.vessel_id); items.push(['<a href="#schedules">', z.s.title, (v ? v.name : "") + " · overdue " + dueText(z.s, z.x), chip("Overdue", "st-absent")]); });
    appr.forEach(function (w) { var v = vessel(w.vessel_id); items.push(['<a href="#workorders/' + w.id + '">', w.title, (v ? v.name : "") + " · " + w.code + " · completed by " + nameOf(w.completed_by), chip("Needs approval", "st-late")]); });
    if (isApprover) d.prs.filter(function (r) { return r.status === "Waiting"; }).forEach(function (r) { items.push(['<a href="#pr/' + r.id + '">', "Parts request " + r.code, linesText(r.lines) + " · " + nameOf(r.requested_by), chip("Needs approval", "st-late")]); });
    if (isMaint) d.parts.filter(function (p) { var k = partState(p).k; return p.active && (k === "low" || k === "out") && onOrder(p.id) <= 0; }).slice(0, 6).forEach(function (p) { items.push(['<a href="#part/' + p.id + '">', p.part_no + " " + p.name, num(totalOf(p.id)) + " " + p.unit + " left, minimum " + num(p.min_stock) + " · nothing on order", chip(partState(p).label, partState(p).cls)]); });
    due.filter(function (z) { return z.x.state === "due"; }).slice(0, 6).forEach(function (z) { var v = vessel(z.s.vessel_id); items.push(['<a href="#schedules">', z.s.title, (v ? v.name : "") + " · due " + dueText(z.s, z.x), chip("Due", "st-wo-open")]); });
    var noVessels = !d.vessels.length;
    return '<div class="kpis">' + kpi("blue", I.wrench, "Open work orders", openWos.length, openWos.filter(function (w) { return w.priority === "Critical" || w.priority === "High"; }).length + " high or critical", "#workorders") +
      kpi("orange", I.cal, "Services due", due.length, over.length + " overdue", "#schedules") + kpi("red", I.alert, "Critical defects", crit.length, crit.length ? "Need attention now" : "None open", "#defects") +
      kpi("purple", I.ship, "Vessels unavailable", down.length, down.filter(function (v) { return v.status === "Out of service"; }).length + " out of service · " + down.filter(function (v) { return v.status === "Restricted"; }).length + " restricted", "#vessels") + '</div>' +
      (noVessels ? '<section class="dash-card">' + empty("No vessels yet. " + (isMaint ? 'Go to <a href="#vessels">Vessels</a> to add them, or bring in the vessel names already used for crew assignments.' : "Ask maintenance to add the fleet.")) + '</section>' :
      '<div class="hr-grid"><div class="col"><section class="dash-card"><div class="card-head"><div><h2>Priority work</h2><p class="note">Critical defects, overdue services and jobs waiting for sign-off first</p></div>' +
        '<span class="prof-actions"><button type="button" class="ghost" id="ovDefect">' + icon(I.alert) + ' Report a defect</button>' + (isMaint ? '<button type="button" class="save" id="ovWo">' + icon(I.plus) + ' New work order</button>' : "") + '</span></div>' +
        (items.length ? '<ul class="mt-prio">' + items.slice(0, 12).map(function (x) { return '<li>' + x[0] + '<span class="grow"><strong>' + esc(x[1]) + '</strong><small>' + esc(x[2]) + '</small></span>' + x[3] + '</a></li>'; }).join("") + '</ul>' : empty("Nothing urgent. All services are within their interval and no critical defects are open.")) + '</section></div>' +
        '<div class="col"><section class="dash-card"><div class="card-head"><h2>Fleet availability</h2><a class="btn-soft" href="#vessels">Open</a></div><ul class="mt-fleet">' + d.vessels.map(function (v) {
          var od = d.defects.filter(function (x) { return x.vessel_id === v.id && openDef(x); }).length;
          return '<li><a href="#vessel/' + v.id + '"><span class="mt-dot ' + slug(v.status) + '"></span><span class="grow"><strong>' + esc(v.name) + (v.code !== v.name ? ' <span class="muted-cell">' + esc(v.code) + '</span>' : "") + '</strong><small>' + esc(v.status_reason || (od ? od + " open defect" + (od > 1 ? "s" : "") : "No open defects")) + '</small></span>' + chip(v.status, ST_CLS[v.status]) + '</a></li>';
        }).join("") + '</ul></section>' +
        '<section class="dash-card"><h2>Quick actions</h2><div class="qa">' + [["Log engine hours", "#vessels", I.gauge], ["Start an inspection", "#inspections", I.check], ["Report a defect", "#defects", I.alert]].concat(isMaint ? [["Preventive schedules", "#schedules", I.cal], ["Spare parts", "#parts", I.box], ["Purchasing", "#purchasing", I.truck], ["Settings", "#settings", I.wrench]] : []).map(function (x) {
          return '<a class="qa-btn" href="' + x[1] + '">' + icon(x[2]) + '<span>' + x[0] + '</span></a>'; }).join("") + '</div></section></div></div>');
  }

  /* ---------- vessels ---------- */
  function vesselsView() {
    var known = d.vessels.map(function (v) { return v.code.toLowerCase(); }).concat(d.vessels.map(function (v) { return v.name.toLowerCase(); }));
    var crewNames = []; Object.keys(d.people).forEach(function (k) { var vv = d.people[k].vessel; if (vv && known.indexOf(vv.toLowerCase()) < 0 && crewNames.indexOf(vv) < 0) crewNames.push(vv); });
    return '<section class="dash-card"><div class="card-head"><div><h2>Fleet</h2><p class="note">' + d.vessels.length + ' vessel' + (d.vessels.length === 1 ? "" : "s") + '. Open one for its engines, hours, schedules and history.</p></div>' +
      (isMaint ? '<span class="prof-actions">' + (crewNames.length ? '<button type="button" class="ghost" id="vsImport">Add ' + crewNames.length + ' from crew assignments</button>' : "") + '<button type="button" class="save" id="vsAdd">' + icon(I.plus) + ' Add vessel</button></span>' : "") + '</div>' +
      (crewNames.length && isMaint ? '<p class="hint">Crew are assigned to ' + esc(crewNames.join(", ")) + ', which ' + (crewNames.length > 1 ? "are" : "is") + ' not in the fleet list yet.</p>' : "") +
      (d.vessels.length ? '<div class="mt-vgrid">' + d.vessels.map(function (v) {
        var cs = d.comps.filter(function (c) { return c.vessel_id === v.id && c.status === "In service"; }), eng = cs.filter(function (c) { return c.tracks_hours; });
        var od = d.defects.filter(function (x) { return x.vessel_id === v.id && openDef(x); }), ow = d.wos.filter(function (w) { return w.vessel_id === v.id && openWO(w); });
        var sch = d.schedules.filter(function (s) { return s.vessel_id === v.id && s.active; }).map(schState), dueN = sch.filter(function (x) { return x.state !== "ok"; }).length;
        return '<a class="mt-vcard ' + slug(v.status) + '" href="#vessel/' + v.id + '"><div class="mt-vtop"><span class="ru-ic">' + window.VeyoraShell.vesselPhotoImg(v) + '</span><span class="grow"><strong>' + esc(v.name) + '</strong><small>' + esc((v.code !== v.name ? v.code + " · " : "") + v.kind) + '</small></span>' + chip(v.status, ST_CLS[v.status]) + '</div>' +
          (v.status_reason ? '<p class="mt-reason">' + esc(v.status_reason) + '</p>' : "") +
          '<div class="mt-vstats"><span><b>' + eng.length + '</b>engines</span><span><b>' + (eng.length ? Math.max.apply(null, eng.map(function (c) { return Number(c.hours); })) : "–") + '</b>max hours</span><span' + (dueN ? ' class="warn"' : "") + '><b>' + dueN + '</b>services due</span><span' + (od.length ? ' class="bad"' : "") + '><b>' + od.length + '</b>open defects</span><span><b>' + ow.length + '</b>open jobs</span></div></a>';
      }).join("") + '</div>' : empty("No vessels yet." + (isMaint ? " Add your fleet to start tracking maintenance." : ""))) + '</section>';
  }
  // Cursor 2026-10-23: modern vessel detail — hero, KPI strip, section cards (same actions/IDs).
  function vesselView(id) {
    var v = vessel(id); if (!v) return '<section class="dash-card">' + empty('Vessel not found. <a href="#vessels">Back to the fleet</a>') + '</section>';
    var cs = d.comps.filter(function (c) { return c.vessel_id === id; }), sch = d.schedules.filter(function (s) { return s.vessel_id === id; });
    var wos = d.wos.filter(function (w) { return w.vessel_id === id; }), defs = d.defects.filter(function (x) { return x.vessel_id === id; }), ins = d.inspections.filter(function (x) { return x.vessel_id === id; });
    var ex = cache["v:" + id] || {}, crew = Object.keys(d.people).map(function (k) { return d.people[k]; }).filter(function (p) { return p.active && p.vessel && (p.vessel.toLowerCase() === v.code.toLowerCase() || p.vessel.toLowerCase() === v.name.toLowerCase()); });
    var stopping = defs.filter(function (x) { return x.stops_operation && openDef(x); });
    var od = defs.filter(openDef), ow = wos.filter(openWO);
    var dueN = sch.filter(function (s) { var x = schState(s); return s.active && (x.state === "due" || x.state === "overdue"); }).length;
    var eng = cs.filter(function (c) { return /engine/i.test(c.kind || "") || c.tracks_hours; });
    var maxH = eng.length ? Math.max.apply(null, eng.map(function (c) { return Number(c.hours) || 0; })) : null;
    var fmLink = followmeLinked(v), fmH = followmeHint(v);
    var tone = v.status === "Operational" ? (v.standby ? "slate" : "ok") : (v.status === "Restricted" ? "warn" : "bad");
    var live = v.status === "Operational" && !v.standby;
    var stLabel = v.status === "Operational" && v.standby ? "Standby" : (v.status === "Operational" ? "In service" : v.status);
    var pax = v.passenger_capacity != null ? Number(v.passenger_capacity) : null;
    var crewN = v.crew_capacity != null ? Number(v.crew_capacity) : null;
    var capTxt = (pax != null || crewN != null)
      ? ((pax || 0) + " pax" + (crewN ? " + " + crewN + " crew" : ""))
      : "—";
    var metaBits = [v.code, v.kind, v.registration, v.built_year ? "Built " + v.built_year : "", v.assigned_route || null].filter(Boolean);

    function vdKpi(label, value, sub, cls) {
      return '<div class="vd-kpi' + (cls ? " " + cls : "") + '"><small>' + label + '</small><strong>' + value + '</strong>' + (sub ? '<span>' + sub + '</span>' : "") + '</div>';
    }

    return '<div class="vd">' +
      '<div class="vd-nav"><a class="vd-back" href="#vessels">' + icon(I.back) + ' Maintenance fleet</a>' +
        '<a class="vd-back soft" href="fleet.html">Fleet directory</a></div>' +

      '<section class="vd-hero tone-' + tone + '">' +
        '<div class="vd-hero-main">' +
          '<div class="vd-visual">' + window.VeyoraShell.vesselPhotoImg(v) + /* Cursor 2026-10-27: vessel photo or sample boat */ '<span class="vd-code">' + esc(String(v.code || "").slice(0, 8)) + '</span></div>' +
          '<div class="vd-id">' +
            '<div class="vd-id-top"><h1>' + esc(v.name) + '</h1>' +
              '<span class="vd-status ' + ST_CLS[v.status] + (live ? " live" : "") + '"><i></i>' + esc(stLabel) + '</span></div>' +
            '<p class="vd-meta">' + esc(metaBits.join(" · ")) +
              (fmLink ? ' · <span class="mt-followme" title="' + esc(fmH || "FollowMe linked") + '">FollowMe' + (fmH ? " · " + esc(fmH) : " linked") + '</span>' : "") +
            '</p>' +
            (crew.length ? '<div class="vd-crew">' + crew.slice(0, 5).map(function (p) {
              var ini = String(p.name || "?").split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
              return '<span class="vd-av" title="' + esc(p.name) + '">' + esc(ini) + '</span>';
            }).join("") + (crew.length > 5 ? '<span class="vd-av more">+' + (crew.length - 5) + '</span>' : "") +
              '<span class="vd-crew-lbl">' + crew.length + ' crew assigned</span></div>' : "") +
            (v.status !== "Operational"
              ? '<p class="vd-reason">' + esc(v.status_reason || "Not in service") + ' · since ' + when(v.status_at) + '</p>'
              : (v.released_at ? '<p class="vd-hint">Returned to service ' + when(v.released_at) + ' by ' + esc(nameOf(v.released_by)) + '</p>' : "")) +
          '</div>' +
        '</div>' +
        '<div class="vd-actions">' +
          '<button type="button" class="ghost" data-defnew="' + id + '">' + icon(I.alert) + ' Report defect</button>' +
          (isMaint
            ? '<button type="button" class="ghost" data-wonew="' + id + '">' + icon(I.plus) + ' Work order</button>' +
              (v.status === "Operational"
                ? '<button type="button" class="ghost danger" id="vsDown">Restrict / out of service</button>'
                : '<button type="button" class="save" id="vsRelease"' + (stopping.length ? ' title="Repair the defects that stop operation first"' : "") + '>Return to service</button>') +
              '<button type="button" class="ghost" id="vsEdit">Edit vessel</button>'
            : "") +
        '</div>' +
      '</section>' +

      (stopping.length
        ? '<div class="vd-alert"><strong>' + stopping.length + ' defect' + (stopping.length > 1 ? "s stop" : " stops") + ' operation</strong><span>' +
          esc(stopping.map(function (x) { return "D-" + x.number + " " + x.title; }).join(" · ")) + '</span></div>'
        : "") +

      '<div class="vd-kpis">' +
        vdKpi("Capacity", esc(capTxt), pax != null ? "Sold seats on trips" : "Set in Edit") +
        vdKpi("Engines", String(eng.length || cs.length), cs.length ? (cs.length + " components") : "None yet") +
        vdKpi("Max hours", maxH != null ? maxH.toLocaleString() + " h" : "—", "Highest meter") +
        vdKpi("Services due", String(dueN), dueN ? "Due or overdue" : "All clear", dueN ? "warn" : "") +
        vdKpi("Open defects", String(od.length), od.length ? "Needs attention" : "None open", od.length ? "bad" : "") +
        vdKpi("Open jobs", String(ow.length), ow.length ? "Work in progress" : "Queue clear", ow.length ? "live" : "") +
      '</div>' +

      '<div class="vd-grid">' +
        '<div class="vd-col">' +
          '<section class="vd-card"><div class="vd-card-head"><div><h2>Engines & components</h2><p>Log running hours from the hour meter.</p></div>' +
            (isMaint ? '<button type="button" class="save" data-compnew="' + id + '">' + icon(I.plus) + ' Add</button>' : "") + '</div>' +
            (cs.length ? '<div class="vd-comps">' + cs.map(function (c) {
              var wexp = c.warranty_until && c.warranty_until < todayIso();
              return '<article class="vd-comp' + (c.status !== "In service" ? " off" : "") + '">' +
                '<div class="vd-comp-ic">' + icon(I.gauge) + '</div>' +
                '<div class="vd-comp-body"><strong>' + esc(c.name) + '</strong>' +
                  '<small>' + esc([c.kind, c.status !== "In service" ? c.status : "", c.make_model, c.serial ? "S/N " + c.serial : ""].filter(Boolean).join(" · ")) + '</small>' +
                  '<div class="vd-comp-meta">' +
                    (c.tracks_hours ? '<span><b>' + Number(c.hours).toLocaleString() + ' h</b> ' + ago(c.hours_at) + '</span>' : '<span>No hour meter</span>') +
                    (c.warranty_until ? '<span class="' + (wexp ? "bad" : "") + '">' + (wexp ? "Warranty ended " : "Warranty until ") + fmtDate(c.warranty_until) + '</span>' : "") +
                  '</div></div>' +
                '<div class="vd-comp-acts">' +
                  (c.status === "In service" ? '<button type="button" class="ghost manage-btn" data-hours="' + c.id + '">Log hours</button>' : "") +
                  (isMaint ? '<button type="button" class="ghost manage-btn" data-compedit="' + c.id + '">Edit</button>' : "") +
                '</div></article>';
            }).join("") + '</div>' : empty("No components yet." + (isMaint ? " Add the engines first, e.g. Port engine and Starboard engine." : ""))) +
          '</section>' +
          '<section class="vd-card"><div class="vd-card-head"><div><h2>Preventive schedules</h2><p>Repeating services by days and/or hours.</p></div>' +
            (isMaint ? '<button type="button" class="ghost" data-schnew="' + id + '">' + icon(I.plus) + ' Add schedule</button>' : "") + '</div>' +
            schTable(sch, false) + '</section>' +
          '<section class="vd-card"><div class="vd-card-head"><div><h2>Work orders</h2><p>Recent jobs on this vessel.</p></div>' +
            '<a class="btn-soft" href="#workorders">All work orders</a></div>' +
            (wos.length ? woRows(wos.slice(0, 10)) : empty("No work orders for this vessel.")) + '</section>' +
        '</div>' +
        '<div class="vd-col">' +
          '<section class="vd-card"><div class="vd-card-head"><div><h2>Defects</h2><p>Open and recent reports.</p></div></div>' +
            (defs.length ? defRows(defs.slice(0, 10)) : empty("No defects reported.")) + '</section>' +
          '<section class="vd-card"><div class="vd-card-head"><div><h2>Inspections</h2><p>Checklist runs and surveys.</p></div>' +
            '<a class="btn-soft" href="#inspections">Start one</a></div>' +
            (ins.length ? inspRows(ins.slice(0, 6)) : empty("No inspections yet.")) + '</section>' +
          '<section class="vd-card"><div class="vd-card-head"><div><h2>Files</h2><p>Service reports, invoices, certificates and photos.</p></div></div>' +
            filesBlock("vessel", id, ex.files) + '</section>' +
          '<section class="vd-card"><div class="vd-card-head"><div><h2>History</h2><p>Status changes, hours and jobs.</p></div></div>' +
            (ex.events
              ? (ex.events.length
                ? '<ul class="timeline vd-timeline">' + ex.events.map(function (e) {
                    return '<li><span class="tl-dot tl-' + esc(e.ref_type) + '"></span><span class="grow"><strong>' + esc(e.detail) + '</strong><small>' + when(e.created_at) + (e.actor ? " · " + esc(nameOf(e.actor)) : "") + '</small></span></li>';
                  }).join("") + '</ul>'
                : empty("Nothing recorded yet."))
              : '<p class="msg">Loading…</p>') +
          '</section>' +
        '</div>' +
      '</div></div>';
  }
  function loadVesselExtras(id) {
    if (cache["v:" + id]) return;
    cache["v:" + id] = {};
    Promise.all([db.from("maint_events").select("*").eq("vessel_id", id).order("created_at", { ascending: false }).limit(60), db.from("maint_files").select("*").eq("ref_type", "vessel").eq("ref_id", id).order("created_at", { ascending: false })])
      .then(function (r) { cache["v:" + id] = { events: r[0].data || [], files: r[1].data || [] }; var rt = route(); if (rt.view === "vessel" && rt.id === id) render(); });
  }

  /* ---------- schedules ---------- */
  function schTable(list, showVessel) {
    if (!list.length) return empty("No preventive schedules." + (isMaint ? " Add one, e.g. Engine service every 250 hours or 6 months." : ""));
    return '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Service</th>' + (showVessel ? '<th>Vessel</th>' : "") + '<th>Every</th><th>Last done</th><th>Next due</th><th>Status</th><th></th></tr></thead><tbody>' + list.map(function (s) {
      var x = schState(s), v = vessel(s.vessel_id), c = s.component_id ? comp(s.component_id) : null, wo = d.wos.filter(function (w) { return w.schedule_id === s.id && openWO(w); })[0];
      return '<tr' + (s.active ? "" : ' class="mt-off"') + '><td><strong>' + esc(s.title) + '</strong><span class="th-sub">' + esc([c ? c.name : "", s.job_type].filter(Boolean).join(" · ")) + '</span></td>' + (showVessel ? '<td><a href="#vessel/' + s.vessel_id + '">' + esc(v ? v.name : "") + '</a></td>' : "") +
        '<td class="muted-cell">' + [s.interval_days ? s.interval_days + " days" : "", s.interval_hours ? Number(s.interval_hours) + " h" : ""].filter(Boolean).join(" or ") + '</td>' +
        '<td class="muted-cell">' + (s.last_done_on ? fmtDate(s.last_done_on) : "Not yet") + (s.last_done_hours != null ? '<span class="th-sub">at ' + Number(s.last_done_hours) + ' h</span>' : "") + '</td>' +
        '<td class="muted-cell">' + esc(dueText(s, x) || "—") + '</td><td>' + (s.active ? chip(x.label, x.state === "overdue" ? "st-absent" : x.state === "due" ? "st-late" : "st-present") : chip("Off", "st-off-duty")) + (wo ? '<a class="th-sub" href="#workorders/' + wo.id + '">' + esc(wo.code) + ' ' + esc(wo.status.toLowerCase()) + '</a>' : "") + '</td>' +
        '<td class="it-acts">' + (isMaint && s.active && !wo ? '<button type="button" class="save manage-btn" data-schwo="' + s.id + '">Create job</button>' : "") + (isMaint ? '<button type="button" class="ghost manage-btn" data-schedit="' + s.id + '">Edit</button>' : "") + '</td></tr>';
    }).join("") + '</tbody></table></div>';
  }
  function schedulesView() {
    var all = d.schedules.map(function (s) { return { s: s, x: schState(s) }; });
    var list = all.filter(function (z) { return !schFilter || (schFilter === "off" ? !z.s.active : z.s.active && z.x.state === schFilter); }).map(function (z) { return z.s; });
    var n = function (k) { return all.filter(function (z) { return z.s.active && z.x.state === k; }).length; };
    return '<section class="dash-card"><div class="card-head"><div><h2>Preventive schedules</h2><p class="note">Each service repeats by days and/or running hours, whichever comes first. Completing its work order sets the next due date and hours.</p></div>' + (isMaint && d.vessels.length ? '<button type="button" class="save" data-schnew="">' + icon(I.plus) + ' Add schedule</button>' : "") + '</div>' +
      '<div class="stage-pills">' + [["", "All", d.schedules.length], ["overdue", "Overdue", n("overdue")], ["due", "Due soon", n("due")], ["ok", "OK", n("ok")], ["off", "Off", d.schedules.filter(function (s) { return !s.active; }).length]].map(function (t) {
        return '<button type="button" class="pill-btn' + (schFilter === t[0] ? " on" : "") + '" data-schf="' + t[0] + '">' + t[1] + '<b>' + t[2] + '</b></button>'; }).join("") + '</div>' + schTable(list, true) + '</section>';
  }
  function openSchedule(id, vesselId) {
    var s = id ? d.schedules.filter(function (x) { return x.id === id; })[0] : { vessel_id: vesselId || (d.vessels[0] || {}).id, active: true, interval_days: null, interval_hours: null };
    var jt = listSetting("10_maintenance_job_types", "Maintenance Job Types"), iv = formSetting("10_service_interval_rules", "Service Interval Rules");
    var compsOf = function (vid) { return d.comps.filter(function (c) { return c.vessel_id === vid && c.status === "In service"; }); };
    openModal('<h2>' + (id ? "Edit schedule" : "New preventive schedule") + '</h2><p class="note">Suggested intervals from Service Interval Rules. Click one to fill the fields.</p>' +
      '<div class="stage-pills" id="sSug">' +
        '<button type="button" class="pill-btn" data-sug="engine">Engine · ' + (iv.engineHours || 250) + ' h</button>' +
        '<button type="button" class="pill-btn" data-sug="hull">Hull · ' + (iv.hullMonths || 6) + ' mo</button>' +
        '<button type="button" class="pill-btn" data-sug="safety">Safety · ' + (iv.safetyMonths || 3) + ' mo</button>' +
        '<button type="button" class="pill-btn" data-sug="drydock">Dry-dock · ' + (iv.drydock || 24) + ' mo</button></div>' +
      '<div class="cards"><div class="fld"><label for="sTitle">Service</label><input id="sTitle" maxlength="120" value="' + esc(s.title || "") + '" placeholder="e.g. 250-hour engine service"></div>' +
      '<div class="fld"><label for="sType">Job type</label><input id="sType" list="sTypes" maxlength="60" value="' + esc(s.job_type || "") + '"><datalist id="sTypes">' + jt.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist></div>' +
      '<div class="fld"><label for="sVessel">Vessel</label><select id="sVessel">' + options(d.vessels.map(function (v) { return [v.id, v.name]; }), s.vessel_id) + '</select></div>' +
      '<div class="fld"><label for="sComp">Engine or component</label><select id="sComp">' + options(compsOf(s.vessel_id).map(function (c) { return [c.id, c.name]; }), s.component_id || "", "Whole vessel") + '</select></div>' +
      '<div class="fld"><label for="sDays">Every (days)</label><input id="sDays" type="number" min="1" value="' + (s.interval_days || "") + '" placeholder="e.g. 180"></div>' +
      '<div class="fld"><label for="sHours">Every (running hours)</label><input id="sHours" type="number" min="1" step="any" value="' + (s.interval_hours || "") + '" placeholder="e.g. 250"><small class="hint">Needs an engine or component that logs hours.</small></div>' +
      '<div class="fld"><label for="sLast">Last done on</label><input id="sLast" type="date" value="' + esc(s.last_done_on || "") + '"></div>' +
      '<div class="fld"><label for="sLastH">Last done at (hours)</label><input id="sLastH" type="number" min="0" step="any" value="' + (s.last_done_hours == null ? "" : s.last_done_hours) + '"></div></div>' +
      '<div class="fld"><label for="sTasks">What to do (copied onto the work order)</label><textarea id="sTasks" rows="3" maxlength="2000" placeholder="e.g. Change oil and oil filter, check belts, check coolant">' + esc(s.tasks || "") + '</textarea></div>' +
      '<label class="chk"><input type="checkbox" id="sOn"' + (s.active ? " checked" : "") + '> Schedule is on</label><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' + (id ? '<button type="button" class="ghost danger" id="sDel">Remove</button>' : "") + '<button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="sGo">Save</button></div>', true);
    $("sVessel").addEventListener("change", function () { $("sComp").innerHTML = options(compsOf(this.value).map(function (c) { return [c.id, c.name]; }), "", "Whole vessel"); });
    [].forEach.call(document.querySelectorAll("#sSug [data-sug]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.sug;
        if (k === "engine") { $("sTitle").value = (iv.engineHours || 250) + "-hour engine service"; $("sType").value = "Engine service"; $("sHours").value = iv.engineHours || 250; $("sDays").value = ""; }
        else if (k === "hull") { $("sTitle").value = "Hull inspection"; $("sType").value = "Hull cleaning"; $("sDays").value = Math.round((iv.hullMonths || 6) * 30.44); $("sHours").value = ""; }
        else if (k === "safety") { $("sTitle").value = "Safety equipment check"; $("sType").value = "Safety equipment check"; $("sDays").value = Math.round((iv.safetyMonths || 3) * 30.44); $("sHours").value = ""; }
        else { $("sTitle").value = "Dry-docking"; $("sType").value = "Dry-docking"; $("sDays").value = Math.round((iv.drydock || 24) * 30.44); $("sHours").value = ""; }
      });
    });
    $("sGo").addEventListener("click", function () {
      var row = { vessel_id: $("sVessel").value, component_id: $("sComp").value || null, title: $("sTitle").value.trim(), job_type: $("sType").value.trim() || null, interval_days: $("sDays").value ? Number($("sDays").value) : null,
        interval_hours: $("sHours").value ? Number($("sHours").value) : null, last_done_on: $("sLast").value || null, last_done_hours: $("sLastH").value === "" ? null : Number($("sLastH").value), tasks: $("sTasks").value.trim() || null, active: $("sOn").checked };
      if (row.title.length < 2) { say("Name the service.", "err"); return; }
      if (!row.interval_days && !row.interval_hours) { say("Set how often: days, running hours, or both.", "err"); return; }
      if (row.interval_hours && !row.component_id) { say("Running-hour schedules need an engine or component.", "err"); return; }
      var q = id ? db.from("maint_schedules").update(row).eq("id", id) : db.from("maint_schedules").insert(Object.assign(row, { company_id: company.id }));
      q.then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
    });
    if ($("sDel")) $("sDel").addEventListener("click", function () { if (!confirm("Remove this schedule? Past work orders are kept.")) return; db.from("maint_schedules").delete().eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } }); });
  }

  /* ---------- work orders ---------- */
  function woRows(list) {
    return '<ul class="rows it-tks">' + list.map(function (w) {
      var v = vessel(w.vessel_id), late = w.due_on && w.due_on < todayIso() && openWO(w);
      return '<li class="row"><a class="it-tk" href="#workorders/' + w.id + '"><span class="it-num mt-code">' + esc(w.code) + '</span><span class="grow"><strong>' + esc(w.title) + '</strong><small>' + esc([v ? v.name : "", w.kind, w.assignee ? nameOf(w.assignee) : w.contractor || "Not assigned"].filter(Boolean).join(" · ")) +
        (w.due_on ? ' · due ' + fmtDate(w.due_on) : "") + (late ? ' · <span class="exp">late</span>' : "") + '</small></span>' + chip(w.priority, "st-sev-" + slug(w.priority)) + chip(w.status, "st-wo-" + slug(w.status)) + '</a></li>';
    }).join("") + '</ul>';
  }
  function woList() {
    var mine = d.wos.filter(function (w) { return w.assignee === ctx.me && openWO(w); });
    var f = { active: function (w) { return openWO(w); }, mine: function (w) { return w.assignee === ctx.me && openWO(w); }, approval: function (w) { return w.status === "Awaiting approval"; }, parts: function (w) { return w.status === "Awaiting parts"; }, done: function (w) { return !openWO(w); }, all: function () { return true; } };
    var list = d.wos.filter(f[woFilter] || f.active);
    return '<section class="dash-card"><div class="card-head"><div><h2>Work orders</h2><p class="note">' + d.wos.filter(openWO).length + ' open · ' + mine.length + ' assigned to you</p></div>' + (isMaint && d.vessels.length ? '<button type="button" class="save" data-wonew="">' + icon(I.plus) + ' New work order</button>' : "") + '</div>' +
      '<div class="stage-pills">' + [["active", "Open"], ["mine", "Assigned to me"], ["approval", "Awaiting approval"], ["parts", "Awaiting parts"], ["done", "Completed & closed"], ["all", "All"]].map(function (t) {
        return '<button type="button" class="pill-btn' + (woFilter === t[0] ? " on" : "") + '" data-wof="' + t[0] + '">' + t[1] + '<b>' + d.wos.filter(f[t[0]]).length + '</b></button>'; }).join("") + '</div>' +
      (list.length ? woRows(list) : empty("No work orders here.")) + '</section>';
  }
  var FLOW = ["Open", "Assigned", "In progress", "Awaiting parts", "Awaiting approval", "Completed", "Closed"];
  function woView(id) {
    var w = d.wos.filter(function (x) { return x.id === id; })[0]; if (!w) return '<section class="dash-card">' + empty('Work order not found. <a href="#workorders">Back</a>') + '</section>';
    var v = vessel(w.vessel_id), c = w.component_id ? comp(w.component_id) : null, def = w.defect_id ? d.defects.filter(function (x) { return x.id === w.defect_id; })[0] : null, s = w.schedule_id ? d.schedules.filter(function (x) { return x.id === w.schedule_id; })[0] : null;
    var canWork = isMaint || w.assignee === ctx.me, live = ["Awaiting approval", "Completed", "Closed"].indexOf(w.status) < 0, at = FLOW.indexOf(w.status);
    var cost = Number(w.cost_labour || 0) + Number(w.cost_parts || 0) + Number(w.cost_other || 0), wp = cache["wp:" + id], issued = wp && wp.moves.some(function (m) { return m.kind === "Issued" || m.kind === "Returned"; });
    var kv = function (rows) { return '<dl class="kv">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + (r[1] === "" || r[1] == null ? '<span class="muted-cell">—</span>' : r[1]) + '</dd></div>'; }).join("") + '</dl>'; };
    return '<section class="dash-card prof-head"><a class="back" href="#workorders">' + icon(I.back) + 'Work orders</a><div class="card-head"><div><h2>' + esc(w.code) + ' · ' + esc(w.title) + '</h2><p class="note">' + esc([v ? v.name : "", c ? c.name : "", w.kind, w.category].filter(Boolean).join(" · ")) + ' · created ' + when(w.created_at) + ' by ' + esc(nameOf(w.created_by)) + '</p></div>' +
      '<span class="prof-chips">' + chip(w.priority, "st-sev-" + slug(w.priority)) + chip(w.status, "st-wo-" + slug(w.status)) + '</span></div>' +
      '<ol class="mt-flow">' + FLOW.map(function (st, i) { return '<li class="' + (i < at ? "done" : i === at ? "now" : "") + '">' + st + '</li>'; }).join("") + '</ol>' +
      '<div class="att-toolbar">' + (isMaint ? '<button type="button" class="ghost" id="woEdit">Edit details</button>' : "") +
        (canWork && live ? ["Assigned", "In progress", "Awaiting parts"].filter(function (x) { return x !== w.status; }).map(function (x) { return '<button type="button" class="ghost" data-wost="' + x + '">' + (x === "In progress" ? "Start work" : x === "Awaiting parts" ? "Waiting for parts" : "Back to assigned") + '</button>'; }).join("") + '<button type="button" class="save" id="woDone">Complete job</button>' : "") +
        (w.status === "Awaiting approval" && isApprover ? '<button type="button" class="ghost danger" id="woBack">Send back</button><button type="button" class="save" id="woOk">Approve</button>' : "") +
        (w.status === "Completed" && isMaint ? '<button type="button" class="save" id="woClose">Close job</button>' : "") + '</div><p class="msg" id="mMsgInline" role="status"></p></section>' +
      '<div class="hr-grid"><div class="col"><section class="dash-card"><h2>The job</h2>' + kv([["Problem", esc(w.problem || "")], ["Work required", esc(w.work_required || "")], ["Assigned to", esc(w.assignee ? nameOf(w.assignee) : "") + (w.contractor ? (w.assignee ? " · " : "") + "Contractor: " + esc(w.contractor) : "")],
        ["Due", w.due_on ? fmtDate(w.due_on) : ""], ["From", def ? '<a href="#defects/' + def.id + '">D-' + def.number + ' ' + esc(def.title) + '</a>' : s ? "Preventive schedule: " + esc(s.title) : ""], ["Needs approval", w.needs_approval ? "Yes, before it counts as completed" : "No"]]) + '</section>' +
      '<section class="dash-card"><div class="card-head"><h2>Work done</h2></div>' + (canWork && live ? '<div class="cards"><div class="fld"><label for="pHours">Labour hours</label><input id="pHours" type="number" min="0" step="0.25" value="' + (w.labour_hours == null ? "" : w.labour_hours) + '">' + (labourRateFor(w) ? '<small class="hint">Rate ' + money(labourRateFor(w)) + '/h from Labour Rates' + (w.contractor ? " (contractor)" : "") + '.</small>' : '<small class="hint">Set Labour Rates in Maintenance Settings to suggest a cost.</small>') + '</div>' +
        '<div class="fld"><label for="pLab">Labour cost</label><input id="pLab" type="number" min="0" step="0.01" value="' + (w.cost_labour == null ? "" : w.cost_labour) + '">' + (labourRateFor(w) ? '<button type="button" class="ghost" id="pLabSug" style="margin-top:6px">Suggest from hours × rate</button>' : "") + '</div><div class="fld"><label for="pParts">Parts cost</label><input id="pParts" type="number" min="0" step="0.01" value="' + (w.cost_parts == null ? "" : w.cost_parts) + '"' + (issued ? ' readonly title="Worked out from the parts issued from the store"' : "") + '>' + (issued ? '<small class="hint">From the parts issued below.</small>' : "") + '</div>' +
        '<div class="fld"><label for="pOther">Other cost</label><input id="pOther" type="number" min="0" step="0.01" value="' + (w.cost_other == null ? "" : w.cost_other) + '">' + (costCats().length ? '<small class="hint">Groups: ' + esc(costCats().join(", ")) + '</small>' : "") + '</div></div>' +
        '<div class="fld"><label for="pPartsUsed">Other parts used (not from the store)</label><textarea id="pPartsUsed" rows="2" maxlength="1000" placeholder="e.g. hose clamps bought on the island">' + esc(w.parts_used || "") + '</textarea></div>' +
        '<div class="fld"><label for="pDone">Work performed</label><textarea id="pDone" rows="3" maxlength="2000">' + esc(w.work_done || "") + '</textarea></div><button type="button" class="ghost" id="pSave">Save progress</button>' :
        kv([["Work performed", esc(w.work_done || "")], ["Other parts used", esc(w.parts_used || "")], ["Labour hours", w.labour_hours == null ? "" : w.labour_hours + " h"], ["Cost", cost ? money(cost) : ""],
          ["Completed", w.completed_at ? when(w.completed_at) + " by " + esc(nameOf(w.completed_by)) + (w.hours_at_done != null ? " · at " + w.hours_at_done + " h" : "") : ""], ["Approved", w.approved_at ? when(w.approved_at) + " by " + esc(nameOf(w.approved_by)) + (w.approval_note ? " · " + esc(w.approval_note) : "") : w.approval_note ? "Sent back: " + esc(w.approval_note) : ""]])) + '</section></div>' +
      '<div class="col"><section class="dash-card"><h2>Parts from the store</h2><p class="note">Issue parts to this job as they are taken; return what was not used. The parts cost follows.</p>' + woPartsBlock(w, canWork) + '</section>' +
      '<section class="dash-card"><h2>Files & photos</h2>' + filesBlock("work_order", id, cache["f:work_order:" + id]) + '</section></div></div>';
  }
  function openWoForm(id, vesselId, preset) {
    var w = id ? d.wos.filter(function (x) { return x.id === id; })[0] : Object.assign({ vessel_id: vesselId || (d.vessels[0] || {}).id, kind: "Corrective", priority: "Medium" }, preset || {});
    var appr = formSetting("10_maintenance_approval_rules", "Maintenance Approval Rules"), cats = listSetting("10_maintenance_categories", "Maintenance Categories");
    var compsOf = function (vid) { return d.comps.filter(function (c) { return c.vessel_id === vid && c.status === "In service"; }); };
    openModal('<h2>' + (id ? "Edit " + esc(w.code) : "New work order") + '</h2><div class="cards">' +
      '<div class="fld"><label for="wTitle">Job</label><input id="wTitle" maxlength="120" value="' + esc(w.title || "") + '" placeholder="e.g. Replace raw-water pump impeller"></div>' +
      '<div class="fld"><label for="wVessel">Vessel</label><select id="wVessel"' + (id ? " disabled" : "") + '>' + options(d.vessels.map(function (v) { return [v.id, v.name]; }), w.vessel_id) + '</select></div>' +
      '<div class="fld"><label for="wComp">Engine or component</label><select id="wComp">' + options(compsOf(w.vessel_id).map(function (c) { return [c.id, c.name]; }), w.component_id || "", "Whole vessel") + '</select></div>' +
      '<div class="fld"><label for="wKind">Type</label><select id="wKind">' + options(["Corrective", "Preventive", "Breakdown", "Inspection"], w.kind) + '</select></div>' +
      '<div class="fld"><label for="wCat">Category</label><select id="wCat">' + options(cats, w.category || "", "None") + '</select></div>' +
      '<div class="fld"><label for="wPri">Priority</label><select id="wPri">' + options(PRI, w.priority) + '</select></div>' +
      '<div class="fld"><label for="wWho">Assign to</label><select id="wWho">' + options(staffList().map(function (p) { return [p.uid, p.name]; }), w.assignee || "", "Nobody yet") + '</select></div>' +
      '<div class="fld"><label for="wCon">Or contractor</label><input id="wCon" maxlength="120" value="' + esc(w.contractor || "") + '" placeholder="e.g. Malé Marine Engineering"></div>' +
      '<div class="fld"><label for="wDue">Due</label><input id="wDue" type="date" value="' + esc(w.due_on || "") + '"></div>' +
      (id ? '<div class="fld"><label for="wSt">Status</label><select id="wSt">' + options(WO_ST, w.status) + '</select></div>' : "") + '</div>' +
      '<div class="fld"><label for="wProb">Problem reported</label><textarea id="wProb" rows="2" maxlength="2000">' + esc(w.problem || "") + '</textarea></div>' +
      '<div class="fld"><label for="wReq">Work required</label><textarea id="wReq" rows="3" maxlength="2000">' + esc(w.work_required || "") + '</textarea></div>' +
      '<label class="chk"><input type="checkbox" id="wAppr"' + ((id ? w.needs_approval : appr.enabled !== false) ? " checked" : "") + '> Needs approval before it counts as completed</label><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' + (id && ["Draft", "Open"].indexOf(w.status) > -1 ? '<button type="button" class="ghost danger" id="wDel">Delete</button>' : "") + '<button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="wGo">' + (id ? "Save" : "Create work order") + '</button></div>', true);
    $("wVessel").addEventListener("change", function () { $("wComp").innerHTML = options(compsOf(this.value).map(function (c) { return [c.id, c.name]; }), "", "Whole vessel"); });
    $("wGo").addEventListener("click", function () {
      var row = { title: $("wTitle").value.trim(), component_id: $("wComp").value || null, kind: $("wKind").value, category: $("wCat").value || null, priority: $("wPri").value, assignee: $("wWho").value || null,
        contractor: $("wCon").value.trim() || null, due_on: $("wDue").value || null, problem: $("wProb").value.trim() || null, work_required: $("wReq").value.trim() || null, needs_approval: $("wAppr").checked };
      if (row.title.length < 3) { say("Name the job.", "err"); return; }
      if (id) {
        row.status = $("wSt").value;
        db.from("work_orders").update(row).eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
      } else {
        rpc("create_work_order", { p_company: company.id, p_vessel: $("wVessel").value, p_row: Object.assign(row, { schedule_id: w.schedule_id || null, defect_id: w.defect_id || null }) })
          .then(function (n) { closeModal(); location.hash = "#workorders/" + n.id; return reload(); }).catch(function (e) { say(e.message, "err"); });
      }
    });
    if ($("wDel")) $("wDel").addEventListener("click", function () { if (!confirm("Delete " + w.code + "?")) return; db.from("work_orders").delete().eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); location.hash = "#workorders"; reload(); } }); });
  }

  /* ---------- defects ---------- */
  function defRows(list) {
    return '<ul class="rows it-tks">' + list.map(function (x) {
      var v = vessel(x.vessel_id);
      return '<li class="row"><a class="it-tk" href="#defects/' + x.id + '"><span class="it-num mt-code">D-' + x.number + '</span><span class="grow"><strong>' + esc(x.title) + '</strong><small>' + esc([v ? v.name : "", x.kind, x.source === "Inspection" ? "from inspection" : "reported by " + nameOf(x.reported_by), ago(x.reported_at)].filter(Boolean).join(" · ")) +
        (x.stops_operation && openDef(x) ? ' · <span class="exp">vessel must not operate</span>' : "") + '</small></span>' + chip(x.severity, "st-sev-" + slug(x.severity)) + chip(x.status, "st-def-" + slug(x.status)) + '</a></li>';
    }).join("") + '</ul>';
  }
  function defList() {
    var f = { open: openDef, critical: function (x) { return openDef(x) && (x.severity === "Critical" || x.stops_operation); }, repaired: function (x) { return x.status === "Repaired"; }, closed: function (x) { return x.status === "Closed"; }, all: function () { return true; } };
    var list = d.defects.filter(f[defFilter] || f.open);
    return '<section class="dash-card"><div class="card-head"><div><h2>Defects & breakdowns</h2><p class="note">Anyone can report a problem. Critical defects can take the vessel out of service until it is repaired and released.</p></div>' + (d.vessels.length ? '<button type="button" class="save" data-defnew="">' + icon(I.alert) + ' Report a defect</button>' : "") + '</div>' +
      '<div class="stage-pills">' + [["open", "Open"], ["critical", "Critical"], ["repaired", "Repaired"], ["closed", "Closed"], ["all", "All"]].map(function (t) {
        return '<button type="button" class="pill-btn' + (defFilter === t[0] ? " on" : "") + '" data-deff="' + t[0] + '">' + t[1] + '<b>' + d.defects.filter(f[t[0]]).length + '</b></button>'; }).join("") + '</div>' +
      (list.length ? defRows(list) : empty("No defects here.")) + '</section>';
  }
  function defView(id) {
    var x = d.defects.filter(function (z) { return z.id === id; })[0]; if (!x) return '<section class="dash-card">' + empty('Defect not found. <a href="#defects">Back</a>') + '</section>';
    var v = vessel(x.vessel_id), c = x.component_id ? comp(x.component_id) : null, w = x.work_order_id ? d.wos.filter(function (z) { return z.id === x.work_order_id; })[0] : null;
    var kv = function (rows) { return '<dl class="kv">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + (r[1] === "" || r[1] == null ? '<span class="muted-cell">—</span>' : r[1]) + '</dd></div>'; }).join("") + '</dl>'; };
    return '<section class="dash-card prof-head"><a class="back" href="#defects">' + icon(I.back) + 'Defects</a><div class="card-head"><div><h2>D-' + x.number + ' · ' + esc(x.title) + '</h2><p class="note">' + esc([v ? v.name : "", c ? c.name : "", x.kind, x.category].filter(Boolean).join(" · ")) + ' · ' + (x.source === "Inspection" ? "from an inspection" : "reported by " + esc(nameOf(x.reported_by))) + ' · ' + when(x.reported_at) + '</p></div>' +
      '<span class="prof-chips">' + chip(x.severity, "st-sev-" + slug(x.severity)) + chip(x.status, "st-def-" + slug(x.status)) + (x.safety ? chip("Safety", "st-absent") : "") + '</span></div>' +
      (x.stops_operation && openDef(x) ? '<p class="msg err">' + esc(v ? v.name : "The vessel") + ' must not operate until this is repaired and the vessel is returned to service.</p>' : "") +
      (isMaint ? '<div class="att-toolbar">' + (w ? '<a class="btn-soft" href="#workorders/' + w.id + '">' + esc(w.code) + ' · ' + esc(w.status) + '</a>' : '<button type="button" class="save" id="dfWo">Create work order</button>') + '<button type="button" class="ghost" id="dfEdit">Update</button>' +
        (x.status === "Repaired" ? '<button type="button" class="ghost" id="dfClose">Close</button>' : "") + (v && v.status !== "Operational" && !openDef(x) ? '<a class="ghost" href="#vessel/' + v.id + '">Return ' + esc(v.name) + ' to service →</a>' : "") + '</div>' : "") + '<p class="msg" id="mMsgInline" role="status"></p></section>' +
      '<div class="hr-grid"><div class="col"><section class="dash-card"><h2>Details</h2>' + kv([["Symptoms", esc(x.symptoms || "")], ["Fault code", esc(x.fault_code || "")], ["Stops operation", x.stops_operation ? "Yes" : "No"], ["Repair by", esc(x.assigned_to ? nameOf(x.assigned_to) : "")],
        ["Temporary measure", esc(x.temporary_measure || "")], ["Final repair", esc(x.final_repair || "")], ["Repaired", x.repaired_at ? when(x.repaired_at) : ""], ["Closed", x.closed_at ? when(x.closed_at) : ""]]) + '</section></div>' +
      '<div class="col"><section class="dash-card"><h2>Photos & videos</h2><p class="note">Add photos of the fault, readings or error screens.</p>' + filesBlock("defect", id, cache["f:defect:" + id], x.vessel_id) + '</section></div></div>';
  }
  function openDefect(vesselId) {
    var cats = listSetting("10_defect_categories", "Defect Categories"), compsOf = function (vid) { return d.comps.filter(function (c) { return c.vessel_id === vid && c.status === "In service"; }); };
    var me = d.people[ctx.me], mine = me && me.vessel ? d.vessels.filter(function (v) { return v.code.toLowerCase() === me.vessel.toLowerCase() || v.name.toLowerCase() === me.vessel.toLowerCase(); })[0] : null;
    var vid = vesselId || (mine && mine.id) || (d.vessels[0] || {}).id;
    var needPhoto = !!docReqs().photoDefect;
    openModal('<h2>Report a defect</h2><p class="note">Maintenance gets a notification straight away.' + (needPhoto ? " Critical reports need a photo or video (Document Requirements)." : "") + '</p><div class="cards">' +
      '<div class="fld"><label for="fVessel">Vessel</label><select id="fVessel">' + options(d.vessels.map(function (v) { return [v.id, v.name]; }), vid) + '</select></div>' +
      '<div class="fld"><label for="fComp">Engine or part</label><select id="fComp">' + options(compsOf(vid).map(function (c) { return [c.id, c.name]; }), "", "Not sure / whole vessel") + '</select></div>' +
      '<div class="fld"><label for="fKind">What happened</label><select id="fKind">' + options([["Defect", "A defect or fault"], ["Breakdown", "A breakdown"]], "Defect") + '</select></div>' +
      '<div class="fld"><label for="fCat">Category</label><select id="fCat">' + options(cats, "", "Choose…") + '</select></div></div>' +
      '<div class="fld"><label for="fTitle">What is wrong?</label><input id="fTitle" maxlength="120" placeholder="e.g. Port engine overheating at cruise speed"></div>' +
      '<div class="fld"><label for="fSym">Symptoms</label><textarea id="fSym" rows="3" maxlength="2000" placeholder="What you saw, heard or smelled; readings; when it started"></textarea></div>' +
      '<div class="cards"><div class="fld"><label for="fCode">Fault or alarm code</label><input id="fCode" maxlength="60"></div><div class="fld"><label for="fSev">Severity</label><select id="fSev">' + options([["Minor", "Minor: can wait for the next service"], ["Major", "Major: fix soon"], ["Critical", "Critical: unsafe or cannot sail"]], "Minor") + '</select></div></div>' +
      '<label class="chk"><input type="checkbox" id="fSafe"> Affects safety</label> <label class="chk"><input type="checkbox" id="fStop"> The vessel must not operate until this is fixed</label>' +
      '<div class="fld" style="margin-top:10px"><label for="fTemp">Temporary measure taken (optional)</label><input id="fTemp" maxlength="1000"></div>' +
      '<div class="fld"><label for="fFile">Photo or video' + (needPhoto ? ' <span id="fFileNeed">(required for Critical)</span>' : " (optional)") + '</label><input id="fFile" type="file" accept="image/*,video/*" capture="environment"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="fGo">Send report</button></div>', true);
    $("fVessel").addEventListener("change", function () { $("fComp").innerHTML = options(compsOf(this.value).map(function (c) { return [c.id, c.name]; }), "", "Not sure / whole vessel"); });
    $("fSev").addEventListener("change", function () { if (this.value === "Critical") $("fStop").checked = true; });
    $("fGo").addEventListener("click", function () {
      var row = { title: $("fTitle").value.trim(), component_id: $("fComp").value || null, kind: $("fKind").value, category: $("fCat").value || null, symptoms: $("fSym").value.trim() || null, fault_code: $("fCode").value.trim() || null,
        severity: $("fSev").value, safety: $("fSafe").checked, stops_operation: $("fStop").checked, temporary_measure: $("fTemp").value.trim() || null };
      if (row.title.length < 3) { say("Say in a few words what is wrong.", "err"); return; }
      var file = $("fFile").files[0];
      if (needPhoto && row.severity === "Critical" && !file) { say("Add a photo or video for a Critical defect (Maintenance Settings → Document Requirements).", "err"); return; }
      if (row.stops_operation && !confirm("This takes " + vessel($("fVessel").value).name + " out of service until it is repaired and returned to service. Send?")) return;
      say("Sending…"); var vsl = $("fVessel").value;
      rpc("report_defect", { p_company: company.id, p_vessel: vsl, p_row: row }).then(function (x) {
        return (file ? uploadFile("defect", x.id, vsl, file) : Promise.resolve()).then(function () { closeModal(); location.hash = "#defects/" + x.id; return reload(); });
      }).catch(function (e) { say(e.message, "err"); });
    });
  }
  function openDefectEdit(id) {
    var x = d.defects.filter(function (z) { return z.id === id; })[0];
    openModal('<h2>Update D-' + x.number + '</h2><div class="cards"><div class="fld"><label for="eSt">Status</label><select id="eSt">' + options(["Open", "Temporary fix", "Repaired", "Closed"], x.status) + '</select></div>' +
      '<div class="fld"><label for="eSev">Severity</label><select id="eSev">' + options(["Minor", "Major", "Critical"], x.severity) + '</select></div>' +
      '<div class="fld"><label for="eWho">Repair by</label><select id="eWho">' + options(staffList().map(function (p) { return [p.uid, p.name]; }), x.assigned_to || "", "Nobody yet") + '</select></div></div>' +
      '<label class="chk"><input type="checkbox" id="eStop"' + (x.stops_operation ? " checked" : "") + '> The vessel must not operate until this is fixed</label>' +
      '<div class="fld" style="margin-top:10px"><label for="eTemp">Temporary measure</label><textarea id="eTemp" rows="2" maxlength="1000">' + esc(x.temporary_measure || "") + '</textarea></div>' +
      '<div class="fld"><label for="eFix">Final repair</label><textarea id="eFix" rows="3" maxlength="2000">' + esc(x.final_repair || "") + '</textarea></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="eGo">Save</button></div>', true);
    $("eGo").addEventListener("click", function () {
      var row = { status: $("eSt").value, severity: $("eSev").value, assigned_to: $("eWho").value || null, stops_operation: $("eStop").checked, temporary_measure: $("eTemp").value.trim() || null, final_repair: $("eFix").value.trim() || null };
      if ((row.status === "Repaired" || row.status === "Closed") && !row.final_repair) { say("Describe the final repair first.", "err"); return; }
      db.from("defects").update(row).eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
    });
  }

  /* ---------- inspections ---------- */
  function inspRows(list) {
    return '<ul class="rows it-tks">' + list.map(function (x) {
      var v = vessel(x.vessel_id);
      return '<li class="row"><a class="it-tk" href="#inspections/' + x.id + '"><span class="grow"><strong>' + esc(x.name) + '</strong><small>' + esc([v ? v.name : "", x.kind, nameOf(x.submitted_by), when(x.submitted_at)].filter(Boolean).join(" · ")) + '</small></span>' +
        (x.failed ? chip(x.failed + " failed", "st-absent") : chip("All passed", "st-present")) + '</a></li>';
    }).join("") + '</ul>';
  }
  function inspList() {
    var cls = d.checklists.filter(function (c) { return c.active || isMaint; });
    return '<section class="dash-card"><div class="card-head"><div><h2>Start an inspection</h2><p class="note">Pick the vessel and checklist, then mark each item OK, Fail or N/A. Failed items become defects for maintenance.</p></div></div>' +
      (d.vessels.length && cls.filter(function (c) { return c.active; }).length ? '<div class="att-toolbar"><select id="iVessel" aria-label="Vessel">' + options(d.vessels.map(function (v) { return [v.id, v.name]; }), cache.iVessel || "") + '</select>' +
        '<select id="iList" aria-label="Checklist">' + options(cls.filter(function (c) { return c.active; }).map(function (c) { return [c.id, c.name + " · " + c.kind]; }), cache.iList || "") + '</select><button type="button" class="save" id="iStart">Start</button></div><div id="iForm"></div>' :
        empty(!d.vessels.length ? "Add vessels first." : "No checklists yet." + (isMaint ? " Add one below." : " Ask maintenance to set them up."))) + '</section>' +
      '<section class="dash-card"><div class="card-head"><div><h2>Checklists</h2><p class="note">Start a line with ! to mark a critical item: if it fails, the vessel goes out of service.</p></div>' + (isMaint ? '<button type="button" class="ghost" id="clAdd">' + icon(I.plus) + ' Add checklist</button>' : "") + '</div>' +
        (cls.length ? '<ul class="rows">' + cls.map(function (c) { return '<li class="row"><span class="grow"><strong>' + esc(c.name) + (c.active ? "" : ' <span class="chip st-off-duty">Off</span>') + '</strong><small>' + esc(c.kind) + ' · ' + c.items.length + ' items' + (c.items.filter(function (i) { return i.critical; }).length ? " · " + c.items.filter(function (i) { return i.critical; }).length + " critical" : "") + '</small></span>' + (isMaint ? '<button type="button" class="ghost manage-btn" data-cledit="' + c.id + '">Edit</button>' : "") + '</li>'; }).join("") + '</ul>' : empty("No checklists yet.")) + '</section>' +
      '<section class="dash-card"><h2>Recent inspections</h2>' + (d.inspections.length ? inspRows(d.inspections.slice(0, 30)) : empty("No inspections submitted yet.")) + '</section>';
  }
  function inspForm(cl) {
    var groups = {}; cl.items.forEach(function (it, i) { (groups[it.area || "General"] = groups[it.area || "General"] || []).push([it, i]); });
    return '<div class="mt-insp">' + Object.keys(groups).map(function (g) {
      return '<h3>' + esc(g) + '</h3>' + groups[g].map(function (p) {
        var it = p[0], i = p[1];
        return '<div class="mt-item" data-item="' + i + '"><span class="grow">' + esc(it.text) + (it.critical ? ' <span class="chip st-absent">Critical</span>' : "") + '</span><span class="mt-seg" role="radiogroup" aria-label="' + esc(it.text) + '">' +
          [["ok", "OK"], ["fail", "Fail"], ["na", "N/A"]].map(function (o) { return '<button type="button" role="radio" aria-checked="false" data-res="' + o[0] + '">' + o[1] + '</button>'; }).join("") + '</span><input class="mt-note" placeholder="Note (what is wrong?)" maxlength="300" hidden></div>';
      }).join("");
    }).join("") + '<div class="fld" style="margin-top:12px"><label for="iNote">General note</label><input id="iNote" maxlength="1000"></div><div class="att-toolbar"><span class="muted-cell" id="iCount"></span><button type="button" class="save" id="iSubmit">Submit inspection</button></div><p class="msg" id="mMsgInline" role="status"></p></div>';
  }
  function inspView(id) {
    var x = d.inspections.filter(function (z) { return z.id === id; })[0]; if (!x) return '<section class="dash-card">' + empty('Inspection not found. <a href="#inspections">Back</a>') + '</section>';
    var res = cache["i:" + id];
    if (!res) { db.from("maint_inspections").select("results, note").eq("id", id).single().then(function (r) { cache["i:" + id] = r.data || { results: [] }; var rt = route(); if (rt.view === "inspections" && rt.id === id) render(); }); }
    var v = vessel(x.vessel_id), defs = d.defects.filter(function (z) { return z.inspection_id === id; });
    return '<section class="dash-card prof-head"><a class="back" href="#inspections">' + icon(I.back) + 'Inspections</a><h2>' + esc(x.name) + ' · ' + esc(v ? v.name : "") + '</h2><p class="note">' + esc(x.kind) + ' · by ' + esc(nameOf(x.submitted_by)) + ' · ' + when(x.submitted_at) + '</p>' +
      (x.failed ? '<p class="msg err">' + x.failed + ' item' + (x.failed > 1 ? "s" : "") + ' failed and became defect' + (x.failed > 1 ? "s" : "") + ': ' + defs.map(function (z) { return '<a href="#defects/' + z.id + '">D-' + z.number + '</a>'; }).join(", ") + '</p>' : '<p class="msg ok">Every item passed.</p>') + '</section>' +
      '<section class="dash-card">' + (res ? '<ul class="rows">' + (res.results || []).map(function (r) { return '<li class="row"><span class="grow"><strong>' + esc(r.text) + '</strong><small>' + esc(r.area || "") + (r.note ? " · " + esc(r.note) : "") + '</small></span>' + chip(r.result === "ok" ? "OK" : r.result === "fail" ? "Failed" : "N/A", r.result === "ok" ? "st-present" : r.result === "fail" ? "st-absent" : "st-off-duty") + '</li>'; }).join("") + '</ul>' + (res.note ? '<p class="hint">' + esc(res.note) + '</p>' : "") : '<p class="msg">Loading…</p>') + '</section>';
  }
  var CL_TEMPLATES = {
    "Pre-departure": "Engine room\n!Engine oil level\n!Coolant level\nRaw-water strainers clear\nBelts and hoses\nBilge\n!Bilge dry, pumps working\nSteering\n!Steering moves freely\nSafety\n!Life jackets on board and counted\nFire extinguishers in date\nNavigation lights working\nRadio check done",
    "Daily": "Engine room\nOil and coolant checked\nNo leaks under engines\nFuel filter water trap drained\nDeck\nMooring lines condition\nHull and deck clean, no damage\nSafety\nFirst aid kit complete",
    "Post-arrival": "Engine room\nAny alarms during the trip recorded\nEngine hours logged\nBilge checked after shutdown\nDeck\nVessel secured and fenders out\nCabin\nCabin clean, nothing left behind"
  };
  function openChecklist(id) {
    var c = id ? d.checklists.filter(function (x) { return x.id === id; })[0] : { name: "", kind: "Pre-departure", items: [], active: true };
    var text = c.items.length ? (function () { var out = [], last = null; c.items.forEach(function (it) { if ((it.area || "General") !== last) { last = it.area || "General"; out.push(last); } out.push((it.critical ? "!" : "") + it.text); }); return out.join("\n"); })() : CL_TEMPLATES[c.kind] || "";
    openModal('<h2>' + (id ? "Edit checklist" : "New checklist") + '</h2><div class="cards"><div class="fld"><label for="cName">Name</label><input id="cName" maxlength="80" value="' + esc(c.name) + '" placeholder="e.g. Pre-departure check"></div>' +
      '<div class="fld"><label for="cKind">When</label><select id="cKind">' + options(["Daily", "Weekly", "Monthly", "Pre-departure", "Post-arrival", "Periodic"], c.kind) + '</select></div></div>' +
      '<div class="fld"><label for="cItems">Items</label><textarea id="cItems" rows="14">' + esc(text) + '</textarea><small class="hint">One item per line. A line that is just a section name (Engine room, Deck, Bilge, Steering, Electrical, Safety, Navigation, Cabin, Hull, Fuel, Bridge) starts a section. Start an item with ! if failing it must stop the vessel.</small></div>' +
      '<label class="chk"><input type="checkbox" id="cOn"' + (c.active ? " checked" : "") + '> Checklist is in use</label><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' + (id ? '<button type="button" class="ghost danger" id="cDel">Remove</button>' : "") + '<button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="cGo">Save</button></div>', true);
    $("cKind").addEventListener("change", function () { if (!id && !$("cItems").value.trim() || (!id && Object.keys(CL_TEMPLATES).some(function (k) { return CL_TEMPLATES[k] === $("cItems").value; }))) $("cItems").value = CL_TEMPLATES[this.value] || ""; });
    $("cGo").addEventListener("click", function () {
      // Sections are the known area words; everything else is an item.
      var AREAS = /^(engine room|engines?|deck|bilge|steering|electrical|safety|navigation|cabin|hull|fuel|general|bridge|exterior|interior)$/i, area = "General", items = [];
      $("cItems").value.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean).forEach(function (l) {
        if (AREAS.test(l)) { area = l.charAt(0).toUpperCase() + l.slice(1); return; }
        var crit = l.charAt(0) === "!"; items.push({ text: (crit ? l.slice(1) : l).trim(), area: area, critical: crit });
      });
      var row = { name: $("cName").value.trim(), kind: $("cKind").value, items: items, active: $("cOn").checked };
      if (row.name.length < 2) { say("Name the checklist.", "err"); return; }
      if (!items.length) { say("Add at least one item.", "err"); return; }
      var q = id ? db.from("maint_checklists").update(row).eq("id", id) : db.from("maint_checklists").insert(Object.assign(row, { company_id: company.id }));
      q.then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
    });
    if ($("cDel")) $("cDel").addEventListener("click", function () { if (!confirm("Remove this checklist? Submitted inspections are kept.")) return; db.from("maint_checklists").delete().eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } }); });
  }

  /* ---------- spare parts ---------- */
  function num(n) { return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function part(id) { return d.parts.filter(function (p) { return p.id === id; })[0]; }
  function supplier(id) { return d.suppliers.filter(function (s) { return s.id === id; })[0]; }
  function stockOf(id) { return d.stock.filter(function (s) { return s.part_id === id && Number(s.qty) !== 0; }); }
  function totalOf(id) { return stockOf(id).reduce(function (a, s) { return a + Number(s.qty); }, 0); }
  function onOrder(id) {
    return d.pos.filter(function (o) { return ["Draft", "Ordered", "Part delivered"].indexOf(o.status) > -1; }).reduce(function (a, o) {
      return a + (o.lines || []).filter(function (l) { return l.part_id === id; }).reduce(function (b, l) { return b + Number(l.qty) - Number(l.received || 0); }, 0); }, 0);
  }
  function partState(p) {
    var t = totalOf(p.id), m = Number(p.min_stock);
    if (m > 0 && t <= 0) return { k: "out", label: "Out of stock", cls: "st-absent" };
    if (m > 0 && t <= m) return { k: "low", label: "Low stock", cls: "st-late" };
    if (t <= 0) return { k: "none", label: "None in store", cls: "st-off-duty" };
    return { k: "ok", label: "In stock", cls: "st-present" };
  }
  function locations() {
    var out = [];
    d.parts.forEach(function (p) { if (p.location) out.push(p.location); }); d.stock.forEach(function (s) { out.push(s.location); }); d.pos.forEach(function (o) { if (o.deliver_to) out.push(o.deliver_to); });
    out = out.filter(function (x, i) { return out.indexOf(x) === i; }).sort();
    return out.length ? out : ["Main store"];
  }
  function fitsText(p) {
    return [p.fits_kinds && p.fits_kinds.length ? p.fits_kinds.join(", ") : "", (p.fits_vessels || []).map(function (id) { var v = vessel(id); return v ? v.name : ""; }).filter(Boolean).join(", "), p.fits_note || ""].filter(Boolean).join(" · ");
  }
  function partsView() {
    var list = d.parts.filter(function (p) { var s = partState(p); return partFilter === "all" ? true : partFilter === "off" ? !p.active : p.active && (partFilter === "low" ? s.k === "low" || s.k === "out" : partFilter === "active"); });
    var act = d.parts.filter(function (p) { return p.active; }), low = act.filter(function (p) { var k = partState(p).k; return k === "low" || k === "out"; });
    var value = d.stock.reduce(function (a, s) { var p = part(s.part_id); return a + (p ? Number(s.qty) * Number(p.price) : 0); }, 0);
    var openPo = d.pos.filter(function (o) { return o.status === "Ordered" || o.status === "Part delivered"; });
    return '<div class="kpis">' + kpi("blue", I.box, "Parts in the catalogue", act.length, d.parts.length - act.length + " not in use") + kpi("orange", I.alert, "Low or out of stock", low.length, low.length ? "At or below the minimum" : "All above the minimum") +
      kpi("teal", I.coins, "Stock value", money(value), locations().length + " store location" + (locations().length > 1 ? "s" : "")) + kpi("purple", I.truck, "On order", openPo.length, "purchase order" + (openPo.length === 1 ? "" : "s") + " not delivered", isMaint ? "#purchasing" : "") + '</div>' +
      '<section class="dash-card"><div class="card-head"><div><h2>Spare parts</h2><p class="note">Every part with how many are in each store. Parts taken for a job are issued on the work order, so stock and the job\'s parts cost stay right.</p></div>' +
        (isMaint ? '<span class="prof-actions"><a class="ghost" href="#purchasing">Purchasing</a><button type="button" class="save" id="ptAdd">' + icon(I.plus) + ' Add part</button></span>' : "") + '</div>' +
      '<div class="stage-pills">' + [["active", "In use", act.length], ["low", "Low stock", low.length], ["off", "Not in use", d.parts.length - act.length], ["all", "All", d.parts.length]].map(function (t) {
        return '<button type="button" class="pill-btn' + (partFilter === t[0] ? " on" : "") + '" data-ptf="' + t[0] + '">' + t[1] + '<b>' + t[2] + '</b></button>'; }).join("") + '</div>' +
      (d.parts.length ? '<div class="filters wrap"><label class="fsearch">' + icon(I.search) + '<input id="ptSearch" type="search" placeholder="Search part number, name, make or what it fits" aria-label="Search parts"></label></div>' : "") +
      (list.length ? '<div class="dtable-wrap"><table class="dtable" id="ptTable"><thead><tr><th>Part</th><th>Fits</th><th>In store</th><th>Minimum</th><th>Price</th><th>Status</th></tr></thead><tbody>' + list.map(function (p) {
        var s = partState(p), st = stockOf(p.id), oo = onOrder(p.id);
        return '<tr data-q="' + esc([p.part_no, p.name, p.make, p.category, fitsText(p)].join(" ").toLowerCase()) + '"' + (p.active ? "" : ' class="mt-off"') + '><td><a href="#part/' + p.id + '"><strong>' + esc(p.part_no) + '</strong></a> ' + esc(p.name) + '<span class="th-sub">' + esc([p.category, p.make].filter(Boolean).join(" · ")) + '</span></td>' +
          '<td class="muted-cell">' + esc(fitsText(p) || "—") + '</td>' +
          '<td><strong>' + num(totalOf(p.id)) + ' ' + esc(p.unit) + '</strong><span class="th-sub">' + esc(st.map(function (x) { return x.location + " " + num(x.qty); }).join(" · ") || "Nothing in store") + (oo > 0 ? " · " + num(oo) + " on order" : "") + '</span></td>' +
          '<td class="muted-cell">' + (Number(p.min_stock) ? num(p.min_stock) : "—") + '</td><td class="muted-cell">' + money(p.price) + '</td><td>' + chip(s.label, s.cls) + '</td></tr>';
      }).join("") + '</tbody></table></div>' : empty(d.parts.length ? "No parts here." : "No spare parts yet." + (isMaint ? " Add the filters, impellers, belts and oils you keep in the store." : " Maintenance adds them."))) + '</section>';
  }
  function partView(id) {
    var p = part(id); if (!p) return '<section class="dash-card">' + empty('Part not found. <a href="#parts">Back to spare parts</a>') + '</section>';
    var s = partState(p), st = stockOf(id), sup = p.supplier_id ? supplier(p.supplier_id) : null, ex = cache["p:" + id];
    var kv = function (rows) { return '<dl class="kv">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + (r[1] === "" || r[1] == null ? '<span class="muted-cell">—</span>' : r[1]) + '</dd></div>'; }).join("") + '</dl>'; };
    var pend = d.prs.filter(function (r) { return ["Waiting", "Approved"].indexOf(r.status) > -1 && (r.lines || []).some(function (l) { return l.part_id === id; }); });
    return '<section class="dash-card prof-head"><a class="back" href="#parts">' + icon(I.back) + 'Spare parts</a><div class="card-head"><div><h2>' + esc(p.part_no) + ' · ' + esc(p.name) + '</h2><p class="note">' + esc([p.category, p.make, p.unit].filter(Boolean).join(" · ")) + '</p></div>' +
      '<span class="prof-chips">' + chip(s.label, s.cls) + (p.active ? "" : chip("Not in use", "st-off-duty")) + '</span></div>' +
      (isMaint ? '<div class="att-toolbar"><button type="button" class="save" data-stock="Received">' + icon(I.plus) + ' Add stock</button><button type="button" class="ghost" data-stock="Adjusted">Correct the count</button>' + (st.length ? '<button type="button" class="ghost" data-stock="Transfer">Move between stores</button>' : "") +
        '<button type="button" class="ghost" id="ptBuy">Ask to buy</button><button type="button" class="ghost" id="ptEdit">Edit</button></div>' : "") +
      (pend.length ? '<p class="hint">Already asked for on ' + pend.map(function (r) { return '<a href="#pr/' + r.id + '">' + esc(r.code) + '</a> (' + esc(r.status.toLowerCase()) + ')'; }).join(", ") + '</p>' : "") + '</section>' +
      '<div class="hr-grid"><div class="col"><section class="dash-card"><h2>In store</h2>' +
        (st.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Location</th><th>Quantity</th><th>Value</th></tr></thead><tbody>' + st.map(function (x) { return '<tr><td>' + esc(x.location) + '</td><td><strong>' + num(x.qty) + ' ' + esc(p.unit) + '</strong></td><td class="muted-cell">' + money(Number(x.qty) * Number(p.price)) + '</td></tr>'; }).join("") +
          '<tr><td><strong>Total</strong></td><td><strong>' + num(totalOf(id)) + ' ' + esc(p.unit) + '</strong></td><td class="muted-cell">' + money(totalOf(id) * Number(p.price)) + '</td></tr></tbody></table></div>' : empty("Nothing in store.")) +
        (onOrder(id) > 0 ? '<p class="hint">' + num(onOrder(id)) + ' ' + esc(p.unit) + ' on order.</p>' : "") + '</section>' +
        '<section class="dash-card"><h2>Movements</h2>' + (ex ? (ex.moves.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>When</th><th>What</th><th>Quantity</th><th>Where</th></tr></thead><tbody>' + ex.moves.map(function (m) {
          var w = m.work_order_id ? d.wos.filter(function (x) { return x.id === m.work_order_id; })[0] : null, o = m.po_id ? d.pos.filter(function (x) { return x.id === m.po_id; })[0] : null;
          return '<tr><td class="muted-cell">' + when(m.created_at) + '<span class="th-sub">' + esc(nameOf(m.actor)) + '</span></td><td>' + esc(MOVE_LABEL[m.kind] || m.kind) + (w ? ' <a href="#workorders/' + w.id + '">' + esc(w.code) + '</a>' : "") + (o ? ' <a href="#po/' + o.id + '">' + esc(o.code) + '</a>' : "") + (m.note ? '<span class="th-sub">' + esc(m.note) + '</span>' : "") + '</td>' +
            '<td><strong class="' + (Number(m.qty) < 0 ? "mt-neg" : "mt-pos") + '">' + (Number(m.qty) > 0 ? "+" : "") + num(m.qty) + '</strong></td><td class="muted-cell">' + esc(m.location) + '</td></tr>';
        }).join("") + '</tbody></table></div>' : empty("No movements yet.")) : '<p class="msg">Loading…</p>') + '</section></div>' +
      '<div class="col"><section class="dash-card"><h2>Details</h2>' + kv([["Fits", esc(fitsText(p))], ["Minimum stock", Number(p.min_stock) ? num(p.min_stock) + " " + esc(p.unit) + " (alert at or below)" : "No minimum"], ["Usual order", p.reorder_qty ? num(p.reorder_qty) + " " + esc(p.unit) : ""],
        ["Usual store", esc(p.location || "")], ["Supplier", sup ? esc(sup.name) : ""], ["Price", money(p.price) + " per " + esc(p.unit.toLowerCase())], ["Notes", esc(p.note || "")]]) + '</section>' +
        '<section class="dash-card"><h2>Photos & data sheets</h2>' + filesBlock("part", id, cache["f:part:" + id]) + '</section></div></div>';
  }
  var MOVE_LABEL = { Opening: "Opening stock", Received: "Received", Issued: "Issued to", Returned: "Returned from", Adjusted: "Count corrected", Transfer: "Moved" };
  function loadPartMoves(id) {
    if (cache["p:" + id]) return;
    cache["p:" + id] = null;
    db.from("stock_moves").select("*").eq("part_id", id).order("created_at", { ascending: false }).limit(200).then(function (r) {
      cache["p:" + id] = { moves: r.data || [] }; var rt = route(); if (rt.view === "part" && rt.id === id) render();
    });
  }
  function openPart(id) {
    var p = id ? part(id) : { unit: listSetting("10_units_of_measurement", "Units of Measurement")[0] || "Each", active: true, min_stock: 0, price: 0, fits_vessels: [], fits_kinds: [] };
    var cats = listSetting("10_spare_parts_categories", "Spare Parts Categories"), units = listSetting("10_units_of_measurement", "Units of Measurement");
    if (p.unit && units.indexOf(p.unit) < 0) units = units.concat([p.unit]);
    openModal('<h2>' + (id ? "Edit part" : "Add a spare part") + '</h2><div class="cards">' +
      '<div class="fld"><label for="qNo">Part number</label><input id="qNo" maxlength="60" value="' + esc(p.part_no || "") + '" placeholder="e.g. 6CE-WS24A-00"></div>' +
      '<div class="fld"><label for="qName">Description</label><input id="qName" maxlength="160" value="' + esc(p.name || "") + '" placeholder="e.g. Fuel filter, water separating"></div>' +
      '<div class="fld"><label for="qCat">Category</label><select id="qCat">' + options(cats, p.category || "", "None") + '</select></div>' +
      '<div class="fld"><label for="qUnit">Unit</label><select id="qUnit">' + options(units, p.unit) + '</select></div>' +
      '<div class="fld"><label for="qMake">Make</label><input id="qMake" maxlength="80" value="' + esc(p.make || "") + '" placeholder="e.g. Yamaha"></div>' +
      '<div class="fld"><label for="qPrice">Price per unit</label><input id="qPrice" type="number" min="0" step="0.01" value="' + Number(p.price || 0) + '"></div>' +
      '<div class="fld"><label for="qMin">Minimum stock</label><input id="qMin" type="number" min="0" step="any" value="' + Number(p.min_stock || 0) + '"><small class="hint">Maintenance is alerted when stock falls to this.</small></div>' +
      '<div class="fld"><label for="qRe">Usual order quantity</label><input id="qRe" type="number" min="0" step="any" value="' + (p.reorder_qty || "") + '"></div>' +
      '<div class="fld"><label for="qLoc">Usual store location</label><input id="qLoc" list="qLocs" maxlength="80" value="' + esc(p.location || "") + '" placeholder="e.g. Main store, shelf B2"><datalist id="qLocs">' + locations().map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist></div>' +
      '<div class="fld"><label for="qSup">Supplier</label><select id="qSup">' + options(d.suppliers.filter(function (s) { return s.active || s.id === p.supplier_id; }).map(function (s) { return [s.id, s.name]; }), p.supplier_id || "", "None") + '</select></div></div>' +
      '<div class="fld"><span class="lbl">Fits these engines or components</span><div class="mt-checks">' + COMP_KINDS.map(function (k) { return '<label class="chk"><input type="checkbox" data-fk value="' + esc(k) + '"' + ((p.fits_kinds || []).indexOf(k) > -1 ? " checked" : "") + '> ' + esc(k) + '</label>'; }).join("") + '</div></div>' +
      (d.vessels.length ? '<div class="fld"><span class="lbl">Fits these vessels (leave empty for any)</span><div class="mt-checks">' + d.vessels.map(function (v) { return '<label class="chk"><input type="checkbox" data-fv value="' + v.id + '"' + ((p.fits_vessels || []).indexOf(v.id) > -1 ? " checked" : "") + '> ' + esc(v.name) + '</label>'; }).join("") + '</div></div>' : "") +
      '<div class="fld"><label for="qFit">Also fits (models, notes)</label><input id="qFit" maxlength="300" value="' + esc(p.fits_note || "") + '" placeholder="e.g. Yamaha F250 / F300 outboards"></div>' +
      (id ? "" : '<div class="cards"><div class="fld"><label for="qOpen">Already in store (opening stock)</label><input id="qOpen" type="number" min="0" step="any" placeholder="0"></div></div>') +
      '<label class="chk"><input type="checkbox" id="qOn"' + (p.active ? " checked" : "") + '> In use</label><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' + (id ? '<button type="button" class="ghost danger" id="qDel">Remove</button>' : "") + '<button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="qGo">Save</button></div>', true);
    $("qGo").addEventListener("click", function () {
      var pick = function (sel) { return [].map.call(document.querySelectorAll(sel + ":checked"), function (x) { return x.value; }); };
      var row = { part_no: $("qNo").value.trim(), name: $("qName").value.trim(), category: $("qCat").value || null, unit: $("qUnit").value, make: $("qMake").value.trim() || null, price: Number($("qPrice").value || 0),
        min_stock: Number($("qMin").value || 0), reorder_qty: $("qRe").value ? Number($("qRe").value) : null, location: $("qLoc").value.trim() || null, supplier_id: $("qSup").value || null,
        fits_kinds: pick("[data-fk]"), fits_vessels: pick("[data-fv]"), fits_note: $("qFit").value.trim() || null, active: $("qOn").checked };
      if (!row.part_no || row.name.length < 2) { say("Enter the part number and a description.", "err"); return; }
      var open = $("qOpen") && $("qOpen").value ? Number($("qOpen").value) : 0;
      if (open > 0 && !row.location) { say("Say which store the opening stock is in.", "err"); return; }
      var q = id ? db.from("parts").update(row).eq("id", id).select().single() : db.from("parts").insert(Object.assign(row, { company_id: company.id })).select().single();
      q.then(function (r) {
        if (r.error) { say(/duplicate/.test(r.error.message) ? "Another part already has that part number." : r.error.message, "err"); return; }
        return (open > 0 ? rpc("adjust_stock", { p_part: r.data.id, p_location: row.location, p_qty: open, p_kind: "Opening", p_note: null, p_to: null }) : Promise.resolve()).then(function () { closeModal(); if (!id) location.hash = "#part/" + r.data.id; return reload(); });
      }).catch(function (e) { say(e.message, "err"); });
    });
    if ($("qDel")) $("qDel").addEventListener("click", function () { if (!confirm("Remove " + p.part_no + " and its stock history? To keep the history, untick In use instead.")) return; db.from("parts").delete().eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); location.hash = "#parts"; reload(); } }); });
  }
  function openStock(id, kind) {
    var p = part(id), st = stockOf(id), locs = locations();
    var t = { Received: ["Add stock", "Parts that came in without a purchase order, or opening stock."], Adjusted: ["Correct the count", "After counting the shelf, enter what is really there."], Transfer: ["Move between stores", "e.g. from the main store to a vessel's spares locker."] }[kind];
    openModal('<h2>' + t[0] + ': ' + esc(p.part_no) + '</h2><p class="note">' + t[1] + ' Now ' + num(totalOf(id)) + ' ' + esc(p.unit) + ' in store.</p><div class="cards">' +
      '<div class="fld"><label for="kLoc">' + (kind === "Transfer" ? "From" : "Store location") + '</label>' + (kind === "Transfer" ? '<select id="kLoc">' + options(st.map(function (x) { return [x.location, x.location + " (" + num(x.qty) + ")"]; }), st[0] && st[0].location) + '</select>' :
        '<input id="kLoc" list="kLocs" maxlength="80" value="' + esc(p.location || (st[0] && st[0].location) || locs[0]) + '"><datalist id="kLocs">' + locs.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist>') + '</div>' +
      (kind === "Transfer" ? '<div class="fld"><label for="kTo">To</label><input id="kTo" list="kLocs" maxlength="80"><datalist id="kLocs">' + locs.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist></div>' : "") +
      '<div class="fld"><label for="kQty">' + (kind === "Adjusted" ? "Counted quantity" : "Quantity") + ' (' + esc(p.unit) + ')</label><input id="kQty" type="number" min="0" step="any"></div></div>' +
      '<div class="fld"><label for="kNote">' + (kind === "Adjusted" ? "Why it was different" : "Note (optional)") + '</label><input id="kNote" maxlength="300" placeholder="' + (kind === "Adjusted" ? "e.g. Monthly stock count" : "e.g. Bought locally in Malé") + '"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="kGo">Save</button></div>');
    $("kGo").addEventListener("click", function () {
      var loc = $("kLoc").value.trim(), q = $("kQty").value === "" ? null : Number($("kQty").value);
      if (!loc) { say("Choose the store location.", "err"); return; }
      if (q == null || q < 0 || (kind !== "Adjusted" && q === 0)) { say("Enter a quantity.", "err"); return; }
      if (kind === "Adjusted") { var have = (st.filter(function (x) { return x.location === loc; })[0] || { qty: 0 }).qty; q = q - Number(have); if (!q) { say("That is already the count in " + loc + ".", "err"); return; } }
      rpc("adjust_stock", { p_part: id, p_location: loc, p_qty: q, p_kind: kind, p_note: $("kNote").value.trim() || null, p_to: $("kTo") ? $("kTo").value.trim() : null }).then(function () { closeModal(); return reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }

  /* parts on a work order */
  function woPartsBlock(w, canWork) {
    var ex = cache["wp:" + w.id];
    if (!ex) return '<p class="msg">Loading…</p>';
    var net = {}; ex.moves.forEach(function (m) { if (m.kind !== "Issued" && m.kind !== "Returned") return; var n = net[m.part_id] = net[m.part_id] || { qty: 0, cost: 0 }; n.qty -= Number(m.qty); n.cost -= Number(m.qty) * Number(m.unit_cost); });
    var ids = Object.keys(net).filter(function (k) { return Math.abs(net[k].qty) > 1e-9; }), live = ["Completed", "Closed"].indexOf(w.status) < 0;
    var reqs = d.prs.filter(function (r) { return r.work_order_id === w.id; }), ords = d.pos.filter(function (o) { return o.work_order_id === w.id; });
    return (ids.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Part</th><th>Used</th><th>Cost</th><th></th></tr></thead><tbody>' + ids.map(function (k) {
        var p = part(k) || { part_no: "?", name: "Removed part", unit: "" };
        return '<tr><td><a href="#part/' + k + '"><strong>' + esc(p.part_no) + '</strong></a> ' + esc(p.name) + '</td><td>' + num(net[k].qty) + ' ' + esc(p.unit) + '</td><td class="muted-cell">' + money(net[k].cost) + '</td><td class="it-acts">' + (canWork && live ? '<button type="button" class="ghost manage-btn" data-wpret="' + k + '">Return unused</button>' : "") + '</td></tr>';
      }).join("") + '<tr><td><strong>Parts cost</strong></td><td></td><td><strong>' + money(ids.reduce(function (a, k) { return a + net[k].cost; }, 0)) + '</strong></td><td></td></tr></tbody></table></div>' : '<p class="hint">No parts taken from the store for this job yet.</p>') +
      (canWork && live ? '<div class="att-toolbar" style="margin-top:10px">' + (d.parts.length ? '<button type="button" class="save" id="wpIssue">' + icon(I.plus) + ' Take parts from the store</button>' : "") + '<button type="button" class="ghost" id="wpBuy">Ask to buy parts</button></div>' : "") +
      (reqs.length || ords.length ? '<ul class="rows it-tks">' + reqs.map(function (r) { return '<li class="row"><a class="it-tk" href="#pr/' + r.id + '"><span class="it-num mt-code">' + esc(r.code) + '</span><span class="grow"><strong>Purchase request</strong><small>' + esc(linesText(r.lines)) + '</small></span>' + chip(r.status, "st-pr-" + slug(r.status)) + '</a></li>'; }).join("") +
        ords.map(function (o) { return '<li class="row"><a class="it-tk" href="#po/' + o.id + '"><span class="it-num mt-code">' + esc(o.code) + '</span><span class="grow"><strong>Purchase order' + (o.supplier_id && supplier(o.supplier_id) ? " · " + esc(supplier(o.supplier_id).name) : "") + '</strong><small>' + esc(linesText(o.lines)) + (o.expected_on ? " · expected " + fmtDate(o.expected_on) : "") + '</small></span>' + chip(o.status, "st-po-" + slug(o.status)) + '</a></li>'; }).join("") + '</ul>' : "");
  }
  function loadWoParts(id) {
    if (cache["wp:" + id]) return;
    db.from("stock_moves").select("*").eq("work_order_id", id).order("created_at").then(function (r) { cache["wp:" + id] = { moves: r.data || [] }; var rt = route(); if (rt.view === "workorders" && rt.id === id) render(); });
  }
  function openIssue(w, returnPart) {
    var ex = cache["wp:" + w.id] || { moves: [] }, v = vessel(w.vessel_id), c = w.component_id ? comp(w.component_id) : null;
    var fits = function (p) { return (!p.fits_vessels.length || p.fits_vessels.indexOf(w.vessel_id) > -1) && (!c || !p.fits_kinds.length || p.fits_kinds.indexOf(c.kind) > -1); };
    var list = returnPart ? [part(returnPart)] : d.parts.filter(function (p) { return p.active; }).sort(function (a, b) { return (fits(b) - fits(a)) || a.part_no.localeCompare(b.part_no); });
    var out = function (pid) { return ex.moves.filter(function (m) { return m.part_id === pid && (m.kind === "Issued" || m.kind === "Returned"); }).reduce(function (a, m) { return a - Number(m.qty); }, 0); };
    var locsFor = function (pid) { return returnPart ? locations() : stockOf(pid).map(function (x) { return x.location; }); };
    openModal('<h2>' + (returnPart ? "Return unused parts" : "Take parts from the store") + '</h2><p class="note">' + esc(w.code) + ' · ' + esc([v ? v.name : "", c ? c.name : ""].filter(Boolean).join(" · ")) + '. ' + (returnPart ? "They go back into stock and come off the job's parts cost." : "Stock goes down and the parts cost on the job is worked out from the part price.") + '</p>' +
      '<div class="fld"><label for="iPart">Part</label><select id="iPart">' + list.map(function (p) { var t = totalOf(p.id); return '<option value="' + p.id + '"' + (!returnPart && t <= 0 ? " disabled" : "") + '>' + esc(p.part_no + " · " + p.name + " · " + (returnPart ? num(out(p.id)) + " " + p.unit + " on this job" : num(t) + " " + p.unit + " in store") + (fits(p) && !returnPart && (p.fits_vessels.length || p.fits_kinds.length) ? " · fits" : "")) + '</option>'; }).join("") + '</select>' +
        (returnPart ? "" : '<small class="hint">Parts that fit this vessel and component are listed first. Parts with nothing in store cannot be chosen.</small>') + '</div>' +
      '<div class="cards"><div class="fld"><label for="iLoc">' + (returnPart ? "Back into" : "From") + '</label>' + (returnPart ? '<input id="iLoc" list="iLocs" maxlength="80"><datalist id="iLocs">' + locations().map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist>' : '<select id="iLoc"></select>') + '</div>' +
      '<div class="fld"><label for="iQty">Quantity</label><input id="iQty" type="number" min="0" step="any" value="1"></div></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="iGo">' + (returnPart ? "Return to store" : "Issue to job") + '</button></div>');
    var fill = function () {
      var pid = $("iPart").value, p = part(pid);
      if (returnPart) { $("iLoc").value = p.location || locations()[0]; $("iQty").value = num(out(pid)).replace(/,/g, ""); return; }
      $("iLoc").innerHTML = stockOf(pid).sort(function (a, b) { return (b.location === p.location) - (a.location === p.location); }).map(function (x) { return '<option value="' + esc(x.location) + '">' + esc(x.location + " (" + num(x.qty) + " " + p.unit + ")") + '</option>'; }).join("");
    };
    var firstOk = [].filter.call($("iPart").options, function (o) { return !o.disabled; })[0]; if (firstOk) $("iPart").value = firstOk.value;
    fill(); $("iPart").addEventListener("change", fill);
    $("iGo").addEventListener("click", function () {
      var q = Number($("iQty").value), loc = $("iLoc").value.trim();
      if (!$("iPart").value || !loc) { say(returnPart ? "Choose the store location." : "Nothing in store to issue.", "err"); return; }
      if (!(q > 0)) { say("Enter a quantity.", "err"); return; }
      rpc("wo_issue_part", { p_wo: w.id, p_part: $("iPart").value, p_location: loc, p_qty: q, p_return: !!returnPart, p_note: null }).then(function () { closeModal(); return reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }

  /* ---------- purchasing ---------- */
  function linesText(lines) { lines = lines || []; return lines.slice(0, 3).map(function (l) { return num(l.qty) + " × " + (l.part_no ? l.part_no + " " : "") + l.description; }).join(", ") + (lines.length > 3 ? " and " + (lines.length - 3) + " more" : ""); }
  function lineRow(l) {
    var opts = d.parts.filter(function (p) { return p.active || p.id === l.part_id; }).map(function (p) { return [p.id, p.part_no + " · " + p.name]; });
    return '<div class="mt-line"><select data-lp aria-label="Part">' + options(opts, l.part_id || "", "Other item (not in the parts list)") + '</select><input data-ld maxlength="160" placeholder="Describe the item" value="' + esc(l.part_id ? "" : l.description || "") + '"' + (l.part_id ? " hidden" : "") + '>' +
      '<input data-lq type="number" min="0" step="any" aria-label="Quantity" placeholder="Qty" value="' + (l.qty || "") + '"><input data-lr type="number" min="0" step="0.01" aria-label="Price each" placeholder="Price each" value="' + (l.price == null ? "" : l.price) + '"><button type="button" class="ghost manage-btn" data-lx aria-label="Remove item">✕</button></div>';
  }
  function linesEditor(lines) {
    return '<div class="fld"><span class="lbl">Items</span><div id="lnBox">' + (lines.length ? lines : [{}]).map(lineRow).join("") + '</div><button type="button" class="ghost" id="lnAdd">' + icon(I.plus) + ' Add item</button> <span class="muted-cell" id="lnTotal"></span></div>';
  }
  function bindLines() {
    var total = function () { var t = 0; [].forEach.call(document.querySelectorAll(".mt-line"), function (r) { t += Number(r.querySelector("[data-lq]").value || 0) * Number(r.querySelector("[data-lr]").value || 0); }); $("lnTotal").textContent = "Total " + money(t); };
    var wire = function (r) {
      r.querySelector("[data-lp]").addEventListener("change", function () { var p = part(this.value); r.querySelector("[data-ld]").hidden = !!p; if (p) { r.querySelector("[data-lr]").value = Number(p.price); if (!r.querySelector("[data-lq]").value) r.querySelector("[data-lq]").value = p.reorder_qty || 1; } total(); });
      r.querySelector("[data-lx]").addEventListener("click", function () { if (document.querySelectorAll(".mt-line").length > 1) r.remove(); total(); });
      [].forEach.call(r.querySelectorAll("input"), function (x) { x.addEventListener("input", total); });
    };
    [].forEach.call(document.querySelectorAll(".mt-line"), wire);
    $("lnAdd").addEventListener("click", function () { $("lnBox").insertAdjacentHTML("beforeend", lineRow({})); wire($("lnBox").lastElementChild); });
    total();
  }
  function readLines() {
    return [].map.call(document.querySelectorAll(".mt-line"), function (r) { var p = part(r.querySelector("[data-lp]").value); return { part_id: p ? p.id : null, description: p ? p.name : r.querySelector("[data-ld]").value.trim(), unit: p ? p.unit : "Each", qty: r.querySelector("[data-lq]").value, price: r.querySelector("[data-lr]").value }; })
      .filter(function (l) { return l.part_id || l.description || l.qty; });
  }
  function linesTable(lines, received) {
    return '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Item</th><th>Quantity</th>' + (received ? '<th>Delivered</th>' : "") + '<th>Price each</th><th>Amount</th></tr></thead><tbody>' + (lines || []).map(function (l) {
      return '<tr><td>' + (l.part_id ? '<a href="#part/' + l.part_id + '"><strong>' + esc(l.part_no || "") + '</strong></a> ' : "") + esc(l.description) + '</td><td>' + num(l.qty) + ' ' + esc(l.unit) + '</td>' + (received ? '<td>' + (Number(l.received) >= Number(l.qty) ? chip("All in", "st-present") : Number(l.received) ? num(l.received) + " of " + num(l.qty) : '<span class="muted-cell">Not yet</span>') + '</td>' : "") +
        '<td class="muted-cell">' + money(l.price) + '</td><td>' + money(Number(l.qty) * Number(l.price)) + '</td></tr>';
    }).join("") + '<tr><td colspan="' + (received ? 4 : 3) + '"><strong>Total</strong></td><td><strong>' + money((lines || []).reduce(function (a, l) { return a + Number(l.qty) * Number(l.price); }, 0)) + '</strong></td></tr></tbody></table></div>';
  }
  function prRows(list) {
    return '<ul class="rows it-tks">' + list.map(function (r) {
      var w = r.work_order_id ? d.wos.filter(function (x) { return x.id === r.work_order_id; })[0] : null;
      return '<li class="row"><a class="it-tk" href="#pr/' + r.id + '"><span class="it-num mt-code">' + esc(r.code) + '</span><span class="grow"><strong>' + esc(linesText(r.lines)) + '</strong><small>' + esc([w ? w.code + " " + w.title : "For stock", nameOf(r.requested_by), ago(r.requested_at), money(r.estimate)].join(" · ")) + (r.needed_by ? " · needed by " + fmtDate(r.needed_by) : "") + '</small></span>' +
        chip(r.priority, "st-sev-" + slug(r.priority)) + chip(r.status === "Waiting" ? "Waiting for approval" : r.status, "st-pr-" + slug(r.status)) + '</a></li>';
    }).join("") + '</ul>';
  }
  function poRows(list) {
    return '<ul class="rows it-tks">' + list.map(function (o) {
      var s = o.supplier_id ? supplier(o.supplier_id) : null, late = o.expected_on && o.expected_on < todayIso() && (o.status === "Ordered" || o.status === "Part delivered");
      return '<li class="row"><a class="it-tk" href="#po/' + o.id + '"><span class="it-num mt-code">' + esc(o.code) + '</span><span class="grow"><strong>' + esc(s ? s.name : "No supplier yet") + ' · ' + money(o.total) + '</strong><small>' + esc(linesText(o.lines)) + (o.expected_on ? " · expected " + fmtDate(o.expected_on) : "") + (late ? ' · <span class="exp">late</span>' : "") + ' · invoice ' + esc(o.invoice_status.toLowerCase()) + '</small></span>' +
        chip(o.status, "st-po-" + slug(o.status)) + '</a></li>';
    }).join("") + '</ul>';
  }
  function purchasingView() {
    if (!isMaint) {
      var mine = d.prs.filter(function (r) { return r.requested_by === ctx.me; });
      return '<section class="dash-card"><h2>Your purchase requests</h2><p class="note">Ask for parts from a work order assigned to you. Maintenance approves and orders them.</p>' + (mine.length ? prRows(mine) : empty("You have not asked for any parts.")) + '</section>';
    }
    var pf = { waiting: function (r) { return r.status === "Waiting"; }, approved: function (r) { return r.status === "Approved"; }, ordered: function (r) { return r.status === "Ordered"; }, all: function () { return true; } };
    var of = { open: function (o) { return ["Draft", "Ordered", "Part delivered"].indexOf(o.status) > -1; }, invoice: function (o) { return o.status !== "Cancelled" && o.status !== "Draft" && o.invoice_status !== "Paid"; }, done: function (o) { return o.status === "Delivered" || o.status === "Cancelled"; }, all: function () { return true; } };
    var prs = d.prs.filter(pf[prFilter] || pf.waiting), pos = d.pos.filter(of[poFilter] || of.open);
    var late = d.pos.filter(function (o) { return o.expected_on && o.expected_on < todayIso() && (o.status === "Ordered" || o.status === "Part delivered"); });
    return '<div class="kpis">' + kpi("orange", I.clock, "Waiting for approval", d.prs.filter(pf.waiting).length, "purchase requests") + kpi("blue", I.check, "Approved, not ordered", d.prs.filter(pf.approved).length, "ready for a purchase order") +
      kpi("purple", I.truck, "Orders on the way", d.pos.filter(function (o) { return o.status === "Ordered" || o.status === "Part delivered"; }).length, late.length + " late") + kpi("teal", I.file, "Invoices to settle", d.pos.filter(function (o) { return o.status !== "Cancelled" && o.status !== "Draft" && o.invoice_status !== "Paid"; }).length, "not marked paid") + '</div>' +
      '<section class="dash-card"><div class="card-head"><div><h2>Purchase requests</h2><p class="note">Someone asks for parts, an approver agrees, then they are ordered from a supplier.</p></div><span class="prof-actions"><a class="ghost" href="#suppliers">Suppliers (' + d.suppliers.length + ')</a><button type="button" class="save" id="prNew">' + icon(I.plus) + ' Ask for parts</button></span></div>' +
        '<div class="stage-pills">' + [["waiting", "Waiting for approval"], ["approved", "Approved"], ["ordered", "Ordered"], ["all", "All"]].map(function (t) { return '<button type="button" class="pill-btn' + (prFilter === t[0] ? " on" : "") + '" data-prf="' + t[0] + '">' + t[1] + '<b>' + d.prs.filter(pf[t[0]]).length + '</b></button>'; }).join("") + '</div>' +
        (prs.length ? prRows(prs) : empty("No purchase requests here.")) + '</section>' +
      '<section class="dash-card"><div class="card-head"><div><h2>Purchase orders</h2><p class="note">What was ordered from whom, when it is due, what has arrived, and the supplier\'s invoice.</p></div><button type="button" class="ghost" id="poNew">' + icon(I.plus) + ' New purchase order</button></div>' +
        '<div class="stage-pills">' + [["open", "Open"], ["invoice", "Invoice not paid"], ["done", "Delivered & cancelled"], ["all", "All"]].map(function (t) { return '<button type="button" class="pill-btn' + (poFilter === t[0] ? " on" : "") + '" data-pof="' + t[0] + '">' + t[1] + '<b>' + d.pos.filter(of[t[0]]).length + '</b></button>'; }).join("") + '</div>' +
        (pos.length ? poRows(pos) : empty("No purchase orders here.")) + '</section>';
  }
  function openRequest(preset) {
    preset = preset || {};
    var w = preset.work_order_id ? d.wos.filter(function (x) { return x.id === preset.work_order_id; })[0] : null;
    var wos = isMaint ? d.wos.filter(openWO) : d.wos.filter(function (x) { return openWO(x) && x.assignee === ctx.me; });
    openModal('<h2>Ask for parts</h2><p class="note">' + (formSetting("10_maintenance_approval_rules", "Maintenance Approval Rules").enabled !== false ? "A maintenance approver gets a notification to approve it." : "Approval is turned off in Maintenance Approval Rules, so it is approved straight away.") + '</p><div class="cards">' +
      '<div class="fld"><label for="rWo">For work order</label><select id="rWo"' + (w ? " disabled" : "") + '>' + options(wos.map(function (x) { return [x.id, x.code + " · " + x.title]; }), w ? w.id : "", isMaint ? "None, for stock" : null) + '</select></div>' +
      '<div class="fld"><label for="rPri">Priority</label><select id="rPri">' + options(PRI, w ? w.priority : "Medium") + '</select></div>' +
      '<div class="fld"><label for="rBy">Needed by</label><input id="rBy" type="date" value="' + esc(w && w.due_on || "") + '"></div>' +
      (isMaint ? '<div class="fld"><label for="rSup">Suggested supplier</label><select id="rSup">' + options(d.suppliers.filter(function (s) { return s.active; }).map(function (s) { return [s.id, s.name]; }), "", "Any") + '</select></div>' : "") + '</div>' +
      linesEditor(preset.lines || []) + '<div class="fld"><label for="rWhy">Why</label><input id="rWhy" maxlength="1000" value="' + esc(preset.reason || "") + '" placeholder="e.g. Impeller worn, none left in store"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="rGo">Send request</button></div>', true);
    bindLines();
    $("rGo").addEventListener("click", function () {
      var lines = readLines(); if (!lines.length) { say("Add at least one item.", "err"); return; }
      rpc("request_parts", { p_company: company.id, p_row: { work_order_id: $("rWo").value || null, priority: $("rPri").value, needed_by: $("rBy").value || null, supplier_id: $("rSup") ? $("rSup").value || null : null, reason: $("rWhy").value.trim(), lines: lines } })
        .then(function (r) { closeModal(); location.hash = "#pr/" + r.id; return reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  function prView(id) {
    var r = d.prs.filter(function (x) { return x.id === id; })[0]; if (!r) return '<section class="dash-card">' + empty('Purchase request not found. <a href="#purchasing">Back</a>') + '</section>';
    var w = r.work_order_id ? d.wos.filter(function (x) { return x.id === r.work_order_id; })[0] : null, o = r.po_id ? d.pos.filter(function (x) { return x.id === r.po_id; })[0] : null, s = r.supplier_id ? supplier(r.supplier_id) : null;
    var kv = function (rows) { return '<dl class="kv">' + rows.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + (x[1] === "" || x[1] == null ? '<span class="muted-cell">—</span>' : x[1]) + '</dd></div>'; }).join("") + '</dl>'; };
    var at = ["Waiting", "Approved", "Ordered"].indexOf(r.status);
    return '<section class="dash-card prof-head"><a class="back" href="#purchasing">' + icon(I.back) + 'Purchasing</a><div class="card-head"><div><h2>' + esc(r.code) + ' · purchase request</h2><p class="note">Asked by ' + esc(nameOf(r.requested_by)) + ' · ' + when(r.requested_at) + '</p></div><span class="prof-chips">' + chip(r.priority, "st-sev-" + slug(r.priority)) + chip(r.status === "Waiting" ? "Waiting for approval" : r.status, "st-pr-" + slug(r.status)) + '</span></div>' +
      (at > -1 ? '<ol class="mt-flow">' + ["Asked", "Approved", "Ordered", "Delivered"].map(function (st, i) { var done = i <= at || (i === 3 && o && o.status === "Delivered"); return '<li class="' + (done ? (i === at && !(o && o.status === "Delivered") ? "now" : "done") : "") + '">' + st + '</li>'; }).join("") + '</ol>' : "") +
      '<div class="att-toolbar">' + (r.status === "Waiting" && isApprover ? '<button type="button" class="ghost danger" id="prNo">Turn down</button><button type="button" class="save" id="prOk">Approve</button>' : "") +
        (r.status === "Approved" && isMaint ? '<button type="button" class="save" id="prOrder">Create purchase order</button>' : "") + (o ? '<a class="btn-soft" href="#po/' + o.id + '">' + esc(o.code) + ' · ' + esc(o.status) + '</a>' : "") +
        (["Waiting", "Approved"].indexOf(r.status) > -1 && (isMaint || r.requested_by === ctx.me) ? '<button type="button" class="ghost" id="prCancel">Cancel request</button>' : "") + '</div>' +
      (r.status === "Waiting" && isApprover && r.requested_by === ctx.me && !formSetting("10_maintenance_approval_rules", "Maintenance Approval Rules").self ? '<p class="hint">You asked for this, so someone else must approve it (Maintenance Approval Rules).</p>' : "") + '<p class="msg" id="mMsgInline" role="status"></p></section>' +
      '<div class="hr-grid"><div class="col"><section class="dash-card"><h2>Items</h2>' + linesTable(r.lines) + '</section></div><div class="col"><section class="dash-card"><h2>Details</h2>' +
        kv([["For", w ? '<a href="#workorders/' + w.id + '">' + esc(w.code + " · " + w.title) + '</a>' : "Stock"], ["Vessel", r.vessel_id && vessel(r.vessel_id) ? esc(vessel(r.vessel_id).name) : ""], ["Needed by", r.needed_by ? fmtDate(r.needed_by) : ""], ["Why", esc(r.reason || "")], ["Suggested supplier", s ? esc(s.name) : ""],
          ["Decision", r.decided_at ? esc(r.status === "Rejected" ? "Turned down" : "Approved") + " by " + esc(nameOf(r.decided_by)) + " · " + when(r.decided_at) + (r.decision_note ? " · " + esc(r.decision_note) : "") : ""]]) + '</section></div></div>';
  }
  function openOrder(id, preset) {
    var o = id ? d.pos.filter(function (x) { return x.id === id; })[0] : Object.assign({ status: "Draft", lines: [] }, preset || {});
    var fixed = o.status === "Part delivered" || o.status === "Delivered";
    openModal('<h2>' + (id ? "Edit " + esc(o.code) : "New purchase order") + '</h2>' + (o.request_id && !id ? '<p class="note">From ' + esc((d.prs.filter(function (r) { return r.id === o.request_id; })[0] || {}).code || "") + '. Check the prices with the supplier.</p>' : "") + '<div class="cards">' +
      '<div class="fld"><label for="oSup">Supplier</label><select id="oSup">' + options(d.suppliers.filter(function (s) { return s.active || s.id === o.supplier_id; }).map(function (s) { return [s.id, s.name]; }), o.supplier_id || "", "Choose…") + '</select>' + (d.suppliers.length ? "" : '<small class="hint">Add suppliers under Purchasing → Suppliers.</small>') + '</div>' +
      '<div class="fld"><label for="oWo">For work order</label><select id="oWo"' + (id ? " disabled" : "") + '>' + options(d.wos.filter(function (w) { return openWO(w) || w.id === o.work_order_id; }).map(function (w) { return [w.id, w.code + " · " + w.title]; }), o.work_order_id || "", "None, for stock") + '</select></div>' +
      '<div class="fld"><label for="oTo">Deliver into</label><input id="oTo" list="oLocs" maxlength="80" value="' + esc(o.deliver_to || locations()[0]) + '"><datalist id="oLocs">' + locations().map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist></div>' +
      '<div class="fld"><label for="oExp">Expected delivery</label><input id="oExp" type="date" value="' + esc(o.expected_on || "") + '"></div>' +
      '<div class="fld"><label for="oRef">Supplier quote or order ref</label><input id="oRef" maxlength="80" value="' + esc(o.supplier_ref || "") + '"></div></div>' +
      (fixed ? '<p class="hint">Goods have arrived on this order, so the items cannot change.</p>' : linesEditor(o.lines || [])) +
      '<div class="fld"><label for="oNote">Note</label><input id="oNote" maxlength="1000" value="' + esc(o.note || "") + '"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button>' + (o.status === "Draft" ? '<button type="button" class="ghost" id="oDraft">Save as draft</button><button type="button" class="save" id="oSend">Save and mark as ordered</button>' : '<button type="button" class="save" id="oDraft">Save</button>') + '</div>', true);
    if (!fixed) bindLines();
    var save = function (status) {
      var row = { supplier_id: $("oSup").value || null, deliver_to: $("oTo").value.trim() || null, expected_on: $("oExp").value || null, supplier_ref: $("oRef").value.trim(), note: $("oNote").value.trim(), status: status };
      if (!fixed) { row.lines = readLines(); if (!row.lines.length) { say("Add at least one item.", "err"); return; } }
      if (!id) { row.work_order_id = $("oWo").value || null; row.request_id = o.request_id || null; }
      if (status === "Ordered" && !row.supplier_id) { say("Choose the supplier before ordering.", "err"); return; }
      rpc("save_purchase_order", { p_company: company.id, p_id: id || null, p_row: row }).then(function (n) { closeModal(); location.hash = "#po/" + n.id; return reload(); }).catch(function (e) { say(e.message, "err"); });
    };
    $("oDraft").addEventListener("click", function () { save(o.status); });
    if ($("oSend")) $("oSend").addEventListener("click", function () { save("Ordered"); });
  }
  var PO_FLOW = ["Draft", "Ordered", "Part delivered", "Delivered"];
  function poView(id) {
    var o = d.pos.filter(function (x) { return x.id === id; })[0]; if (!o) return '<section class="dash-card">' + empty('Purchase order not found. <a href="#purchasing">Back</a>') + '</section>';
    var s = o.supplier_id ? supplier(o.supplier_id) : null, w = o.work_order_id ? d.wos.filter(function (x) { return x.id === o.work_order_id; })[0] : null, r = o.request_id ? d.prs.filter(function (x) { return x.id === o.request_id; })[0] : null, at = PO_FLOW.indexOf(o.status);
    var kv = function (rows) { return '<dl class="kv">' + rows.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + (x[1] === "" || x[1] == null ? '<span class="muted-cell">—</span>' : x[1]) + '</dd></div>'; }).join("") + '</dl>'; };
    var late = o.expected_on && o.expected_on < todayIso() && (o.status === "Ordered" || o.status === "Part delivered");
    return '<section class="dash-card prof-head"><a class="back" href="#purchasing">' + icon(I.back) + 'Purchasing</a><div class="card-head"><div><h2>' + esc(o.code) + ' · ' + esc(s ? s.name : "No supplier yet") + '</h2><p class="note">Created ' + when(o.created_at) + ' by ' + esc(nameOf(o.created_by)) + (o.ordered_on ? " · ordered " + fmtDate(o.ordered_on) : "") + '</p></div><span class="prof-chips">' + chip(o.status, "st-po-" + slug(o.status)) + (late ? chip("Late", "st-absent") : "") + '</span></div>' +
      (o.status !== "Cancelled" ? '<ol class="mt-flow">' + PO_FLOW.map(function (st, i) { return '<li class="' + (i < at || o.status === "Delivered" ? "done" : i === at ? "now" : "") + '">' + (st === "Ordered" ? "Ordered from supplier" : st) + '</li>'; }).join("") + '</ol>' : "") +
      '<div class="att-toolbar">' + (o.status === "Draft" ? '<button type="button" class="save" id="poSend">Mark as ordered</button>' : "") + (o.status === "Ordered" || o.status === "Part delivered" ? '<button type="button" class="save" id="poRecv">Receive delivery</button>' : "") +
        (o.status !== "Cancelled" && o.status !== "Draft" ? '<button type="button" class="ghost" id="poInv">Supplier invoice</button>' : "") + (o.status !== "Cancelled" ? '<button type="button" class="ghost" id="poEdit">Edit</button>' : "") +
        (o.status === "Draft" || o.status === "Ordered" ? '<button type="button" class="ghost danger" id="poCancel">Cancel order</button>' : "") + '</div><p class="msg" id="mMsgInline" role="status"></p></section>' +
      '<div class="hr-grid"><div class="col"><section class="dash-card"><h2>Items</h2>' + linesTable(o.lines, o.status !== "Draft") + '</section>' +
        '<section class="dash-card"><h2>Delivery notes & invoices</h2><p class="note">Attach the supplier\'s quote, delivery note and invoice.</p>' + filesBlock("purchase_order", id, cache["f:purchase_order:" + id]) + '</section></div>' +
      '<div class="col"><section class="dash-card"><h2>Delivery</h2>' + kv([["Deliver into", esc(o.deliver_to || "")], ["Expected", o.expected_on ? fmtDate(o.expected_on) + (late ? ' · <span class="exp">late</span>' : "") : ""], ["Delivered", o.delivered_on ? fmtDate(o.delivered_on) : ""], ["Supplier ref", esc(o.supplier_ref || "")],
          ["For", w ? '<a href="#workorders/' + w.id + '">' + esc(w.code + " · " + w.title) + '</a>' : "Stock"], ["Request", r ? '<a href="#pr/' + r.id + '">' + esc(r.code) + '</a> by ' + esc(nameOf(r.requested_by)) : ""], ["Note", esc(o.note || "")]]) + '</section>' +
        '<section class="dash-card"><h2>Supplier invoice</h2>' + kv([["Status", chip(o.invoice_status, o.invoice_status === "Paid" ? "st-present" : o.invoice_status === "Received" ? "st-late" : "st-off-duty")], ["Invoice number", esc(o.invoice_no || "")], ["Invoice date", o.invoice_date ? fmtDate(o.invoice_date) : ""],
          ["Amount", o.invoice_amount != null ? money(o.invoice_amount) + (Math.abs(Number(o.invoice_amount) - Number(o.total)) > 0.005 ? ' · <span class="exp">order total ' + money(o.total) + '</span>' : "") : ""]]) +
          (s ? '<p class="hint">' + esc([s.contact, s.phone, s.email].filter(Boolean).join(" · ")) + '</p>' : "") + '</section></div></div>';
  }
  function openReceive(o) {
    var rest = (o.lines || []).map(function (l, i) { return { l: l, i: i, left: Number(l.qty) - Number(l.received || 0) }; }).filter(function (x) { return x.left > 0; });
    openModal('<h2>Receive delivery: ' + esc(o.code) + '</h2><p class="note">Enter what actually arrived. Parts from the parts list go into stock at the order price.</p>' +
      '<div class="fld"><label for="dLoc">Into store</label><input id="dLoc" list="dLocs" maxlength="80" value="' + esc(o.deliver_to || locations()[0]) + '"><datalist id="dLocs">' + locations().map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist></div>' +
      rest.map(function (x) { return '<div class="mt-item"><span class="grow">' + esc((x.l.part_no ? x.l.part_no + " · " : "") + x.l.description) + '<small class="th-sub">' + num(x.left) + ' ' + esc(x.l.unit) + ' still to come' + (x.l.part_id ? "" : " · not a stock item") + '</small></span><input class="mt-qty" type="number" min="0" step="any" data-ri="' + x.i + '" value="' + num(x.left).replace(/,/g, "") + '" aria-label="Arrived"></div>'; }).join("") +
      '<div class="fld"><label for="dNote">Delivery note number or remark (optional)</label><input id="dNote" maxlength="300"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="dGo">Receive</button></div>', true);
    $("dGo").addEventListener("click", function () {
      var items = [].map.call(document.querySelectorAll("[data-ri]"), function (x) { return { i: Number(x.dataset.ri), qty: x.value === "" ? 0 : Number(x.value) }; }).filter(function (x) { return x.qty; });
      if (!items.length) { say("Enter how many arrived.", "err"); return; }
      rpc("receive_purchase_order", { p_id: o.id, p_items: items, p_location: $("dLoc").value.trim(), p_note: $("dNote").value.trim() || null }).then(function () { closeModal(); return reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  function openInvoice(o) {
    openModal('<h2>Supplier invoice: ' + esc(o.code) + '</h2><p class="note">Order total ' + money(o.total) + '. Attach the invoice itself under Delivery notes & invoices.</p><div class="cards">' +
      '<div class="fld"><label for="vNo">Invoice number</label><input id="vNo" maxlength="80" value="' + esc(o.invoice_no || "") + '"></div>' +
      '<div class="fld"><label for="vDate">Invoice date</label><input id="vDate" type="date" value="' + esc(o.invoice_date || todayIso()) + '"></div>' +
      '<div class="fld"><label for="vAmt">Amount</label><input id="vAmt" type="number" min="0" step="0.01" value="' + (o.invoice_amount == null ? Number(o.total) : o.invoice_amount) + '"></div>' +
      '<div class="fld"><label for="vSt">Status</label><select id="vSt">' + options(["Not received", "Received", "Paid"], o.invoice_status === "Not received" ? "Received" : o.invoice_status) + '</select></div></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="vGo">Save</button></div>');
    $("vGo").addEventListener("click", function () {
      rpc("save_purchase_order", { p_company: company.id, p_id: o.id, p_row: { invoice_no: $("vNo").value.trim(), invoice_date: $("vDate").value || null, invoice_amount: $("vAmt").value, invoice_status: $("vSt").value } })
        .then(function () { closeModal(); return reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  function suppliersView() {
    if (!isMaint) return maintOnly("Suppliers");
    return '<section class="dash-card prof-head"><a class="back" href="#purchasing">' + icon(I.back) + 'Purchasing</a><div class="card-head"><div><h2>Suppliers</h2><p class="note">Chandlers, engine dealers and workshops you buy parts from.</p></div><button type="button" class="save" id="suAdd">' + icon(I.plus) + ' Add supplier</button></div>' +
      (d.suppliers.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Supplier</th><th>Contact</th><th>Orders</th><th></th></tr></thead><tbody>' + d.suppliers.map(function (s) {
        var os = d.pos.filter(function (o) { return o.supplier_id === s.id && o.status !== "Cancelled"; });
        return '<tr' + (s.active ? "" : ' class="mt-off"') + '><td><strong>' + esc(s.name) + '</strong>' + (s.address ? '<span class="th-sub">' + esc(s.address) + '</span>' : "") + '</td><td class="muted-cell">' + esc([s.contact, s.phone, s.email].filter(Boolean).join(" · ") || "—") + '</td>' +
          '<td class="muted-cell">' + os.length + (os.length ? " · " + money(os.reduce(function (a, o) { return a + Number(o.total); }, 0)) : "") + '</td><td class="it-acts"><button type="button" class="ghost manage-btn" data-suedit="' + s.id + '">Edit</button></td></tr>';
      }).join("") + '</tbody></table></div>' : empty("No suppliers yet.")) + '</section>';
  }
  function openSupplier(id) {
    var s = id ? supplier(id) : { active: true };
    openModal('<h2>' + (id ? "Edit supplier" : "Add supplier") + '</h2><div class="cards">' +
      '<div class="fld"><label for="uName">Name</label><input id="uName" maxlength="120" value="' + esc(s.name || "") + '" placeholder="e.g. Malé Marine Supplies"></div>' +
      '<div class="fld"><label for="uWho">Contact person</label><input id="uWho" maxlength="120" value="' + esc(s.contact || "") + '"></div>' +
      '<div class="fld"><label for="uPh">Phone</label><input id="uPh" type="tel" maxlength="40" value="' + esc(s.phone || "") + '"></div>' +
      '<div class="fld"><label for="uEm">Email</label><input id="uEm" type="email" maxlength="120" value="' + esc(s.email || "") + '"></div></div>' +
      '<div class="fld"><label for="uAd">Address</label><input id="uAd" maxlength="300" value="' + esc(s.address || "") + '"></div><div class="fld"><label for="uNo">Notes</label><input id="uNo" maxlength="500" value="' + esc(s.note || "") + '" placeholder="e.g. 30 days credit, delivers to Hulhumalé"></div>' +
      '<label class="chk"><input type="checkbox" id="uOn"' + (s.active ? " checked" : "") + '> Still buying from them</label><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="uGo">Save</button></div>');
    $("uGo").addEventListener("click", function () {
      var row = { name: $("uName").value.trim(), contact: $("uWho").value.trim() || null, phone: $("uPh").value.trim() || null, email: $("uEm").value.trim() || null, address: $("uAd").value.trim() || null, note: $("uNo").value.trim() || null, active: $("uOn").checked };
      if (row.name.length < 2) { say("Enter the supplier's name.", "err"); return; }
      var q = id ? db.from("suppliers").update(row).eq("id", id) : db.from("suppliers").insert(Object.assign(row, { company_id: company.id }));
      q.then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
    });
  }
  function bindParts(rt) {
    if ($("ptAdd")) $("ptAdd").addEventListener("click", function () { openPart(null); });
    on("[data-ptf]", function (b) { partFilter = b.dataset.ptf; render(); });
    if ($("ptSearch")) $("ptSearch").addEventListener("input", function () { var q = this.value.trim().toLowerCase(); [].forEach.call(document.querySelectorAll("#ptTable tbody tr"), function (tr) { tr.hidden = q && tr.dataset.q.indexOf(q) < 0; }); });
    if (rt.view === "part") {
      if ($("ptEdit")) $("ptEdit").addEventListener("click", function () { openPart(rt.id); });
      on("[data-stock]", function (b) { openStock(rt.id, b.dataset.stock); });
      if ($("ptBuy")) $("ptBuy").addEventListener("click", function () { var p = part(rt.id); openRequest({ lines: [{ part_id: p.id, qty: p.reorder_qty || Math.max(1, Number(p.min_stock) * 2 - totalOf(p.id)), price: p.price }], reason: partState(p).k === "ok" ? "" : "Stock is low" }); });
    }
    if (rt.view === "workorders" && rt.id) {
      var w = d.wos.filter(function (x) { return x.id === rt.id; })[0];
      if (w && $("wpIssue")) $("wpIssue").addEventListener("click", function () { openIssue(w, null); });
      if (w && $("wpBuy")) $("wpBuy").addEventListener("click", function () { openRequest({ work_order_id: w.id }); });
      on("[data-wpret]", function (b) { openIssue(w, b.dataset.wpret); });
    }
    on("[data-prf]", function (b) { prFilter = b.dataset.prf; render(); });
    on("[data-pof]", function (b) { poFilter = b.dataset.pof; render(); });
    if ($("prNew")) $("prNew").addEventListener("click", function () { openRequest({}); });
    if ($("poNew")) $("poNew").addEventListener("click", function () { openOrder(null, { deliver_to: locations()[0] }); });
    if ($("suAdd")) $("suAdd").addEventListener("click", function () { openSupplier(null); });
    on("[data-suedit]", function (b) { openSupplier(b.dataset.suedit); });
    var msg = function (t) { var m = $("mMsgInline"); if (m) { m.textContent = t; m.className = "msg err"; } };
    if (rt.view === "pr") {
      var r = d.prs.filter(function (x) { return x.id === rt.id; })[0];
      var decide = function (ok) {
        openModal('<h2>' + (ok ? "Approve " : "Turn down ") + esc(r.code) + '</h2><p class="note">' + esc(linesText(r.lines)) + ' · ' + money(r.estimate) + '</p><div class="fld"><label for="apNote">' + (ok ? "Comment (optional)" : "Why not?") + '</label><textarea id="apNote" rows="3" maxlength="300"></textarea></div>' +
          '<p class="msg" id="mMsg" role="status"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="' + (ok ? "save" : "ghost danger") + '" id="apGo">' + (ok ? "Approve" : "Turn down") + '</button></div>');
        $("apGo").addEventListener("click", function () { rpc("decide_purchase_request", { p_id: r.id, p_ok: ok, p_note: $("apNote").value.trim() || null }).then(function () { closeModal(); return reload(); }).catch(function (e) { say(e.message, "err"); }); });
      };
      if ($("prOk")) $("prOk").addEventListener("click", function () { decide(true); });
      if ($("prNo")) $("prNo").addEventListener("click", function () { decide(false); });
      if ($("prOrder")) $("prOrder").addEventListener("click", function () { var p0 = r.lines[0] && r.lines[0].part_id ? part(r.lines[0].part_id) : null; openOrder(null, { request_id: r.id, supplier_id: r.supplier_id || (p0 && p0.supplier_id) || null, work_order_id: r.work_order_id, lines: r.lines, deliver_to: (r.lines[0] && r.lines[0].part_id && part(r.lines[0].part_id) && part(r.lines[0].part_id).location) || locations()[0] }); });
      if ($("prCancel")) $("prCancel").addEventListener("click", function () { if (!confirm("Cancel " + r.code + "?")) return; rpc("cancel_purchase_request", { p_id: r.id }).then(reload).catch(function (e) { msg(e.message); }); });
    }
    if (rt.view === "po") {
      var o = d.pos.filter(function (x) { return x.id === rt.id; })[0];
      if ($("poEdit")) $("poEdit").addEventListener("click", function () { openOrder(o.id); });
      if ($("poSend")) $("poSend").addEventListener("click", function () { if (!o.supplier_id) { msg("Choose the supplier first (Edit)."); return; } rpc("save_purchase_order", { p_company: company.id, p_id: o.id, p_row: { status: "Ordered" } }).then(reload).catch(function (e) { msg(e.message); }); });
      if ($("poRecv")) $("poRecv").addEventListener("click", function () { openReceive(o); });
      if ($("poInv")) $("poInv").addEventListener("click", function () { openInvoice(o); });
      if ($("poCancel")) $("poCancel").addEventListener("click", function () { if (!confirm("Cancel " + o.code + "?" + (o.request_id ? " The request goes back to approved, ready to order again." : ""))) return; rpc("save_purchase_order", { p_company: company.id, p_id: o.id, p_row: { status: "Cancelled" } }).then(reload).catch(function (e) { msg(e.message); }); });
    }
  }

  /* ---------- files ---------- */
  // Cursor 2026-10-23: modern files UI — drop zone + typed file cards (shared by vessel / WO / defect / etc.).
  function fileKind(f) {
    var m = String(f.mime || "").toLowerCase(), n = String(f.name || "").toLowerCase();
    if (m.indexOf("image/") === 0 || /\.(png|jpe?g|gif|webp|heic)$/.test(n)) return { key: "img", label: "Image" };
    if (m.indexOf("video/") === 0 || /\.(mp4|mov|webm|m4v)$/.test(n)) return { key: "vid", label: "Video" };
    if (m.indexOf("pdf") >= 0 || /\.pdf$/.test(n)) return { key: "pdf", label: "PDF" };
    if (/\.(docx?|xlsx?|csv)$/.test(n) || m.indexOf("sheet") >= 0 || m.indexOf("word") >= 0) return { key: "doc", label: "Document" };
    return { key: "file", label: "File" };
  }
  function fileSizeLabel(bytes) {
    var n = Number(bytes) || 0;
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1048576) return Math.max(1, Math.round(n / 1024)) + " KB";
    return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + " MB";
  }
  function filesBlock(type, id, files, vesselId) {
    var fv = vesselId || (type === "vessel" ? id : "");
    var listHtml;
    if (!files) {
      listHtml = '<div class="mf-loading"><span class="mf-spin"></span> Loading files…</div>';
    } else if (!files.length) {
      listHtml = '<div class="mf-empty"><span class="mf-empty-ic">' + icon(I.file) + '</span><strong>No files yet</strong><p>Drop photos, PDFs or documents here — max 50 MB each.</p></div>';
    } else {
      listHtml = '<div class="mf-grid">' + files.map(function (f) {
        var k = fileKind(f), sz = fileSizeLabel(f.size);
        var canDel = isMaint || f.uploaded_by === ctx.me;
        return '<article class="mf-card kind-' + k.key + '">' +
          '<div class="mf-ic" aria-hidden="true">' + icon(I.file) + '</div>' +
          '<div class="mf-body">' +
            '<strong title="' + esc(f.name) + '">' + esc(f.name) + '</strong>' +
            '<small><span class="mf-pill">' + k.label + '</span> ' + when(f.created_at) +
              ' · ' + esc(nameOf(f.uploaded_by)) + (sz ? " · " + sz : "") + '</small>' +
          '</div>' +
          '<div class="mf-acts">' +
            '<button type="button" class="mf-btn" data-fdl="' + esc(f.path) + '" data-fn="' + esc(f.name) + '" title="Open">' + icon(I.file) + '<span>Open</span></button>' +
            (canDel ? '<button type="button" class="mf-btn danger" data-fdel="' + f.id + '" data-fp="' + esc(f.path) + '" title="Remove">Remove</button>' : "") +
          '</div></article>';
      }).join("") + '</div>';
    }
    return '<div class="mf">' +
      '<label class="mf-drop" id="fDrop" for="fUp">' +
        '<span class="mf-drop-ic">' + icon(I.plus) + '</span>' +
        '<span class="mf-drop-txt"><strong>Upload a file</strong><small>Click or drag & drop · images, video, PDF, Word, Excel</small></span>' +
        '<span class="mf-drop-cta">Browse</span>' +
        '<input type="file" id="fUp" accept="image/*,video/*,application/pdf,.docx,.xlsx" data-ft="' + type + '" data-fid="' + id + '" data-fv="' + esc(fv) + '" hidden>' +
      '</label>' +
      '<div class="mf-toolbar"><p class="msg" id="fMsg" role="status"></p>' +
        '<button type="button" class="save" id="fUpGo" hidden>Upload selected</button></div>' +
      listHtml +
      '</div>';
  }
  function loadFiles(type, id) {
    if (cache["f:" + type + ":" + id]) return;
    cache["f:" + type + ":" + id] = null;
    db.from("maint_files").select("*").eq("ref_type", type).eq("ref_id", id).order("created_at", { ascending: false }).then(function (r) {
      if (cache["f:" + type + ":" + id]) return; cache["f:" + type + ":" + id] = r.data || []; var rt = route(); if (rt.id === id) render();
    });
  }
  function uploadFile(type, refId, vesselId, file) {
    if (file.size > 50 * 1048576) return Promise.reject(new Error("That file is larger than 50 MB."));
    var safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80), path = company.id + "/" + (vesselId || "general") + "/" + type + "/" + refId + "/" + Date.now() + "-" + safe;
    return db.storage.from("maintenance").upload(path, file, { contentType: file.type || undefined }).then(function (u) {
      if (u.error) throw new Error(u.error.message);
      return db.from("maint_files").insert({ company_id: company.id, vessel_id: vesselId || null, ref_type: type, ref_id: refId, path: path, name: file.name.slice(0, 200), mime: file.type || null, size: file.size, uploaded_by: ctx.me })
        .then(function (r) { if (r.error) throw new Error(r.error.message); });
    });
  }

  function vesselMeta(v) {
    return v && v.meta && typeof v.meta === "object" && !Array.isArray(v.meta) ? v.meta : {};
  }
  function followmeUrl(v) {
    var m = vesselMeta(v);
    return String(m.followme_url || m.followme || "").trim();
  }
  function followmeHint(v) {
    var m = vesselMeta(v);
    return String(m.followme_hint || "").trim();
  }
  function followmeLinked(v) {
    var m = vesselMeta(v);
    return !!(m.followme_set || followmeUrl(v));
  }
  function normalizeFollowmeUrl(raw) {
    var u = String(raw || "").trim();
    if (!u) return { url: "" };
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    try {
      var parsed = new URL(u);
      if (!/\.followme\.mv$/i.test(parsed.hostname) && parsed.hostname.toLowerCase() !== "followme.mv") {
        return { error: "Use a followme.mv link (e.g. https://followme.mv/api/v5/public/…/)." };
      }
      var share = parsed.pathname.match(/^\/public\/([^\/\?#]+)\/?$/i);
      if (share && !/\/api\//i.test(parsed.pathname)) {
        parsed = new URL("https://followme.mv/api/v5/public/" + share[1] + "/");
      }
      if (!/\/api\/v[0-9]+\//i.test(parsed.pathname)) {
        return { error: "Use the FollowMe API URL (https://followme.mv/api/v5/public/<key>/), not the public map page." };
      }
      return { url: parsed.href };
    } catch (e) {
      return { error: "Enter a valid FollowMe URL." };
    }
  }

  /* ---------- small dialogs ---------- */
  function openVessel(id) {
    var v = id ? vessel(id) : { kind: "Ferry" };
    var fmLinked = followmeLinked(v), fmH = followmeHint(v);
    openModal('<h2>' + (id ? "Edit vessel" : "Add vessel") + '</h2><div class="cards">' +
      '<div class="fld"><label for="vName">Name</label><input id="vName" maxlength="80" value="' + esc(v.name || "") + '" placeholder="e.g. Coral Star"></div>' +
      '<div class="fld"><label for="vCode">Code</label><input id="vCode" maxlength="30" value="' + esc(v.code || "") + '" placeholder="e.g. HT-203"><small class="hint">Use the same code as on crew assignments.</small></div>' +
      '<div class="fld"><label for="vKind">Type</label><input id="vKind" list="vKinds" maxlength="40" value="' + esc(v.kind || "") + '"><datalist id="vKinds"><option value="Ferry"><option value="Speedboat"><option value="Dhoni"><option value="Supply boat"><option value="Yacht"></datalist></div>' +
      '<div class="fld"><label for="vReg">Registration</label><input id="vReg" maxlength="40" value="' + esc(v.registration || "") + '"></div>' +
      '<div class="fld"><label for="vYear">Built</label><input id="vYear" type="number" min="1900" max="2100" value="' + (v.built_year || "") + '"></div>' +
      '<div class="fld"><label for="vPax">Passenger seats</label><input id="vPax" type="number" min="0" max="9999" value="' + (v.passenger_capacity != null ? v.passenger_capacity : "") + '" placeholder="e.g. 80"><small class="hint">Sold to passengers on each trip.</small></div>' +
      '<div class="fld"><label for="vCrew">Crew seats</label><input id="vCrew" type="number" min="0" max="999" value="' + (v.crew_capacity != null ? v.crew_capacity : "") + '" placeholder="e.g. 8"><small class="hint">Kept for crew. Total people = passengers + crew.</small></div>' +
      '<div class="fld full"><label for="vFollowMe">FollowMe API URL</label><input id="vFollowMe" type="url" maxlength="500" value="" placeholder="https://followme.mv/api/v5/public/…/"' + (fmLinked ? ' data-linked="1"' : "") + '>' +
        '<small class="hint">' + (fmLinked ? 'Linked: <strong>' + esc(fmH || "saved") + '</strong>. Paste a new API URL to replace, or clear the field and save to remove. ' : "") +
        'Use <code>api/v5/public/…</code> (not the public map page). Share links are converted when possible.</small></div></div>' +
      '<p class="note" id="vCapSum"></p>' +
      '<div class="fld"><label for="vNote">Notes</label><textarea id="vNote" rows="2" maxlength="500">' + esc(v.note || "") + '</textarea></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' + (id ? '<button type="button" class="ghost danger" id="vDel">Remove vessel</button>' : "") + '<button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="vGo">Save</button></div>', true);
    function capSum() {
      var p = Number($("vPax").value) || 0, c = Number($("vCrew").value) || 0, el = $("vCapSum");
      if (!el) return;
      el.textContent = (p || c) ? ("Total people capacity: " + (p + c) + " (" + p + " passengers + " + c + " crew).") : "Set passenger and crew seats so Operations can warn when a trip is almost full or full.";
    }
    if ($("vPax")) { $("vPax").addEventListener("input", capSum); $("vCrew").addEventListener("input", capSum); capSum(); }
    $("vGo").addEventListener("click", function () {
      var pax = $("vPax").value !== "" ? Number($("vPax").value) : null;
      var crew = $("vCrew").value !== "" ? Number($("vCrew").value) : null;
      if (pax != null && (isNaN(pax) || pax < 0)) { say("Passenger seats must be 0 or more.", "err"); return; }
      if (crew != null && (isNaN(crew) || crew < 0)) { say("Crew seats must be 0 or more.", "err"); return; }
      var fmRaw = $("vFollowMe").value.trim();
      var meta = Object.assign({}, vesselMeta(v));
      delete meta.followme;
      if (fmRaw) {
        var fm = normalizeFollowmeUrl(fmRaw);
        if (fm.error) { say(fm.error, "err"); return; }
        meta.followme_url = fm.url;
      } else if ($("vFollowMe").dataset.linked === "1") {
        meta.followme_url = ""; // clear hidden link
      } else {
        delete meta.followme_url;
      }
      var row = {
        name: $("vName").value.trim(), code: $("vCode").value.trim(), kind: $("vKind").value.trim() || "Ferry",
        registration: $("vReg").value.trim() || null, built_year: $("vYear").value ? Number($("vYear").value) : null,
        note: $("vNote").value.trim() || null,
        passenger_capacity: pax, crew_capacity: crew,
        meta: meta
      };
      if (!row.name || !row.code) { say("Enter the vessel name and code.", "err"); return; }
      var q = id ? db.from("vessels").update(row).eq("id", id) : db.from("vessels").insert(Object.assign(row, { company_id: company.id })).select().single();
      q.then(function (r) { if (r.error) { say(/duplicate/.test(r.error.message) ? "Another vessel already uses that code." : r.error.message, "err"); return; } closeModal(); if (!id && r.data) location.hash = "#vessel/" + r.data.id; reload(); });
    });
    if ($("vDel")) $("vDel").addEventListener("click", function () { if (!confirm("Remove " + v.name + " and all its maintenance records? This cannot be undone.")) return; db.from("vessels").delete().eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); location.hash = "#vessels"; reload(); } }); });
  }
  function openComponent(id, vesselId) {
    var c = id ? comp(id) : { vessel_id: vesselId, kind: "Engine", status: "In service", tracks_hours: true };
    openModal('<h2>' + (id ? "Edit component" : "Add engine or component") + '</h2><div class="cards">' +
      '<div class="fld"><label for="kName">Name</label><input id="kName" maxlength="80" value="' + esc(c.name || "") + '" placeholder="e.g. Port engine"></div>' +
      '<div class="fld"><label for="kKind">Kind</label><select id="kKind">' + options(COMP_KINDS, c.kind) + '</select></div>' +
      '<div class="fld"><label for="kMake">Make and model</label><input id="kMake" maxlength="80" value="' + esc(c.make_model || "") + '" placeholder="e.g. Yamaha F300"></div>' +
      '<div class="fld"><label for="kSerial">Serial number</label><input id="kSerial" maxlength="80" value="' + esc(c.serial || "") + '"></div>' +
      '<div class="fld"><label for="kFit">Installed on</label><input id="kFit" type="date" value="' + esc(c.installed_on || "") + '"></div>' +
      '<div class="fld"><label for="kWar">Warranty until</label><input id="kWar" type="date" value="' + esc(c.warranty_until || "") + '"></div>' +
      '<div class="fld"><label for="kSt">Status</label><select id="kSt">' + options(["In service", "Removed", "Retired"], c.status) + '</select></div>' +
      (id ? "" : '<div class="fld"><label for="kHours">Hour meter now</label><input id="kHours" type="number" min="0" step="0.1" placeholder="e.g. 1240"></div>') + '</div>' +
      '<label class="chk"><input type="checkbox" id="kTrack"' + (c.tracks_hours ? " checked" : "") + '> Has an hour meter (log running hours)</label>' +
      '<div class="fld" style="margin-top:10px"><label for="kNote">Notes</label><input id="kNote" maxlength="300" value="' + esc(c.note || "") + '"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' + (id ? '<button type="button" class="ghost danger" id="kDel">Remove</button>' : "") + '<button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="kGo">Save</button></div>', true);
    $("kGo").addEventListener("click", function () {
      var row = { name: $("kName").value.trim(), kind: $("kKind").value, make_model: $("kMake").value.trim() || null, serial: $("kSerial").value.trim() || null, installed_on: $("kFit").value || null, warranty_until: $("kWar").value || null, status: $("kSt").value, tracks_hours: $("kTrack").checked, note: $("kNote").value.trim() || null };
      if (!row.name) { say("Name the component.", "err"); return; }
      var hrs = $("kHours") && $("kHours").value !== "" ? Number($("kHours").value) : null;
      var q = id ? db.from("vessel_components").update(row).eq("id", id) : db.from("vessel_components").insert(Object.assign(row, { company_id: company.id, vessel_id: c.vessel_id })).select().single();
      q.then(function (r) { if (r.error) { say(r.error.message, "err"); return; } return (hrs != null && r.data ? rpc("log_hours", { p_component: r.data.id, p_hours: hrs, p_note: "First reading" }) : Promise.resolve()).then(function () { closeModal(); reload(); }); }).catch(function (e) { say(e.message, "err"); });
    });
    if ($("kDel")) $("kDel").addEventListener("click", function () { if (!confirm("Remove " + c.name + "? Its hour readings are removed too. To keep history, set it to Removed or Retired.")) return; db.from("vessel_components").delete().eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } }); });
  }
  function openHours(id) {
    var c = comp(id);
    openModal('<h2>Log running hours</h2><p class="note">' + esc(c.name) + ' · last reading ' + Number(c.hours).toLocaleString() + ' h (' + ago(c.hours_at) + ')</p>' +
      '<div class="fld"><label for="hVal">Hour meter now</label><input id="hVal" type="number" min="0" step="0.1" value="' + Number(c.hours) + '"></div>' +
      '<div class="fld"><label for="hNote">Note (optional)</label><input id="hNote" maxlength="200" placeholder="e.g. after the Maafushi run"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="hGo">Save reading</button></div>');
    $("hVal").select();
    $("hGo").addEventListener("click", function () {
      rpc("log_hours", { p_component: id, p_hours: Number($("hVal").value), p_note: $("hNote").value.trim() || null }).then(function () { closeModal(); reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  function openStatus(id) {
    var v = vessel(id);
    openModal('<h2>' + esc(v.name) + ': availability</h2><p class="note">Operations and maintenance get a notification.' + (formSetting("10_return_to_service_rules", "Return to Service Rules").blockAssign !== false ? " Crew cannot be assigned while it is out of service." : "") + '</p>' +
      '<div class="fld"><label for="aSt">New status</label><select id="aSt">' + options([["Restricted", "Restricted: can operate with limits"], ["Out of service", "Out of service: must not operate"]], "Out of service") + '</select></div>' +
      '<div class="fld"><label for="aWhy">Reason</label><input id="aWhy" maxlength="200" placeholder="e.g. Scheduled haul-out and hull cleaning, 3 days"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="aGo">Save</button></div>');
    $("aGo").addEventListener("click", function () { rpc("set_vessel_status", { p_vessel: id, p_status: $("aSt").value, p_reason: $("aWhy").value.trim() }).then(function () { closeModal(); reload(); }).catch(function (e) { say(e.message, "err"); }); });
  }
  function openRelease(id) {
    var v = vessel(id), r = formSetting("10_return_to_service_rules", "Return to Service Rules");
    openModal('<h2>Return ' + esc(v.name) + ' to service</h2><p class="note">Currently ' + esc(v.status.toLowerCase()) + (v.status_reason ? ": " + esc(v.status_reason) : "") + '.' + (r.requireInspection ? " A passed inspection is needed after a repair that stopped operation." : "") + '</p>' +
      '<div class="fld"><label for="rNote">Inspected and released by, and what was checked</label><textarea id="rNote" rows="3" maxlength="300" placeholder="e.g. Sea trial done by chief engineer, no leaks, temperatures normal"></textarea></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="rGo">Return to service</button></div>');
    $("rGo").addEventListener("click", function () { rpc("release_vessel", { p_vessel: id, p_note: $("rNote").value.trim() }).then(function () { closeModal(); reload(); }).catch(function (e) { say(e.message, "err"); }); });
  }

  /* ---------- events ---------- */
  function on(sel, fn) { [].forEach.call(document.querySelectorAll(sel), function (b) { b.addEventListener("click", function (e) { fn(b, e); }); }); }
  function bind(rt) {
    if ($("ovDefect")) $("ovDefect").addEventListener("click", function () { openDefect(null); });
    if ($("ovWo")) $("ovWo").addEventListener("click", function () { openWoForm(null, null); });
    if ($("vsAdd")) $("vsAdd").addEventListener("click", function () { openVessel(null); });
    if ($("vsImport")) $("vsImport").addEventListener("click", function () {
      var known = d.vessels.map(function (v) { return v.code.toLowerCase(); }), add = [];
      Object.keys(d.people).forEach(function (k) { var vv = d.people[k].vessel; if (vv && known.indexOf(vv.toLowerCase()) < 0 && add.indexOf(vv) < 0) add.push(vv); });
      db.from("vessels").insert(add.map(function (n) { return { company_id: company.id, code: n, name: n }; })).then(function (r) { if (r.error) alert(r.error.message); else reload(); });
    });
    if ($("vsEdit")) $("vsEdit").addEventListener("click", function () { openVessel(rt.id); });
    if ($("vsDown")) $("vsDown").addEventListener("click", function () { openStatus(rt.id); });
    if ($("vsRelease")) $("vsRelease").addEventListener("click", function () { openRelease(rt.id); });
    on("[data-compnew]", function (b) { openComponent(null, b.dataset.compnew); });
    on("[data-compedit]", function (b) { openComponent(b.dataset.compedit); });
    on("[data-hours]", function (b) { openHours(b.dataset.hours); });
    on("[data-schnew]", function (b) { openSchedule(null, b.dataset.schnew); });
    on("[data-schedit]", function (b) { openSchedule(b.dataset.schedit); });
    on("[data-schf]", function (b) { schFilter = b.dataset.schf; render(); });
    on("[data-schwo]", function (b) {
      var s = d.schedules.filter(function (x) { return x.id === b.dataset.schwo; })[0], x = schState(s);
      openWoForm(null, s.vessel_id, { title: s.title, kind: "Preventive", component_id: s.component_id, schedule_id: s.id, work_required: s.tasks || "", due_on: x.next_on || null, priority: x.state === "overdue" ? "High" : "Medium" });
    });
    on("[data-wonew]", function (b) { openWoForm(null, b.dataset.wonew); });
    on("[data-wof]", function (b) { woFilter = b.dataset.wof; render(); });
    on("[data-defnew]", function (b) { openDefect(b.dataset.defnew); });
    on("[data-deff]", function (b) { defFilter = b.dataset.deff; render(); });
    if (rt.view === "workorders" && rt.id) {
      var id = rt.id, w = d.wos.filter(function (x) { return x.id === id; })[0], msg = function (t, k) { var m = $("mMsgInline"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } };
      var progress = function () { return $("pDone") ? { labour_hours: $("pHours").value, cost_labour: $("pLab").value, cost_parts: $("pParts").readOnly ? undefined : $("pParts").value, cost_other: $("pOther").value, parts_used: $("pPartsUsed").value, work_done: $("pDone").value } : {}; };
      if ($("woEdit")) $("woEdit").addEventListener("click", function () { openWoForm(id); });
      on("[data-wost]", function (b) { rpc("wo_progress", { p_id: id, p_patch: Object.assign(progress(), { status: b.dataset.wost }) }).then(reload).catch(function (e) { msg(e.message, "err"); }); });
      if ($("pSave")) $("pSave").addEventListener("click", function () { rpc("wo_progress", { p_id: id, p_patch: progress() }).then(function () { return reload(); }).catch(function (e) { msg(e.message, "err"); }); });
      if ($("pHours") && $("pLab")) {
        var applySug = function () {
          var sug = suggestLabourCost(w, $("pHours").value);
          if (sug != null) $("pLab").value = sug;
        };
        $("pHours").addEventListener("change", function () { if (!$("pLab").value || $("pLab").dataset.auto === "1") { applySug(); $("pLab").dataset.auto = "1"; } });
        $("pLab").addEventListener("input", function () { $("pLab").dataset.auto = ""; });
        if ($("pLabSug")) $("pLabSug").addEventListener("click", function () { applySug(); $("pLab").dataset.auto = "1"; });
      }
      if ($("woDone")) $("woDone").addEventListener("click", function () {
        var c = w.component_id ? comp(w.component_id) : null, done = $("pDone") ? $("pDone").value.trim() : "";
        if (done.length < 2) { msg("Describe the work performed first.", "err"); if ($("pDone")) $("pDone").focus(); return; }
        rpc("wo_progress", { p_id: id, p_patch: progress() }).then(function () { return rpc("complete_work_order", { p_id: id, p_work_done: done, p_hours: c && c.tracks_hours ? Number(c.hours) : null }); })
          .then(reload).catch(function (e) { msg(e.message, "err"); });
      });
      var decide = function (ok) {
        var need = formSetting("10_maintenance_approval_rules", "Maintenance Approval Rules").comment === true;
        openModal('<h2>' + (ok ? "Approve " : "Send back ") + esc(w.code) + '</h2><p class="note">' + esc(w.title) + ' · completed by ' + esc(nameOf(w.completed_by)) + '</p>' +
          (w.work_done ? '<p class="hint">' + esc(w.work_done) + '</p>' : "") + '<div class="fld"><label for="apNote">' + (ok ? "Comment" + (need ? "" : " (optional)") : "What still needs doing?") + '</label><textarea id="apNote" rows="3" maxlength="300"></textarea></div>' +
          '<p class="msg" id="mMsg" role="status"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="' + (ok ? "save" : "ghost danger") + '" id="apGo">' + (ok ? "Approve" : "Send back") + '</button></div>');
        $("apGo").addEventListener("click", function () {
          var n = $("apNote").value.trim(); if (!ok && n.length < 2) { say("Say what still needs doing.", "err"); return; }
          rpc("approve_work_order", { p_id: id, p_ok: ok, p_note: n || null }).then(function () { closeModal(); return reload(); }).catch(function (e) { say(e.message, "err"); });
        });
      };
      if ($("woOk")) $("woOk").addEventListener("click", function () { decide(true); });
      if ($("woBack")) $("woBack").addEventListener("click", function () { decide(false); });
      if ($("woClose")) $("woClose").addEventListener("click", function () {
        var close = function () { db.from("work_orders").update({ status: "Closed" }).eq("id", id).then(function (r) { if (r.error) msg(r.error.message, "err"); else reload(); }); };
        if (!(docReqs().reportClose && w.contractor)) { close(); return; }
        var have = cache["f:work_order:" + id];
        var go = function (files) {
          if (!files || !files.length) { msg("Add a service report or photo before closing a contractor job (Maintenance Settings → Document Requirements).", "err"); return; }
          close();
        };
        if (have) go(have);
        else db.from("maint_files").select("id").eq("ref_type", "work_order").eq("ref_id", id).then(function (r) { go(r.data || []); });
      });
    }
    if (rt.view === "defects" && rt.id) {
      var df = d.defects.filter(function (x) { return x.id === rt.id; })[0];
      if ($("dfEdit")) $("dfEdit").addEventListener("click", function () { openDefectEdit(rt.id); });
      if ($("dfClose")) $("dfClose").addEventListener("click", function () { db.from("defects").update({ status: "Closed" }).eq("id", rt.id).then(function (r) { if (r.error) alert(r.error.message); else reload(); }); });
      if ($("dfWo")) $("dfWo").addEventListener("click", function () {
        openWoForm(null, df.vessel_id, { title: "Repair: " + df.title, kind: df.kind === "Breakdown" ? "Breakdown" : "Corrective", component_id: df.component_id, defect_id: df.id, problem: [df.symptoms, df.fault_code ? "Fault code " + df.fault_code : ""].filter(Boolean).join("\n"), priority: df.severity === "Critical" ? "Critical" : df.severity === "Major" ? "High" : "Medium", category: df.category });
      });
    }
    // inspections
    if ($("iStart")) $("iStart").addEventListener("click", function () {
      var cl = d.checklists.filter(function (c) { return c.id === $("iList").value; })[0]; if (!cl) return;
      cache.iVessel = $("iVessel").value; cache.iList = cl.id; $("iForm").innerHTML = inspForm(cl);
      var count = function () { var n = document.querySelectorAll(".mt-item").length, a = document.querySelectorAll('.mt-item [aria-checked="true"]').length, f = document.querySelectorAll('.mt-item [data-res="fail"][aria-checked="true"]').length; $("iCount").textContent = a + " of " + n + " answered" + (f ? " · " + f + " failed" : ""); };
      count();
      on(".mt-seg button", function (b) {
        [].forEach.call(b.parentNode.children, function (x) { x.setAttribute("aria-checked", "false"); }); b.setAttribute("aria-checked", "true");
        var note = b.closest(".mt-item").querySelector(".mt-note"); note.hidden = b.dataset.res !== "fail"; if (!note.hidden) note.focus(); count();
      });
      $("iSubmit").addEventListener("click", function () {
        var res = [], missing = 0;
        [].forEach.call(document.querySelectorAll(".mt-item"), function (row) {
          var it = cl.items[Number(row.dataset.item)], on2 = row.querySelector('[aria-checked="true"]');
          if (!on2) { missing++; return; }
          res.push({ text: it.text, area: it.area, critical: !!it.critical, result: on2.dataset.res, note: row.querySelector(".mt-note").value.trim() || null });
        });
        var m = $("mMsgInline");
        if (missing) { m.textContent = missing + " item" + (missing > 1 ? "s are" : " is") + " not answered yet."; m.className = "msg err"; return; }
        var critFail = res.filter(function (r) { return r.result === "fail" && r.critical; }).length;
        if (critFail && !confirm(critFail + " critical item" + (critFail > 1 ? "s" : "") + " failed. This takes the vessel out of service. Submit?")) return;
        rpc("submit_inspection", { p_company: company.id, p_vessel: cache.iVessel, p_checklist: cl.id, p_results: res, p_note: $("iNote").value.trim() || null })
          .then(function (out) { location.hash = "#inspections/" + out.id; return reload(); }).catch(function (e) { m.textContent = e.message; m.className = "msg err"; });
      });
    });
    if ($("clAdd")) $("clAdd").addEventListener("click", function () { openChecklist(null); });
    on("[data-cledit]", function (b) { openChecklist(b.dataset.cledit); });
    // files — drop zone + auto-upload on select
    function doUpload(file) {
      var inp = $("fUp"), m = $("fMsg"), go = $("fUpGo");
      if (!inp || !file) { if (m) { m.textContent = "Choose a file first."; m.className = "msg err"; } return; }
      if (m) { m.textContent = "Uploading " + file.name + "…"; m.className = "msg"; }
      if (go) { go.hidden = true; go.disabled = true; }
      var drop = $("fDrop");
      if (drop) drop.classList.add("busy");
      uploadFile(inp.dataset.ft, inp.dataset.fid, inp.dataset.fv || null, file).then(function () {
        delete cache["f:" + inp.dataset.ft + ":" + inp.dataset.fid];
        delete cache["v:" + inp.dataset.fid];
        render();
      }).catch(function (e) {
        if (m) { m.textContent = e.message; m.className = "msg err"; }
        if (go) { go.hidden = false; go.disabled = false; }
        if (drop) drop.classList.remove("busy");
      });
    }
    if ($("fUp")) $("fUp").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var go = $("fUpGo"), m = $("fMsg");
      if (go) { go.hidden = false; go.textContent = "Upload " + f.name; }
      if (m) { m.textContent = f.name + " ready — uploading…"; m.className = "msg"; }
      doUpload(f);
    });
    if ($("fUpGo")) $("fUpGo").addEventListener("click", function () {
      var inp = $("fUp"); doUpload(inp && inp.files && inp.files[0]);
    });
    var drop = $("fDrop");
    if (drop) {
      ["dragenter", "dragover"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add("over"); });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove("over"); });
      });
      drop.addEventListener("drop", function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f || !$("fUp")) return;
        try {
          var dt = new DataTransfer();
          dt.items.add(f);
          $("fUp").files = dt.files;
        } catch (err) { /* older browsers: upload directly */ }
        doUpload(f);
      });
    }
    on("[data-fdl]", function (b) { db.storage.from("maintenance").createSignedUrl(b.dataset.fdl, 300).then(function (r) { if (r.error) alert(r.error.message); else window.open(r.data.signedUrl, "_blank", "noopener"); }); });
    on("[data-fdel]", function (b) {
      if (!confirm("Remove this file?")) return;
      db.storage.from("maintenance").remove([b.dataset.fp]).then(function () { return db.from("maint_files").delete().eq("id", b.dataset.fdel); }).then(function () { cache = {}; render(); });
    });
  }

  /* ---------- dialogs ---------- */
  function openModal(html, wide) { $("modalCard").className = "modal-card" + (wide ? " wide" : ""); $("modalCard").innerHTML = html; $("modal").hidden = false; var f = $("modalCard").querySelector("input,select,textarea"); if (f) f.focus(); }
  function closeModal() { $("modal").hidden = true; $("modalCard").innerHTML = ""; }
  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  window.addEventListener("hashchange", function () { if (!$("modal").hidden) closeModal(); render(); window.scrollTo(0, 0); });

  /* ---------- start ---------- */
  window.VeyoraShell.start({
    active: "Maintenance",
    onCompany: function (c, info) {
      company = c; ctx = info; d = null; cache = {};
      $("mt").innerHTML = '<p class="msg">Loading…</p>';
      db.rpc("scan_maintenance", { p_company: c.id }).then(function () {}, function () {});
      db.rpc("scan_low_stock", { p_company: c.id }).then(function () {}, function () {});
      return load().then(function () {
        render();
        if (window.VeyoraTip) window.VeyoraTip("mt1", isMaint ? [
          "Start with **Vessels**: add each vessel, then its engines with their hour meter readings.",
          "Add **Preventive schedules** by days and/or running hours. Due and overdue services show on the overview and send reminders.",
          "**Defects** can take a vessel out of service; only **Return to service** puts it back, following Maintenance Settings."
        ] : ["**Report a defect** or start an **Inspection** from your phone. Log engine hours on the vessel page."]);
      });
    },
    onNone: function () { $("mt").innerHTML = '<section class="dash-card"><h2>No company yet</h2><p class="note">Ask your administrator for an invite.</p></section>'; },
    onError: function (err) { $("mt").innerHTML = '<section class="dash-card"><h2>Could not load Maintenance</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
