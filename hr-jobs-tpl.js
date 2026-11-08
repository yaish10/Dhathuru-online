/* HR → Job descriptions: the form template engine and designer.
   A company designs its own job description form: sections, fields, wording, language / direction, look. Saved in company setting 8_jd_template.
   The job description CONTENT (per designation) stays in 8_job_descriptions: built-in fields keep their flat keys (summary, responsibilities ...),
   custom fields live under jd.v[fieldId]. Nothing in the database changes. */
(function () {
  var KEY = "8_jd_template";
  var BUILTIN = { summary: 1, reportsTo: 1, employment: 1, hours: 1, grade: 1, conditions: 1, responsibilities: 1, requirements: 1, skills: 1, quals: 1 };
  var EMPLOYMENT = ["Full-time", "Part-time", "Contract", "Seasonal", "Casual"];
  var TYPES = [["text", "Single line"], ["long", "Paragraph"], ["list", "Numbered list"], ["tags", "Tags"], ["quals", "Qualifications"], ["date", "Date"], ["choice", "Tick boxes"], ["reports", "Reports to"], ["employment", "Employment type"], ["auto", "Filled in automatically"], ["sign", "Signature lines"]];
  var AUTO = [["name", "Employee name"], ["idNo", "ID card number"], ["staffNo", "Staff number"], ["dob", "Date of birth"], ["joined", "Date joined"], ["employmentChecks", "Employment type (tick boxes)"], ["designation", "Designation"], ["dept", "Department"], ["company", "Company name"], ["issued", "Date issued"], ["today", "Today's date"]];
  var FULL = { long: 1, list: 1, tags: 1, quals: 1, choice: 1, sign: 1 };
  var LANGS = { "English": { dir: "ltr", font: "", name: "English" }, "Dhivehi": { dir: "rtl", font: '"MV Faruma","Faruma","Noto Sans Thaana","Mv Boli",serif', name: "ދިވެހި" } };
  var L = {
    "English": { bismillah: "", title: "Job description", s1: "Employee details", s2: "Position details", s3: "Job details", s4: "Responsibilities and duties", s5: "Requirements, qualifications and skills", s6: "Working conditions and notes", s7: "Signatures",
      name: "Name", idNo: "ID card number", staffNo: "Staff number", dob: "Date of birth", designation: "Designation", dept: "Department / section", joined: "Date joined", employment: "Employment type",
      permanent: "Permanent", contract: "Contract", other: "Other", company: "Company", reportsTo: "Reports to", purpose: "Purpose of the role", hours: "Working hours", grade: "Grade / band", issued: "Date issued",
      quals: "Certificates and qualifications", skills: "Skills", requirements: "Requirements", employee: "Employee", supervisor: "Supervisor", hr: "HR", signature: "Signature", date: "Date" },
    "Dhivehi": { bismillah: "بسم الله الرحمن الرحيم", title: "ވަޒީފާ ބަޔާން", s1: "މުވައްޒަފުގެ މަޢުލޫމާތު", s2: "ވަޒީފާގެ މަޤާމްގެ މަޢުލޫމާތު", s3: "ވަޒީފާގެ ތަފްސީލު", s4: "ޒިންމާތަކާއި ވާޖިބުތައް", s5: "ޝަރުތުތަކާއި ސެޓްފިކެޓް އަދި ހުނަރުތައް", s6: "މަސައްކަތުގެ ޙާލަތާއި ނޯޓްތައް", s7: "ސޮއިތައް",
      name: "ނަން", idNo: "ދ.ރ.ކ. ނަންބަރު", staffNo: "ސްޓާފް ނަންބަރު", dob: "އުފަން ތާރީޚް", designation: "މަޤާމް", dept: "ސެކްޝަން / ޑިޕާޓްމަންޓް", joined: "ވަޒީފާ ފެށި ތާރީޚް", employment: "ވަޒީފާގެ ބާވަތް",
      permanent: "ދާއިމީ", contract: "ކޮންޓްރެކްޓް", other: "އެހެނިހެން", company: "ކުންފުނި", reportsTo: "ރިޕޯޓް ކުރާނީ", purpose: "ވަޒީފާގެ މަޤްސަދު", hours: "މަސައްކަތު ގަޑި", grade: "ގްރޭޑް", issued: "ދޫކުރި ތާރީޚް",
      quals: "ސެޓްފިކެޓްތަކާއި ޝަރުތު", skills: "ހުނަރުތައް", requirements: "ޝަރުތުތައް", employee: "މުވައްޒަފު", supervisor: "ސުޕަވައިޒަރު", hr: "އެޗް.އާރ.", signature: "ސޮއި", date: "ތާރީޚް" }
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function uid() { return "f" + Math.random().toString(36).slice(2, 8); }
  function lines(t) { return String(t || "").split(/\n+/).map(function (x) { return x.replace(/^[\s\-•*]+/, "").trim(); }).filter(Boolean); }
  function fmtDate(ts) { if (!ts) return ""; var d = new Date(ts); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  function icon(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var I = { up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>', back: '<path d="m15 6-6 6 6 6"/>', reset: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>' };

  function f(label, type, o) { return Object.assign({ id: uid(), label: label, type: type, key: "", src: "", w: FULL[type] ? 2 : 1, options: "" }, o || {}); }
  function preset(lang) {
    var T = L[lang] || L.English, d = LANGS[lang] || LANGS.English;
    return { name: lang + " form", language: lang, dir: d.dir, font: d.font, accent: "#1f1f1f", bar: "solid", bismillah: !!T.bismillah, bismillahText: T.bismillah, header: true, title: T.title,
      sections: [
        { id: uid(), title: T.s1, fields: [f(T.name, "auto", { src: "name" }), f(T.idNo, "auto", { src: "idNo" }), f(T.staffNo, "auto", { src: "staffNo" }), f(T.dob, "auto", { src: "dob" }), f(T.designation, "auto", { src: "designation" }), f(T.dept, "auto", { src: "dept" }), f(T.joined, "auto", { src: "joined" }),
          f(T.employment, "auto", { src: "employmentChecks", w: 2, options: T.permanent + ", " + T.contract + ", " + T.other })] },
        { id: uid(), title: T.s2, fields: [f(T.company, "auto", { src: "company" }), f(T.designation, "auto", { src: "designation" }), f(T.dept, "auto", { src: "dept" }), f(T.reportsTo, "reports", { key: "reportsTo" }), f(T.purpose, "long", { key: "summary" })] },
        { id: uid(), title: T.s3, fields: [f(T.employment, "employment", { key: "employment" }), f(T.hours, "text", { key: "hours" }), f(T.grade, "text", { key: "grade" }), f(T.issued, "auto", { src: "issued" })] },
        { id: uid(), title: T.s4, fields: [f(T.s4, "list", { key: "responsibilities" })] },
        { id: uid(), title: T.s5, fields: [f(T.requirements, "list", { key: "requirements" }), f(T.quals, "quals", { key: "quals" }), f(T.skills, "tags", { key: "skills" })] },
        { id: uid(), title: T.s6, fields: [f(T.s6, "long", { key: "conditions" })] },
        { id: uid(), title: T.s7, fields: [f("", "sign", { options: T.employee + ", " + T.supervisor + ", " + T.hr, label2: T.signature + "|" + T.date })] }
      ] };
  }
  function legacyFormat(api) {
    var s = api.company.settings && api.company.settings["8_job_description_format"]; if (!s || typeof s !== "object") return null;
    var t = preset(LANGS[s.language] ? s.language : "English");
    t.bismillah = s.bismillah === true; t.header = s.letterhead !== false;
    t.sections = t.sections.filter(function (x, i) { return !((i === 0 && s.employee === false) || (i === 6 && s.sign === false)); });
    return t;
  }
  function get(api) {
    var s = api.company.settings && api.company.settings[KEY];
    if (s && typeof s === "object" && Array.isArray(s.sections) && s.sections.length) {
      var base = preset("English"); var t = Object.assign({}, base, s); t.sections = s.sections; return t;
    }
    return legacyFormat(api) || preset("English");
  }
  function getv(jd, fl) { return fl.key && BUILTIN[fl.key] ? jd[fl.key] : (jd.v || {})[fl.id]; }
  function arr(x) { return Array.isArray(x) ? x : (x ? [String(x)] : []); }

  /* ---------- printable form ---------- */
  function autoVal(api, src, t, emp, jd) {
    var meta = (emp && emp.hrMeta) || {};
    switch (src) {
      case "name": return emp ? emp.name : ""; case "idNo": return meta.id_number || meta.national_id || ""; case "staffNo": return emp ? emp.empNo : "";
      case "dob": return meta.dob ? fmtDate(meta.dob) : ""; case "joined": return emp && emp.start ? fmtDate(emp.start) : ""; case "designation": return t ? t.title : "";
      case "dept": return t ? (((api.model.depts || []).filter(function (x) { return x.id === t.department_id; })[0] || {}).name || "") : ""; case "company": return api.company.name || "";
      case "issued": return jd && jd.updated_at ? fmtDate(jd.updated_at) : ""; case "today": return fmtDate(new Date().toISOString());
    }
    return "";
  }
  function box(on, label) { return '<span class="jf-box"><i class="' + (on ? "on" : "") + '"></i>' + esc(label) + '</span>'; }
  function paper(api, tpl, t, jd, emp) {
    var titleList = api.model.titles || [];
    var out = '<article class="jd-paper bar-' + esc(tpl.bar || "solid") + '" id="jdDoc" dir="' + (tpl.dir === "rtl" ? "rtl" : "ltr") + '" style="--jf-accent:' + esc(tpl.accent || "#1f1f1f") + ';' + (tpl.font ? "font-family:" + tpl.font : "") + '">';
    if (tpl.bismillah && tpl.bismillahText) out += '<div class="jf-bism">' + esc(tpl.bismillahText) + '</div>';
    if (tpl.header) out += '<header class="jf-head"><strong>' + esc(api.company.name || "") + '</strong></header>';
    out += '<h1 class="jf-title">' + esc(tpl.title || "") + '</h1>';
    (tpl.sections || []).forEach(function (sec, i) {
      out += '<div class="jf-bar"><b>' + (i + 1) + '.</b> ' + esc(sec.title) + '</div>';
      var grid = "", other = "";
      (sec.fields || []).forEach(function (fl) {
        var val = getv(jd || {}, fl), tx = "";
        if (fl.type === "sign") {
          var labs = String(fl.options || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean), l2 = String(fl.label2 || "").split("|");
          other += '<div class="jf-sign">' + labs.map(function (r) { return '<div><span>' + esc(r) + '</span><i></i><small>' + esc(l2[0] || "") + '</small><i></i><small>' + esc(l2[1] || "") + '</small></div>'; }).join("") + '</div>'; return;
        }
        if (fl.type === "list" || fl.type === "tags" || fl.type === "quals") {
          var a = arr(val); other += '<div class="jf-text">' + (fl.label ? '<p><b>' + esc(fl.label) + ':</b></p>' : "") + (fl.type === "list" ? (a.length ? '<ol>' + a.map(function (x) { return '<li dir="auto">' + esc(x) + '</li>'; }).join("") + '</ol>' : '<p>&nbsp;</p>') : '<p dir="auto">' + (a.length ? esc(a.join("، ")) : "&nbsp;") + '</p>') + '</div>'; return;
        }
        if (fl.type === "long") { other += '<div class="jf-text">' + (fl.label ? '<p><b>' + esc(fl.label) + ':</b></p>' : "") + '<p dir="auto">' + (val ? esc(val) : "&nbsp;") + '</p></div>'; return; }
        if (fl.type === "choice") {
          var opts = String(fl.options || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean), sel = arr(val);
          grid += '<div class="jf-c wide"><span>' + esc(fl.label) + '</span><b>' + opts.map(function (o) { return box(sel.indexOf(o) > -1, o); }).join("") + '</b></div>'; return;
        }
        if (fl.type === "auto" && fl.src === "employmentChecks") {
          var o3 = String(fl.options || "").split(",").map(function (x) { return x.trim(); }), type = ((emp && emp.employment) || (jd && jd.employment) || "").toLowerCase();
          grid += '<div class="jf-c wide"><span>' + esc(fl.label) + '</span><b>' + box(/perm|full/.test(type), o3[0] || "Permanent") + box(/contract|fixed/.test(type), o3[1] || "Contract") + box(type && !/perm|full|contract|fixed/.test(type), o3[2] || "Other") + '</b></div>'; return;
        }
        if (fl.type === "auto") tx = autoVal(api, fl.src, t, emp, jd);
        else if (fl.type === "reports") tx = ((titleList.filter(function (x) { return x.id === val; })[0]) || {}).title || "";
        else if (fl.type === "date") tx = val ? fmtDate(val) : ""; else tx = val ? String(val) : "";
        grid += '<div class="jf-c' + (fl.w === 2 ? " wide" : "") + '"><span>' + esc(fl.label) + '</span><b dir="auto">' + (tx ? esc(tx) : "&nbsp;") + '</b></div>';
      });
      if (grid) out += '<div class="jf-grid">' + grid + '</div>';
      out += other;
    });
    return out + '</article>';
  }

  /* ---------- modern read-only document (no employee) ---------- */
  function docSections(api, tpl, t, jd) {
    var titleList = api.model.titles || [], html = "";
    (tpl.sections || []).forEach(function (sec) {
      var parts = "";
      (sec.fields || []).forEach(function (fl) {
        if (fl.type === "sign" || (fl.type === "auto" && !/^(designation|dept|company|issued|today)$/.test(fl.src))) return;
        var val = getv(jd, fl), body = "";
        if (fl.type === "list") { var a = arr(val); if (!a.length) return; body = '<ul>' + a.map(function (x) { return '<li dir="auto">' + esc(x) + '</li>'; }).join("") + '</ul>'; }
        else if (fl.type === "tags" || fl.type === "quals" || fl.type === "choice") { var b = arr(val); if (!b.length) return; body = '<div class="jd-tags">' + b.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join("") + '</div>'; }
        else {
          var tx = fl.type === "auto" ? autoVal(api, fl.src, t, null, jd) : fl.type === "reports" ? ((titleList.filter(function (x) { return x.id === val; })[0]) || {}).title || "" : fl.type === "date" ? (val ? fmtDate(val) : "") : (val ? String(val) : "");
          if (!tx) return; body = '<p dir="auto">' + esc(tx) + '</p>';
        }
        parts += '<div class="jd-fld">' + (fl.label && (sec.fields.length > 1) ? '<h4>' + esc(fl.label) + '</h4>' : "") + body + '</div>';
      });
      if (parts) html += '<section class="jd-sec"><h3><span>' + icon('<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>') + '</span>' + esc(sec.title) + '</h3>' + parts + '</section>';
    });
    return html;
  }

  /* ---------- editing a designation's content from the template ---------- */
  var EDIT_TYPES = { text: 1, long: 1, list: 1, tags: 1, quals: 1, date: 1, choice: 1, reports: 1, employment: 1 };
  function editFields(api, tpl, jd, titleList, qualNames) {
    var html = "";
    (tpl.sections || []).forEach(function (sec) {
      var inner = "";
      (sec.fields || []).forEach(function (fl) {
        if (!EDIT_TYPES[fl.type]) return;
        var val = getv(jd, fl), id = "jdf_" + fl.id, wide = fl.w === 2 || FULL[fl.type] ? " wide" : "", lab = '<span>' + esc(fl.label || "Field") + '</span>', ctl = "";
        if (fl.type === "text") ctl = '<input id="' + id + '" data-fk="' + fl.id + '" maxlength="200" value="' + esc(val || "") + '" dir="auto">';
        else if (fl.type === "date") ctl = '<input id="' + id + '" data-fk="' + fl.id + '" type="date" value="' + esc(val || "") + '">';
        else if (fl.type === "long") ctl = '<textarea id="' + id + '" data-fk="' + fl.id + '" rows="4" maxlength="3000" dir="auto">' + esc(val || "") + '</textarea>';
        else if (fl.type === "list" || fl.type === "tags") ctl = '<textarea id="' + id + '" data-fk="' + fl.id + '" rows="' + (fl.type === "list" ? 6 : 3) + '" maxlength="4000" dir="auto" placeholder="One per line">' + esc(arr(val).join("\n")) + '</textarea>';
        else if (fl.type === "reports") ctl = '<select id="' + id + '" data-fk="' + fl.id + '"><option value="">Nobody / not set</option>' + titleList.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === val ? " selected" : "") + '>' + esc(x.title) + '</option>'; }).join("") + '</select>';
        else if (fl.type === "employment") ctl = '<select id="' + id + '" data-fk="' + fl.id + '"><option value="">Not set</option>' + EMPLOYMENT.map(function (x) { return '<option' + (x === val ? " selected" : "") + '>' + x + '</option>'; }).join("") + '</select>';
        else if (fl.type === "choice" || fl.type === "quals") {
          var base = fl.type === "quals" ? qualNames : String(fl.options || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean), sel = arr(val), all = base.slice();
          sel.forEach(function (x) { if (all.indexOf(x) < 0) all.push(x); });
          ctl = '<div class="jd-qs" data-fk="' + fl.id + '" data-multi="1">' + (all.map(function (q) { var on = sel.indexOf(q) > -1; return '<label class="jd-q' + (on ? " on" : "") + '"><input type="checkbox" value="' + esc(q) + '"' + (on ? " checked" : "") + '><span>' + esc(q) + '</span></label>'; }).join("") || '<em>No options set up yet.</em>') + '</div>' +
            (fl.type === "quals" ? '<div class="jd-addq"><input data-addq="' + fl.id + '" maxlength="80" placeholder="Add another (type and press Add)"><button type="button" class="ghost" data-addqbtn="' + fl.id + '">Add</button></div>' : "");
        }
        inner += '<div class="jd-f' + wide + '">' + lab + ctl + '</div>';
      });
      if (inner) html += '<h4 class="jd-sech">' + esc(sec.title) + '</h4><div class="jd-form">' + inner + '</div>';
    });
    return html || '<p class="jd-none">This form has no fields to fill in. Add some in Customize form.</p>';
  }
  function collect(root, tpl, jd) {
    var out = Object.assign({}, jd), v = Object.assign({}, jd.v || {});
    (tpl.sections || []).forEach(function (sec) {
      (sec.fields || []).forEach(function (fl) {
        if (!EDIT_TYPES[fl.type]) return;
        var el = root.querySelector('[data-fk="' + fl.id + '"]'), val;
        if (!el) return;
        if (el.getAttribute("data-multi")) val = [].filter.call(el.querySelectorAll("input"), function (i) { return i.checked; }).map(function (i) { return i.value; });
        else if (fl.type === "list" || fl.type === "tags") val = lines(el.value);
        else val = el.value.trim();
        if (fl.key && BUILTIN[fl.key]) out[fl.key] = val; else v[fl.id] = val;
      });
    });
    out.v = v; return out;
  }
  function bindEdit(root) {
    [].forEach.call(root.querySelectorAll('[data-multi="1"] input'), function (c) { c.addEventListener("change", function () { c.parentNode.classList.toggle("on", c.checked); }); });
    [].forEach.call(root.querySelectorAll("[data-addqbtn]"), function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-addqbtn"), inp = root.querySelector('[data-addq="' + id + '"]'), box = root.querySelector('[data-fk="' + id + '"]'), v = inp.value.trim(); if (!v) return;
        if (box.querySelector("em")) box.innerHTML = "";
        var ex = [].filter.call(box.querySelectorAll("input"), function (i) { return i.value.toLowerCase() === v.toLowerCase(); })[0];
        if (ex) { ex.checked = true; ex.parentNode.classList.add("on"); } else { var l = document.createElement("label"); l.className = "jd-q on"; l.innerHTML = '<input type="checkbox" value="' + esc(v) + '" checked><span>' + esc(v) + '</span>'; box.appendChild(l); l.querySelector("input").addEventListener("change", function () { l.classList.toggle("on", this.checked); }); }
        inp.value = "";
      });
    });
  }

  /* ---------- designer ---------- */
  var ACCENTS = ["#1f1f1f", "#1e3a8a", "#0f766e", "#7c2d12", "#6d28d9", "#be185d", "#475569"];
  function secCard(tpl, si, st) {
    var sec = tpl.sections[si];
    return '<section class="jdd-sec' + (st.sel === si ? " on" : "") + '" data-si="' + si + '" draggable="true"><header><span class="jdd-grip" title="Drag to reorder">' + icon(I.grip) + '</span><span class="jdd-n">' + (si + 1) + '</span>' +
      '<input class="jdd-st" data-sec="' + si + '" value="' + esc(sec.title) + '" maxlength="120" aria-label="Section title" dir="auto">' +
      '<button type="button" class="jdd-ib" data-secup="' + si + '" ' + (si === 0 ? "disabled" : "") + ' aria-label="Move up">' + icon(I.up) + '</button><button type="button" class="jdd-ib" data-secdn="' + si + '" ' + (si === tpl.sections.length - 1 ? "disabled" : "") + ' aria-label="Move down">' + icon(I.down) + '</button>' +
      '<button type="button" class="jdd-ib danger" data-secdel="' + si + '" aria-label="Delete section">' + icon(I.x) + '</button></header>' +
      '<div class="jdd-fields">' + sec.fields.map(function (fl, fi) { return fieldRow(fl, si, fi, sec.fields.length); }).join("") + '</div>' +
      '<div class="jdd-addrow"><select data-addtype="' + si + '"><option value="">+ Add a field…</option>' + TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join("") + '</select></div></section>';
  }
  function fieldRow(fl, si, fi, n) {
    var k = si + ":" + fi, extra = "";
    if (fl.type === "auto") extra = '<select data-fsrc="' + k + '">' + AUTO.map(function (a) { return '<option value="' + a[0] + '"' + (fl.src === a[0] ? " selected" : "") + '>' + a[1] + '</option>'; }).join("") + '</select>';
    if (fl.type === "choice") extra = '<input data-fopt="' + k + '" value="' + esc(fl.options || "") + '" placeholder="Options, separated by commas" dir="auto">';
    if (fl.type === "sign") extra = '<input data-fopt="' + k + '" value="' + esc(fl.options || "") + '" placeholder="Who signs, separated by commas" dir="auto"><input data-flab2="' + k + '" value="' + esc(fl.label2 || "") + '" placeholder="Signature|Date wording" dir="auto">';
    if (fl.type === "auto" && fl.src === "employmentChecks") extra += '<input data-fopt="' + k + '" value="' + esc(fl.options || "") + '" placeholder="Three labels, e.g. Permanent, Contract, Other" dir="auto">';
    return '<div class="jdd-f" data-fi="' + k + '"><input class="jdd-fl" data-flabel="' + k + '" value="' + esc(fl.label) + '" maxlength="120" placeholder="Field label" dir="auto" aria-label="Field label">' +
      '<select class="jdd-ft" data-ftype="' + k + '" aria-label="Field type">' + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (fl.type === t[0] ? " selected" : "") + '>' + t[1] + '</option>'; }).join("") + '</select>' +
      '<button type="button" class="jdd-w' + (fl.w === 2 ? " on" : "") + '" data-fw="' + k + '" title="Full width / half width">' + (fl.w === 2 ? "Full" : "Half") + '</button>' + extra +
      '<span class="jdd-fa"><button type="button" class="jdd-ib" data-fup="' + k + '" ' + (fi === 0 ? "disabled" : "") + ' aria-label="Up">' + icon(I.up) + '</button><button type="button" class="jdd-ib" data-fdn="' + k + '" ' + (fi === n - 1 ? "disabled" : "") + ' aria-label="Down">' + icon(I.down) + '</button><button type="button" class="jdd-ib danger" data-fdel="' + k + '" aria-label="Remove">' + icon(I.x) + '</button></span></div>';
  }
  function sampleEmp(api) { return { name: "Ahmed Ibrahim", empNo: "250088", employment: "Permanent", start: "2019-03-07", hrMeta: { id_number: "A165955", dob: "2003-12-07" } }; }
  function designerHtml(api, st, t, jd) {
    var tpl = st.tpl;
    return '<div class="jdd"><div class="jdd-top"><a class="jd-back" href="#documents/jobs" data-ddback>' + icon(I.back) + 'Job descriptions</a><div class="jdd-topin"><label><span>Template name</span><input id="ddName" value="' + esc(tpl.name || "") + '" maxlength="80"></label>' +
      '<span class="jdd-acts"><button type="button" class="ghost" id="ddReset">' + icon(I.reset) + ' Start over…</button><button type="button" class="ghost" id="ddCancel">Cancel</button><button type="button" class="save" id="ddSave">Save form</button></span></div></div>' +
      '<p class="msg" id="ddMsg" role="status"></p>' +
      '<div class="jdd-grid"><div class="jdd-left">' +
        '<section class="jdd-card"><h3>Look and language</h3><div class="jdd-opts">' +
          '<div class="jdd-o"><span>Start from a language preset</span><div class="jdd-seg" id="ddLang">' + Object.keys(LANGS).map(function (k) { return '<button type="button" data-lang="' + k + '" class="' + (tpl.language === k ? "on" : "") + '">' + esc(LANGS[k].name) + '</button>'; }).join("") + '</div><small>Replaces the sections and wording with that language\'s default form.</small></div>' +
          '<div class="jdd-o"><span>Reading direction</span><div class="jdd-seg" id="ddDir"><button type="button" data-dir="ltr" class="' + (tpl.dir !== "rtl" ? "on" : "") + '">Left to right</button><button type="button" data-dir="rtl" class="' + (tpl.dir === "rtl" ? "on" : "") + '">Right to left</button></div></div>' +
          '<div class="jdd-o"><span>Section bars</span><div class="jdd-seg" id="ddBar">' + [["solid", "Solid"], ["soft", "Soft"], ["line", "Underline"]].map(function (b) { return '<button type="button" data-bar="' + b[0] + '" class="' + (tpl.bar === b[0] ? "on" : "") + '">' + b[1] + '</button>'; }).join("") + '</div></div>' +
          '<div class="jdd-o"><span>Colour</span><div class="jdd-sw" id="ddAcc">' + ACCENTS.map(function (c) { return '<button type="button" data-acc="' + c + '" class="' + (tpl.accent === c ? "on" : "") + '" style="background:' + c + '" aria-label="' + c + '"></button>'; }).join("") + '</div></div>' +
          '<div class="jdd-o wide"><span>Form title</span><input id="ddTitle" value="' + esc(tpl.title || "") + '" maxlength="120" dir="auto"></div>' +
          '<label class="jdd-chk"><input type="checkbox" id="ddHeader"' + (tpl.header ? " checked" : "") + '> Show the company name at the top</label>' +
          '<label class="jdd-chk"><input type="checkbox" id="ddBism"' + (tpl.bismillah ? " checked" : "") + '> Show a heading line above the title</label>' +
          '<div class="jdd-o wide" id="ddBismWrap"' + (tpl.bismillah ? "" : " hidden") + '><span>Heading line text</span><input id="ddBismTxt" value="' + esc(tpl.bismillahText || "") + '" dir="auto"></div></div></section>' +
        '<div id="ddSecs">' + tpl.sections.map(function (s, i) { return secCard(tpl, i, st); }).join("") + '</div>' +
        '<button type="button" class="jdd-add" id="ddAddSec">' + icon(I.plus) + ' Add a section</button></div>' +
      '<aside class="jdd-right"><div class="jdd-prevh"><strong>Live preview</strong><small>Filled with an example employee</small></div><div class="jdd-prev" id="ddPrev">' + paper(api, tpl, t, jd, sampleEmp(api)) + '</div></aside></div></div>';
  }
  function bindDesigner(api, st, t, jd, done) {
    var $ = api.$, tpl = st.tpl, root = $("hr");
    function prev() { var p = $("ddPrev"); if (p) p.innerHTML = paper(api, tpl, t, jd, sampleEmp(api)); }
    function redraw() { var y = window.scrollY; $("ddSecs").innerHTML = tpl.sections.map(function (s, i) { return secCard(tpl, i, st); }).join(""); wireSecs(); prev(); window.scrollTo(0, y); }
    function swap(a, i, j) { var x = a[i]; a[i] = a[j]; a[j] = x; }
    function sp(k) { var p = k.split(":"); return [Number(p[0]), Number(p[1])]; }
    function wireSecs() {
      var host = $("ddSecs");
      host.oninput = function (e) {
        var t2 = e.target, d = t2.dataset; if (!d) return;
        if (d.sec != null) tpl.sections[+d.sec].title = t2.value;
        else if (d.flabel) { var a = sp(d.flabel); tpl.sections[a[0]].fields[a[1]].label = t2.value; }
        else if (d.fopt) { var b = sp(d.fopt); tpl.sections[b[0]].fields[b[1]].options = t2.value; }
        else if (d.flab2) { var c = sp(d.flab2); tpl.sections[c[0]].fields[c[1]].label2 = t2.value; }
        prev();
      };
      host.onchange = function (e) {
        var t2 = e.target, d = t2.dataset; if (!d) return;
        if (d.ftype) { var a = sp(d.ftype), fl = tpl.sections[a[0]].fields[a[1]]; fl.type = t2.value; if (FULL[fl.type]) fl.w = 2; if (fl.type === "auto" && !fl.src) fl.src = "name"; if (fl.type === "sign" && !fl.options) { fl.options = "Employee, Supervisor, HR"; fl.label2 = "Signature|Date"; } redraw(); }
        else if (d.fsrc) { var b = sp(d.fsrc); tpl.sections[b[0]].fields[b[1]].src = t2.value; redraw(); }
        else if (d.addtype) { var si = +d.addtype; if (!t2.value) return; var nf = f("New field", t2.value, t2.value === "auto" ? { src: "name" } : t2.value === "sign" ? { options: "Employee, Supervisor, HR", label2: "Signature|Date", label: "" } : {}); tpl.sections[si].fields.push(nf); redraw(); }
      };
      host.onclick = function (e) {
        var b = e.target.closest("button"); if (!b) return; var d = b.dataset, a;
        if (d.secup != null) { swap(tpl.sections, +d.secup, +d.secup - 1); redraw(); }
        else if (d.secdn != null) { swap(tpl.sections, +d.secdn, +d.secdn + 1); redraw(); }
        else if (d.secdel != null) { if (tpl.sections.length > 1 && window.confirm("Delete this section and its fields from the form? (Written job descriptions keep their text.)")) { tpl.sections.splice(+d.secdel, 1); redraw(); } }
        else if (d.fup) { a = sp(d.fup); swap(tpl.sections[a[0]].fields, a[1], a[1] - 1); redraw(); }
        else if (d.fdn) { a = sp(d.fdn); swap(tpl.sections[a[0]].fields, a[1], a[1] + 1); redraw(); }
        else if (d.fdel) { a = sp(d.fdel); tpl.sections[a[0]].fields.splice(a[1], 1); redraw(); }
        else if (d.fw) { a = sp(d.fw); var fl = tpl.sections[a[0]].fields[a[1]]; fl.w = fl.w === 2 ? 1 : 2; redraw(); }
      };
      // drag to reorder sections
      var dragI = null;
      [].forEach.call(host.querySelectorAll(".jdd-sec"), function (el) {
        el.addEventListener("dragstart", function (e) { if (!e.target.closest(".jdd-grip") && e.target !== el) { e.preventDefault(); return; } dragI = +el.dataset.si; el.classList.add("drag"); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(dragI)); } catch (x) {} });
        el.addEventListener("dragend", function () { el.classList.remove("drag"); [].forEach.call(host.querySelectorAll(".over"), function (x) { x.classList.remove("over"); }); });
        el.addEventListener("dragover", function (e) { if (dragI == null) return; e.preventDefault(); el.classList.add("over"); });
        el.addEventListener("dragleave", function () { el.classList.remove("over"); });
        el.addEventListener("drop", function (e) { e.preventDefault(); var to = +el.dataset.si; if (dragI == null || dragI === to) return; var m = tpl.sections.splice(dragI, 1)[0]; tpl.sections.splice(to, 0, m); dragI = null; redraw(); });
        var grip = el.querySelector(".jdd-grip"); if (grip) { grip.addEventListener("mousedown", function () { el.draggable = true; }); }
      });
    }
    wireSecs();
    $("ddName").oninput = function () { tpl.name = this.value; };
    $("ddTitle").oninput = function () { tpl.title = this.value; prev(); };
    $("ddHeader").onchange = function () { tpl.header = this.checked; prev(); };
    $("ddBism").onchange = function () { tpl.bismillah = this.checked; $("ddBismWrap").hidden = !this.checked; if (this.checked && !tpl.bismillahText) { tpl.bismillahText = (L[tpl.language] || L.English).bismillah || ""; $("ddBismTxt").value = tpl.bismillahText; } prev(); };
    $("ddBismTxt").oninput = function () { tpl.bismillahText = this.value; prev(); };
    function seg(id, attr, fn) { $(id).onclick = function (e) { var b = e.target.closest("button"); if (!b) return; fn(b.dataset[attr]); [].forEach.call($(id).children, function (x) { x.classList.toggle("on", x === b); }); prev(); }; }
    seg("ddDir", "dir", function (v) { tpl.dir = v; if (v === "rtl" && !tpl.font) tpl.font = LANGS.Dhivehi.font; if (v === "ltr") tpl.font = ""; });
    seg("ddBar", "bar", function (v) { tpl.bar = v; });
    seg("ddAcc", "acc", function (v) { tpl.accent = v; });
    $("ddLang").onclick = function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (!window.confirm("Replace the form with the " + b.dataset.lang + " preset? Your section changes will be lost.")) return;
      var keepName = tpl.name; st.tpl = tpl = preset(b.dataset.lang); tpl.name = keepName; done("rerender");
    };
    $("ddReset").onclick = function () { if (window.confirm("Start over with the default English form?")) { st.tpl = preset("English"); done("rerender"); } };
    $("ddAddSec").onclick = function () { tpl.sections.push({ id: uid(), title: "New section", fields: [f("New field", "text")] }); redraw(); var s = $("ddSecs").lastElementChild; if (s) s.scrollIntoView({ behavior: "smooth", block: "center" }); };
    $("ddCancel").onclick = function () { done("cancel"); };
    var back = document.querySelector("[data-ddback]"); if (back) back.onclick = function () { done("cancel"); };
    $("ddSave").onclick = function () {
      if (!tpl.sections.length) { $("ddMsg").textContent = "Add at least one section."; $("ddMsg").className = "msg err"; return; }
      $("ddSave").disabled = true; $("ddMsg").textContent = "Saving…"; $("ddMsg").className = "msg";
      api.rpc("set_company_setting", { p_company: api.company.id, p_key: KEY, p_value: tpl }).then(function () { api.company.settings = api.company.settings || {}; api.company.settings[KEY] = tpl; done("saved"); })
        .catch(function (e) { $("ddSave").disabled = false; $("ddMsg").textContent = e.message || "Could not save."; $("ddMsg").className = "msg err"; });
    };
  }

  window.VeyoraJd = { get: get, preset: preset, paper: paper, docSections: docSections, editFields: editFields, collect: collect, bindEdit: bindEdit, designerHtml: designerHtml, bindDesigner: bindDesigner, BUILTIN: BUILTIN, KEY: KEY, LANGS: LANGS };
})();
