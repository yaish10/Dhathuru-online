/* IT: one page with sections (it.html#overview, #networks, #devices, #assets, #tickets[/<id>], #log, #people).
   Owners, admins and people with the IT role run it; everyone else sees their own devices and support tickets.
   Rules come from IT Settings (keys 17_): Mobile Check-in & Check-out, Device Management, Alerts & Notifications. */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc, cap = window.VeyoraShell.cap;
  var $ = function (id) { return document.getElementById(id); };
  var company = null, ctx = null, data = null, isIT = false, net = null;
  var logKind = "", logOutcome = "", logText = "", logDays = 7, tkStatus = "open", assetKind = "";

  /* ---------- helpers ---------- */
  function setting(key) { return company && company.settings ? company.settings[key] : undefined; }
  function formSetting(key, title) {
    var saved = setting(key), spec = window.VEYORA_DEFS && window.VEYORA_DEFS[title], base = spec && (spec.base || spec), out = {};
    (base && base.fields || []).forEach(function (f) { out[f.k] = f.d; });
    if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function checkin() { return formSetting("17_mobile_check_in_and_check_out", "Mobile Check-in & Check-out"); }
  function ticketSla() { return formSetting("17_it_support_and_incident_management", "IT Support & Incident Management"); }
  function assetRules() { return formSetting("17_it_asset_management", "IT Asset Management"); }
  function securityPol() { return formSetting("17_security_policies", "Security Policies"); }
  function slaLine() {
    var s = ticketSla();
    return "Answer within: urgent " + (Number(s.urgent) || 4) + " h, high " + (Number(s.high) || 24) + " h, normal " + (Number(s.normal) || 72) + " h, low " + (Number(s.low) || 168) + " h (IT → Settings → IT Support).";
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayIso() { return iso(new Date()); }
  function addDaysIso(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function fmtDate(s) { return s ? new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
  function when(ts) { if (!ts) return "—"; var d = new Date(ts); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
  function ago(ts) {
    if (!ts) return "never"; var m = Math.round((Date.now() - new Date(ts)) / 6e4);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
  function initials(n) { return String(n).split(/\s+/).filter(Boolean).slice(0, 2).map(function (s) { return s[0]; }).join("").toUpperCase(); }
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  var I = {
    net: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
    dev: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>', box: '<path d="M3 7l9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10"/>',
    tk: '<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M14 7v12"/>', log: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
    ppl: '<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 3-5.5 6-5.5s6 2.2 6 5.5M16 5a3.5 3.5 0 0 1 0 6.5M21 20c0-2.4-1.5-4.2-3.6-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', ok: '<path d="m5 12 5 5 9-10"/>', warn: '<path d="M12 4 3 20h18L12 4ZM12 10v4M12 17h.01"/>', back: '<path d="M15 6l-6 6 6 6"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/>'
  };
  function chip(text, cls) { return '<span class="chip ' + (cls || "st-" + slug(text)) + '">' + esc(text) + '</span>'; }
  function empty(t) { return '<div class="empty-hr">' + t + '</div>'; }
  function kpi(tone, ic, label, value, sub, href) {
    return '<' + (href ? 'a href="' + href + '" class="kpi kpi-link"' : 'div class="kpi"') + '><span class="tile tone-' + tone + '">' + icon(ic) + '</span><span class="kbody"><small>' + label + '</small><strong>' + value + '</strong><span class="kpi-row"><span class="kpi-sub">' + sub + '</span></span></span></' + (href ? "a" : "div") + '>';
  }
  function options(list, cur, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : "") + list.map(function (p) { var v = Array.isArray(p) ? p[0] : p, t = Array.isArray(p) ? p[1] : p; return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + '>' + esc(t) + '</option>'; }).join(""); }
  function itOnly(what) { return '<section class="dash-card">' + empty(what + " is for IT, owners and admins. You can see your own devices and support tickets here.") + '</section>'; }
  function rpc(name, args) { return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }
  function nameOf(uid) { var p = data && data.people[uid]; return p ? p.name : uid ? "Someone" : "—"; }
  function deptName(id) { var d = data && data.depts.filter(function (x) { return x.id === id; })[0]; return d ? d.name : ""; }

  // This browser's device ID (kept on the device, used by the clock-in device rule).
  function deviceKey() {
    var k = null; try { k = localStorage.getItem("veyora-device-key"); } catch (e) {}
    if (!k) { var a = new Uint8Array(16); crypto.getRandomValues(a); k = [].map.call(a, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); try { localStorage.setItem("veyora-device-key", k); } catch (e) {} }
    return k;
  }
  function deviceGuess() {
    var ua = navigator.userAgent, kind = /iPad|Tablet/i.test(ua) ? "Tablet" : /Mobi|iPhone|Android/i.test(ua) ? "Phone" : "Computer";
    var os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "Device";
    var br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
    return { kind: kind, label: os + (br ? " · " + br : "") };
  }
  // IPv4 range check, so IT can test an address against the list before saving rules.
  function ipNum(ip) { var p = String(ip).split("."); if (p.length !== 4 || p.some(function (x) { return !/^\d+$/.test(x) || +x > 255; })) return null; return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + (+p[3]); }
  function inCidr(ip, cidr) {
    var c = String(cidr).split("/"), base = ipNum(c[0]), n = ipNum(ip), bits = c[1] == null ? 32 : +c[1];
    if (base == null || n == null) return String(cidr).split("/")[0] === String(ip);
    if (bits === 0) return true; var mask = (~0 << (32 - bits)) >>> 0; return ((n & mask) >>> 0) === ((base & mask) >>> 0);
  }
  function netFor(ip) { return ip ? data.networks.filter(function (n) { return n.active && (!n.expires_at || new Date(n.expires_at) > new Date()) && inCidr(ip, n.cidr); })[0] : null; }

  /* ---------- data ---------- */
  function load() {
    var c = company.id, jobs = [
      rpc("it_network_status", { p_company: c }).catch(function () { return null; }),
      db.from("company_members").select("user_id, role, role_label, active, department_id, employment_status").eq("company_id", c),
      db.from("departments").select("id, name").eq("company_id", c).order("name"),
      db.from("it_devices").select("*").eq("company_id", c).order("created_at", { ascending: false }),
      db.from("it_tickets").select("*").eq("company_id", c).order("number", { ascending: false }).limit(300),
      db.from("it_assets").select("*").eq("company_id", c).order("name")
    ];
    if (isIT) jobs.push(db.from("it_networks").select("*").eq("company_id", c).order("created_at"));
    return Promise.all(jobs).then(function (r) {
      for (var i = 1; i < r.length; i++) if (r[i] && r[i].error) throw new Error(r[i].error.message);
      net = r[0];
      var ids = (r[1].data || []).map(function (m) { return m.user_id; });
      return db.from("profiles").select("id, full_name, email").in("id", ids).then(function (p) {
        var people = {};
        (r[1].data || []).forEach(function (m) { people[m.user_id] = { uid: m.user_id, role: m.role, label: m.role_label, active: m.active, dept: m.department_id, status: m.employment_status || "Active", name: "Unknown", email: "" }; });
        (p.data || []).forEach(function (x) { if (people[x.id]) { people[x.id].name = x.full_name || (x.email || "").split("@")[0]; people[x.id].email = x.email || ""; } });
        data = { people: people, depts: r[2].data || [], devices: r[3].data || [], tickets: r[4].data || [], assets: r[5].data || [], networks: isIT ? (r[6].data || []) : [] };
      });
    });
  }
  function reload() { return load().then(render); }

  /* ---------- routing ---------- */
  var VIEWS = ["overview", "networks", "devices", "assets", "tickets", "log", "people", "settings"];
  function route() { var h = (location.hash || "#overview").slice(1).split("/"); return { view: VIEWS.indexOf(h[0]) > -1 ? h[0] : "overview", id: h[1] || "" }; }
  var TITLES = { overview: ["IT", "Networks, devices, assets and support for your company."], networks: ["Networks", "Approved office and VPN networks, and which network you are on now."],
    devices: ["Devices", "Phones, computers and attendance terminals used for VEYORA."], assets: ["IT assets", "Company computers, phones, servers, network kit and licences."],
    tickets: ["Support tickets", "Report a problem to IT and follow it until it is fixed."], log: ["Activity log", "Clock-in checks, refused attempts, devices, assets, tickets and settings changes."],
    people: ["Who has access", "Everyone's role and what it lets them open."],
    settings: ["IT settings", "Access, sign-in, devices, integrations and security for this company."] };

  function render() {
    if (!data) return;
    var rt = route(), t = TITLES[rt.view];
    $("itTitle").textContent = t[0]; $("itSub").textContent = t[1];
    var v = rt.view;
    if (v === "settings") {
      if (!isIT) { location.hash = "#overview"; return; }
      $("it").innerHTML = '<section class="dash-card" id="pageSettings"></section>';
      if (window.PageSettings) window.PageSettings.mount($("pageSettings"), {
        area: "it", pill: rt.id, esc: esc, company: function () { return company; }, db: db, rpc: rpc, canEdit: isIT
      });
      return;
    }
    var html = v === "networks" ? networks() : v === "devices" ? devices() : v === "assets" ? assets() : v === "tickets" ? (rt.id ? ticket(rt.id) : tickets()) : v === "log" ? logView() : v === "people" ? people() : overview();
    $("it").innerHTML = html;
    bind(rt);
    if (v === "log" && isIT) loadLog();
    if (v === "tickets" && rt.id) loadNotes(rt.id);
  }

  /* ---------- overview ---------- */
  function netCard() {
    var ci = checkin(), ok = net && net.approved;
    return '<section class="dash-card it-net ' + (ok ? "good" : "bad") + '"><div class="it-net-ic">' + icon(ok ? I.ok : I.net) + '</div><div class="grow"><small>Your network right now</small>' +
      '<strong>' + (net && net.ip ? esc(net.ip) : "Unknown") + '</strong><p class="note">' + (ok ? "Approved: " + esc(net.network) + " (" + esc(net.kind) + ")" : net && net.networks ? "Not an approved network" : "No approved networks set up yet") +
      ' · Clock-in from the app: <b>' + esc(ci.enabled === false ? "off" : ci.network) + '</b>' + (ci.device === "Registered devices only" ? ", registered devices only" : "") + '</p></div>' +
      (isIT && net && net.ip && !ok ? '<button type="button" class="save" data-addnet="' + esc(net.ip) + '">Add this network</button>' : "") + '</section>';
  }
  function overview() {
    var me = deviceKey(), mine = data.devices.filter(function (d) { return d.device_key === me; })[0];
    if (!isIT) {
      var myT = data.tickets.filter(function (t) { return t.requester === ctx.me; });
      return netCard() + thisDevice(mine) +
        '<section class="dash-card"><div class="card-head"><div><h2>My support tickets</h2><p class="note">Something not working? Tell IT here.</p></div><button type="button" class="save" id="tkNew">Report a problem</button></div>' +
        (myT.length ? ticketRows(myT.slice(0, 8)) : empty("You have no tickets.")) + '</section>';
    }
    var pend = data.devices.filter(function (d) { return d.status === "Pending"; }), open = data.tickets.filter(function (t) { return t.status !== "Resolved" && t.status !== "Closed"; });
    var late = open.filter(function (t) { return t.due_at && new Date(t.due_at) < new Date(); });
    var ar = assetRules(), wd = Number(ar.warrantyDays) || 30, rd = Number(ar.renewDays) || 30, warnDays = Math.max(wd, rd);
    var soon = data.assets.filter(function (a) {
      if (a.status === "Retired") return false;
      return (a.warranty_until && a.warranty_until <= addDaysIso(wd)) || (a.renews_on && a.renews_on <= addDaysIso(rd));
    });
    var ci = checkin(), pol = securityPol(), warns = [];
    if (ci.network === "Approved networks only" && !data.networks.filter(function (n) { return n.active; }).length) warns.push(["red", "Clock-in needs an approved network, but none is set up", "Nobody can clock in from the app until you add one.", "#networks"]);
    if (ci.device === "Registered devices only" && pend.length) warns.push(["amber", pend.length + " device" + (pend.length > 1 ? "s" : "") + " waiting for approval", "These people cannot clock in until you approve.", "#devices"]);
    else if (pend.length) warns.push(["amber", pend.length + " device" + (pend.length > 1 ? "s" : "") + " waiting for approval", "Approve or block them.", "#devices"]);
    if (late.length) warns.push(["red", late.length + " ticket" + (late.length > 1 ? "s are" : " is") + " past the answer time", late.map(function (t) { return "#" + t.number; }).join(", "), "#tickets"]);
    if (soon.length) warns.push(["blue", soon.length + " warranty or licence date" + (soon.length > 1 ? "s" : "") + " within " + warnDays + " days", soon.slice(0, 3).map(function (a) { return a.name; }).join(", "), "#assets"]);
    return '<div class="kpis">' +
      kpi("blue", I.net, "Approved networks", data.networks.filter(function (n) { return n.active; }).length, "Clock-in from: " + esc(ci.enabled === false ? "off" : ci.network), "#networks") +
      kpi("teal", I.dev, "Devices", data.devices.filter(function (d) { return d.status === "Approved"; }).length, pend.length + " waiting · " + data.devices.filter(function (d) { return d.status === "Blocked"; }).length + " blocked", "#devices") +
      kpi("orange", I.tk, "Open tickets", open.length, late.length ? late.length + " past the answer time" : "All within time", "#tickets") +
      kpi("purple", I.box, "Assets", data.assets.filter(function (a) { return a.status !== "Retired"; }).length, soon.length + " dates within " + warnDays + " days", "#assets") + '</div>' +
      netCard() +
      (pol.notes ? '<section class="dash-card"><h2>Security policy</h2><p class="note">' + esc(pol.notes) + '</p><p class="hint">' + (pol.adminNetwork ? "Admins and HR need an approved network for HR, IT and Settings. " : "") + (pol.emergency !== false ? "The owner can open those pages from any network." : "Emergency owner bypass is off.") + ' <a href="#settings/security_policies">Edit</a></p></section>' : "") +
      '<div class="hr-grid"><div class="col"><section class="dash-card"><div class="card-head"><div><h2>Needs attention</h2><p class="note">Click an item to deal with it</p></div></div>' +
      (warns.length ? '<ul class="attn">' + warns.map(function (w) { return '<li><a href="' + w[3] + '"><span class="attn-dot ' + w[0] + '"></span><span class="grow"><strong>' + esc(w[1]) + '</strong><small>' + esc(w[2]) + '</small></span>' + icon('<path d="m9 6 6 6-6 6"/>') + '</a></li>'; }).join("") + '</ul>' : empty("Nothing needs attention right now.")) + '</section>' +
      '<section class="dash-card"><h2>IT Settings</h2><p class="note">How networks, devices, clock-in, alerts and support work for ' + esc(company.name) + '.</p><div class="qa">' +
      [["Clock-in rules", "mobile_check_in_and_check_out", I.ok], ["Network rules", "network_and_ip_restrictions", I.net], ["Device rules", "device_management", I.dev], ["Modules", "module_and_feature_management", I.log], ["Alerts", "alerts_and_notifications", I.warn], ["Support times", "it_support_and_incident_management", I.tk], ["Sign-in", "session_timeout", I.shield], ["All IT settings", "", I.shield]].map(function (x) {
        return '<a class="qa-btn" href="#settings' + (x[1] ? "/" + x[1] : "") + '">' + icon(x[2]) + '<span>' + x[0] + '</span></a>';
      }).join("") + '</div></section></div>' +
      '<div class="col">' + thisDevice(mine) + '<section class="dash-card"><div class="card-head"><h2>Latest tickets</h2><a class="btn-soft" href="#tickets">Open</a></div>' + (open.length ? ticketRows(open.slice(0, 5)) : empty("No open tickets.")) + '</section></div></div>';
  }
  function thisDevice(mine) {
    var g = deviceGuess();
    return '<section class="dash-card"><h2>This device</h2>' + (mine ? '<ul class="rows"><li class="row"><span class="grow"><strong>' + esc(mine.label) + '</strong><small>' + esc(mine.kind) + ' · registered ' + fmtDate(mine.created_at) + '</small></span>' + chip(mine.status, "st-dev-" + slug(mine.status)) + '</li></ul>' +
      (mine.status === "Pending" ? '<p class="hint">Waiting for IT to approve it.</p>' : mine.status === "Blocked" ? '<p class="hint">IT has blocked this device. Ask IT if this is a mistake.</p>' : "") :
      '<p class="note">Register this ' + esc(g.kind.toLowerCase()) + ' so you can clock in from it when IT requires registered devices.</p><div class="inv"><input id="devLabel" maxlength="80" value="' + esc(g.label) + '" aria-label="Name for this device"><select id="devKind" aria-label="Kind">' + options(["Phone", "Computer", "Tablet", "Attendance terminal"], g.kind) + '</select><button type="button" class="save" id="devReg">Register this device</button></div>') +
      '<p class="msg" id="devMsg" role="status"></p></section>';
  }

  /* ---------- networks ---------- */
  function networks() {
    if (!isIT) return netCard();
    var ci = checkin(), list = data.networks;
    return netCard() + (ci.network === "Approved networks only" && net && !net.approved ? '<p class="msg err it-banner">Clock-in is set to approved networks only, and the network you are on now is not on the list.</p>' : "") +
      '<section class="dash-card"><div class="card-head"><div><h2>Approved networks</h2><p class="note">Add your office\'s public IP address, or a range such as 203.0.113.0/24. VPN and branch networks work the same way. Temporary networks stop working on their end date.</p></div><button type="button" class="save" id="netAdd">' + icon(I.plus) + ' Add network</button></div>' +
      (list.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Network</th><th>IP or range</th><th>Kind</th><th>Status</th><th>Ends</th><th></th></tr></thead><tbody>' + list.map(function (n) {
        var exp = n.expires_at && new Date(n.expires_at) < new Date(), here = net && net.ip && inCidr(net.ip, n.cidr);
        return '<tr><td><strong>' + esc(n.name) + '</strong>' + (here ? ' <span class="chip st-present">You are here</span>' : "") + (n.note ? '<span class="th-sub">' + esc(n.note) + '</span>' : "") + '</td><td><code>' + esc(n.cidr) + '</code></td><td class="muted-cell">' + esc(n.kind) + '</td>' +
          '<td>' + (exp ? chip("Ended", "st-off-duty") : n.active ? chip("On", "st-present") : chip("Off", "st-off-duty")) + '</td><td class="muted-cell">' + (n.expires_at ? when(n.expires_at) : "—") + '</td>' +
          '<td><button type="button" class="ghost manage-btn" data-netedit="' + n.id + '">Edit</button> <button type="button" class="ghost danger manage-btn" data-netdel="' + n.id + '">Remove</button></td></tr>';
      }).join("") + '</tbody></table></div>' : empty("No approved networks yet. Start with “Add this network” above when you are in the office.")) + '</section>' +
      '<section class="dash-card"><h2>Network check</h2><p class="note">Test an address before you change the rules, so nobody is locked out.</p><div class="inv"><input id="netTest" placeholder="e.g. 203.0.113.25" value="' + esc(net && net.ip || "") + '" aria-label="IP address"><button type="button" class="ghost" id="netTestGo">Check</button></div><p class="msg" id="netTestOut" role="status"></p>' +
      '<ul class="it-steps"><li>Add the office network while you are in the office.</li><li>Check that “You are here” shows on it.</li><li>Then open <a href="#settings/mobile_check_in_and_check_out">Settings → Mobile Check-in &amp; Check-out</a> and set Allowed from to “Approved networks only”.</li></ul></section>';
  }
  function openNet(id, ip) {
    var n = id ? data.networks.filter(function (x) { return x.id === id; })[0] : { name: "", cidr: ip || "", kind: "Office", active: true, expires_at: null, note: "" };
    var dt = n.expires_at ? new Date(n.expires_at) : null, local = dt ? iso(dt) + "T" + pad2(dt.getHours()) + ":" + pad2(dt.getMinutes()) : "";
    openModal('<h2>' + (id ? "Edit network" : "Add network") + '</h2><p class="note">Staff on this network count as “in the office” for clock-in rules.</p>' +
      '<div class="cards"><div class="fld"><label for="nName">Name</label><input id="nName" maxlength="60" value="' + esc(n.name) + '" placeholder="e.g. Malé head office Wi-Fi"></div>' +
      '<div class="fld"><label for="nCidr">Public IP or range</label><input id="nCidr" maxlength="50" value="' + esc(n.cidr) + '" placeholder="203.0.113.25 or 203.0.113.0/24"><small class="hint">A single address means just that address.</small></div>' +
      '<div class="fld"><label for="nKind">Kind</label><select id="nKind">' + options(["Office", "Branch", "VPN", "Temporary"], n.kind) + '</select></div>' +
      '<div class="fld"><label for="nExp">Ends (optional)</label><input id="nExp" type="datetime-local" value="' + local + '"><small class="hint">For a temporary network, e.g. a site visit.</small></div></div>' +
      '<div class="fld"><label for="nNote">Note (optional)</label><input id="nNote" maxlength="200" value="' + esc(n.note || "") + '"></div>' +
      '<label class="chk"><input type="checkbox" id="nOn"' + (n.active ? " checked" : "") + '> Network is on</label><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="nGo">Save</button></div>');
    $("nGo").addEventListener("click", function () {
      var row = { name: $("nName").value.trim(), cidr: $("nCidr").value.trim(), kind: $("nKind").value, note: $("nNote").value.trim() || null, active: $("nOn").checked, expires_at: $("nExp").value ? new Date($("nExp").value).toISOString() : null };
      if (row.name.length < 2) { say("Give the network a name.", "err"); return; }
      if (!/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(row.cidr)) { say("Enter an IP address like 203.0.113.25 or a range like 203.0.113.0/24.", "err"); return; }
      var q = id ? db.from("it_networks").update(row).eq("id", id) : db.from("it_networks").insert(Object.assign(row, { company_id: company.id, created_by: ctx.me }));
      q.then(function (r) { if (r.error) { say(/cidr|inet/i.test(r.error.message) ? "That is not a valid IP address or range. For a range, the last part must be 0 (e.g. 203.0.113.0/24)." : r.error.message, "err"); return; } closeModal(); reload(); });
    });
  }

  /* ---------- devices ---------- */
  function devices() {
    var me = deviceKey(), mine = data.devices.filter(function (d) { return d.device_key === me; })[0];
    var list = isIT ? data.devices : data.devices.filter(function (d) { return d.user_id === ctx.me || d.registered_by === ctx.me; });
    var ci = checkin();
    return (isIT ? "" : thisDevice(mine)) + '<section class="dash-card"><div class="card-head"><div><h2>' + (isIT ? "All devices" : "My devices") + '</h2><p class="note">' +
      (ci.device === "Registered devices only" ? "Clock-in needs an approved, registered device." : "Clock-in works from any device now; registering is still useful for IT to know who uses what.") + (isIT ? " Shared attendance terminals can be marked as kiosks so anyone can clock in on them." : "") + '</p></div></div>' +
      (list.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Device</th><th>Person</th><th>Kind</th><th>Status</th><th>Last used</th>' + (isIT ? '<th></th>' : "") + '</tr></thead><tbody>' + list.map(function (d) {
        return '<tr><td><strong>' + esc(d.label) + '</strong>' + (d.device_key === me ? ' <span class="chip st-present">This device</span>' : "") + (d.kiosk ? ' <span class="chip st-training">Kiosk</span>' : "") + '</td>' +
          '<td>' + esc(d.kiosk ? "Shared" : nameOf(d.user_id)) + (d.department_id ? '<span class="th-sub">' + esc(deptName(d.department_id)) + '</span>' : "") + '</td><td class="muted-cell">' + esc(d.kind) + '</td>' +
          '<td>' + chip(d.status, "st-dev-" + slug(d.status)) + '</td><td class="muted-cell">' + ago(d.last_seen_at) + (d.last_ip ? '<span class="th-sub">' + esc(d.last_ip) + '</span>' : "") + '</td>' +
          (isIT ? '<td class="it-acts">' + (d.status !== "Approved" ? '<button type="button" class="save manage-btn" data-dev="' + d.id + '" data-st="Approved">Approve</button>' : "") +
            (d.status !== "Blocked" ? '<button type="button" class="ghost danger manage-btn" data-dev="' + d.id + '" data-st="Blocked">Block</button>' : "") +
            '<button type="button" class="ghost manage-btn" data-devedit="' + d.id + '">Edit</button></td>' : "") + '</tr>';
      }).join("") + '</tbody></table></div>' : empty(isIT ? "No devices registered yet. Staff register theirs on IT → Devices." : "You have no registered devices.")) + '</section>';
  }
  function openDevice(id) {
    var d = data.devices.filter(function (x) { return x.id === id; })[0]; if (!d) return;
    var ppl = Object.keys(data.people).map(function (k) { return data.people[k]; }).filter(function (p) { return p.active; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    openModal('<h2>Device</h2><p class="note">' + esc(d.label) + ' · registered ' + fmtDate(d.created_at) + (d.last_ip ? " · last from " + esc(d.last_ip) : "") + '</p>' +
      '<div class="cards"><div class="fld"><label for="dLabel">Name</label><input id="dLabel" maxlength="80" value="' + esc(d.label) + '"></div><div class="fld"><label for="dKind">Kind</label><select id="dKind">' + options(["Phone", "Computer", "Tablet", "Attendance terminal"], d.kind) + '</select></div>' +
      '<div class="fld"><label for="dUser">Assigned to</label><select id="dUser">' + options(ppl.map(function (p) { return [p.uid, p.name]; }), d.user_id || "", "Nobody") + '</select></div>' +
      '<div class="fld"><label for="dDept">Department</label><select id="dDept">' + options(data.depts.map(function (x) { return [x.id, x.name]; }), d.department_id || "", "None") + '</select></div></div>' +
      '<label class="chk"><input type="checkbox" id="dKiosk"' + (d.kiosk ? " checked" : "") + '> Shared kiosk: anyone can clock in on it</label>' +
      '<div class="fld" style="margin-top:10px"><label for="dNote">Note</label><input id="dNote" maxlength="200" value="' + esc(d.note || "") + '"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost danger" id="dDel">Remove device</button><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="dGo">Save</button></div>');
    $("dGo").addEventListener("click", function () {
      db.from("it_devices").update({ label: $("dLabel").value.trim() || d.label, kind: $("dKind").value, user_id: $("dUser").value || null, department_id: $("dDept").value || null, kiosk: $("dKiosk").checked, note: $("dNote").value.trim() || null }).eq("id", id)
        .then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
    });
    $("dDel").addEventListener("click", function () {
      if (!confirm("Remove " + d.label + "? It will need to be registered again.")) return;
      db.from("it_devices").delete().eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
    });
  }

  /* ---------- assets ---------- */
  var ASSET_KINDS = ["Computer", "Phone", "Tablet", "Server", "Network", "Printer", "Attendance terminal", "Software licence", "Other"];
  var ASSET_ST = ["In use", "In stock", "Repair", "Retired", "Lost"];
  function assets() {
    var a = assetRules(), wd = Number(a.warrantyDays) || 30, rd = Number(a.renewDays) || 30;
    var list = data.assets.filter(function (x) { return !assetKind || x.kind === assetKind; });
    var flag = function (x) {
      if (x.status === "Retired") return "";
      if (x.warranty_until && x.warranty_until < todayIso()) return '<span class="muted-cell">Warranty ended ' + fmtDate(x.warranty_until) + '</span>';
      if (x.warranty_until && x.warranty_until <= addDaysIso(wd)) return '<span class="exp">Warranty ends ' + fmtDate(x.warranty_until) + '</span>';
      if (x.renews_on && x.renews_on <= addDaysIso(rd)) return '<span class="exp">Renews ' + fmtDate(x.renews_on) + '</span>';
      return "";
    };
    return '<section class="dash-card"><div class="card-head"><div><h2>' + (isIT ? "Asset register" : "Assets assigned to me") + '</h2><p class="note">' + (isIT ? "Everything IT looks after. Warnings show " + wd + " days before a warranty ends and " + rd + " days before a licence renews (<a href=\"#settings/it_asset_management\">IT Asset Management</a>)." : "Equipment the company has given you.") + '</p></div>' +
      (isIT ? '<span class="prof-actions"><select id="asKind" aria-label="Kind">' + options(ASSET_KINDS, assetKind, "All kinds") + '</select><button type="button" class="save" id="asAdd">' + icon(I.plus) + ' Add asset</button></span>' : "") + '</div>' +
      (list.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Asset</th><th>Kind</th><th>Serial</th><th>Assigned to</th><th>Status</th><th>Dates</th>' + (isIT ? '<th></th>' : "") + '</tr></thead><tbody>' + list.map(function (x) {
        return '<tr><td><strong>' + esc(x.name) + '</strong>' + (x.tag ? '<span class="th-sub">' + esc(x.tag) + '</span>' : "") + '</td><td class="muted-cell">' + esc(x.kind) + (x.kind === "Software licence" && x.seats != null ? '<span class="th-sub">' + x.seats + ' seats</span>' : "") + '</td>' +
          '<td class="muted-cell">' + esc(x.serial || "—") + '</td><td>' + esc(x.user_id ? nameOf(x.user_id) : x.department_id ? deptName(x.department_id) : "—") + '</td><td>' + chip(x.status, "st-as-" + slug(x.status)) + '</td>' +
          '<td class="muted-cell">' + (flag(x) || (x.warranty_until ? "Warranty until " + fmtDate(x.warranty_until) : x.renews_on ? "Renews " + fmtDate(x.renews_on) : x.purchased_on ? "Bought " + fmtDate(x.purchased_on) : "—")) + '</td>' +
          (isIT ? '<td><button type="button" class="ghost manage-btn" data-asedit="' + x.id + '">Edit</button></td>' : "") + '</tr>';
      }).join("") + '</tbody></table></div>' : empty(isIT ? "No assets yet. Add computers, phones, network kit and licences." : "Nothing is assigned to you.")) + '</section>';
  }
  function openAsset(id) {
    var x = id ? data.assets.filter(function (a) { return a.id === id; })[0] : { name: "", kind: assetKind || "Computer", status: "In use" };
    var ppl = Object.keys(data.people).map(function (k) { return data.people[k]; }).filter(function (p) { return p.active; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    openModal('<h2>' + (id ? "Edit asset" : "Add asset") + '</h2><div class="cards">' +
      '<div class="fld"><label for="aName">Name</label><input id="aName" maxlength="80" value="' + esc(x.name) + '" placeholder="e.g. Dell Latitude 5440"></div>' +
      '<div class="fld"><label for="aTag">Asset tag</label><input id="aTag" maxlength="40" value="' + esc(x.tag || "") + '" placeholder="e.g. IT-0042"></div>' +
      '<div class="fld"><label for="aKind">Kind</label><select id="aKind">' + options(ASSET_KINDS, x.kind) + '</select></div>' +
      '<div class="fld"><label for="aSerial">Serial number</label><input id="aSerial" maxlength="80" value="' + esc(x.serial || "") + '"></div>' +
      '<div class="fld"><label for="aUser">Assigned to</label><select id="aUser">' + options(ppl.map(function (p) { return [p.uid, p.name]; }), x.user_id || "", "Nobody") + '</select></div>' +
      '<div class="fld"><label for="aDept">Department</label><select id="aDept">' + options(data.depts.map(function (d) { return [d.id, d.name]; }), x.department_id || "", "None") + '</select></div>' +
      '<div class="fld"><label for="aSt">Status</label><select id="aSt">' + options(ASSET_ST, x.status) + '</select></div>' +
      '<div class="fld"><label for="aBought">Bought on</label><input id="aBought" type="date" value="' + esc(x.purchased_on || "") + '"></div>' +
      '<div class="fld"><label for="aWar">Warranty until</label><input id="aWar" type="date" value="' + esc(x.warranty_until || "") + '"></div>' +
      '<div class="fld"><label for="aRen">Licence renews on</label><input id="aRen" type="date" value="' + esc(x.renews_on || "") + '"></div>' +
      '<div class="fld"><label for="aSeats">Licence seats</label><input id="aSeats" type="number" min="0" value="' + (x.seats == null ? "" : x.seats) + '"></div></div>' +
      '<div class="fld"><label for="aNote">Notes (repairs, returns, replacements)</label><textarea id="aNote" rows="2" maxlength="300">' + esc(x.note || "") + '</textarea></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' + (id ? '<button type="button" class="ghost danger" id="aDel">Remove</button>' : "") + '<button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="aGo">Save</button></div>', true);
    $("aGo").addEventListener("click", function () {
      var row = { name: $("aName").value.trim(), tag: $("aTag").value.trim() || null, kind: $("aKind").value, serial: $("aSerial").value.trim() || null, user_id: $("aUser").value || null, department_id: $("aDept").value || null,
        status: $("aSt").value, purchased_on: $("aBought").value || null, warranty_until: $("aWar").value || null, renews_on: $("aRen").value || null, seats: $("aSeats").value === "" ? null : Number($("aSeats").value), note: $("aNote").value.trim() || null };
      if (row.name.length < 2) { say("Give the asset a name.", "err"); return; }
      var q = id ? db.from("it_assets").update(row).eq("id", id) : db.from("it_assets").insert(Object.assign(row, { company_id: company.id }));
      q.then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
    });
    if ($("aDel")) $("aDel").addEventListener("click", function () {
      if (!confirm("Remove " + x.name + " from the register? To keep its history, set it to Retired instead.")) return;
      db.from("it_assets").delete().eq("id", id).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); reload(); } });
    });
  }

  /* ---------- tickets ---------- */
  var TK_PRI = ["Low", "Normal", "High", "Urgent"], TK_ST = ["Open", "In progress", "Waiting", "Resolved", "Closed"], TK_CAT = ["Access & login", "Device", "Network", "App problem", "Hardware", "Other"];
  function ticketRows(list) {
    return '<ul class="rows it-tks">' + list.map(function (t) {
      var late = t.due_at && new Date(t.due_at) < new Date() && t.status !== "Resolved" && t.status !== "Closed";
      return '<li class="row"><a class="it-tk" href="#tickets/' + t.id + '"><span class="it-num">#' + t.number + '</span><span class="grow"><strong>' + esc(t.title) + '</strong><small>' + esc(t.category) + ' · ' + esc(nameOf(t.requester)) + ' · ' + ago(t.created_at) +
        (t.assignee ? ' · with ' + esc(nameOf(t.assignee)) : "") + (late ? ' · <span class="exp">past answer time</span>' : "") + '</small></span>' + chip(t.priority, "st-pri-" + slug(t.priority)) + chip(t.status, "st-tk-" + slug(t.status)) + '</a></li>';
    }).join("") + '</ul>';
  }
  function tickets() {
    var all = isIT ? data.tickets : data.tickets.filter(function (t) { return t.requester === ctx.me; });
    var list = all.filter(function (t) { return tkStatus === "all" || (tkStatus === "mine" ? t.assignee === ctx.me && t.status !== "Closed" : tkStatus === "open" ? t.status !== "Resolved" && t.status !== "Closed" : t.status === "Resolved" || t.status === "Closed"); });
    var tabs = [["open", "Open"], ["done", "Resolved & closed"], ["all", "All"]].concat(isIT ? [["mine", "Assigned to me"]] : []);
    return '<section class="dash-card"><div class="card-head"><div><h2>' + (isIT ? "Support tickets" : "My support tickets") + '</h2><p class="note">' + (isIT ? esc(slaLine()) : "Tell IT what is wrong. You get a notification when they reply.") + '</p></div><button type="button" class="save" id="tkNew">' + icon(I.plus) + ' Report a problem</button></div>' +
      '<div class="stage-pills">' + tabs.map(function (t) { return '<button type="button" class="pill-btn' + (tkStatus === t[0] ? " on" : "") + '" data-tks="' + t[0] + '">' + t[1] + '</button>'; }).join("") + '</div>' +
      (list.length ? ticketRows(list) : empty("No tickets here.")) + '</section>';
  }
  function openNewTicket() {
    openModal('<h2>Report a problem</h2><p class="note">IT gets a notification straight away.</p>' +
      '<div class="fld"><label for="tTitle">What is wrong?</label><input id="tTitle" maxlength="120" placeholder="e.g. Can\'t clock in on my phone"></div>' +
      '<div class="cards"><div class="fld"><label for="tCat">About</label><select id="tCat">' + options(TK_CAT, "Other") + '</select></div><div class="fld"><label for="tPri">How urgent?</label><select id="tPri">' + options(TK_PRI, "Normal") + '</select></div></div>' +
      '<div class="fld"><label for="tDetail">Details (optional)</label><textarea id="tDetail" rows="4" maxlength="2000" placeholder="What you were doing, any error message, which device"></textarea></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="tGo">Send to IT</button></div>');
    $("tGo").addEventListener("click", function () {
      var title = $("tTitle").value.trim(); if (title.length < 3) { say("Say in a few words what is wrong.", "err"); return; }
      rpc("open_ticket", { p_company: company.id, p_title: title, p_detail: $("tDetail").value.trim() || null, p_category: $("tCat").value, p_priority: $("tPri").value })
        .then(function (t) { closeModal(); location.hash = "#tickets/" + t.id; return reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  var notes = {};
  function loadNotes(id) {
    if (notes[id]) return;
    db.from("it_ticket_notes").select("*").eq("ticket_id", id).order("created_at").then(function (r) { notes[id] = r.data || []; var rt = route(); if (rt.view === "tickets" && rt.id === id) render(); });
  }
  function ticket(id) {
    var t = data.tickets.filter(function (x) { return x.id === id; })[0];
    if (!t) return '<section class="dash-card">' + empty('That ticket was not found. <a href="#tickets">Back to tickets</a>') + '</section>';
    var it = (Object.keys(data.people).map(function (k) { return data.people[k]; })).filter(function (p) { return p.active && ["owner", "admin", "it"].indexOf(p.role) > -1; });
    var ns = notes[id];
    return '<section class="dash-card prof-head"><a class="back" href="#tickets">' + icon(I.back) + 'Tickets</a><div class="card-head"><div><h2>#' + t.number + ' ' + esc(t.title) + '</h2>' +
      '<p class="note">' + esc(t.category) + ' · from ' + esc(nameOf(t.requester)) + ' · ' + when(t.created_at) + (t.due_at ? ' · answer by ' + when(t.due_at) : "") + '</p></div><span class="prof-chips">' + chip(t.priority, "st-pri-" + slug(t.priority)) + chip(t.status, "st-tk-" + slug(t.status)) + '</span></div>' +
      (isIT ? '<div class="it-tkbar"><label>Status <select id="tkSt">' + options(TK_ST, t.status) + '</select></label><label>Priority <select id="tkPri">' + options(TK_PRI, t.priority) + '</select></label>' +
        '<label>Assigned to <select id="tkAs">' + options(it.map(function (p) { return [p.uid, p.name]; }), t.assignee || "", "Nobody") + '</select></label><button type="button" class="save manage-btn" id="tkSave">Save</button></div>' : "") + '</section>' +
      '<section class="dash-card"><h2>Conversation</h2><ul class="it-thread">' +
      '<li class="from-req"><span class="avatar-s">' + esc(initials(nameOf(t.requester))) + '</span><div><strong>' + esc(nameOf(t.requester)) + '</strong><small>' + when(t.created_at) + '</small><p>' + esc(t.detail || t.title) + '</p></div></li>' +
      (ns ? ns.map(function (n) {
        return '<li class="' + (n.author === t.requester ? "from-req" : "from-it") + (n.internal ? " internal" : "") + '"><span class="avatar-s">' + esc(initials(nameOf(n.author))) + '</span><div><strong>' + esc(nameOf(n.author)) + (n.internal ? ' <span class="chip st-off-duty">IT only</span>' : "") + '</strong><small>' + when(n.created_at) + '</small><p>' + esc(n.body) + '</p></div></li>';
      }).join("") : '<li><p class="msg">Loading…</p></li>') + '</ul>' +
      (t.resolution ? '<div class="it-managed"><strong>How it was fixed</strong><p>' + esc(t.resolution) + '</p></div>' : "") +
      (t.status !== "Closed" ? '<div class="fld" style="margin-top:12px"><label for="tkReply">Reply</label><textarea id="tkReply" rows="3" maxlength="2000"></textarea></div>' +
        '<div class="att-toolbar">' + (isIT ? '<label class="chk"><input type="checkbox" id="tkInt"> Note for IT only</label><label class="chk"><input type="checkbox" id="tkFix"> This fixes it (mark resolved)</label>' : "") + '<button type="button" class="save" id="tkSend">Send</button></div>' : '<p class="hint">This ticket is closed.</p>') +
      '<p class="msg" id="mMsgInline" role="status"></p></section>';
  }

  /* ---------- activity log ---------- */
  var LOG_KINDS = [["", "Everything"], ["clock", "Clock-in checks"], ["device", "Devices"], ["asset", "Assets"], ["ticket", "Tickets"], ["setting", "Settings changes"], ["access", "People & access"]];
  var logRows = null, logKey = "";
  function loadLog() {
    var key = logDays; if (logRows && logKey === key) return;
    logKey = key; logRows = null;
    var since = new Date(Date.now() - logDays * 864e5).toISOString();
    Promise.all([
      db.from("it_events").select("*").eq("company_id", company.id).gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
      db.from("company_audit").select("action, detail, created_at, actor").eq("company_id", company.id).gte("created_at", since).order("created_at", { ascending: false }).limit(1000)
    ]).then(function (r) {
      var rows = (r[0].data || []).map(function (e) { return { at: e.created_at, kind: e.kind.indexOf("clock") === 0 ? "clock" : e.kind, outcome: e.outcome, text: e.detail, actor: e.actor, ip: e.ip, device: e.device_key }; });
      (r[1].data || []).forEach(function (a) {
        var k = a.action === "setting_changed" ? "setting" : /member|role|invite|suspend|status/.test(a.action) ? "access" : /clock_/.test(a.action) ? null : "other";
        if (k) rows.push({ at: a.created_at, kind: k, outcome: "ok", text: (a.action === "setting_changed" ? "Setting changed: " : a.action.replace(/_/g, " ") + ": ") + (a.detail || ""), actor: a.actor });
      });
      rows.sort(function (a, b) { return b.at.localeCompare(a.at); });
      logRows = rows; var rt = route(); if (rt.view === "log") render();
    });
  }
  function logView() {
    if (!isIT) return itOnly("The activity log");
    var rows = (logRows || []).filter(function (x) { return (!logKind || x.kind === logKind) && (!logOutcome || x.outcome === logOutcome) && (!logText || (x.text + " " + nameOf(x.actor) + " " + (x.ip || "")).toLowerCase().indexOf(logText) > -1); });
    var denied = (logRows || []).filter(function (x) { return x.outcome === "denied"; }).length;
    return '<section class="dash-card"><div class="card-head"><div><h2>Activity log</h2><p class="note">' + (logRows ? (logRows.length + " events in the last " + logDays + " days · " + denied + " refused") : "Loading…") + '</p></div><button type="button" class="ghost" id="logCsv">Download CSV</button></div>' +
      '<div class="att-toolbar"><select id="logKind" aria-label="What">' + options(LOG_KINDS, logKind) + '</select><select id="logOut" aria-label="Result">' + options([["", "Any result"], ["denied", "Refused only"], ["warning", "Warnings"], ["ok", "Allowed"]], logOutcome) + '</select>' +
      '<select id="logDays" aria-label="Period">' + options([[1, "Last 24 hours"], [7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]], logDays) + '</select><input id="logText" type="search" placeholder="Search name, IP or text" value="' + esc(logText) + '" aria-label="Search"></div>' +
      (!logRows ? '<p class="msg">Loading…</p>' : rows.length ? '<div class="dtable-wrap"><table class="dtable it-log"><thead><tr><th>When</th><th>What</th><th>Who</th><th>Network</th><th>Result</th></tr></thead><tbody>' + rows.slice(0, 400).map(function (x) {
        return '<tr><td class="muted-cell">' + when(x.at) + '</td><td style="white-space:normal">' + esc(x.text) + '</td><td>' + esc(x.actor ? nameOf(x.actor) : "System") + '</td><td class="muted-cell">' + esc(x.ip || "—") + '</td><td>' +
          (x.outcome === "denied" ? chip("Refused", "st-absent") : x.outcome === "warning" ? chip("Warning", "st-late") : chip("OK", "st-present")) + '</td></tr>';
      }).join("") + '</tbody></table></div>' + (rows.length > 400 ? '<p class="hint">Showing the latest 400. Narrow the filters or download the CSV.</p>' : "") : empty("Nothing matches these filters.")) + '</section>';
  }

  /* ---------- who has access ---------- */
  var ROLE_CAN = { owner: "Everything, including billing and the owner's own account", admin: "Everything except changing the owner", it: "IT section, IT Settings, sign-in and integrations; own HR records", hr: "HR & Crew, payroll, reports, HR and agreement settings", operations: "Operations and the Duty Roster (when named for crew assignments); own HR records", staff: "Own profile, leave, attendance, payslips, devices and tickets" };
  function people() {
    if (!isIT) return itOnly("This list");
    var list = Object.keys(data.people).map(function (k) { return data.people[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var devBy = {}; data.devices.forEach(function (d) { if (d.user_id) (devBy[d.user_id] = devBy[d.user_id] || []).push(d); });
    var priv = list.filter(function (p) { return p.active && ["owner", "admin", "it"].indexOf(p.role) > -1; });
    return '<section class="dash-card"><div class="card-head"><div><h2>Who has access</h2><p class="note">' + priv.length + ' people have administrator or IT access. Change roles in <a href="settings.html#open=User%20Accounts">User accounts</a>.</p></div></div>' +
      '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Person</th><th>Role</th><th>What they can open</th><th>Devices</th><th>Account</th></tr></thead><tbody>' + list.map(function (p) {
        var ds = devBy[p.uid] || [];
        return '<tr><td><span class="who"><span class="avatar-s">' + esc(initials(p.name)) + '</span>' + esc(p.name) + '</span><span class="th-sub">' + esc(p.email) + '</span></td><td>' + chip(p.label || cap(p.role), "st-role-" + slug(p.role)) + '</td>' +
          '<td class="muted-cell" style="white-space:normal;max-width:360px">' + esc(ROLE_CAN[p.role] || "") + '</td><td class="muted-cell">' + (ds.length ? ds.length + " (" + ds.filter(function (d) { return d.status === "Approved"; }).length + " approved)" : "—") + '</td>' +
          '<td>' + (p.status === "Former" ? chip("Former", "st-off-duty") : p.active ? chip("Active", "st-present") : chip("Suspended", "st-absent")) + '</td></tr>';
      }).join("") + '</tbody></table></div></section>';
  }

  /* ---------- events ---------- */
  function on(sel, fn) { [].forEach.call(document.querySelectorAll(sel), function (b) { b.addEventListener("click", function (e) { fn(b, e); }); }); }
  function bind(rt) {
    if ($("devReg")) $("devReg").addEventListener("click", function () {
      var m = $("devMsg"); m.textContent = "Registering…"; m.className = "msg";
      rpc("register_device", { p_company: company.id, p_key: deviceKey(), p_label: $("devLabel").value.trim(), p_kind: $("devKind").value }).then(reload).catch(function (e) { m.textContent = e.message; m.className = "msg err"; });
    });
    on("[data-addnet]", function (b) { openNet(null, b.dataset.addnet); });
    if ($("netAdd")) $("netAdd").addEventListener("click", function () { openNet(null, ""); });
    on("[data-netedit]", function (b) { openNet(b.dataset.netedit); });
    on("[data-netdel]", function (b) {
      var n = data.networks.filter(function (x) { return x.id === b.dataset.netdel; })[0];
      var last = checkin().network === "Approved networks only" && data.networks.filter(function (x) { return x.active; }).length === 1 && n.active;
      if (!confirm((last ? "This is the only approved network, and clock-in needs one. Nobody will be able to clock in from the app. " : "") + "Remove " + n.name + "?")) return;
      db.from("it_networks").delete().eq("id", n.id).then(function (r) { if (r.error) alert(r.error.message); else reload(); });
    });
    if ($("netTestGo")) $("netTestGo").addEventListener("click", function () {
      var ip = $("netTest").value.trim(), n = netFor(ip), o = $("netTestOut");
      o.textContent = !ip ? "Enter an address." : n ? ip + " is approved: " + n.name + " (" + n.cidr + ")." : ip + " is not on any approved network. With “Approved networks only”, clock-in from it is refused.";
      o.className = "msg " + (n ? "ok" : ip ? "err" : "");
    });
    on("[data-dev]", function (b) { db.from("it_devices").update({ status: b.dataset.st }).eq("id", b.dataset.dev).then(function (r) { if (r.error) alert(r.error.message); else reload(); }); });
    on("[data-devedit]", function (b) { openDevice(b.dataset.devedit); });
    if ($("asAdd")) $("asAdd").addEventListener("click", function () { openAsset(null); });
    if ($("asKind")) $("asKind").addEventListener("change", function () { assetKind = this.value; render(); });
    on("[data-asedit]", function (b) { openAsset(b.dataset.asedit); });
    if ($("tkNew")) $("tkNew").addEventListener("click", openNewTicket);
    on("[data-tks]", function (b) { tkStatus = b.dataset.tks; render(); });
    if ($("tkSave")) $("tkSave").addEventListener("click", function () {
      db.from("it_tickets").update({ status: $("tkSt").value, priority: $("tkPri").value, assignee: $("tkAs").value || null }).eq("id", rt.id).then(function (r) { if (r.error) alert(r.error.message); else reload(); });
    });
    if ($("tkSend")) $("tkSend").addEventListener("click", function () {
      var body = $("tkReply").value.trim(), fix = $("tkFix") && $("tkFix").checked, m = $("mMsgInline");
      if (!body) { m.textContent = "Write a reply first."; m.className = "msg err"; return; }
      rpc("add_ticket_note", { p_ticket: rt.id, p_body: body, p_internal: !!($("tkInt") && $("tkInt").checked) }).then(function () {
        if (fix) return db.from("it_tickets").update({ status: "Resolved", resolution: body.slice(0, 1000) }).eq("id", rt.id);
      }).then(function () { delete notes[rt.id]; return reload(); }).catch(function (e) { m.textContent = e.message; m.className = "msg err"; });
    });
    [["logKind", function (v) { logKind = v; }], ["logOut", function (v) { logOutcome = v; }], ["logDays", function (v) { logDays = Number(v); }]].forEach(function (p) {
      if ($(p[0])) $(p[0]).addEventListener("change", function () { p[1](this.value); render(); });
    });
    if ($("logText")) $("logText").addEventListener("input", function () { var el = this, pos = el.selectionStart; logText = el.value.trim().toLowerCase(); render(); var n2 = $("logText"); n2.focus(); n2.setSelectionRange(pos, pos); });
    if ($("logCsv")) $("logCsv").addEventListener("click", function () {
      var rows = [["When", "What", "Who", "Network", "Result"]].concat((logRows || []).map(function (x) { return [x.at, x.text, x.actor ? nameOf(x.actor) : "System", x.ip || "", x.outcome]; }));
      var text = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
      var url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" })), a = document.createElement("a"); a.href = url; a.download = "it-activity-" + todayIso() + ".csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
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
    active: "IT",
    onCompany: function (c, info) {
      company = c; ctx = info; data = null; logRows = null; notes = {};
      isIT = !!(info.canAll || info.canIT || info.isPlatform || info.myRole === "owner" || info.myRole === "admin" || info.myRole === "it");
      $("it").innerHTML = '<p class="msg">Loading…</p>';
      return load().then(function () {
        render();
        if (isIT) db.rpc("scan_it_assets", { p_company: c.id }).then(function () {}, function () {}); // rpc() builders have .then only, no .catch
        if (window.VeyoraTip) window.VeyoraTip("it1", isIT ? [
          "**Networks** lists your approved office and VPN networks. Add the office network while you are there, then turn on “Approved networks only” in Settings.",
          "**Devices** shows every phone and computer staff registered. Approve or block them; shared terminals can be kiosks.",
          "**Support tickets** is where staff report problems. You get a notification for each new ticket."
        ] : ["Register this phone or computer under **This device**, and use **Report a problem** to ask IT for help."]);
      });
    },
    onNone: function () { $("it").innerHTML = '<section class="dash-card"><h2>No company yet</h2><p class="note">Ask your administrator for an invite.</p></section>'; },
    onError: function (err) { $("it").innerHTML = '<section class="dash-card"><h2>Could not load IT</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
