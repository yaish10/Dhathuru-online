/* Duty Roster: crew × days grid, per company.
   Shift types, limits and rules come from Settings > HR & Crew Settings:
   Shift Definitions, Duty Roster, Roster Patterns, Duty Hours, Crew Assignment Rules, Approvers & Responsibilities. */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc, cap = window.VeyoraShell.cap;
  var $ = function (id) { return document.getElementById(id); };
  // Roster-only sample flag (not shared with Dashboard/HR — that was locking edits when demo mode was on elsewhere).
  var SAMPLE_KEY = "veyora-roster-sample";

  var company = null, ctx = null, canEdit = false, data = null;
  var sampleOn = false; try { sampleOn = localStorage.getItem(SAMPLE_KEY) === "1"; } catch (e) {}
  var view = null, anchor = null, tab = "roster";
  var f = { dept: "", pos: "", vessel: "", shift: "", text: "" };
  var brush;             // undefined = click a cell for the menu; a shift code, "OFF", "TRN", "L" or null (eraser) = paint cells by clicking or dragging
  var dense = false; try { dense = localStorage.getItem("veyora-roster-dense") === "1"; } catch (e) {}
  var ctxRules = null; // cached per render: shifts, opts, hours, crew rules, quals
  var warnCache = null; // uid|day -> warning strings[]

  /* ---------- settings ---------- */
  function setting(key) { return company && company.settings ? company.settings[key] : undefined; }
  function formSetting(key, title) {
    var spec = (window.VEYORA_DEFS || {})[title], out = {}, saved = setting(key);
    (spec && spec.fields || []).forEach(function (x) { out[x.k] = x.d; });
    if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function tableSetting(key, title) {
    var spec = (window.VEYORA_DEFS || {})[title] || {}, saved = setting(key);
    var rows = Array.isArray(saved) ? saved : spec.def || [];
    return rows.map(function (r) { return typeof r === "string" ? { name: r } : r; });
  }
  var COLORS = window.VEYORA_SHIFT_COLORS || ["Green", "Amber", "Blue", "Purple", "Teal", "Grey"];
  function shiftsRaw() {
    return tableSetting("8_shift_definitions", "Shift Definitions").map(function (s, i) {
      var code = String(s.code || (s.name || "?").charAt(0)).trim().toUpperCase().slice(0, 4);
      return { code: code, name: s.name || code, start: s.start || "", end: s.end || "", color: s.color || COLORS[i % COLORS.length], needed: Number(s.needed) || 0, brk: Math.max(0, Number(s.brk) || 0), group: s.group || "Everyone", team: parseTeam(s.team) };
    }).filter(function (s, i, a) { return s.code && a.map(function (x) { return x.code; }).indexOf(s.code) === i; });
  }
  function shifts() { return (ctxRules && ctxRules.shifts) || shiftsRaw().map(function (s) { if (s.team.length) s.needed = s.team.reduce(function (n, t) { return n + t.n; }, 0); return s; }); }
  // "1 Captain, 2 Crew, 1 Cashier" → [{n:1, role:"Captain"}, …]. A team sets Crew needed to its total.
  function parseTeam(text) {
    return String(text || "").split(/[,;+\n]/).map(function (part) {
      var m = /^\s*(\d+)\s*[x×]?\s*(.+?)\s*$/i.exec(part); return m && +m[1] > 0 ? { n: +m[1], role: m[2] } : null;
    }).filter(Boolean);
  }
  // Does this person fill a team place? Matches the designation ("Cashier"), its crew group ("Captain"),
  // and treats "Crew" as any sea-going non-captain (Deck, Engineering or a designation containing "crew").
  function fitsRole(p, role) {
    var r = String(role).trim().toLowerCase().replace(/s$/, ""), pos = String(p.position || "").toLowerCase(), g = String(p.group || "").toLowerCase();
    if (pos === r || pos.replace(/s$/, "") === r || g === r) return true;
    if (r === "crew") return pos.indexOf("crew") > -1 || ((g === "deck" || g === "engineering") && pos.indexOf("captain") < 0);
    return false;
  }
  function roleOf(p, sh) { var t = (sh && sh.team || []).filter(function (x) { return fitsRole(p, x.role); })[0]; return t ? t.role : ""; }
  var RESERVED = [{ code: "OFF", name: "Off Duty", cls: "c-off" }, { code: "L", name: "Leave", cls: "c-l" }, { code: "TRN", name: "Training", cls: "c-trn" }];
  function rosterOpts() { return (ctxRules && ctxRules.opts) || formSetting("8_duty_roster", "Duty Roster"); }
  function dutyHours() { return (ctxRules && ctxRules.hours) || formSetting("8_duty_hours", "Duty Hours"); }
  function patterns() { return tableSetting("8_roster_patterns", "Roster Patterns"); }
  function crewRules() { return (ctxRules && ctxRules.rules) || formSetting("8_crew_assignment_rules", "Crew Assignment Rules"); }
  function qualTypes() { return (ctxRules && ctxRules.quals) || tableSetting("8_crew_qualification_types", "Crew Qualification Types"); }
  function shiftBy(code) { return ctxRules && ctxRules.byCode ? ctxRules.byCode[code] : shifts().filter(function (x) { return x.code === code; })[0]; }
  function beginRules() {
    var list = shiftsRaw(), by = {};
    list.forEach(function (s) { by[s.code] = s; });
    ctxRules = {
      shifts: list, byCode: by,
      opts: formSetting("8_duty_roster", "Duty Roster"),
      hours: formSetting("8_duty_hours", "Duty Hours"),
      rules: formSetting("8_crew_assignment_rules", "Crew Assignment Rules"),
      quals: tableSetting("8_crew_qualification_types", "Crew Qualification Types")
    };
    warnCache = {};
  }
  function clsFor(code) {
    var r = RESERVED.filter(function (x) { return x.code === code; })[0]; if (r) return r.cls;
    var s = shiftBy(code);
    return s ? "c-" + String(s.color).toLowerCase() : "c-grey";
  }
  function isWorking(code) { return !!code && code !== "OFF" && code !== "L"; }

  /* ---------- dates ---------- */
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function range() {
    var a = new Date(anchor), days = [];
    var start = view === "Month" ? new Date(a.getFullYear(), a.getMonth(), 1) : a;
    var len = view === "Month" ? new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate() : view === "Two weeks" ? 14 : 7;
    for (var i = 0; i < len; i++) days.push(addDays(start, i));
    return days;
  }
  function weekendSet() {
    var w = rosterOpts().weekend;
    return w === "Saturday & Sunday" ? [6, 0] : w === "Friday only" ? [5] : w === "None" ? [] : [5, 6];
  }
  function label(days) {
    var a = days[0], b = days[days.length - 1];
    if (view === "Month") return a.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    return a.getDate() + " " + a.toLocaleDateString("en-GB", { month: "short" }) + " – " + b.getDate() + " " + b.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  }
  function hoursOf(code) {
    if (code === "TRN") return 8;
    var s = shiftBy(code); if (!s || !s.start || !s.end) return isWorking(code) ? 8 : 0;
    var a = toMin(s.start), b = toMin(s.end); return Math.max(0, (b <= a ? b + 1440 : b) - a - s.brk) / 60;
  }
  function toMin(t) { var p = String(t).split(":"); return (+p[0]) * 60 + (+p[1] || 0); }

  /* ---------- data ---------- */
  function load() {
    var days = range(), from = iso(addDays(days[0], -7)), to = iso(days[days.length - 1]);
    if (sampleOn) { data = sampleData(days); return Promise.resolve(); }
    return Promise.all([
      db.from("company_members").select("user_id, role, role_label, job_title_id, department_id, assigned_vessel, employment_status").eq("company_id", company.id).eq("active", true).order("created_at"),
      db.from("job_titles").select("id, title, crew_group").eq("company_id", company.id),
      db.from("departments").select("id, name").eq("company_id", company.id),
      db.from("roster_entries").select("user_id, day, shift").eq("company_id", company.id).gte("day", from).lte("day", to),
      db.from("leave_requests").select("user_id, start_date, end_date, status").eq("company_id", company.id).eq("status", "Approved").lte("start_date", to).gte("end_date", from),
      db.from("staff_certifications").select("user_id, name, valid_until").eq("company_id", company.id),
      db.from("roster_periods").select("period_start, period_end, status, published_at").eq("company_id", company.id),
      // Attendance is HR/self only under RLS; ignore errors so non-HR editors still load the grid.
      db.from("attendance_records").select("user_id, day, status").eq("company_id", company.id).gte("day", from).lte("day", to)
    ]).then(function (r) {
      for (var i = 0; i < 7; i++) if (r[i].error) throw new Error(r[i].error.message);
      var members = (r[0].data || []).filter(function (m) {
        // Prefer Active staff; keep people with no status set (older rows).
        return !m.employment_status || m.employment_status === "Active";
      });
      var ids = members.map(function (m) { return m.user_id; });
      var titles = {}; (r[1].data || []).forEach(function (t) { titles[t.id] = t; });
      var depts = {}; (r[2].data || []).forEach(function (x) { depts[x.id] = x.name; });
      var entries = {}; (r[3].data || []).forEach(function (e) { entries[e.user_id + "|" + e.day] = e.shift; });
      var certs = {}; (r[5].data || []).forEach(function (c) { (certs[c.user_id] = certs[c.user_id] || []).push(c); });
      var leaves = r[4].data || [], periods = r[6].data || [];
      var attendance = {};
      if (!r[7].error) (r[7].data || []).forEach(function (a) { attendance[a.user_id + "|" + a.day] = a.status; });
      function finish(by) {
        data = {
          crew: members.map(function (m) {
            var pr = by[m.user_id] || {}, t = titles[m.job_title_id], name = pr.full_name || (pr.email || "").split("@")[0] || "Unknown";
            return { uid: m.user_id, name: name, position: t ? t.title : (m.role_label || cap(m.role)), group: t && t.crew_group ? t.crew_group : "", dept: depts[m.department_id] || "", vessel: m.assigned_vessel || "", certs: certs[m.user_id] || [] };
          }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
          entries: entries, leaves: leaves, periods: periods, attendance: attendance
        };
      }
      if (!ids.length) { finish({}); return; }
      return db.from("profiles").select("id, full_name, email").in("id", ids).then(function (p) {
        if (p.error) throw new Error(p.error.message);
        var by = {}; (p.data || []).forEach(function (x) { by[x.id] = x; });
        finish(by);
      });
    });
  }
  function sampleData(days) {
    var entries = {}, crew = window.VEYORA_ROSTER_SAMPLE.map(function (x, i) { return { uid: "s" + i, name: x.name, position: x.position, dept: "", vessel: "", certs: [], row: x.row.split(" ") }; });
    crew.forEach(function (c) {
      for (var k = -7; k < days.length; k++) {
        var d = addDays(days[0], k), code = c.row[(((d.getDate() - 1) % 12) + 12) % 12];
        if (code !== "-") entries[c.uid + "|" + iso(d)] = code;
      }
    });
    return { crew: crew, entries: entries, leaves: [], periods: [], attendance: {} };
  }
  function periodOfView() {
    var days = range(), a = iso(days[0]), b = iso(days[days.length - 1]);
    var hit = (data.periods || []).filter(function (p) { return p.period_start <= b && p.period_end >= a; })[0];
    return hit || { period_start: a, period_end: b, status: "draft" };
  }
  function periodLocked() { return periodOfView().status === "locked"; }
  function mayEdit() { return canEdit && !sampleOn && !periodLocked(); }
  function onLeave(uid, day) { return data.leaves.some(function (l) { return l.user_id === uid && l.start_date <= day && l.end_date >= day; }); }
  function cellOf(uid, day) {
    var c = data.entries[uid + "|" + day];
    if (c) return { code: c };
    if (rosterOpts().showLeave !== false && onLeave(uid, day)) return { code: "L", virtual: true };
    return null;
  }
  function expiredOn(person, day) {
    return person.certs.some(function (c) {
      return c.valid_until && c.valid_until < day && !person.certs.some(function (c2) { return c2.name.trim().toLowerCase() === c.name.trim().toLowerCase() && (!c2.valid_until || c2.valid_until >= day); });
    });
  }

  /* ---------- rule warnings (from Duty Hours + Duty Roster + Crew Assignment Rules) ---------- */
  function tagWarn(block, msg) { return (block ? "Blocked: " : "") + msg; }
  function missingQuals(person, day, code) {
    var cr = crewRules(), out = [];
    if (!code || code === "OFF" || code === "L" || code === "TRN") return out;
    var group = person.group || "Other";
    var sh = shiftBy(code);
    if (sh && sh.group && sh.group !== "Everyone" && group && group !== sh.group) out.push("This shift is for " + sh.group + " crew");
    qualTypes().forEach(function (q) {
      var need = (q.required === "All crew" && (group === "Captain" || group === "Deck" || group === "Engineering")) || q.required === group;
      if (!need) return;
      var ok = person.certs.some(function (c2) {
        return c2.name.trim().toLowerCase() === String(q.name).toLowerCase() && (!c2.valid_until || c2.valid_until >= day);
      });
      if (!ok) out.push("Missing " + q.name);
    });
    return out;
  }
  function warnings(person, day) {
    var key = person.uid + "|" + day;
    if (warnCache && warnCache[key]) return warnCache[key];
    var c = cellOf(person.uid, day), out = [];
    if (!c || !isWorking(c.code)) { if (warnCache) warnCache[key] = out; return out; }
    var o = rosterOpts(), h = dutyHours(), d = parse(day), cr = crewRules();
    if (onLeave(person.uid, day)) out.push("Blocked: On approved leave this day");
    var att = (data.attendance || {})[person.uid + "|" + day];
    if (att === "Absent") out.push("Marked Absent for this day (roster still allowed)");
    if (att === "On leave") out.push("Blocked: Marked On leave for this day");
    if (expiredOn(person, day)) out.push(tagWarn(cr.expired === true, "Expired certificate or licence (roster still allowed)"));
    missingQuals(person, day, c.code).forEach(function (m) { out.push(tagWarn(cr.qualified === true, m)); });
    if (o.warnRest !== false || cr.rest !== false) {
      var prev = cellOf(person.uid, iso(addDays(d, -1)));
      var a = prev && shiftBy(prev.code), b = shiftBy(c.code);
      if (a && b && a.start && a.end && b.start) {
        var prevEnd = toMin(a.end) + (toMin(a.end) <= toMin(a.start) ? 1440 : 0) - 1440, rest = (toMin(b.start) - prevEnd) / 60;
        if (rest < (Number(h.rest) || 8)) out.push(tagWarn(cr.rest !== false, "Only " + Math.max(0, Math.round(rest)) + "h rest after the previous shift (minimum " + (Number(h.rest) || 8) + "h)"));
      }
    }
    if (o.warnConsecutive !== false || cr.rest !== false) {
      var lim = Number(h.consecutive) || 6, run = 0, maxLook = lim + 2;
      for (var k = 0; k < maxLook; k++) { var x = cellOf(person.uid, iso(addDays(d, -k))); if (x && isWorking(x.code)) run++; else break; }
      if (run > lim) out.push(tagWarn(cr.rest !== false, run + " working days in a row (limit " + lim + ")"));
    }
    if (o.warnWeekly !== false || cr.rest !== false) {
      var sum = 0; for (var w = 0; w < 7; w++) { var y = cellOf(person.uid, iso(addDays(d, -w))); if (y) sum += hoursOf(y.code); }
      var wl = Number(h.weekly) || 60; if (sum > wl) out.push(tagWarn(cr.rest !== false, Math.round(sum) + "h in 7 days (limit " + wl + "h)"));
    }
    if (warnCache) warnCache[key] = out;
    return out;
  }

  /* ---------- derived numbers ---------- */
  function visibleCrew() {
    var days = range().map(iso);
    return data.crew.filter(function (p) {
      return (!f.dept || p.dept === f.dept) && (!f.pos || p.position === f.pos) && (!f.vessel || p.vessel === f.vessel) &&
        (!f.text || (p.name + " " + p.position).toLowerCase().indexOf(f.text) > -1) &&
        (!f.shift || days.some(function (d) { var c = cellOf(p.uid, d); return c && c.code === f.shift; }));
    });
  }
  function gaps() {
    var out = [], s = shifts().filter(function (x) { return x.needed > 0; });
    range().forEach(function (d) {
      var day = iso(d);
      s.forEach(function (sh) {
        var on = data.crew.filter(function (p) { var c = cellOf(p.uid, day); return c && c.code === sh.code; });
        if (!sh.team.length) { if (on.length < sh.needed) out.push({ day: day, code: sh.code, missing: sh.needed - on.length }); return; }
        var used = {};
        sh.team.forEach(function (t) {
          var have = on.filter(function (p) { if (used[p.uid] || !fitsRole(p, t.role)) return false; return true; }).slice(0, t.n);
          have.forEach(function (p) { used[p.uid] = 1; });
          if (have.length < t.n) out.push({ day: day, code: sh.code, missing: t.n - have.length, role: t.role });
        });
      });
    });
    return out;
  }
  function stats() {
    var days = range().map(iso), st = { crew: data.crew.length, assigned: 0, leave: 0, off: 0, empty: 0 };
    data.crew.forEach(function (p) { days.forEach(function (d) { var c = cellOf(p.uid, d); if (!c) st.empty++; else if (c.code === "L") st.leave++; else if (c.code === "OFF") st.off++; else st.assigned++; }); });
    st.unassigned = sampleOn ? st.empty : gaps().reduce(function (n, g) { return n + g.missing; }, 0);
    return st;
  }

  /* ---------- saving ---------- */
  function toast(t, err) { var el = $("toast"); el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, err ? 6000 : 3000); }
  function save(rows, okMsg) {
    if (!rows.length) { toast("Nothing to change."); return Promise.resolve(); }
    // Optimistic local update so the grid feels instant; then sync from the server.
    rows.forEach(function (r) {
      var k = r.u + "|" + r.d;
      if (r.s == null || r.s === "") delete data.entries[k]; else data.entries[k] = r.s;
    });
    warnCache = {};
    render();
    var chunks = []; for (var i = 0; i < rows.length; i += 1500) chunks.push(rows.slice(i, i + 1500));
    return chunks.reduce(function (p, ch) { return p.then(function () { return db.rpc("set_roster", { p_company: company.id, p_rows: ch }).then(function (r) { if (r.error) throw new Error(r.error.message); }); }); }, Promise.resolve())
      .then(function () { if (okMsg) toast(okMsg); return load().then(render); })
      .catch(function (e) { toast(e.message, true); return load().then(render); });
  }

  /* ---------- rendering ---------- */
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  var TABS = [["roster", "Roster"], ["assign", "By day"], ["templates", "Templates"], ["types", "Shift Types"], ["rules", "Rules"], ["settings", "Settings"]];
  function rosterCanSet() { return !!(ctx && (ctx.canHr || ctx.isAdmin || ctx.isPlatform)); }
  function rosterPill() { var m = /^#settings\/([a-z]+)/.exec(location.hash || ""); return (m && m[1]) || "shifts"; }

  function render() {
    if (!data) return;
    beginRules();
    var days = range(), todayIso = iso(new Date()), we = weekendSet();
    $("rLabel").textContent = label(days);
    $("rView").value = view;
    $("sampleToggle").setAttribute("aria-checked", sampleOn);
    $("createWrap").hidden = !mayEdit();
    $("rSub").textContent = sampleOn
      ? "Example data is on — turn it off to edit the real roster."
      : (ctx.isPlatform && !ctx.myRole ? company.name + " · viewing as platform owner" : "Plan and manage crew duties, shifts and assignments.");
    if (tab === "settings" && !rosterCanSet()) tab = "roster";
    var tabs = rosterCanSet() ? TABS : TABS.filter(function (t) { return t[0] !== "settings"; });
    $("rTabs").innerHTML = tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join("");
    if (tab === "settings") {
      $("roster").innerHTML = '<section class="dash-card" id="hrAreaSettings"></section>';
      if (window.HrSettings) window.HrSettings.mount($("hrAreaSettings"), {
        area: "roster", pill: rosterPill(), esc: esc, company: function () { return company; }, db: db,
        rpc: function (name, args) { return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); },
        canHr: rosterCanSet(), onSaved: function () { ctxRules = null; }
      });
      bind();
      return;
    }
    var main = tab === "roster" ? rosterMain(days, todayIso, we) : tab === "assign" ? assignMain(days) : tab === "templates" ? templatesMain() : tab === "types" ? typesMain() : rulesMain();
    $("roster").innerHTML = (tab === "roster" ? heroHtml(days, todayIso) : "") + '<div class="r-grid"><section class="dash-card r-card">' + main + '</section>' + sideColumn() + '</div>';
    bind();
    if (window.VeyoraTip) window.VeyoraTip("roster", [
      "Click any cell to give that person a shift for the day, or mark them off, on leave or in training.",
      "**Open shifts** shows how many more people each day still needs (set **Crew needed** in HR Settings → Shift Definitions). **Fill open shifts** fills them for you.",
      "Week view loads faster. Use Month when you need the full calendar. Example data is separate from the Dashboard demo toggle."
    ]);
  }

  // Redesign (Nov 2026): period banner with live numbers for the roster tab.
  function heroHtml(days, todayIso) {
    var st = stats(), per = periodOfView(), tstr = todayIso, onToday = { work: 0, off: 0, leave: 0 };
    data.crew.forEach(function (p) { var c = cellOf(p.uid, tstr); if (!c) return; if (c.code === "L") onToday.leave++; else if (c.code === "OFF") onToday.off++; else onToday.work++; });
    var total = st.assigned + st.leave + st.off + st.empty || 1;
    function seg(cls, n) { return n ? '<i class="' + cls + '" style="flex:' + n + '"></i>' : ""; }
    function tile(cls, ic, n, l, sub) { return '<div class="rh-tile ' + cls + '"><span class="ic">' + icon(ic) + '</span><strong>' + n + '</strong><small>' + l + '</small><em>' + sub + '</em></div>'; }
    var inView = days.some(function (d) { return iso(d) === tstr; });
    return '<section class="rh-hero"><div class="rh-l"><small>Duty roster</small><h2>' + esc(label(days)) + '</h2>' +
      '<p>' + st.crew + ' crew · ' + days.length + ' day' + (days.length === 1 ? "" : "s") + (per && per.status ? ' · <b class="rh-st ' + esc(String(per.status).toLowerCase()) + '">' + esc(per.status) + '</b>' : "") + '</p>' +
      '<div class="rh-bar" aria-hidden="true">' + seg("a", st.assigned) + seg("l", st.leave) + seg("o", st.off) + seg("e", st.empty) + '</div>' +
      '<div class="rh-lg"><span><i class="a"></i>' + st.assigned + ' shifts</span><span><i class="l"></i>' + st.leave + ' leave</span><span><i class="o"></i>' + st.off + ' off</span>' + (st.empty ? '<span><i class="e"></i>' + st.empty + ' empty</span>' : "") + '</div></div>' +
      '<div class="rh-tiles">' +
        tile("a", '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>', st.crew, "Crew", "in this roster") +
        tile("b", '<path d="m5 12 5 5 9-10"/>', inView ? onToday.work : "–", "Working today", inView ? onToday.off + " off · " + onToday.leave + " leave" : "today is not in view") +
        tile(st.unassigned ? "d" : "c", '<path d="M12 4 3 20h18L12 4ZM12 10v4M12 17h.01"/>', st.unassigned, sampleOn ? "Empty cells" : "Open shifts", st.unassigned ? "need crew" : "all covered") +
      '</div></section>';
  }

  // ---- Redesign (Nov 2026): brush painting, day coverage footer, per-person totals, density, crosshair. ----
  function totalCell(p, days) {
    var n = 0, h = 0;
    days.forEach(function (d) { var c = cellOf(p.uid, iso(d)); if (c && isWorking(c.code)) { n++; h += hoursOf(c.code); } });
    return '<td class="tot"><b>' + n + 'd</b><small>' + (Math.round(h * 10) / 10) + 'h</small></td>';
  }
  function footRow(days, we, todayIso) {
    var sh = shifts(), need = sh.reduce(function (t, x) { return t + (x.team && x.team.length ? x.team.reduce(function (a, b) { return a + b.n; }, 0) : (Number(x.needed) || 0)); }, 0);
    var crew = visibleCrew();
    return '<tfoot><tr><th class="crew">Working each day' + (need ? ' <small>of ' + need + ' needed</small>' : "") + '</th>' + days.map(function (d) {
      var day = iso(d), n = crew.filter(function (p) { var c = cellOf(p.uid, day); return c && isWorking(c.code); }).length;
      var pct = need ? Math.min(100, Math.round(n * 100 / need)) : Math.min(100, Math.round(n * 100 / Math.max(1, crew.length)));
      var cls = need ? (n >= need ? "ok" : n === 0 ? "bad" : "low") : "";
      return '<td class="' + (we.indexOf(d.getDay()) > -1 ? "we" : "") + (day === todayIso ? " today" : "") + '" data-col="' + day + '"><span class="cov ' + cls + '"><b>' + n + '</b><i style="height:' + Math.max(6, pct) + '%"></i></span></td>';
    }).join("") + '<td class="tot"></td></tr></tfoot>';
  }
  function brushBar(sh) {
    var names = {}; sh.forEach(function (x) { names[x.code] = x.name; }); RESERVED.forEach(function (r) { names[r.code] = r.name; });
    var codes = sh.map(function (x) { return x.code; }).concat(["OFF", "TRN"]);
    var can = mayEdit();
    return '<div class="r-tools">' +
      (can ? '<div class="brushes" role="group" aria-label="Paint brush"><span class="bl">Brush</span>' +
        '<button type="button" class="bb pointer' + (brush === undefined ? " on" : "") + '" data-brush="" title="Click a cell to choose from a menu">' + icon('<path d="m5 4 14 7-6 2-2 6z"/>') + 'Pick</button>' +
        codes.map(function (c) { return '<button type="button" class="bb ' + clsFor(c) + (brush === c ? " on" : "") + '" data-brush="' + esc(c) + '" title="' + esc(names[c] || c) + ' — click or drag across cells">' + esc(c) + '</button>'; }).join("") +
        '<button type="button" class="bb eraser' + (brush === null ? " on" : "") + '" data-brush="__erase" title="Clear cells — click or drag">' + icon('<path d="m7 21-4-4 10-10 7 7-7 7zM9 17l6-6"/>') + 'Erase</button></div>' : "<span></span>") +
      '<div class="dens" role="group" aria-label="Density"><button type="button" data-dense="0" class="' + (dense ? "" : "on") + '">Comfortable</button><button type="button" data-dense="1" class="' + (dense ? "on" : "") + '">Compact</button></div></div>';
  }

  function rosterMain(days, todayIso, we) {
    var crew = visibleCrew(), sh = shifts();
    function uniq(fn) { var a = []; data.crew.forEach(function (p) { var v = fn(p); if (v && a.indexOf(v) < 0) a.push(v); }); return a.sort(); }
    function sel(id, all, list, cur) { return '<select id="' + id + '" aria-label="' + all + '"><option value="">' + all + '</option>' + list.map(function (v) { return '<option' + (v === cur ? " selected" : "") + '>' + esc(v) + '</option>'; }).join("") + '</select>'; }
    var head = '<tr><th class="crew">Crew (' + crew.length + ')</th>' + days.map(function (d) {
      var w = we.indexOf(d.getDay()) > -1, t = iso(d) === todayIso;
      return '<th class="' + (w ? "we" : "") + (t ? " today" : "") + '" data-col="' + iso(d) + '">' + d.getDate() + '<small>' + d.toLocaleDateString("en-GB", { weekday: "short" }) + '</small></th>';
    }).join("") + '<th class="tot">Work</th></tr>';
    var body = crew.map(function (p) {
      var exp = expiredOn(p, todayIso);
      return '<tr><td class="crew"><span class="crew-cell"><span class="avatar-s">' + esc(p.name.split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join("").toUpperCase()) + '</span><span><strong>' + esc(p.name) + '</strong><small>' + esc(p.position) + '</small>' + (exp ? '<span class="warn doc-warn">⚠ Expired document</span>' : "") + '</span></span></td>' +
        days.map(function (d) {
          var day = iso(d), c = cellOf(p.uid, day), wn = warnings(p, day);
          var doc = c && isWorking(c.code) && (expiredOn(p, day) || missingQuals(p, day, c.code).length > 0);
          var hard = wn.filter(function (w) { return !/Expired certificate|^Missing |^Blocked: Missing |This shift is for/.test(w) || w.indexOf("Blocked") === 0; });
          var title = (c ? (c.virtual ? "Approved leave" : c.code) : "Not rostered") + (wn.length ? " — " + wn.join("; ") : "");
          var wk = we.indexOf(d.getDay()) > -1, td = day === todayIso, sd = c && isWorking(c.code) ? shiftBy(c.code) : null;
          return '<td class="' + (wk ? "we" : "") + (td ? " today" : "") + '" data-col="' + day + '"><button type="button" class="cell ' + (c ? clsFor(c.code) : "") + (c && c.virtual ? " virtual" : "") + (hard.length ? " bad" : "") + (doc ? " doc" : "") + '" data-u="' + p.uid + '" data-d="' + day + '" title="' + esc(title) + '"' + (mayEdit() ? "" : " disabled") + '>' + (c ? esc(c.code) : "–") + (sd && sd.start ? '<small>' + esc(String(sd.start).slice(0, 5)) + '</small>' : "") + '</button></td>';
        }).join("") + totalCell(p, days) + '</tr>';
    }).join("");
    return '<div class="r-filters">' + sel("fDept", "All Departments", uniq(function (p) { return p.dept; }), f.dept) + sel("fPos", "All Positions", uniq(function (p) { return p.position; }), f.pos) +
      sel("fVessel", "All Vessels", uniq(function (p) { return p.vessel; }), f.vessel) + sel("fShift", "All Shift Types", sh.map(function (s) { return s.code; }).concat(["OFF", "L", "TRN"]), f.shift) +
      '<label class="fsearch">' + icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>') + '<input id="fText" type="search" placeholder="Search crew…" value="' + esc(f.text) + '" aria-label="Search crew"></label></div>' +
      brushBar(sh) +
      (data.crew.length ? '<div class="gridwrap' + (dense ? " dense" : "") + (brush !== undefined && mayEdit() ? " brushing" : "") + '"><table class="rgrid"><thead>' + head + '</thead><tbody>' + (body || '<tr><td class="crew" colspan="' + (days.length + 2) + '">No crew match your filters.</td></tr>') + '</tbody>' + footRow(days, we, todayIso) + '</table></div>' : '<div class="empty-hr">No crew yet. Invite staff from HR &amp; Crew.</div>') +
      '<div class="legend">' + sh.map(function (s) { return '<span><span class="chip-s ' + clsFor(s.code) + '">' + esc(s.code) + '</span>' + esc(s.name) + '</span>'; }).join("") +
      RESERVED.map(function (r) { return '<span><span class="chip-s ' + r.cls + '">' + r.code + '</span>' + r.name + '</span>'; }).join("") +
      '<span><span class="chip-s c-l virtual" style="border:1px dashed">L</span>Approved leave (automatic)</span><span><span class="chip-s" style="position:relative;background:#f2f5f9">•<span style="position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#e5484d"></span></span>Rule warning (hover for details)</span><span><span class="chip-s" style="position:relative;background:#f2f5f9;overflow:hidden"><span style="position:absolute;left:0;top:0;border-style:solid;border-width:8px 8px 0 0;border-color:#f59e0b transparent transparent transparent"></span>•</span>Expired licence or document (still allowed)</span></div>' +
      (mayEdit() ? '<p class="note" style="margin-top:8px">Click a cell to change it, or pick a brush above and click or drag across cells to paint a shift.</p>' : (!sampleOn ? '<p class="note" style="margin-top:8px">' + (periodLocked() ? "This period is locked." : "View only. HR, owners, admins and the people named for Crew assignments can edit the roster.") + '</p>' : ""));
  }

  function assignMain(days) {
    var sh = shifts();
    return '<h2>Assignments</h2><p class="note">Who is on each shift, day by day. Open places use the Team (e.g. 1 Captain, 2 Crew, 1 Cashier) or Crew needed from Shift Definitions.</p><div class="dtable-wrap"><table class="dtable"><thead><tr><th>Day</th>' + sh.map(function (s) { return '<th>' + esc(s.code) + ' · ' + esc(s.name) + '</th>'; }).join("") + '<th>Off / leave</th></tr></thead><tbody>' +
      days.map(function (d) {
        var day = iso(d);
        return '<tr><td><strong>' + d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + '</strong></td>' + sh.map(function (s) {
          var on = data.crew.filter(function (p) { var c = cellOf(p.uid, day); return c && c.code === s.code; });
          var who = on.map(function (p) { var r = roleOf(p, s); return esc(p.name) + (r ? ' <small>(' + esc(r) + ')</small>' : ""); });
          var open = s.team.length ? s.team.map(function (t) { var n = t.n - on.filter(function (p) { return fitsRole(p, t.role); }).length; return n > 0 ? n + " " + t.role : ""; }).filter(Boolean)
            : (s.needed > on.length ? [(s.needed - on.length) + " open"] : []);
          return '<td class="muted-cell" style="white-space:normal">' + (who.length ? who.join(", ") : "—") + open.map(function (o) { return ' <span class="chip st-pending">' + esc(o) + (s.team.length ? " open" : "") + '</span>'; }).join("") + '</td>';
        }).join("") + '<td class="muted-cell">' + data.crew.filter(function (p) { var c = cellOf(p.uid, day); return c && c.code === "OFF"; }).length + ' off · ' + data.crew.filter(function (p) { var c = cellOf(p.uid, day); return c && c.code === "L"; }).length + ' leave</td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  var patternList = [];   // what the Apply buttons refer to: your patterns, then the library extras
  function templatesMain() {
    var mine = patterns(), names = mine.map(function (p) { return String(p.name).toLowerCase(); });
    var extra = (window.VEYORA_PATTERN_LIBRARY || []).filter(function (p) { return names.indexOf(p.name.toLowerCase()) < 0; });
    patternList = mine.concat(extra);
    var mayAdd = ctx.canHr && !sampleOn;
    function row(p, i, isExtra) {
      var codes = String(p.pattern || "").split(",").map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
      var work = codes.filter(isWorking).length;
      return '<li class="row"><span class="grow"><strong>' + esc(p.name) + '</strong><small>' + codes.length + '-day cycle · ' + work + ' working, ' + (codes.length - work) + ' off' + (p.note ? " · " + esc(p.note) : "") + '</small>' +
        '<span class="legend" style="margin-top:6px">' + codes.map(function (c) { return '<span class="chip-s ' + clsFor(c) + '">' + esc(c) + '</span>'; }).join("") + '</span></span>' +
        (isExtra && mayAdd ? '<button type="button" class="ghost" data-addpat="' + i + '">Add to my patterns</button>' : "") +
        (!isExtra && mayAdd ? '<button type="button" class="ghost" data-editpat="' + i + '">Edit</button><button type="button" class="ghost danger" data-delpat="' + i + '">Delete</button>' : "") +
        (canEdit && !sampleOn ? '<button type="button" class="save" data-apply="' + i + '">Apply</button>' : "") + '</li>';
    }
    return '<div class="card-head"><div><h2>Templates</h2><p class="note">Apply a repeating pattern to fill crew rows for this period. Your own patterns live in HR Settings → Roster Patterns.</p></div>' +
      ((mayAdd || canEdit) && !sampleOn ? '<button type="button" class="primary-btn" id="newPat"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Custom template</button>' : '<a class="edit-link" href="#settings/patterns">Edit my patterns</a>') + '</div>' +
      '<h3>My patterns <small>' + mine.length + '</small></h3><ul class="rows">' + (mine.length ? mine.map(function (p, i) { return row(p, i, false); }).join("") : '<li class="row"><small>No patterns saved yet. Add some from More templates below.</small></li>') + '</ul>' +
      (extra.length ? '<h3>More templates <small>' + extra.length + '</small></h3><ul class="rows">' + extra.map(function (p, j) { return row(p, mine.length + j, true); }).join("") + '</ul>' : "");
  }


  // Custom template builder: tap codes to build the cycle, then save it (HR) or apply it straight away (roster editors).
  function openBuilder(editIndex) {
    var mine = patterns(), editing = editIndex != null ? mine[editIndex] : null;
    var seq = editing ? String(editing.pattern || "").split(",").map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean) : [];
    var codes = shifts().map(function (s) { return s.code; }).concat(["OFF", "TRN"]);
    var mayAdd = ctx.canHr;
    function draw() {
      // keep whatever was typed before the dialog is redrawn
      var nameVal = $("bName") ? $("bName").value : (editing ? editing.name : ""), noteVal = $("bNote") ? $("bNote").value : (editing ? editing.note || "" : "");
      var work = seq.filter(isWorking).length;
      $("modalCard").innerHTML = '<h2>' + (editing ? "Edit template" : "Custom template") + '</h2><p class="note">Tap shift codes in order to build one cycle. It repeats across the period when applied.</p>' +
        '<div class="fld"><label for="bName">Name</label><input id="bName" maxlength="60" placeholder="e.g. Resort island 10/4" value="' + esc(nameVal) + '"></div>' +
        '<div class="fld"><label for="bNote">Good for (optional)</label><input id="bNote" maxlength="80" value="' + esc(noteVal) + '"></div>' +
        '<h3>Add to the cycle</h3><div class="legend" style="margin-top:0">' + codes.map(function (c) { return '<button type="button" class="chip-s ' + clsFor(c) + '" data-push="' + esc(c) + '" style="border:0;cursor:pointer;height:32px;min-width:44px">+ ' + esc(c) + '</button>'; }).join("") +
        '<button type="button" class="ghost" data-repeat="1">Repeat cycle ×2</button></div>' +
        '<h3>Cycle <small>' + seq.length + ' days · ' + work + ' working, ' + (seq.length - work) + ' off</small></h3>' +
        '<div class="legend" style="margin-top:0;min-height:30px">' + (seq.length ? seq.map(function (c, i) { return '<button type="button" class="chip-s ' + clsFor(c) + '" data-pop="' + i + '" title="Remove day ' + (i + 1) + '" style="border:0;cursor:pointer;height:30px">' + esc(c) + ' ×</button>'; }).join("") : '<small class="note">Nothing yet. Tap a code above.</small>') + '</div>' +
        '<p class="msg" id="mMsg" role="status"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button>' + (seq.length ? '<button type="button" class="ghost" id="bClear">Clear</button>' : "") +
        (canEdit ? '<button type="button" class="ghost" id="bApply">Apply now</button>' : "") + (mayAdd ? '<button type="button" class="save" id="bSave">' + (editing ? "Save changes" : "Save to my patterns") + '</button>' : "") + '</div>';
      [].forEach.call(document.querySelectorAll("[data-push]"), function (b) { b.addEventListener("click", function () { if (seq.length >= 60) { say("A cycle can be up to 60 days."); return; } seq.push(b.dataset.push); draw(); }); });
      [].forEach.call(document.querySelectorAll("[data-pop]"), function (b) { b.addEventListener("click", function () { seq.splice(Number(b.dataset.pop), 1); draw(); }); });
      document.querySelector("[data-repeat]").addEventListener("click", function () { if (!seq.length) return; if (seq.length * 2 > 60) { say("That would be longer than 60 days."); return; } seq = seq.concat(seq); draw(); });
      if ($("bClear")) $("bClear").addEventListener("click", function () { seq = []; draw(); });
      if ($("bApply")) $("bApply").addEventListener("click", function () { var p = built(); if (p) openPatternObj(p); });
      if ($("bSave")) $("bSave").addEventListener("click", function () {
        var p = built(); if (!p) return;
        var list = patterns().slice(), clash = list.some(function (x, i) { return i !== editIndex && String(x.name).toLowerCase() === p.name.toLowerCase(); });
        if (clash) { say("You already have a pattern with that name."); return; }
        if (editing) list[editIndex] = p; else list.push(p);
        savePatterns(list, editing ? "Template updated." : "“" + p.name + "” saved to your patterns.");
      });
    }
    function say(t) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg err"; } }
    function built() {
      var name = $("bName").value.trim();
      if (!seq.length) { say("Add at least one day to the cycle."); return null; }
      if (name.length < 2) { say("Give the template a name."); return null; }
      return { name: name, pattern: seq.join(","), note: $("bNote").value.trim() };
    }
    $("modalCard").innerHTML = ""; $("modal").hidden = false;
    draw();
  }

  function savePatterns(list, msg) {
    db.rpc("set_company_setting", { p_company: company.id, p_key: "8_roster_patterns", p_value: list }).then(function (r) {
      if (r.error) { toast(r.error.message, true); return; }
      company.settings = company.settings || {}; company.settings["8_roster_patterns"] = list;
      $("modal").hidden = true; toast(msg); render();
    });
  }

  function addPattern(i) {
    var p = patternList[i]; if (!p) return;
    var list = patterns().concat([{ name: p.name, pattern: p.pattern, note: p.note || "" }]);
    db.rpc("set_company_setting", { p_company: company.id, p_key: "8_roster_patterns", p_value: list }).then(function (r) {
      if (r.error) { toast(r.error.message, true); return; }
      company.settings = company.settings || {}; company.settings["8_roster_patterns"] = list;
      toast("“" + p.name + "” added to your patterns."); render();
    });
  }

  function typesMain() {
    var sh = shifts();
    return '<div class="card-head"><div><h2>Shift Types</h2><p class="note">Off, Leave and Training are always available. Change the others under Settings.</p></div>' + (rosterCanSet() ? '<a class="edit-link" href="#settings/shifts">Edit shifts</a>' : "") + '</div>' +
      '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Code</th><th>Shift</th><th>Time</th><th>Hours</th><th>Crew needed / day</th></tr></thead><tbody>' +
      sh.map(function (s) { return '<tr><td><span class="chip-s ' + clsFor(s.code) + '" style="display:inline-grid;place-items:center;min-width:30px;height:24px;border-radius:7px;font-weight:700">' + esc(s.code) + '</span></td><td>' + esc(s.name) + '</td><td class="muted-cell">' + esc(s.start) + ' – ' + esc(s.end) + '</td><td class="muted-cell">' + hoursOf(s.code) + 'h</td><td class="muted-cell">' + (s.needed || "No target") + '</td></tr>'; }).join("") +
      RESERVED.map(function (r) { return '<tr><td><span class="chip-s ' + r.cls + '" style="display:inline-grid;place-items:center;min-width:30px;height:24px;border-radius:7px;font-weight:700">' + r.code + '</span></td><td>' + r.name + '</td><td class="muted-cell">—</td><td class="muted-cell">' + (r.code === "TRN" ? "8h" : "0h") + '</td><td class="muted-cell">—</td></tr>'; }).join("") + '</tbody></table></div>';
  }

  function rulesMain() {
    var o = rosterOpts(), h = dutyHours(), car = formSetting("8_crew_assignment_rules", "Crew Assignment Rules");
    var ap = setting("8_approvers_and_responsibilities") || {}, ca = (ap.duties || {}).crew_assign || {};
    var editors = (ca.people || []).concat(ca.backup ? [ca.backup] : []).map(function (u) { var p = data.crew.filter(function (x) { return x.uid === u; })[0]; return p ? p.name : null; }).filter(Boolean);
    var rules = [
      ["Weekend days", o.weekend, "Duty Roster", "Shown in red in the grid."],
      ["Approved leave", o.showLeave !== false ? "Shown as L automatically" : "Not shown", "Duty Roster", "Working shifts can never be saved on an approved leave day."],
      ["Attendance Absent", "Soft warning only", "Attendance", "You can still put someone on a working shift if the day is marked Absent."],
      ["Past days", o.lockPast ? "Locked" : "Editable", "Duty Roster", o.lockPast ? "Changes to days before today are refused." : "Anyone who can edit may change earlier days."],
      ["Expired certificates", car.expired === true ? "Blocked from working shifts" : "Allowed, with an amber mark", "Crew Assignment Rules", "Expired licences and certificates show an amber corner on the cell."],
      ["Qualifications", car.qualified === true ? "Required certificates and crew group must match" : "Allowed, with an amber mark", "Crew Assignment Rules", "Required for the designation's crew group, and the shift's For group."],
      ["Rest and hours", car.rest !== false ? "Blocked if over the Duty Hours limits" : "Warning only", "Crew Assignment Rules", "Minimum rest, consecutive days and weekly hours."],
      ["Minimum crew", (Number(car.minCrew) || 0) ? (Number(car.minCrew) + " people / day when a shift has no Crew needed") : "No daily floor", "Crew Assignment Rules", "Checked when you publish the roster."],
      ["Minimum rest", (Number(h.rest) || 8) + " hours", "Duty Hours", o.warnRest !== false ? "Cells with less rest show a warning dot." : "Warning is off."],
      ["Days in a row", "Up to " + (Number(h.consecutive) || 6), "Duty Hours", o.warnConsecutive !== false ? "Longer runs show a warning dot." : "Warning is off."],
      ["Weekly hours", "Up to " + (Number(h.weekly) || 60) + " hours", "Duty Hours", o.warnWeekly !== false ? "Over the limit shows a warning dot." : "Warning is off."],
      ["Who can edit", "HR, owners, admins" + (editors.length ? ", " + editors.join(", ") : ""), "Approvers & Responsibilities", "Add people under Crew assignments to let them edit."]
    ];
    var ruleHref = { "Duty Roster": "#settings/roster", "Duty Hours": "#settings/hours", "Crew Assignment Rules": "hr.html#crew/settings/assign", "Approvers & Responsibilities": "hr.html#employees/settings/approvers", "Attendance": "hr.html#attendance/settings/rules" };
    return '<h2>Rules &amp; Settings</h2><p class="note">These follow the settings on this page, Crew, and Duty &amp; Attendance.</p><ul class="rows rules-list">' + rules.map(function (r) {
      var href = ruleHref[r[2]] || "#settings/roster";
      return '<li class="row"><span class="grow"><strong>' + esc(r[0]) + ': ' + esc(r[1]) + '</strong><small>' + esc(r[3]) + '</small></span><a class="edit-link" href="' + href + '">' + esc(r[2]) + ' →</a></li>';
    }).join("") + '</ul>';
  }

  function coverageList() {
    var g = gaps(), minc = Number(crewRules().minCrew) || 0, extra = [];
    if (!shifts().some(function (s) { return s.needed > 0; }) && minc > 0) {
      range().forEach(function (d) {
        var day = iso(d);
        var have = data.crew.filter(function (p) { var c = cellOf(p.uid, day); return c && isWorking(c.code); }).length;
        if (have < minc) extra.push({ day: day, code: "crew", missing: minc - have });
      });
    }
    return g.concat(extra);
  }
  function periodCard() {
    if (sampleOn) return "";
    var p = periodOfView(), cov = coverageList(), st = p.status || "draft";
    var label = st.charAt(0).toUpperCase() + st.slice(1);
    return '<section class="dash-card side-card"><div class="card-head"><h2>This period</h2><span class="chip st-' + slug(st) + '">' + esc(label) + '</span></div>' +
      '<p class="note" style="margin:6px 0 8px">' + (cov.length ? cov.length + " coverage gap" + (cov.length === 1 ? "" : "s") + " before publish." : "Coverage looks complete. You can publish.") + '</p>' +
      (cov.length ? '<ul class="st-list warn-list">' + cov.slice(0, 6).map(function (g) {
        return '<li><span class="grow"><strong>' + parse(g.day).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + '</strong><br><small class="note">' + (g.code === "crew" ? g.missing + " more people needed" : g.missing + " more on " + g.code) + '</small></span></li>';
      }).join("") + (cov.length > 6 ? '<li><small class="note">…and ' + (cov.length - 6) + ' more.</small></li>' : "") + '</ul>' : "") +
      (canEdit ? '<div class="period-actions">' +
        (st !== "locked" ? '<button type="button" class="primary-btn auto-btn" id="pubBtn">Publish roster</button>' : "") +
        (st === "locked" ? '<button type="button" class="ghost" id="unlockBtn">Unlock</button>' : '<button type="button" class="ghost" id="lockBtn">Lock</button>') +
      '</div>' : "") + '</section>';
  }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
  function sideColumn() {
    var st = stats(), sh = shifts();
    return '<div class="r-side" style="display:flex;flex-direction:column;gap:18px">' +
      periodCard() +
      '<section class="dash-card side-card"><div class="unassigned"><div><h2>' + (sampleOn ? "Empty cells" : "Open shifts") + '</h2><strong>' + st.unassigned + '</strong><small class="note" style="display:block;margin:0">' + (sampleOn ? "cells with no shift yet" : "people still needed this period") + '</small></div><span class="alert">' + icon('<path d="M12 4 2.5 20h19zM12 10v4M12 17v.5"/>') + '</span></div>' +
      (!sampleOn && !sh.some(function (s) { return s.needed > 0; }) ? '<p class="note" style="margin:6px 0 0">Set <a href="#settings/shifts">Crew needed</a> to count open shifts.</p>' : "") +
      (mayEdit() ? '<button type="button" class="primary-btn auto-btn" id="autoBtn">' + icon('<path d="m5 19 9-9M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z"/>') + 'Fill open shifts</button>' : "") + '</section>' +
      '<section class="dash-card side-card"><div class="card-head"><h2>Shift Types</h2>' + (rosterCanSet() ? '<a class="edit-link" href="#settings/shifts">Edit</a>' : "") + '</div><ul class="st-list">' +
      sh.map(function (s) { return '<li><span class="chip-s ' + clsFor(s.code) + '" style="display:inline-grid;place-items:center;min-width:30px;height:26px;border-radius:7px;font-weight:700;font-size:12px">' + esc(s.code) + '</span><span class="grow">' + esc(s.name) + '</span><span class="time">' + esc(s.start) + (s.start ? " – " : "") + esc(s.end) + '</span></li>'; }).join("") +
      RESERVED.map(function (r) { return '<li><span class="chip-s ' + r.cls + '" style="display:inline-grid;place-items:center;min-width:30px;height:26px;border-radius:7px;font-weight:700;font-size:11px">' + r.code + '</span><span class="grow">' + r.name + '</span></li>'; }).join("") + '</ul></section>' +
      '<section class="dash-card side-card"><h2>Quick Actions</h2><ul class="qa-list">' +
      (mayEdit() ? '<li><button type="button" data-act="copy">' + icon('<path d="M8 8h11v11H8zM5 16V5h11"/>') + 'Copy previous ' + (view === "Month" ? "month" : "period") + '</button></li><li><button type="button" data-act="clear">' + icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>') + 'Clear roster</button></li>' : "") +
      '<li><a href="hr.html#leave">' + icon('<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>') + 'Manage leave requests</a></li>' +
      '<li><button type="button" data-act="print">' + icon('<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>') + 'Export roster (PDF)</button></li>' +
      '<li><button type="button" data-act="csv">' + icon('<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>') + 'Export to Excel</button></li>' +
      '<li><button type="button" data-act="print">' + icon('<path d="M7 9V3h10v6M7 17H4V9h16v8h-3M7 14h10v7H7z"/>') + 'Print roster</button></li></ul></section>' +
      '<section class="dash-card side-card"><h2>Roster Statistics</h2><ul class="stats-list"><li>Total crew<b>' + st.crew + '</b></li><li>Assigned shifts<b>' + st.assigned + '</b></li><li>' + (sampleOn ? "Empty cells" : "Open shifts") + '<b>' + st.unassigned + '</b></li><li>On leave<b>' + st.leave + '</b></li><li>Off duty<b>' + st.off + '</b></li></ul></section></div>';
  }

  /* ---------- interactions ---------- */
  function bind() {
    [].forEach.call(document.querySelectorAll("#rTabs [data-tab]"), function (b) { b.addEventListener("click", function () {
      tab = b.dataset.tab;
      if (tab === "settings") history.replaceState(null, "", "#settings/" + rosterPill());
      else if (location.hash.indexOf("#settings") === 0) history.replaceState(null, "", location.pathname + location.search);
      render();
    }); });
    [["fDept", "dept"], ["fPos", "pos"], ["fVessel", "vessel"], ["fShift", "shift"]].forEach(function (p) { var el = $(p[0]); if (el) el.addEventListener("change", function () { f[p[1]] = el.value; render(); }); });
    var t = $("fText"); if (t) {
      clearTimeout(render._q);
      t.addEventListener("input", function () {
        var pos = t.selectionStart, val = t.value.trim().toLowerCase();
        clearTimeout(render._q);
        render._q = setTimeout(function () {
          f.text = val; render();
          var n = $("fText"); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
        }, 180);
      });
    }
    [].forEach.call(document.querySelectorAll(".cell:not([disabled])"), function (c) { c.addEventListener("click", function (e) { e.stopPropagation(); if (brush !== undefined) return; openCellMenu(c); }); });
    [].forEach.call(document.querySelectorAll("[data-brush]"), function (b) { b.addEventListener("click", function () {
      var v = b.dataset.brush; brush = v === "" ? undefined : v === "__erase" ? null : (brush === v ? undefined : v); $("cellMenu").hidden = true; render();
    }); });
    [].forEach.call(document.querySelectorAll("[data-dense]"), function (b) { b.addEventListener("click", function () { dense = b.dataset.dense === "1"; try { localStorage.setItem("veyora-roster-dense", dense ? "1" : "0"); } catch (e) {} render(); }); });
    var gw = document.querySelector(".gridwrap");
    if (gw) {
      // Paint: press on a cell with a brush selected, drag across more cells, release to save them all in one go.
      var painting = null;
      var stamp = function (c) {
        if (!painting || painting.seen[c.dataset.u + "|" + c.dataset.d]) return;
        painting.seen[c.dataset.u + "|" + c.dataset.d] = 1;
        painting.rows.push({ u: c.dataset.u, d: c.dataset.d, s: brush === null ? null : brush });
        c.classList.add("painted"); c.textContent = brush === null ? "–" : brush;
      };
      gw.addEventListener("pointerdown", function (e) {
        var c = e.target.closest && e.target.closest(".cell:not([disabled])");
        if (!c || brush === undefined || e.button !== 0) return;
        e.preventDefault(); painting = { rows: [], seen: {} }; stamp(c);
        try { gw.setPointerCapture(e.pointerId); } catch (x) {}
      });
      gw.addEventListener("pointermove", function (e) {
        if (!painting) return;
        var el = document.elementFromPoint(e.clientX, e.clientY), c = el && el.closest && el.closest(".cell:not([disabled])");
        if (c) stamp(c);
      });
      var stop = function () { if (!painting) return; var rows = painting.rows; painting = null; if (rows.length) save(rows, rows.length > 1 ? rows.length + " cells updated." : ""); };
      gw.addEventListener("pointerup", stop); gw.addEventListener("pointercancel", stop);
      // Crosshair: highlight the person's row and the day's column under the pointer.
      var lastCol = null;
      gw.addEventListener("mouseover", function (e) {
        var c = e.target.closest && e.target.closest(".cell"); var col = c ? c.parentNode.getAttribute("data-col") : null;
        if (col === lastCol) return;
        if (lastCol) [].forEach.call(gw.querySelectorAll('[data-col="' + lastCol + '"].colhl'), function (x) { x.classList.remove("colhl"); });
        lastCol = col; if (col) [].forEach.call(gw.querySelectorAll('[data-col="' + col + '"]'), function (x) { x.classList.add("colhl"); });
      });
      gw.addEventListener("mouseleave", function () { if (lastCol) [].forEach.call(gw.querySelectorAll(".colhl"), function (x) { x.classList.remove("colhl"); }); lastCol = null; });
    }
    [].forEach.call(document.querySelectorAll("[data-act]"), function (b) { b.addEventListener("click", function () { action(b.dataset.act); }); });
    [].forEach.call(document.querySelectorAll("[data-apply]"), function (b) { b.addEventListener("click", function () { openPattern(Number(b.dataset.apply)); }); });
    [].forEach.call(document.querySelectorAll("[data-addpat]"), function (b) { b.addEventListener("click", function () { addPattern(Number(b.dataset.addpat)); }); });
    [].forEach.call(document.querySelectorAll("[data-editpat]"), function (b) { b.addEventListener("click", function () { openBuilder(Number(b.dataset.editpat)); }); });
    [].forEach.call(document.querySelectorAll("[data-delpat]"), function (b) { b.addEventListener("click", function () {
      var i = Number(b.dataset.delpat), p = patterns()[i];
      confirmBox("Delete template", "Remove “" + esc(p.name) + "” from your patterns? Shifts already on the roster stay.", "Delete", function () { var list = patterns().slice(); list.splice(i, 1); savePatterns(list, "Template deleted."); });
    }); });
    if ($("newPat")) $("newPat").addEventListener("click", function () { openBuilder(null); });
    var ab = $("autoBtn"); if (ab) ab.addEventListener("click", function () { action("auto"); });
    if ($("pubBtn")) $("pubBtn").addEventListener("click", publishPeriod);
    if ($("lockBtn")) $("lockBtn").addEventListener("click", function () { setPeriod("locked"); });
    if ($("unlockBtn")) $("unlockBtn").addEventListener("click", function () { setPeriod("amended"); });
  }
  function publishPeriod() {
    var p = periodOfView();
    confirmBox("Publish roster", "Publishing " + esc($("rLabel").textContent) + " checks coverage gaps (Crew needed / minimum crew). Later edits mark the period as amended.", "Publish", function () {
      db.rpc("publish_roster", { p_company: company.id, p_start: p.period_start, p_end: p.period_end }).then(function (r) {
        if (r.error) toast(r.error.message, true); else toast("Roster published.");
      }).then(reload);
    });
  }
  function setPeriod(status) {
    var p = periodOfView();
    db.rpc("set_roster_period_status", { p_company: company.id, p_start: p.period_start, p_end: p.period_end, p_status: status }).then(function (r) {
      if (r.error) toast(r.error.message, true); else toast("Roster " + status + ".");
    }).then(reload);
  }

  function openCellMenu(btn) {
    var m = $("cellMenu"), u = btn.dataset.u, d = btn.dataset.d, person = data.crew.filter(function (p) { return p.uid === u; })[0];
    var codes = shifts().map(function (s) { return s.code; }).concat(["OFF", "L", "TRN"]);
    var names = {}; shifts().forEach(function (s) { names[s.code] = s.name; }); RESERVED.forEach(function (r) { names[r.code] = r.name; });
    m.innerHTML = '<span class="cm-title">' + esc(person.name) + ' · ' + parse(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + '</span>' +
      (expiredOn(person, d) ? '<span class="cm-warn">⚠ Has an expired licence or certificate. You can still roster them.</span>' : "") +
      codes.map(function (c) { return '<button type="button" class="' + clsFor(c) + '" data-code="' + esc(c) + '">' + esc(c) + '<small>' + esc(names[c] || "") + '</small></button>'; }).join("") + '<button type="button" class="clear" data-code="">Not rostered (clear)</button>';
    var r = btn.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    m.hidden = false;
    var left = Math.min(r.left / z, (window.innerWidth / z) - m.offsetWidth - 10), top = r.bottom / z + 6;
    if (top + m.offsetHeight > window.innerHeight / z) top = r.top / z - m.offsetHeight - 6;
    m.style.left = Math.max(8, left) + "px"; m.style.top = Math.max(8, top) + "px";
    [].forEach.call(m.querySelectorAll("[data-code]"), function (b) {
      b.addEventListener("click", function () { m.hidden = true; save([{ u: u, d: d, s: b.dataset.code || null }]); });
    });
  }
  document.addEventListener("click", function (e) { if (!e.target.closest("#cellMenu")) $("cellMenu").hidden = true; if (!e.target.closest(".split")) $("createMenu").hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $("cellMenu").hidden = true; $("createMenu").hidden = true; if (brush !== undefined) { brush = undefined; if (data) render(); } } });

  function confirmBox(title, text, okLabel, onOk) {
    $("modalCard").innerHTML = '<h2>' + esc(title) + '</h2><p class="note">' + text + '</p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="mOk">' + esc(okLabel) + '</button></div>';
    $("modal").hidden = false;
    $("mOk").addEventListener("click", function () { $("modal").hidden = true; onOk(); });
  }
  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) $("modal").hidden = true; });

  function action(a) {
    $("createMenu").hidden = true;
    if (a !== "print" && a !== "csv" && !mayEdit()) { toast(periodLocked() ? "This period is locked." : "You cannot edit this roster.", true); return; }
    var days = range().map(iso);
    if (a === "print") { window.print(); return; }
    if (a === "csv") {
      var rows = [["Crew", "Position"].concat(days)].concat(visibleCrew().map(function (p) { return [p.name, p.position].concat(days.map(function (d) { var c = cellOf(p.uid, d); return c ? c.code : ""; })); }));
      var csv = rows.map(function (r) { return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
      var link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); link.download = "roster-" + days[0] + ".csv"; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      return;
    }
    if (a === "clear") {
      var del = []; data.crew.forEach(function (p) { days.forEach(function (d) { if (data.entries[p.uid + "|" + d]) del.push({ u: p.uid, d: d, s: null }); }); });
      if (!del.length) { toast("This period is already empty."); return; }
      confirmBox("Clear roster", "Remove all " + del.length + " entries from " + esc($("rLabel").textContent) + "? Approved leave stays.", "Clear", function () { save(del, "Roster cleared."); });
      return;
    }
    if (a === "copy") {
      var n = days.length, prevStart = view === "Month" ? (function () { var x = parse(days[0]); return new Date(x.getFullYear(), x.getMonth() - 1, 1); })() : addDays(parse(days[0]), -n);
      var prevLen = view === "Month" ? new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 0).getDate() : n;
      var from = iso(prevStart), to = iso(addDays(prevStart, prevLen - 1));
      db.from("roster_entries").select("user_id, day, shift").eq("company_id", company.id).gte("day", from).lte("day", to).then(function (r) {
        if (r.error) { toast(r.error.message, true); return; }
        var src = {}; r.data.forEach(function (e) { src[e.user_id + "|" + e.day] = e.shift; });
        var out = [];
        data.crew.forEach(function (p) { days.forEach(function (d, i) {
          if (i >= prevLen || data.entries[p.uid + "|" + d] || onLeave(p.uid, d)) return;
          var code = src[p.uid + "|" + iso(addDays(prevStart, i))]; if (code) out.push({ u: p.uid, d: d, s: code });
        }); });
        if (!out.length) { toast("Nothing to copy: the previous period is empty or every cell here is already filled."); return; }
        confirmBox("Copy previous " + (view === "Month" ? "month" : "period"), "Fill " + out.length + " empty cells from " + from + " to " + to + ". Filled cells and leave days are left alone.", "Copy", function () { save(out, out.length + " cells copied."); });
      });
      return;
    }
    if (a === "pattern" || a === "create") { tab = "templates"; render(); return; }
    if (a === "auto") { autoAssign(); return; }
  }

  // Fills open shifts (Crew needed) with available people: not rostered that day, not on leave,
  // no expired certificate, and within the consecutive-days and rest limits. Fewest shifts first.
  function autoAssign() {
    var g = gaps();
    if (!shifts().some(function (s) { return s.needed > 0; })) { toast("Set a Team (e.g. 1 Captain, 2 Crew, 1 Cashier) or Crew needed under Shift Definitions first.", true); return; }
    if (!g.length) { toast("No open shifts in this period."); return; }
    var load = {}; data.crew.forEach(function (p) { load[p.uid] = 0; range().forEach(function (d) { var c = cellOf(p.uid, iso(d)); if (c && isWorking(c.code)) load[p.uid]++; }); });
    var planned = [], keep = data.entries; data.entries = Object.assign({}, keep);
    g.forEach(function (gap) {
      for (var k = 0; k < gap.missing; k++) {
        var cand = data.crew.filter(function (p) {
          if (cellOf(p.uid, gap.day) || onLeave(p.uid, gap.day) || (gap.role && !fitsRole(p, gap.role))) return false;
          data.entries[p.uid + "|" + gap.day] = gap.code;
          var bad = warnings(p, gap.day).some(function (w) { return w.indexOf("Blocked") === 0 || / rest |in a row|in 7 days/.test(w); });
          delete data.entries[p.uid + "|" + gap.day];
          return !bad;
        }).sort(function (a, b) {
          var da = expiredOn(a, gap.day) || missingQuals(a, gap.day, gap.code).length ? 1 : 0, dbb = expiredOn(b, gap.day) || missingQuals(b, gap.day, gap.code).length ? 1 : 0;
          return da - dbb || load[a.uid] - load[b.uid] || a.name.localeCompare(b.name);
        })[0];
        if (!cand) break;
        data.entries[cand.uid + "|" + gap.day] = gap.code; load[cand.uid]++;
        planned.push({ u: cand.uid, d: gap.day, s: gap.code });
      }
    });
    data.entries = keep;
    var open = g.reduce(function (n, x) { return n + x.missing; }, 0);
    if (!planned.length) { toast("Nobody is free for the open shifts without breaking a rule (leave, certificates, rest or days in a row).", true); return; }
    confirmBox("Fill open shifts", "Fill " + planned.length + " of " + open + " open shifts with available crew. Each place gets someone with the right role (Captain, Crew, Cashier…). People on leave or who would break rest and days-in-a-row limits are skipped; people with expired documents are used only when nobody else fits, and get an amber mark.", "Assign " + planned.length, function () { save(planned, planned.length + " shifts assigned."); });
  }

  function openPattern(i) { openPatternObj(patternList[i]); }
  function openPatternObj(p) {
    var codes = String(p.pattern || "").split(",").map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean), days = range().map(iso);
    if (!codes.length) { toast("That pattern has no shift codes.", true); return; }
    var crew = visibleCrew();
    $("modalCard").innerHTML = '<h2>Apply “' + esc(p.name) + '”</h2><p class="note">' + codes.join(" · ") + ' repeating, for ' + esc($("rLabel").textContent) + '. Leave days are skipped.</p>' +
      '<div class="fld"><label for="pStart">Start the pattern on</label><input id="pStart" type="date" min="' + days[0] + '" max="' + days[days.length - 1] + '" value="' + days[0] + '"></div>' +
      '<div class="fld tog"><span>Overwrite cells that already have a shift</span><button type="button" class="sw" role="switch" id="pOver" aria-checked="false" aria-label="Overwrite existing"></button></div>' +
      '<h3>Crew</h3><label class="remember" style="display:flex;gap:8px;margin-bottom:6px"><input type="checkbox" id="pAll"> <span>Select everyone shown (' + crew.length + ')</span></label>' +
      '<div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:8px">' + crew.map(function (c) { return '<label style="display:flex;gap:8px;padding:4px 2px;font-size:13px"><input type="checkbox" class="pCrew" value="' + c.uid + '"> ' + esc(c.name) + ' <small class="muted-cell">' + esc(c.position) + '</small></label>'; }).join("") + '</div>' +
      '<p class="msg" id="mMsg"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="pGo">Apply pattern</button></div>';
    $("modal").hidden = false;
    $("pOver").addEventListener("click", function () { this.setAttribute("aria-checked", this.getAttribute("aria-checked") !== "true"); });
    $("pAll").addEventListener("change", function () { var on = this.checked; [].forEach.call(document.querySelectorAll(".pCrew"), function (x) { x.checked = on; }); });
    $("pGo").addEventListener("click", function () {
      var who = [].filter.call(document.querySelectorAll(".pCrew"), function (x) { return x.checked; }).map(function (x) { return x.value; });
      if (!who.length) { $("mMsg").textContent = "Choose at least one person."; $("mMsg").className = "msg err"; return; }
      var start = $("pStart").value || days[0], over = $("pOver").getAttribute("aria-checked") === "true", rows = [];
      who.forEach(function (u) { days.forEach(function (d) {
        if (d < start || onLeave(u, d)) return;
        if (!over && data.entries[u + "|" + d]) return;
        var idx = Math.round((parse(d) - parse(start)) / 864e5) % codes.length; rows.push({ u: u, d: d, s: codes[idx] });
      }); });
      $("modal").hidden = true;
      save(rows, rows.length + " cells filled from “" + p.name + "”.");
    });
  }

  /* ---------- header controls ---------- */
  $("rPrev").addEventListener("click", function () { step(-1); });
  $("rNext").addEventListener("click", function () { step(1); });
  function step(dir) {
    var a = new Date(anchor);
    anchor = view === "Month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * (view === "Two weeks" ? 14 : 7));
    reload();
  }
  $("rView").addEventListener("change", function () { view = this.value; if (view === "Month") { var a = new Date(anchor); anchor = new Date(a.getFullYear(), a.getMonth(), 1); } reload(); });
  $("createBtn").addEventListener("click", function () { tab = "templates"; render(); });
  $("createMore").addEventListener("click", function (e) { e.stopPropagation(); $("createMenu").hidden = !$("createMenu").hidden; });
  [].forEach.call(document.querySelectorAll("#createMenu [data-act]"), function (b) { b.addEventListener("click", function () { action(b.dataset.act); }); });
  // Full screen: the whole page goes full screen (so menus, toasts and dialogs keep working); the sidebar, top bar, banner and side cards step aside
  // and the grid fills the screen. Where the Fullscreen API is not available the same layout fills the browser window.
  function setFs(on) {
    document.documentElement.classList.toggle("rfs", !!on);
    var b = $("fsBtn"); if (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); b.querySelector("span").textContent = on ? "Exit full screen" : "Full screen"; }
    if (data) render();
  }
  $("fsBtn").addEventListener("click", function () {
    var on = !document.documentElement.classList.contains("rfs"), de = document.documentElement;
    if (on) {
      setFs(true);
      if (de.requestFullscreen) de.requestFullscreen().catch(function () {});
    } else {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); else setFs(false);
    }
  });
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && document.documentElement.classList.contains("rfs")) setFs(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.documentElement.classList.contains("rfs") && !document.fullscreenElement && brush === undefined && $("cellMenu").hidden && $("modal").hidden) setFs(false);
  });
  $("sampleToggle").addEventListener("click", function () { sampleOn = !sampleOn; try { localStorage.setItem(SAMPLE_KEY, sampleOn ? "1" : "0"); } catch (e) {} reload(); });
  function reload(quiet) {
    if (!quiet) $("roster").innerHTML = '<p class="msg">Loading…</p>';
    return load().then(render).catch(function (e) { $("roster").innerHTML = '<section class="dash-card"><h2>Could not load the roster</h2><p class="note">' + esc(e.message) + '</p></section>'; });
  }

  /* ---------- start ---------- */
  window.VeyoraShell.start({
    active: "HR & Crew",
    onCompany: function (c, info) {
      company = c; ctx = info; data = null; tab = /^#settings/.test(location.hash) ? "settings" : "roster";
      beginRules();
      view = rosterOpts().view || "Week";
      if (["Week", "Two weeks", "Month"].indexOf(view) < 0) view = "Week";
      var now = new Date(); anchor = view === "Month" ? new Date(now.getFullYear(), now.getMonth(), 1) : now;
      return db.rpc("can_edit_roster", { cid: c.id }).then(function (r) { canEdit = !r.error && r.data === true; return reload(); });
    },
    onNone: function (isPlatform) {
      $("roster").innerHTML = '<section class="dash-card"><h2>' + (isPlatform ? "Select a company" : "No company yet") + '</h2><p class="note">' + (isPlatform ? "Use the company menu at the top left to open a company." : "Create a company from the sign-in page, or ask your administrator for an invite.") + '</p></section>';
    },
    onError: function (err) { $("roster").innerHTML = '<section class="dash-card"><h2>Could not load the roster</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
  window.addEventListener("hashchange", function () {
    if (!company) return;
    var want = /^#settings/.test(location.hash);
    if (want) { tab = "settings"; render(); }
    else if (tab === "settings") { tab = "roster"; render(); }
  });
})();
