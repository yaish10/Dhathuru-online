/* HR → Job descriptions. One description per designation (job title), stored in company setting 8_job_descriptions as
   { <job_title_id>: { summary, reportsTo, employment, hours, grade, conditions, responsibilities[], requirements[], skills[], quals[], updated_at, updated_by } }.
   HR, owners and admins write them; every member can read them. No database change: the setting uses the HR prefix (8_) and set_company_setting. */
(function () {
  var KEY = "8_job_descriptions";
  var EMPLOYMENT = ["Full-time", "Part-time", "Contract", "Seasonal", "Casual"];
  var STARTERS = [
    { name: "Captain / Master", match: /captain|master|skipper/i, summary: "Responsible for the safe navigation and operation of the vessel, the safety of passengers and crew, and compliance with maritime regulations on every trip.",
      responsibilities: ["Command the vessel safely and navigate to the scheduled route and timetable", "Carry out pre-departure checks and make sure safety equipment is on board and working", "Brief and lead the crew; make sure duty hours and rest rules are followed", "Make the go / no-go decision in bad weather and report incidents immediately", "Keep the logbook and trip records accurate and complete", "Make sure passenger numbers never exceed the vessel's limit"],
      requirements: ["Valid captain's licence for the vessel class and route", "Proven experience operating similar vessels", "Good knowledge of local waters and harbours"], skills: ["Navigation", "Leadership", "Decision making under pressure", "Communication"], quals: [] },
    { name: "Deckhand / Crew", match: /deck|crew|sailor|mate/i, summary: "Helps run the vessel safely on every trip: mooring, boarding, loading and keeping the deck, passengers and equipment safe.",
      responsibilities: ["Handle mooring and casting off lines", "Help passengers board and disembark safely", "Load and secure luggage and cargo", "Keep the deck, life jackets and safety equipment clean and ready", "Keep watch and report hazards or incidents to the captain", "Follow the captain's instructions and safety procedures"],
      requirements: ["Basic safety training certificate", "Able to swim and work in a marine environment", "Physically fit for manual handling"], skills: ["Teamwork", "Safety awareness", "Customer care"], quals: [] },
    { name: "Engineer", match: /engineer|mechanic/i, summary: "Keeps the vessel's engines and systems running safely and reliably, and carries out planned maintenance and repairs.",
      responsibilities: ["Start up, monitor and shut down engines and onboard systems", "Carry out planned maintenance and record running hours", "Diagnose and fix faults, and report defects to Maintenance", "Keep spare parts and fuel records up to date", "Follow safety and environmental procedures in the engine room"],
      requirements: ["Marine engineering certificate or equivalent experience", "Experience with diesel marine engines"], skills: ["Fault finding", "Record keeping", "Safety awareness"], quals: [] },
    { name: "Cashier / Purser", match: /cashier|purser|ticket/i, summary: "Sells and checks tickets, looks after passengers' needs on board and handles cash and records accurately.",
      responsibilities: ["Sell tickets and check passenger lists and manifests", "Handle cash, cards and receipts and reconcile at the end of each shift", "Welcome and assist passengers, including queries and complaints", "Make safety announcements when asked by the captain", "Report discrepancies, incidents and lost property"],
      requirements: ["Experience in customer service or cash handling", "Basic computer / mobile app skills"], skills: ["Customer service", "Accuracy", "Communication"], quals: [] },
    { name: "General (blank)", match: /$^/, summary: "", responsibilities: [], requirements: [], skills: [], quals: [] }
  ];

  /* Wording for the printed job description form, per language. A company picks one in Language & format. Dhivehi is right-to-left. */
  var FORMAT_KEY = "8_job_description_format";
  var LANGS = { "English": { dir: "ltr", font: "", name: "English" }, "Dhivehi": { dir: "rtl", font: '"MV Faruma","Faruma","Noto Sans Thaana","Mv Boli",serif', name: "ދިވެހި" } };
  var LABELS = {
    "English": { bismillah: "", title: "Job description", s1: "Employee details", s2: "Position details", s3: "Job details", s4: "Responsibilities and duties", s5: "Requirements, qualifications and skills", s6: "Working conditions and notes", s7: "Signatures",
      name: "Name", idNo: "ID card number", staffNo: "Staff number", dob: "Date of birth", designation: "Designation", dept: "Department / section", joined: "Date joined", employment: "Employment type",
      permanent: "Permanent", contract: "Contract", other: "Other", company: "Company", reportsTo: "Reports to", purpose: "Purpose of the role", hours: "Working hours", grade: "Grade / band", issued: "Date issued", reviewed: "Last reviewed",
      quals: "Certificates and qualifications", skills: "Skills", employee: "Employee", supervisor: "Supervisor", hr: "HR", signature: "Signature", date: "Date", none: "—", page: "Page" },
    "Dhivehi": { bismillah: "بسم الله الرحمن الرحيم", title: "ވަޒީފާ ބަޔާން", s1: "މުވައްޒަފުގެ މަޢުލޫމާތު", s2: "ވަޒީފާގެ މަޤާމްގެ މަޢުލޫމާތު", s3: "ވަޒީފާގެ ތަފްސީލު", s4: "ޒިންމާތަކާއި ވާޖިބުތައް", s5: "ޝަރުތުތަކާއި ސެޓްފިކެޓް އަދި ހުނަރުތައް", s6: "މަސައްކަތުގެ ޙާލަތާއި ނޯޓްތައް", s7: "ސޮއިތައް",
      name: "ނަން", idNo: "ދ.ރ.ކ. ނަންބަރު", staffNo: "ސްޓާފް ނަންބަރު", dob: "އުފަން ތާރީޚް", designation: "މަޤާމް", dept: "ސެކްޝަން / ޑިޕާޓްމަންޓް", joined: "ވަޒީފާ ފެށި ތާރީޚް", employment: "ވަޒީފާގެ ބާވަތް",
      permanent: "ދާއިމީ", contract: "ކޮންޓްރެކްޓް", other: "އެހެނިހެން", company: "ކުންފުނި", reportsTo: "ރިޕޯޓް ކުރާނީ", purpose: "ވަޒީފާގެ މަޤްސަދު", hours: "މަސައްކަތު ގަޑި", grade: "ގްރޭޑް", issued: "ދޫކުރި ތާރީޚް", reviewed: "އާ ކުރި ތާރީޚް",
      quals: "ސެޓްފިކެޓްތަކާއި ޝަރުތު", skills: "ހުނަރުތައް", employee: "މުވައްޒަފު", supervisor: "ސުޕަވައިޒަރު", hr: "އެޗް.އާރ.", signature: "ސޮއި", date: "ތާރީޚް", none: "—", page: "ސަފްޙާ" }
  };
  function fmtOf(api) {
    var f = api.company.settings && api.company.settings[FORMAT_KEY];
    f = f && typeof f === "object" ? f : {};
    return { language: LANGS[f.language] ? f.language : "English", bismillah: f.bismillah === true, letterhead: f.letterhead !== false, employee: f.employee !== false, sign: f.sign !== false, labels: f.labels && typeof f.labels === "object" ? f.labels : {} };
  }
  function labelsOf(api) { var f = fmtOf(api), base = LABELS[f.language] || LABELS.English, out = {}; Object.keys(base).forEach(function (k) { out[k] = (f.labels[f.language] && f.labels[f.language][k]) || base[k]; }); return out; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function icon(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var I = {
    doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>', check: '<path d="m5 12 5 5 9-10"/>', plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    print: '<path d="M7 9V3h10v6M7 17H4V9h16v8h-3M7 14h10v7H7z"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>', back: '<path d="m15 6-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', shield: '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/>'
  };
  function lines(t) { return String(t || "").split(/\n+/).map(function (x) { return x.replace(/^[\s\-•*]+/, "").trim(); }).filter(Boolean); }
  function fmtDate(ts) { if (!ts) return ""; var d = new Date(ts); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  function store(api) { var s = api.company.settings && api.company.settings[KEY]; return s && typeof s === "object" && !Array.isArray(s) ? s : {}; }
  function titles(api) { return (api.model.titles || []).slice().sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); }); }
  function deptName(api, id) { var d = (api.model.depts || []).filter(function (x) { return x.id === id; })[0]; return d ? d.name : ""; }
  function staffCount(api, id) { return (api.model.staff || []).filter(function (s) { return s.titleId === id && s.active; }).length; }
  function has(jd) { return !!(jd && (jd.summary || (jd.responsibilities || []).length)); }
  function stale(jd) { return jd && jd.updated_at && (Date.now() - new Date(jd.updated_at).getTime()) > 365 * 864e5; }
  function canEdit(api) { return !!(api.ctx && (api.ctx.canHr || api.ctx.isAdmin || api.ctx.isPlatform)); }

  function render(api, rt) {
    var st = api.jobState || (api.jobState = { q: "", f: "", edit: false, msg: "" });
    if (rt && rt.id) return detail(api, st, rt.id);
    if (st.design && canEdit(api)) {
      if (!st.tpl) st.tpl = JSON.parse(JSON.stringify(window.VeyoraJd.get(api)));
      var dl = titles(api), dj = store(api), dt = dl.filter(function (x) { return has(dj[x.id]); })[0] || dl[0] || { id: "", title: "Designation" };
      var sj = has(dj[dt.id]) ? dj[dt.id] : Object.assign({ updated_at: new Date().toISOString() }, STARTERS[0]);
      st.dd = { t: dt, jd: sj };
      return window.VeyoraJd.designerHtml(api, st, dt, sj);
    }
    var jds = store(api), list = titles(api);
    var written = list.filter(function (t) { return has(jds[t.id]); }).length, old = list.filter(function (t) { return has(jds[t.id]) && stale(jds[t.id]); }).length;
    var pct = list.length ? Math.round(written * 100 / list.length) : 0, q = (st.q || "").toLowerCase();
    var shown = list.filter(function (t) {
      var w = has(jds[t.id]);
      if (st.f === "written" && !w) return false; if (st.f === "missing" && w) return false; if (st.f === "review" && !(w && stale(jds[t.id]))) return false;
      return !q || (t.title + " " + deptName(api, t.department_id)).toLowerCase().indexOf(q) > -1;
    });
    function chip(k, label, n) { return '<button type="button" class="' + (st.f === k ? "on" : "") + '" data-jf="' + k + '">' + label + ' <b>' + n + '</b></button>'; }
    return '<div class="jd">' +
      '<section class="jd-hero"><div class="jd-hero-l"><small>HR · Job descriptions</small><h2>' + written + ' of ' + list.length + ' designations have a job description</h2>' +
        '<p>Write what each role does, what it needs and who it reports to. Staff can read the description for their own role.</p>' +
        '<div class="jd-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="jd-tiles"><div class="jd-tile a"><strong>' + written + '</strong><small>Written</small></div><div class="jd-tile b"><strong>' + (list.length - written) + '</strong><small>Missing</small></div><div class="jd-tile c"><strong>' + old + '</strong><small>Over a year old</small></div></div></section>' +
      '<div class="jd-tool"><div class="jd-chips">' + chip("", "All", list.length) + chip("written", "Written", written) + chip("missing", "Missing", list.length - written) + chip("review", "Needs review", old) + '</div>' +
        '<label class="jd-search">' + icon(I.search) + '<input id="jdQ" type="search" placeholder="Search designations" value="' + esc(st.q) + '" aria-label="Search designations"></label>' + (canEdit(api) ? '<button type="button" class="ghost" id="jdFmtList">' + icon('<path d="M4 6h10M4 12h16M4 18h8"/>') + ' Customize form · ' + esc(window.VeyoraJd.get(api).name || "") + '</button>' : "") + '</div>' +
      (shown.length ? '<div class="jd-list">' + shown.map(function (t, i) {
        var jd = jds[t.id], w = has(jd), n = staffCount(api, t.id);
        return '<a class="jd-row' + (w ? " has" : "") + '" href="#documents/jobs/' + esc(t.id) + '" style="--i:' + Math.min(i, 14) + '"><span class="jd-ic">' + icon(I.doc) + '</span>' +
          '<span class="jd-main"><strong>' + esc(t.title) + '</strong><small>' + esc(deptName(api, t.department_id) || "No department") + ' · ' + n + ' staff</small>' +
            (w ? '<em>' + esc((jd.summary || "").slice(0, 140)) + ((jd.summary || "").length > 140 ? "…" : "") + '</em>' : '<em class="none">No job description yet</em>') + '</span>' +
          '<span class="jd-meta">' + (w ? '<span class="jd-pill ok">Written</span>' + (stale(jd) ? '<span class="jd-pill warn">Review</span>' : "") + '<small>Updated ' + esc(fmtDate(jd.updated_at)) + '</small>' : '<span class="jd-pill off">Missing</span>') + '</span>' +
          '<span class="jd-go">' + (canEdit(api) && !w ? 'Write' : 'Open') + icon('<path d="m9 6 6 6-6 6"/>') + '</span></a>';
      }).join("") + '</div>' : '<div class="jd-empty">' + (list.length ? "No designations match." : "No designations yet. Add them under Departments &amp; Designations first.") + '</div>') + '</div>';
  }

  function section(title, ic, body) { return '<section class="jd-sec"><h3><span>' + icon(ic) + '</span>' + esc(title) + '</h3>' + body + '</section>'; }
  function bullets(a) { return a && a.length ? '<ul>' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : '<p class="jd-none">Not written yet.</p>'; }
  function tags(a) { return a && a.length ? '<div class="jd-tags">' + a.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join("") + '</div>' : '<p class="jd-none">None listed.</p>'; }

  function detail(api, st, id) {
    var t = titles(api).filter(function (x) { return x.id === id; })[0];
    if (!t) return '<section class="dash-card"><p class="note">That designation was not found. <a href="#documents/jobs">Back to job descriptions</a></p></section>';
    var jd = store(api)[id] || {}, ed = st.edit && canEdit(api), titleList = titles(api);
    var rep = titleList.filter(function (x) { return x.id === jd.reportsTo; })[0];
    var top = '<div class="jd-top"><a class="jd-back" href="#documents/jobs" data-jdback>' + icon(I.back) + 'Job descriptions</a><span class="jd-acts">' +
      (has(jd) ? '<button type="button" class="ghost" id="jdPrint">' + icon(I.print) + ' Print / PDF</button><button type="button" class="ghost" id="jdCopy">' + icon(I.copy) + ' Copy text</button>' : "") +
      (has(jd) && !ed ? '<button type="button" class="ghost" id="jdForm">' + icon(I.doc) + ' Employee form</button>' : "") +
      (canEdit(api) && !ed ? '<button type="button" class="save" id="jdEdit">' + icon(I.edit) + ' ' + (has(jd) ? "Edit" : "Write") + '</button>' : "") + '</span></div>';
    if (st.form != null && has(jd) && !ed) return '<div class="jd">' + top + formPane(api, st, t, jd) + '</div>';
    if (ed) return '<div class="jd">' + top + editor(api, st, t, jd, titleList) + '</div>';
    var n = staffCount(api, id);
    return '<div class="jd">' + top + '<article class="jd-doc" id="jdDoc"><header class="jd-doc-h"><small>Job description</small><h2>' + esc(t.title) + '</h2>' +
      '<p>' + esc(deptName(api, t.department_id) || "No department") + (jd.employment ? " · " + esc(jd.employment) : "") + ' · ' + n + ' staff in this role</p>' +
      '<dl>' + (rep ? '<div><dt>Reports to</dt><dd>' + esc(rep.title) + '</dd></div>' : "") + (jd.hours ? '<div><dt>Hours</dt><dd>' + esc(jd.hours) + '</dd></div>' : "") + (jd.grade ? '<div><dt>Grade / band</dt><dd>' + esc(jd.grade) + '</dd></div>' : "") +
        (jd.updated_at ? '<div><dt>Last updated</dt><dd>' + esc(fmtDate(jd.updated_at)) + '</dd></div>' : "") + '</dl></header>' +
      (has(jd) ? window.VeyoraJd.docSections(api, window.VeyoraJd.get(api), t, jd)
        : '<div class="jd-empty big">' + icon(I.doc) + '<strong>No job description yet</strong><span>' + (canEdit(api) ? 'Click Write to create one, or start from a ready-made template.' : 'HR has not written this one yet.') + '</span></div>') + '</article></div>';
  }


  // The printable form: numbered sections with black title bars, filled in for one employee, in the company's chosen language.
  function formPane(api, st, t, jd) {
    var tpl = window.VeyoraJd.get(api);
    var staff = (api.model.staff || []).filter(function (x) { return x.titleId === t.id && x.active; });
    var emp = staff.filter(function (x) { return x.uid === st.form; })[0] || null;
    var pick = '<div class="jd-formbar"><label><span>Employee</span><select id="jdEmpPick"><option value="">Blank form (no employee)</option>' + staff.map(function (x) { return '<option value="' + esc(x.uid) + '"' + (x.uid === st.form ? " selected" : "") + '>' + esc(x.name) + (x.empNo ? " · " + esc(x.empNo) : "") + '</option>'; }).join("") + '</select></label>' +
      '<span class="jd-formlang">Form: <b>' + esc(tpl.name || "") + '</b></span>' + (canEdit(api) ? '<button type="button" class="ghost" id="jdFmtBtn">Customize form</button>' : "") +
      '<button type="button" class="ghost" id="jdFormBack">Back</button><button type="button" class="save" id="jdFormPrint">' + icon(I.print) + ' Print / PDF</button></div>';
    return pick + window.VeyoraJd.paper(api, tpl, t, jd, emp);
  }

  function openFormat(api) { var st = api.jobState; st.design = true; st.tpl = null; if (location.hash.indexOf("#documents/jobs/") === 0 || location.hash.indexOf("#jobs/") === 0) location.hash = "#documents/jobs"; else api.render(); }

  function editor(api, st, t, jd, titleList) {
    var quals = (api.qualNames ? api.qualNames() : []);
    function qchip(q, on) { return '<label class="jd-q' + (on ? " on" : "") + '"><input type="checkbox" value="' + esc(q) + '"' + (on ? " checked" : "") + '><span>' + esc(q) + '</span></label>'; }
    var qChips = quals.map(function (q) { return qchip(q, (jd.quals || []).indexOf(q) > -1); }).join("") + (jd.quals || []).filter(function (q) { return quals.indexOf(q) < 0; }).map(function (q) { return qchip(q, true); }).join("");
    return '<section class="jd-edit"><header><h2>' + esc(t.title) + '</h2><p>' + (st.msg ? esc(st.msg) : "Write it so a new hire can understand the role. One item per line for lists.") + '</p></header>' +
      (has(jd) ? "" : '<div class="jd-start"><span>Start from a template</span>' + STARTERS.map(function (s, i) { return '<button type="button" class="ghost' + (s.match.test(t.title) ? " rec" : "") + '" data-start="' + i + '">' + esc(s.name) + '</button>'; }).join("") + '</div>') +
      '<div id="jdFields">' + window.VeyoraJd.editFields(api, window.VeyoraJd.get(api), jd, titleList.filter(function (x) { return x.id !== t.id; }), quals) + '</div>' +
      '<p class="msg" id="jdMsg" role="status"></p><div class="jd-foot"><button type="button" class="ghost" id="jdCancel">Cancel</button>' + (has(jd) ? '<button type="button" class="ghost danger" id="jdDel">Delete description</button>' : "") + '<button type="button" class="save" id="jdSave">Save job description</button></div></section>';
  }

  function bind(api, rt) {
    var $ = api.$, st = api.jobState || (api.jobState = { q: "", f: "", edit: false, msg: "" });
    [].forEach.call(document.querySelectorAll("[data-jf]"), function (b) { b.addEventListener("click", function () { st.f = b.dataset.jf; api.render(); }); });
    var q = $("jdQ"); if (q) q.addEventListener("input", function () { st.q = q.value; var p = q.selectionStart; api.render(); var n = $("jdQ"); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    if ($("ddSave")) {
      window.VeyoraJd.bindDesigner(api, st, st.dd.t, st.dd.jd, function (act) { if (act === "rerender") { api.render(); return; } st.design = false; st.tpl = null; api.render(); });
      return;
    }
    if ($("jdFmtList")) $("jdFmtList").addEventListener("click", function () { openFormat(api); });
    if (!rt || !rt.id) { st.edit = false; st.form = null; return; }
    var id = rt.id;
    if ($("jdForm")) $("jdForm").addEventListener("click", function () { st.form = ""; api.render(); });
    if ($("jdFormBack")) $("jdFormBack").addEventListener("click", function () { st.form = null; api.render(); });
    if ($("jdEmpPick")) $("jdEmpPick").addEventListener("change", function () { st.form = $("jdEmpPick").value; api.render(); });
    if ($("jdFmtBtn")) $("jdFmtBtn").addEventListener("click", function () { openFormat(api); });
    if ($("jdFormPrint")) $("jdFormPrint").addEventListener("click", function () {
      document.documentElement.classList.add("jd-print"); var done = function () { document.documentElement.classList.remove("jd-print"); window.removeEventListener("afterprint", done); };
      window.addEventListener("afterprint", done); window.print();
    });
    if ($("jdEdit")) $("jdEdit").addEventListener("click", function () { st.edit = true; st.msg = ""; api.render(); });
    var back = document.querySelector("[data-jdback]"); if (back) back.addEventListener("click", function () { st.edit = false; st.form = null; });
    if ($("jdPrint")) $("jdPrint").addEventListener("click", function () {
      document.documentElement.classList.add("jd-print"); var done = function () { document.documentElement.classList.remove("jd-print"); window.removeEventListener("afterprint", done); };
      window.addEventListener("afterprint", done); window.print();
    });
    if ($("jdCopy")) $("jdCopy").addEventListener("click", function () {
      var d = $("jdDoc"); var txt = d ? d.innerText : ""; var ok = function () { $("jdCopy").lastChild.textContent = " Copied"; setTimeout(function () { var b = $("jdCopy"); if (b) b.lastChild.textContent = " Copy text"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () {}); else ok();
    });
    if (!$("jdSave")) return;
    var jd = store(api)[id] || {};
    [].forEach.call(document.querySelectorAll("[data-start]"), function (b) {
      b.addEventListener("click", function () {
        var s = STARTERS[Number(b.dataset.start)];
        var tp = window.VeyoraJd.get(api); [["summary", s.summary], ["responsibilities", s.responsibilities.join("\n")], ["requirements", s.requirements.join("\n")], ["skills", s.skills.join("\n")]].forEach(function (kv) {
          tp.sections.forEach(function (sec) { sec.fields.forEach(function (fl) { if (fl.key === kv[0]) { var el = document.querySelector('[data-fk="' + fl.id + '"]'); if (el) el.value = kv[1]; } }); });
        });
        $("jdMsg").textContent = "Template filled in. Edit anything, then save."; $("jdMsg").className = "msg ok";
      });
    });
    window.VeyoraJd.bindEdit($("jdFields"));
    $("jdCancel").addEventListener("click", function () { st.edit = false; api.render(); });
    function persist(map, okMsg) {
      return api.rpc("set_company_setting", { p_company: api.company.id, p_key: KEY, p_value: map }).then(function () {
        api.company.settings = api.company.settings || {}; api.company.settings[KEY] = map; st.edit = false; st.msg = ""; api.render();
        if (window.alert && false) window.alert(okMsg);
      });
    }
    $("jdSave").addEventListener("click", function () {
      var out = window.VeyoraJd.collect($("jdFields"), window.VeyoraJd.get(api), jd);
      out.updated_at = new Date().toISOString(); out.updated_by = api.ctx.me || null;
      if (!out.summary && !(out.responsibilities || []).length && !Object.keys(out.v || {}).some(function (k) { return out.v[k] && out.v[k].length; })) { $("jdMsg").textContent = "Fill in at least one field."; $("jdMsg").className = "msg err"; return; }
      var map = Object.assign({}, store(api)); map[id] = out;
      $("jdSave").disabled = true; $("jdMsg").textContent = "Saving…"; $("jdMsg").className = "msg";
      persist(map).catch(function (e) { $("jdSave").disabled = false; $("jdMsg").textContent = e.message || "Could not save."; $("jdMsg").className = "msg err"; });
    });
    if ($("jdDel")) $("jdDel").addEventListener("click", function () {
      if (!window.confirm("Delete this job description?")) return;
      var map = Object.assign({}, store(api)); delete map[id];
      persist(map).catch(function (e) { $("jdMsg").textContent = e.message || "Could not delete."; $("jdMsg").className = "msg err"; });
    });
    void jd;
  }

  window.VeyoraHrJobs = { render: render, bind: bind, has: function (api, id) { return has(store(api)[id]); } };
})();
