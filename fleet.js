/* Fleet: company vessel directory (fleet.html). Uses vessels + schedules from Maintenance.
   Display labels map Operational→In service, Restricted→Maintenance, Out of service→Out of service.
   Cursor 2026-10-23: one full-width modern vessel card per row. */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var company = null, ctx = null, vessels = [], schedules = [], isMaint = false, canSet = false;
  var tab = "all", q = "", kindF = "", statusF = "", layout = "grid";

  function setting(key) { return company && company.settings ? company.settings[key] : undefined; }
  function listSetting(key, title) {
    var saved = setting(key), spec = window.VEYORA_DEFS && window.VEYORA_DEFS[title] || {};
    var rows = Array.isArray(saved) ? saved : (spec.def || []);
    return rows.map(function (r) { return typeof r === "string" ? r : r && r.name; }).filter(Boolean);
  }
  function icon(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var I = {
    ship: '<path d="M3 15l9 4 9-4M5 15V10l7-4 7 4v5"/><path d="M12 6V3"/>',
    ok: '<path d="m5 12 5 5 9-10"/>', wrench: '<path d="M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-3-1-1-3z"/>',
    pause: '<path d="M8 6h3v12H8zM13 6h3v12h-3z"/>', alert: '<path d="M12 4 3 20h18L12 4ZM12 10v4M12 17h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>', route: '<path d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
    pin: '<path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z"/><circle cx="12" cy="11" r="2"/>'
  };
  function emptyBlock(title, body) {
    return '<div class="fleet-empty"><span class="ic">' + icon(I.ship) + '</span><h3>' + title + '</h3><p>' + body + '</p></div>';
  }
  function kpi(tone, ic, label, value, sub) {
    return '<div class="kpi"><span class="tile tone-' + tone + '">' + icon(ic) + '</span><span class="kbody"><small>' + label + '</small><strong>' + value + '</strong><span class="kpi-row"><span class="kpi-sub">' + sub + '</span></span></span></div>';
  }
  function options(list, cur, blank) {
    return (blank != null ? '<option value="">' + esc(blank) + '</option>' : "") + list.map(function (p) {
      var v = Array.isArray(p) ? p[0] : p, t = Array.isArray(p) ? p[1] : p;
      return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + '>' + esc(t) + '</option>';
    }).join("");
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayIso() { return iso(new Date()); }
  function addDaysIso(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function fmtDate(s) {
    if (!s) return "—";
    return new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  /* Display status for the Fleet mock (DB still uses Operational / Restricted / Out of service). */
  function displayStatus(v) {
    if (v.status === "Operational" && v.standby) {
      return { label: "Standby", cls: "st-standby", bucket: "in", tone: "slate", live: false };
    }
    if (v.status === "Operational") {
      return { label: "In service", cls: "st-in-service", bucket: "in", tone: "ok", live: true };
    }
    if (v.status === "Restricted") {
      return { label: "Maintenance", cls: "st-maintenance", bucket: "maint", tone: "warn", live: false };
    }
    return {
      label: "Out of service", cls: "st-out-of-service", bucket: "down", tone: "bad", live: false,
      reason: v.status_reason || "Awaiting repair"
    };
  }
  function inspectionState(next) {
    if (!next) return { label: "Not scheduled", urg: "" };
    var today = todayIso();
    var warn = addDaysIso(remCfg().days);
    if (next < today) return { label: fmtDate(next), urg: " overdue" };
    if (next <= warn) return { label: fmtDate(next), urg: " due soon" };
    return { label: fmtDate(next), urg: "" };
  }
  function remCfg() {
    var r = setting("10_maintenance_reminder_rules") || {};
    return { days: Number(r.first) || 14, hours: Number(r.hoursWarn) || 25 };
  }
  function nextInspection(vesselId) {
    var cfg = remCfg(), today = todayIso(), best = null;
    schedules.filter(function (s) { return s.vessel_id === vesselId && s.active && s.interval_days; }).forEach(function (s) {
      if (!s.last_done_on && !s.interval_days) return;
      var next = s.last_done_on ? (function () {
        var d = new Date(s.last_done_on + "T00:00:00"); d.setDate(d.getDate() + Number(s.interval_days)); return iso(d);
      })() : today;
      if (!best || next < best) best = next;
    });
    return best;
  }
  function capacityOf(v) {
    var p = v.passenger_capacity != null ? Number(v.passenger_capacity) : null;
    var c = v.crew_capacity != null ? Number(v.crew_capacity) : null;
    return { pax: p, crew: c, total: (p != null || c != null) ? (p || 0) + (c || 0) : null };
  }
  function capacityLabel(cap) {
    if (!cap || cap.total == null) return "—";
    if (cap.crew) return cap.pax + " pax + " + cap.crew + " crew";
    return cap.pax + " passengers";
  }
  function routeOf(v) {
    // Claude: add vessels.assigned_route or link to routes when Operations launches.
    return v.assigned_route || null;
  }
  function vesselMeta(v) {
    return v && v.meta && typeof v.meta === "object" && !Array.isArray(v.meta) ? v.meta : {};
  }
  function followmeUrl(v) {
    var m = vesselMeta(v);
    return (m.followme_url || m.followme || "").trim();
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
      // Share pages (m.followme.mv/public/<key>) return HTML with no coords — store the API form instead.
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

  function load() {
    return Promise.all([
      db.from("vessels").select("*").eq("company_id", company.id).order("code"),
      db.from("maint_schedules").select("id, vessel_id, title, active, interval_days, last_done_on").eq("company_id", company.id)
    ]).then(function (r) {
      if (r[0].error) throw new Error(r[0].error.message);
      vessels = r[0].data || [];
      schedules = (r[1].data || []);
    });
  }

  function counts() {
    var inSvc = 0, maint = 0, down = 0;
    vessels.forEach(function (v) {
      var b = displayStatus(v).bucket;
      if (b === "in") inSvc++; else if (b === "maint") maint++; else down++;
    });
    return { all: vessels.length, in: inSvc, maint: maint, down: down };
  }

  function filtered() {
    return vessels.filter(function (v) {
      var st = displayStatus(v);
      if (tab === "in" && st.bucket !== "in") return false;
      if (tab === "maint" && st.bucket !== "maint") return false;
      if (tab === "down" && st.bucket !== "down") return false;
      if (kindF && v.kind !== kindF) return false;
      if (statusF === "in" && st.bucket !== "in") return false;
      if (statusF === "maint" && st.bucket !== "maint") return false;
      if (statusF === "down" && st.bucket !== "down") return false;
      if (q) {
        var hay = (v.code + " " + v.name + " " + v.kind + " " + (v.registration || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function kinds() {
    var fromSettings = listSetting("6_vessel_categories", "Vessel Categories");
    var seen = {}, out = fromSettings.slice();
    vessels.forEach(function (v) { if (v.kind && !seen[v.kind] && out.indexOf(v.kind) < 0) out.push(v.kind); seen[v.kind] = 1; });
    return out.length ? out : ["Ferry", "Speedboat"];
  }

  function card(v) {
    var st = displayStatus(v);
    var cap = capacityOf(v);
    var next = nextInspection(v.id);
    var insp = inspectionState(next);
    var route = routeOf(v) || v.assigned_route;
    var fm = followmeLinked(v);
    var fmH = followmeHint(v);
    var shortCode = String(v.code || "").slice(0, 6);
    var year = v.built_year ? " · Built " + v.built_year : "";
    var hint = st.bucket === "down" && st.reason ? st.reason : (fm ? (fmH || "FollowMe linked") : "Open vessel record");

    return '<a class="fl-card tone-' + st.tone + '" href="maintenance.html#vessel/' + esc(v.id) + '">' +
      '<div class="fl-visual">' + window.VeyoraShell.vesselPhotoImg(v) + /* Cursor 2026-10-27: vessel photo or sample boat */ '<span class="fl-code">' + esc(shortCode) + '</span></div>' +
      '<div class="fl-id">' +
        '<div class="fl-id-top"><h3>' + esc(v.name) + '</h3>' +
          '<span class="fl-status ' + st.cls + (st.live ? " live" : "") + '"><i></i>' + esc(st.label) + '</span></div>' +
        '<p class="fl-sub">' + esc(v.code) + (v.kind ? " · " + esc(v.kind) : "") + esc(year) + '</p>' +
        '<div class="fl-tags">' +
          (v.kind ? '<span class="fl-tag kind">' + icon(I.ship) + ' ' + esc(v.kind) + '</span>' : "") +
          (v.registration ? '<span class="fl-tag reg">' + esc(v.registration) + '</span>' : "") +
        '</div>' +
      '</div>' +
      '<div class="fl-stats">' +
        '<div class="fl-stat"><small>Capacity</small><strong>' + esc(capacityLabel(cap)) + '</strong>' +
          (cap && cap.total != null ? '<div class="fl-cap-bar"><span class="fl-cap-fill"></span></div>' : "") +
        '</div>' +
        '<div class="fl-stat"><small>Next inspection</small><strong>' + esc(insp.label) + (insp.urg ? '<span style="color:#c27400">' + esc(insp.urg) + '</span>' : "") + '</strong></div>' +
        '<div class="fl-stat"><small>Assigned route</small><strong>' + (route ? esc(route) : "Unassigned") + '</strong></div>' +
        '<div class="fl-stat"><small>Tracking</small><strong>' +
          (fm ? '<span class="fl-track on" title="' + esc(fmH || "Linked") + '">FollowMe live</span>' : '<span class="fl-track">Not linked</span>') +
        '</strong></div>' +
      '</div>' +
      '<div class="fl-acts">' +
        '<span class="fl-cta">View details ' + icon(I.chev) + '</span>' +
        '<span class="fl-hint">' + esc(hint) + '</span>' +
      '</div></a>';
  }

  // ---- Redesign (Nov 2026): readiness hero, attention strip, photo grid / compact list. Same data and links. ----
  function readinessRing(pct) {
    return '<span class="fl2-ring"><svg viewBox="0 0 36 36"><circle class="tr" cx="18" cy="18" r="15" pathLength="100"></circle><circle class="vl" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="' + pct + ' 100"></circle></svg><b>' + pct + '<i>%</i></b></span>';
  }
  function heroHtml(c) {
    var pct = c.all ? Math.round(c.in * 100 / c.all) : 0;
    function seg(cls, n) { return n ? '<i class="' + cls + '" style="flex:' + n + '"></i>' : ""; }
    function tile(key, cls, ic, label, n, sub) {
      return '<button type="button" class="fl2-tile ' + cls + (tab === key ? " on" : "") + '" data-tab="' + key + '"><span class="ic">' + icon(ic) + '</span><strong>' + n + '</strong><small>' + label + '</small><em>' + sub + '</em></button>';
    }
    return '<section class="fl2-hero"><div class="fl2-hero-l">' + readinessRing(pct) +
      '<div><small>Fleet readiness</small><h2>' + c.in + ' of ' + c.all + ' vessels ready</h2><p>' + (c.all ? (c.maint + c.down ? (c.maint + c.down) + ' not available for trips right now' : 'Every vessel is available for trips') : 'Add your first vessel to start') + '</p></div></div>' +
      '<div class="fl2-bar" aria-hidden="true">' + seg("in", c.in) + seg("maint", c.maint) + seg("down", c.down) + '</div>' +
      '<div class="fl2-tiles">' +
        tile("all", "all", I.ship, "All vessels", c.all, "Registered") +
        tile("in", "in", I.ok, "In service", c.in, "Ready for trips") +
        tile("maint", "maint", I.wrench, "Maintenance", c.maint, "Service in progress") +
        tile("down", "down", I.pause, "Out of service", c.down, "Awaiting repair") +
      '</div></section>';
  }
  function attentionHtml() {
    var items = [];
    vessels.forEach(function (v) {
      var st = displayStatus(v), insp = inspectionState(nextInspection(v.id));
      var href = 'maintenance.html#vessel/' + esc(v.id);
      if (st.bucket === "down") items.push(['bad', v.name, st.reason || "Out of service", href]);
      else if (insp.urg === " overdue") items.push(['warn', v.name, "Inspection overdue · " + insp.label, href]);
      else if (insp.urg === " due soon") items.push(['soon', v.name, "Inspection due " + insp.label, href]);
    });
    if (!items.length) return "";
    return '<section class="fl2-attn"><h3>' + icon(I.alert) + ' Needs attention <b>' + items.length + '</b></h3><div class="fl2-attn-list">' +
      items.slice(0, 6).map(function (it) { return '<a class="fl2-chip ' + it[0] + '" href="' + it[3] + '"><strong>' + esc(it[1]) + '</strong><span>' + esc(it[2]) + '</span></a>'; }).join("") + '</div></section>';
  }
  function gridCard(v, i) {
    var st = displayStatus(v), cap = capacityOf(v), insp = inspectionState(nextInspection(v.id));
    var route = routeOf(v) || v.assigned_route, fm = followmeLinked(v), fmH = followmeHint(v);
    return '<a class="fl2-card tone-' + st.tone + '" style="--i:' + Math.min(i, 14) + '" href="maintenance.html#vessel/' + esc(v.id) + '">' +
      '<div class="fl2-photo">' + window.VeyoraShell.vesselPhotoImg(v) + '<span class="fl2-code">' + esc(String(v.code || "").slice(0, 8)) + '</span>' +
        '<span class="fl2-st ' + st.cls + (st.live ? " live" : "") + '"><i></i>' + esc(st.label) + '</span></div>' +
      '<div class="fl2-body"><h3>' + esc(v.name) + '</h3>' +
        '<p>' + esc(v.kind || "Vessel") + (v.built_year ? " · Built " + esc(v.built_year) : "") + (v.registration ? " · " + esc(v.registration) : "") + '</p>' +
        (st.bucket === "down" && st.reason ? '<div class="fl2-reason">' + icon(I.alert) + esc(st.reason) + '</div>' : "") +
        '<div class="fl2-facts">' +
          '<div><small>Capacity</small><strong>' + (cap.pax != null ? cap.pax : "—") + '<i> pax</i></strong>' + (cap.crew ? '<em>+ ' + cap.crew + ' crew</em>' : "") + '</div>' +
          '<div class="' + (insp.urg ? "alert" : "") + '"><small>Next inspection</small><strong>' + esc(insp.label) + '</strong>' + (insp.urg ? '<em>' + esc(insp.urg.trim()) + '</em>' : "") + '</div>' +
        '</div>' +
        '<div class="fl2-foot"><span class="fl2-route">' + icon(I.route) + esc(route || "No route") + '</span>' +
          '<span class="fl2-track' + (fm ? " on" : "") + '" title="' + esc(fmH || (fm ? "Linked" : "Not linked")) + '"><i></i>' + (fm ? "Live tracking" : "No tracking") + '</span></div>' +
      '</div></a>';
  }

  function rpc(name, args) { return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }
  function render() {
    if ((location.hash || "").indexOf("#settings") === 0) {
      $("fleetActions").innerHTML = '<a class="btn-soft" href="#">Fleet</a>';
      $("fleet").innerHTML = '<section class="dash-card" id="pageSettings"></section>';
      if (window.PageSettings) window.PageSettings.mount($("pageSettings"), {
        area: "fleet", pill: (location.hash || "").slice(1).split("/")[1] || "", esc: esc,
        company: function () { return company; }, db: db, rpc: rpc, canEdit: canSet
      });
      return;
    }
    var c = counts(), list = filtered();
    $("fleetActions").innerHTML = (isMaint
      ? '<button type="button" class="primary-btn" id="flAdd">' + icon(I.plus) + ' Add vessel</button>'
      : '<a class="btn-soft" href="maintenance.html#vessels">Open Maintenance</a>') +
      '<a class="btn-soft" href="#settings">Settings</a>';

    $("fleet").innerHTML =
      '<div class="fl2">' + heroHtml(c) + attentionHtml() +
      '<div class="fl2-toolrow"><div class="fl2-seg" role="tablist">' +
        [["all", "All", c.all], ["in", "In service", c.in], ["maint", "Maintenance", c.maint], ["down", "Out of service", c.down]].map(function (t) {
          return '<button type="button" role="tab" class="' + (tab === t[0] ? "on" : "") + '" data-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + ' <b>' + t[2] + '</b></button>';
        }).join("") + '</div>' +
        '<div class="fl2-filters"><label class="fsearch">' + icon(I.search) + '<input type="search" id="flQ" placeholder="Search name, ID or registration" value="' + esc(q) + '" aria-label="Search vessels"></label>' +
          '<select id="flKind" aria-label="Vessel type">' + options([["", "All vessel types"]].concat(kinds().map(function (k) { return [k, k]; })), kindF) + '</select>' +
          '<div class="fl2-lay" role="group" aria-label="Layout"><button type="button" data-layout="grid" class="' + (layout === "grid" ? "on" : "") + '" aria-label="Grid">' + icon('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>') + '</button>' +
          '<button type="button" data-layout="list" class="' + (layout === "list" ? "on" : "") + '" aria-label="List">' + icon('<path d="M4 6h16M4 12h16M4 18h16"/>') + '</button></div></div></div>' +
      (list.length
        ? (layout === "grid" ? '<div class="fl2-grid">' + list.map(gridCard).join("") + '</div>' : '<div class="fleet-list fl2-list">' + list.map(card).join("") + '</div>')
        : emptyBlock(
            vessels.length ? "No vessels match" : "No vessels yet",
            vessels.length ? "Try another search or clear the filters." : (isMaint ? "Add the first vessel to start your fleet directory." : "Ask maintenance to add vessels.")
          )) + '</div>';

    bind();
  }

  function bind() {
    [].forEach.call(document.querySelectorAll("[data-tab]"), function (b) {
      b.addEventListener("click", function () { tab = b.dataset.tab; render(); });
    });
    if ($("flQ")) {
      var qTimer = null;
      $("flQ").addEventListener("input", function () {
        var v = this.value.trim().toLowerCase();
        clearTimeout(qTimer);
        qTimer = setTimeout(function () {
          q = v;
          render();
          var inp = $("flQ");
          if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
        }, 200);
      });
    }
    if ($("flKind")) $("flKind").addEventListener("change", function () { kindF = this.value; render(); });
    if ($("flSt")) $("flSt").addEventListener("change", function () { statusF = this.value; render(); });
    [].forEach.call(document.querySelectorAll("[data-layout]"), function (b) {
      b.addEventListener("click", function () { layout = b.dataset.layout; render(); });
    });
    if ($("flAdd")) $("flAdd").addEventListener("click", openAdd);
  }

  function openAdd() {
    var cats = kinds();
    openModal('<h2>Add vessel</h2><p class="note">Saved to the company fleet. Maintenance uses the same record for schedules and work orders.</p>' +
      '<div class="cards"><div class="fld"><label for="vCode">Vessel ID</label><input id="vCode" maxlength="30" placeholder="e.g. HT-203"></div>' +
      '<div class="fld"><label for="vName">Name</label><input id="vName" maxlength="80" placeholder="e.g. Island Star"></div>' +
      '<div class="fld"><label for="vKind">Type</label><select id="vKind">' + options(cats, cats[0] || "Ferry") + '</select></div>' +
      '<div class="fld"><label for="vReg">Registration (optional)</label><input id="vReg" maxlength="40"></div>' +
      '<div class="fld"><label for="vYear">Built year (optional)</label><input id="vYear" type="number" min="1900" max="2100"></div>' +
      '<div class="fld"><label for="vPax">Passenger seats</label><input id="vPax" type="number" min="0" max="9999" placeholder="e.g. 80"><small class="hint">Sold on each trip.</small></div>' +
      '<div class="fld"><label for="vCrew">Crew seats</label><input id="vCrew" type="number" min="0" max="999" placeholder="e.g. 8"><small class="hint">Kept for crew. Total = passengers + crew.</small></div>' +
      '<div class="fld full"><label for="vFollowMe">FollowMe API URL</label><input id="vFollowMe" type="url" maxlength="500" placeholder="https://followme.mv/api/v5/public/…/"><small class="hint">Use the API link (api/v5/public/…), not the public map page. Share links are converted automatically when possible.</small></div></div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="vGo">Save vessel</button></div>');
    $("vGo").addEventListener("click", function () {
      var pax = $("vPax").value !== "" ? Number($("vPax").value) : null;
      var crew = $("vCrew").value !== "" ? Number($("vCrew").value) : null;
      var fm = normalizeFollowmeUrl($("vFollowMe").value);
      if (fm.error) { say(fm.error, "err"); return; }
      var meta = {};
      if (fm.url) meta.followme_url = fm.url;
      var row = {
        company_id: company.id,
        code: $("vCode").value.trim(),
        name: $("vName").value.trim(),
        kind: $("vKind").value,
        registration: $("vReg").value.trim() || null,
        built_year: $("vYear").value ? Number($("vYear").value) : null,
        passenger_capacity: pax, crew_capacity: crew,
        meta: meta,
        status: "Operational"
      };
      if (row.code.length < 1) { say("Enter a vessel ID.", "err"); return; }
      if (row.name.length < 1) { say("Enter a name.", "err"); return; }
      if (pax != null && (isNaN(pax) || pax < 0)) { say("Passenger seats must be 0 or more.", "err"); return; }
      if (crew != null && (isNaN(crew) || crew < 0)) { say("Crew seats must be 0 or more.", "err"); return; }
      say("Saving…");
      db.from("vessels").insert(row).select().single().then(function (r) {
        if (r.error) { say(r.error.message, "err"); return; }
        closeModal();
        location.href = "maintenance.html#vessel/" + r.data.id;
      });
    });
  }

  function openModal(html) {
    $("modalCard").className = "modal-card";
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;
    var f = $("modalCard").querySelector("input,select,textarea");
    if (f) f.focus();
  }
  function closeModal() { $("modal").hidden = true; $("modalCard").innerHTML = ""; }
  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  window.addEventListener("hashchange", function () { if (company) render(); });

  window.VeyoraShell.start({
    active: "Fleet",
    onCompany: function (c, info) {
      company = c; ctx = info;
      var duties = ((c.settings || {})["8_approvers_and_responsibilities"] || {}).duties || {};
      var m = duties.maintenance || {};
      var named = [].concat(m.people || [], m.backup || []);
      isMaint = !!(info.canAll || info.canMaint || info.isPlatform || info.isAdmin || info.myRole === "operations" || named.indexOf(info.me) > -1);
      canSet = !!info.canOps;
      $("fleet").innerHTML = '<p class="msg">Loading…</p>';
      return load().then(function () {
        render();
        if (window.VeyoraTip) window.VeyoraTip("fleet1", [
          "**Fleet** lists every vessel. Status comes from Maintenance: Operational shows as In service, Restricted as Maintenance.",
          "Open a card to see engines, schedules and work on the Maintenance vessel page.",
          "Set **passenger seats** and **crew seats** when you add or edit a vessel. Operations warns when a trip is almost full or full.",
          "Paste each vessel’s **FollowMe.mv** tracking URL so live positions can be fetched for the dashboard map."
        ]);
      });
    },
    onNone: function () { $("fleet").innerHTML = '<section class="dash-card"><h2>No company yet</h2><p class="note">Ask your administrator for an invite.</p></section>'; },
    onError: function (err) { $("fleet").innerHTML = '<section class="dash-card"><h2>Could not load Fleet</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
