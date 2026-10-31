/* HR & Crew: one page with sections (hr.html#overview, #employees, #employee/<id>/<tab>, #attendance, #crew, #leave).
   Employee record, roster, attendance and crew assignment all read the same data.
   Behaviour comes from Settings > HR & Crew Settings (keys starting with 8_) and Organization (2_). */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc, cap = window.VeyoraShell.cap;
  var $ = function (id) { return document.getElementById(id); };
  var SAMPLE_KEY = "veyora-dash-sample";

  var company = null, ctx = null, model = null;
  var sampleOn = false;
  try { sampleOn = localStorage.getItem(SAMPLE_KEY) === "1"; } catch (e) {}
  var tab = null, fText = "", fRole = "", fStatus = "", fDept = "", fEmp = "", fEmpStatus = "", fCat = "", empView = "cards";
  var attDay = null, attFilter = "";
  var tsWeek = null, tsFilter = "", excFilter = "", tsOpen = {}, tsGen = 0;
  var crewDay = null, crewOnlyBlocked = false, certFilter = "", leaveFilter = "Pending", calMonth = null;
  var cache = {}; // per-profile lazy data: events, docs, agreements, duty history

  /* ---------- settings (with the same defaults as settings-defs.js) ---------- */
  function setting(key) { return company && company.settings ? company.settings[key] : undefined; }
  function defaultsOf(title) { return window.VEYORA_DEFS && window.VEYORA_DEFS[title]; }
  function formSetting(key, title) {
    var saved = setting(key), spec = defaultsOf(title), out = {};
    (spec && spec.fields || []).forEach(function (f) { out[f.k] = f.d; });
    if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function tableSetting(key, title) {
    var saved = setting(key), spec = defaultsOf(title) || {};
    var rows = Array.isArray(saved) ? saved : spec.def || [];
    var first = spec.cols ? spec.cols[0].k : "name";
    return rows.map(function (r) { if (typeof r === "string") { var o = {}; o[first] = r; return o; } return r; });
  }
  function listSetting(key, title) {
    var saved = setting(key), spec = defaultsOf(title) || {};
    var rows = Array.isArray(saved) ? saved : ((spec.base || spec).def || []);
    return rows.map(function (r) { return typeof r === "string" ? r : r && r.name; }).filter(Boolean);
  }
  function dirOpts() { return formSetting("8_directory_tabs_filters_and_columns", "Directory Tabs, Filters & Columns"); }
  function leaveTypes() { var t = tableSetting("8_leave_types_and_policies", "Leave Types & Policies"); return t.length ? t : [{ name: "Annual leave", days: 0, paid: true, note: false }]; }
  function qualTypes() { return tableSetting("8_crew_qualification_types", "Crew Qualification Types"); }
  function shiftDefs() { return tableSetting("8_shift_definitions", "Shift Definitions"); }
  function alerts() {
    var f = formSetting("8_license_and_certificate_expiry_alerts", "License & Certificate Expiry Alerts");
    return { first: Math.max(1, Number(f.first) || 90), second: Math.max(0, Number(f.second) || 30), final: Math.max(0, Number(f.final) || 7) };
  }
  function expiryWindow() { return alerts().first; }
  function workflow() { return formSetting("8_leave_approval_workflow", "Leave Approval Workflow"); }
  function attRules() { return formSetting("8_attendance_rules", "Attendance Rules"); }
  function crewRules() { return formSetting("8_crew_assignment_rules", "Crew Assignment Rules"); }
  function docCats() { return listSetting("8_hr_document_categories", "HR Document Categories"); }
  function docStore() { return formSetting("14_document_storage_settings", "Document Storage Settings"); }
  function staffCats() { return listSetting("2_staff_categories", "Staff Categories"); }
  function empTypes() { return listSetting("2_employment_types", "Employment Types"); }
  function weekendDays() {
    var w = formSetting("8_duty_roster", "Duty Roster").weekend || "Friday & Saturday";
    return { "Friday & Saturday": [5, 6], "Saturday & Sunday": [6, 0], "Friday only": [5], "None": [] }[w] || [5, 6];
  }

  /* ---------- helpers ---------- */
  function pad2(n) { return n == null ? "–" : n < 10 ? "0" + n : String(n); }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayIso() { return iso(new Date()); }
  function addDaysIso(n, from) { var d = from ? new Date(from + "T00:00:00") : new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function addMonthsIso(m) { var d = new Date(); d.setMonth(d.getMonth() + m); return iso(d); }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
  function initials(n) { return String(n).split(/\s+/).filter(Boolean).slice(0, 2).map(function (s) { return s[0]; }).join("").toUpperCase(); }
  function days(a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5) + 1; }
  function workingDays(a, b) {
    var off = weekendDays(), n = 0, d = new Date(a + "T00:00:00"), end = new Date(b + "T00:00:00");
    for (; d <= end && n < 400; d.setDate(d.getDate() + 1)) if (off.indexOf(d.getDay()) < 0) n++;
    return n;
  }
  function fmtDate(s) { return s ? new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
  function fmtRange(a, b) {
    var d1 = new Date(a + "T00:00:00"), d2 = new Date(b + "T00:00:00"), mo = function (d) { return d.toLocaleDateString("en-GB", { month: "long" }); };
    if (a === b) return d1.getDate() + " " + mo(d1);
    if (mo(d1) === mo(d2)) return d1.getDate() + "–" + d2.getDate() + " " + mo(d1);
    return d1.getDate() + " " + mo(d1) + " – " + d2.getDate() + " " + mo(d2);
  }
  function when(ts) { var d = new Date(ts); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
  function groupOf(groupSet, pos) {
    if (groupSet) return groupSet;
    pos = String(pos || "");
    if (/captain|master|skipper/i.test(pos)) return "Captain";
    if (/engineer|mechanic|oiler/i.test(pos)) return "Engineering";
    if (/deck|mate|officer|bosun|sailor|crew/i.test(pos)) return "Deck";
    return "Shore";
  }
  function isWorking(code) { return !!code && code !== "OFF" && code !== "L"; }
  // Cursor 2026-10-23: employee directory tabs = departments (not crew groups).
  function employeeTabs() {
    var tabs = [["all", "All staff"]];
    (model.depts || []).forEach(function (d) { tabs.push(["dept:" + d.id, d.name]); });
    tabs.push(["dept:", "No department"]);
    return tabs;
  }
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  var I = {
    people: '<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 3-5.5 6-5.5s6 2.2 6 5.5M16 5a3.5 3.5 0 0 1 0 6.5M21 20c0-2.4-1.5-4.2-3.6-5"/>',
    check: '<path d="m5 12 5 5 9-10"/>', cal: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>', shield: '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    ship: '<path d="M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4"/>', brief: '<path d="M4 8h16v11H4zM9 8V5h6v3M4 13h16"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', alert: '<path d="M12 4 3 20h18L12 4ZM12 10v4M12 17h.01"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>', back: '<path d="M15 6l-6 6 6 6"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'
  };

  /* ---------- routing ---------- */
  function route() {
    var h = (location.hash || "#overview").slice(1).split("/");
    var v = h[0] || "overview";
    // Cursor 2026-10-23: #organization = Departments & Designations page.
    if (["overview", "employees", "employee", "attendance", "crew", "leave", "payroll", "reports", "organization", "allowances"].indexOf(v) < 0) v = "overview";
    return { view: v, id: h[1] === "me" && ctx ? ctx.me : h[1] || "", sub: h[2] || "" };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  /* ---------- data ---------- */
  // Renewal-aware certificate status: one row per person and qualification, the latest expiry wins.
  function certStage(validUntil) {
    var a = alerts(), t = todayIso();
    if (!validUntil) return { key: "valid", label: "No expiry" };
    if (validUntil < t) return { key: "expired", label: "Expired" };
    var left = days(t, validUntil) - 1;
    if (left <= a.final) return { key: "final", label: left === 0 ? "Expires today" : "Expires in " + left + (left === 1 ? " day" : " days") };
    if (left <= a.second) return { key: "soon", label: "Expires soon (" + left + " days)" };
    if (left <= a.first) return { key: "due", label: "Due for renewal (" + left + " days)" };
    return { key: "valid", label: "Valid" };
  }
  function effectiveCerts(list) {
    var by = {};
    list.forEach(function (c) {
      var k = c.user_id + "|" + String(c.name).trim().toLowerCase(), cur = by[k];
      if (!cur || (cur.valid_until && (!c.valid_until || c.valid_until > cur.valid_until))) by[k] = c;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  function inviteUrl(token) {
    return location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html?invite=" + encodeURIComponent(token);
  }

  /* Cursor 2026-10-24: invited people (no password yet) still appear in Employees. */
  function pendingInviteRows(invites, pendingSettings, titles, depts, memberEmails) {
    var byEmail = {}, byId = {}, now = Date.now();
    (invites || []).forEach(function (inv) {
      if (inv.accepted_at) return;
      var mail = String(inv.email || "").toLowerCase();
      if (!mail || memberEmails[mail]) return;
      byEmail[mail] = inv;
      byId[inv.id] = inv;
    });
    (pendingSettings || []).forEach(function (item) {
      if (!item) return;
      var mail = String(item.email || "").toLowerCase();
      if (!mail || memberEmails[mail]) return;
      if (!byEmail[mail]) {
        byEmail[mail] = {
          id: item.invite_id || ("pending-" + mail),
          email: mail,
          role: (item.profile && item.profile.role) || "staff",
          role_label: null,
          token: null,
          meta: { profile: item.profile || {} },
          expires_at: null,
          created_at: item.created_at
        };
      } else if (item.profile) {
        var baseProf = (byEmail[mail].meta && byEmail[mail].meta.profile) || {};
        byEmail[mail].meta = byEmail[mail].meta || {};
        byEmail[mail].meta.profile = Object.assign({}, baseProf, item.profile);
      }
    });
    return Object.keys(byEmail).map(function (mail) {
      var inv = byEmail[mail];
      var prof = (inv.meta && inv.meta.profile) || {};
      var titleId = prof.job_title_id || "";
      var deptId = prof.department_id || "";
      var t = titles[titleId];
      var position = t ? t.title : (inv.role_label || cap(inv.role) || "Staff");
      var group = groupOf(t && t.crew_group, position);
      var expired = !!(inv.expires_at && new Date(inv.expires_at).getTime() < now);
      var name = String(prof.full_name || "").trim() || mail.split("@")[0] || "Invited staff";
      return {
        uid: "invite:" + inv.id,
        inviteId: inv.id,
        inviteToken: inv.token || null,
        pendingInvite: true,
        titleId: titleId,
        rawGroup: t ? t.crew_group : null,
        deptId: deptId || null,
        managerId: prof.manager_id || "",
        name: name,
        email: mail,
        position: position,
        group: group,
        dept: depts[deptId] || "",
        employment: prof.employment_type || "",
        empNo: prof.employee_no || "",
        start: prof.start_date || "",
        category: prof.staff_category || "",
        role: inv.role || prof.role || "staff",
        status: expired ? "Invite expired" : "Invite sent",
        shownStatus: expired ? "Invite expired" : "Invite sent",
        active: false,
        probationEnd: prof.probation_end || "",
        contractEnd: "",
        endDate: "",
        phone: prof.phone || "",
        allowances: Array.isArray(prof.allowances) ? prof.allowances : [],
        emergency: prof.emergency_contact || "",
        reason: "",
        vessel: "",
        duty: expired ? "Invite expired" : "Awaiting signup",
        shiftToday: "",
        manualDuty: "",
        certs: [],
        effCerts: [],
        missing: [],
        cert: "",
        valid: "",
        expired: false,
        inviteCreated: inv.created_at || "",
        inviteExpires: inv.expires_at || "",
        draft: prof
      };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function load(c, info) {
    var day = attDay || todayIso();
    return Promise.resolve(db.rpc("refresh_attendance", { p_company: c.id, p_day: day })).then(function () { return {}; }, function () { return {}; }).then(function () {
    return Promise.all([
      db.from("company_members").select("user_id, role, role_label, active, job_title_id, department_id, manager_id, employment_type, employee_no, start_date, duty_status, assigned_vessel, staff_category, employment_status, probation_end, contract_end, end_date, hr_meta, photo_path, created_at").eq("company_id", c.id).order("created_at"),
      db.from("job_titles").select("id, title, crew_group, department_id, active").eq("company_id", c.id),
      db.from("staff_certifications").select("id, user_id, name, valid_until, issuer, cert_no").eq("company_id", c.id).order("valid_until", { ascending: true, nullsFirst: false }),
      db.from("leave_requests").select("id, user_id, leave_type, start_date, end_date, note, status, decision_note, created_at, certificate, certificate_path, certificate_name").eq("company_id", c.id).order("created_at", { ascending: false }).limit(1000),
      db.from("departments").select("id, name, head_user_id, active").eq("company_id", c.id),
      db.from("roster_entries").select("user_id, shift").eq("company_id", c.id).eq("day", todayIso()),
      db.from("attendance_records").select("*").eq("company_id", c.id).eq("day", day),
      db.from("attendance_corrections").select("*").eq("company_id", c.id).eq("status_now", "Pending").order("created_at", { ascending: false }).limit(100),
      db.from("member_private").select("user_id, phone, emergency_contact, status_reason").eq("company_id", c.id),
      info.canHr
        ? db.from("company_invites").select("id, email, role, role_label, token, meta, expires_at, accepted_at, created_at").eq("company_id", c.id).is("accepted_at", null).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      db.from("companies").select("settings").eq("id", c.id).single(),
      db.from("member_pay").select("user_id, bank_name, account_name, account_number, basic, allowances, pension, pay_method").eq("company_id", c.id),
      Promise.resolve(db.from("attendance_breaks").select("user_id, break_in, break_out").eq("company_id", c.id).eq("day", day)).then(function (x) { return x; }, function () { return { data: [] }; }),
      Promise.resolve(db.rpc("my_break_state", { p_company: c.id })).then(function (x) { return x; }, function () { return { data: null }; })
    ]).then(function (r) {
      for (var i = 0; i < 9; i++) if (r[i].error) throw new Error(r[i].error.message);
      /* Invites may fail before 0052 (admin-only select); settings pending list still works. */
      var inviteRows = (r[9] && !r[9].error && r[9].data) || [];
      var payBy = {};
      ((r[11] && !r[11].error && r[11].data) || []).forEach(function (x) { payBy[x.user_id] = x; });
      if (r[10] && !r[10].error && r[10].data) {
        company.settings = r[10].data.settings || company.settings || {};
      }
      var ids = r[0].data.map(function (m) { return m.user_id; });
      return db.from("profiles").select("id, full_name, email").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).then(function (p) {
        var by = {}; (p.data || []).forEach(function (x) { by[x.id] = x; });
        var titles = {}; r[1].data.forEach(function (t) { titles[t.id] = t; });
        var titleList = r[1].data.slice().sort(function (a, b) { return a.title.localeCompare(b.title); });
        var deptList = r[4].data.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
        var depts = {}; deptList.forEach(function (x) { depts[x.id] = x.name; });
        var priv = {}; (r[8].data || []).forEach(function (x) { priv[x.user_id] = x; });
        var today = todayIso();
        var eff = effectiveCerts(r[2].data);
        var certsBy = {}; r[2].data.forEach(function (x) { (certsBy[x.user_id] = certsBy[x.user_id] || []).push(x); });
        var effBy = {}; eff.forEach(function (x) { (effBy[x.user_id] = effBy[x.user_id] || []).push(x); });
        var nameOf = function (uid) { var pr = by[uid] || {}; return pr.full_name || (pr.email || "").split("@")[0] || "Unknown"; };
        var onLeaveToday = {};
        r[3].data.forEach(function (l) { if (l.status === "Approved" && l.start_date <= today && l.end_date >= today) onLeaveToday[l.user_id] = true; });
        var quals = qualTypes();
        // Duty status is detected from today's Duty Roster; people not on today's roster keep the status set by hand.
        var shiftToday = {}; r[5].data.forEach(function (e) { shiftToday[e.user_id] = e.shift; });
        var dutyOf = function (m) {
          var code = shiftToday[m.user_id];
          if (m.employment_status === "Former") return "Left";
          if (m.employment_status === "Suspended") return "Suspended";
          if (onLeaveToday[m.user_id] || code === "L") return "On leave";
          if (code === "TRN") return "Training";
          if (code === "OFF") return "Off duty";
          return code ? "On duty" : m.duty_status;
        };
        var staff = r[0].data.filter(function (m) { return info.canHr || m.employment_status !== "Former"; }).map(function (m) {
          var t = titles[m.job_title_id], position = t ? t.title : (m.role_label || cap(m.role)), group = groupOf(t && t.crew_group, position);
          var certs = certsBy[m.user_id] || [], mine = effBy[m.user_id] || [], first = mine.slice().sort(function (a, b) { return (a.valid_until || "9999").localeCompare(b.valid_until || "9999"); })[0];
          var held = mine.filter(function (x) { return !x.valid_until || x.valid_until >= today; }).map(function (x) { return x.name.toLowerCase(); });
          var missing = info.canHr || m.user_id === info.me ? quals.filter(function (q) { return (q.required === "All crew" && group !== "Shore") || q.required === group; })
            .filter(function (q) { return held.indexOf(String(q.name).toLowerCase()) < 0; }).map(function (q) { return q.name; }) : [];
          var pv = priv[m.user_id] || {}, status = m.employment_status || "Active", pay = payBy[m.user_id] || {};
          var profRow = by[m.user_id] || {};
          var deptId = (t && t.department_id) || m.department_id || "";
          return {
            uid: m.user_id, titleId: m.job_title_id || "", rawGroup: t ? t.crew_group : null, deptId: deptId, managerId: m.manager_id, name: nameOf(m.user_id), email: profRow.email || "", named: !!(profRow.full_name && String(profRow.full_name).trim()), hrMeta: m.hr_meta || {}, position: position, group: group,
            dept: depts[deptId] || "", employment: m.employment_type || "", empNo: m.employee_no || "", photoPath: m.photo_path || "", start: m.start_date || "", category: m.staff_category || "", role: m.role,
            status: status, shownStatus: status === "Active" && onLeaveToday[m.user_id] ? "On leave" : status === "Former" ? "Former employee" : status,
            active: m.active && status !== "Former", probationEnd: m.probation_end || "", contractEnd: m.contract_end || "", endDate: m.end_date || "",
            phone: pv.phone || "", emergency: pv.emergency_contact || "", reason: pv.status_reason || "",
            bankName: pay.bank_name || "", accountName: pay.account_name || "", accountNumber: pay.account_number || "",
            basic: pay.basic != null ? Number(pay.basic) : 0, pension: pay.pension !== false, payMethod: pay.pay_method || "Bank transfer", hasPay: !!pay.user_id,
            allowances: Array.isArray(pay.allowances) ? pay.allowances : [],
            vessel: m.assigned_vessel || "", duty: dutyOf(m), shiftToday: shiftToday[m.user_id] || "", manualDuty: m.duty_status, certs: certs, effCerts: mine, missing: missing,
            cert: first ? first.name + (mine.length > 1 ? " +" + (mine.length - 1) : "") : "", valid: first && first.valid_until ? first.valid_until : "", expired: !!(first && first.valid_until && first.valid_until < today)
          };
        });
        var memberEmails = {};
        staff.forEach(function (s) { if (s.email) memberEmails[String(s.email).toLowerCase()] = true; });
        var pendingSettings = (company.settings && company.settings["8_pending_employee_invites"]) || [];
        if (!Array.isArray(pendingSettings)) pendingSettings = [];
        if (info.canHr) {
          staff = staff.concat(pendingInviteRows(inviteRows, pendingSettings, titles, depts, memberEmails));
        }
        var leave = r[3].data.map(function (l) {
          return { id: l.id, uid: l.user_id, name: nameOf(l.user_id), type: l.leave_type, start: l.start_date, end: l.end_date, note: l.note, decision: l.decision_note, status: l.status, created: l.created_at, cert: l.certificate, certPath: l.certificate_path, certName: l.certificate_name, sub: fmtRange(l.start_date, l.end_date) + " · " + l.leave_type };
        });
        var attBy = {}; (r[6].data || []).forEach(function (a) { attBy[a.user_id] = a; });
        var brkBy = {}; ((r[12] && !r[12].error && r[12].data) || []).forEach(function (b) {
          var x = brkBy[b.user_id] || (brkBy[b.user_id] = { minutes: 0, open: false });
          x.minutes += ((b.break_out ? new Date(b.break_out) : new Date()) - new Date(b.break_in)) / 6e4; if (!b.break_out) x.open = true;
        });
        return {
          brkBy: brkBy, myBreak: (r[13] && !r[13].error && r[13].data) || null, myBreakErr: (r[13] && r[13].error && r[13].error.message) || "",
          staff: staff, leave: leave,
          titles: titleList.filter(function (t) { return t.active !== false; }),
          depts: deptList.filter(function (d) { return d.active !== false; }),
          orgTitles: titleList, orgDepts: deptList,
          certs: r[2].data, effCerts: eff, attDay: day, attBy: attBy, corrections: r[7].data || [], nameOf: nameOf
        };
      });
      });
    });
  }
  function activeStaff() { return model.staff.filter(function (s) { return s.active; }); }
  function person(uid) { return model.staff.filter(function (s) { return s.uid === uid; })[0]; }

  function sampleStaff() {
    return window.VEYORA_HR_SAMPLE.staff.map(function (x) {
      return { name: x.name, position: x.position, group: groupOf(null, x.position), vessel: x.vessel, duty: x.duty, cert: x.cert, valid: x.valid, certs: [], effCerts: [], missing: [], dept: "", employment: "", empNo: "", start: "", category: "", status: "Active", shownStatus: x.duty === "On leave" ? "On leave" : "Active", active: true };
    });
  }

  /* ---------- approvers (mirrors leave_approver_ids() in the database) ---------- */
  function approverCfg() { var a = setting("8_approvers_and_responsibilities"); return a && a.leave ? a : null; }
  function approversFor(l) {
    var a = approverCfg(); if (!a) return null;
    var cfg = a.leave, who = person(l.uid);
    if (!who) return [];
    var out = [], matched = false;
    if (cfg.useManager && who.managerId) out.push(who.managerId);
    (cfg.routes || []).some(function (r) {
      var hit = r.applies === "All staff" || (who.deptId && r.applies === "Dept:" + who.deptId);
      if (hit) { out = out.concat(r.approvers || []); matched = true; }
      return hit;
    });
    if (!matched) out = out.concat(cfg.fallback || []);
    var act = {}; activeStaff().forEach(function (x) { act[x.uid] = true; });
    return out.filter(function (u, i) { return u !== l.uid && act[u] && out.indexOf(u) === i; });
  }
  function nameOfUid(u) { var p = person(u); return p ? p.name : "someone"; }
  function canDecide(l) {
    if (!l.id || l.status !== "Pending" || sampleOn) return false;
    if (l.uid === ctx.me && workflow().self !== true) return false;
    if (ctx.isPlatform || ctx.myRole === "owner") return true;
    var named = approversFor(l);
    if (named && named.length) return named.indexOf(ctx.me) > -1;
    return ctx.canHr;
  }
  function routedTo(l) { var n = approversFor(l); return n && n.length ? n.map(nameOfUid).join(", ") : (l.status === "Pending" ? (workflow().approver || "HR") : ""); }

  // Days already used (approved + pending) of a leave type this calendar year, in working days.
  function usedDays(uid, type, exceptId) {
    var y = String(new Date().getFullYear());
    return model.leave.filter(function (l) { return l.uid === uid && l.type === type && l.id !== exceptId && (l.status === "Approved" || l.status === "Pending") && l.start && l.start.slice(0, 4) === y; })
      .reduce(function (n, l) { return n + workingDays(l.start, l.end); }, 0);
  }

  function usedNoCert(uid, type) {
    var y = String(new Date().getFullYear());
    return model.leave.filter(function (l) { return l.uid === uid && l.type === type && l.cert === false && (l.status === "Approved" || l.status === "Pending") && l.start && l.start.slice(0, 4) === y; })
      .reduce(function (n, l) { return n + workingDays(l.start, l.end); }, 0);
  }

  // Claude 2026-10-29: one card per leave type (Leave page and the request form). Shows what is left, paid or unpaid and the certificate rules.
  var LT_COLORS = ["#5e5ce6", "#1fc8c0", "#ff375f", "#ff9f0a", "#bf5af2", "#33c773", "#0a84ff", "#34c759"];
  function leaveTypeCard(t, i, uid, kind, selected) {
    var lim = Number(t.days) || 0, used = usedDays(uid, t.name), left = lim ? Math.max(lim - used, 0) : null, pct = lim ? Math.min(100, Math.round(used / lim * 100)) : 0;
    var chips = [t.paid === false ? '<span class="lt-chip lt-unpaid">Unpaid</span>' : '<span class="lt-chip lt-paid">Paid</span>'];
    if (t.cert === "Required") chips.push('<span class="lt-chip lt-cert">Certificate required</span>');
    else if (t.cert === "Optional") {
      var nc = Number(t.nocert) || 0, run = Number(t.nocertRun) || 0;
      chips.push('<span class="lt-chip lt-cert">Certificate optional' + (nc ? " · " + Math.max(nc - usedNoCert(uid, t.name), 0) + " of " + nc + " days without" : "") + (run ? " · " + run + " in a row" : "") + '</span>');
    }
    if (t.note) chips.push('<span class="lt-chip lt-note">Note required</span>');
    var ring = '<span class="lt-ring" style="--p:' + pct + '">' + (lim ? '<b>' + left + '</b><small>left</small>' : '<b>∞</b>') + '</span>';
    var sub = lim ? used + " of " + lim + " working days used this year" : (used ? used + " working days used this year" : "No yearly limit");
    var body = '<span class="lt-main"><strong>' + esc(t.name) + '</strong><span class="lt-sub">' + sub + '</span><span class="lt-chips">' + chips.join("") + '</span></span>';
    var color = LT_COLORS[i % LT_COLORS.length];
    if (kind === "pick") return '<button type="button" class="lt-card' + (selected ? " on" : "") + '" role="radio" aria-checked="' + (selected ? "true" : "false") + '" data-lt="' + esc(t.name) + '" style="--lc:' + color + '">' + ring + body + '<span class="lt-tick" aria-hidden="true">✓</span></button>';
    return '<div class="lt-card static" style="--lc:' + color + '">' + ring + body + (lim && left === 0 ? '<button type="button" class="btn-soft" disabled>No days left</button>' : '<button type="button" class="btn-soft" data-lt-req="' + esc(t.name) + '">Request</button>') + '</div>';
  }
  function leaveTypeCards() {
    var types = leaveTypes();
    return '<section class="dash-card"><div class="card-head"><div><h2>Your leave types</h2><p class="note">One card for each leave type with what is left this year. Choose Request on a card to ask for it.</p></div></div>' +
      '<div class="lt-list">' + types.map(function (t, i) { return leaveTypeCard(t, i, ctx.me, "page"); }).join("") + '</div></section>';
  }

  /* ---------- small renderers ---------- */
  function kpi(tone, ic, label, value, sub, href) {
    return '<' + (href ? 'a href="' + href + '" class="kpi kpi-link"' : 'div class="kpi"') + '><span class="tile tone-' + tone + '">' + icon(ic) + '</span><span class="kbody"><small>' + label + '</small><strong>' + value + '</strong><span class="kpi-row"><span class="kpi-sub">' + sub + '</span></span></span></' + (href ? "a" : "div") + '>';
  }
  function chip(text, cls) { return '<span class="chip ' + (cls || "st-" + slug(text)) + '">' + esc(text) + '</span>'; }
  function who(s, link) {
    var inner = '<span class="avatar-s">' + esc(initials(s.name)) + '</span>' + esc(s.name);
    return link && s.uid && (ctx.canHr || s.uid === ctx.me) ? '<a class="who who-link" href="#employee/' + s.uid + '">' + inner + '</a>' : '<span class="who">' + inner + '</span>';
  }
  function sel(id, label, all, list, cur) { return '<select id="' + id + '" aria-label="' + label + '"><option value="">' + all + '</option>' + list.map(function (p) { var v = Array.isArray(p) ? p[0] : p, t = Array.isArray(p) ? p[1] : p; return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + '>' + esc(t) + '</option>'; }).join("") + '</select>'; }
  function subTabs(items, cur, base) {
    return '<div class="tabs" role="tablist">' + items.map(function (t) { return '<a role="tab" href="' + base + t[0] + '" aria-selected="' + (cur === t[0]) + '">' + t[1] + '</a>'; }).join("") + '</div>';
  }
  function empty(text) { return '<div class="empty-hr">' + text + '</div>'; }
  function hrOnly(what) { return '<section class="dash-card">' + empty(what + " is for HR, owners and admins. Ask HR if you need something changed.") + '</section>'; }

  /* ---------- HR Overview ---------- */
  function overview() {
    var act = activeStaff(), t = todayIso(), a = alerts();
    var working = act.filter(function (s) { return isWorking(s.shiftToday); });
    var present = working.filter(function (s) { var x = model.attBy[s.uid]; return x && (x.status === "Present" || x.status === "Late"); }).length;
    var defs = shiftDefs().filter(function (d) { return Number(d.needed) > 0; }), need = 0, covered = 0, gaps = [];
    defs.forEach(function (d) {
      var code = String(d.code || d.name.charAt(0)).toUpperCase(), have = act.filter(function (s) { return s.shiftToday === code; }).length, n = Number(d.needed);
      need += n; covered += Math.min(have, n);
      if (have < n) gaps.push(d.name + ": " + have + " of " + n);
    });
    var effActive = model.effCerts.filter(function (c) { var s = person(c.user_id); return s && s.active; });
    var due = effActive.filter(function (c) { return c.valid_until && c.valid_until <= addDaysIso(a.first); });
    var expired = due.filter(function (c) { return c.valid_until < t; });
    var missing = act.filter(function (s) { return s.missing.length; });
    var pend = model.leave.filter(function (l) { return l.status === "Pending"; }), mine = pend.filter(canDecide);
    var exc = act.filter(function (s) { var x = model.attBy[s.uid]; return x && (x.status === "Absent" || x.status === "Late" || x.status === "Missed punch"); });
    var corr = model.corrections.length;
    var contracts = act.filter(function (s) { return s.contractEnd && s.contractEnd >= t && s.contractEnd <= addDaysIso(30); });
    var probation = act.filter(function (s) { return s.probationEnd && s.probationEnd >= t && s.probationEnd <= addDaysIso(14); });
    var suspended = act.filter(function (s) { return s.status === "Suspended"; });
    var onLeave = act.filter(function (s) { return s.shownStatus === "On leave"; });

    var items = [];
    function add(tone, title, sub, href) { items.push('<li><a href="' + href + '"><span class="attn-dot ' + tone + '"></span><span class="grow"><strong>' + title + '</strong><small>' + sub + '</small></span>' + icon('<path d="m9 6 6 6-6 6"/>') + '</a></li>'); }
    if (gaps.length) add("red", gaps.length + " shift" + (gaps.length > 1 ? "s" : "") + " short of crew today", esc(gaps.join(" · ")), "roster.html");
    if (expired.length) add("red", expired.length + " expired certificate" + (expired.length > 1 ? "s" : ""), "These people cannot be rostered or assigned to a vessel", "#crew/certificates");
    if (missing.length) add("red", missing.length + " " + (missing.length > 1 ? "people are" : "person is") + " missing required qualifications", esc(missing.slice(0, 3).map(function (s) { return s.name; }).join(", ")) + (missing.length > 3 ? "…" : ""), "#crew/certificates");
    if (mine.length || pend.length) add("amber", pend.length + " leave request" + (pend.length > 1 ? "s" : "") + " waiting", mine.length ? mine.length + " waiting for you" : "Waiting for " + esc(pend.map(routedTo).filter(Boolean)[0] || "HR"), "#leave/requests");
    if (exc.length || corr) add("amber", (exc.length + corr) + " attendance record" + (exc.length + corr > 1 ? "s" : "") + " to check", exc.length + " late, absent or missed punch today" + (corr ? " · " + corr + " correction" + (corr > 1 ? "s" : "") + " waiting" : ""), "#attendance");
    var soon = due.length - expired.length;
    if (soon > 0) add("amber", soon + " certificate" + (soon > 1 ? "s" : "") + " expiring within " + a.first + " days", "Renew before they lapse", "#crew/certificates");
    if (contracts.length) add("blue", contracts.length + " contract" + (contracts.length > 1 ? "s" : "") + " ending within 30 days", esc(contracts.map(function (s) { return s.name + " (" + fmtDate(s.contractEnd) + ")"; }).join(", ")), "#employee/" + contracts[0].uid + "/employment");
    if (probation.length) add("blue", probation.length + " probation period" + (probation.length > 1 ? "s" : "") + " ending within 14 days", esc(probation.map(function (s) { return s.name; }).join(", ")), "#employee/" + probation[0].uid + "/employment");
    if (suspended.length) add("grey", suspended.length + " suspended", esc(suspended.map(function (s) { return s.name; }).join(", ")), "#employees");

    var qa = [["Add employee", I.plus, "addEmp", ctx.isAdmin], ["Create duty roster", I.cal, "roster.html", true], ["Record attendance", I.clock, "#attendance", true],
      ["Assign crew to vessel", I.ship, "#crew/vessels", true], ["Approve leave", I.check, "#leave/requests", true], ["Review expiring certificates", I.shield, "#crew/certificates", true]].filter(function (x) { return x[3]; });

    var pendShown = pend.slice(0, 5);
    return '<div class="kpis">' +
      kpi("blue", I.people, "Total employees", act.length, onLeave.length + " on leave · " + suspended.length + " suspended", "#employees") +
      kpi("teal", I.clock, "Attendance today", present + "/" + working.length, working.length ? "Present of those rostered today" : "Nobody is rostered today", "#attendance") +
      kpi("purple", I.ship, "Crew coverage", need ? covered + "/" + need : "–", need ? (gaps.length ? gaps.length + " shift" + (gaps.length > 1 ? "s" : "") + " short today" : "All shifts covered today") : "Set Crew needed in Shift Definitions", "roster.html") +
      kpi("orange", I.shield, "Certificates expiring", due.length, expired.length ? expired.length + " already expired" : "Within " + a.first + " days", "#crew/certificates") + '</div>' +
      '<div class="hr-grid"><div class="col">' +
      '<section class="dash-card"><div class="card-head"><div><h2>Needs attention</h2><p class="note">Click an item to deal with it</p></div></div>' +
      (items.length ? '<ul class="attn">' + items.join("") + '</ul>' : empty("Nothing needs attention right now.")) + '</section>' +
      '<section class="dash-card"><h2>Quick actions</h2><div class="qa">' + qa.map(function (x) {
        return x[2] === "addEmp" ? '<button type="button" class="qa-btn" id="qaAdd">' + icon(x[1]) + '<span>' + x[0] + '</span></button>' : '<a class="qa-btn" href="' + x[2] + '">' + icon(x[1]) + '<span>' + x[0] + '</span></a>';
      }).join("") + '</div></section></div>' +
      '<div class="col"><section class="dash-card"><div class="card-head"><h2>Leave approvals</h2><a class="btn-soft" href="#leave/requests">Open</a></div><ul class="leave-list" style="margin-top:12px">' +
      (pendShown.length ? pendShown.map(function (l) {
        return '<li><span class="ic">' + icon(I.cal) + '</span><span class="grow"><strong>' + esc(l.name) + '</strong><small>' + esc(l.sub) + ' · ' + workingDays(l.start, l.end) + ' working days' + (routedTo(l) ? ' · to ' + esc(routedTo(l)) : "") + '</small></span>' +
          (canDecide(l) ? '<button type="button" class="chip-btn" data-review="' + l.id + '">Review</button>' : chip("Pending")) + '</li>';
      }).join("") : '<li><span class="grow"><small>No leave requests waiting.</small></span></li>') + '</ul></section>' +
      '<section class="dash-card"><h2>Today</h2><div class="cov">' +
      '<div>' + icon(I.ship) + '<strong>' + pad2(act.filter(function (s) { return s.duty === "On duty" && s.group === "Captain"; }).length) + '</strong><small>Captains on duty</small></div>' +
      '<div>' + icon(I.people) + '<strong>' + pad2(act.filter(function (s) { return s.duty === "On duty"; }).length) + '</strong><small>Crew on duty</small></div>' +
      '<div>' + icon(I.cal) + '<strong>' + pad2(onLeave.length) + '</strong><small>On leave</small></div>' +
      '<div>' + icon(I.shield) + '<strong>' + (effActive.length ? Math.round(effActive.filter(function (c) { return !c.valid_until || c.valid_until >= t; }).length * 100 / effActive.length) + "%" : "–") + '</strong><small>Certificates valid</small></div></div></section>' +
      responsibilitiesCard() + '</div></div>';
  }

  function responsibilitiesCard() {
    var a = setting("8_approvers_and_responsibilities") || {}, duties = a.duties || {};
    var rows = (window.VEYORA_DUTIES || []).filter(function (du) { var dt = duties[du.k]; return dt && ((dt.people && dt.people.length) || dt.backup); });
    var leaveTo = a.leave && ((a.leave.routes || []).length || (a.leave.fallback || []).length || a.leave.useManager);
    return '<section class="dash-card"><h2>Responsibilities</h2><p class="note" style="margin-bottom:8px">Who handles what in ' + esc(company.name) + '</p><ul class="leave-list">' +
      (leaveTo ? '<li><span class="grow"><strong>Leave approval</strong><small>' + esc(((a.leave.routes || []).length ? a.leave.routes.length + " routing rule" + (a.leave.routes.length > 1 ? "s" : "") : "") + ((a.leave.fallback || []).length ? ((a.leave.routes || []).length ? " · fallback " : "") + a.leave.fallback.map(nameOfUid).join(", ") : "") + (a.leave.useManager ? " · plus reporting manager" : "")) + '</small></span></li>' : "") +
      rows.map(function (du) {
        var dt = duties[du.k];
        return '<li><span class="grow"><strong>' + esc(du.l) + '</strong><small>' + esc((dt.people || []).map(nameOfUid).join(", ") || "—") + (dt.backup ? " · backup " + esc(nameOfUid(dt.backup)) : "") + '</small></span></li>';
      }).join("") +
      (!rows.length && !leaveTo ? '<li><span class="grow"><small>Nobody is named yet.' + (ctx.canHr ? ' Name them under <a href="#employees/settings/approvers">Employees → Settings → Approvers</a>.' : "") + '</small></span></li>' : "") + '</ul></section>';
  }

  /* ---------- Employees (directory) ---------- */
  function sorted(rows, how) {
    var rank = { "On duty": 0, "Training": 1, "On leave": 2, "Off duty": 3, "Suspended": 4, "Left": 5 };
    return rows.slice().sort(function (a, b) {
      if (how === "Position") return a.position.localeCompare(b.position) || a.name.localeCompare(b.name);
      if (how === "Duty status") return ((rank[a.duty] || 9) - (rank[b.duty] || 9)) || a.name.localeCompare(b.name);
      if (how === "Certificate expiry") return (a.valid || "9999").localeCompare(b.valid || "9999") || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }
  function employees() {
    var o = dirOpts(), list = sampleOn ? sampleStaff() : model.staff;
    var tabs = employeeTabs();
    if (!tab || !tabs.some(function (t) { return t[0] === tab; })) tab = "all";
    function uniq(f) { var a = []; list.forEach(function (s) { var v = f(s); if (v && a.indexOf(v) < 0) a.push(v); }); return a.sort(); }
    function match(s, skipDuty) {
      if (fEmpStatus ? s.shownStatus !== fEmpStatus : s.status === "Former") return false;
      if (tab.indexOf("dept:") === 0 && (s.deptId || "") !== tab.slice(5)) return false;
      if (!skipDuty && fStatus && s.duty !== fStatus) return false;
      return (!fRole || s.position === fRole) &&
        (!fDept || s.dept === fDept) && (!fEmp || s.employment === fEmp) && (!fCat || s.category === fCat) &&
        (!fText || (s.name + " " + s.position + " " + s.vessel + " " + s.cert + " " + s.empNo + " " + s.dept).toLowerCase().indexOf(fText) > -1);
    }
    var rows = sorted(list.filter(function (s) { return match(s, false); }), o.sort);
    var pulsePool = list.filter(function (s) { return match(s, true); });
    var cols = [["cEmpNo", "Employee ID", function (s) { return esc(s.empNo) || "—"; }], ["cDept", "Department", function (s) { return esc(s.dept) || "—"; }],
      ["cEmployment", "Employment", function (s) { return esc(s.employment) || "—"; }], ["cStart", "Start date", function (s) { return s.start ? fmtDate(s.start) : "—"; }]].filter(function (c) { return o[c[0]]; });
    var table = !rows.length ? empty(list.length ? "No staff match your filters." : "No staff yet.") :
      '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Staff</th><th>Position</th>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join("") +
      (o.cVessel ? '<th>Vessel</th>' : "") + '<th>Status</th><th>Today</th>' + (o.cCert ? '<th>Certification</th>' : "") + (o.cValid ? '<th>Valid until</th>' : "") + '<th></th></tr></thead><tbody>' +
      rows.map(function (s) {
        return '<tr><td>' + who(s, true) + '</td><td class="muted-cell">' + esc(s.position) + '</td>' + cols.map(function (c) { return '<td class="muted-cell">' + c[2](s) + '</td>'; }).join("") +
          (o.cVessel ? '<td class="muted-cell">' + (esc(s.vessel) || "—") + '</td>' : "") + '<td>' + chip(s.shownStatus) + '</td><td>' + chip(s.duty) + '</td>' +
          (o.cCert ? '<td class="muted-cell">' + (esc(s.cert) || "—") + (s.missing.length ? '<span class="exp" title="Required for this designation"> · missing ' + esc(s.missing.join(", ")) + '</span>' : "") + '</td>' : "") +
          (o.cValid ? '<td class="' + (s.expired ? "exp" : "muted-cell") + '">' + (s.valid ? fmtDate(s.valid) : "—") + (s.expired ? " (expired)" : "") + '</td>' : "") +
          '<td>' + (s.uid && (ctx.canHr || s.uid === ctx.me) ? '<a class="ghost manage-btn" href="#employee/' + s.uid + '">Open</a>' : "") + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    function tone(name) {
      var n = 0, t = String(name || "");
      for (var i = 0; i < t.length; i++) n = (n + t.charCodeAt(i)) % 6;
      return n;
    }
    function metaBit(label, value) {
      return '<span><small>' + label + '</small><b>' + (value ? esc(value) : "—") + '</b></span>';
    }
    var cards = !rows.length ? empty(list.length ? "No staff match your filters." : "No staff yet.") :
      '<div class="ec-grid"><div class="ec-cols" aria-hidden="true"><span>Employee</span><span>Today</span><span>Department</span><span>Category</span><span>Employment</span><span>Vessel</span><span></span></div>' + rows.map(function (s, i) {
        var open = s.uid && (ctx.canHr || s.uid === ctx.me);
        var tag = open ? "a" : "div";
        return '<' + tag + ' class="ec' + (open ? "" : " ec-static") + '" data-duty="' + esc(slug(s.duty || "none")) + '"' +
          (open ? ' href="#employee/' + s.uid + '"' : "") + ' style="animation-delay:' + Math.min(i, 12) * 35 + 'ms">' +
          '<span class="ec-top"><span class="ec-av ec-tone-' + tone(s.name) + '" aria-hidden="true">' + esc(initials(s.name)) + '</span>' +
          '<span class="ec-id"><span class="ec-no">' + (s.empNo ? esc(s.empNo) : "No ID") + '</span><strong>' + esc(s.name) + '</strong>' +
          '<em>' + esc(s.position || "No designation") + '</em>' +
          (s.missing.length ? '<span class="ec-warn">Missing ' + esc(s.missing.join(", ")) + '</span>' : "") +
          '</span></span>' +
          '<span class="ec-chips">' + chip(s.shownStatus) + chip(s.duty) + (s.vessel ? chip(s.vessel, "st-off-duty") : "") + '</span>' +
          '<span class="ec-meta">' + metaBit("Department", s.dept) + metaBit("Category", s.category) + metaBit("Employment", s.employment) + metaBit(s.shiftToday ? "Roster" : "Vessel", s.shiftToday || s.vessel) + '</span>' +
          (open ? '<span class="ec-open">Open profile</span>' : '<span class="ec-open"></span>') +
          '</' + tag + '>';
      }).join("") + '</div>';
    var cats = staffCats().concat(uniq(function (s) { return s.category; })).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var pendingN = list.filter(function (s) { return s.pendingInvite; }).length;
    var pulses = [["", "Everyone"], ["On duty", "On duty"], ["Off duty", "Off duty"], ["On leave", "On leave"], ["Training", "Training"]];
    var everyoneOn = fStatus === "" && fEmpStatus !== "Invite sent";
    var pulseHtml = '<div class="ec-pulse" role="group" aria-label="Duty today">' + pulses.map(function (p) {
      var n = pulsePool.filter(function (s) { return !p[0] || s.duty === p[0]; }).length;
      return '<button type="button" data-pulse="' + esc(p[0]) + '" aria-pressed="' + (p[0] ? fStatus === p[0] : everyoneOn) + '"><b>' + n + '</b><span>' + p[1] + '</span></button>';
    }).join("") + (pendingN ? '<button type="button" data-pulse="invite" aria-pressed="' + (fEmpStatus === "Invite sent") + '"><b>' + pendingN + '</b><span>Invites</span></button>' : "") + '</div>';
    var activeN = list.filter(function (s) { return s.active; }).length;
    return '<section class="ec-board"><div class="ec-head"><div><h2>Employees</h2><p>' + activeN + ' active' +
      (pendingN ? ' · ' + pendingN + ' invite' + (pendingN === 1 ? '' : 's') + ' waiting' : '') +
      ' · ' + rows.length + ' shown</p></div>' +
      '<div style="display:flex;align-items:center;gap:8px"><div class="ec-view" role="group" aria-label="Layout"><button type="button" data-eview="cards" aria-pressed="' + (empView !== "list") + '">Cards</button><button type="button" data-eview="list" aria-pressed="' + (empView === "list") + '">List</button></div>' +
      (ctx.canHr ? '<a class="btn-soft" href="#employees/settings">Settings</a>' : "") + '</div></div>' +
      '<div class="ec-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join("") + '</div>' +
      '<div class="filters wrap"><label class="fsearch">' + icon(I.search) + '<input id="hSearch" type="search" placeholder="Search name, position, vessel or ID" value="' + esc(fText) + '" aria-label="Search staff"></label>' +
      sel("hEmpStatus", "Employee status", "Active and on leave", ["Active", "On leave", "Suspended", "Invite sent", "Invite expired"].concat(ctx.canHr ? ["Former employee"] : []), fEmpStatus) +
      (o.fRole ? sel("hRole", "Designation", "All designations", uniq(function (s) { return s.position; }), fRole) : "") +
      (o.fStatus ? sel("hStatus", "Today", "Any duty today", ["On duty", "Training", "Off duty", "On leave"], fStatus) : "") +
      (o.fDept ? sel("hDept", "Department", "All departments", uniq(function (s) { return s.dept; }), fDept) : "") +
      (o.fEmployment ? sel("hEmp", "Employment type", "All employment types", uniq(function (s) { return s.employment; }), fEmp) : "") +
      (cats.length ? sel("hCat", "Staff category", "All categories", cats, fCat) : "") + '</div>' +
      pulseHtml + (empView === "list" ? table : cards) + '</section>';
  }

  /* ---------- Employee profile ---------- */
  var PTABS = [["overview", "Overview"], ["employment", "Employment"], ["documents", "Documents"], ["qualifications", "Qualifications"], ["duty", "Duty history"], ["leave", "Leave"], ["pay", "Pay"], ["activity", "Activity"]];
  function kv(rows) { return '<dl class="kv">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + (r[1] === "" || r[1] == null ? '<span class="muted-cell">—</span>' : r[1]) + '</dd></div>'; }).join("") + '</dl>'; }
  function pendingInviteProfile(s) {
    var url = s.inviteToken ? inviteUrl(s.inviteToken) : "";
    return '<div class="ep"><a class="ep-back" href="#employees">' + icon(I.back) + 'Employees</a>' +
      '<header class="ep-hero ep-hero-solo"><div class="ep-top"><div class="ep-who"><span class="ep-av" aria-hidden="true">' + esc(initials(s.name)) + '</span><div>' +
      '<p class="ep-idline">' + (s.empNo ? '<code>' + esc(s.empNo) + '</code>' : "") + '<span>Invite</span></p>' +
      '<h2>' + esc(s.name) + '</h2><p class="ep-role">' + esc(s.position || "No designation") + (s.dept ? " · " + esc(s.dept) : "") + '</p>' +
      '<div class="ep-chips">' + chip(s.shownStatus) + chip(s.duty) + '</div></div></div></div></header>' +
      '<section class="ep-card"><header><h3>Invite pending</h3><p>They stay on the directory until they set a password with this link.</p></header><dl class="ep-facts">' +
      epFact("Email", esc(s.email)) + epFact("Employee ID", esc(s.empNo)) + epFact("Designation", esc(s.position)) +
      epFact("Department", esc(s.dept)) + epFact("Staff category", esc(s.category)) + epFact("Employment", esc(s.employment)) +
      epFact("Start date", s.start ? esc(fmtDate(s.start)) : "") + epFact("Access", esc(cap(s.role))) + epFact("Phone", esc(s.phone)) +
      epFact("Invite sent", s.inviteCreated ? esc(when(s.inviteCreated)) : "") + epFact("Invite expires", s.inviteExpires ? esc(when(s.inviteExpires)) : "") +
      '</dl>' +
      (url
        ? '<div class="inv" style="margin:8px 0 16px"><input id="pInviteLink" readonly value="' + esc(url) + '" aria-label="Invite link"><button type="button" class="save" id="pCopyInvite">Copy invite link</button></div>'
        : '<p class="msg">Invite link is available after migration 0052 (HR invite read). Ask them to check their email, or recreate the invite.</p>') +
      '<p class="msg" id="mMsgInline" role="status"></p></section></div>';
  }

  function epFact(label, html) {
    return '<div class="ep-fact"><dt>' + label + '</dt><dd>' + (html === "" || html == null ? '<span class="muted-cell">—</span>' : html) + '</dd></div>';
  }
  function epTabs(cur, uid) {
    return '<nav class="ep-tabs" aria-label="Profile">' + PTABS.map(function (t) {
      return '<a href="#employee/' + uid + '/' + t[0] + '"' + (cur === t[0] ? ' aria-current="page"' : "") + '>' + esc(t[1]) + '</a>';
    }).join("") + '</nav>';
  }
  /* Staff photo (migration 0082): private bucket `staff-photos`, shown through a short-lived signed link. HR or the person can change it. */
  var photoUrls = {}, toastTimer = 0;
  function toast(text) {
    var el = $("hrToast");
    if (!el) { el = document.createElement("div"); el.id = "hrToast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = text; el.className = "show"; clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.className = ""; }, 3200);
  }
  function photoBlock(s, uid) {
    var can = ctx.canHr || uid === ctx.me;
    return '<span class="ep-avw"><span class="ep-av" id="pAv" aria-hidden="true">' + esc(initials(s.name)) + '</span>' +
      (can ? '<label class="ep-avbtn" title="' + (s.photoPath ? "Change photo" : "Add photo") + '"><input type="file" id="pPhoto" accept="image/jpeg,image/png,image/webp" hidden>' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></label>' : "") +
      (can && s.photoPath ? '<button type="button" class="ep-avdel" id="pPhotoDel" title="Remove photo" aria-label="Remove photo">&times;</button>' : "") + '</span>';
  }
  function showPhoto(s) {
    var av = $("pAv"); if (!av || !s.photoPath) return;
    function put(url) { if (!$("pAv") || $("pAv") !== av) return; av.innerHTML = '<img src="' + esc(url) + '" alt="">'; av.classList.add("has-photo"); }
    if (photoUrls[s.photoPath]) { put(photoUrls[s.photoPath]); return; }
    db.storage.from("staff-photos").createSignedUrl(s.photoPath, 3600).then(function (r) {
      if (r.data && r.data.signedUrl) { photoUrls[s.photoPath] = r.data.signedUrl; put(r.data.signedUrl); }
    });
  }
  /* Shrink to 512 px JPEG in the browser so every phone photo fits the 5 MB limit. */
  function shrinkPhoto(file) {
    return new Promise(function (ok, fail) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 512 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : fail(new Error("Could not read that picture.")); }, "image/jpeg", 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail(new Error("Could not read that picture.")); };
      img.src = url;
    });
  }
  function changePhoto(uid, file) {
    var s = model.staff.filter(function (x) { return x.uid === uid; })[0], old = s && s.photoPath, path;
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) { toast("Choose a JPG, PNG or WebP picture."); return; }
    shrinkPhoto(file).then(function (blob) {
      path = company.id + "/" + uid + "/" + Date.now() + ".jpg";
      return db.storage.from("staff-photos").upload(path, blob, { contentType: "image/jpeg" });
    }).then(function (up) {
      if (up.error) throw new Error(up.error.message);
      return db.rpc("set_staff_photo", { p_company: company.id, p_user: uid, p_path: path });
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      if (old) db.storage.from("staff-photos").remove([old]);
      toast("Photo saved."); return reload();
    }).catch(function (e) { toast(e.message || "Could not save the photo."); });
  }
  function removePhoto(uid) {
    var s = model.staff.filter(function (x) { return x.uid === uid; })[0];
    if (!s || !s.photoPath) return;
    db.rpc("set_staff_photo", { p_company: company.id, p_user: uid, p_path: null }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      db.storage.from("staff-photos").remove([s.photoPath]); toast("Photo removed."); return reload();
    }).catch(function (e) { toast(e.message || "Could not remove the photo."); });
  }
  function epStat(label, html, href) {
    var inner = '<small>' + label + '</small><strong>' + html + '</strong>';
    return href ? '<a class="ep-stat" href="' + href + '">' + inner + '</a>' : '<div class="ep-stat">' + inner + '</div>';
  }
  function profile(uid, ptab) {
    var s = person(uid);
    if (!s) return '<section class="dash-card">' + empty("That person isn't in this company. <a href=\"#employees\">Back to Employees</a>") + '</section>';
    if (!(ctx.canHr || uid === ctx.me)) return hrOnly("Other people's profiles are");
    if (s.pendingInvite) return pendingInviteProfile(s);
    ptab = PTABS.some(function (t) { return t[0] === ptab; }) ? ptab : "overview";
    var c = cache[uid] || {};
    var meta = s.hrMeta || {};
    var actions = ((ctx.canHr || uid === ctx.me) ? '<button type="button" class="ep-btn" id="pEdit">Edit employee</button>' : "") +
      (ctx.canHr && s.role !== "owner" && uid !== ctx.me ? '<button type="button" class="ep-btn ep-btn-ghost" id="pStatus">Change status</button>' : "") +
      (s.active && ctx.myRole ? '<button type="button" class="ep-btn ep-btn-soft" id="pLeave">Request leave</button>' : "");
    var head = '<div class="ep"><a class="ep-back" href="#employees">' + icon(I.back) + 'Employees</a>' +
      '<header class="ep-hero"><div class="ep-top"><div class="ep-who">' + photoBlock(s, uid) + '<div>' +
      '<p class="ep-idline">' + (s.empNo ? '<code>' + esc(s.empNo) + '</code>' : "") + '<span>' + esc(cap(s.role)) + '</span></p>' +
      '<h2>' + esc(s.name) + (meta.preferred_name ? '<em>' + esc(meta.preferred_name) + '</em>' : "") + '</h2>' +
      '<p class="ep-role">' + esc(s.position || "No designation") + (s.dept ? " · " + esc(s.dept) : "") + '</p>' +
      '<div class="ep-chips">' + chip(s.shownStatus) + chip(s.duty) + (s.vessel ? chip(s.vessel, "st-off-duty") : "") + (s.missing.length ? chip("Missing " + s.missing.join(", "), "st-rejected") : "") + '</div>' +
      '</div></div><div class="ep-actions">' + actions + '</div></div>' +
      '<div class="ep-stats">' +
        epStat("Today", chip(s.duty) + (s.shiftToday ? '<span class="ep-sub">Roster ' + esc(s.shiftToday) + '</span>' : ""), "#employee/" + uid + "/duty") +
        epStat("Department", esc(s.dept || "None"), "#employee/" + uid + "/employment") +
        epStat("Category", esc(s.category || "None"), "#employee/" + uid + "/employment") +
        epStat("Joined", s.start ? esc(fmtDate(s.start)) : "Not set", "#employee/" + uid + "/employment") +
      '</div>' + epTabs(ptab, uid) + '</header><div class="ep-stage">';
    var body = "";
    if (ptab === "overview") {
      var salary = s.bankName
        ? '<dl class="ep-facts">' + epFact("Bank", esc(s.bankName)) + epFact("Account name", esc(s.accountName)) + epFact("Account number", '<span class="ep-mono">' + esc(s.accountNumber) + '</span>') + '</dl>'
        : '<p class="ep-empty">No salary account yet.' + (ctx.canHr ? " Add one with Edit employee." : "") + '</p>';
      body = '<div class="ep-grid">' +
        '<section class="ep-card ep-wide"><header><h3>Work</h3><p>Role, reporting line, and where they are today.</p></header><dl class="ep-facts">' +
          epFact("Designation", esc(s.position)) + epFact("Department", esc(s.dept)) + epFact("Staff category", esc(s.category)) +
          epFact("Employment", esc(s.employment)) + epFact("Reports to", s.managerId ? esc(nameOfUid(s.managerId)) : "") +
          epFact("Access", esc(cap(s.role))) + epFact("Vessel", esc(s.vessel)) +
          epFact("Duty today", chip(s.duty) + (s.shiftToday ? ' <span class="muted-cell">roster ' + esc(s.shiftToday) + '</span>' : "")) +
        '</dl></section>' +
        '<section class="ep-card"><header><h3>Contact</h3><p>How to reach them.</p></header><dl class="ep-facts">' +
          epFact("Email", esc(s.email)) + epFact("Phone", esc(s.phone)) + epFact("Emergency", esc(s.emergency)) +
          epFact("Address", esc(meta.address || "")) +
        '</dl></section>' +
        '<section class="ep-card"><header><h3>Salary account</h3><p>Paid into this Maldives account.</p></header>' + salary + '</section>' +
        '<section class="ep-card ep-wide"><header><h3>Personal</h3><p>Details from the employee form.</p></header><dl class="ep-facts">' +
          epFact("Preferred name", esc(meta.preferred_name || "")) + epFact("Date of birth", meta.dob ? esc(fmtDate(meta.dob)) : "") +
          epFact("Gender", esc(meta.gender || "")) + epFact("Nationality", esc(meta.nationality || "")) +
          epFact("Blood group", esc(meta.blood_group || "")) + epFact("ID", esc([meta.id_kind, meta.id_number].filter(Boolean).join(" · "))) +
        '</dl></section>' +
      '</div>';
    } else if (ptab === "employment") {
      var hist = (c.events || []).filter(function (e) { return ["joined", "designation", "department", "employment", "status", "dates", "role", "manager"].indexOf(e.kind) > -1; });
      body = '<section class="ep-card"><header><h3>Employment</h3><p>Contract, status, and the history of changes.</p></header><dl class="ep-facts">' +
        epFact("Joining date", s.start ? esc(fmtDate(s.start)) : "") + epFact("Employment type", esc(s.employment)) +
        epFact("Probation ends", s.probationEnd ? esc(fmtDate(s.probationEnd)) + (s.probationEnd < todayIso() ? ' <span class="muted-cell">(completed)</span>' : "") : "") +
        epFact("Contract ends", s.contractEnd ? esc(fmtDate(s.contractEnd)) + (s.contractEnd < todayIso() ? ' <span class="exp">(ended)</span>' : "") : "") +
        epFact("Status", chip(s.shownStatus)) + epFact("Left on", s.endDate ? esc(fmtDate(s.endDate)) : "") +
        epFact("Status reason", ctx.canHr || uid === ctx.me ? esc(s.reason) : "") +
        '</dl><h3 class="ep-subhead">History</h3>' + (c.events ? eventList(hist) : '<p class="msg">Loading…</p>') + '</section>';
    } else if (ptab === "documents") {
      body = '<section class="ep-card ep-panel"><h2>Documents</h2>' + (c.docs ? docList(uid, c.docs) : '<p class="msg">Loading…</p>') + (ctx.canHr ? docForm() : "") +
        '<h3>Agreements</h3>' + (c.agreements ? (c.agreements.length ? '<ul class="rows">' + c.agreements.map(function (a) {
          return '<li class="row"><span class="grow"><strong>' + esc(a.title) + '</strong><small>' + esc(a.number || "") + ' · ' + esc(a.category) + '</small></span>' + chip(a.status, "chip ag-st-" + slug(a.status)) + '<a class="ghost" href="agreements.html">Open Agreements</a></li>';
        }).join("") + '</ul>' : '<p class="note">No agreements for ' + esc(s.name.split(" ")[0]) + ' yet.' + (ctx.canHr ? ' Make one on the <a href="agreements.html">Agreements</a> page.' : "") + '</p>') : '<p class="msg">Loading…</p>') + '<p class="msg" id="mMsgInline" role="status"></p></section>';
    } else if (ptab === "qualifications") {
      var mine = s.certs.slice().sort(function (a, b) { return (a.valid_until || "9999").localeCompare(b.valid_until || "9999"); });
      body = '<section class="ep-card ep-panel"><h2>Qualifications</h2>' +
        (s.missing.length ? '<p class="msg err">Required for ' + esc(s.group) + ' crew and missing or expired: ' + esc(s.missing.join(", ")) + '. ' + (crewRules().qualified !== false ? "They can't be rostered for working shifts or assigned a vessel until this is fixed." : "") + '</p>' : '<p class="msg ok">Has every qualification required for ' + esc(s.group) + ' crew.</p>') +
        (mine.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Qualification</th><th>Issued by</th><th>Number</th><th>Valid until</th><th>Status</th><th></th></tr></thead><tbody>' + mine.map(function (x) {
          var st = certStage(x.valid_until), latest = s.effCerts.indexOf(x) > -1;
          return '<tr><td><strong>' + esc(x.name) + '</strong></td><td class="muted-cell">' + (esc(x.issuer) || "—") + '</td><td class="muted-cell">' + (esc(x.cert_no) || "—") + '</td><td class="muted-cell">' + (x.valid_until ? fmtDate(x.valid_until) : "No expiry") + '</td>' +
            '<td>' + (latest ? chip(st.label, "st-cert-" + st.key) : chip("Replaced by renewal", "st-off-duty")) + '</td><td>' + (ctx.canHr ? (latest ? '<button type="button" class="ghost manage-btn" data-renew="' + esc(x.name) + '">Renew</button> ' : "") + '<button type="button" class="ghost danger manage-btn" data-delcert="' + x.id + '">Remove</button>' : "") + '</td></tr>';
        }).join("") + '</tbody></table></div>' : empty("No qualifications recorded yet.")) +
        (ctx.canHr ? '<h3>Add a qualification</h3><div class="inv"><input id="cName" list="qualList" placeholder="Qualification" maxlength="80" aria-label="Qualification"><datalist id="qualList">' + qualTypes().map(function (q) { return '<option value="' + esc(q.name) + '">'; }).join("") + '</datalist>' +
          '<input id="cIssuer" placeholder="Issued by (e.g. MTCC, Transport Authority)" maxlength="120" aria-label="Issued by"><input id="cNo" placeholder="Certificate number" maxlength="60" aria-label="Certificate number">' +
          '<label class="inline-date">Valid until <input id="cDate" type="date" aria-label="Valid until"></label><button type="button" class="save" id="cAdd">Add</button></div><p class="hint">Picking a qualification fills in the expiry from its validity in Settings. Renewing keeps the old record as history.</p>' : "") +
        '<p class="msg" id="mMsgInline" role="status"></p></section>';
    } else if (ptab === "duty") {
      var mayCorr = ctx.canHr || uid === ctx.me;
      body = '<section class="ep-card ep-panel"><h2>Duty history</h2><p class="note">Last 30 days of roster and attendance' + (mayCorr ? (ctx.canHr ? ". Correct a day if the times are wrong." : ". If a time is wrong, ask for a correction; HR checks it.") : "") + '</p>' + (c.duty ? dutyTable(c.duty, uid) : '<p class="msg">Loading…</p>') +
        '<h3>Correction requests</h3>' + (c.duty ? corrList(c.duty.corr) : '<p class="msg">Loading…</p>') +
        '<h3>Approved timesheets</h3>' + (c.duty ? weekList(c.duty.weeks) : '<p class="msg">Loading…</p>') +
        '<h3>Vessel assignments</h3>' + (c.events ? eventList((c.events || []).filter(function (e) { return e.kind === "vessel"; })) : '<p class="msg">Loading…</p>') + '</section>';
    } else if (ptab === "leave") {
      var reqs = model.leave.filter(function (l) { return l.uid === uid; });
      body = '<section class="ep-card ep-panel"><div class="card-head"><h2>Leave balance ' + new Date().getFullYear() + '</h2>' + (s.active && ctx.myRole ? '<button type="button" class="btn-soft" id="pLeave2">Request leave</button>' : "") + '</div>' +
        '<div class="bal-grid">' + leaveTypes().map(function (t) {
          var used = usedDays(uid, t.name), lim = Number(t.days) || 0;
          return '<div class="bal"><small>' + esc(t.name) + (t.paid === false ? " · unpaid" : "") + '</small><strong>' + (lim ? Math.max(0, lim - used) : "∞") + '</strong><span class="muted-cell">' + (lim ? used + " of " + lim + " working days used" : used + " days used · no limit") + '</span>' + (lim ? '<i style="width:' + Math.min(100, Math.round(used * 100 / lim)) + '%"></i>' : "") + '</div>';
        }).join("") + '</div>' +
        '<h3>Requests</h3>' + (reqs.length ? leaveRows(reqs, false) : empty("No leave requests yet.")) + '</section>';
    } else if (ptab === "pay") {
      body = payTab(uid, c);
    } else if (ptab === "activity") {
      body = '<section class="ep-card ep-panel"><h2>Activity</h2><p class="note">Every change to ' + esc(s.name.split(" ")[0]) + '\'s record, newest first</p>' + (c.events ? eventList(c.events) : '<p class="msg">Loading…</p>') + '</section>';
    }
    return head + body + '</div></div>';
  }
  function eventList(list) {
    if (!list.length) return empty("Nothing recorded yet.");
    return '<ul class="timeline">' + list.map(function (e) {
      return '<li><span class="tl-dot tl-' + esc(e.kind) + '"></span><span class="grow"><strong>' + esc(e.detail) + '</strong><small>' + when(e.created_at) + (e.actor ? " · by " + esc(nameOfUid(e.actor) === "someone" ? model.nameOf(e.actor) : nameOfUid(e.actor)) : "") + '</small></span></li>';
    }).join("") + '</ul>';
  }
  function lockedDay(d, day) { return (d.weeks || []).some(function (w) { return day >= w.week_start && day <= addDaysIso(6, w.week_start); }); }
  function corrList(list) {
    if (!list.length) return empty("No correction requests.");
    return '<ul class="rows">' + list.map(function (c) {
      return '<li class="row"><span class="grow"><strong>' + esc(fmtDate(c.day)) + (c.clock_in ? " · in " + hm(c.clock_in) : "") + (c.clock_out ? " · out " + hm(c.clock_out) : "") + (c.status ? " · " + esc(c.status) : "") + '</strong><small>' + esc(c.reason) + ' · asked ' + when(c.created_at) + '</small></span>' +
        chip(c.status_now === "Pending" ? "Waiting for HR" : c.status_now, "st-" + slug(c.status_now)) + '</li>';
    }).join("") + '</ul>';
  }
  function weekList(list) {
    if (!list.length) return empty("No approved timesheets yet.");
    return '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Week</th><th>Scheduled</th><th>Actual</th><th>Overtime</th><th>Approved</th></tr></thead><tbody>' + list.map(function (w) {
      var otm = w.overtime_min + w.holiday_min;
      return '<tr><td>' + esc(fmtRange(w.week_start, addDaysIso(6, w.week_start))) + '</td><td class="muted-cell">' + fmtMin(w.scheduled_min) + '</td><td>' + fmtMin(w.actual_min) + '</td>' +
        '<td>' + (otm ? '<strong>' + fmtMin(otm) + '</strong> <span class="muted-cell">' + (w.overtime_paid ? "paid" : "not paid yet") + '</span>' : '<span class="muted-cell">None</span>') + '</td><td class="muted-cell">' + fmtDate(w.approved_at) + '</td></tr>';
    }).join("") + '</tbody></table></div>';
  }
  function dutyTable(d, uid) {
    var rows = [], t = todayIso(), mayCorr = ctx.canHr || uid === ctx.me;
    for (var i = 0; i < 30; i++) {
      var day = addDaysIso(-i, t), r = d.roster[day], a = d.att[day];
      if (!r && !a) continue;
      rows.push('<tr><td class="muted-cell">' + fmtDate(day) + '</td><td>' + (r ? '<span class="code-chip">' + esc(r) + '</span>' : "—") + '</td><td>' + (a ? chip(a.status) : "—") + '</td><td class="muted-cell">' + hm(a && a.clock_in) + '</td><td class="muted-cell">' + hm(a && a.clock_out) + '</td><td class="muted-cell">' + hoursBetween(a && a.clock_in, a && a.clock_out) + '</td>' +
        '<td>' + (!mayCorr ? "" : lockedDay(d, day) ? '<span class="muted-cell">Week approved</span>' : d.corr.some(function (c) { return c.day === day && c.status_now === "Pending"; }) ? chip("Correction waiting", "st-pending") :
          '<button type="button" class="ghost manage-btn" data-dcorr="' + uid + '|' + day + '">' + (ctx.canHr ? "Correct" : "Request correction") + '</button>') + '</td></tr>');
    }
    return rows.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Day</th><th>Roster</th><th>Attendance</th><th>In</th><th>Out</th><th>Hours</th><th></th></tr></thead><tbody>' + rows.join("") + '</tbody></table></div>' : empty("No roster or attendance in the last 30 days.");
  }
  function docList(uid, docs) {
    return '<ul class="rows doc-list">' + (docs.length ? docs.map(function (doc) {
      var exp = doc.expiry_date && doc.expiry_date < todayIso();
      return '<li class="row"><span class="grow"><strong>' + esc(doc.title) + '</strong><small>' + esc(doc.category) + (doc.reference_no ? " · " + esc(doc.reference_no) : "") +
        (doc.expiry_date ? (exp ? ' · <span class="exp">expired ' : " · until ") + esc(fmtDate(doc.expiry_date)) + (exp ? "</span>" : "") : "") +
        (doc.visibility === "hr_only" ? " · HR only" : "") + (doc.file_name ? " · v" + doc.version : "") + '</small></span>' +
        (doc.file_path ? '<button type="button" class="ghost" data-dl="' + esc(doc.file_path) + '" data-fn="' + esc(doc.file_name || "document") + '">Download</button>' : "") +
        (ctx.canHr ? '<button type="button" class="ghost danger" data-deldoc="' + doc.id + '">Remove</button>' : "") + '</li>';
    }).join("") : '<li class="row"><small>No documents yet.</small></li>') + '</ul>';
  }
  function docForm() {
    return '<div class="inv" style="margin-top:8px"><select id="dCat" aria-label="Category">' + docCats().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join("") + '</select>' +
      '<input id="dTitle" placeholder="Title" maxlength="120" aria-label="Title"><input id="dRef" placeholder="Reference no." maxlength="60" aria-label="Reference">' +
      '<label class="inline-date">Issued <input id="dIssue" type="date" aria-label="Issue date"></label><label class="inline-date">Expires <input id="dExp" type="date" aria-label="Expiry"></label>' +
      '<input id="dQual" list="qualList2" placeholder="Link qualification" maxlength="80"><datalist id="qualList2">' + qualTypes().map(function (q) { return '<option value="' + esc(q.name) + '">'; }).join("") + '</datalist>' +
      '<select id="dVis" aria-label="Visibility"><option value="self_and_hr">Staff can see</option><option value="hr_only">HR only</option></select>' +
      '<input id="dFile" type="file" aria-label="File"><button type="button" class="save" id="dAdd">Upload</button></div>';
  }
  // Fetch what a profile tab needs, then draw again.
  function loadProfile(uid, ptab) {
    var c = cache[uid] = cache[uid] || {}, jobs = [];
    if (!c.events && ["employment", "duty", "activity"].indexOf(ptab) > -1) jobs.push(db.from("employee_events").select("*").eq("company_id", company.id).eq("user_id", uid).order("created_at", { ascending: false }).limit(200).then(function (r) { c.events = r.data || []; }));
    if (!c.docs && ptab === "documents") {
      jobs.push(db.from("staff_documents").select("*").eq("company_id", company.id).eq("user_id", uid).order("created_at", { ascending: false }).then(function (r) { c.docs = r.data || []; }));
      jobs.push(db.from("agreements").select("id, number, title, category, status").eq("company_id", company.id).eq("staff_user_id", uid).order("created_at", { ascending: false }).then(function (r) { c.agreements = r.data || []; }));
    }
    if (!c.duty && ptab === "duty") {
      var from = addDaysIso(-29);
      jobs.push(Promise.all([
        db.from("roster_entries").select("day, shift").eq("company_id", company.id).eq("user_id", uid).gte("day", from).lte("day", todayIso()),
        db.from("attendance_records").select("day, status, clock_in, clock_out").eq("company_id", company.id).eq("user_id", uid).gte("day", from).lte("day", todayIso()),
        db.from("attendance_corrections").select("id, day, clock_in, clock_out, status, reason, status_now, created_at").eq("company_id", company.id).eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
        db.from("timesheet_weeks").select("week_start, scheduled_min, actual_min, overtime_min, holiday_min, overtime_paid, approved_at").eq("company_id", company.id).eq("user_id", uid).order("week_start", { ascending: false }).limit(12)
      ]).then(function (r) {
        var ro = {}, at = {}; (r[0].data || []).forEach(function (x) { ro[x.day] = x.shift; }); (r[1].data || []).forEach(function (x) { at[x.day] = x; });
        c.duty = { roster: ro, att: at, corr: r[2].data || [], weeks: r[3].data || [] };
      }));
    }
    if (!c.pay && ptab === "pay") {
      jobs.push(Promise.all([
        db.from("member_pay").select("*").eq("company_id", company.id).eq("user_id", uid).maybeSingle(),
        db.from("payroll_lines").select("*, run:payroll_runs(*)").eq("company_id", company.id).eq("user_id", uid).limit(60)
      ]).then(function (r) {
        var slips = (r[1].data || []).filter(function (l) { return l.run && l.run.status !== "Draft"; }).sort(function (a, b) { return b.run.period_start.localeCompare(a.run.period_start); });
        c.pay = { mine: r[0].data || null, slips: slips };
      }));
    }
    if (!jobs.length) return;
    Promise.all(jobs).then(function () { var rt = route(); if (rt.view === "employee" && rt.id === uid) render(); });
  }

  /* ---------- Duty & Attendance ---------- */
  function hm(ts) { return ts ? new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"; }
  function hoursBetween(a, b) { if (!a || !b) return "—"; return (Math.round((new Date(b) - new Date(a)) / 36e5 * 10) / 10) + "h"; }
  var ATABS = [["register", "Register"], ["timesheets", "Timesheets"], ["exceptions", "Exceptions"]];
  function attendanceView(sub) {
    var tabs = hrSettingsOk() ? ATABS.concat([["settings", "Settings"]]) : ATABS;
    sub = tabs.some(function (t) { return t[0] === sub; }) ? sub : "register";
    var head = '<section class="dash-card tabs-card"><div class="card-head">' + subTabs(tabs, sub, "#attendance/") + '<a class="btn-soft" href="roster.html">Open Duty Roster</a></div></section>';
    if (sub === "settings") return head + '<section class="dash-card" id="hrAreaSettings"></section>';
    if (sub === "timesheets") return head + timesheets();
    if (sub === "exceptions") return head + exceptionsView();
    return head + registerView();
  }
  function registerView() {
    var act = activeStaff(), working = act.filter(function (s) { return isWorking(s.shiftToday); }).length;
    var off = act.filter(function (s) { return s.shiftToday === "OFF"; }).length, onl = act.filter(function (s) { return s.duty === "On leave"; }).length;
    var none = act.filter(function (s) { return !s.shiftToday; }).length;
    return '<section class="dash-card"><div class="card-head"><div><h2>Today\'s roster</h2><p class="note">' + working + ' working · ' + off + ' off · ' + onl + ' on leave · ' + none + ' not rostered</p></div></div></section>' +
      '<section class="dash-card"><h2>Attendance register</h2><p class="note">Expected times come from the roster and Shift Definitions; late and absent follow Attendance Rules.</p>' + attendancePanel() + '</section>';
  }
  // Clock in until you have clocked in; then Break in (when HR allows breaks) and Break out; Clock out ends the shift.
  function clockButtons(mine) {
    var bs = model.myBreak || {}, on = attRules().breaks === true, inNow = mine && mine.clock_in && !mine.clock_out;
    if (!inNow) return '<button type="button" class="save" id="clkIn">Clock in</button>' + (mine && mine.clock_in ? "" : '<button type="button" class="ghost" id="clkOut" disabled>Clock out</button>');
    var note = on && model.myBreakErr ? '<small class="muted-cell" style="display:block;color:#b00020">Break status unavailable: ' + esc(model.myBreakErr) + '</small>' : "";
    if (on && bs.on_break) return '<button type="button" class="save" id="brkOut">Break out</button><span class="muted-cell">on break since ' + hm(bs.break_since) + '</span>' + note;
    return (on ? '<button type="button" class="save" id="brkIn">Break in</button>' : "") + '<button type="button" class="ghost" id="clkOut">Clock out</button>' + note;
  }
  function breakCell(uid) { var b = model.brkBy && model.brkBy[uid]; return b ? fmtMin(b.minutes) + (b.open ? " · on break" : "") : "—"; }
  function attendancePanel() {
    var day = attDay || todayIso(), rules = attRules(), list = activeStaff();
    var rows = list.filter(function (s) {
      var a = model.attBy[s.uid];
      if (attFilter && (!a || a.status !== attFilter)) return false;
      if (fText && (s.name + " " + s.position + " " + s.empNo).toLowerCase().indexOf(fText) < 0) return false;
      return true;
    });
    var mine = model.attBy[ctx.me];
    var counts = { Present: 0, Late: 0, Absent: 0, "On leave": 0, "Rest day": 0, "Missed punch": 0 };
    list.forEach(function (s) { var a = model.attBy[s.uid]; if (a && counts[a.status] != null) counts[a.status]++; });
    var pending = model.corrections.filter(function (c) { return c.day === day; });
    var clock = ctx.myRole ? '<div class="clock-box"><span class="grow"><strong>Your attendance today</strong><small class="muted-cell" style="display:block">' +
      (mine ? esc(mine.status) + (mine.scheduled_shift ? " · roster " + esc(mine.scheduled_shift) : "") + " · in " + hm(mine.clock_in) + " · out " + hm(mine.clock_out) : "No record yet. Clock in when you start.") +
      (rules.geo ? " · location required" : "") + '</small></span>' +
      clockButtons(mine) + '</div>' : "";
    var table = !rows.length ? empty("No attendance rows match.") :
      '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Staff</th><th>Roster</th><th>In</th><th>Out</th><th>Hours</th>' + (rules.breaks ? '<th>Break</th>' : "") + '<th>Status</th><th></th></tr></thead><tbody>' +
      rows.map(function (s) {
        var a = model.attBy[s.uid] || {};
        return '<tr><td>' + who(s, true) + '</td>' +
          '<td class="muted-cell">' + esc(a.scheduled_shift || (day === todayIso() ? s.shiftToday : "") || "—") + '</td><td class="muted-cell">' + hm(a.clock_in) + '</td><td class="muted-cell">' + hm(a.clock_out) + '</td>' +
          '<td class="muted-cell">' + hoursBetween(a.clock_in, a.clock_out) + '</td>' + (rules.breaks ? '<td class="muted-cell">' + breakCell(s.uid) + '</td>' : "") + '<td>' + (a.status ? chip(a.status) : "—") + '</td>' +
          '<td>' + ((ctx.canHr || s.uid === ctx.me) && s.uid ? '<button type="button" class="ghost manage-btn" data-correct="' + s.uid + '">Correct</button>' : "") + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    var corr = pending.length && ctx.canHr ? '<h3>Corrections waiting</h3><ul class="rows">' + pending.map(function (c) {
      var s = person(c.user_id);
      return '<li class="row"><span class="grow"><strong>' + esc(s ? s.name : "Staff") + '</strong><small>' + esc(c.reason) + (c.clock_in ? " · in " + hm(c.clock_in) : "") + (c.clock_out ? " · out " + hm(c.clock_out) : "") + '</small></span>' +
        '<button type="button" class="ghost danger" data-attno="' + c.id + '">Reject</button><button type="button" class="save" data-attyes="' + c.id + '">Approve</button></li>';
    }).join("") + '</ul>' : "";
    return clock +
      '<div class="att-toolbar"><label>Day <input id="attDay" type="date" value="' + esc(day) + '"></label>' +
      '<select id="attFilter" aria-label="Status"><option value="">All statuses</option>' + Object.keys(counts).map(function (k) { return '<option' + (attFilter === k ? " selected" : "") + '>' + k + '</option>'; }).join("") + '</select>' +
      '<span class="muted-cell">' + counts.Present + " present · " + counts.Late + " late · " + counts.Absent + " absent · " + counts["Missed punch"] + " missed punch · " + counts["On leave"] + " leave</span>" +
      (ctx.canHr ? '<button type="button" class="ghost" id="attCsv">Import CSV</button><input id="attFile" type="file" accept=".csv,text/csv" hidden>' : "") + '</div>' +
      table + corr;
  }

  /* ---------- Timesheets & exceptions (timesheet_week() in the database works out the hours) ---------- */
  // A week starts the day after the weekend (Duty Roster settings), the same as timesheet_week_start().
  function weekStartOf(day) {
    var w = formSetting("8_duty_roster", "Duty Roster").weekend || "Friday & Saturday";
    var first = { "Saturday & Sunday": 1, "Friday only": 6, "None": 1 }[w]; if (first == null) first = 0;
    return addDaysIso(-((new Date(day + "T00:00:00").getDay() - first + 7) % 7), day);
  }
  function fmtMin(m) { m = Math.round(m || 0); var a = Math.abs(m); return (m < 0 ? "−" : "") + Math.floor(a / 60) + "h" + (a % 60 ? " " + pad2(a % 60) + "m" : ""); }
  function diffMin(m) { return m > 0 ? "+" + fmtMin(m) : fmtMin(m); }
  function otRules() { return formSetting("8_overtime_rules", "Overtime Rules"); }
  function loadWeek(ws) {
    cache.ts = cache.ts || {};
    if (cache.ts[ws] || cache.tsBusy === ws + tsGen) return;
    var gen = tsGen; cache.tsBusy = ws + gen;
    db.rpc("timesheet_week", { p_company: company.id, p_week_start: ws }).then(function (r) {
      if (gen !== tsGen) return;
      cache.tsBusy = null; cache.ts[ws] = r.error ? { error: r.error.message } : r.data;
      var rt = route(); if (rt.view === "attendance" && (rt.id === "timesheets" || rt.id === "exceptions") && tsWeek === ws) render();
    });
  }
  function weekData() { return cache.ts && cache.ts[tsWeek]; }
  function weekPerson(uid) { var w = weekData(); return w && w.people ? w.people.filter(function (p) { return p.user_id === uid; })[0] : null; }
  function staffOf(uid) { return person(uid) || { uid: uid, name: model.nameOf(uid) }; }
  function dayExceptions(d) {
    var out = [];
    if (d.missed) out.push(["missed", "Missed punch", d.clock_in ? "Clocked in " + hm(d.clock_in) + ", no clock-out" : "Clocked out " + hm(d.clock_out) + ", no clock-in"]);
    if (d.late) out.push(["late", "Late arrival", "In " + hm(d.clock_in) + ", shift starts " + hm(d.start)]);
    if (d.early) out.push(["early", "Early departure", "Out " + hm(d.clock_out) + ", shift ends " + hm(d.end)]);
    if (d.absent) out.push(["absent", "Unapproved absence", d.shift && isWorking(d.shift) ? "Rostered " + d.shift + ", no clock-in and no approved leave" : "Marked absent"]);
    return out;
  }
  var EX_CLS = { missed: "st-missed-punch", late: "st-late", early: "st-late", absent: "st-absent", pending: "st-pending" };
  function sumWeek(p) {
    var o = { sched: 0, act: 0, exc: 0, pend: 0, missed: 0 };
    p.days.forEach(function (d) { o.sched += d.scheduled || 0; o.act += d.actual || 0; o.exc += dayExceptions(d).length; o.pend += (d.pending || []).length; if (d.missed) o.missed++; });
    return o;
  }
  function weekNav(extra) {
    var ws = tsWeek, cur = weekStartOf(todayIso());
    return '<div class="att-toolbar"><button type="button" class="ghost" data-wk="' + addDaysIso(-7, ws) + '" aria-label="Previous week">‹ Previous</button>' +
      '<strong class="wk-label">' + esc(fmtRange(ws, addDaysIso(6, ws))) + ' ' + ws.slice(0, 4) + '</strong>' +
      '<button type="button" class="ghost" data-wk="' + addDaysIso(7, ws) + '" aria-label="Next week">Next ›</button>' +
      (ws !== cur ? '<button type="button" class="ghost" data-wk="' + cur + '">This week</button>' : "") + (extra || "") + '</div>';
  }
  function weekEnded() { return addDaysIso(6, tsWeek) < todayIso(); }
  function canApproveFor(uid) { return ctx.canHr && (uid !== ctx.me || ctx.isPlatform || ctx.myRole === "owner"); }
  function readyToApprove(p) { var t = sumWeek(p); return !p.approved && weekEnded() && !t.missed && !t.pend && canApproveFor(p.user_id); }

  function timesheets() {
    var w = weekData();
    if (!w) return '<section class="dash-card">' + weekNav() + '<p class="msg">Loading…</p></section>';
    if (w.error) return '<section class="dash-card">' + weekNav() + '<p class="msg err">' + esc(w.error) + '</p></section>';
    var ot = otRules(), people = w.people, ended = weekEnded();
    var tot = { sched: 0, act: 0, ot: 0, appr: 0 };
    people.forEach(function (p) { var t = sumWeek(p); tot.sched += t.sched; tot.act += t.act; if (p.approved) { tot.appr++; tot.ot += p.approved.overtime + p.approved.holiday; } });
    var rows = people.filter(function (p) {
      var s = staffOf(p.user_id), t = sumWeek(p);
      if (fText && (s.name + " " + (s.position || "") + " " + (s.empNo || "")).toLowerCase().indexOf(fText) < 0) return false;
      if (tsFilter === "waiting") return !p.approved;
      if (tsFilter === "approved") return !!p.approved;
      if (tsFilter === "exceptions") return t.exc + t.pend > 0;
      if (tsFilter === "overtime") return p.approved && p.approved.overtime + p.approved.holiday > 0;
      return true;
    });
    var ready = people.filter(readyToApprove);
    var filt = '<select id="tsFilter" aria-label="Show">' + options([["", "Everyone"], ["waiting", "Not approved yet"], ["approved", "Approved"], ["exceptions", "With exceptions"], ["overtime", "With overtime"]], tsFilter) + '</select>' +
      (ctx.canHr && ready.length ? '<button type="button" class="save" id="tsAll">Approve ' + ready.length + ' ready</button>' : "");
    var table = !rows.length ? empty(people.length ? "No timesheets match." : "Nobody to show for this week.") :
      '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Staff</th><th>Scheduled</th><th>Actual</th><th>Difference</th><th>Exceptions</th><th>Overtime</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map(function (p) {
        var s = staffOf(p.user_id), t = sumWeek(p), a = p.approved, open = tsOpen[p.user_id];
        var sched = a ? a.scheduled : t.sched, act = a ? a.actual : t.act, diff = act - sched, otm = a ? a.overtime + a.holiday : 0;
        var status = a ? chip("Approved", "st-approved") : !ended ? chip("Week not over", "st-off-duty") : chip("Waiting for approval", "st-pending");
        var excTxt = t.exc || t.pend ? '<span class="exp">' + t.exc + '</span>' + (t.pend ? ' <span class="muted-cell">· ' + t.pend + ' correction' + (t.pend > 1 ? "s" : "") + ' waiting</span>' : "") : '<span class="muted-cell">None</span>';
        var action = '<button type="button" class="ghost manage-btn" data-tsopen="' + p.user_id + '">' + (open ? "Hide days" : "Days") + '</button>' +
          (ctx.canHr ? (a ? (a.paid ? "" : ' <button type="button" class="ghost manage-btn" data-tsreopen="' + p.user_id + '">Reopen</button>') : ended && canApproveFor(p.user_id) ? ' <button type="button" class="save manage-btn" data-tsok="' + p.user_id + '">Approve</button>' : "") : "");
        return '<tr><td>' + who(s, true) + '</td><td class="muted-cell">' + fmtMin(sched) + '</td><td>' + fmtMin(act) + '</td><td class="' + (diff < 0 ? "exp" : "muted-cell") + '">' + diffMin(diff) + '</td>' +
          '<td>' + excTxt + '</td><td>' + (a ? (otm ? '<strong>' + fmtMin(otm) + '</strong> <span class="muted-cell">' + (a.paid ? "paid" : "not paid yet") + '</span>' : '<span class="muted-cell">None</span>') : '<span class="muted-cell">After approval</span>') + '</td>' +
          '<td>' + status + '</td><td>' + action + '</td></tr>' + (open ? '<tr class="ts-detail"><td colspan="8">' + weekDays(p) + '</td></tr>' : "");
      }).join("") + '</tbody></table></div>';
    var rate = Number(ot.rate) || 1.25, hrate = Number(ot.holidayRate) || 2, after = Number(ot.after) || 8;
    return '<div class="kpis">' +
      kpi("blue", I.cal, "Scheduled", fmtMin(tot.sched), "Roster shifts minus breaks") +
      kpi("teal", I.clock, "Actual", fmtMin(tot.act), diffMin(tot.act - tot.sched) + " against the roster") +
      kpi("purple", I.check, "Approved", tot.appr + "/" + people.length, ended ? (people.length - tot.appr) + " still to approve" : "Approve after the week ends") +
      kpi("orange", I.brief, "Overtime", fmtMin(tot.ot), "Approved weeks only", "#payroll/overtime") + '</div>' +
      '<section class="dash-card"><div class="card-head"><div><h2>' + (ctx.canHr ? "Timesheets" : "Your timesheet") + '</h2><p class="note">Scheduled hours come from the roster and Shift Definitions, minus the unpaid break. Actual hours are clock-in to clock-out, minus the same break.</p></div></div>' +
      weekNav(filt) + table +
      '<p class="hint">' + (ot.enabled === false ? "Overtime is switched off in Overtime Rules." :
        "Overtime is worked out only when HR approves a week: time over " + after + "h a day at ×" + rate + ", and work on a Holiday Calendar day at ×" + hrate + ". It is paid in the next pay run on Payroll & Overtime.") +
      ' Approving a week locks those days. HR can reopen it if something was wrong.</p></section>';
  }
  function weekDays(p) {
    var a = p.approved, mayCorrect = !a && (ctx.canHr || p.user_id === ctx.me);
    return '<table class="dtable ts-days"><thead><tr><th>Day</th><th>Roster</th><th>Scheduled</th><th>In</th><th>Out</th><th>Actual</th>' + (a ? '<th>Overtime</th>' : "") + '<th>Notes</th><th></th></tr></thead><tbody>' +
      p.days.map(function (d) {
        var ex = dayExceptions(d), notes = ex.map(function (e) { return chip(e[1], EX_CLS[e[0]]); });
        if ((d.pending || []).length) notes.push(chip("Correction waiting", "st-pending"));
        if (d.leave) notes.push(chip("On leave", "st-on-leave"));
        if (d.holiday) notes.push(chip("Holiday", "st-training"));
        var otd = (d.overtime || 0) + (d.holiday_ot || 0);
        return '<tr><td class="muted-cell">' + new Date(d.day + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + '</td>' +
          '<td>' + (d.shift ? '<span class="code-chip">' + esc(d.shift) + '</span>' : '<span class="muted-cell">—</span>') + '</td><td class="muted-cell">' + (d.scheduled ? fmtMin(d.scheduled) : "—") + '</td>' +
          '<td class="muted-cell">' + hm(d.clock_in) + '</td><td class="muted-cell">' + hm(d.clock_out) + '</td><td>' + (d.actual ? fmtMin(d.actual) : "—") + '</td>' +
          (a ? '<td>' + (otd ? fmtMin(otd) : '<span class="muted-cell">—</span>') + '</td>' : "") + '<td>' + (notes.join(" ") || '<span class="muted-cell">—</span>') + '</td>' +
          '<td>' + (mayCorrect && d.day <= todayIso() && !(d.pending || []).length ? '<button type="button" class="ghost manage-btn" data-tscorr="' + p.user_id + '|' + d.day + '">' + (ctx.canHr ? "Correct" : "Request correction") + '</button>' : "") + '</td></tr>';
      }).join("") + '</tbody></table>' + (a ? '<p class="hint">Approved ' + when(a.at) + (a.by ? " by " + esc(model.nameOf(a.by)) : "") + (a.note ? " · " + esc(a.note) : "") + '. Overtime: ' + fmtMin(a.overtime) + ' at ×' + a.rate + (a.holiday ? ' and ' + fmtMin(a.holiday) + ' holiday work at ×' + a.holiday_rate : "") + (a.paid ? ", paid through payroll." : ", not paid yet.") + '</p>' : "");
  }

  function exceptionsView() {
    var w = weekData();
    if (!w) return '<section class="dash-card">' + weekNav() + '<p class="msg">Loading…</p></section>';
    if (w.error) return '<section class="dash-card">' + weekNav() + '<p class="msg err">' + esc(w.error) + '</p></section>';
    var items = [];
    w.people.forEach(function (p) {
      p.days.forEach(function (d) {
        var ex = dayExceptions(d);
        if (!ex.length && (d.pending || []).length) ex = [["pending", "Correction waiting", "Change asked for, not decided yet"]];
        ex.forEach(function (e) { items.push({ p: p, d: d, k: e[0], label: e[1], detail: e[2] }); });
      });
    });
    var types = [["", "All"], ["missed", "Missed punches"], ["early", "Early departures"], ["late", "Late arrivals"], ["absent", "Unapproved absences"]];
    var count = function (k) { return items.filter(function (x) { return !k || x.k === k; }).length; };
    var list = items.filter(function (x) {
      var s = staffOf(x.p.user_id);
      if (excFilter && x.k !== excFilter) return false;
      if (fText && s.name.toLowerCase().indexOf(fText) < 0) return false;
      return true;
    });
    return '<section class="dash-card"><div class="card-head"><div><h2>' + (ctx.canHr ? "Exceptions" : "Your exceptions") + '</h2><p class="note">Days that need a look. Correct the times, or approve a correction someone asked for. Late and early use the "Late after" minutes in Attendance Rules.</p></div></div>' +
      weekNav() + '<div class="stage-pills">' + types.map(function (t) { return '<button type="button" class="pill-btn' + (excFilter === t[0] ? " on" : "") + '" data-exf="' + t[0] + '">' + t[1] + '<b>' + count(t[0]) + '</b></button>'; }).join("") + '</div>' +
      (list.length ? '<ul class="rows">' + list.map(function (x) {
        var s = staffOf(x.p.user_id), pend = x.d.pending || [], locked = !!x.p.approved, act = "";
        if (pend.length) {
          act = pend.map(function (c) {
            return '<small class="muted-cell">Asked: ' + (c.clock_in ? "in " + hm(c.clock_in) + " " : "") + (c.clock_out ? "out " + hm(c.clock_out) + " " : "") + (c.status ? c.status + " " : "") + '· ' + esc(c.reason) + '</small>' +
              (ctx.canHr ? '<button type="button" class="ghost danger" data-attno="' + c.id + '">Reject</button><button type="button" class="save" data-attyes="' + c.id + '">Approve</button>' : chip("Correction waiting", "st-pending"));
          }).join("");
        } else if (locked) act = chip("Week approved", "st-off-duty");
        else if (ctx.canHr || x.p.user_id === ctx.me) act = '<button type="button" class="ghost" data-tscorr="' + x.p.user_id + '|' + x.d.day + '">' + (ctx.canHr ? "Correct" : "Request correction") + '</button>';
        return '<li class="row"><span class="grow"><strong>' + esc(s.name) + ' · ' + esc(fmtDate(x.d.day)) + '</strong><small>' + chip(x.label, EX_CLS[x.k]) + ' ' + esc(x.detail) +
          (x.k === "absent" ? ' · if it was leave, record it in <a href="#leave/requests">Leave &amp; Absence</a>' : "") + '</small></span>' + act + '</li>';
      }).join("") + '</ul>' : empty(items.length ? "No exceptions of this kind this week." : "No exceptions this week."));
  }

  function openApproveTs(uid) {
    var p = weekPerson(uid); if (!p) return;
    var s = staffOf(uid), t = sumWeek(p), ot = otRules();
    openModal('<h2>Approve timesheet</h2><p class="note">' + esc(s.name) + ' · ' + esc(fmtRange(tsWeek, addDaysIso(6, tsWeek))) + '</p><ul class="rows">' +
      '<li class="row"><span class="grow"><strong>' + fmtMin(t.act) + ' worked of ' + fmtMin(t.sched) + ' scheduled</strong><small>Difference ' + diffMin(t.act - t.sched) + '</small></span></li>' +
      '<li class="row"><span class="grow"><small>' + (t.exc ? '<span class="exp">' + t.exc + ' exception' + (t.exc > 1 ? "s" : "") + '.</span> Check them before approving.' : "No exceptions.") + '</small></span></li>' +
      '<li class="row"><span class="grow"><small>' + (ot.enabled === false ? "Overtime is switched off in Overtime Rules." : "Overtime is worked out now, using Overtime Rules. It shows as not paid yet.") + ' The days are then locked.</small></span></li></ul>' +
      '<div class="fld" style="margin-top:12px"><label for="tNote">Note (optional)</label><input id="tNote" maxlength="200"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="tGo">Approve week</button></div>');
    $("tGo").addEventListener("click", function () {
      rpc("approve_timesheet", { p_company: company.id, p_user: uid, p_week_start: tsWeek, p_note: $("tNote").value.trim() || null })
        .then(function () { closeModal(); delete cache[uid]; reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  function openReopenTs(uid) {
    var s = staffOf(uid);
    openModal('<h2>Reopen timesheet</h2><p class="note">' + esc(s.name) + ' · ' + esc(fmtRange(tsWeek, addDaysIso(6, tsWeek))) + '. The days unlock so they can be corrected, and the overtime is removed until it is approved again.</p>' +
      '<div class="fld"><label for="tWhy">Reason</label><input id="tWhy" maxlength="200"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="tGo">Reopen week</button></div>');
    $("tGo").addEventListener("click", function () {
      var why = $("tWhy").value.trim(); if (why.length < 2) { say("Give a reason.", "err"); return; }
      rpc("reopen_timesheet", { p_company: company.id, p_user: uid, p_week_start: tsWeek, p_reason: why })
        .then(function () { closeModal(); delete cache[uid]; reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  function approveAllTs() {
    var w = weekData(), ready = w && w.people ? w.people.filter(readyToApprove) : [];
    if (!ready.length || !confirm("Approve " + ready.length + " timesheet" + (ready.length > 1 ? "s" : "") + " for " + fmtRange(tsWeek, addDaysIso(6, tsWeek)) + "? Those days will be locked.")) return;
    var failed = [];
    ready.reduce(function (pr, p) {
      return pr.then(function () { return rpc("approve_timesheet", { p_company: company.id, p_user: p.user_id, p_week_start: tsWeek, p_note: null }).catch(function (e) { failed.push(staffOf(p.user_id).name + ": " + e.message); }); });
    }, Promise.resolve()).then(function () { return reload(); }).then(function () { if (failed.length) alert("Not approved:\n" + failed.join("\n")); });
  }

  /* ---------- Payroll & Overtime (calc_payroll_run() in the database works out the pay) ---------- */
  function payCfg() { return formSetting("8_payroll_configuration", "Payroll Configuration"); }
  function currency() { var b = formSetting("9_base_currency", "Base Currency"); return { code: b.base || "MVR", dec: Math.min(4, Math.max(0, Number(b.decimals) >= 0 ? Number(b.decimals) : 2)) }; }
  function money(n) { var c = currency(); return c.code + " " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: c.dec, maximumFractionDigits: c.dec }); }
  function allowSum(list) { return (list || []).reduce(function (t, a) { return t + (Number(a.amount) || 0); }, 0); }
  var PRTABS = [["runs", "Pay runs"], ["pay", "Pay details"], ["rules", "Allowance rules"], ["overtime", "Overtime not paid yet"]];
  function loadPay(force) {
    if ((cache.pay && !force) || cache.payBusy) return;
    cache.payBusy = true;
    Promise.all([
      db.from("payroll_runs").select("*").eq("company_id", company.id).order("period_start", { ascending: false }).limit(36),
      db.from("member_pay").select("*").eq("company_id", company.id),
      db.from("timesheet_weeks").select("user_id, week_start, overtime_min, holiday_min, overtime_rate, holiday_rate, overtime_paid, paid_run").eq("company_id", company.id).order("week_start", { ascending: false }).limit(500),
      db.rpc("is_payroll_approver", { p_company: company.id })
    ]).then(function (r) {
      cache.payBusy = false;
      var by = {}; (r[1].data || []).forEach(function (x) { by[x.user_id] = x; });
      cache.pay = { error: r[0].error && r[0].error.message, runs: r[0].data || [], pays: by, weeks: r[2].data || [], approver: r[3].data === true };
      var rt = route(); if (rt.view === "payroll" || rt.view === "reports" || rt.view === "employee") render();
    });
  }
  function payrollView(sub, id) {
    var p = cache.pay;
    if (!p) return '<section class="dash-card"><p class="msg">Loading…</p></section>';
    if (!ctx.canHr && !p.approver) { location.replace("#employee/" + ctx.me + "/pay"); return ""; }
    if (sub === "run" && id) return payRun(id);
    var ptabs = hrSettingsOk() ? PRTABS.concat([["settings", "Settings"]]) : PRTABS;
    sub = ptabs.some(function (t) { return t[0] === sub; }) ? sub : "runs";
    var head = '<section class="dash-card tabs-card"><div class="card-head">' + subTabs(ptabs, sub, "#payroll/") + (ctx.canHr && sub !== "settings" ? '<button type="button" class="save" id="prNew">New pay run</button>' : "") + '</div></section>';
    if (sub === "settings") return head + '<section class="dash-card" id="hrAreaSettings"></section>';
    if (p.error) return head + '<section class="dash-card"><p class="msg err">' + esc(p.error) + '</p></section>';
    if (sub === "pay") return head + payDetails();
    if (sub === "overtime") return head + otUnpaid();
    if (sub === "rules") return head + rulesView();
    var cfg = payCfg(), act = activeStaff(), missing = act.filter(function (s) { var x = p.pays[s.uid]; return !x || !(Number(x.basic) > 0); });
    var last = p.runs[0];
    return head + '<div class="kpis">' +
      kpi("blue", I.people, "On payroll", act.length - missing.length + "/" + act.length, missing.length ? missing.length + " without a salary yet" : "Everyone has a salary", "#payroll/pay") +
      kpi("teal", I.cal, "Pay period", esc(paySpanLabel(cfg)), "Pay day " + (cfg.day || 25) + " · change in Settings", "#payroll/settings/pay") +
      kpi("purple", I.check, "Last run", last ? esc(fmtRange(last.period_start, last.period_end)) : "None yet", last ? last.status + " · net " + money(last.net) : "Start with New pay run", last ? "#payroll/run/" + last.id : null) +
      kpi("orange", I.clock, "Overtime not paid", fmtMin(p.weeks.filter(function (w) { return !w.overtime_paid; }).reduce(function (t, w) { return t + w.overtime_min + w.holiday_min; }, 0)), "From approved timesheets · goes into the next run", "#payroll/overtime") + '</div>' +
      '<section class="dash-card"><div class="card-head"><div><h2>Pay runs</h2><p class="note">Each run pays basic salary and allowances, adds approved overtime that is not paid yet, and takes off unpaid leave and pension. ' + (cfg.approval !== false ? "Someone other than whoever prepared it approves it." : "") + '</p></div></div>' +
      (p.runs.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Period</th><th>Pay date</th><th>Staff</th><th>Gross</th><th>Net pay</th><th>Employer cost</th><th>Status</th><th></th></tr></thead><tbody>' + p.runs.map(function (r) {
        return '<tr><td><strong>' + esc(fmtRange(r.period_start, r.period_end)) + '</strong> <span class="muted-cell">' + r.period_end.slice(0, 4) + '</span></td><td class="muted-cell">' + (r.pay_date ? fmtDate(r.pay_date) : "—") + '</td><td class="muted-cell">' + r.staff_count + '</td>' +
          '<td>' + money(r.gross) + '</td><td><strong>' + money(r.net) + '</strong></td><td class="muted-cell">' + money(r.employer_cost) + '</td><td>' + chip(r.status, "st-pr-" + slug(r.status)) + '</td>' +
          '<td><a class="ghost manage-btn" href="#payroll/run/' + r.id + '">Open</a></td></tr>';
      }).join("") + '</tbody></table></div>' : empty("No pay runs yet. Set salaries on Pay details, then click New pay run.")) + '</section>';
  }
  function payDetails() {
    var p = cache.pay, act = activeStaff();
    return '<section class="dash-card"><div class="card-head"><div><h2>Pay details</h2><p class="note">Monthly basic salary and allowances. Pay runs scale them to the pay cycle. Only HR and the person can see them.</p></div></div>' +
      '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Staff</th><th>Basic (monthly)</th><th>Allowances</th><th>Pension</th><th>Paid by</th><th></th></tr></thead><tbody>' + act.map(function (s) {
        var x = p.pays[s.uid];
        return '<tr><td>' + who(s, true) + '</td><td>' + (x && Number(x.basic) > 0 ? money(x.basic) : '<span class="exp">Not set</span>') + '</td>' +
          '<td class="muted-cell">' + (x && x.allowances.length ? money(allowSum(x.allowances)) + ' <span class="th-sub">' + esc(x.allowances.map(function (a) { return a.name; }).join(", ")) + '</span>' : "—") + '</td>' +
          '<td class="muted-cell">' + (x ? (x.pension ? "Yes" : "No") : "—") + '</td><td class="muted-cell">' + (x ? esc(x.pay_method) : "—") + '</td>' +
          '<td>' + (ctx.canHr ? '<button type="button" class="ghost manage-btn" data-payedit="' + s.uid + '">Edit</button>' : "") + '</td></tr>';
      }).join("") + '</tbody></table></div></section>';
  }
  function otUnpaid() {
    var p = cache.pay, list = p.weeks.filter(function (w) { return !w.overtime_paid && w.overtime_min + w.holiday_min > 0; });
    return '<section class="dash-card"><h2>Overtime not paid yet</h2><p class="note">From approved timesheets only. Each week goes into the first pay run that ends on or after the week\'s last day.</p>' +
      (list.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Staff</th><th>Week</th><th>Overtime</th><th>Holiday work</th><th>About</th></tr></thead><tbody>' + list.map(function (w) {
        var s = staffOf(w.user_id), x = p.pays[w.user_id], hr = x ? Number(x.basic) / (Number(payCfg().hours) || 208) : 0;
        var est = hr * (w.overtime_min / 60 * Number(w.overtime_rate) + w.holiday_min / 60 * Number(w.holiday_rate));
        return '<tr><td>' + who(s, true) + '</td><td class="muted-cell">' + esc(fmtRange(w.week_start, addDaysIso(6, w.week_start))) + '</td><td>' + fmtMin(w.overtime_min) + ' <span class="muted-cell">×' + w.overtime_rate + '</span></td>' +
          '<td>' + (w.holiday_min ? fmtMin(w.holiday_min) + ' <span class="muted-cell">×' + w.holiday_rate + '</span>' : "—") + '</td><td class="muted-cell">' + (x && Number(x.basic) > 0 ? money(est) : "Set a salary first") + '</td></tr>';
      }).join("") + '</tbody></table></div>' : empty("No unpaid overtime. Overtime shows here after HR approves a timesheet.")) + '</section>';
  }
  function payRun(id) {
    var p = cache.pay, r = p.runs.filter(function (x) { return x.id === id; })[0];
    if (!r) return '<section class="dash-card">' + empty('That pay run was not found. <a href="#payroll">Back to Payroll</a>') + '</section>';
    var lines = cache["run:" + id];
    if (!lines) {
      db.from("payroll_lines").select("*").eq("run_id", id).then(function (res) { cache["run:" + id] = res.data || []; var rt = route(); if (rt.view === "payroll" && rt.sub === id) render(); });
      return '<section class="dash-card"><p class="msg">Loading…</p></section>';
    }
    var draft = r.status === "Draft", cfg = payCfg();
    var noPay = draft ? activeStaff().filter(function (s) { return !lines.some(function (l) { return l.user_id === s.uid; }); }) : [];
    var acts = '<button type="button" class="ghost" id="prCsv">Download CSV</button>' +
      (ctx.canHr ? '<button type="button" class="ghost" id="prLetter">Debit instruction</button>' : "") +
      (draft && ctx.canHr ? '<button type="button" class="ghost danger" id="prDel">Delete draft</button><button type="button" class="ghost" id="prCalc">Recalculate</button>' : "") +
      (draft && p.approver ? '<button type="button" class="save" id="prApprove">Approve</button>' : "") +
      (r.status === "Approved" && p.approver ? '<button type="button" class="ghost" id="prReopen">Reopen</button>' : "") +
      (r.status === "Approved" ? '<button type="button" class="save" id="prPaid">Mark as paid</button>' : "");
    var tot = function (k) { return lines.reduce(function (t, l) { return t + Number(l[k] || 0); }, 0); };
    var named = (((setting("8_approvers_and_responsibilities") || {}).duties || {}).payroll || {}), names = (named.people || []).concat(named.backup ? [named.backup] : []).map(nameOfUid).filter(function (n) { return n !== "someone"; });
    var waitTxt = !draft ? "" : !p.approver ? "Waiting for approval by " + (names.join(" or ") || "HR") + " (Approvers & Responsibilities → Payroll)." :
      cfg.approval !== false && r.created_by === ctx.me && ctx.myRole !== "owner" && !ctx.isPlatform ? "You prepared this run, so someone else must approve it (Payroll Configuration)." : "";
    return '<section class="dash-card prof-head"><a class="back" href="#payroll">' + icon(I.back) + 'Payroll</a><div class="card-head"><div><h2>Pay run ' + esc(fmtRange(r.period_start, r.period_end)) + ' ' + r.period_end.slice(0, 4) + ' ' + chip(r.status, "st-pr-" + slug(r.status)) + '</h2>' +
      '<p class="note">' + (r.pay_date ? "Pay date " + fmtDate(r.pay_date) + " · " : "") + esc(paySpanLabel(cfg)) + (r.calculated_at ? " · worked out " + when(r.calculated_at) : "") +
      (r.approved_at ? " · approved " + when(r.approved_at) + (r.approved_by ? " by " + esc(model.nameOf(r.approved_by)) : "") : "") + (r.paid_at ? " · paid " + when(r.paid_at) : "") + (r.note ? " · " + esc(r.note) : "") + '</p></div><span class="prof-actions">' + acts + '</span></div>' + (waitTxt ? '<p class="hint">' + esc(waitTxt) + '</p>' : "") + '<p class="msg" id="mMsgInline" role="status"></p></section>' +
      '<div class="kpis">' + kpi("blue", I.people, "Staff", lines.length, noPay.length ? noPay.length + " active staff not included" : "Everyone with a salary") +
      kpi("teal", I.brief, "Gross", money(r.gross), "Overtime " + money(r.overtime)) + kpi("purple", I.check, "Net pay", money(r.net), "After staff pension " + money(r.deductions)) +
      kpi("orange", I.shield, "Employer cost", money(r.employer_cost), "Gross plus employer pension") + '</div>' +
      '<section class="dash-card"><h2>Payslips</h2>' + (noPay.length ? '<p class="msg err">No salary set, so not paid in this run: ' + esc(noPay.map(function (s) { return s.name; }).join(", ")) + '. Add it on <a href="#payroll/pay">Pay details</a> and click Recalculate.</p>' : "") +
      (lines.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Staff</th><th>Basic</th><th>Allowances</th><th>Overtime</th><th>Unpaid leave</th>' + (cfg.absence ? '<th>Absences</th>' : "") + '<th>Gross</th><th>Staff pension</th><th>Net pay</th><th></th></tr></thead><tbody>' +
        lines.map(function (l) {
          var s = staffOf(l.user_id);
          return '<tr><td>' + who(s, true) + (l.days_paid < l.days_in_period ? '<span class="th-sub">' + l.days_paid + ' of ' + l.days_in_period + ' days</span>' : "") + '</td><td>' + money(l.basic) + '</td><td class="muted-cell">' + money(l.allowances) + '</td>' +
            '<td>' + (Number(l.overtime_amount) ? money(l.overtime_amount) + ' <span class="th-sub">' + fmtMin(l.overtime_min + l.holiday_min) + '</span>' : '<span class="muted-cell">—</span>') + '</td>' +
            '<td>' + (l.unpaid_days ? '<span class="exp">−' + money(l.unpaid_amount) + '</span> <span class="th-sub">' + l.unpaid_days + ' day' + (l.unpaid_days > 1 ? "s" : "") + '</span>' : '<span class="muted-cell">—</span>') + '</td>' +
            (cfg.absence ? '<td>' + (l.absent_days ? '<span class="exp">−' + money(l.absent_amount) + '</span> <span class="th-sub">' + l.absent_days + ' day' + (l.absent_days > 1 ? "s" : "") + '</span>' : '<span class="muted-cell">—</span>') + '</td>' : "") +
            '<td>' + money(l.gross) + '</td><td class="muted-cell">' + money(l.pension_employee) + '</td><td><strong>' + money(l.net) + '</strong></td>' +
            '<td><button type="button" class="ghost manage-btn" data-slip="' + l.user_id + '">Payslip</button></td></tr>';
        }).join("") + '<tr class="tot-row"><td><strong>Total</strong></td><td>' + money(tot("basic")) + '</td><td>' + money(tot("allowances")) + '</td><td>' + money(tot("overtime_amount")) + '</td><td>−' + money(tot("unpaid_amount")) + '</td>' + (cfg.absence ? '<td>−' + money(tot("absent_amount")) + '</td>' : "") + '<td>' + money(tot("gross")) + '</td><td>' + money(tot("pension_employee")) + '</td><td><strong>' + money(tot("net")) + '</strong></td><td></td></tr>' +
        '</tbody></table></div>' : empty("Nobody to pay in this run. Set salaries on Pay details first.")) + '</section>';
  }
  function slipHtml(r, l) {
    var s = staffOf(l.user_id), row = function (a, b, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : "") + '><td>' + a + '</td><td>' + b + '</td></tr>'; };
    return '<div class="payslip"><div class="slip-head"><div><strong>' + esc(company.name) + '</strong><small>Payslip · ' + esc(fmtRange(r.period_start, r.period_end)) + ' ' + r.period_end.slice(0, 4) + '</small></div><div class="slip-who"><strong>' + esc(s.name) + '</strong><small>' + esc([s.empNo, s.position].filter(Boolean).join(" · ")) + '</small></div></div>' +
      '<table class="slip"><tbody>' + row("Basic salary" + (l.days_paid < l.days_in_period ? " (" + l.days_paid + " of " + l.days_in_period + " days)" : ""), money(l.basic)) +
      (l.allowance_items || []).map(function (a) { return row(esc(a.name) + (a.detail ? '<small class="slip-why">' + esc(a.detail) + '</small>' : ""), Number(a.amount) ? money(a.amount) : "—"); }).join("") +
      (Number(l.overtime_amount) ? row("Overtime " + fmtMin(l.overtime_min) + (l.holiday_min ? " + holiday work " + fmtMin(l.holiday_min) : "") + " (approved timesheets)", money(l.overtime_amount)) : "") +
      (l.unpaid_days ? row("Unpaid leave, " + l.unpaid_days + " day" + (l.unpaid_days > 1 ? "s" : ""), "−" + money(l.unpaid_amount)) : "") +
      (l.absent_days ? row("Unapproved absence, " + l.absent_days + " day" + (l.absent_days > 1 ? "s" : ""), "−" + money(l.absent_amount)) : "") +
      row("<strong>Gross pay</strong>", "<strong>" + money(l.gross) + "</strong>", "sum") + row("Pension (staff)", "−" + money(l.pension_employee)) +
      row("<strong>Net pay</strong>", "<strong>" + money(l.net) + "</strong>", "sum net") + '</tbody></table>' +
      '<p class="hint">Paid by ' + esc(l.pay_method || "bank transfer") + (r.pay_date ? " on " + fmtDate(r.pay_date) : "") + '. Employer pension ' + money(l.pension_employer) + ' is paid on top. Status: ' + esc(r.status) + '.</p></div>';
  }
  // Cursor 2026-10-24: Download PDF uses published payslip layout (company from DB).
  function openSlip(r, l) {
    openModal('<h2>Payslip</h2>' + slipHtml(r, l) + '<div class="modal-actions"><button type="button" class="ghost" data-close>Close</button><button type="button" class="ghost" id="slipPrint">Browser print</button><button type="button" class="save" id="slipPdf">Download PDF</button></div>', true);
    $("slipPrint").addEventListener("click", function () { document.body.classList.add("print-slip"); window.print(); setTimeout(function () { document.body.classList.remove("print-slip"); }, 500); });
    $("slipPdf").addEventListener("click", function () {
      if (!window.VeyoraPdfApi) { alert("PDF engine not loaded. Refresh the page."); return; }
      var s = staffOf(l.user_id);
      var source = window.VeyoraPdfApi.mapPayslip(r, l, s);
      var btn = $("slipPdf");
      btn.disabled = true; btn.textContent = "Generating…";
      window.VeyoraPdfApi.generate({
        companyId: company.id,
        documentType: "payslip",
        source: source,
        sourceId: l.id || (r.id + ":" + l.user_id),
        filename: "payslip-" + (s.empNo || s.name || "staff").replace(/\s+/g, "-") + "-" + r.period_end + ".pdf"
      }).then(function () {
        btn.disabled = false; btn.textContent = "Download PDF";
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = "Download PDF";
        alert(e.message);
      });
    });
  }
  function csvDownload(name, rows) {
    var text = rows.map(function (r) { return r.map(function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
    var url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function runCsv(r) {
    var lines = cache["run:" + r.id] || [];
    csvDownload("payroll-" + r.period_start + ".csv", [["Employee ID", "Name", "Basic", "Allowances", "Overtime minutes", "Overtime", "Unpaid leave days", "Unpaid leave", "Absent days", "Absences", "Gross", "Staff pension", "Employer pension", "Net pay", "Paid by"]].concat(lines.map(function (l) {
      var s = staffOf(l.user_id); return [s.empNo || "", s.name, l.basic, l.allowances, l.overtime_min + l.holiday_min, l.overtime_amount, l.unpaid_days, l.unpaid_amount, l.absent_days, l.absent_amount, l.gross, l.pension_employee, l.pension_employer, l.net, l.pay_method];
    })));
  }
  var WORD_SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  var WORD_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  function intWords(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (n < 20) return WORD_SMALL[n];
    if (n < 100) return WORD_TENS[Math.floor(n / 10)] + (n % 10 ? " " + WORD_SMALL[n % 10] : "");
    if (n < 1000) return WORD_SMALL[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + intWords(n % 100) : "");
    if (n < 1000000) return intWords(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? " " + intWords(n % 1000) : "");
    return intWords(Math.floor(n / 1000000)) + " million" + (n % 1000000 ? " " + intWords(n % 1000000) : "");
  }
  function moneyWords(n, code) {
    var cur = currency(), dec = code === "MVR" ? 2 : cur.dec;
    var f = Math.pow(10, dec);
    var rounded = Math.round((Number(n) || 0) * f) / f;
    var whole = Math.floor(rounded + 1e-8);
    var frac = Math.round((rounded - whole) * f);
    var major = code === "MVR" ? (whole === 1 ? "Rufiyaa" : "Rufiyaa") : code;
    var minor = code === "MVR" ? "laari" : (dec === 2 ? "cents" : "minor units");
    var text = intWords(whole).replace(/^./, function (c) { return c.toUpperCase(); }) + " " + major;
    if (frac) text += " and " + intWords(frac) + " " + minor;
    return text;
  }
  function monthLabel(isoDate) {
    return new Date(isoDate + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }
  function longDate(isoDate) {
    return new Date(isoDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  function debitSaved() {
    var s = setting("8_payroll_debit_letter");
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  }
  function debitRows(r) {
    var lines = cache["run:" + r.id] || [];
    return lines.map(function (l) {
      var s = staffOf(l.user_id);
      var idNo = (s.hrMeta && (s.hrMeta.id_number || s.hrMeta.national_id)) || s.empNo || "";
      return { name: s.name || "Unknown", idNo: idNo, account: s.accountNumber || "", bank: s.bankName || "", method: l.pay_method || "Bank transfer", net: Number(l.net) || 0 };
    }).filter(function (x) { return x.net > 0; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function commonBank(rows) {
    var counts = {};
    rows.forEach(function (x) { var b = (x.bank || "").trim(); if (b) counts[b] = (counts[b] || 0) + 1; });
    var best = "", n = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] > n) { best = k; n = counts[k]; } });
    return best;
  }
  function payrollSigner() {
    var duty = ((setting("8_approvers_and_responsibilities") || {}).duties || {}).payroll || {};
    var uid = (duty.people && duty.people[0]) || duty.backup || "";
    var s = uid && person(uid);
    if (s && s.name) return s;
    s = (model.staff || []).filter(function (p) { return p.role === "owner" && p.active !== false; })[0];
    return s || person(ctx.me) || staffOf(ctx.me);
  }
  function letterFacts(r, credited) {
    var raw = setting("8_payroll_configuration") || {};
    var saved = debitSaved();
    var signer = payrollSigner();
    var bank = raw.salaryBank || commonBank(credited) || saved.bank || "Bank of Maldives";
    return {
      date: r.pay_date || todayIso(),
      role: "Manager",
      unit: "Payments and Settlement Unit",
      bank: bank,
      account: String(raw.salaryAccount || saved.account || "").replace(/\s+/g, ""),
      signName: signer.name && signer.name !== "Unknown" ? signer.name : "",
      signTitle: signer.position || "",
      signPhone: signer.phone || company.phone || ""
    };
  }
  function openDebitLetter(r) {
    var rows = debitRows(r);
    var bankRows = rows.filter(function (x) { return x.method === "Bank transfer"; });
    var other = rows.filter(function (x) { return x.method !== "Bank transfer"; });
    var missing = bankRows.filter(function (x) { return !x.account; });
    var credited = bankRows.filter(function (x) { return x.account; });
    if (!bankRows.length) { alert("Nobody on this run is paid by bank transfer, so there is no debit instruction to send."); return; }
    var facts = letterFacts(r, credited);
    var code = currency().code;
    var headBits = [company.address, [company.phone, company.email].filter(Boolean).join(" · "), company.registration_no ? "Reg. " + company.registration_no : ""].filter(Boolean);
    openModal('<h2>Debit instruction</h2><p class="note">Filled from the company profile, Payroll settings, the payroll approver, and this pay run.</p>' +
      (missing.length ? '<p class="msg err">No salary account, so left off the letter: ' + esc(missing.map(function (x) { return x.name; }).join(", ")) + '.</p>' : "") +
      (other.length ? '<p class="hint">Paid in cash or by cheque, so not on this letter: ' + esc(other.map(function (x) { return x.name; }).join(", ")) + '.</p>' : "") +
      (facts.account ? "" : '<div class="fld"><label for="dlAcct">Company account to debit</label><input id="dlAcct" maxlength="34" inputmode="numeric" placeholder="13 digits for Bank of Maldives" value=""><small class="hint">Not in Payroll settings yet. It is saved there when you print.</small></div>') +
      '<p class="msg" id="mMsg" role="status"></p><div id="debitPrint"></div>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Close</button><button type="button" class="ghost" id="dlCsv">Download list</button><button type="button" class="save" id="dlPrint">Print letter</button></div>', true);
    function accountNow() {
      var el = $("dlAcct");
      return el ? el.value.replace(/\s+/g, "") : facts.account;
    }
    function paint() {
      var account = accountNow();
      var total = credited.reduce(function (t, x) { return t + x.net; }, 0);
      var words = moneyWords(total, code);
      $("debitPrint").innerHTML = '<article class="debit-letter"><p class="dl-head">' + esc(company.name) + '</p>' +
        (headBits.length ? '<p class="dl-sub">' + headBits.map(esc).join("<br>") + '</p>' : "") +
        '<p class="dl-date">' + esc(longDate(facts.date)) + '</p>' +
        '<p class="dl-to"><strong>' + esc(facts.role) + '</strong><br>' + esc(facts.unit) + '<br>' + esc(facts.bank) + '</p>' +
        '<p>Dear Sir/Madam,</p>' +
        '<p><strong>Subject: Staff salary for the month of ' + esc(monthLabel(r.period_end)) + '</strong></p>' +
        '<p>We have sent our staff payroll list together with this letter which contains their names, account numbers and amounts to be credited.</p>' +
        '<p>Kindly arrange to credit the respective amounts to their accounts and debit our account number <strong>' + esc(account || "_______________") + '</strong> for the total amount <strong>' + esc(money(total)) + '</strong> (' + esc(words) + ') and the relevant bank charges.</p>' +
        '<p class="dl-regards">Kind regards,</p>' +
        '<p class="dl-sign"><span class="dl-line"></span><strong>' + esc(facts.signName || "Name") + '</strong><br>' + esc(facts.signTitle || "Designation") + (facts.signPhone ? '<br>' + esc(facts.signPhone) : "") + '<br><span class="dl-cap">Authorized signature</span></p></article>' +
        '<article class="debit-list"><p class="dl-head">' + esc(company.name) + '</p><h3>Staff payroll list</h3><p class="note">Salary for ' + esc(monthLabel(r.period_end)) + ' · ' + esc(fmtRange(r.period_start, r.period_end)) + '</p>' +
        '<table><thead><tr><th>Name</th><th>ID</th><th>Account number</th><th>Amount</th></tr></thead><tbody>' +
        credited.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.idNo || "—") + '</td><td>' + esc(x.account) + '</td><td>' + esc(money(x.net)) + '</td></tr>'; }).join("") +
        '<tr class="tot-row"><td colspan="3"><strong>Total</strong></td><td><strong>' + esc(money(total)) + '</strong></td></tr></tbody></table></article>';
    }
    paint();
    if ($("dlAcct")) $("dlAcct").addEventListener("input", paint);
    function remember(account) {
      var raw = setting("8_payroll_configuration") || {};
      if (String(raw.salaryAccount || "").replace(/\s+/g, "") === account && (raw.salaryBank || facts.bank) === facts.bank) return Promise.resolve();
      var cfg = payCfg();
      cfg.salaryBank = facts.bank;
      cfg.salaryAccount = account;
      return rpc("set_company_setting", { p_company: company.id, p_key: "8_payroll_configuration", p_value: cfg }).then(function () {
        company.settings = company.settings || {};
        company.settings["8_payroll_configuration"] = cfg;
      });
    }
    $("dlPrint").addEventListener("click", function () {
      var account = accountNow();
      if (!/^[A-Za-z0-9]{4,34}$/.test(account)) { say("Add the company account number under Payroll settings, or type it here.", "err"); return; }
      if (facts.bank === "Bank of Maldives" && !/^\d{13}$/.test(account)) { say("A Bank of Maldives account number is 13 digits.", "err"); return; }
      if (!facts.signName || facts.signName.length < 2) { say("Name a payroll approver under Employees → Settings → Approvers, or make sure the owner has a name.", "err"); return; }
      if (!credited.length) { say("Nobody on this run has both a bank transfer and an account number.", "err"); return; }
      say("Saving…");
      remember(account).then(function () {
        facts.account = account;
        say("");
        document.body.classList.add("print-letter");
        window.print();
        setTimeout(function () { document.body.classList.remove("print-letter"); }, 500);
      }).catch(function (e) { say(e.message, "err"); });
    });
    $("dlCsv").addEventListener("click", function () {
      if (!credited.length) { say("Nobody on this run has both a bank transfer and an account number.", "err"); return; }
      csvDownload("payroll-list-" + r.period_end + ".csv", [["Name", "ID", "Account number", "Amount"]].concat(credited.map(function (x) {
        return [x.name, x.idNo, x.account, x.net.toFixed(currency().dec)];
      })).concat([["Total", "", "", credited.reduce(function (t, x) { return t + x.net; }, 0).toFixed(currency().dec)]]));
    });
  }
  function payDone(id) { cache.pay = null; if (id) delete cache["run:" + id]; loadPay(true); }
  function bindPayroll(rt) {
    if ($("prNew")) $("prNew").addEventListener("click", openNewRun);
    on("[data-payedit]", function (b) { openPayEdit(b.dataset.payedit); });
    if (rt.id === "rules") bindRules();
    if (rt.id !== "run" || !cache.pay) return;
    var id = rt.sub, r = cache.pay.runs.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var act = function (btn, name, args, ask) {
      if (!$(btn)) return;
      $(btn).addEventListener("click", function () {
        if (ask && !confirm(ask)) return;
        sayInline("Working…"); rpc(name, args).then(function () { if (name === "delete_payroll_run") { cache.pay = null; location.hash = "#payroll"; loadPay(true); } else payDone(id); }).catch(function (e) { sayInline(e.message, "err"); });
      });
    };
    act("prCalc", "calc_payroll_run", { p_run: id });
    act("prApprove", "approve_payroll_run", { p_run: id }, "Approve this pay run? Overtime in it is marked as paid and staff can see their payslips.");
    act("prPaid", "mark_payroll_paid", { p_run: id }, "Mark this run as paid? It can't be reopened after that.");
    act("prDel", "delete_payroll_run", { p_run: id }, "Delete this draft pay run?");
    if ($("prReopen")) $("prReopen").addEventListener("click", function () {
      var why = prompt("Why reopen this pay run? Its overtime goes back to not paid until it is approved again."); if (!why) return;
      rpc("reopen_payroll_run", { p_run: id, p_reason: why }).then(function () { payDone(id); }).catch(function (e) { sayInline(e.message, "err"); });
    });
    if ($("prCsv")) $("prCsv").addEventListener("click", function () { runCsv(r); });
    if ($("prLetter")) $("prLetter").addEventListener("click", function () { openDebitLetter(r); });
    on("[data-slip]", function (b) { var l = (cache["run:" + id] || []).filter(function (x) { return x.user_id === b.dataset.slip; })[0]; if (l) openSlip(r, l); });
  }
  // Monthly pay period from Payroll Configuration: 1 to end of month, 16 to 15, or any start and end day.
  function ordinal(n) {
    var v = Math.abs(Number(n)) || 0, j = v % 10, k = v % 100;
    return v + (j === 1 && k !== 11 ? "st" : j === 2 && k !== 12 ? "nd" : j === 3 && k !== 13 ? "rd" : "th");
  }
  function clampDom(y, m, day) {
    return Math.min(Math.max(1, day), new Date(y, m + 1, 0).getDate());
  }
  function isoDom(y, m, day) { return iso(new Date(y, m, clampDom(y, m, day))); }
  function payRange(cfg) {
    var from = Math.min(28, Math.max(1, Number(cfg.fromDay) || 1));
    var raw = cfg.toDay == null || cfg.toDay === "" ? "End of the month" : String(cfg.toDay);
    var eom = raw === "End of the month" || isNaN(Number(raw));
    return { from: from, to: eom ? null : Math.min(28, Math.max(1, Number(raw))), eom: eom };
  }
  function endForStart(startIso, range) {
    var s = new Date(startIso + "T00:00:00"), y = s.getFullYear(), m = s.getMonth();
    if (range.eom) return iso(new Date(y, m + 1, 0));
    if (range.to > range.from) return isoDom(y, m, range.to);
    if (range.to === range.from) {
      var boundary = new Date(y, m + 1, clampDom(y, m + 1, range.to));
      boundary.setDate(boundary.getDate() - 1);
      return iso(boundary);
    }
    return isoDom(y, m + 1, range.to);
  }
  function periodAround(dayIso, range) {
    var t = new Date(dayIso + "T00:00:00"), y = t.getFullYear(), m = t.getMonth(), i, start, end, hit, next;
    for (i = -1; i <= 1; i++) {
      start = isoDom(y, m + i, range.from);
      end = endForStart(start, range);
      if (dayIso >= start && dayIso <= end) hit = { start: start, end: end };
      if (!next && start >= dayIso) next = { start: start, end: end };
    }
    return hit || next || { start: isoDom(y, m, range.from), end: endForStart(isoDom(y, m, range.from), range) };
  }
  function paySpanLabel(cfg) {
    var cyc = cfg.cycle || "Monthly";
    if (cyc !== "Monthly") return cyc;
    var r = payRange(cfg), from = ordinal(r.from);
    if (r.eom) return r.from === 1 ? "1st to the end of the month" : from + " to the end of the month";
    if (r.to === r.from) return from + " to " + from;
    if (r.to < r.from) return from + " to the " + ordinal(r.to) + " of the next month";
    return from + " to the " + ordinal(r.to);
  }
  function payOn(endIso, cfg, startIso) {
    var day = Number(cfg.day) || 25, e = new Date(endIso + "T00:00:00");
    var pay = isoDom(e.getFullYear(), e.getMonth(), day);
    if (pay < startIso) pay = isoDom(e.getFullYear(), e.getMonth() + 1, day);
    if (pay < startIso) pay = endIso;
    return pay;
  }
  // The next period after the last run, following the pay period in Payroll Configuration.
  function nextPeriod() {
    var cfg = payCfg(), cyc = cfg.cycle || "Monthly", last = cache.pay && cache.pay.runs[0], start, end;
    if (cyc !== "Monthly") {
      start = last ? addDaysIso(1, last.period_end) : weekStartOf(todayIso());
      end = addDaysIso(cyc === "Weekly" ? 6 : 13, start);
      return { start: start, end: end, pay: end };
    }
    var range = payRange(cfg), covered;
    if (last) {
      start = addDaysIso(1, last.period_end);
      covered = periodAround(start, range);
      if (covered.start < start) end = covered.end >= start ? covered.end : endForStart(start, range);
      else { start = covered.start; end = covered.end; }
    } else {
      covered = periodAround(todayIso(), range);
      start = covered.start;
      end = covered.end;
    }
    return { start: start, end: end, pay: payOn(end, cfg, start) };
  }
  function openNewRun() {
    var n = nextPeriod();
    openModal('<h2>New pay run</h2><p class="note">' + esc(paySpanLabel(payCfg())) + ', from Payroll settings. These dates follow that range. Pay is worked out straight away as a draft; nothing is final until it is approved.</p>' +
      '<div class="cards"><div class="fld"><label for="nStart">Period starts</label><input id="nStart" type="date" value="' + n.start + '"></div><div class="fld"><label for="nEnd">Period ends</label><input id="nEnd" type="date" value="' + n.end + '"></div>' +
      '<div class="fld"><label for="nPay">Pay date</label><input id="nPay" type="date" value="' + n.pay + '"></div></div>' +
      '<div class="fld"><label for="nNote">Note (optional)</label><input id="nNote" maxlength="200"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="nGo">Work out pay</button></div>', true);
    $("nGo").addEventListener("click", function () {
      say("Working…");
      rpc("create_payroll_run", { p_company: company.id, p_start: $("nStart").value, p_end: $("nEnd").value, p_pay_date: $("nPay").value || null, p_note: $("nNote").value.trim() || null })
        .then(function (id) { closeModal(); cache.pay = null; location.hash = "#payroll/run/" + id; loadPay(true); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  function openPayEdit(uid) {
    var s = person(uid), x = (cache.pay && cache.pay.pays[uid]) || (cache[uid] && cache[uid].pay && cache[uid].pay.mine) || { basic: 0, allowances: [], pension: true, pay_method: "Bank transfer" };
    openModal('<h2>Pay details</h2><p class="note">' + esc(s.name) + ' · amounts are per month in ' + esc(currency().code) + '</p>' +
      '<div class="cards"><div class="fld"><label for="pBasic">Basic salary</label><input id="pBasic" type="number" min="0" step="0.01" value="' + esc(x.basic) + '"></div>' +
      '<div class="fld"><label for="pMethod">Paid by</label><select id="pMethod">' + options(["Bank transfer", "Cash", "Cheque"], x.pay_method) + '</select></div></div>' +
      '<div class="fld"><label for="pAllow">Allowances</label><textarea id="pAllow" rows="4" placeholder="One per line, e.g. Food allowance 1000">' + esc((x.allowances || []).map(function (a) { return a.name + " " + a.amount; }).join("\n")) + '</textarea><small class="hint">Name, then the monthly amount.</small></div>' +
      '<label class="chk"><input type="checkbox" id="pPension"' + (x.pension ? " checked" : "") + '> In the pension scheme (' + (Number(payCfg().pensionEmployee) || 0) + '% from pay, ' + (Number(payCfg().pension) || 0) + '% from the company)</label>' +
      '<p class="msg" id="mMsg" role="status"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="pGo">Save</button></div>', true);
    $("pGo").addEventListener("click", function () {
      var bad = null, allow = $("pAllow").value.split(/\n/).map(function (t) { return t.trim(); }).filter(Boolean).map(function (t) {
        var m = t.match(/^(.*?)[\s:=]+([\d,]+(?:\.\d+)?)$/); if (!m) { bad = t; return null; } return { name: m[1].trim(), amount: Number(m[2].replace(/,/g, "")) };
      });
      if (bad) { say('Can\'t read "' + bad + '". Write the name, then the amount.', "err"); return; }
      rpc("set_member_pay", { p_company: company.id, p_user: uid, p_basic: Number($("pBasic").value) || 0, p_allowances: allow, p_pension: $("pPension").checked, p_method: $("pMethod").value })
        .then(function () { closeModal(); delete cache[uid]; payDone(); }).catch(function (e) { say(e.message, "err"); });
    });
  }
  // Profile "Pay" tab: pay details and approved payslips.
  function payTab(uid, c) {
    var s = person(uid), x = c.pay && c.pay.mine;
    if (!c.pay) return '<section class="ep-card ep-panel"><p class="msg">Loading…</p></section>';
    return '<section class="ep-card ep-panel"><div class="card-head"><h2>Pay</h2>' + (ctx.canHr ? '<button type="button" class="ghost" id="pPayEdit">Edit pay details</button>' : "") + '</div>' +
      (x ? kv([["Basic salary (monthly)", money(x.basic)], ["Allowances", x.allowances.length ? esc(x.allowances.map(function (a) { return a.name + " " + money(a.amount); }).join(" · ")) : ""], ["Pension scheme", x.pension ? "Yes" : "No"], ["Paid by", esc(x.pay_method)]])
        : '<p class="note">No pay details yet.' + (ctx.canHr ? " Add them with Edit pay details." : " Ask HR if this looks wrong.") + '</p>') +
      '<h3>Payslips</h3>' + (c.pay.slips.length ? '<ul class="rows">' + c.pay.slips.map(function (sl, i) {
        return '<li class="row"><span class="grow"><strong>' + esc(fmtRange(sl.run.period_start, sl.run.period_end)) + ' ' + sl.run.period_end.slice(0, 4) + '</strong><small>Net ' + money(sl.net) + (sl.run.pay_date ? (sl.run.status === "Paid" ? " · paid " : " · pay date ") + fmtDate(sl.run.pay_date) : "") + '</small></span>' +
          chip(sl.run.status, "st-pr-" + slug(sl.run.status)) + '<button type="button" class="ghost" data-myslip="' + i + '">View</button></li>';
      }).join("") + '</ul>' : empty("No payslips yet. They show here once a pay run is approved.")) + '<p class="msg" id="mMsgInline" role="status"></p></section>';
    void s;
  }

  /* ---------- Allowance rules (allowance_apply() in the database follows them; stored in 8_allowance_rules) ---------- */
  var BASES = [
    ["Fixed per month", "Every month", "The same amount each month", '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>'],
    ["% of basic", "% of basic", "A share of basic salary", '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'],
    ["Per day worked", "Per day worked", "Amount × days clocked in", '<path d="M4 6h16v14H4zM4 10h16"/><path d="m9 15 2 2 4-4"/>'],
    ["Per shift worked", "Per shift", "Amount × chosen shifts worked", '<path d="M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4"/>'],
    ["Per hour worked", "Per hour", "Amount × hours worked", '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'],
    ["Per overtime hour", "Per overtime hour", "Amount × approved overtime hours", '<circle cx="11" cy="13" r="7"/><path d="M11 10v3l2 1M18 3v4M16 5h4"/>']
  ];
  var METRICS = [["days_worked", "Days worked", "days"], ["absences", "Unapproved absences", "days"], ["late_days", "Late days", "days"], ["missed_punches", "Missed punches", "days"],
    ["hours_worked", "Hours worked", "hours"], ["overtime_hours", "Overtime hours (approved)", "hours"], ["service_years", "Years of service", "years"], ["leave_days", "Leave days (approved)", "days"],
    ["basic", "Basic salary", "MVR"], ["shifts_worked", "Shifts worked", "shifts"]];
  var OPS = [[">=", "at least"], [">", "more than"], ["<=", "at most"], ["<", "less than"], ["=", "exactly"], ["!=", "anything but"]];
  var GROUPS = ["Captain", "Deck", "Engineering", "Shore"];
  var QUICK_CONDS = [["No unapproved absences", { metric: "absences", op: "=", value: 0 }], ["At most 2 late days", { metric: "late_days", op: "<=", value: 2 }],
    ["Worked at least 20 days", { metric: "days_worked", op: ">=", value: 20 }], ["1 year of service or more", { metric: "service_years", op: ">=", value: 1 }], ["No missed punches", { metric: "missed_punches", op: "=", value: 0 }]];
  var RULE_TEMPLATES = [
    { name: "Food allowance", basis: "Per day worked", amount: 50, who: {}, conditions: [], match: "all", blurb: "A daily food rate for every day someone clocks in." },
    { name: "Night shift allowance", basis: "Per shift worked", amount: 150, shifts: "N", who: { groups: ["Captain", "Deck", "Engineering"] }, conditions: [], match: "all", cap: 3000, blurb: "Extra for each night shift worked by vessel crew, up to a monthly limit." },
    { name: "Attendance bonus", basis: "Fixed per month", amount: 1000, who: {}, match: "all", conditions: [{ metric: "absences", op: "=", value: 0 }, { metric: "late_days", op: "<=", value: 2 }], blurb: "A monthly reward for no absences and few late days." },
    { name: "Long service allowance", basis: "Fixed per month", amount: 0, who: {}, match: "all", conditions: [], tiers: { metric: "service_years", steps: [{ from: 2, amount: 500 }, { from: 5, amount: 1000 }, { from: 10, amount: 2000 }] }, blurb: "Grows with years of service, in steps." },
    { name: "Sea allowance", basis: "% of basic", amount: 10, who: { groups: ["Captain", "Deck", "Engineering"] }, match: "all", conditions: [{ metric: "days_worked", op: ">=", value: 15 }], per_absence: 100, blurb: "A share of basic for crew at sea, less for each absence." }
  ];
  function rules() { var r = setting("8_allowance_rules"); return Array.isArray(r) ? r : []; }
  function metricOf(k) { return METRICS.filter(function (x) { return x[0] === k; })[0] || [k, k, ""]; }
  function metricName(k) { return metricOf(k)[1].toLowerCase(); }
  function opName(o) { var m = OPS.filter(function (x) { return x[0] === o; })[0]; return m ? m[1] : o; }
  function baseOf(b) { return BASES.filter(function (x) { return x[0] === (b || "Fixed per month"); })[0] || BASES[0]; }
  function num(v) { return Number(v) || 0; }
  function hasTiers(ru) { return !!(ru.tiers && (ru.tiers.steps || []).length); }
  function whoList(ru) { var w = ru.who || {}; return [].concat(w.groups || [], w.titles || [], w.depts || [], w.types || []); }
  // One plain sentence per rule, so HR can read what the app will do.
  function ruleText(ru) {
    var parts = [], c = currency().code, b = ru.basis || "Fixed per month";
    var amt = hasTiers(ru) ? "an amount set by " + metricName(ru.tiers.metric) + " (" + ru.tiers.steps.map(function (s) { return num(s.from) + "+ → " + num(s.amount); }).join(", ") + ")" : b === "% of basic" ? num(ru.amount) + "%" : c + " " + num(ru.amount).toLocaleString("en-US");
    parts.push("Pays " + (b === "% of basic" ? amt + (hasTiers(ru) ? " % of basic salary" : " of basic salary") :
      amt + " " + { "Fixed per month": "a month" + (ru.prorate === false ? "" : " (less for part of a period)"), "Per day worked": "per day worked", "Per shift worked": "per " + (ru.shifts ? String(ru.shifts).toUpperCase() : "any") + " shift worked", "Per hour worked": "per hour worked", "Per overtime hour": "per approved overtime hour" }[b]));
    var w = whoList(ru);
    parts.push(w.length ? "to " + w.join(", ") : "to everyone");
    var conds = (ru.conditions || []).map(function (x) { return metricName(x.metric) + " " + opName(x.op) + " " + num(x.value); });
    if (conds.length) parts.push("only when " + conds.join(ru.match === "any" ? " or " : " and "));
    if (num(ru.per_absence)) parts.push(c + " " + num(ru.per_absence) + " less per unapproved absence");
    if (num(ru.min)) parts.push("at least " + c + " " + num(ru.min));
    if (num(ru.cap)) parts.push("at most " + c + " " + num(ru.cap));
    return parts.join(", ") + ".";
  }
  function monthBounds(m) { var d = new Date(m + "-01T00:00:00"); return { from: m + "-01", to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) }; }
  function ruMonth() { return cache.ruMonth || todayIso().slice(0, 7); }
  // What the given rules would pay everyone on payroll in a month (nothing saved). Results come back per person.
  function previewAll(list, month, done) {
    var b = monthBounds(month);
    rpc("preview_allowances_all", { p_company: company.id, p_from: b.from, p_to: b.to, p_rules: list }).then(function (rows) { done(null, rows || []); }).catch(function (e) { done(e.message); });
  }
  // Per-rule impact for the cards: people paid and total, keyed by rule name.
  function loadImpact() {
    var key = ruMonth() + "|" + JSON.stringify(rules());
    if (cache.ruImpactKey === key || !rules().length) return;
    cache.ruImpactKey = key; cache.ruImpact = null;
    previewAll(null, ruMonth(), function (err, rows) {
      if (cache.ruImpactKey !== key) return;
      var by = {}; (rows || []).forEach(function (p) { (p.items || []).forEach(function (it) { var x = by[it.name] = by[it.name] || { paid: 0, missed: 0, total: 0 }; if (num(it.amount) > 0) { x.paid++; x.total += num(it.amount); } else x.missed++; }); });
      cache.ruImpact = err ? { error: err } : { by: by, people: (rows || []).length, total: (rows || []).reduce(function (t, p) { return t + num(p.total); }, 0) };
      var rt = route(); if (rt.view === "payroll" && rt.id === "rules") render();
    });
  }
  function rulesView() {
    var list = rules(), imp = cache.ruImpact, on = list.filter(function (r) { return r.active !== false; }).length, b = monthBounds(ruMonth());
    loadImpact();
    var head = '<section class="dash-card ru-hero"><div class="card-head"><div><h2>Allowance rules</h2><p class="note">Tell the app how allowances work and it follows the rules in every pay run, on top of each person\'s own allowances. Days, hours and absences are counted the same way as Timesheets.</p></div>' +
      (ctx.canHr ? '<button type="button" class="save" id="ruAdd">' + icon(I.plus) + ' New rule</button>' : "") + '</div>' +
      '<div class="ru-stats"><div><small>Rules on</small><strong>' + on + '<span>/' + list.length + '</span></strong></div>' +
      '<div><small>Paid by rules in ' + esc(b.label) + '</small><strong>' + (imp && imp.by ? money(imp.total) : list.length ? "…" : money(0)) + '</strong></div>' +
      '<div><small>People on payroll</small><strong>' + (imp && imp.by ? imp.people : "–") + '</strong></div>' +
      '<label class="ru-month">Show figures for <input id="ruMonthPick" type="month" value="' + esc(ruMonth()) + '"></label></div></section>';
    if (!list.length) return head + templateGallery(true);
    return head + '<div class="ru-grid">' + list.map(function (ru, i) {
      var base = baseOf(ru.basis), x = imp && imp.by ? imp.by[ru.name] : null, w = whoList(ru), off = ru.active === false;
      var chips = [w.length ? w.join(", ") : "Everyone"].concat((ru.conditions || []).length ? [(ru.conditions.length) + " condition" + (ru.conditions.length > 1 ? "s" : "")] : [], hasTiers(ru) ? ["Tiers"] : [], num(ru.per_absence) ? ["Cut per absence"] : [], num(ru.cap) ? ["Max " + num(ru.cap)] : []);
      return '<article class="ru-card' + (off ? " off" : "") + '"><div class="ru-top"><span class="ru-ic">' + icon(base[3]) + '</span><div class="grow"><strong>' + esc(ru.name) + '</strong><small>' + esc(base[1]) + '</small></div>' +
        (ctx.canHr ? '<button type="button" class="sw" role="switch" aria-checked="' + !off + '" aria-label="Rule on" data-rutoggle="' + i + '"></button>' : "") + '</div>' +
        '<p class="ru-sentence">' + esc(ruleText(ru)) + '</p><div class="ru-chips">' + chips.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join("") + '</div>' +
        '<div class="ru-impact">' + (off ? "Off: not used in pay runs" : !imp ? "Working out " + esc(b.label) + "…" : imp.error ? esc(imp.error) : x ? '<strong>' + money(x.total) + '</strong> to ' + x.paid + ' ' + (x.paid === 1 ? "person" : "people") + (x.missed ? ' · <span class="muted-cell">' + x.missed + ' not paid (conditions)</span>' : "") : '<span class="muted-cell">Pays nobody in ' + esc(b.label) + '</span>') + '</div>' +
        (ctx.canHr ? '<div class="ru-actions"><button type="button" class="ghost manage-btn" data-ruedit="' + i + '">Edit</button><button type="button" class="ghost manage-btn" data-rudup="' + i + '">Duplicate</button>' +
          '<button type="button" class="ghost manage-btn" data-ruup="' + i + '"' + (i ? "" : " disabled") + ' aria-label="Move earlier">↑</button><button type="button" class="ghost danger manage-btn" data-rudel="' + i + '">Remove</button></div>' : "") + '</article>';
    }).join("") + '</div><p class="msg" id="mMsgInline" role="status"></p>' + templateGallery(false);
  }
  function templateGallery(first) {
    if (!ctx.canHr) return "";
    return '<section class="dash-card"><h2>' + (first ? "Start with an example" : "More ideas") + '</h2><p class="note">' + (first ? "No rules yet. Pick one to open it in the editor, change anything, then save." : "Common allowances in ferry and speedboat companies. Each opens in the editor first.") + '</p>' +
      '<div class="ru-tpls">' + RULE_TEMPLATES.map(function (t, i) {
        return '<button type="button" class="ru-tpl" data-rutpl="' + i + '"><span class="ru-ic">' + icon(baseOf(t.basis)[3]) + '</span><strong>' + esc(t.name) + '</strong><small>' + esc(t.blurb) + '</small><span class="ru-use">Use this →</span></button>';
      }).join("") + '<button type="button" class="ru-tpl blank" data-rutpl="-1"><span class="ru-ic">' + icon(I.plus) + '</span><strong>Blank rule</strong><small>Start from nothing.</small><span class="ru-use">Start →</span></button></div></section>';
  }
  function saveRules(list) {
    return rpc("set_company_setting", { p_company: company.id, p_key: "8_allowance_rules", p_value: list }).then(function () { company.settings = company.settings || {}; company.settings["8_allowance_rules"] = list; cache.ruImpactKey = null; render(); });
  }
  function bindRules() {
    var copy = function (x) { return JSON.parse(JSON.stringify(x)); };
    if ($("ruAdd")) $("ruAdd").addEventListener("click", function () { openRule(-1, null); });
    if ($("ruMonthPick")) $("ruMonthPick").addEventListener("change", function () { cache.ruMonth = this.value || null; render(); });
    on("[data-rutpl]", function (b) { var i = Number(b.dataset.rutpl), t = i > -1 ? copy(RULE_TEMPLATES[i]) : null; if (t) delete t.blurb; openRule(-1, t); });
    on("[data-ruedit]", function (b) { openRule(Number(b.dataset.ruedit)); });
    on("[data-rudup]", function (b) { var l = rules().slice(), i = Number(b.dataset.rudup), d = copy(l[i]); d.name = d.name + " (copy)"; d.active = false; l.splice(i + 1, 0, d); saveRules(l).catch(function (e) { sayInline(e.message, "err"); }); });
    on("[data-rutoggle]", function (b) { var l = rules().slice(), i = Number(b.dataset.rutoggle); l[i] = Object.assign({}, l[i], { active: l[i].active === false }); saveRules(l).catch(function (e) { sayInline(e.message, "err"); }); });
    on("[data-rudel]", function (b) { var l = rules().slice(), i = Number(b.dataset.rudel); if (!confirm('Remove the rule "' + l[i].name + '"? Pay runs already worked out keep their amounts until recalculated.')) return; l.splice(i, 1); saveRules(l).catch(function (e) { sayInline(e.message, "err"); }); });
    on("[data-ruup]", function (b) { var l = rules().slice(), i = Number(b.dataset.ruup); if (!i) return; var x = l[i]; l[i] = l[i - 1]; l[i - 1] = x; saveRules(l).catch(function (e) { sayInline(e.message, "err"); }); });
  }
  // People a rule's "who" matches (client side, for the live count).
  function whoMatches(ru) {
    var w = ru.who || {}, has = function (k, v) { return !(w[k] || []).length || w[k].indexOf(v) > -1; };
    return activeStaff().filter(function (s) { return has("groups", s.group) && has("titles", s.position) && has("depts", s.dept) && has("types", s.employment); });
  }
  function openRule(idx, start) {
    var ru = start || (idx > -1 ? JSON.parse(JSON.stringify(rules()[idx])) : { name: "", basis: "Fixed per month", amount: 0, who: {}, conditions: [], match: "all", active: true });
    ru.who = ru.who || {}; ru.conditions = ru.conditions || []; if (ru.active == null) ru.active = true;
    var titles = model.titles.map(function (t) { return t.title; }), depts = model.depts.map(function (d) { return d.name; }), types = empTypes(), timer = null, seq = 0, first = true;
    function pills(key, list) {
      var cur = ru.who[key] || [];
      return list.length ? '<div class="ru-pills">' + list.map(function (v) { return '<button type="button" class="ru-pill' + (cur.indexOf(v) > -1 ? " on" : "") + '" data-who="' + key + '" data-v="' + esc(v) + '" aria-pressed="' + (cur.indexOf(v) > -1) + '">' + esc(v) + '</button>'; }).join("") + '</div>' : '<p class="hint">None set up yet.</p>';
    }
    function step(n, title, body, hint) { return '<section class="ru-step"><header><span class="ru-n">' + n + '</span><div><h3>' + title + '</h3>' + (hint ? '<p class="hint">' + hint + '</p>' : "") + '</div></header>' + body + '</section>'; }
    function unit(k) { var u = metricOf(k)[2]; return u === "MVR" ? currency().code : u; }
    function draw() {
      var b = ru.basis || "Fixed per month", tiers = hasTiers(ru) || ru._tiersOn, pct = b === "% of basic", cur = currency().code;
      var s1 = '<div class="fld"><label for="rName">Name on the payslip</label><input id="rName" maxlength="60" placeholder="e.g. Food allowance" value="' + esc(ru.name) + '"></div>' +
        '<div class="ru-bases" role="radiogroup" aria-label="How it is counted">' + BASES.map(function (x) {
          return '<button type="button" role="radio" class="ru-base' + (x[0] === b ? " on" : "") + '" aria-checked="' + (x[0] === b) + '" data-basis="' + esc(x[0]) + '"><span class="ru-ic">' + icon(x[3]) + '</span><strong>' + esc(x[1]) + '</strong><small>' + esc(x[2]) + '</small></button>';
        }).join("") + '</div>' +
        (b === "Per shift worked" || ru.conditions.some(function (c) { return c.metric === "shifts_worked"; }) || (tiers && ru.tiers && ru.tiers.metric === "shifts_worked") ?
          '<div class="fld"><label for="rShifts">Which shifts</label><input id="rShifts" maxlength="40" placeholder="Shift codes, e.g. N or N,E" value="' + esc(ru.shifts || "") + '"><small class="hint">Codes from Shift Definitions: ' + esc(shiftDefs().map(function (d) { return String(d.code || d.name.charAt(0)).toUpperCase(); }).filter(Boolean).join(", ") + ", TRN") + '. Empty = any shift.</small></div>' : "");
      var n = whoMatches(ru).length;
      var s2 = '<div class="ru-who"><div><strong>Crew group</strong>' + pills("groups", GROUPS) + '</div><div><strong>Designation</strong>' + pills("titles", titles) + '</div>' +
        '<div><strong>Department</strong>' + pills("depts", depts) + '</div><div><strong>Employment type</strong>' + pills("types", types) + '</div></div>' +
        '<p class="ru-count">' + icon(I.people) + ' Matches <strong>' + n + '</strong> of ' + activeStaff().length + ' active staff' + (whoList(ru).length ? "" : " (everyone)") + '</p>';
      var s3 = '<div class="ru-match"><span>Pay it when</span><select id="rMatch">' + options([["all", "all of these are true"], ["any", "any of these is true"]], ru.match || "all") + '</select></div>' +
        (ru.conditions.length ? ru.conditions.map(function (c, i) {
          return '<div class="ru-cond" data-cond="' + i + '"><select data-k="metric" aria-label="Measure">' + options(METRICS.map(function (m) { return [m[0], m[1]]; }), c.metric) + '</select><select data-k="op" aria-label="Compare">' + options(OPS, c.op || ">=") + '</select>' +
            '<span class="ru-num"><input data-k="value" type="number" step="any" value="' + num(c.value) + '" aria-label="Value"><em>' + esc(unit(c.metric)) + '</em></span><button type="button" class="ru-x" data-conddel="' + i + '" aria-label="Remove condition">×</button></div>';
        }).join("") : '<p class="hint">No conditions, so it is paid whenever the person matches step 2.</p>') +
        '<div class="ru-quick"><button type="button" class="ghost manage-btn" id="rCondAdd">' + icon(I.plus) + ' Add condition</button>' + QUICK_CONDS.map(function (q, i) { return '<button type="button" class="ru-qc" data-quick="' + i + '">+ ' + esc(q[0]) + '</button>'; }).join("") + '</div>';
      var s4 = '<div class="ru-amount"><label for="rAmount">' + (pct ? "Percent of basic salary" : "Amount") + '</label><span class="ru-money' + (tiers ? " dis" : "") + '"><em>' + (pct ? "%" : esc(cur)) + '</em><input id="rAmount" type="number" min="0" step="any" value="' + num(ru.amount) + '"' + (tiers ? " disabled" : "") + '></span>' +
        '<small class="hint">' + (tiers ? "Set by the tiers below." : esc(baseOf(b)[2]) + ".") + '</small></div>' +
        '<label class="chk ru-tierchk"><input type="checkbox" id="rTiersOn"' + (tiers ? " checked" : "") + '> Change the amount in steps, based on <select id="rTierMetric"' + (tiers ? "" : " disabled") + '>' + options(METRICS.map(function (m) { return [m[0], m[1].toLowerCase()]; }), ru.tiers ? ru.tiers.metric : "service_years") + '</select></label>' +
        (tiers ? '<div class="ru-ladder">' + (ru.tiers.steps || []).map(function (st, i, all) {
          var max = Math.max.apply(null, all.map(function (z) { return num(z.amount); }).concat([1]));
          return '<div class="ru-rung" data-step="' + i + '"><span>From</span><span class="ru-num"><input data-k="from" type="number" step="any" value="' + num(st.from) + '" aria-label="From"><em>' + esc(unit(ru.tiers.metric)) + '</em></span><span>pay</span>' +
            '<span class="ru-num"><input data-k="amount" type="number" min="0" step="any" value="' + num(st.amount) + '" aria-label="Pay"><em>' + (pct ? "%" : esc(cur)) + '</em></span><i class="ru-bar"><b style="width:' + Math.round(num(st.amount) * 100 / max) + '%"></b></i><button type="button" class="ru-x" data-stepdel="' + i + '" aria-label="Remove step">×</button></div>';
        }).join("") + '<button type="button" class="ghost manage-btn" id="rStepAdd">' + icon(I.plus) + ' Add step</button><p class="hint">The highest step reached is used, then counted as chosen in step 1.</p></div>' : "") +
        (b === "Fixed per month" ? '<label class="chk"><input type="checkbox" id="rProrate"' + (ru.prorate === false ? "" : " checked") + '> Pay less for part of a period (joiners and leavers)</label>' : "");
      var s5 = '<div class="ru-limits"><div class="fld"><label for="rCut">Take off per unapproved absence</label><span class="ru-money"><em>' + esc(cur) + '</em><input id="rCut" type="number" min="0" step="any" value="' + num(ru.per_absence) + '"></span></div>' +
        '<div class="fld"><label for="rMin">Never less than</label><span class="ru-money"><em>' + esc(cur) + '</em><input id="rMin" type="number" min="0" step="any" value="' + num(ru.min) + '"></span></div>' +
        '<div class="fld"><label for="rCap">Never more than</label><span class="ru-money"><em>' + esc(cur) + '</em><input id="rCap" type="number" min="0" step="any" value="' + num(ru.cap) + '"></span></div></div><p class="hint">Leave 0 for no limit.</p>';
      var card = $("modalCard"), keep = !first ? card.scrollTop : 0, live = $("ruLive") ? $("ruLive").innerHTML : '<p class="msg">Working…</p>';
      var html = ('<div class="ru-editor"><div class="ru-form"><div class="ru-edhead"><div><p class="ed-kicker">' + (idx > -1 ? "Edit rule" : "New rule") + '</p><h2>' + esc(ru.name || "Allowance rule") + '</h2></div>' +
          '<label class="chk"><button type="button" class="sw" role="switch" id="rActive" aria-checked="' + (ru.active !== false) + '" aria-label="Rule on"></button> ' + (ru.active !== false ? "On" : "Off") + '</label></div>' +
        step(1, "What is it, and how is it counted?", s1) + step(2, "Who gets it?", s2, "Pick nothing in a row to mean everyone. A person must match every row you use.") +
        step(3, "When is it paid?", s3) + step(4, "How much?", s4) + step(5, "Limits", s5) + '</div>' +
        '<aside class="ru-side"><div class="ru-sum"><small>In plain words</small><p id="ruSentence">' + esc(ruleText(ru)) + '</p></div>' +
          '<div class="ru-live"><div class="ru-livehead"><strong>What it would pay</strong><input id="rMonth" type="month" value="' + esc(ruMonth()) + '" aria-label="Month"></div><div id="ruLive"></div></div>' +
          '<p class="msg" id="mMsg" role="status"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="rSave">Save rule</button></div></aside></div>');
      if (first) { openModal(html, "xwide"); first = false; } else { card.innerHTML = html; card.scrollTop = keep; }
      $("ruLive").innerHTML = live;
      $("modalCard").oninput = function (e) { read(); refreshText(); if (e.target.closest("[data-k], #rAmount, #rCut, #rMin, #rCap, #rShifts")) livePreview(); };
      $("modalCard").onchange = function (e) {
        read();
        if (e.target.id === "rTiersOn") { ru._tiersOn = e.target.checked; if (e.target.checked && !hasTiers(ru)) ru.tiers = { metric: $("rTierMetric").value, steps: [{ from: 0, amount: num(ru.amount) }] }; if (!e.target.checked) { delete ru.tiers; ru._tiersOn = false; } draw(); return; }
        if (e.target.matches('[data-k="metric"], #rTierMetric')) { draw(); return; }
        if (e.target.id === "rMonth") cache.ruMonth = e.target.value || null;
        refreshText(); livePreview();
      };
      [].forEach.call(document.querySelectorAll("[data-basis]"), function (x) { x.addEventListener("click", function () { read(); ru.basis = x.dataset.basis; draw(); }); });
      [].forEach.call(document.querySelectorAll("[data-who]"), function (x) { x.addEventListener("click", function () {
        read(); var k = x.dataset.who, l = ru.who[k] = ru.who[k] || [], at = l.indexOf(x.dataset.v); if (at > -1) l.splice(at, 1); else l.push(x.dataset.v); if (!l.length) delete ru.who[k]; draw();
      }); });
      $("rActive").addEventListener("click", function () { read(); ru.active = ru.active === false; draw(); });
      $("rCondAdd").addEventListener("click", function () { read(); ru.conditions.push({ metric: "days_worked", op: ">=", value: 1 }); draw(); });
      [].forEach.call(document.querySelectorAll("[data-quick]"), function (x) { x.addEventListener("click", function () { read(); ru.conditions.push(Object.assign({}, QUICK_CONDS[Number(x.dataset.quick)][1])); draw(); }); });
      [].forEach.call(document.querySelectorAll("[data-conddel]"), function (x) { x.addEventListener("click", function () { read(); ru.conditions.splice(Number(x.dataset.conddel), 1); draw(); }); });
      if ($("rStepAdd")) $("rStepAdd").addEventListener("click", function () { read(); var st = ru.tiers.steps, last = st[st.length - 1]; st.push({ from: last ? num(last.from) + 1 : 0, amount: last ? num(last.amount) : 0 }); draw(); });
      [].forEach.call(document.querySelectorAll("[data-stepdel]"), function (x) { x.addEventListener("click", function () { read(); ru.tiers.steps.splice(Number(x.dataset.stepdel), 1); if (!ru.tiers.steps.length) { delete ru.tiers; ru._tiersOn = false; } draw(); }); });
      $("rSave").addEventListener("click", save);
      livePreview(true);
    }
    function refreshText() { var el = $("ruSentence"); if (el) el.textContent = ruleText(ru); var h = document.querySelector(".ru-edhead h2"); if (h) h.textContent = ru.name || "Allowance rule"; }
    function read() {
      if (!$("rName")) return;
      ru.name = $("rName").value.trim(); ru.amount = num($("rAmount").value);
      if ($("rShifts")) ru.shifts = $("rShifts").value.trim().toUpperCase();
      if ($("rProrate")) ru.prorate = $("rProrate").checked;
      ru.match = $("rMatch").value; ru.per_absence = num($("rCut").value); ru.min = num($("rMin").value); ru.cap = num($("rCap").value);
      ru.conditions = [].map.call(document.querySelectorAll("[data-cond]"), function (row) { return { metric: row.querySelector('[data-k="metric"]').value, op: row.querySelector('[data-k="op"]').value, value: num(row.querySelector('[data-k="value"]').value) }; });
      if (ru.tiers) ru.tiers = { metric: $("rTierMetric").value, steps: [].map.call(document.querySelectorAll("[data-step]"), function (row) { return { from: num(row.querySelector('[data-k="from"]').value), amount: num(row.querySelector('[data-k="amount"]').value) }; }) };
      if (!ru.shifts) delete ru.shifts;
    }
    function clean() { var c = JSON.parse(JSON.stringify(ru)); delete c._tiersOn; if (c.tiers && !c.tiers.steps.length) delete c.tiers; return c; }
    // Shows what this rule alone would pay everyone on payroll, updating as you type.
    function livePreview(now) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var my = ++seq, el = $("ruLive"); if (!el) return;
        var r = clean(); r.active = true; r.name = r.name || "This rule";
        previewAll([r], ruMonth(), function (err, rows) {
          if (my !== seq || !$("ruLive")) return;
          if (err) { $("ruLive").innerHTML = '<p class="msg err">' + esc(err) + '</p>'; return; }
          var paid = [], not = [];
          rows.forEach(function (p) { (p.items || []).forEach(function (it) { (num(it.amount) > 0 ? paid : not).push({ s: staffOf(p.user_id), a: num(it.amount), d: it.detail }); }); });
          paid.sort(function (a, b2) { return b2.a - a.a; });
          var tot = paid.reduce(function (t, x) { return t + x.a; }, 0);
          $("ruLive").innerHTML = '<div class="ru-big"><strong>' + money(tot) + '</strong><span>to ' + paid.length + ' ' + (paid.length === 1 ? "person" : "people") + ' in ' + esc(monthBounds(ruMonth()).label) + '</span></div>' +
            (paid.length || not.length ? '<ul class="ru-people">' + paid.concat(not).slice(0, 40).map(function (x) {
              return '<li' + (x.a ? "" : ' class="no"') + '><span class="avatar-s">' + esc(initials(x.s.name)) + '</span><span class="grow"><strong>' + esc(x.s.name) + '</strong><small>' + esc(x.d || "") + '</small></span><b>' + (x.a ? money(x.a) : "—") + '</b></li>';
            }).join("") + '</ul>' : '<p class="hint">Nobody on payroll matches this rule yet. Only people with a salary on Pay details are shown.</p>');
        });
      }, now ? 0 : 450);
    }
    function save() {
      read();
      if (ru.name.length < 2) { say("Give the rule a name (step 1).", "err"); $("rName").focus(); return; }
      if (ru.basis === "Per shift worked" && !ru.shifts && !confirm("No shift codes set, so every shift worked counts. Save anyway?")) return;
      var others = rules().filter(function (x, i) { return i !== idx; });
      if (others.some(function (x) { return x.name.toLowerCase() === ru.name.toLowerCase(); })) { say("Another rule already has this name. Payslips show the name, so pick a different one.", "err"); return; }
      var l = rules().slice(); if (idx > -1) l[idx] = clean(); else l.push(clean());
      saveRules(l).then(closeModal).catch(function (e) { say(e.message, "err"); });
    }
    draw();
  }

  /* ---------- HR Reports (read from the same tables; CSV for each) ---------- */
  var RTABS = [["headcount", "Headcount"], ["attendance", "Attendance"], ["leave", "Leave"], ["overtime", "Hours & overtime"], ["payroll", "Payroll cost"], ["certificates", "Certificates"], ["turnover", "Joiners & leavers"]];
  var repMonth = null;
  function monthRange() { var m = repMonth || todayIso().slice(0, 7), d = new Date(m + "-01T00:00:00"); return { m: m, from: m + "-01", to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) }; }
  function loadReport(sub) {
    var r = monthRange(), key = "rep:" + sub + ":" + r.m;
    if (cache[key] || cache[key + ":busy"]) return;
    var job = null;
    if (sub === "attendance") job = db.from("attendance_records").select("user_id, day, status, clock_in, clock_out").eq("company_id", company.id).gte("day", r.from).lte("day", r.to).limit(5000);
    if (sub === "overtime") job = db.from("timesheet_weeks").select("user_id, week_start, scheduled_min, actual_min, overtime_min, holiday_min, overtime_paid").eq("company_id", company.id).gte("week_start", addDaysIso(-6, r.from)).lte("week_start", r.to);
    if (sub === "payroll") job = db.from("payroll_runs").select("*").eq("company_id", company.id).gte("period_end", r.m.slice(0, 4) + "-01-01").lte("period_start", r.m.slice(0, 4) + "-12-31").order("period_start");
    if (!job) return;
    cache[key + ":busy"] = true;
    job.then(function (res) { cache[key] = { data: res.data || [], error: res.error && res.error.message }; delete cache[key + ":busy"]; var rt = route(); if (rt.view === "reports") render(); });
  }
  function bars(rows, total) {
    return '<div class="dtable-wrap"><table class="dtable rep"><tbody>' + rows.map(function (r) {
      var pct = total ? Math.round(r[1] * 100 / total) : 0;
      return '<tr><td>' + esc(r[0] || "Not set") + '</td><td class="rep-n"><strong>' + r[1] + '</strong></td><td class="rep-bar"><i style="width:' + pct + '%"></i></td><td class="muted-cell">' + pct + '%</td></tr>';
    }).join("") + '</tbody></table></div>';
  }
  function countBy(list, f) { var o = {}; list.forEach(function (x) { var k = f(x) || ""; o[k] = (o[k] || 0) + 1; }); return Object.keys(o).map(function (k) { return [k, o[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); }
  function repTable(head, rows) { return rows.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join("") + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (i ? ' class="muted-cell"' : "") + '>' + c + '</td>'; }).join("") + '</tr>'; }).join("") + '</tbody></table></div>' : empty("Nothing for this period."); }
  var repCsv = null;
  function reportsView(sub) {
    if (!ctx.canHr) return hrOnly("HR Reports");
    sub = RTABS.some(function (t) { return t[0] === sub; }) ? sub : "headcount";
    var r = monthRange(), body = "", note = "", csv = null;
    var monthPick = sub !== "headcount" && sub !== "certificates" ? '<label class="inline-date">' + (sub === "payroll" ? "Year of" : "Month") + ' <input id="repMonth" type="month" value="' + r.m + '"></label>' : "";
    var act = activeStaff();
    if (sub === "headcount") {
      note = "Active staff today: " + act.length + ". Suspended people are counted; former employees are not.";
      body = '<div class="rep-grid"><div><h3>By department</h3>' + bars(countBy(act, function (s) { return s.dept || "No department"; }), act.length) + '</div><div><h3>By designation</h3>' + bars(countBy(act, function (s) { return s.position; }), act.length) + '</div>' +
        '<div><h3>By employment type</h3>' + bars(countBy(act, function (s) { return s.employment; }), act.length) + '</div><div><h3>By status today</h3>' + bars(countBy(act, function (s) { return s.shownStatus; }), act.length) + '</div></div>';
      csv = [["Employee ID", "Name", "Designation", "Department", "Employment type", "Status", "Joined"]].concat(act.map(function (s) { return [s.empNo, s.name, s.position, s.dept, s.employment, s.shownStatus, s.start]; }));
    } else if (sub === "attendance" || sub === "overtime" || sub === "payroll") {
      var d = cache["rep:" + sub + ":" + r.m];
      if (!d) { loadReport(sub); body = '<p class="msg">Loading…</p>'; }
      else if (d.error) body = '<p class="msg err">' + esc(d.error) + '</p>';
      else if (sub === "attendance") {
        var per = {};
        d.data.forEach(function (a) { var p = per[a.user_id] = per[a.user_id] || { Present: 0, Late: 0, Absent: 0, "Missed punch": 0, "On leave": 0, min: 0 }; if (p[a.status] != null) p[a.status]++; if (a.clock_in && a.clock_out) p.min += Math.round((new Date(a.clock_out) - new Date(a.clock_in)) / 6e4); });
        var ids = Object.keys(per), rows = ids.map(function (u) { var p = per[u], worked = p.Present + p.Late, rate = worked ? Math.round(p.Present * 100 / worked) + "%" : "—"; return [staffOf(u), p, worked, rate]; }).sort(function (a, b) { return a[0].name.localeCompare(b[0].name); });
        var T = { Present: 0, Late: 0, Absent: 0, "Missed punch": 0 }; ids.forEach(function (u) { Object.keys(T).forEach(function (k) { T[k] += per[u][k]; }); });
        note = "From the attendance register. On time = present days out of days worked. Hours are clock-in to clock-out before breaks.";
        body = '<div class="kpis">' + kpi("teal", I.check, "Present", T.Present, "Days on time") + kpi("orange", I.clock, "Late", T.Late, "Days late") + kpi("purple", I.alert, "Absent", T.Absent, "Days absent") + kpi("blue", I.doc, "Missed punch", T["Missed punch"], "Days with a missing punch") + '</div>' +
          repTable(["Staff", "Present", "Late", "Absent", "Missed punch", "On leave", "On time", "Hours"], rows.map(function (x) { return [who(x[0], true), x[1].Present, x[1].Late, x[1].Absent ? '<span class="exp">' + x[1].Absent + '</span>' : 0, x[1]["Missed punch"], x[1]["On leave"], x[3], fmtMin(x[1].min)]; }));
        csv = [["Employee ID", "Name", "Present", "Late", "Absent", "Missed punch", "On leave", "On time %", "Hours"]].concat(rows.map(function (x) { return [x[0].empNo, x[0].name, x[1].Present, x[1].Late, x[1].Absent, x[1]["Missed punch"], x[1]["On leave"], x[3], (x[1].min / 60).toFixed(1)]; }));
      } else if (sub === "overtime") {
        var po = {}; d.data.forEach(function (w) { var p = po[w.user_id] = po[w.user_id] || { s: 0, a: 0, o: 0, paid: 0, weeks: 0 }; p.s += w.scheduled_min; p.a += w.actual_min; p.o += w.overtime_min + w.holiday_min; if (w.overtime_paid) p.paid += w.overtime_min + w.holiday_min; p.weeks++; });
        var orows = Object.keys(po).map(function (u) { return [staffOf(u), po[u]]; }).sort(function (a, b) { return b[1].o - a[1].o; });
        note = "Approved timesheet weeks that start in or overlap " + r.label + ". Overtime is paid once it goes through a pay run.";
        body = repTable(["Staff", "Weeks", "Scheduled", "Worked", "Difference", "Overtime", "Paid", "Not paid yet"], orows.map(function (x) { var p = x[1]; return [who(x[0], true), p.weeks, fmtMin(p.s), fmtMin(p.a), diffMin(p.a - p.s), fmtMin(p.o), fmtMin(p.paid), fmtMin(p.o - p.paid)]; }));
        csv = [["Employee ID", "Name", "Weeks", "Scheduled h", "Worked h", "Overtime h", "Paid h"]].concat(orows.map(function (x) { var p = x[1]; return [x[0].empNo, x[0].name, p.weeks, (p.s / 60).toFixed(2), (p.a / 60).toFixed(2), (p.o / 60).toFixed(2), (p.paid / 60).toFixed(2)]; }));
      } else {
        var runs = d.data, sum = function (k) { return runs.reduce(function (t, x) { return t + Number(x[k] || 0); }, 0); };
        note = "Pay runs in " + r.m.slice(0, 4) + ". Drafts are shown but not counted in the totals.";
        var done = runs.filter(function (x) { return x.status !== "Draft"; }), sumD = function (k) { return done.reduce(function (t, x) { return t + Number(x[k] || 0); }, 0); };
        body = '<div class="kpis">' + kpi("blue", I.brief, "Gross", money(sumD("gross")), done.length + " approved run" + (done.length === 1 ? "" : "s")) + kpi("teal", I.check, "Net pay", money(sumD("net")), "Paid to staff") + kpi("orange", I.clock, "Overtime", money(sumD("overtime")), "Inside gross") + kpi("purple", I.shield, "Employer cost", money(sumD("employer_cost")), "Gross plus employer pension") + '</div>' +
          repTable(["Period", "Status", "Staff", "Gross", "Overtime", "Net", "Employer cost"], runs.map(function (x) { return ['<a href="#payroll/run/' + x.id + '">' + esc(fmtRange(x.period_start, x.period_end)) + '</a>', chip(x.status, "st-pr-" + slug(x.status)), x.staff_count, money(x.gross), money(x.overtime), money(x.net), money(x.employer_cost)]; }));
        void sum;
        csv = [["Period start", "Period end", "Status", "Staff", "Gross", "Overtime", "Net", "Employer cost"]].concat(runs.map(function (x) { return [x.period_start, x.period_end, x.status, x.staff_count, x.gross, x.overtime, x.net, x.employer_cost]; }));
      }
    } else if (sub === "leave") {
      var lv = model.leave.filter(function (l) { return l.status === "Approved" && l.start <= r.to && l.end >= r.from; });
      var byType = {}, byPerson = {};
      lv.forEach(function (l) { var a = l.start < r.from ? r.from : l.start, b = l.end > r.to ? r.to : l.end, n = workingDays(a, b); byType[l.type] = (byType[l.type] || 0) + n; var p = byPerson[l.uid] = byPerson[l.uid] || {}; p[l.type] = (p[l.type] || 0) + n; });
      var types = Object.keys(byType), totalDays = types.reduce(function (t, k) { return t + byType[k]; }, 0);
      note = "Approved leave in " + r.label + ", counted in working days. Waiting requests: " + model.leave.filter(function (l) { return l.status === "Pending" && l.start <= r.to && l.end >= r.from; }).length + ".";
      body = '<h3>Days by leave type</h3>' + bars(types.map(function (k) { return [k, byType[k]]; }).sort(function (a, b) { return b[1] - a[1]; }), totalDays) +
        '<h3>By person</h3>' + repTable(["Staff"].concat(types).concat(["Total"]), Object.keys(byPerson).map(function (u) { var p = byPerson[u]; return [who(staffOf(u), true)].concat(types.map(function (k) { return p[k] || 0; })).concat([types.reduce(function (t, k) { return t + (p[k] || 0); }, 0)]); }));
      csv = [["Employee ID", "Name"].concat(types)].concat(Object.keys(byPerson).map(function (u) { var s = staffOf(u); return [s.empNo, s.name].concat(types.map(function (k) { return byPerson[u][k] || 0; })); }));
    } else if (sub === "certificates") {
      var eff = model.effCerts.filter(function (c) { var s = person(c.user_id); return s && s.active; }), a = alerts();
      var byQ = {}; eff.forEach(function (c) { var st = certStage(c.valid_until).key, q = byQ[c.name] = byQ[c.name] || { valid: 0, due: 0, expired: 0 }; if (st === "expired") q.expired++; else if (st === "valid") q.valid++; else q.due++; });
      var miss = act.filter(function (s) { return s.missing.length; });
      note = "Latest certificate per person and qualification. Due = expires within " + a.first + " days (License & Certificate Expiry Alerts).";
      body = repTable(["Qualification", "Valid", "Due for renewal", "Expired"], Object.keys(byQ).sort().map(function (k) { var q = byQ[k]; return [esc(k), q.valid, q.due ? '<span class="exp">' + q.due + '</span>' : 0, q.expired ? '<span class="exp">' + q.expired + '</span>' : 0]; })) +
        '<h3>Missing required qualifications</h3>' + (miss.length ? repTable(["Staff", "Department", "Missing"], miss.map(function (s) { return [who(s, true), esc(s.dept) || "—", '<span class="exp">' + esc(s.missing.join(", ")) + '</span>']; })) : empty("Everyone has the qualifications their role needs."));
      csv = [["Employee ID", "Name", "Qualification", "Valid until", "Status"]].concat(eff.map(function (c) { var s = person(c.user_id); return [s.empNo, s.name, c.name, c.valid_until || "", certStage(c.valid_until).label]; }));
    } else if (sub === "turnover") {
      var all = model.staff, months = [];
      for (var i = 11; i >= 0; i--) { var dm = new Date(r.from + "T00:00:00"); dm.setMonth(dm.getMonth() - i); months.push(iso(dm).slice(0, 7)); }
      var mrows = months.map(function (m) {
        var j = all.filter(function (s) { return s.start && s.start.slice(0, 7) === m; }), l = all.filter(function (s) { return s.endDate && s.endDate.slice(0, 7) === m; });
        var end = iso(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)), hc = all.filter(function (s) { return (!s.start || s.start <= end) && (!s.endDate || s.endDate > end); }).length;
        return [m, j, l, hc];
      });
      note = "People who joined (joining date) and left (last working day) each month, and headcount at the month's end. Former employees are included.";
      body = repTable(["Month", "Joined", "Left", "Headcount at end", "Who"], mrows.map(function (x) { var d2 = new Date(x[0] + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" }); return [d2, x[1].length, x[2].length ? '<span class="exp">' + x[2].length + '</span>' : 0, x[3], esc(x[1].map(function (s) { return "+" + s.name; }).concat(x[2].map(function (s) { return "−" + s.name; })).join(", "))]; }));
      csv = [["Month", "Joined", "Left", "Headcount at end"]].concat(mrows.map(function (x) { return [x[0], x[1].length, x[2].length, x[3]]; }));
    }
    repCsv = csv ? { name: "hr-" + sub + (monthPick ? "-" + r.m : "") + ".csv", rows: csv } : null;
    return '<section class="dash-card tabs-card"><div class="card-head">' + subTabs(RTABS, sub, "#reports/") + '</div></section>' +
      '<section class="dash-card"><div class="card-head"><div><h2>' + esc(RTABS.filter(function (t) { return t[0] === sub; })[0][1]) + (monthPick && sub !== "payroll" ? " · " + esc(r.label) : "") + '</h2><p class="note">' + esc(note) + '</p></div><span class="prof-actions">' + monthPick + (csv ? '<button type="button" class="ghost" id="repCsv">Download CSV</button>' : "") + '</span></div>' + body + '</section>';
  }

  /* ---------- Crew Management ---------- */
  var CTABS = [["vessels", "Vessel crews"], ["certificates", "Certificates & qualifications"], ["availability", "Crew availability"]];
  function crewView(sub) {
    if (!ctx.canHr) return hrOnly("Crew Management");
    var tabs = hrSettingsOk() ? CTABS.concat([["settings", "Settings"]]) : CTABS;
    sub = tabs.some(function (t) { return t[0] === sub; }) ? sub : "vessels";
    var head = '<section class="dash-card tabs-card">' + subTabs(tabs, sub, "#crew/") + '</section>';
    if (sub === "settings") return head + '<section class="dash-card" id="hrAreaSettings"></section>';
    if (sub === "certificates") return head + certRegister();
    if (sub === "availability") return head + availability();
    return head + vesselBoard();
  }
  function vesselBoard() {
    var act = activeStaff(), rules = crewRules(), minCrew = Math.max(0, Number(rules.minCrew) || 0);
    var crew = act.filter(function (s) { return s.group !== "Shore"; });
    var vessels = []; act.forEach(function (s) { if (s.vessel && vessels.indexOf(s.vessel) < 0) vessels.push(s.vessel); }); vessels.sort();
    function row(s) {
      var bad = s.expired || s.missing.length;
      return '<li><span class="avatar-s">' + esc(initials(s.name)) + '</span><span class="grow"><a href="#employee/' + s.uid + '/qualifications"><strong>' + esc(s.name) + '</strong></a><small>' + esc(s.position) + ' · ' + esc(s.duty) + (bad ? ' · <span class="exp">' + (s.missing.length ? "missing " + esc(s.missing.join(", ")) : "expired certificate") + '</span>' : "") + '</small></span>' +
        '<button type="button" class="ghost manage-btn" data-assign="' + s.uid + '">' + (s.vessel ? "Move" : "Assign") + '</button></li>';
    }
    var cards = vessels.map(function (v) {
      var on = act.filter(function (s) { return s.vessel === v; }), warn = [];
      if (!on.some(function (s) { return s.group === "Captain"; })) warn.push("No captain");
      if (!on.some(function (s) { return s.group === "Engineering"; })) warn.push("No engineer");
      if (minCrew && on.length < minCrew) warn.push(on.length + " of " + minCrew + " minimum crew");
      if (on.some(function (s) { return s.expired || s.missing.length; })) warn.push("Crew with qualification problems");
      return '<div class="vcard' + (warn.length ? " warn" : "") + '"><div class="vhead">' + icon(I.ship) + '<strong>' + esc(v) + '</strong><span class="muted-cell">' + on.length + ' crew</span></div>' +
        (warn.length ? '<p class="vwarn">' + icon(I.alert) + esc(warn.join(" · ")) + '</p>' : '<p class="vok">' + icon(I.check) + 'Crewed</p>') +
        '<ul class="vlist">' + on.map(row).join("") + '</ul></div>';
    });
    var free = crew.filter(function (s) { return !s.vessel; });
    cards.push('<div class="vcard free"><div class="vhead">' + icon(I.people) + '<strong>Not on a vessel</strong><span class="muted-cell">' + free.length + ' crew</span></div><ul class="vlist">' + (free.length ? free.map(row).join("") : '<li><small class="muted-cell">Every crew member has a vessel.</small></li>') + '</ul></div>');
    return '<section class="dash-card"><div class="card-head"><div><h2>Vessel crews</h2><p class="note">Who is assigned to each vessel. Assigning checks status, leave and required qualifications first' + (minCrew ? "; each vessel should have at least " + minCrew + " crew" : "") + ' (Crew Assignment Rules).</p></div>' +
      '<span style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn-soft" id="vesselCrewNeeds">' + icon(I.ship) + 'Vessel crew needs</button><button type="button" class="primary-btn" id="assignNew">' + icon(I.plus) + 'Assign crew</button></span></div>' +
      (vessels.length ? "" : '<p class="note">No vessels yet. Type a vessel name or registration (e.g. HT-203) when assigning crew; the vessel list will come from the Fleet module once it is built.</p>') +
      '<div class="vboard">' + cards.join("") + '</div></section>';
  }
  function certRegister() {
    var t = todayIso(), rows = [];
    model.effCerts.forEach(function (c) { var s = person(c.user_id); if (s && s.active) rows.push({ s: s, c: c, st: certStage(c.valid_until) }); });
    activeStaff().forEach(function (s) { s.missing.forEach(function (m) { if (!s.effCerts.some(function (c) { return c.name.toLowerCase() === m.toLowerCase(); })) rows.push({ s: s, c: { name: m }, st: { key: "missing", label: "Missing" } }); }); });
    var order = { expired: 0, missing: 1, final: 2, soon: 3, due: 4, valid: 5 };
    var count = {}; rows.forEach(function (r) { count[r.st.key] = (count[r.st.key] || 0) + 1; });
    var shown = rows.filter(function (r) { return !certFilter || r.st.key === certFilter; }).sort(function (a, b) { return (order[a.st.key] - order[b.st.key]) || (a.c.valid_until || "9999").localeCompare(b.c.valid_until || "9999") || a.s.name.localeCompare(b.s.name); });
    var a = alerts(), labels = [["expired", "Expired"], ["missing", "Missing"], ["final", "Final alert (" + a.final + " days)"], ["soon", "Second alert (" + a.second + " days)"], ["due", "First alert (" + a.first + " days)"], ["valid", "Valid"]];
    void t;
    return '<section class="dash-card"><div class="card-head"><div><h2>Certificates & qualifications</h2><p class="note">Alerts go out at ' + a.first + ', ' + a.second + ' and ' + a.final + ' days before expiry (License & Certificate Expiry Alerts). Renewals replace the older record.</p></div></div>' +
      '<div class="stage-pills">' + labels.map(function (l) { return '<button type="button" class="pill-btn st-cert-' + l[0] + (certFilter === l[0] ? " on" : "") + '" data-cf="' + l[0] + '">' + esc(l[1]) + ' <b>' + (count[l[0]] || 0) + '</b></button>'; }).join("") + (certFilter ? '<button type="button" class="pill-btn" data-cf="">Show all</button>' : "") + '</div>' +
      (shown.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Staff</th><th>Qualification</th><th>Issued by</th><th>Number</th><th>Valid until</th><th>Status</th><th></th></tr></thead><tbody>' + shown.map(function (r) {
        return '<tr><td>' + who(r.s, true) + '</td><td><strong>' + esc(r.c.name) + '</strong></td><td class="muted-cell">' + (esc(r.c.issuer) || "—") + '</td><td class="muted-cell">' + (esc(r.c.cert_no) || "—") + '</td><td class="muted-cell">' + (r.c.id ? (r.c.valid_until ? fmtDate(r.c.valid_until) : "No expiry") : "—") + '</td>' +
          '<td>' + chip(r.st.label, "st-cert-" + r.st.key) + '</td><td><a class="ghost manage-btn" href="#employee/' + r.s.uid + '/qualifications">' + (r.st.key === "missing" ? "Add" : r.st.key === "valid" ? "Open" : "Renew") + '</a></td></tr>';
      }).join("") + '</tbody></table></div>' : empty(rows.length ? "Nothing in this group." : "No qualifications recorded yet. Add them on each person's Qualifications tab.")) + '</section>';
  }
  function availability() {
    var day = crewDay || todayIso(), data = cache["avail:" + day];
    if (!data) {
      db.rpc("crew_availability", { p_company: company.id, p_day: day }).then(function (r) {
        cache["avail:" + day] = r.error ? { error: r.error.message } : { rows: r.data || [] };
        var rt = route(); if (rt.view === "crew" && rt.id === "availability") render();
      });
    }
    var body = !data ? '<p class="msg">Checking everyone…</p>' : data.error ? '<p class="msg err">' + esc(data.error) + '</p>' : (function () {
      var rows = data.rows.map(function (x) { return { s: person(x.u), reason: x.reason, shift: x.shift }; }).filter(function (x) { return x.s && x.s.group !== "Shore"; });
      var blocked = rows.filter(function (x) { return x.reason; }).length;
      if (crewOnlyBlocked) rows = rows.filter(function (x) { return x.reason; });
      rows.sort(function (a, b) { return (!!b.reason - !!a.reason) || a.s.name.localeCompare(b.s.name); });
      return '<p class="note">' + (data.rows.length - blocked) + ' crew can work · ' + blocked + ' cannot</p>' +
        (rows.length ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Crew</th><th>Group</th><th>Vessel</th><th>Roster</th><th>Can work?</th></tr></thead><tbody>' + rows.map(function (x) {
          return '<tr><td>' + who(x.s, true) + '</td><td class="muted-cell">' + esc(x.s.group) + '</td><td class="muted-cell">' + (esc(x.s.vessel) || "—") + '</td><td>' + (x.shift ? '<span class="code-chip">' + esc(x.shift) + '</span>' : '<span class="muted-cell">—</span>') + '</td>' +
            '<td>' + (x.reason ? '<span class="exp">' + esc(x.reason) + '</span>' + (isWorking(x.shift) && x.shift !== "TRN" ? ' <span class="chip st-rejected">Rostered anyway</span>' : "") : chip("Available", "st-on-duty")) + '</td></tr>';
        }).join("") + '</tbody></table></div>' : empty("Everyone can work on this day."));
    })();
    return '<section class="dash-card"><div class="card-head"><div><h2>Crew availability</h2><p class="note">Checks status, approved leave, attendance, expired and missing qualifications for a day: the same check the roster and vessel assignment use.</p></div></div>' +
      '<div class="att-toolbar"><label>Day <input id="crewDay" type="date" value="' + esc(day) + '"></label><label class="chk"><input type="checkbox" id="crewBlocked"' + (crewOnlyBlocked ? " checked" : "") + '> Only show who cannot work</label></div>' + body + '</section>';
  }

  /* ---------- Leave & Absence ---------- */
  var LTABS = [["requests", "Requests"], ["balances", "Balances"], ["calendar", "Calendar"]];
  /* ---- Leave & Absence page (redesigned 2026-10-29): hero with live numbers, filter chips, expandable request cards with the
     approval trail, balance bars and a colour-coded calendar. Same data and actions as before. ---- */
  var leaveQuery = "", leaveOpen = {};
  function lvColor(type) { var i = leaveTypes().map(function (t) { return t.name; }).indexOf(type); return LT_COLORS[(i < 0 ? 0 : i) % LT_COLORS.length]; }
  function lvWhen(at) { if (!at) return ""; var d = new Date(at); return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function loadLeaveImpact(list) {
    var impact = cache.impact || {};
    var want = list.filter(function (l) { return (l.status === "Pending" || l.status === "Approved") && l.end >= todayIso() && impact[l.id] == null; });
    if (want.length && !cache.impactBusy) {
      cache.impactBusy = true;
      Promise.all(want.slice(0, 40).map(function (l) {
        return db.from("roster_entries").select("day", { count: "exact", head: true }).eq("company_id", company.id).eq("user_id", l.uid).gte("day", l.start).lte("day", l.end).not("shift", "in", '("OFF","L")')
          .then(function (r) { impact[l.id] = r.count || 0; });
      })).then(function () { cache.impact = impact; cache.impactBusy = false; render(); });
    }
    return impact;
  }
  function leaveTrailFor(l) {
    cache.trail = cache.trail || {};
    if (cache.trail[l.id]) return cache.trail[l.id];
    if (!cache.trailBusy || !cache.trailBusy[l.id]) {
      cache.trailBusy = cache.trailBusy || {}; cache.trailBusy[l.id] = true;
      rpc("leave_trail", { p_id: l.id }).then(function (t) { cache.trail[l.id] = t.steps; }).catch(function () {
        var st = [{ state: "done", title: "Submitted", name: l.name, at: l.created }];
        st.push(l.status === "Pending" ? { state: "waiting", title: "Waiting for approval", name: routedTo(l) } : { state: l.status.toLowerCase(), title: l.status, name: "Approver", note: l.decision });
        cache.trail[l.id] = st;
      }).then(function () { render(); });
    }
    return null;
  }
  function trailHtml(steps) {
    if (!steps) return '<p class="note">Loading status…</p>';
    return '<ol class="lv-trail">' + steps.map(function (s, i) {
      var tone = s.state === "rejected" ? "no" : s.state === "waiting" ? "wait" : "ok";
      var line = s.state === "waiting" ? s.title : (s.state === "done" ? "Submitted" : s.title) + (s.at ? " on " + lvWhen(s.at) : "");
      return '<li class="lv-step lv-' + tone + '"><span class="lv-dot">' + (tone === "ok" ? "✓" : tone === "no" ? "✕" : "…") + '</span><div><strong>' + esc((s.name || "—") + (s.no ? " - " + s.no : "")) + '</strong><small>' + esc(line) + '</small>' +
        (s.note && !/^Approved automatically/.test(s.note) ? '<small class="lv-note">“' + esc(s.note) + '”</small>' : "") + '</div></li>';
    }).join("") + '</ol>';
  }
  function leaveHero() {
    var t = todayIso(), in7 = iso(new Date(Date.now() + 7 * 864e5));
    var pend = model.leave.filter(function (l) { return l.status === "Pending"; }), mine = pend.filter(canDecide);
    var out = model.leave.filter(function (l) { return l.status === "Approved" && l.start <= t && l.end >= t; });
    var soon = model.leave.filter(function (l) { return l.status === "Approved" && l.start > t && l.start <= in7; });
    var me = ctx.myRole ? leaveTypes().filter(function (x) { return Number(x.days) > 0; })[0] : null, left = me ? Math.max(Number(me.days) - usedDays(ctx.me, me.name), 0) : null;
    function av(l) { return '<span class="avatar-s lv-mini" title="' + esc(l.name) + '">' + esc(initials(l.name)) + '</span>'; }
    return '<section class="lv-hero"><div class="lv-hero-top"><div><h2>Leave &amp; Absence</h2><p>Requests, balances and the leave calendar, with every leave setting under Settings.</p></div>' +
      (ctx.myRole ? '<button type="button" class="lv-cta" id="reqLeave"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Request leave</button>' : "") + '</div>' +
      '<div class="lv-kpis"><a class="lv-kpi" href="#leave/requests" data-lvf="Pending"><b data-count="' + (ctx.canHr || mine.length ? mine.length : pend.length) + '">0</b><span>' + (ctx.canHr || mine.length ? "Waiting for your decision" : "Waiting for approval") + '</span></a>' +
      '<a class="lv-kpi" href="#leave/calendar"><b data-count="' + out.length + '">0</b><span>Out today</span><em>' + out.slice(0, 4).map(av).join("") + (out.length > 4 ? '<i>+' + (out.length - 4) + '</i>' : "") + '</em></a>' +
      '<a class="lv-kpi" href="#leave/calendar"><b data-count="' + soon.length + '">0</b><span>Starting in 7 days</span><em>' + soon.slice(0, 4).map(av).join("") + '</em></a>' +
      (me ? '<a class="lv-kpi" href="#leave/balances"><b data-count="' + left + '">0</b><span>' + esc(me.name) + ' left for you</span></a>' : "") + '</div></section>';
  }
  function leaveCards(list) {
    var impact = loadLeaveImpact(list);
    return '<div class="lv-list">' + list.map(function (l) {
      var s = person(l.uid) || { name: l.name, uid: l.uid }, t = leaveTypes().filter(function (x) { return x.name === l.type; })[0] || {}, lim = Number(t.days) || 0;
      var wd = workingDays(l.start, l.end), left = lim ? lim - usedDays(l.uid, l.type) : null, open = !!leaveOpen[l.id], imp = impact[l.id];
      var meta = [['Balance after', left == null ? "No limit" : (left < 0 ? '<span class="exp">' + left + ' (over)</span>' : left + " of " + lim)],
        [l.status === "Pending" ? "Waiting for" : "Decided by", l.status === "Pending" ? esc(routedTo(l)) : "See status"],
        ["Roster impact", imp == null ? "…" : imp ? '<a class="exp" href="roster.html">' + imp + " shift" + (imp > 1 ? "s" : "") + " to cover</a>" : "None"],
        ["Certificate", l.cert === true ? "With certificate" + (l.certPath ? " · file attached" : "") : l.cert === false ? "Without certificate" : "Not asked"]];
      return '<article class="lv-card' + (open ? " open" : "") + '" style="--lc:' + lvColor(l.type) + '">' +
        '<button type="button" class="lv-main" data-lvopen="' + l.id + '" aria-expanded="' + open + '"><span class="lv-bar"></span>' + '<span class="avatar-s">' + esc(initials(s.name)) + '</span>' +
        '<span class="lv-who"><strong>' + esc(s.name) + '</strong><small><i class="lv-type">' + esc(l.type) + '</i> · ' + esc(fmtRange(l.start, l.end)) + '</small></span>' +
        '<span class="lv-days"><b>' + wd + '</b><small>working day' + (wd === 1 ? "" : "s") + '</small></span>' + chip(l.status) +
        '<svg class="lv-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>' +
        (open ? '<div class="lv-detail"><div class="lv-meta">' + meta.map(function (m) { return '<div><small>' + m[0] + '</small><strong>' + m[1] + '</strong></div>'; }).join("") + '</div>' +
          (l.note ? '<p class="lv-quote">“' + esc(l.note) + '”</p>' : "") +
          '<h4>Status</h4>' + trailHtml(leaveTrailFor(l)) +
          (canDecide(l) ? '<div class="lv-actions"><button type="button" class="lv-go" data-review="' + l.id + '">Review and decide</button></div>' : "") + '</div>' : "") + '</article>';
    }).join("") + '</div>';
  }
  function leaveView(sub) {
    var tabs = leaveSettingsOk() ? LTABS.concat([["settings", "Settings"]]) : LTABS;
    sub = tabs.some(function (t) { return t[0] === sub; }) ? sub : "requests";
    var head = (sub === "settings" ? "" : leaveHero()) + '<section class="dash-card tabs-card"><div class="card-head">' + subTabs(tabs, sub, "#leave/") + (sub === "settings" && ctx.myRole ? '<button type="button" class="btn-soft" id="reqLeave">Request leave</button>' : "") + '</div></section>';
    if (sub === "settings") return head + '<section class="dash-card" id="leaveSettings"><p class="msg">Loading leave settings…</p></section>';
    if (sub === "balances") return head + balances();
    if (sub === "calendar") return head + leaveCalendar();
    var q = leaveQuery.trim().toLowerCase();
    var counts = { "": model.leave.length, Pending: 0, Approved: 0, Rejected: 0 }; model.leave.forEach(function (l) { counts[l.status] = (counts[l.status] || 0) + 1; });
    var list = model.leave.filter(function (l) { return (!leaveFilter || l.status === leaveFilter) && (!q || (l.name + " " + l.type).toLowerCase().indexOf(q) > -1); })
      .sort(function (a, b) { return (a.status === "Pending" ? 0 : 1) - (b.status === "Pending" ? 0 : 1) || (a.status === "Pending" ? (a.start < b.start ? -1 : 1) : (a.start < b.start ? 1 : -1)); });
    return head + (ctx.myRole ? '<div class="lv-types">' + leaveTypeCards() + '</div>' : "") +
      '<section class="dash-card lv-reqs"><div class="lv-bar2"><div class="lv-chips" role="tablist" aria-label="Filter requests">' +
      [["", "All"], ["Pending", "Pending"], ["Approved", "Approved"], ["Rejected", "Rejected"]].map(function (f) { return '<button type="button" role="tab" class="lv-fchip" data-lvf="' + f[0] + '" aria-selected="' + (leaveFilter === f[0]) + '">' + f[1] + ' <b>' + (counts[f[0]] || 0) + '</b></button>'; }).join("") +
      '</div><label class="lv-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/></svg><input id="lvSearch" type="search" placeholder="Search name or type" value="' + esc(leaveQuery) + '" aria-label="Search requests"></label></div>' +
      '<p class="note">Working days skip your weekend days. Open a request to see where it stands and who decides it.</p>' +
      (list.length ? leaveCards(list) : empty(q ? "Nothing matches your search." : leaveFilter ? "No " + leaveFilter.toLowerCase() + " requests." : "No leave requests yet.")) + '</section>';
  }
  /* ---- Leave settings tab: every leave setting in one place (editors in hr-leave-settings.js) ---- */
  function leaveSettingsOk() { return !!(ctx && (ctx.canHr || ctx.isAdmin || ctx.isPlatform) && window.HrLeaveSettings); }
  function leaveOrgData() {
    return Promise.all([
      db.from("company_members").select("user_id, role, active, department_id, job_title_id, manager_id").eq("company_id", company.id),
      db.from("departments").select("id, name").eq("company_id", company.id).order("name"),
      db.from("job_titles").select("id, title, department_id, crew_group").eq("company_id", company.id)
    ]).then(function (r) {
      for (var i = 0; i < 3; i++) if (r[i].error) throw new Error(r[i].error.message);
      return db.from("profiles").select("id, full_name, email").in("id", r[0].data.map(function (m) { return m.user_id; })).then(function (p) {
        var by = {}; (p.data || []).forEach(function (x) { by[x.id] = x; });
        return { members: r[0].data, depts: r[1].data, titles: r[2].data, by: by };
      });
    });
  }
  function mountLeaveSettings(pill) {
    var el = $("leaveSettings"); if (!el) return;
    window.HrLeaveSettings.render(el, {
      pill: pill, esc: esc, company: function () { return company; }, db: db, rpc: rpc, canHr: ctx.canHr || ctx.isAdmin || ctx.isPlatform, canAdmin: !!(ctx.isAdmin || ctx.isPlatform),
      orgLoad: leaveOrgData, memberName: function (m, by) { var p = by[m.user_id] || {}; return p.full_name || (p.email || "").split("@")[0] || "Unknown"; },
      optList: function (items, cur, blank) { return '<option value="">' + esc(blank) + '</option>' + items.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join(""); },
      onSaved: function () { cache.impact = null; }
    });
  }
  /* Settings live on the page they belong to. hrSettingsOk / mountArea draw that tab. */
  function hrSettingsOk() { return !!(ctx && (ctx.canHr || ctx.isAdmin || ctx.isPlatform) && window.HrSettings); }
  function mountArea(area, pill) {
    var el = $("hrAreaSettings"); if (!el) return;
    if (!window.HrSettings) { el.innerHTML = '<p class="msg">Could not load the settings script.</p>'; return; }
    window.HrSettings.mount(el, {
      area: area, pill: pill, esc: esc, company: function () { return company; }, db: db, rpc: rpc,
      canHr: ctx.canHr || ctx.isAdmin || ctx.isPlatform, orgLoad: leaveOrgData,
      memberName: function (m, by) { var p = by[m.user_id] || {}; return p.full_name || (p.email || "").split("@")[0] || "Unknown"; },
      optList: function (items, cur, blank) { return '<option value="">' + esc(blank) + '</option>' + items.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join(""); }
    });
  }
  function employeesSettings() {
    return '<p class="note" style="margin:0 0 12px"><a href="#employees">← Employees</a></p><section class="dash-card" id="hrAreaSettings"></section>';
  }
  function leaveRows(list, showName) {
    var impact = cache.impact || {};
    var want = list.filter(function (l) { return (l.status === "Pending" || l.status === "Approved") && l.end >= todayIso() && impact[l.id] == null; });
    if (want.length && !cache.impactBusy) {
      cache.impactBusy = true;
      Promise.all(want.slice(0, 40).map(function (l) {
        return db.from("roster_entries").select("day", { count: "exact", head: true }).eq("company_id", company.id).eq("user_id", l.uid).gte("day", l.start).lte("day", l.end).not("shift", "in", '("OFF","L")')
          .then(function (r) { impact[l.id] = r.count || 0; });
      })).then(function () { cache.impact = impact; cache.impactBusy = false; render(); });
    }
    return '<div class="dtable-wrap"><table class="dtable"><thead><tr>' + (showName ? '<th>Staff</th>' : "") + '<th>Type</th><th>Dates</th><th>Working days</th><th>Balance after</th><th>Approver</th><th>Status</th><th>Roster impact</th><th></th></tr></thead><tbody>' + list.map(function (l) {
      var s = person(l.uid) || { name: l.name, uid: l.uid }, t = leaveTypes().filter(function (x) { return x.name === l.type; })[0] || {}, lim = Number(t.days) || 0;
      var wd = workingDays(l.start, l.end), left = lim ? lim - usedDays(l.uid, l.type) : null;
      var imp = impact[l.id];
      return '<tr>' + (showName ? '<td>' + who(s, true) + '</td>' : "") + '<td class="muted-cell">' + esc(l.type) + (l.cert === true ? '<small class="cell-note">With certificate</small>' : l.cert === false ? '<small class="cell-note">No certificate</small>' : "") + (l.certPath ? '<small class="cell-note"><a href="#" data-cert="' + esc(l.certPath) + '">View certificate' + (l.certName ? " · " + esc(l.certName) : "") + '</a></small>' : "") + (l.note ? '<small class="cell-note">' + esc(l.note) + '</small>' : "") + '</td><td class="muted-cell">' + esc(fmtRange(l.start, l.end)) + '</td>' +
        '<td class="muted-cell">' + wd + '</td><td class="' + (left != null && left < 0 ? "exp" : "muted-cell") + '">' + (left == null ? "No limit" : left + " of " + lim) + '</td>' +
        '<td class="muted-cell">' + (l.status === "Pending" ? esc(routedTo(l)) : "—") + '</td><td>' + chip(l.status) + (l.decision ? '<small class="cell-note">' + esc(l.decision) + '</small>' : "") + '</td>' +
        '<td>' + (imp == null ? '<span class="muted-cell">—</span>' : imp ? '<a class="exp" href="roster.html">' + imp + ' shift' + (imp > 1 ? "s" : "") + ' to cover</a>' : '<span class="muted-cell">None</span>') + '</td>' +
        '<td>' + (canDecide(l) ? '<button type="button" class="chip-btn" data-review="' + l.id + '">Review</button>' : "") + '</td></tr>';
    }).join("") + '</tbody></table></div>';
  }
  function balances() {
    var types = leaveTypes(), list = (ctx.canHr ? activeStaff() : activeStaff().filter(function (s) { return s.uid === ctx.me; }));
    return '<section class="dash-card"><div class="card-head"><div><h2>Leave balances ' + new Date().getFullYear() + '</h2><p class="note">Working days left per leave type. Approved and pending requests count as used. Entitlements come from Settings.</p></div></div>' +
      '<div class="dtable-wrap"><table class="dtable lv-bal"><thead><tr><th>Staff</th>' + types.map(function (t, i) { return '<th style="--lc:' + LT_COLORS[i % LT_COLORS.length] + '"><span class="lv-th">' + esc(t.name) + '</span>' + (Number(t.days) ? '<small class="th-sub">' + t.days + ' days</small>' : '<small class="th-sub">No limit</small>') + '</th>'; }).join("") + '</tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr><td>' + who(s, true) + '</td>' + types.map(function (t, i) {
          var used = usedDays(s.uid, t.name), lim = Number(t.days) || 0, pct = lim ? Math.min(100, Math.round(used / lim * 100)) : 0;
          return '<td style="--lc:' + LT_COLORS[i % LT_COLORS.length] + '">' + (lim ? '<div class="lv-meter' + (used > lim ? " over" : "") + '"><i style="width:' + pct + '%"></i></div><span class="lv-left"><strong>' + (lim - used) + '</strong> left' + (used ? ' <small>' + used + ' used</small>' : "") + '</span>' : '<span class="lv-left">' + (used ? used + ' used' : '—') + '</span>') + '</td>';
        }).join("") + '</tr>';
      }).join("") + '</tbody></table></div></section>';
  }
  function leaveCalendar() {
    var m = calMonth || todayIso().slice(0, 7), y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)), n = new Date(y, mo, 0).getDate();
    var first = m + "-01", last = m + "-" + pad2(n), off = weekendDays(), t = todayIso();
    var reqs = model.leave.filter(function (l) { return (l.status === "Approved" || l.status === "Pending") && l.start <= last && l.end >= first && (ctx.canHr || l.uid === ctx.me || canDecide(l)); });
    var uids = []; reqs.forEach(function (l) { if (uids.indexOf(l.uid) < 0) uids.push(l.uid); });
    var dayCells = []; for (var d = 1; d <= n; d++) { var dt = new Date(y, mo - 1, d); dayCells.push({ iso: m + "-" + pad2(d), d: d, we: off.indexOf(dt.getDay()) > -1, wd: dt.toLocaleDateString("en-GB", { weekday: "narrow" }) }); }
    var label = new Date(y, mo - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    var prev = iso(new Date(y, mo - 2, 1)).slice(0, 7), next = iso(new Date(y, mo, 1)).slice(0, 7);
    return '<section class="dash-card"><div class="card-head"><div><h2>Leave calendar</h2><p class="note">Approved and pending leave. Shaded columns are weekend days.</p></div>' +
      '<div class="cal-nav"><button type="button" class="ghost" data-cal="' + prev + '">‹</button><strong>' + esc(label) + '</strong><button type="button" class="ghost" data-cal="' + next + '">›</button></div></div>' +
      (uids.length ? '<div class="dtable-wrap"><table class="cal"><thead><tr><th class="cal-name">Staff</th>' + dayCells.map(function (c) { return '<th class="' + (c.we ? "we" : "") + (c.iso === t ? " today" : "") + '"><small>' + c.wd + '</small>' + c.d + '</th>'; }).join("") + '</tr></thead><tbody>' +
        uids.map(function (u) {
          var s = person(u) || { name: model.nameOf(u), uid: u }, mineReq = reqs.filter(function (l) { return l.uid === u; });
          return '<tr><td class="cal-name">' + who(s, true) + '</td>' + dayCells.map(function (c) {
            var hit = mineReq.filter(function (l) { return l.start <= c.iso && l.end >= c.iso; })[0];
            return '<td class="' + (c.we ? "we" : "") + (hit ? " lv lv-" + slug(hit.status) : "") + '"' + (hit ? ' style="--lc:' + lvColor(hit.type) + '" title="' + esc(hit.type + " · " + hit.status) + '"' : "") + '></td>';
          }).join("") + '</tr>';
        }).join("") + '</tbody></table></div><p class="cal-key"><span class="lv lv-approved" style="--lc:#5e5ce6"></span>Approved <span class="lv lv-pending" style="--lc:#5e5ce6"></span>Pending (striped) · colour shows the leave type: ' + leaveTypes().map(function (t) { return '<span class="lv-key" style="--lc:' + lvColor(t.name) + '"></span>' + esc(t.name); }).join(" ") + '</p>' : empty("No leave in " + esc(label) + ".")) + '</section>';
  }

  /* ---------- page ---------- */
  var TITLES = { overview: ["HR Overview", "Workforce at a glance: approvals, alerts and today's staffing."], employees: ["Employees", "Staff directory and employee records."],
    employee: ["Employee profile", "Everything about one person in one place."], attendance: ["Duty & Attendance", "Clock-in and clock-out, weekly timesheets and exceptions."],
    crew: ["Crew Management", "Vessel crews, certificates and who can work."], leave: ["Leave & Absence", "Requests, balances and the leave calendar."],
    payroll: ["Payroll & Overtime", "Salaries, pay runs, payslips and approved overtime."], reports: ["HR Reports", "Headcount, attendance, leave, hours, pay and certificates, with CSV downloads."],
    organization: ["Departments & Designations", "Company structure: departments and job titles."],
    allowances: ["Allowances", "Monthly allowances and who receives each one."] };
  var orgState = { tab: "depts", q: "", showInactive: false };
  function orgApi() {
    return {
      db: db, company: company, model: model, ctx: ctx, orgState: orgState,
      $: $, esc: esc, openModal: openModal, closeModal: closeModal, options: options,
      say: say, sayInline: sayInline, render: render
    };
  }
  var alwState = { q: "", msg: "", msgKind: "" };
  function alwApi() {
    return {
      db: db, company: company, model: model, ctx: ctx, alwState: alwState,
      $: $, esc: esc, openModal: openModal, closeModal: closeModal, options: options,
      rpc: rpc, say: say, sayInline: sayInline, render: render, reload: reload, money: money
    };
  }
  function allowancesView() {
    if (!window.VeyoraHrAllowances) {
      return '<section class="dash-card"><h2>Allowances</h2><p class="note">Could not load the allowances page script.</p></section>';
    }
    return window.VeyoraHrAllowances.render(alwApi());
  }
  function organizationView() {
    if (!window.VeyoraHrOrganization) {
      return '<section class="dash-card"><h2>Departments &amp; Designations</h2><p class="note">Could not load the organisation page script.</p></section>';
    }
    return window.VeyoraHrOrganization.render(orgApi());
  }
  function render() {
    if (!model) return;
    var raw = (location.hash || "#overview").slice(1);
    var jump = window.HrSettings && window.HrSettings.legacy(raw);
    if (jump) { location.replace(jump); return; }
    var rt = route(), v = rt.view;
    var hrUser = !!(ctx.canHr || ctx.isAdmin || ctx.isPlatform);
    if (v === "overview" && !ctx.canHr) { location.replace("#employee/" + ctx.me); return; }
    if ((v === "organization" || v === "allowances") && !hrUser) { location.replace("#employee/" + ctx.me); return; }
    if (!hrUser && rt.id === "settings" && (v === "employees" || v === "attendance" || v === "payroll")) { location.replace("#" + v); return; }
    var ttl = TITLES[v];
    $("hrTitle").textContent = ttl[0];
    $("hrSub").textContent = ctx.isPlatform && !ctx.myRole ? company.name + " · viewing as platform owner" : ttl[1];
    $("sampleWrap").hidden = v !== "employees" || rt.id === "settings";
    $("sampleToggle").setAttribute("aria-checked", sampleOn);
    $("addCrew").hidden = !(ctx.isAdmin && ((v === "employees" && rt.id !== "settings") || v === "overview"));
    var html = v === "overview" ? overview() : v === "employees" ? (rt.id === "settings" ? employeesSettings() : employees()) : v === "employee" ? profile(rt.id, rt.sub) : v === "attendance" ? attendanceView(rt.id) : v === "crew" ? crewView(rt.id) : v === "payroll" ? payrollView(rt.id, rt.sub) : v === "reports" ? reportsView(rt.id) : v === "organization" ? organizationView() : v === "allowances" ? allowancesView() : leaveView(rt.id);
    $("hr").innerHTML = html;
    if (v === "employee" && person(rt.id) && !person(rt.id).pendingInvite) loadProfile(rt.id, rt.sub || "overview");
    if (v === "attendance" && (rt.id === "timesheets" || rt.id === "exceptions")) loadWeek(tsWeek);
    if (v === "payroll" || (v === "reports" && rt.id === "payroll")) loadPay();
    if (v === "leave" && rt.id === "settings" && leaveSettingsOk()) mountLeaveSettings(rt.sub);
    if (v === "employees" && rt.id === "settings") mountArea("employees", rt.sub);
    if (v === "attendance" && rt.id === "settings") mountArea("attendance", rt.sub);
    if (v === "crew" && rt.id === "settings") mountArea("crew", rt.sub);
    if (v === "payroll" && rt.id === "settings") mountArea("payroll", rt.sub);
    bind(rt);
    if (window.VeyoraTip) window.VeyoraTip("hr2", ctx.canHr ? [
      "**HR Overview** shows what needs attention today. Every number and item opens the page that deals with it.",
      "**Employees** opens each person's profile: employment, documents, qualifications, duty history, leave and a full activity log.",
      "**Crew Management** checks qualifications before anyone is assigned to a vessel. The same check is used by the Duty Roster."
    ] : ["Your **profile** shows your details, qualifications, leave balance and duty history.", "Use **Leave & Absence** to request leave and **Duty & Attendance** to clock in and out."]);
  }

  function on(selector, fn) { [].forEach.call(document.querySelectorAll(selector), function (b) { b.addEventListener("click", function (e) { fn(b, e); }); }); }
  function bind(rt) {
    on("[data-tab]", function (b) { tab = b.dataset.tab; render(); });
    on("[data-eview]", function (b) { empView = b.dataset.eview; render(); });
    on("[data-pulse]", function (b) {
      var v = b.dataset.pulse;
      if (v === "invite") { fEmpStatus = fEmpStatus === "Invite sent" ? "" : "Invite sent"; fStatus = ""; }
      else { fStatus = fStatus === v ? "" : v; if (fEmpStatus === "Invite sent") fEmpStatus = ""; }
      render();
    });
    var s = $("hSearch"); if (s) s.addEventListener("input", function () { fText = s.value.trim().toLowerCase(); var pos = s.selectionStart; render(); var n2 = $("hSearch"); n2.focus(); n2.setSelectionRange(pos, pos); });
    [["hRole", function (x) { fRole = x; }], ["hStatus", function (x) { fStatus = x; }], ["hDept", function (x) { fDept = x; }], ["hEmp", function (x) { fEmp = x; }], ["hEmpStatus", function (x) { fEmpStatus = x; }], ["hCat", function (x) { fCat = x; }],
     ["lvFilter", function (x) { leaveFilter = x; }], ["attFilter", function (x) { attFilter = x; }]].forEach(function (p) {
      if ($(p[0])) $(p[0]).addEventListener("change", function () { p[1](this.value); render(); });
    });
    on("[data-review]", function (b) { openReview(b.dataset.review); });
    on("[data-lvf]", function (b) { leaveFilter = b.dataset.lvf; if (b.tagName !== "A") render(); });
    on("[data-lvopen]", function (b) { leaveOpen[b.dataset.lvopen] = !leaveOpen[b.dataset.lvopen]; render(); });
    var lvs = $("lvSearch"); if (lvs) lvs.addEventListener("input", function () { leaveQuery = lvs.value; var pos = lvs.selectionStart; render(); var n2 = $("lvSearch"); n2.focus(); n2.setSelectionRange(pos, pos); });
    [].forEach.call(document.querySelectorAll("[data-count]"), function (e) {
      var to = Number(e.dataset.count) || 0;
      if (cache.lvCounted || to === 0) { e.textContent = to; return; }
      var t0 = performance.now(); (function step(t) { var k = Math.min(1, (t - t0) / 700); e.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); })(t0);
    });
    if (document.querySelector("[data-count]")) cache.lvCounted = true;
    if ($("reqLeave")) $("reqLeave").addEventListener("click", function () { openLeaveForm(ctx.me); });
    on("[data-lt-req]", function (b) { openLeaveForm(ctx.me, b.dataset.ltReq); });
    on("[data-cert]", function (b, e) { e.preventDefault(); openCertFile(b.dataset.cert); });
    if ($("qaAdd")) $("qaAdd").addEventListener("click", openInvite);
    if ($("attDay")) $("attDay").addEventListener("change", function () { attDay = this.value || todayIso(); reload(); });
    if ($("clkIn")) $("clkIn").addEventListener("click", function () { clock("in"); });
    if ($("clkOut")) $("clkOut").addEventListener("click", function () { clock("out"); });
    if ($("brkIn")) $("brkIn").addEventListener("click", function () { breakPunch("in"); });
    if ($("brkOut")) $("brkOut").addEventListener("click", function () { breakPunch("out"); });
    if ($("attCsv")) $("attCsv").addEventListener("click", function () { $("attFile").click(); });
    if ($("attFile")) $("attFile").addEventListener("change", importAttendance);
    on("[data-correct]", function (b) { openCorrect(b.dataset.correct); });
    on("[data-dcorr]", function (b) { var p = b.dataset.dcorr.split("|"), d = cache[p[0]] && cache[p[0]].duty; openCorrect(p[0], p[1], d && d.att[p[1]]); });
    on("[data-wk]", function (b) { tsWeek = b.dataset.wk; tsOpen = {}; render(); });
    if ($("tsFilter")) $("tsFilter").addEventListener("change", function () { tsFilter = this.value; render(); });
    on("[data-exf]", function (b) { excFilter = b.dataset.exf; render(); });
    on("[data-tsopen]", function (b) { tsOpen[b.dataset.tsopen] = !tsOpen[b.dataset.tsopen]; render(); });
    on("[data-tsok]", function (b) { openApproveTs(b.dataset.tsok); });
    on("[data-tsreopen]", function (b) { openReopenTs(b.dataset.tsreopen); });
    on("[data-tscorr]", function (b) { var p = b.dataset.tscorr.split("|"), w = weekPerson(p[0]), d = w && w.days.filter(function (x) { return x.day === p[1]; })[0]; openCorrect(p[0], p[1], d); });
    if ($("tsAll")) $("tsAll").addEventListener("click", approveAllTs);
    on("[data-attyes]", function (b) { decideAtt(b.dataset.attyes, true); });
    on("[data-attno]", function (b) { decideAtt(b.dataset.attno, false); });
    on("[data-assign]", function (b) { openAssign(b.dataset.assign); });
    if ($("vesselCrewNeeds")) $("vesselCrewNeeds").addEventListener("click", function () { window.VeyoraVesselCrew.open({ db: db, company: company }); });
    if ($("assignNew")) $("assignNew").addEventListener("click", function () { openAssign(null); });
    on("[data-cf]", function (b) { certFilter = b.dataset.cf; render(); });
    if ($("crewDay")) $("crewDay").addEventListener("change", function () { crewDay = this.value || todayIso(); render(); });
    if ($("crewBlocked")) $("crewBlocked").addEventListener("change", function () { crewOnlyBlocked = this.checked; render(); });
    on("[data-cal]", function (b) { calMonth = b.dataset.cal; render(); });
    if (rt.view === "employee") bindProfile(rt.id);
    if (rt.view === "payroll") bindPayroll(rt);
    if (rt.view === "organization" && window.VeyoraHrOrganization) window.VeyoraHrOrganization.bind(orgApi());
    if (rt.view === "allowances" && window.VeyoraHrAllowances) window.VeyoraHrAllowances.bind(alwApi());
    if ($("repMonth")) $("repMonth").addEventListener("change", function () { repMonth = this.value || null; render(); });
    if ($("repCsv")) $("repCsv").addEventListener("click", function () { if (repCsv) csvDownload(repCsv.name, repCsv.rows); });
  }

  function bindProfile(uid) {
    var s = person(uid); if (!s) return;
    if (s.pendingInvite) {
      if ($("pCopyInvite") && $("pInviteLink")) {
        $("pCopyInvite").addEventListener("click", function () {
          var val = $("pInviteLink").value;
          function ok() { sayInline("Invite link copied.", "ok"); }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(val).then(ok).catch(function () {
              $("pInviteLink").select();
              try { document.execCommand("copy"); ok(); } catch (e) { sayInline("Copy the link from the field.", ""); }
            });
          } else {
            $("pInviteLink").select();
            try { document.execCommand("copy"); ok(); } catch (e) { sayInline("Copy the link from the field.", ""); }
          }
        });
      }
      return;
    }
    if ($("pStatus")) $("pStatus").addEventListener("click", function () { openStatus(uid); });
    ["pLeave", "pLeave2"].forEach(function (id) { if ($(id)) $(id).addEventListener("click", function () { openLeaveForm(uid); }); });
    if ($("pEdit")) $("pEdit").addEventListener("click", function () { openEditEmployee(uid); });
    if ($("pPhoto")) $("pPhoto").addEventListener("change", function () { changePhoto(uid, this.files && this.files[0]); });
    if ($("pPhotoDel")) $("pPhotoDel").addEventListener("click", function () { removePhoto(uid); });
    (function () { var sf = (model.staff || []).filter(function (x) { return x.uid === uid; })[0]; if (sf) showPhoto(sf); })();
    if ($("cName")) $("cName").addEventListener("change", function () {
      var q = qualTypes().filter(function (x) { return String(x.name).toLowerCase() === $("cName").value.trim().toLowerCase(); })[0];
      if (q && Number(q.months) > 0 && !$("cDate").value) $("cDate").value = addMonthsIso(Number(q.months));
    });
    if ($("cAdd")) $("cAdd").addEventListener("click", function () {
      var n = $("cName").value.trim(); if (n.length < 2) { sayInline("Enter the qualification name.", "err"); return; }
      db.from("staff_certifications").insert({ company_id: company.id, user_id: uid, name: n, valid_until: $("cDate").value || null, issuer: $("cIssuer").value.trim() || null, cert_no: $("cNo").value.trim() || null }).then(function (r) {
        if (r.error) { sayInline(r.error.message, "err"); return; } delete cache[uid]; reload();
      });
    });
    on("[data-renew]", function (b) {
      $("cName").value = b.dataset.renew; $("cName").dispatchEvent(new Event("change")); $("cDate").value = "";
      var q = qualTypes().filter(function (x) { return String(x.name).toLowerCase() === b.dataset.renew.toLowerCase(); })[0];
      if (q && Number(q.months) > 0) $("cDate").value = addMonthsIso(Number(q.months));
      $("cIssuer").focus(); sayInline("Fill in the new certificate's details and click Add. The old one stays as history.", "");
    });
    on("[data-delcert]", function (b) {
      if (!confirm("Remove this qualification record?")) return;
      db.from("staff_certifications").delete().eq("id", b.dataset.delcert).then(function (r) { if (r.error) sayInline(r.error.message, "err"); else { delete cache[uid]; reload(); } });
    });
    on("[data-dl]", function (b) {
      db.storage.from("staff-documents").createSignedUrl(b.dataset.dl, 120).then(function (r) {
        if (r.error) { sayInline(r.error.message, "err"); return; }
        return fetch(r.data.signedUrl, { cache: "no-store" }).then(function (res) { return res.blob(); }).then(function (blob) {
          var url = URL.createObjectURL(blob); var a = document.createElement("a"); a.href = url; a.download = b.dataset.fn || "document"; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        });
      });
    });
    on("[data-deldoc]", function (b) {
      if (!confirm("Remove this document and its file?")) return;
      db.from("staff_documents").delete().eq("id", b.dataset.deldoc).then(function (r) { if (r.error) sayInline(r.error.message, "err"); else { delete cache[uid]; render(); } });
    });
    if ($("dAdd")) $("dAdd").addEventListener("click", function () { uploadStaffDoc(uid); });
    if ($("pPayEdit")) $("pPayEdit").addEventListener("click", function () { openPayEdit(uid); });
    on("[data-myslip]", function (b) { var sl = cache[uid] && cache[uid].pay && cache[uid].pay.slips[Number(b.dataset.myslip)]; if (sl) openSlip(sl.run, sl); });
    if ($("dCat")) $("dCat").addEventListener("change", function () { if (this.value === "Disciplinary" || this.value === "Contract") $("dVis").value = "hr_only"; });
  }

  /* ---------- dialogs ---------- */
  function openModal(html, wide) { $("modalCard").className = "modal-card" + (wide === "xwide" ? " wide xwide" : wide ? " wide" : ""); $("modalCard").innerHTML = html; $("modal").hidden = false; var f = $("modalCard").querySelector("input,select,textarea"); if (f) f.focus(); }
  function closeModal() { $("modal").hidden = true; $("modalCard").innerHTML = ""; $("modalCard").oninput = null; $("modalCard").onchange = null; }
  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  function sayInline(t, k) { var m = $("mMsgInline"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  function reload() { return load(company, ctx).then(function (m) { model = m; cache.impact = null; cache.ts = {}; tsGen++; cache.pay = null; Object.keys(cache).forEach(function (k) { if (k.indexOf("avail:") === 0) delete cache[k]; }); render(); }); }
  function rpc(name, args) { return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }
  function options(list, cur, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : "") + list.map(function (p) { var v = Array.isArray(p) ? p[0] : p, t = Array.isArray(p) ? p[1] : p; return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + '>' + esc(t) + '</option>'; }).join(""); }

  function openStatus(uid) {
    var s = person(uid);
    openModal('<h2>Change status</h2><p class="note">' + esc(s.name) + ' is <b>' + esc(s.shownStatus) + '</b>.</p>' +
      '<div class="fld"><label for="sNew">New status</label><select id="sNew">' + options([["Active", "Active: works normally"], ["Suspended", "Suspended: keeps their login, cannot be rostered or assigned a vessel"], ["Former", "Former employee: login removed, kept in records"]], s.status) + '</select></div>' +
      '<div class="fld" id="sEndWrap"><label for="sEnd">Last working day</label><input id="sEnd" type="date" value="' + todayIso() + '"><small class="hint">Roster shifts after this day are removed.</small></div>' +
      '<div class="fld"><label for="sWhy">Reason (only HR and ' + esc(s.name.split(" ")[0]) + ' can see it)</label><input id="sWhy" maxlength="200" value="' + esc(s.reason) + '"></div>' +
      '<p class="msg" id="mMsg" role="status"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="sGo">Save status</button></div>');
    function sync() { $("sEndWrap").hidden = $("sNew").value !== "Former"; }
    $("sNew").addEventListener("change", sync); sync();
    $("sGo").addEventListener("click", function () {
      var st = $("sNew").value;
      if (st === "Former" && !confirm(s.name + " will lose access to " + company.name + " and be removed from the roster after " + fmtDate($("sEnd").value || todayIso()) + ". Continue?")) return;
      rpc("set_member_status", { p_company: company.id, p_user: uid, p_status: st, p_end_date: st === "Former" ? ($("sEnd").value || null) : null, p_reason: $("sWhy").value.trim() || null })
        .then(function (n) { closeModal(); delete cache[uid]; return reload().then(function () { if (n) alert(n + " future roster shift" + (n > 1 ? "s were" : " was") + " removed."); }); })
        .catch(function (e) { say(e.message, "err"); });
    });
  }
  function openEditEmployee(uid) {
    var s = person(uid);
    if (!s || s.pendingInvite || typeof window.VeyoraOpenAddEmployee !== "function") return;
    window.VeyoraOpenAddEmployee({
      db: db, company: company, model: model, ctx: ctx,
      esc: esc, $: $, openModal: openModal, closeModal: closeModal, say: say,
      options: options, rpc: rpc, icon: icon, I: I,
      staffCats: staffCats, empTypes: empTypes, shiftDefs: shiftDefs,
      formSetting: formSetting, listSetting: listSetting,
      todayIso: todayIso, fmtDate: fmtDate,
      reload: function () { delete cache[uid]; return reload(); },
      edit: s
    });
  }
  function openAssign(uid) {
    var crew = activeStaff().filter(function (s) { return s.group !== "Shore" || s.uid === uid; }), s = uid ? person(uid) : null;
    var vessels = []; activeStaff().forEach(function (x) { if (x.vessel && vessels.indexOf(x.vessel) < 0) vessels.push(x.vessel); });
    openModal('<h2>' + (s ? (s.vessel ? "Move " : "Assign ") + esc(s.name) : "Assign crew to a vessel") + '</h2><p class="note">Status, leave and required qualifications are checked first. If something is wrong you\'ll see why.</p>' +
      (s ? "" : '<div class="fld"><label for="vWho">Crew member</label><select id="vWho">' + options(crew.map(function (x) { return [x.uid, x.name + " · " + x.position + (x.vessel ? " · on " + x.vessel : "")]; }), "", "Choose a person…") + '</select></div>') +
      '<div class="fld"><label for="vName">Vessel</label><input id="vName" list="vList" maxlength="60" value="' + esc(s ? s.vessel : "") + '" placeholder="e.g. HT-203"><datalist id="vList">' + vessels.map(function (v) { return '<option value="' + esc(v) + '">'; }).join("") + '</datalist><small class="hint">Leave empty to take them off their vessel.</small></div>' +
      '<p class="msg" id="mMsg" role="status"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="vGo">Save</button></div>');
    $("vGo").addEventListener("click", function () {
      var id = uid || $("vWho").value; if (!id) { say("Choose a crew member.", "err"); return; }
      rpc("set_member_hr", { p_company: company.id, p_user: id, p_patch: { assigned_vessel: $("vName").value.trim() } })
        .then(function () { closeModal(); delete cache[id]; reload(); }).catch(function (e) { say(e.message, "err"); });
    });
  }

  function geoThen(cb) {
    if (!attRules().geo) { cb(null, null); return; }
    if (!navigator.geolocation) { alert("Location is required but this browser cannot provide it."); return; }
    navigator.geolocation.getCurrentPosition(function (p) { cb(p.coords.latitude, p.coords.longitude); }, function () { alert("Allow location to clock in."); });
  }
  // This browser's device ID, shared with the IT page (IT Settings can require registered devices for clock-in).
  function deviceKey() {
    var k = null; try { k = localStorage.getItem("veyora-device-key"); } catch (e) {}
    if (!k) { var a = new Uint8Array(16); crypto.getRandomValues(a); k = [].map.call(a, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); try { localStorage.setItem("veyora-device-key", k); } catch (e) {} }
    return k;
  }
  function clockRefused(kind, msg, what) {
    openModal('<h2>Clock ' + kind + '</h2><p class="msg err">' + esc(msg) + '</p>' + (what === "device" ? '<p class="note"><a href="it.html#devices">Register this device</a> or ask IT.</p>' : what === "network" ? '<p class="note">If you are in the office, ask IT to check the approved networks.</p>' : "") +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Close</button></div>');
  }
  // Network and device rules are checked first (so a refused attempt is logged for IT), then clock_punch checks them again.
  function clock(kind) {
    geoThen(function (lat, lng) {
      var dev = deviceKey();
      db.rpc("punch_check", { p_company: company.id, p_device: dev }).then(function (c) {
        if (c.data && c.data.ok === false) { clockRefused(kind, c.data.reason, c.data.kind); return; }
        return db.rpc("clock_punch", { p_company: company.id, p_kind: kind, p_lat: lat, p_lng: lng, p_device: dev }).then(function (r) {
          if (r.error) { clockRefused(kind, r.error.message); return; }
          reload();
        });
      });
    });
  }
  function breakPunch(kind) {
    db.rpc("break_punch", { p_company: company.id, p_kind: kind }).then(function (r) {
      if (r.error) { clockRefused("break " + kind, r.error.message); return; }
      reload();
    });
  }
  function decideAtt(id, ok) { db.rpc("decide_attendance_correction", { p_id: id, p_approve: ok }).then(function (r) { if (r.error) alert(r.error.message); else reload(); }); }
  function openCorrect(uid, day, rec) {
    day = day || attDay || todayIso();
    var s = person(uid), a = rec || (day === model.attDay ? model.attBy[uid] : null) || {};
    if (!s) return;
    var t = function (ts) { return ts ? new Date(ts).toTimeString().slice(0, 5) : ""; };
    openModal('<h2>Correct attendance</h2><p class="note">' + esc(s.name) + ' · ' + esc(fmtDate(day)) + (attRules().approval && !ctx.canHr ? '. This waits for HR approval.' : "") + '</p>' +
      '<div class="cards"><div class="fld"><label for="aIn">Clock in</label><input id="aIn" type="time" value="' + t(a.clock_in) + '"></div>' +
      '<div class="fld"><label for="aOut">Clock out</label><input id="aOut" type="time" value="' + t(a.clock_out) + '"></div></div>' +
      '<div class="fld"><label for="aSt">Status (optional)</label><select id="aSt"><option value="">Keep calculated status</option>' +
      ["Present", "Late", "Absent", "On leave", "Rest day", "Missed punch"].map(function (x) { return '<option>' + x + '</option>'; }).join("") + '</select><small class="hint">Now: ' + esc(a.status || "no record") + '. Leave it on calculated unless the times can\'t show it (for example, on leave).</small></div>' +
      '<div class="fld"><label for="aWhy">Reason</label><input id="aWhy" maxlength="200" required></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="aGo">Save correction</button></div>');
    $("aGo").addEventListener("click", function () {
      var why = $("aWhy").value.trim(); if (why.length < 2) { say("Give a reason.", "err"); return; }
      var toTs = function (v) { return v ? new Date(day + "T" + v + ":00") : null; };
      var tin = toTs($("aIn").value), tout = toTs($("aOut").value);
      if (tin && tout && tout <= tin) tout.setDate(tout.getDate() + 1); // night shift: out is the next morning
      db.rpc("correct_attendance", { p_company: company.id, p_user: uid, p_day: day, p_in: tin && tin.toISOString(), p_out: tout && tout.toISOString(), p_status: $("aSt").value || null, p_reason: why }).then(function (r) {
        if (r.error) { say(r.error.message, "err"); return; }
        closeModal(); delete cache[uid]; reload();
      });
    });
  }
  function importAttendance() {
    var f = $("attFile").files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var lines = String(reader.result).replace(/^﻿/, "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var head = lines[0].toLowerCase().split(",").map(function (h) { return h.trim().replace(/"/g, ""); });
      var iEmp = head.indexOf("employee_no"), iDate = head.indexOf("date"), iIn = head.indexOf("clock_in"), iOut = head.indexOf("clock_out");
      if (iEmp < 0 || iDate < 0) { openModal('<h2>Import CSV</h2><p class="note">The first row must include employee_no, date, clock_in, clock_out.</p><div class="modal-actions"><button type="button" class="ghost" data-close>Close</button></div>'); return; }
      var rows = lines.slice(1).map(function (line) {
        var c = line.split(",").map(function (x) { return x.trim().replace(/^"|"$/g, ""); });
        return { employee_no: c[iEmp], date: c[iDate], clock_in: iIn > -1 ? c[iIn] : "", clock_out: iOut > -1 ? c[iOut] : "" };
      });
      db.rpc("import_attendance", { p_company: company.id, p_rows: rows }).then(function (r) {
        if (r.error) openModal('<h2>Import CSV</h2><p class="msg err">' + esc(r.error.message) + '</p><div class="modal-actions"><button type="button" class="ghost" data-close>Close</button></div>');
        else reload();
      });
    };
    reader.readAsText(f); $("attFile").value = "";
  }

  function uploadStaffDoc(uid) {
    var title = $("dTitle").value.trim(), file = $("dFile").files[0], cat = $("dCat").value, store = docStore();
    if (title.length < 2) { sayInline("Give the document a title.", "err"); return; }
    if (!file) { sayInline("Choose a file to upload.", "err"); return; }
    var maxMb = Number(store.maxMb) || 10;
    if (file.size > maxMb * 1048576) { sayInline("That file is larger than " + maxMb + " MB.", "err"); return; }
    var types = store.types || "PDF & images";
    var ok = /pdf|image\//.test(file.type) || (types.indexOf("Office") > -1 && /word|excel|spreadsheet|msword/.test(file.type)) || types === "Any";
    if (!ok) { sayInline("Allowed files: " + types + " (Settings → Document Storage Settings).", "err"); return; }
    sayInline("Uploading…");
    db.from("staff_documents").insert({
      company_id: company.id, user_id: uid, category: cat, title: title, reference_no: $("dRef").value.trim() || null,
      issue_date: $("dIssue").value || null, expiry_date: $("dExp").value || null, qualification_name: $("dQual").value.trim() || null, visibility: $("dVis").value
    }).select().single().then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
      var path = company.id + "/" + uid + "/" + r.data.id + "/v1." + ext;
      return db.storage.from("staff-documents").upload(path, file, { upsert: true, contentType: file.type }).then(function (up) {
        if (up.error) throw new Error(up.error.message);
        return db.from("staff_documents").update({ file_path: path, file_name: file.name, version: 1 }).eq("id", r.data.id).then(function (u) {
          if (u.error) throw new Error(u.error.message);
          return db.from("staff_document_versions").insert({ document_id: r.data.id, version: 1, file_path: path, file_name: file.name, uploaded_by: ctx.me });
        });
      });
    }).then(function () { delete cache[uid]; render(); }).catch(function (e) { sayInline(e.message, "err"); });
  }

  // A certificate lives in the private bucket; open it through a short-lived link (only its owner, HR and the approver can).
  function openCertFile(path) {
    db.storage.from("leave-certificates").createSignedUrl(path, 300).then(function (r) {
      if (r.error || !r.data) { alert("You can't open that file."); return; }
      window.open(r.data.signedUrl, "_blank", "noopener");
    });
  }
  function openLeaveForm(uid, preType) {
    var s = person(uid), types = leaveTypes(), wf = workflow();
    var first = types.some(function (t) { return t.name === preType; }) ? preType : (types[0] ? types[0].name : "");
    var whoTxt = uid === ctx.me ? "yourself" : (s ? s.name : "this person");
    openModal('<h2>Request leave</h2><p class="note">For ' + esc(whoTxt) + '. ' + (wf.enabled === false ? "Leave approval is switched off, so this is approved straight away." : "It goes to the right approver automatically.") + '</p>' +
      '<div class="fld"><label id="lTypeLbl">Leave type</label><div class="lt-list" id="lTypeList" role="radiogroup" aria-labelledby="lTypeLbl">' + types.map(function (t, i) { return leaveTypeCard(t, i, uid, "pick", t.name === first); }).join("") + '</div><input type="hidden" id="lType" value="' + esc(first) + '"><small id="lBal" class="lt-summary" style="display:block"></small></div>' +
      '<div class="fld" id="lCertWrap" hidden><label for="lCert">Medical certificate</label><select id="lCert"><option value="yes">With a certificate</option><option value="no">Without a certificate</option></select><small id="lCertNote" class="muted-cell" style="display:block;margin-top:6px"></small></div>' +
      '<div class="fld" id="lFileWrap" hidden><label for="lFile">Certificate file</label><input id="lFile" type="file" accept="application/pdf,image/*"><small id="lFileNote" class="muted-cell" style="display:block;margin-top:6px"></small></div>' +
      '<div class="cards"><div class="fld"><label for="lFrom">From</label><input id="lFrom" type="date" value="' + todayIso() + '"></div><div class="fld"><label for="lTo">To</label><input id="lTo" type="date" value="' + todayIso() + '"></div></div>' +
      '<div class="fld"><label for="lNote" id="lNoteLabel">Note (optional)</label><input id="lNote" maxlength="200"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="lSend">Submit request</button></div>', true);
    [].forEach.call(document.querySelectorAll("#lTypeList [data-lt]"), function (b) {
      b.addEventListener("click", function () {
        $("lType").value = b.dataset.lt;
        [].forEach.call(document.querySelectorAll("#lTypeList [data-lt]"), function (x) { var on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on ? "true" : "false"); });
        balance();
      });
    });
    function typeInfo() { return types.filter(function (t) { return t.name === $("lType").value; })[0] || {}; }
    function balance() {
      var t = typeInfo(), a = $("lFrom").value, b = $("lTo").value, req = a && b && b >= a ? workingDays(a, b) : 0;
      var used = usedDays(uid, t.name), limit = Number(t.days) || 0;
      $("lBal").textContent = (t.paid === false ? "Unpaid · " : "Paid · ") + (limit ? (limit - used) + " of " + limit + " working days left this year" : "No yearly limit") + (req ? " · this request: " + req + " working day" + (req === 1 ? "" : "s") : "");
      $("lNoteLabel").textContent = t.note ? "Note (required)" : "Note (optional)";
      // Medical certificate rules (Leave Types & Policies). The database enforces them; this only explains them.
      var mode = t.cert === "Optional" || t.cert === "Required" ? t.cert : "";
      $("lCertWrap").hidden = !mode;
      if (mode === "Required") { $("lCert").value = "yes"; $("lCert").disabled = true; $("lCertNote").textContent = "A medical certificate is required for " + t.name + "."; }
      else if (mode === "Optional") {
        $("lCert").disabled = false;
        var nc = Number(t.nocert) || 0, run = Number(t.nocertRun) || 0, ncUsed = usedNoCert(uid, t.name), bits = [];
        if (nc) bits.push((nc - ncUsed) + " of " + nc + " days left without a certificate this year");
        if (run) bits.push("at most " + run + " day" + (run === 1 ? "" : "s") + " in a row without one");
        $("lCertNote").textContent = bits.length ? "Without a certificate: " + bits.join(", ") + "." : "";
      }
      // Certificate file: only for your own request (the file is stored in your own folder).
      var withFile = mode && $("lCert").value === "yes" && uid === ctx.me;
      $("lFileWrap").hidden = !withFile;
      if (withFile) $("lFileNote").textContent = (t.certFile ? "Required. " : "Optional. ") + "A photo or PDF, up to 10 MB. Only you, HR and the approver can open it.";
      return { t: t, req: req, used: used, limit: limit, mode: mode };
    }
    ["lType", "lFrom", "lTo", "lCert"].forEach(function (id) { $(id).addEventListener("change", balance); });
    balance();
    $("lSend").addEventListener("click", function () {
      var a = $("lFrom").value, b = $("lTo").value, info = balance();
      if (!a || !b || b < a) { say("Choose valid dates. The end date can't be before the start.", "err"); return; }
      if (!info.req) { say("Those dates are all weekend days.", "err"); return; }
      if (info.t.note && !$("lNote").value.trim()) { say("A note is required for " + info.t.name + ".", "err"); return; }
      if (info.limit && info.used + info.req > info.limit) { say("That's more than the " + info.limit + " working days of " + info.t.name + " allowed this year (" + info.used + " used).", "err"); return; }
      var withCert = info.mode ? $("lCert").value === "yes" : null, file = $("lFile").files && $("lFile").files[0];
      if (withCert && info.t.certFile && uid === ctx.me && !file) { say("Attach a copy of the medical certificate for " + info.t.name + ".", "err"); return; }
      if (file && (file.size > 10485760 || !/^(application\/pdf|image\/)/.test(file.type))) { say("The certificate must be a PDF or a photo, up to 10 MB.", "err"); return; }
      function save(path, name) {
        return db.from("leave_requests").insert({ company_id: company.id, user_id: uid, leave_type: info.t.name, start_date: a, end_date: b, note: $("lNote").value.trim() || null, certificate: withCert, certificate_path: path || null, certificate_name: name || null }).then(function (r) {
          if (r.error) { say(r.error.message, "err"); return; } closeModal(); delete cache[uid]; reload();
        });
      }
      if (withCert && file && uid === ctx.me) {
        say("Uploading the certificate…");
        var ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
        var path = company.id + "/" + uid + "/" + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2)) + "." + ext;
        db.storage.from("leave-certificates").upload(path, file, { contentType: file.type }).then(function (u) {
          if (u.error) { say(u.error.message, "err"); return; }
          return save(path, file.name);
        });
      } else save(null, null);
    });
  }

  function openReview(id) {
    var l = model.leave.filter(function (x) { return x.id === id; })[0]; if (!l) return;
    var wf = workflow(), need = wf.comment === true, t = leaveTypes().filter(function (x) { return x.name === l.type; })[0] || {}, lim = Number(t.days) || 0;
    var used = usedDays(l.uid, l.type, l.id), wd = workingDays(l.start, l.end);
    openModal('<h2>Review leave</h2><p class="note">' + esc(l.name) + ' · routed to ' + esc(routedTo(l)) + '</p><ul class="rows"><li class="row"><span class="grow"><strong>' + esc(l.type) + '</strong><small>' + esc(fmtRange(l.start, l.end)) + ' · ' + wd + ' working days' + (lim ? ' · ' + (lim - used) + ' of ' + lim + ' left before this request' : "") + '</small></span></li>' +
      (l.note ? '<li class="row"><span class="grow"><small>' + esc(l.note) + '</small></span></li>' : "") + '<li class="row"><span class="grow"><small id="rImpact">Checking the roster…</small></span></li></ul>' +
      '<div class="fld" style="margin-top:12px"><label for="rNote">Comment' + (need ? " (required)" : " (optional)") + '</label><input id="rNote" maxlength="200"></div><p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Close</button><button type="button" class="ghost danger" id="rNo">Reject</button><button type="button" class="save" id="rYes">Approve</button></div>');
    db.from("roster_entries").select("day, shift").eq("company_id", company.id).eq("user_id", l.uid).gte("day", l.start).lte("day", l.end).not("shift", "in", '("OFF","L")').then(function (r) {
      var n = (r.data || []).length, el = $("rImpact"); if (!el) return;
      el.innerHTML = n ? '<span class="exp">' + n + ' rostered working shift' + (n > 1 ? "s" : "") + ' in these dates (' + esc((r.data || []).map(function (x) { return fmtRange(x.day, x.day) + " " + x.shift; }).join(", ")) + '). Approving shows them as leave; arrange cover on the <a href="roster.html">Duty Roster</a>.</span>' : "No rostered working shifts in these dates.";
    });
    function decide(ok) {
      var note = $("rNote").value.trim();
      if (need && !note) { say("A comment is required.", "err"); return; }
      db.rpc("decide_leave", { p_id: id, p_approve: ok, p_note: note || null }).then(function (r) { if (r.error) say(r.error.message, "err"); else { closeModal(); delete cache[l.uid]; reload(); } });
    }
    $("rYes").addEventListener("click", function () { decide(true); });
    $("rNo").addEventListener("click", function () { decide(false); });
  }

  // Cursor 2026-10-23: full Add New Employee wizard (mock); falls back to simple invite if script missing.
  function openInvite() {
    if (typeof window.VeyoraOpenAddEmployee === "function") {
      window.VeyoraOpenAddEmployee({
        db: db, company: company, model: model, ctx: ctx,
        esc: esc, $: $, openModal: openModal, closeModal: closeModal, say: say,
        options: options, rpc: rpc, icon: icon, I: I,
        staffCats: staffCats, empTypes: empTypes, shiftDefs: shiftDefs,
        formSetting: formSetting, listSetting: listSetting,
        todayIso: todayIso, fmtDate: fmtDate, reload: reload
      });
      return;
    }
    openModal('<h2>Add employee</h2><p class="note">Invite someone to join ' + esc(company.name) + '. They get a link to set a password, then appear under Employees.</p>' +
      '<div class="fld"><label for="iMail">Email</label><input id="iMail" type="email" placeholder="name@email.com"></div>' +
      '<div class="fld"><label for="iRole">Access role</label><select id="iRole"><option value="staff">Staff</option><option value="operations">Operations</option><option value="hr">HR</option><option value="it">IT</option><option value="admin">Admin</option></select></div>' +
      '<p class="msg" id="mMsg" role="status"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="iGo">Create invite</button></div>');
    $("iGo").addEventListener("click", function () {
      var mail = $("iMail").value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { say("Enter a valid email.", "err"); return; }
      db.from("company_invites").insert({ company_id: company.id, email: mail, role: $("iRole").value }).select().single().then(function (r) {
        if (r.error) { say(r.error.message, "err"); return; }
        var url = location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html?invite=" + r.data.token;
        openModal('<h2>Invite created</h2><p class="note">Send this link to ' + esc(mail) + '. It works for 7 days.</p><div class="fld"><input id="iLink" readonly value="' + esc(url) + '"></div><p class="msg" id="mMsg"></p><div class="modal-actions"><button type="button" class="ghost" data-close>Done</button><button type="button" class="save" id="iCopy">Copy link</button></div>');
        $("iCopy").addEventListener("click", function () { $("iLink").select(); (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { say("Copied.", "ok"); }, function () { say("Press Cmd+C to copy.", ""); }); });
      });
    });
  }
  $("addCrew").addEventListener("click", openInvite);

  $("sampleToggle").addEventListener("click", function () {
    sampleOn = !sampleOn; try { localStorage.setItem(SAMPLE_KEY, sampleOn ? "1" : "0"); } catch (e) {} render();
  });
  window.addEventListener("hashchange", function () { if (!$("modal").hidden) closeModal(); render(); window.scrollTo(0, 0); });

  // Duty status follows the roster, so re-check it when you come back to this tab and every minute (not while a window is open).
  function refresh() {
    if (!model || !company || document.hidden || !$("modal").hidden) return;
    var c = company;
    load(c, ctx).then(function (m) {
      if (company !== c || !$("modal").hidden) return;
      var key = function (x) { return x.staff.map(function (s) { return s.duty + s.status; }).join() + x.leave.map(function (l) { return l.status; }).join() + Object.keys(x.attBy).map(function (k) { return x.attBy[k].status; }).join(); };
      if (key(m) !== key(model)) { model = m; render(); }
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", refresh);
  setInterval(refresh, 60000);

  /* ---------- start ---------- */
  window.VeyoraShell.start({
    active: "HR & Crew",
    onCompany: function (c, info) {
      company = c; ctx = info; model = null; cache = {}; tab = null; fText = ""; fRole = ""; fStatus = ""; fDept = ""; fEmp = ""; fEmpStatus = ""; fCat = "";
      attDay = todayIso(); attFilter = ""; tsWeek = weekStartOf(todayIso()); tsFilter = ""; excFilter = ""; tsOpen = {}; crewDay = todayIso(); certFilter = ""; leaveFilter = "Pending"; calMonth = null;
      $("hr").innerHTML = '<p class="msg">Loading…</p>';
      // Cursor 2026-10-23: backfill Add-Employee drafts for people who joined before accept_invite applied them (0050).
      var ready = Promise.resolve();
      if (info.canHr) {
        ready = db.rpc("apply_pending_employee_profiles", { p_company: c.id }).then(function () {}, function () {});
      }
      return ready.then(function () { return load(c, info); }).then(function (m) { model = m; render(); });
    },
    onNone: function (isPlatform) {
      $("hr").innerHTML = '<section class="dash-card"><h2>' + (isPlatform ? "Select a company" : "No company yet") + '</h2><p class="note">' + (isPlatform ? "Use the company menu at the top left to open a company." : "Create a company from the sign-in page, or ask your administrator for an invite.") + '</p></section>';
    },
    onError: function (err) { $("hr").innerHTML = '<section class="dash-card"><h2>Could not load HR &amp; Crew</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
