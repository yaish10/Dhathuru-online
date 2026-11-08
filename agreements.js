/* Agreements: design templates here or upload them from Word (.docx), make agreements from them,
   and track them Draft → Sent → Signed. Every save also saves a PDF copy to the company's private file store.
   Fields are written as {{field_name}} in a template and filled in automatically.
   Categories, numbering, PDF layout and reminders are edited on this page under Settings. */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var BUCKET = "agreements";
  var DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  var company = null, ctx = null, model = null;
  var tab = "agreements", fText = "", fStatus = "", fCat = "";

  /* ---------- libraries, loaded only when needed ---------- */
  var CDN = "https://cdn.jsdelivr.net/npm/";
  var LIBS = {
    pdf: CDN + "html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js",
    mammoth: CDN + "mammoth@1.8.0/mammoth.browser.min.js",
    pizzip: CDN + "pizzip@3.1.7/dist/pizzip.min.js",
    docxt: CDN + "docxtemplater@3.47.1/build/docxtemplater.js",
    htmldocx: CDN + "html-docx-js@0.3.1/dist/html-docx.js"
  };
  var loaded = {};
  function need(names) {
    return names.reduce(function (p, n) {
      return p.then(function () {
        if (!loaded[n]) loaded[n] = new Promise(function (ok, fail) {
          var s = document.createElement("script"); s.src = LIBS[n]; s.onload = ok;
          s.onerror = function () { delete loaded[n]; fail(new Error("Could not load a helper library. Check your internet connection.")); };
          document.head.appendChild(s);
        });
        return loaded[n];
      });
    }, Promise.resolve());
  }

  /* ---------- settings (defaults match settings-defs.js) ---------- */
  function setting(key) { return company && company.settings ? company.settings[key] : undefined; }
  function formSetting(key, title) {
    var saved = setting(key), spec = window.VEYORA_DEFS && window.VEYORA_DEFS[title], out = {};
    (spec && spec.fields || []).forEach(function (f) { out[f.k] = f.d; });
    if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function categories() {
    var saved = setting("16_agreement_categories"), spec = window.VEYORA_DEFS && window.VEYORA_DEFS["Agreement Categories"];
    var list = (Array.isArray(saved) ? saved : (spec && spec.def) || []).map(function (x) { return typeof x === "string" ? x : x && x.name; }).filter(Boolean);
    return list.length ? list : ["General"];
  }
  function pdfOpts() { return formSetting("16_agreement_pdf_layout", "Agreement PDF Layout"); }
  function expiryDays() { return Math.max(1, Number(formSetting("16_agreement_reminders", "Agreement Reminders").expiry) || 30); }

  /* ---------- helpers ---------- */
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayIso() { return iso(new Date()); }
  function addDaysIso(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function fmtDate(s) { return s ? new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : ""; }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function label(k) { var s = String(k).replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  var I = {
    doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>', pen: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M9 15l2 2 4-4"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
  };
  function kpi(tone, ic, l, value, sub) {
    return '<div class="kpi"><span class="tile tone-' + tone + '">' + icon(ic) + '</span><span class="kbody"><small>' + l + '</small><strong>' + value + '</strong><span class="kpi-row"><span class="kpi-sub">' + sub + '</span></span></span></div>';
  }
  function saveBlob(blob, name) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  // Files are replaced in place (same name), so always fetch a fresh copy rather than a cached one.
  function getFile(path) {
    return db.storage.from(BUCKET).createSignedUrl(path, 120).then(function (r) {
      if (r.error) throw new Error(r.error.message || "Could not open the file.");
      return fetch(r.data.signedUrl, { cache: "no-store" });
    }).then(function (res) { if (!res.ok) throw new Error("Could not open the file."); return res.blob(); });
  }
  function putFile(path, blob, type) { return db.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: type }).then(function (r) { if (r.error) throw new Error(r.error.message); return path; }); }
  function fileName(a, ext) { return (a.number ? a.number + " " : "") + String(a.title).replace(/[\\/:*?"<>|]+/g, "") + "." + ext; }
  function check(r) { if (r.error) throw new Error(r.error.message); return r.data; }

  /* Only safe formatting survives (no scripts, links or event handlers), for anything typed or imported. */
  var OK_TAGS = { P: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, H1: 1, H2: 1, H3: 1, H4: 1, UL: 1, OL: 1, LI: 1, DIV: 1, SPAN: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, HR: 1, IMG: 1, BLOCKQUOTE: 1, SUP: 1, SUB: 1 };
  function clean(html) {
    var root = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html").body.firstChild;
    (function walk(el) {
      [].slice.call(el.childNodes).forEach(function (n) {
        if (n.nodeType === 3) return;
        if (n.nodeType !== 1) { n.remove(); return; }
        if (!OK_TAGS[n.tagName]) {
          if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|TEMPLATE|SVG|MATH|FORM|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(n.tagName)) { n.remove(); return; }
          walk(n); while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); return;
        }
        [].slice.call(n.attributes).forEach(function (a) {
          var k = a.name.toLowerCase();
          if (k === "style") { var m = /text-align\s*:\s*(left|right|center|justify)/i.exec(a.value); if (m) n.setAttribute("style", "text-align:" + m[1].toLowerCase()); else n.removeAttribute("style"); }
          else if (k === "class" && /^(sign|blank)$/.test(a.value)) { /* keep: signature table and empty-field marks */ }
          else if ((k === "colspan" || k === "rowspan") && /^\d{1,2}$/.test(a.value)) { /* keep */ }
          else if (k === "src" && n.tagName === "IMG" && /^data:image\/(png|jpe?g|gif);base64,/i.test(a.value)) { /* keep */ }
          else n.removeAttribute(a.name);
        });
        if (n.tagName === "IMG" && !n.getAttribute("src")) { n.remove(); return; }
        walk(n);
      });
    })(root);
    return root.innerHTML;
  }

  /* ---------- fields ---------- */
  var BUILTIN = [
    ["agreement_number", "Agreement number"], ["agreement_title", "Agreement title"], ["today", "Today's date"], ["start_date", "Start date"], ["end_date", "End date"],
    ["company_name", "Company name"], ["company_address", "Company address"], ["company_email", "Company email"], ["company_phone", "Company phone"], ["company_reg_no", "Company registration no."],
    ["party_name", "Other party: name"], ["party_email", "Other party: email"],
    ["staff_name", "Staff: name"], ["designation", "Staff: designation"], ["department", "Staff: department"], ["employee_no", "Staff: employee ID"],
    ["employment_type", "Staff: employment type"], ["employment_start", "Staff: employment start"], ["assigned_vessel", "Staff: assigned vessel"]
  ];
  var BUILTIN_KEYS = BUILTIN.map(function (b) { return b[0]; });
  function fieldsIn(html) {
    var text = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html").body.textContent, out = [], m, re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    while ((m = re.exec(text))) { var k = m[1].toLowerCase(); if (out.indexOf(k) < 0) out.push(k); }
    return out;
  }
  function autoValues(d) {
    var c = company, p = d.staff_user_id ? model.people.filter(function (x) { return x.uid === d.staff_user_id; })[0] : null;
    var v = {
      agreement_number: d.number || "(given when saved)", agreement_title: d.title || "", today: fmtDate(todayIso()),
      start_date: fmtDate(d.start_date), end_date: fmtDate(d.end_date),
      company_name: c.name || "", company_address: c.address || "", company_email: c.email || "", company_phone: c.phone || "", company_reg_no: c.registration_no || "",
      party_name: p ? p.name : (d.party_name || ""), party_email: p ? p.email : (d.party_email || "")
    };
    if (p) { v.staff_name = p.name; v.designation = p.position; v.department = p.dept; v.employee_no = p.empNo; v.employment_type = p.employment; v.employment_start = fmtDate(p.start); v.assigned_vessel = p.vessel; }
    else ["staff_name", "designation", "department", "employee_no", "employment_type", "employment_start", "assigned_vessel"].forEach(function (k) { v[k] = k === "staff_name" ? (d.party_name || "") : ""; });
    return v;
  }
  function fill(html, values) {
    return String(html || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (_, k) {
      var v = values[k.toLowerCase()];
      return v == null || v === "" ? '<span class="blank">__________</span>' : esc(v).replace(/\n/g, "<br>");
    });
  }

  /* ---------- starter templates ---------- */
  var SIGN = '<table class="sign"><tr><td>Signed for {{company_name}}<br><br>____________________<br>Name and date</td><td>Signed by {{party_name}}<br><br>____________________<br>Name and date</td></tr></table>';
  var STARTERS = {
    "Blank": { cat: "General", party: "Other", html: "<h1>{{agreement_title}}</h1><p>Agreement no. {{agreement_number}} · {{today}}</p><p>Between <b>{{company_name}}</b> and <b>{{party_name}}</b>.</p><p>Write the terms here.</p>" + SIGN },
    "Employment contract": { cat: "Employment", party: "Staff", html:
      "<h1>Employment Agreement</h1><p>Agreement no. {{agreement_number}} · {{today}}</p>" +
      "<p>This agreement is between <b>{{company_name}}</b>, {{company_address}} (the Company), and <b>{{staff_name}}</b> (the Employee).</p>" +
      "<h2>1. Position</h2><p>The Employee is employed as {{designation}} in {{department}}, starting on {{start_date}}.</p>" +
      "<h2>2. Term</h2><p>This agreement runs from {{start_date}} to {{end_date}}.</p>" +
      "<h2>3. Pay</h2><p>The Company pays a monthly salary of {{monthly_salary}}.</p>" +
      "<h2>4. Duties and rosters</h2><p>The Employee works the shifts on the company duty roster and keeps all required certificates valid.</p>" +
      "<h2>5. Leave</h2><p>Leave follows the company leave policy.</p>" +
      "<h2>6. Ending this agreement</h2><p>Either side may end this agreement with {{notice_period}} written notice.</p>" + SIGN.replace("{{party_name}}", "{{staff_name}}") },
    "Charter / transfer agreement": { cat: "Charter", party: "Client", html:
      "<h1>Charter Agreement</h1><p>Agreement no. {{agreement_number}} · {{today}}</p>" +
      "<p>This agreement is between <b>{{company_name}}</b> (the Operator) and <b>{{party_name}}</b> (the Client).</p>" +
      "<h2>1. Service</h2><p>The Operator provides {{vessel_name}} for {{route}} from {{start_date}} to {{end_date}}.</p>" +
      "<h2>2. Price and payment</h2><p>The price is {{price}}. Payment terms: {{payment_terms}}.</p>" +
      "<h2>3. Safety</h2><p>Passengers follow the captain's safety instructions at all times.</p>" +
      "<h2>4. Cancellation</h2><p>{{cancellation_terms}}</p>" + SIGN },
    "Service / supplier agreement": { cat: "Vendor / supplier", party: "Vendor", html:
      "<h1>Service Agreement</h1><p>Agreement no. {{agreement_number}} · {{today}}</p>" +
      "<p>This agreement is between <b>{{company_name}}</b> (the Company) and <b>{{party_name}}</b> (the Supplier).</p>" +
      "<h2>1. Services</h2><p>{{service_description}}</p><h2>2. Term</h2><p>From {{start_date}} to {{end_date}}.</p>" +
      "<h2>3. Price and payment</h2><p>{{price}}. Payment terms: {{payment_terms}}.</p>" + SIGN }
  };

  /* ---------- data ---------- */
  function load(c, info) {
    var q = [db.from("agreements").select("*").eq("company_id", c.id).order("created_at", { ascending: false }).limit(1000)];
    if (info.canHr) q.push(
      db.from("agreement_templates").select("*").eq("company_id", c.id).order("name"),
      db.from("company_members").select("user_id, role_label, role, job_title_id, department_id, employee_no, employment_type, start_date, assigned_vessel").eq("company_id", c.id).eq("active", true),
      db.from("job_titles").select("id, title").eq("company_id", c.id),
      db.from("departments").select("id, name").eq("company_id", c.id)
    );
    return Promise.all(q).then(function (r) {
      r.forEach(check);
      var out = { agreements: r[0].data, templates: [], people: [] };
      if (!info.canHr) return out;
      out.templates = r[1].data;
      var ids = r[2].data.map(function (m) { return m.user_id; });
      return db.from("profiles").select("id, full_name, email").in("id", ids).then(function (p) {
        var by = {}; (p.data || []).forEach(function (x) { by[x.id] = x; });
        var titles = {}; r[3].data.forEach(function (t) { titles[t.id] = t.title; });
        var depts = {}; r[4].data.forEach(function (d) { depts[d.id] = d.name; });
        out.people = r[2].data.map(function (m) {
          var pr = by[m.user_id] || {};
          return { uid: m.user_id, name: pr.full_name || (pr.email || "").split("@")[0] || "Unknown", email: pr.email || "", position: titles[m.job_title_id] || m.role_label || "",
            dept: depts[m.department_id] || "", empNo: m.employee_no || "", employment: m.employment_type || "", start: m.start_date || "", vessel: m.assigned_vessel || "" };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        return out;
      });
    });
  }
  function partyOf(a) {
    if (a.staff_user_id && model.people.length) { var p = model.people.filter(function (x) { return x.uid === a.staff_user_id; })[0]; if (p) return p.name; }
    return a.party_name || (a.field_values && a.field_values.staff_name) || "—";
  }
  function shownStatus(a) {
    if (a.status === "Signed" && a.end_date && a.end_date < todayIso()) return "Expired";
    if (a.status === "Signed" && a.end_date && a.end_date <= addDaysIso(expiryDays())) return "Ends soon";
    return a.status;
  }

  /* ---------- building the document, PDF and Word copy ---------- */
  function docHtml(body) {
    var o = pdfOpts(), logo = o.logo !== false && company.logo_path ? db.storage.from("company-logos").getPublicUrl(company.logo_path).data.publicUrl : "";
    return '<div class="ag-doc' + (o.font === "Serif" ? " serif" : "") + '">' +
      (o.logo !== false ? '<div class="ag-doc-head">' + (logo ? '<img src="' + esc(logo) + '" alt="" crossorigin="anonymous">' : "") + '<strong>' + esc(company.name) + '</strong></div>' : "") +
      body + '</div>';
  }
  /* PDFs are drawn in a hidden frame of their own: the app itself is shown zoomed out (settings.css),
     which makes the PDF tool squash words together or cut the page off. */
  var DOC_CSS = "html,body{margin:0;background:#fff}.ag-doc{width:680px;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.55;background:#fff}" +
    ".ag-doc.serif{font-family:Georgia,'Times New Roman',serif}.ag-doc h1{font-size:20px;margin:0 0 8px}.ag-doc h2{font-size:14px;margin:16px 0 6px}.ag-doc h3{font-size:13px;margin:12px 0 4px}" +
    ".ag-doc p{margin:0 0 8px}.ag-doc img{max-width:100%}.ag-doc table{border-collapse:collapse}.ag-doc td,.ag-doc th{vertical-align:top;padding:4px 6px}" +
    "table.sign{width:100%;margin-top:28px}table.sign td{width:50%;padding:8px 12px 8px 0}" +
    ".ag-doc-head{display:flex;align-items:center;gap:10px;padding-bottom:10px;margin-bottom:16px;border-bottom:1px solid #d5dbe6}.ag-doc-head img{height:36px;width:auto}.ag-doc-head strong{font-size:14px}";
  var frameReady = null;
  function pdfFrame() {
    if (!frameReady) frameReady = new Promise(function (ok, fail) {
      var f = document.createElement("iframe");
      f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1200px;border:0;visibility:hidden";
      f.onload = function () { f.contentWindow.html2pdf ? ok(f) : fail(new Error("Could not load the PDF maker. Check your internet connection.")); };
      f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + DOC_CSS + '</style><script src="' + LIBS.pdf + '"><\/script></head><body></body></html>';
      document.body.appendChild(f);
    }).catch(function (e) { frameReady = null; throw e; });
    return frameReady;
  }
  function makePdf(body) {
    var o = pdfOpts();
    return pdfFrame().then(function (f) {
      var doc = f.contentDocument; doc.body.innerHTML = docHtml(body);
      var imgs = [].slice.call(doc.querySelectorAll("img")).map(function (im) { return im.complete ? null : new Promise(function (ok) { im.onload = im.onerror = ok; }); }).filter(Boolean);
      return Promise.all(imgs).then(function () {
        // Options are rebuilt inside the frame: the PDF tool there does not recognise arrays made on this page.
        var set = f.contentWindow.JSON.parse(JSON.stringify({
          margin: [14, 14, 18, 14], image: { type: "jpeg", quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: o.size === "Letter" ? "letter" : "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"], avoid: ["tr", "h1", "h2", "h3", ".sign"] }
        }));
        return f.contentWindow.html2pdf().set(set).from(doc.body.firstChild).toPdf().get("pdf");
      }).then(function (pdf) {
        var n = pdf.internal.getNumberOfPages(), w = pdf.internal.pageSize.getWidth(), h = pdf.internal.pageSize.getHeight(), foot = String(o.footer || "");
        for (var i = 1; i <= n; i++) {
          pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(120);
          if (foot) pdf.text(foot, 14, h - 8);
          pdf.text("Page " + i + " of " + n, w - 14, h - 8, { align: "right" });
        }
        doc.body.innerHTML = "";
        return new Blob([pdf.output("arraybuffer")], { type: "application/pdf" });
      });
    });
  }
  function fillDocx(blob, values) {
    return need(["pizzip", "docxt"]).then(function () { return blob.arrayBuffer(); }).then(function (buf) {
      var Doc = window.docxtemplater || window.Docxtemplater;
      var doc = new Doc(new window.PizZip(buf), {
        paragraphLoop: true, linebreaks: true, delimiters: { start: "{{", end: "}}" },
        parser: function (tag) { var k = tag.trim().toLowerCase(); return { get: function (scope) { return scope[k] == null ? "" : scope[k]; } }; },
        nullGetter: function () { return ""; }
      });
      doc.render(values);
      return doc.getZip().generate({ type: "blob", mimeType: DOCX });
    });
  }
  function docxToHtml(blob) {
    return need(["mammoth"]).then(function () { return blob.arrayBuffer(); }).then(function (buf) { return window.mammoth.convertToHtml({ arrayBuffer: buf }); }).then(function (r) { return clean(r.value); });
  }
  function wordFromHtml(body) {
    return need(["htmldocx"]).then(function () {
      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}h1{font-size:18pt}h2{font-size:13pt}table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:6pt}</style></head><body>' +
        '<p><b>' + esc(company.name) + '</b></p>' + body + '</body></html>';
      return window.htmlDocx.asBlob(html);
    });
  }

  /* Fill the template for an agreement row, save PDF (always) and the Word copy (Word templates), then store the result. */
  function build(row, tpl, values) {
    var all = Object.assign({}, values, { agreement_number: row.number, agreement_title: row.title });
    var job;
    if (tpl && tpl.docx_path) {
      job = getFile(tpl.docx_path).then(function (b) { return fillDocx(b, all); }).then(function (docx) {
        return putFile(company.id + "/" + row.id + "/agreement.docx", docx, DOCX).then(function (p) { return docxToHtml(docx).then(function (h) { return { html: h, docx: p }; }); });
      });
    } else {
      job = Promise.resolve({ html: clean(fill(tpl ? tpl.body_html : row.body_html, all)), docx: null });
    }
    return job.then(function (res) {
      return makePdf(res.html).then(function (pdf) { return putFile(company.id + "/" + row.id + "/agreement.pdf", pdf, "application/pdf"); }).then(function (pdfPath) {
        return db.from("agreements").update({ body_html: res.html, pdf_path: pdfPath, docx_path: res.docx }).eq("id", row.id).select().single().then(check);
      });
    });
  }
  // Re-save the PDF from what is stored (after uploading an edited Word file, or if a save was interrupted).
  function rebuildFromStored(a) {
    var job = a.docx_path ? getFile(a.docx_path).then(docxToHtml) : Promise.resolve(a.body_html || "");
    return job.then(function (html) {
      return makePdf(html).then(function (pdf) { return putFile(company.id + "/" + a.id + "/agreement.pdf", pdf, "application/pdf"); }).then(function (p) {
        return db.from("agreements").update({ body_html: html, pdf_path: p }).eq("id", a.id).select().single().then(check);
      });
    });
  }

  /* ---------- page ---------- */
  function render() {
    if (!model || !$("ag")) return;
    var hr = ctx.canHr, list = model.agreements, t = todayIso(), soon = addDaysIso(expiryDays());
    if ($("newAgreement")) $("newAgreement").hidden = !hr;
    if ($("newTemplate")) $("newTemplate").hidden = !hr;
    if ($("agSub")) $("agSub").textContent = hr ? (ctx.isPlatform && !ctx.myRole ? company.name + " · viewing as platform owner" : "Design, store and track agreements. A PDF copy is saved automatically.") : "Agreements made out to you. Download a PDF copy at any time.";
    var cats = categories();
    model.agreements.forEach(function (a) { if (cats.indexOf(a.category) < 0) cats.push(a.category); });
    var rows = list.filter(function (a) {
      var st = shownStatus(a);
      return (!fStatus || st === fStatus || (fStatus === "Signed" && (st === "Ends soon" || st === "Expired"))) && (!fCat || a.category === fCat) &&
        (!fText || (a.number + " " + a.title + " " + partyOf(a) + " " + a.category).toLowerCase().indexOf(fText) > -1);
    });
    function sel(id, lbl, all, opts, cur) { return '<select id="' + id + '" aria-label="' + lbl + '"><option value="">' + all + '</option>' + opts.map(function (p) { return '<option' + (p === cur ? " selected" : "") + '>' + esc(p) + '</option>'; }).join("") + '</select>'; }
    var table = !rows.length ? '<div class="empty-hr">' + (list.length ? "No agreements match your filters." : hr ? (model.templates.length ? "No agreements yet. Click <b>New agreement</b> to make one from a template." : "No agreements yet. Start with <b>New template</b>: design one here or upload a Word file.") : "No agreements have been sent to you yet.") + '</div>' :
      '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Number</th><th>Agreement</th><th>Category</th><th>Status</th><th>Dates</th><th>Files</th><th></th></tr></thead><tbody>' +
      rows.map(function (a) {
        var st = shownStatus(a);
        return '<tr><td class="muted-cell">' + esc(a.number || "—") + '</td><td><strong class="ag-title">' + esc(a.title) + '</strong><small class="ag-party">' + esc(partyOf(a)) + '</small></td>' +
          '<td class="muted-cell">' + esc(a.category) + '</td><td><span class="chip ag-st-' + slug(st) + '">' + esc(st) + '</span></td>' +
          '<td class="muted-cell">' + (a.start_date ? esc(fmtDate(a.start_date)) + (a.end_date ? " – " + esc(fmtDate(a.end_date)) : "") : "—") + '</td>' +
          '<td class="files">' + (a.pdf_path ? '<button type="button" class="file-btn" data-pdf="' + a.id + '">PDF</button>' : '<small class="muted-cell">No PDF yet</small>') +
          (hr && (a.docx_path || a.body_html) ? '<button type="button" class="file-btn word" data-word="' + a.id + '">Word</button>' : "") +
          (a.signed_path ? '<button type="button" class="file-btn signed" data-signedfile="' + a.id + '">Signed</button>' : "") + '</td>' +
          '<td>' + (hr ? '<button type="button" class="ghost manage-btn" data-manage="' + a.id + '">Manage</button>' : "") + '</td></tr>';
      }).join("") + '</tbody></table></div>';

    var tpls = model.templates;
    var tplHtml = !tpls.length ? '<div class="empty-hr">No templates yet. Click <b>New template</b> to design one here, start from a ready-made one, or upload a Word file.</div>' :
      '<div class="tpl-grid">' + tpls.map(function (x) {
        var used = list.filter(function (a) { return a.template_id === x.id; }).length;
        return '<div class="tpl-card' + (x.active ? "" : " off") + '"><span class="tpl-ic' + (x.docx_path ? " word" : "") + '">' + icon(I.doc) + '</span><span class="grow"><strong>' + esc(x.name) + '</strong>' +
          '<small>' + esc(x.category) + ' · for ' + esc(x.party_type.toLowerCase()) + ' · ' + (x.docx_path ? "Word file" : "Designed here") + ' · used ' + used + (used === 1 ? " time" : " times") + (x.active ? "" : " · turned off") + '</small>' +
          '<small>' + fieldsIn(x.body_html).length + ' fields</small></span><span class="tpl-actions">' +
          (x.active ? '<button type="button" class="chip-btn use" data-use="' + x.id + '">Use</button>' : "") +
          '<button type="button" class="ghost manage-btn" data-tpl="' + x.id + '">Edit</button></span></div>';
      }).join("") + '</div>';

    var setPrefix = onAgreementsPage() ? "#settings/" : "#documents/agreements/settings/";
    var onSet = hr && location.hash.indexOf(setPrefix) === 0;
    function agPill() { var m = /settings\/([a-z]+)/.exec(location.hash || ""); return (m && m[1]) || "categories"; }
    var outside = document.getElementById("newAgreement");
    var embedActs = (outside && !$("ag").contains(outside)) || !hr ? "" : '<div class="doc-acts"><button type="button" class="ghost" id="newTemplate">New template</button><button type="button" class="save" id="newAgreement">New agreement</button></div>';
    $("ag").innerHTML = embedActs +
      '<div class="kpis">' +
      kpi("blue", I.doc, hr ? "Agreements" : "My agreements", list.length, "All saved agreements") +
      kpi("purple", I.pen, "Drafts", list.filter(function (a) { return a.status === "Draft"; }).length, "Not sent yet") +
      kpi("orange", I.send, "Waiting to sign", list.filter(function (a) { return a.status === "Sent"; }).length, "Sent, not signed yet") +
      kpi("teal", I.clock, "Ending soon", list.filter(function (a) { return a.status === "Signed" && a.end_date && a.end_date >= t && a.end_date <= soon; }).length, "Within " + expiryDays() + " days") + '</div>' +
      '<section class="dash-card">' +
      (hr ? '<div class="tabs" role="tablist"><button type="button" role="tab" data-tab="agreements" aria-selected="' + (!onSet && tab === "agreements") + '">Agreements</button><button type="button" role="tab" data-tab="templates" aria-selected="' + (!onSet && tab === "templates") + '">Templates (' + tpls.length + ')</button><button type="button" role="tab" data-tab="settings" aria-selected="' + onSet + '">Settings</button></div>' : '<h2>My agreements</h2>') +
      (onSet ? '<div id="hrAreaSettings"></div>' : tab === "templates" && hr ? tplHtml :
        '<div class="filters"><label class="fsearch">' + icon(I.search) + '<input id="aSearch" type="search" placeholder="Search number, title or name" value="' + esc(fText) + '" aria-label="Search agreements"></label>' +
        sel("aStatus", "Status", "All statuses", ["Draft", "Sent", "Signed", "Ends soon", "Expired", "Cancelled"], fStatus) + sel("aCat", "Category", "All categories", cats, fCat) + '</div>' + table) +
      '</section>';

    bindHeader();
    [].forEach.call(document.querySelectorAll("#ag [data-tab]"), function (b) { b.addEventListener("click", function () {
      if (b.dataset.tab === "settings") { if (location.hash.indexOf(setPrefix) !== 0) location.hash = setPrefix + "categories"; return; }
      if (location.hash.indexOf(setPrefix) === 0) {
        if (onAgreementsPage()) history.replaceState(null, "", location.pathname + location.search);
        else location.hash = "#documents/agreements";
      }
      tab = b.dataset.tab; render();
    }); });
    if (onSet && window.HrSettings) window.HrSettings.mount($("hrAreaSettings"), {
      area: "agreements", pill: agPill(), hash: setPrefix, esc: esc, company: function () { return company; }, db: db,
      rpc: function (name, args) { return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); },
      canHr: hr
    });
    var s = $("aSearch"); if (s) s.addEventListener("input", function () { fText = s.value.trim().toLowerCase(); var pos = s.selectionStart; render(); var n = $("aSearch"); n.focus(); n.setSelectionRange(pos, pos); });
    if ($("aStatus")) $("aStatus").addEventListener("change", function () { fStatus = this.value; render(); });
    if ($("aCat")) $("aCat").addEventListener("change", function () { fCat = this.value; render(); });
    on("[data-manage]", function (b) { openManage(b.dataset.manage); });
    on("[data-tpl]", function (b) { openTemplate(b.dataset.tpl); });
    on("[data-use]", function (b) { openAgreementForm(null, b.dataset.use); });
    on("[data-pdf]", function (b) { download(b, agreement(b.dataset.pdf), "pdf"); });
    on("[data-word]", function (b) { download(b, agreement(b.dataset.word), "word"); });
    on("[data-signedfile]", function (b) { download(b, agreement(b.dataset.signedfile), "signed"); });
    if (window.VeyoraTip) window.VeyoraTip("agreements", hr ? [
      "Make a **template** once: design it here, start from a ready-made one, or upload a Word file. Put fields like **{{staff_name}}** where details go.",
      "Click **New agreement**, pick a template and a person or client. The fields fill in by themselves, and a **PDF is saved automatically**.",
      "Use **Manage** to mark it Sent or Signed and upload the signed copy. **Word** downloads a copy to edit in Microsoft Word, and you can upload the edited file back."
    ] : ["Agreements made out to you appear here once they are sent.", "Click **PDF** to download a copy."]);
  }
  function on(sel, fn) { [].forEach.call(document.querySelectorAll(sel), function (b) { b.addEventListener("click", function () { fn(b); }); }); }
  function agreement(id) { return model.agreements.filter(function (a) { return a.id === id; })[0]; }
  function template(id) { return model.templates.filter(function (x) { return x.id === id; })[0]; }
  function reload() { return load(company, ctx).then(function (m) { model = m; render(); }); }

  function download(btn, a, kind) {
    if (!a) return;
    var old = btn.textContent; btn.disabled = true; btn.textContent = "…";
    var job = kind === "pdf" ? getFile(a.pdf_path).then(function (b) { saveBlob(b, fileName(a, "pdf")); })
      : kind === "signed" ? getFile(a.signed_path).then(function (b) { saveBlob(b, fileName(a, "signed." + (a.signed_path.split(".").pop() || "pdf")).replace(".signed.", " (signed).")); })
      : (a.docx_path ? getFile(a.docx_path) : wordFromHtml(a.body_html || "")).then(function (b) { saveBlob(b, fileName(a, "docx")); });
    job.catch(function (e) { alert(e.message); }).then(function () { btn.disabled = false; btn.textContent = old; });
  }

  /* ---------- dialogs ---------- */
  function openModal(html, wide) { $("modalCard").className = "modal-card" + (wide ? " wide" : ""); $("modalCard").innerHTML = html; $("modal").hidden = false; var f = $("modalCard").querySelector("input,select,textarea"); if (f) f.focus(); }
  function closeModal() { $("modal").hidden = true; $("modalCard").innerHTML = ""; }
  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  function busy(btn, text) { btn.disabled = true; btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = text; }
  function idle(btn) { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  function opts(list, cur) { return list.map(function (x) { var v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x; return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + '>' + esc(l) + '</option>'; }).join(""); }

  /* Template designer: design here (editor) or upload a Word file. */
  function openTemplate(id) {
    var x = id ? template(id) : null, isWord = !!(x && x.docx_path), cats = categories();
    if (x && cats.indexOf(x.category) < 0) cats.push(x.category);
    var upload = null; // { blob, html } when a new Word file is chosen
    openModal('<h2>' + (x ? "Edit template" : "New template") + '</h2><p class="note">A template is the standard wording. Put fields like <b>{{staff_name}}</b> where details go; they fill in for each agreement.</p>' +
      '<div class="ag-row"><div class="fld"><label for="tName">Template name</label><input id="tName" maxlength="120" value="' + esc(x ? x.name : "") + '" placeholder="e.g. Crew employment contract"></div>' +
      '<div class="fld"><label for="tCat">Category</label><select id="tCat">' + opts(cats, x ? x.category : cats[0]) + '</select></div>' +
      '<div class="fld"><label for="tParty">Made out to</label><select id="tParty">' + opts([["Staff", "A staff member"], ["Client", "A client"], ["Vendor", "A supplier"], ["Other", "Someone else"]], x ? x.party_type : "Staff") + '</select></div></div>' +
      '<div class="seg" role="tablist"><button type="button" data-src="design" aria-selected="' + !isWord + '">Design here</button><button type="button" data-src="word" aria-selected="' + isWord + '">Use a Word file</button></div>' +
      '<div id="srcDesign"' + (isWord ? " hidden" : "") + '>' +
      (x ? "" : '<div class="fld"><label for="tStart">Start from</label><select id="tStart">' + opts(Object.keys(STARTERS), "Employment contract") + '</select></div>') +
      '<div class="ed-bar" role="toolbar" aria-label="Formatting">' +
      '<button type="button" data-cmd="bold" title="Bold"><b>B</b></button><button type="button" data-cmd="italic" title="Italic"><i>I</i></button><button type="button" data-cmd="underline" title="Underline"><u>U</u></button>' +
      '<button type="button" data-block="H1" title="Title">Title</button><button type="button" data-block="H2" title="Heading">Heading</button><button type="button" data-block="P" title="Normal text">Text</button>' +
      '<button type="button" data-cmd="insertUnorderedList" title="Bullet list">• List</button><button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>' +
      '<button type="button" data-cmd="justifyLeft" title="Align left">Left</button><button type="button" data-cmd="justifyCenter" title="Centre">Centre</button>' +
      '<button type="button" data-sign title="Add signature lines">Signatures</button>' +
      '<select id="tField" aria-label="Insert a field"><option value="">+ Insert field…</option>' + opts(BUILTIN.map(function (b) { return [b[0], b[1]]; })) + '<option value="__custom">Your own field…</option></select></div>' +
      '<div class="ag-editor" id="tEditor" contenteditable="true" spellcheck="true" aria-label="Template wording"></div></div>' +
      '<div id="srcWord"' + (isWord ? "" : " hidden") + '>' +
      '<p class="note">In Word, type fields in double curly brackets, e.g. <b>{{staff_name}}</b>, <b>{{start_date}}</b> or your own like <b>{{monthly_salary}}</b>. KAHDHU fills them in and keeps your Word formatting.</p>' +
      '<div class="fld"><label for="tFile">Word file (.docx)</label><input id="tFile" type="file" accept=".docx,' + DOCX + '"></div>' +
      (isWord ? '<p class="note">Current file is kept unless you choose a new one. <button type="button" class="linkish" id="tGetWord">Download current Word file</button></p>' : "") +
      '<div class="ag-preview" id="tPreview">' + (isWord ? x.body_html : '<p class="muted-cell">Choose a .docx file to see a preview.</p>') + '</div></div>' +
      '<p class="fields-line" id="tFields"></p>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' + (x ? '<button type="button" class="ghost danger" id="tDelete">Delete</button><button type="button" class="ghost" id="tActive">' + (x.active ? "Turn off" : "Turn on") + '</button>' : "") +
      '<span style="flex:1"></span><button type="button" class="ghost" data-close>Close</button><button type="button" class="save" id="tSave">Save template</button></div>', true);

    var ed = $("tEditor"), src = isWord ? "word" : "design";
    ed.innerHTML = x && !isWord ? x.body_html : STARTERS["Employment contract"].html;
    function showFields() {
      var html = src === "word" ? (upload ? upload.html : x && isWord ? x.body_html : "") : ed.innerHTML, f = fieldsIn(html);
      var own = f.filter(function (k) { return BUILTIN_KEYS.indexOf(k) < 0; });
      $("tFields").innerHTML = f.length ? "<b>Fields:</b> " + f.length + " (" + (f.length - own.length) + " fill in automatically" + (own.length ? ", " + own.length + " you type in each time: " + own.map(function (k) { return esc(label(k)); }).join(", ") : "") + ")" : "No fields yet.";
    }
    showFields();
    ed.addEventListener("input", showFields);
    if ($("tStart")) $("tStart").addEventListener("change", function () {
      var st = STARTERS[this.value]; ed.innerHTML = st.html; $("tCat").value = cats.indexOf(st.cat) > -1 ? st.cat : $("tCat").value; $("tParty").value = st.party;
      if (!$("tName").value.trim() && this.value !== "Blank") $("tName").value = this.value; showFields();
    });
    [].forEach.call(document.querySelectorAll("[data-src]"), function (b) {
      b.addEventListener("click", function () {
        src = b.dataset.src; [].forEach.call(document.querySelectorAll("[data-src]"), function (o) { o.setAttribute("aria-selected", o === b); });
        $("srcDesign").hidden = src !== "design"; $("srcWord").hidden = src !== "word"; showFields();
      });
    });
    [].forEach.call(document.querySelectorAll(".ed-bar [data-cmd]"), function (b) { b.addEventListener("mousedown", function (e) { e.preventDefault(); document.execCommand(b.dataset.cmd); showFields(); }); });
    [].forEach.call(document.querySelectorAll(".ed-bar [data-block]"), function (b) { b.addEventListener("mousedown", function (e) { e.preventDefault(); document.execCommand("formatBlock", false, b.dataset.block); }); });
    document.querySelector(".ed-bar [data-sign]").addEventListener("mousedown", function (e) { e.preventDefault(); ed.focus(); document.execCommand("insertHTML", false, SIGN); showFields(); });
    var range = null;
    ed.addEventListener("blur", function () { var s = window.getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); });
    $("tField").addEventListener("change", function () {
      var k = this.value; this.value = ""; if (!k) return;
      if (k === "__custom") { var n = prompt("Name of your field, e.g. Monthly salary"); if (!n) return; k = n.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); if (!k) return; }
      ed.focus(); if (range) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(range); }
      document.execCommand("insertText", false, "{{" + k + "}}"); showFields();
    });
    $("tFile").addEventListener("change", function () {
      var f = this.files[0]; if (!f) return;
      if (!/\.docx$/i.test(f.name)) { say("Choose a .docx file. Older .doc files: open in Word and Save As .docx first.", "err"); return; }
      if (f.size > 20 * 1048576) { say("That file is over 20 MB.", "err"); return; }
      say("Reading the Word file…");
      docxToHtml(f).then(function (html) { upload = { blob: f, html: html }; $("tPreview").innerHTML = html; showFields(); say(""); if (!$("tName").value.trim()) $("tName").value = f.name.replace(/\.docx$/i, ""); })
        .catch(function (e) { say("Could not read that Word file: " + e.message, "err"); });
    });
    if ($("tGetWord")) $("tGetWord").addEventListener("click", function () { getFile(x.docx_path).then(function (b) { saveBlob(b, x.name + ".docx"); }).catch(function (e) { say(e.message, "err"); }); });

    $("tSave").addEventListener("click", function () {
      var btn = this, name = $("tName").value.trim();
      if (name.length < 2) { say("Give the template a name.", "err"); return; }
      if (src === "word" && !upload && !(x && isWord)) { say("Choose a Word file first.", "err"); return; }
      var row = { name: name, category: $("tCat").value, party_type: $("tParty").value };
      if (src === "design") { row.body_html = clean(ed.innerHTML); row.docx_path = null; if (!row.body_html.replace(/<[^>]*>/g, "").trim()) { say("Write the template wording first.", "err"); return; } }
      else if (upload) row.body_html = upload.html;
      busy(btn, "Saving…");
      var saved = (x ? db.from("agreement_templates").update(row).eq("id", x.id) : db.from("agreement_templates").insert(Object.assign({ company_id: company.id }, row))).select().single().then(check);
      saved.then(function (t) {
        if (src !== "word" || !upload) return t;
        return putFile(company.id + "/templates/" + t.id + ".docx", upload.blob, DOCX).then(function (p) { return db.from("agreement_templates").update({ docx_path: p }).eq("id", t.id).select().single().then(check); });
      }).then(function () { return reload(); }).then(function () { tab = "templates"; render(); closeModal(); })
        .catch(function (e) { idle(btn); say(e.message, "err"); });
    });
    if (x) {
      $("tActive").addEventListener("click", function () { db.from("agreement_templates").update({ active: !x.active }).eq("id", x.id).then(check).then(reload).then(closeModal).catch(function (e) { say(e.message, "err"); }); });
      $("tDelete").addEventListener("click", function () {
        if (!confirm("Delete the template \"" + x.name + "\"? Agreements already made from it are kept.")) return;
        db.from("agreement_templates").delete().eq("id", x.id).then(check).then(function () { return x.docx_path ? db.storage.from(BUCKET).remove([x.docx_path]) : null; })
          .then(reload).then(closeModal).catch(function (e) { say(e.message, "err"); });
      });
    }
  }

  /* New or edit agreement: template + who it's for + the details. */
  function openAgreementForm(id, tplId) {
    var a = id ? agreement(id) : null, active = model.templates.filter(function (x) { return x.active || (a && x.id === a.template_id); });
    if (!active.length) { openModal('<h2>No templates yet</h2><p class="note">An agreement is made from a template. Make one first: design it here, use a ready-made one, or upload a Word file.</p><div class="modal-actions"><button type="button" class="ghost" data-close>Close</button><button type="button" class="save" id="goTpl">New template</button></div>'); $("goTpl").addEventListener("click", function () { openTemplate(null); }); return; }
    var tpl = template(tplId || (a && a.template_id)) || active[0], cats = categories(), typed = Object.assign({}, a ? a.field_values : {});
    if (cats.indexOf(tpl.category) < 0) cats.push(tpl.category);
    var d = a ? Object.assign({}, a) : { party_type: tpl.party_type, category: tpl.category, staff_user_id: null, party_name: "", party_email: "", start_date: "", end_date: "", title: "" };
    openModal('<h2>' + (a ? "Edit " + esc(a.number) : "New agreement") + '</h2><p class="note">Pick a template and who it is for. Details fill in by themselves; anything else you type below. A PDF is saved when you click Save.</p>' +
      '<div class="ag-row"><div class="fld"><label for="aTpl">Template</label><select id="aTpl"' + (a ? " disabled" : "") + '>' + opts(active.map(function (x) { return [x.id, x.name + (x.docx_path ? " (Word)" : "")]; }), tpl.id) + '</select></div>' +
      '<div class="fld"><label for="aParty">Made out to</label><select id="aParty">' + opts([["Staff", "A staff member"], ["Client", "A client"], ["Vendor", "A supplier"], ["Other", "Someone else"]], d.party_type) + '</select></div></div>' +
      '<div class="ag-row" id="whoStaff"><div class="fld"><label for="aStaff">Staff member</label><select id="aStaff"><option value="">Choose a person…</option>' + opts(model.people.map(function (p) { return [p.uid, p.name + (p.position ? " · " + p.position : "")]; }), d.staff_user_id) + '</select></div></div>' +
      '<div class="ag-row" id="whoOther"><div class="fld"><label for="aPName">Name</label><input id="aPName" maxlength="160" value="' + esc(d.party_name || "") + '" placeholder="Company or person"></div>' +
      '<div class="fld"><label for="aPEmail">Email (optional)</label><input id="aPEmail" type="email" maxlength="200" value="' + esc(d.party_email || "") + '"></div></div>' +
      '<div class="fld"><label for="aTitle">Agreement title</label><input id="aTitle" maxlength="160" value="' + esc(d.title) + '"></div>' +
      '<div class="ag-row"><div class="fld"><label for="aCat">Category</label><select id="aCat">' + opts(cats, d.category) + '</select></div>' +
      '<div class="fld"><label for="aStartD">Start date</label><input id="aStartD" type="date" value="' + esc(d.start_date || "") + '"></div>' +
      '<div class="fld"><label for="aEndD">End date (optional)</label><input id="aEndD" type="date" value="' + esc(d.end_date || "") + '"></div></div>' +
      '<h3>Details</h3><div id="aFields"></div>' +
      '<details class="ag-prev-wrap"><summary>Preview</summary><div class="ag-preview" id="aPreview"></div></details>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Close</button><button type="button" class="save" id="aSave">' + (a ? "Save and update PDF" : "Save draft and PDF") + '</button></div>', true);

    var titleTouched = !!(a && a.title);
    function current() {
      d.party_type = $("aParty").value; d.staff_user_id = d.party_type === "Staff" ? ($("aStaff").value || null) : null;
      d.party_name = d.party_type === "Staff" ? "" : $("aPName").value.trim(); d.party_email = d.party_type === "Staff" ? "" : $("aPEmail").value.trim();
      d.start_date = $("aStartD").value || null; d.end_date = $("aEndD").value || null; d.category = $("aCat").value; d.title = $("aTitle").value.trim();
      return d;
    }
    function who() { var p = d.staff_user_id && model.people.filter(function (x) { return x.uid === d.staff_user_id; })[0]; return p ? p.name : d.party_name; }
    function drawFields() {
      current();
      $("whoStaff").hidden = d.party_type !== "Staff"; $("whoOther").hidden = d.party_type === "Staff";
      if (!titleTouched) { $("aTitle").value = tpl.name + (who() ? " – " + who() : ""); d.title = $("aTitle").value; }
      var auto = autoValues(d), f = fieldsIn(tpl.body_html);
      var mine = f.filter(function (k) { return BUILTIN_KEYS.indexOf(k) < 0; }), autos = f.filter(function (k) { return BUILTIN_KEYS.indexOf(k) > -1; });
      $("aFields").innerHTML = (mine.length ? '<div class="ag-row wrap">' + mine.map(function (k) {
        return '<div class="fld"><label for="f_' + k + '">' + esc(label(k)) + '</label><input id="f_' + k + '" data-field="' + k + '" maxlength="500" value="' + esc(typed[k] || "") + '"></div>';
      }).join("") + '</div>' : '<p class="note">Nothing to type in: every field in this template fills in automatically.</p>') +
        (autos.length ? '<p class="fields-line"><b>Filled in automatically:</b> ' + autos.map(function (k) { return esc(label(k)) + ": <i>" + (esc(auto[k]) || "<span class=exp>empty</span>") + "</i>"; }).join(" · ") + '</p>' : "");
      [].forEach.call(document.querySelectorAll("[data-field]"), function (i) { i.addEventListener("input", function () { typed[i.dataset.field] = i.value; preview(); }); });
      preview();
    }
    function values() { return Object.assign(autoValues(current()), typed); }
    function preview() { $("aPreview").innerHTML = clean(fill(tpl.body_html, Object.assign(values(), { agreement_number: a ? a.number : "(given when saved)" }))); }
    $("aTpl").addEventListener("change", function () { tpl = template(this.value); $("aParty").value = tpl.party_type; if (cats.indexOf(tpl.category) > -1) $("aCat").value = tpl.category; drawFields(); });
    ["aParty", "aStaff", "aStartD", "aEndD", "aCat"].forEach(function (k) { $(k).addEventListener("change", drawFields); });
    $("aPName").addEventListener("input", drawFields);
    $("aTitle").addEventListener("input", function () { titleTouched = true; });
    drawFields();

    $("aSave").addEventListener("click", function () {
      var btn = this; current();
      if (d.party_type === "Staff" && !d.staff_user_id) { say("Choose the staff member.", "err"); return; }
      if (d.party_type !== "Staff" && d.party_name.length < 2) { say("Enter who the agreement is with.", "err"); return; }
      if (d.title.length < 2) { say("Give the agreement a title.", "err"); return; }
      if (d.start_date && d.end_date && d.end_date < d.start_date) { say("The end date is before the start date.", "err"); return; }
      var vals = values(), row = { template_id: tpl.id, title: d.title, category: d.category, party_type: d.party_type, staff_user_id: d.staff_user_id, party_name: d.party_type === "Staff" ? who() : d.party_name, party_email: d.party_email || null, start_date: d.start_date, end_date: d.end_date, field_values: vals };
      busy(btn, "Saving…"); say("Saving the agreement…");
      var made = null;
      var saved = (a ? db.from("agreements").update(row).eq("id", a.id) : db.from("agreements").insert(Object.assign({ company_id: company.id, status: "Draft" }, row))).select().single().then(check);
      saved.then(function (r) { made = r; say("Making the PDF…"); return build(r, tpl, vals); })
        .then(function (r) { return reload().then(function () { tab = "agreements"; render(); openManage(r.id); say("Saved. The PDF is stored with the agreement.", "ok"); }); })
        .catch(function (e) {
          idle(btn);
          if (!made) { say(e.message, "err"); return; }
          reload().then(function () { openManage(made.id); say("Saved, but the PDF could not be made: " + e.message + " Click Make PDF to try again.", "err"); });
        });
    });
  }

  /* Manage one agreement: status, files, Word round-trip. */
  function openManage(id) {
    var a = agreement(id); if (!a) return;
    var st = shownStatus(a), locked = a.status === "Signed" || a.status === "Cancelled";
    openModal('<h2>' + esc(a.title) + '</h2><p class="note">' + esc(a.number) + ' · ' + esc(a.category) + ' · with ' + esc(partyOf(a)) + (a.party_email ? " (" + esc(a.party_email) + ")" : "") + '</p>' +
      '<div class="steps">' + ["Draft", "Sent", "Signed"].map(function (s, i) { var idx = ["Draft", "Sent", "Signed"].indexOf(a.status); return '<span class="' + (a.status === "Cancelled" ? "" : i < idx ? "done" : i === idx ? "now" : "") + '">' + (i + 1) + '. ' + s + '</span>'; }).join("") + '</div>' +
      '<p class="fields-line">Status: <span class="chip ag-st-' + slug(st) + '">' + esc(st) + '</span>' + (a.signed_at ? " · signed " + esc(fmtDate(a.signed_at)) : "") + (a.start_date ? " · " + esc(fmtDate(a.start_date)) + (a.end_date ? " – " + esc(fmtDate(a.end_date)) : "") : "") + '</p>' +
      '<h3>Files</h3><div class="file-row">' +
      (a.pdf_path ? '<button type="button" class="ghost" id="mPdf">Download PDF</button>' : '<span class="exp">No PDF yet.</span>') +
      '<button type="button" class="ghost" id="mWord">Download Word</button>' +
      (a.signed_path ? '<button type="button" class="ghost" id="mSignedGet">Download signed copy</button>' : "") +
      '<button type="button" class="ghost" id="mRebuild">' + (a.pdf_path ? "Make PDF again" : "Make PDF") + '</button></div>' +
      (!locked ? '<div class="fld" style="margin-top:12px"><label for="mDocx">Edited it in Word? Upload the .docx here</label><input id="mDocx" type="file" accept=".docx,' + DOCX + '"><small class="hint">This replaces the agreement wording and saves a new PDF.</small></div>' : "") +
      '<div class="fld" style="margin-top:12px"><label for="mSigned">' + (a.signed_path ? "Replace signed copy" : "Signed copy (scan, photo or PDF)") + '</label><input id="mSigned" type="file" accept="application/pdf,image/png,image/jpeg"></div>' +
      '<details class="ag-prev-wrap"><summary>Show the agreement</summary><div class="ag-preview">' + clean(a.body_html || "") + '</div></details>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions">' +
      (a.status === "Draft" || a.status === "Cancelled" ? '<button type="button" class="ghost danger" id="mDelete">Delete</button>' : "") +
      (a.status !== "Cancelled" && a.status !== "Signed" ? '<button type="button" class="ghost danger" id="mCancel">Cancel agreement</button>' : "") +
      '<span style="flex:1"></span>' +
      (!locked ? '<button type="button" class="ghost" id="mEdit">Edit details</button>' : "") +
      (a.status === "Draft" ? '<button type="button" class="save" id="mSent">Mark as sent</button>' : "") +
      (a.status === "Sent" || a.status === "Draft" ? '<button type="button" class="save" id="mSign">Mark as signed</button>' : "") +
      (a.status === "Cancelled" ? '<button type="button" class="save" id="mReopen">Back to draft</button>' : "") + '</div>' +
      (a.status === "Sent" && a.staff_user_id ? '<p class="note" style="margin-top:10px">' + esc(partyOf(a)) + ' can now see and download this agreement on their own Agreements page.</p>' : ""), true);

    function setStatus(s, extra) {
      return db.from("agreements").update(Object.assign({ status: s }, extra || {})).eq("id", a.id).then(check).then(reload).then(function () { openManage(a.id); });
    }
    function err(e) { say(e.message, "err"); }
    if ($("mPdf")) $("mPdf").addEventListener("click", function () { download(this, a, "pdf"); });
    $("mWord").addEventListener("click", function () { download(this, a, "word"); });
    if ($("mSignedGet")) $("mSignedGet").addEventListener("click", function () { download(this, a, "signed"); });
    $("mRebuild").addEventListener("click", function () { var b = this; busy(b, "Making PDF…"); rebuildFromStored(a).then(reload).then(function () { openManage(a.id); say("PDF saved.", "ok"); }).catch(function (e) { idle(b); err(e); }); });
    if ($("mDocx")) $("mDocx").addEventListener("change", function () {
      var f = this.files[0]; if (!f) return;
      if (!/\.docx$/i.test(f.name)) { say("Choose a .docx file.", "err"); return; }
      say("Uploading the Word file and making a new PDF…");
      putFile(company.id + "/" + a.id + "/agreement.docx", f, DOCX).then(function (p) { return db.from("agreements").update({ docx_path: p }).eq("id", a.id).select().single().then(check); })
        .then(rebuildFromStored).then(reload).then(function () { openManage(a.id); say("Updated from your Word file. New PDF saved.", "ok"); }).catch(err);
    });
    $("mSigned").addEventListener("change", function () {
      var f = this.files[0]; if (!f) return;
      if (f.size > 20 * 1048576) { say("That file is over 20 MB.", "err"); return; }
      var ext = f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : "jpg";
      say("Uploading the signed copy…");
      if (a.signed_path && a.signed_path.split(".").pop() !== ext) db.storage.from(BUCKET).remove([a.signed_path]);
      putFile(company.id + "/" + a.id + "/signed." + ext, f, f.type).then(function (p) {
        var patch = { signed_path: p }; if (a.status !== "Signed" && confirm("Mark the agreement as signed too?")) patch.status = "Signed";
        return db.from("agreements").update(patch).eq("id", a.id).then(check);
      }).then(reload).then(function () { openManage(a.id); say("Signed copy saved.", "ok"); }).catch(err);
    });
    if ($("mEdit")) $("mEdit").addEventListener("click", function () { openAgreementForm(a.id); });
    if ($("mSent")) $("mSent").addEventListener("click", function () { setStatus("Sent").catch(err); });
    if ($("mSign")) $("mSign").addEventListener("click", function () { if (!a.signed_path && !confirm("Mark as signed without a signed copy? You can upload it later.")) return; setStatus("Signed").catch(err); });
    if ($("mReopen")) $("mReopen").addEventListener("click", function () { setStatus("Draft").catch(err); });
    if ($("mCancel")) $("mCancel").addEventListener("click", function () { if (confirm("Cancel this agreement? You can still see it and its files.")) setStatus("Cancelled").catch(err); });
    if ($("mDelete")) $("mDelete").addEventListener("click", function () {
      if (!confirm("Delete " + a.number + " and its files for good? This cannot be undone.")) return;
      var files = [a.pdf_path, a.docx_path, a.signed_path].filter(Boolean);
      (files.length ? db.storage.from(BUCKET).remove(files) : Promise.resolve()).then(function () { return db.from("agreements").delete().eq("id", a.id).then(check); })
        .then(reload).then(closeModal).catch(err);
    });
  }

  function bindHeader() {
    var na = $("newAgreement"), nt = $("newTemplate");
    if (na && !na._agBound) { na._agBound = true; na.addEventListener("click", function () { openAgreementForm(null); }); }
    if (nt && !nt._agBound) { nt._agBound = true; nt.addEventListener("click", function () { openTemplate(null); }); }
  }
  function onAgreementsPage() { return /agreements\.html$/.test(location.pathname); }

  /* ---------- start ---------- */
  window.VeyoraAgreements = {
    mount: function (c, info) {
      var same = company && model && company.id === c.id;
      company = c; ctx = info;
      if (same) { render(); return Promise.resolve(); }
      model = null;
      var host = $("ag"); if (host) host.innerHTML = '<p class="msg">Loading…</p>';
      return load(c, info).then(function (m) { model = m; render(); });
    }
  };
  if (onAgreementsPage()) window.VeyoraShell.start({
    active: "HR & Crew",
    onCompany: function (c, info) {
      company = c; ctx = info; model = null; fText = ""; fStatus = ""; fCat = ""; tab = "agreements";
      $("ag").innerHTML = '<p class="msg">Loading…</p>';
      return load(c, info).then(function (m) { model = m; render(); });
    },
    onNone: function (isPlatform) {
      $("ag").innerHTML = '<section class="dash-card"><h2>' + (isPlatform ? "Select a company" : "No company yet") + '</h2><p class="note">' + (isPlatform ? "Use the company menu at the top left to open a company." : "Create a company from the sign-in page, or ask your administrator for an invite.") + '</p></section>';
    },
    onError: function (err) { $("ag").innerHTML = '<section class="dash-card"><h2>Could not load Agreements</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
  window.addEventListener("hashchange", function () { if (company && /^#settings/.test(location.hash)) render(); else if (company && tab) render(); });
})();
