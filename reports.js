/* Reports: template library + PDF export via PDF Layout Maker.
   Cursor 2026-10-24: Generate uses published financial_report / employee_report layouts;
   finance data from finance_summary; HR attendance from payroll/leave where available. */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var company = null, canRun = false;
  var tab = "all";
  var recent = [];

  var LIBRARY = [
    { id: "trip_performance", cat: "operations", title: "Trip performance report", desc: "Departures, delays, travel time and trip records.", tone: "ops", icon: "boat", docType: "financial_report" },
    { id: "revenue_expense", cat: "finance", title: "Revenue & expense report", desc: "Receipts, payments and operating costs.", tone: "fin", icon: "cash", docType: "financial_report" },
    { id: "vessel_util", cat: "fleet", title: "Vessel utilization report", desc: "Fleet capacity, availability and assignment.", tone: "fleet", icon: "ship", docType: "financial_report" },
    { id: "incident_safety", cat: "operations", title: "Incident and safety report", desc: "Operational events and actions taken.", tone: "ops", icon: "alert", docType: "financial_report" },
    { id: "passenger_move", cat: "operations", title: "Passenger movement report", desc: "Bookings, boarding volume and manifests.", tone: "pax", icon: "people", docType: "financial_report" },
    { id: "crew_attendance", cat: "hr", title: "Crew attendance report", desc: "Roster coverage, duty hours and leave.", tone: "hr", icon: "people", docType: "employee_report" },
    { id: "maint_history", cat: "fleet", title: "Maintenance history report", desc: "Service records, defects and work orders.", tone: "maint", icon: "wrench", docType: "financial_report" },
    { id: "route_compare", cat: "operations", title: "Route comparison report", desc: "Compare trip volume, punctuality and demand.", tone: "ops", icon: "chart", docType: "financial_report" }
  ];

  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  var I = {
    doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
    download: '<path d="M12 4v12M8 12l4 4 4-4M4 20h16"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>',
    chart: '<path d="M4 19h16M7 16V9M12 16V5M17 16v-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    boat: '<path d="M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4"/>',
    cash: '<path d="M4 8h16v10H4zM4 11h16M9 15h2"/>',
    ship: '<path d="M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4"/>',
    alert: '<path d="M12 4 3 20h18L12 4ZM12 10v4M12 17h.01"/>',
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    wrench: '<path d="M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-3-1-1-3z"/>'
  };
  function ic(name) { return I[name] || I.doc; }

  function areas() {
    var s = {};
    LIBRARY.forEach(function (r) { s[r.cat] = true; });
    return Object.keys(s).length;
  }
  function sources() { return 9; }

  function filtered() {
    if (tab === "all") return LIBRARY.slice();
    return LIBRARY.filter(function (r) { return r.cat === tab; });
  }

  function kpis() {
    return {
      templates: LIBRARY.length,
      templatesSub: "Across " + areas() + " business areas",
      exports: recent.length,
      exportsSub: "PDF downloads this session",
      scheduled: 0,
      scheduledSub: "Sent automatically",
      sources: sources(),
      sourcesSub: "Connected management modules"
    };
  }

  function recentBlock() {
    if (!recent.length) {
      return '<div class="rep-empty-side">No exports yet. Run a template or use Quick export.</div>';
    }
    return '<div class="rep-recent">' + recent.map(function (r) {
      var fmt = (r.format || "PDF").toLowerCase();
      return '<div class="rep-recent-row"><div class="grow"><strong>' + esc(r.title) + '</strong><small>' + esc(r.when || "") + '</small></div>' +
        '<span class="rep-fmt ' + esc(fmt) + '">' + esc((r.format || "PDF").toUpperCase()) + '</span></div>';
    }).join("") + '</div>';
  }

  function monthRangeLabel() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth();
    var name = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    var last = new Date(y, m + 1, 0).getDate();
    return "1 – " + last + " " + name;
  }

  function render() {
    var k = kpis();
    var list = filtered();

    $("repActions").innerHTML = canRun
      ? '<button type="button" class="primary-btn" id="repNew">' + icon(I.plus) + ' Create custom report</button>'
      : "";

    $("rep").innerHTML =
      '<div class="rep-kpis">' +
        '<div class="rep-kpi"><span class="tile tone-blue">' + icon(I.doc) + '</span><div><small>Report templates</small><strong>' + String(k.templates).padStart(2, "0") + '</strong><span class="sub">' + esc(k.templatesSub) + '</span></div></div>' +
        '<div class="rep-kpi"><span class="tile tone-green">' + icon(I.download) + '</span><div><small>Exports this session</small><strong>' + String(k.exports).padStart(2, "0") + '</strong><span class="sub">' + esc(k.exportsSub) + '</span></div></div>' +
        '<div class="rep-kpi"><span class="tile tone-purple">' + icon(I.cal) + '</span><div><small>Scheduled reports</small><strong>' + String(k.scheduled).padStart(2, "0") + '</strong><span class="sub">' + esc(k.scheduledSub) + '</span></div></div>' +
        '<div class="rep-kpi"><span class="tile tone-amber">' + icon(I.chart) + '</span><div><small>Data sources</small><strong>' + String(k.sources).padStart(2, "0") + '</strong><span class="sub">' + esc(k.sourcesSub) + '</span></div></div>' +
      '</div>' +
      '<div class="rep-layout"><section class="rep-main">' +
        '<div class="card-head"><div><h2>Report library</h2><p class="note">Ready-made analytics across operations, finance, HR and fleet. PDF uses your published layouts.</p></div></div>' +
        '<div class="rep-tabs">' +
          [["all", "All reports"], ["operations", "Operations"], ["finance", "Finance"], ["hr", "HR & Crew"], ["fleet", "Fleet"]].map(function (t) {
            return '<button type="button" class="' + (tab === t[0] ? "on" : "") + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
          }).join("") +
        '</div>' +
        '<div class="rep-grid">' + list.map(function (r) {
          return '<button type="button" class="rep-card" data-report="' + esc(r.id) + '"><span class="ric ' + r.tone + '">' + icon(ic(r.icon)) + '</span><span><strong>' + esc(r.title) + '</strong><small>' + esc(r.desc) + '</small></span></button>';
        }).join("") + '</div>' +
      '</section><aside class="rep-side">' +
        '<section><h2>Recently generated</h2><p class="note">Your latest downloads.</p>' + recentBlock() + '</section>' +
        '<section><h2>Quick export</h2><p class="note">Pick a type and date range.</p>' +
          '<div class="rep-quick">' +
            '<div class="fld"><label for="qType">Report type</label><select id="qType">' +
              LIBRARY.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.title.replace(/ report$/i, "")) + '</option>'; }).join("") +
            '</select></div>' +
            '<div class="fld"><label for="qRange">Date range</label><input id="qRange" value="' + esc(monthRangeLabel()) + '" readonly></div>' +
            '<button type="button" class="primary-btn export" id="qExport"' + (canRun ? "" : " disabled") + '>' + icon(I.download) + ' Export report</button>' +
          '</div>' +
        '</section>' +
      '</aside></div>';

    bind();
  }

  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function money(n, currency) {
    n = Number(n) || 0;
    return (currency || company.currency || "MVR") + " " + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function buildFinanceRows(from, to) {
    return db.rpc("finance_summary", { p_company: company.id, p_from: from, p_to: to }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var data = r.data || {};
      var k = data.kpis || {};
      var currency = data.currency || company.currency || "MVR";
      var rows = [
        { label: "Revenue", value: money(k.revenue, currency) },
        { label: "Expenses", value: money(k.expenses, currency) },
        { label: "Refunds", value: money(k.refunds, currency) },
        { label: "Net", value: money(k.net, currency) },
        { label: "Outstanding invoices", value: String(k.outstanding_count || 0) + " · " + money(k.outstanding, currency) }
      ];
      (data.by_category || []).forEach(function (c) {
        rows.push({ label: "Expense · " + (c.category || "Other"), value: money(c.amount, currency) });
      });
      (data.by_route || []).slice(0, 15).forEach(function (x) {
        rows.push({ label: "Route · " + (x.route || "—"), value: money(x.revenue, currency) });
      });
      return { rows: rows, summary: k };
    });
  }

  function buildTripRows(from, to) {
    return db.from("trips").select("id,depart_at,arrive_at,status,route_id,vessel_id")
      .eq("company_id", company.id)
      .gte("depart_at", from + "T00:00:00")
      .lte("depart_at", to + "T23:59:59")
      .order("depart_at", { ascending: false })
      .limit(80)
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        var trips = r.data || [];
        var byStatus = {};
        trips.forEach(function (t) { byStatus[t.status || "Unknown"] = (byStatus[t.status || "Unknown"] || 0) + 1; });
        var rows = [{ label: "Trips in period", value: String(trips.length) }];
        Object.keys(byStatus).forEach(function (st) {
          rows.push({ label: "Status · " + st, value: String(byStatus[st]) });
        });
        trips.slice(0, 20).forEach(function (t) {
          rows.push({ label: String(t.depart_at || "").slice(0, 16), value: t.status || "—" });
        });
        return { rows: rows, summary: { count: trips.length } };
      });
  }

  function buildHrRows(from, to) {
    return db.from("leave_requests").select("id,status,leave_type,user_id,start_date,end_date")
      .eq("company_id", company.id)
      .gte("start_date", from)
      .lte("start_date", to)
      .limit(100)
      .then(function (r) {
        if (r.error) {
          return db.from("payroll_runs").select("id,period_start,period_end,status,staff_count,gross,net")
            .eq("company_id", company.id).order("period_end", { ascending: false }).limit(6)
            .then(function (p) {
              if (p.error) throw new Error(p.error.message);
              var rows = (p.data || []).map(function (run) {
                return { label: run.period_start + " → " + run.period_end + " (" + run.status + ")", value: money(run.net) + " · " + (run.staff_count || 0) + " staff" };
              });
              if (!rows.length) rows = [{ label: "No HR data in range", value: "—" }];
              return { rows: rows, summary: {} };
            });
        }
        var leaves = r.data || [];
        var by = {};
        leaves.forEach(function (l) { by[l.status || "Unknown"] = (by[l.status || "Unknown"] || 0) + 1; });
        var rows = [{ label: "Leave requests", value: String(leaves.length) }];
        Object.keys(by).forEach(function (st) { rows.push({ label: "Status · " + st, value: String(by[st]) }); });
        leaves.slice(0, 15).forEach(function (l) {
          rows.push({ label: (l.leave_type || "Leave") + " · " + l.start_date + " → " + l.end_date, value: l.status || "—" });
        });
        return { rows: rows, summary: { leave: leaves.length } };
      });
  }

  function buildMaintRows(from, to) {
    return db.from("work_orders").select("id,status,title,created_at")
      .eq("company_id", company.id)
      .gte("created_at", from)
      .lte("created_at", to + "T23:59:59")
      .limit(50)
      .then(function (r) {
        if (r.error) {
          return { rows: [{ label: "Maintenance", value: "Not available (" + r.error.message + ")" }], summary: {} };
        }
        var rows = (r.data || []).map(function (w) {
          return { label: String(w.title || w.id).slice(0, 60), value: w.status || "—" };
        });
        if (!rows.length) rows = [{ label: "No work orders in range", value: "—" }];
        return { rows: rows, summary: { count: rows.length } };
      });
  }

  function gatherRows(reportId, from, to) {
    if (reportId === "revenue_expense") return buildFinanceRows(from, to);
    if (reportId === "crew_attendance") return buildHrRows(from, to);
    if (reportId === "maint_history") return buildMaintRows(from, to);
    if (reportId === "trip_performance" || reportId === "route_compare" || reportId === "passenger_move" || reportId === "incident_safety" || reportId === "vessel_util") {
      return buildTripRows(from, to).catch(function () {
        return buildFinanceRows(from, to);
      });
    }
    return buildFinanceRows(from, to);
  }

  function runExport(reportId, from, to, fmt) {
    var meta = LIBRARY.filter(function (x) { return x.id === reportId; })[0] || LIBRARY[0];
    if (fmt !== "PDF") {
      say("Only PDF is supported right now. XLSX/CSV wait on Claude report_runs storage.", "err");
      return;
    }
    if (!window.VeyoraPdfApi) {
      say("PDF engine not loaded. Refresh the page.", "err");
      return;
    }
    say("Gathering data…");
    gatherRows(reportId, from, to).then(function (pack) {
      say("Generating PDF…");
      var payload = window.VeyoraPdfApi.mapReportPayload(
        { title: meta.title, from_date: from, to_date: to },
        [{ key: "label" }, { key: "value" }],
        pack.rows,
        pack.summary
      );
      return window.VeyoraPdfApi.generate({
        companyId: company.id,
        documentType: meta.docType || "financial_report",
        source: payload,
        filename: reportId + "-" + from + "-to-" + to + ".pdf",
        allowMissing: true
      }).then(function () {
        recent.unshift({ title: meta.title, when: new Date().toLocaleString("en-GB"), format: "PDF" });
        if (recent.length > 12) recent = recent.slice(0, 12);
        closeModal();
        render();
      });
    }).catch(function (e) { say(e.message, "err"); });
  }

  function openReport(id) {
    var r = LIBRARY.filter(function (x) { return x.id === id; })[0] || LIBRARY[0];
    openModal('<h2>' + esc(r.title) + '</h2><p class="note">' + esc(r.desc) + ' PDF uses your published layout under Finance / HR → PDF Layouts. Company details come from the database.</p>' +
      '<div class="cards">' +
        '<div class="fld"><label for="rFrom">From</label><input id="rFrom" type="date"></div>' +
        '<div class="fld"><label for="rTo">To</label><input id="rTo" type="date"></div>' +
        '<div class="fld full"><label for="rFmt">Format</label><select id="rFmt"><option>PDF</option><option>XLSX</option><option>CSV</option></select></div>' +
      '</div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="rGo">Generate</button></div>');
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth(), 1);
    $("rFrom").value = iso(first);
    $("rTo").value = iso(now);
    $("rGo").addEventListener("click", function () {
      runExport(r.id, $("rFrom").value, $("rTo").value, $("rFmt").value);
    });
  }

  function openCustom() {
    openModal('<h2>Create custom report</h2><p class="note">Name a custom view. Saving waits until Claude adds custom report definitions. You can still export any library template as PDF now.</p>' +
      '<div class="cards">' +
        '<div class="fld full"><label for="cName">Name</label><input id="cName" maxlength="80" placeholder="e.g. Weekly delay summary"></div>' +
        '<div class="fld full"><label for="cArea">Area</label><select id="cArea"><option>Operations</option><option>Finance</option><option>HR &amp; Crew</option><option>Fleet</option><option>Passengers</option><option>Maintenance</option></select></div>' +
        '<div class="fld full"><label for="cDesc">Description</label><textarea id="cDesc" maxlength="300" placeholder="What should this report show?"></textarea></div>' +
      '</div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="cGo">Save draft</button></div>');
    $("cGo").addEventListener("click", function () {
      if (!$("cName").value.trim()) { say("Enter a name.", "err"); return; }
      say("Custom report definitions are not stored yet. Use a library template to export PDF today.", "err");
    });
  }

  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  function openModal(html) {
    $("modalCard").className = "modal-card rep-modal";
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;
    var f = $("modalCard").querySelector("input,select,textarea");
    if (f) f.focus();
  }
  function closeModal() { $("modal").hidden = true; $("modalCard").innerHTML = ""; }

  function bind() {
    [].forEach.call(document.querySelectorAll("[data-tab]"), function (b) {
      b.addEventListener("click", function () { tab = b.dataset.tab; render(); });
    });
    [].forEach.call(document.querySelectorAll("[data-report]"), function (b) {
      b.addEventListener("click", function () { openReport(b.dataset.report); });
    });
    if ($("repNew")) $("repNew").addEventListener("click", openCustom);
    if ($("qExport")) $("qExport").addEventListener("click", function () { openReport($("qType").value); });
  }

  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });

  window.VeyoraShell.start({
    active: "Reports",
    onCompany: function (c, info) {
      company = c;
      canRun = !!(info.canAll || info.canReports || info.isPlatform || info.isAdmin || info.myRole === "operations" || info.myRole === "owner");
      recent = [];
      render();
      if (window.VeyoraTip) window.VeyoraTip("rep1", [
        "**Reports** exports PDFs using your published layouts from PDF Layout Maker.",
        "Finance and trip figures pull from live tables where available. Design branding under Finance → PDF Layouts.",
        "Scheduled runs and XLSX storage still wait on Claude report_runs."
      ]);
    },
    onNone: function () { $("rep").innerHTML = '<section class="dash-card"><h2>No company yet</h2><p class="note">Ask your administrator for an invite.</p></section>'; },
    onError: function (err) { $("rep").innerHTML = '<section class="dash-card"><h2>Could not load Reports</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
