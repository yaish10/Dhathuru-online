/* Finance: overview (finance_summary), invoices + PDF, expenses ledger, settings.
   Cursor 2026-10-24: #expenses — Manual add/edit/delete; Payroll/Maintenance shown read-only. */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var company = null, canView = false, canEdit = false;
  var series = "both", period = "month", prevK = {};
  var kpis = { revenue: 0, expenses: 0, refunds: 0, profit: 0, invoices: 0, invoicesAmt: 0, overdue: 0, revDelta: null, profitDelta: null };
  var chart = [];
  var routes = [];
  var tx = [];
  var cats = [];
  var invoices = [];
  var expenses = [];
  var refundBoard = { waiting: [], ops: [], records: [], rejected: [], waiting_total: 0, waiting_count: 0, ops_count: 0, paid_total: 0, paid_count: 0, needs_approval_count: 0, ready_count: 0, threshold: 2000 };
  var expFilter = { period: "month", category: "", source: "", q: "" };
  var summaryLoading = false, opsToday = null;
  var VIEWS = ["overview", "refunds", "tickets", "invoices", "expenses", "fares", "settings"];

  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  var I = {
    cash: '<path d="M4 8h16v10H4zM4 11h16M9 15h2"/><path d="M8 8V6h8v2"/>',
    card: '<path d="M4 8h16v10H4zM4 11h16"/>',
    trend: '<path d="M4 16l5-5 4 4 7-8"/><path d="M14 7h6v6"/>',
    invoice: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
    download: '<path d="M12 4v12M8 12l4 4 4-4M4 20h16"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    ticket: '<path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V8Z"/>',
    fuel: '<path d="M7 4h8v16H7zM15 8h3a2 2 0 0 1 2 2v8"/><path d="M10 8h2"/>',
    wrench: '<path d="M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-3-1-1-3z"/>',
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    refund: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };

  function route() {
    var h = (location.hash || "#overview").slice(1).split("/");
    if (h[0] === "settings") return { view: "settings", section: h[1] || (window.VeyoraFinanceSettings && window.VeyoraFinanceSettings.defaultSection) || "general", id: null };
    if (h[0] === "trips") { location.replace("#tickets"); h[0] = "tickets"; }
    return { view: VIEWS.indexOf(h[0]) > -1 ? h[0] : "overview", section: null, id: h[1] || null };
  }

  function setting(key) { return company && company.settings ? company.settings[key] : undefined; }
  function defaultsOf(title) { return window.VEYORA_DEFS && window.VEYORA_DEFS[title]; }
  function formSetting(key, title) {
    var saved = setting(key), spec = defaultsOf(title), out = {};
    (spec && spec.fields || []).forEach(function (f) { out[f.k] = f.d; });
    if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function listNames(key, title, fallback) {
    var saved = setting(key), spec = defaultsOf(title) || {};
    var rows = Array.isArray(saved) ? saved : ((spec.base || spec).def || fallback || []);
    return rows.map(function (r) {
      if (typeof r === "string") return r;
      if (r && r.active === false) return null;
      return r && r.name;
    }).filter(Boolean);
  }
  function expenseCategories() {
    var names = listNames("9_expense_categories", "Expense Categories", ["Fuel", "Repairs", "Salaries", "Utilities", "Supplies"]);
    var defs = formSetting("9_category_defaults", "Category Defaults");
    return { names: names.length ? names : ["Other"], def: defs.expenseImport || names[0] || "Fuel" };
  }
  function paymentMethods() {
    var names = listNames("9_payment_methods", "Payment Methods", ["Cash", "Bank transfer", "Card"]);
    return names.length ? names : ["Cash"];
  }

  function baseCfg() {
    var b = formSetting("9_base_currency", "Base Currency");
    return {
      code: b.base || (company && company.currency) || "MVR",
      dec: Math.min(4, Math.max(0, Number(b.decimals) >= 0 ? Number(b.decimals) : 2))
    };
  }
  function money(n) {
    n = Number(n) || 0;
    var c = baseCfg();
    var abs = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: c.dec, maximumFractionDigits: c.dec });
    return c.code + " " + abs;
  }
  function monthLabel() {
    return new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }

  function periodRange() {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    var from, to = new Date(y, m, now.getDate());
    if (period === "quarter") {
      var q = Math.floor(m / 3) * 3;
      from = new Date(y, q, 1);
    } else if (period === "30d") {
      from = new Date(y, m, now.getDate() - 29);
    } else if (period === "year") {
      from = new Date(y, 0, 1);
    } else {
      from = new Date(y, m, 1);
    }
    function iso(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    return { from: iso(from), to: iso(to) };
  }

  function pctDelta(cur, prev) {
    cur = Number(cur) || 0; prev = Number(prev) || 0;
    if (!prev) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  }

  function applySummary(data) {
    data = data || {};
    var k = data.kpis || {};
    var prev = k.prev || {};
    kpis = {
      revenue: Number(k.revenue) || 0,
      expenses: Number(k.expenses) || 0,
      refunds: Number(k.refunds) || 0,
      profit: Number(k.net) || 0,
      invoices: Number(k.outstanding_count) || 0,
      invoicesAmt: Number(k.outstanding) || 0,
      overdue: Number(k.overdue_count) || 0,
      revDelta: pctDelta(k.revenue, prev.revenue),
      profitDelta: pctDelta(k.net, prev.net)
    };
    prevK = { revenue: Number(prev.revenue) || 0, expenses: Number(prev.expenses) || 0, refunds: Number(prev.refunds) || 0, net: Number(prev.net) || 0 };
    chart = (data.series || []).map(function (d) {
      return { day: String(d.day || ""), d: String(d.day || "").slice(5), revenue: Number(d.revenue) || 0, expenses: Number(d.expenses) || 0, refunds: Number(d.refunds) || 0 };
    });
    routes = (data.by_route || []).map(function (r) {
      return { name: r.route || "Route", amount: Number(r.revenue) || 0 };
    });
    cats = (data.by_category || []).map(function (c) {
      var name = c.category || "Other";
      var icon = /fuel/i.test(name) ? "fuel" : /payroll|wage|salary|staff/i.test(name) ? "people" : "wrench";
      return { name: name, amount: Number(c.amount) || 0, icon: icon };
    });
    tx = (data.recent || []).map(function (e) {
      var kind = e.kind === "Revenue" ? "in" : e.kind === "Refund" ? "refund" : "out";
      return {
        title: e.description || e.category || e.kind,
        sub: [e.date, e.source, e.route].filter(Boolean).join(" · "),
        amount: Number(e.amount) || 0,
        kind: kind,
        icon: /fuel/i.test(e.category || "") ? "fuel" : "wrench"
      };
    });
  }

  function loadSummary() {
    if (!company || !canView) return Promise.resolve();
    summaryLoading = true;
    var range = periodRange();
    return db.rpc("finance_summary", { p_company: company.id, p_from: range.from, p_to: range.to })
      .then(function (r) {
        summaryLoading = false;
        if (r.error) {
          console.warn("finance_summary", r.error.message);
          return;
        }
        applySummary(r.data);
      })
      .catch(function (e) {
        summaryLoading = false;
        console.warn("finance_summary", e.message);
      });
  }

  function loadInvoices() {
    return db.from("invoices")
      .select("id,code,customer_name,customer_email,issue_date,due_on,total,amount_paid,status,currency,payment_method")
      .eq("company_id", company.id)
      .order("issue_date", { ascending: false })
      .limit(100)
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        invoices = r.data || [];
      });
  }

  function setHead(view) {
    var h1 = document.querySelector(".dash-head h1");
    var sub = document.querySelector(".dash-head .sub");
    if (view === "settings") {
      if (h1) h1.textContent = "Finance Settings";
      if (sub) sub.textContent = "Currency, categories, payments, tax, approvals and more — organised by section.";
      document.title = "Finance Settings — KAHDHU";
    } else if (view === "refunds") {
      if (h1) h1.textContent = "Refunds";
      if (sub) sub.textContent = "Pay out approved cancellations. Finance totals change only after you confirm.";
      document.title = "Refunds — KAHDHU";
    } else if (view === "tickets") {
      if (h1) h1.textContent = "Tickets";
      if (sub) sub.textContent = "Passenger tickets, starting with the ones still waiting for payment.";
      document.title = "Tickets — KAHDHU";
    } else if (view === "invoices") {
      if (h1) h1.textContent = "Invoices";
      if (sub) sub.textContent = "Invoices use the drag-and-place layout from Finance → PDF Layouts.";
      document.title = "Invoices — KAHDHU";
    } else if (view === "expenses") {
      if (h1) h1.textContent = "Expenses";
      if (sub) sub.textContent = "Record spend against your expense categories. Automatic Payroll and Maintenance lines stay linked to their source.";
      document.title = "Expenses — KAHDHU";
    } else if (view === "fares") {
      if (h1) h1.textContent = "Ticket fares";
      if (sub) sub.textContent = "Set one-way prices and return rules — same-day going and coming back can cost a different amount than coming back tomorrow.";
      document.title = "Ticket fares — KAHDHU";
    } else {
      if (h1) h1.textContent = "Finance";
      if (sub) sub.textContent = "Review revenue, expenses and business performance.";
      document.title = "Finance — KAHDHU";
    }
  }

  function chartBlock() {
    if (!chart.length) {
      return '<div class="fin-chart-empty">No ' + esc(series) + ' data for this period yet.<br>Figures appear when ticket sales and expenses are recorded.</div>';
    }
    var max = 1;
    chart.forEach(function (d) {
      var v = series === "expenses" ? d.expenses : d.revenue;
      if (v > max) max = v;
    });
    return '<div class="fin-chart" role="img" aria-label="' + esc(series) + ' for ' + esc(monthLabel()) + '">' +
      chart.map(function (d) {
        var v = series === "expenses" ? d.expenses : d.revenue;
        var h = Math.max(8, Math.round((v / max) * 200));
        return '<div class="bar' + (series === "expenses" ? " exp" : "") + (v ? "" : " empty") + '" style="height:' + h + 'px" title="' + esc(d.d + ": " + money(v)) + '"></div>';
      }).join("") +
      '</div>';
  }

  function routesBlock() {
    if (!routes.length) return '<div class="fin-empty-side">No route revenue yet. Ticket sales by route will list here.</div>';
    var max = routes.reduce(function (m, r) { return Math.max(m, r.amount); }, 1);
    return '<div class="fin-routes">' + routes.map(function (r) {
      var pct = Math.round((r.amount / max) * 100);
      return '<div class="fin-route"><div class="lab"><strong>' + esc(r.name) + '</strong><span>' + esc(money(r.amount)) + '</span></div>' +
        '<div class="fin-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div></div>';
    }).join("") + '</div>';
  }

  function txBlock() {
    if (!tx.length) return '<div class="fin-empty-side">No recent transactions. Sales, fuel, maintenance and refunds will show here.</div>';
    return '<div class="fin-tx">' + tx.map(function (t) {
      var tone = t.kind === "in" ? "in" : t.kind === "refund" ? "refund" : "out";
      var ic = t.kind === "in" ? I.ticket : t.kind === "refund" ? I.refund : (t.icon === "fuel" ? I.fuel : I.wrench);
      var amtCls = t.kind === "in" ? "pos" : t.kind === "refund" ? "ref" : "neg";
      var sign = t.kind === "in" ? "+ " : "− ";
      return '<div class="fin-tx-row"><span class="tic ' + tone + '">' + icon(ic) + '</span>' +
        '<div class="grow"><strong>' + esc(t.title) + '</strong><small>' + esc(t.sub || "") + '</small></div>' +
        '<span class="amt ' + amtCls + '">' + sign + esc(money(Math.abs(t.amount))) + '</span></div>';
    }).join("") + '</div>';
  }

  function catsBlock() {
    if (!cats.length) return '<div class="fin-empty-side">No expense categories this month. Fuel, maintenance and payroll will summarise here.</div>';
    return '<div class="fin-cats">' + cats.map(function (c) {
      var ic = c.icon === "fuel" ? I.fuel : c.icon === "people" ? I.people : I.wrench;
      return '<div class="fin-cat"><span class="tic">' + icon(ic) + '</span><div class="grow"><strong>' + esc(c.name) + '</strong><small>This period</small></div>' +
        '<span class="amt">' + esc(money(c.amount)) + '</span></div>';
    }).join("") + '</div>';
  }

  function trendHtml(delta) {
    if (delta == null || !isFinite(delta)) return "";
    var up = delta >= 0;
    return '<span class="trend' + (up ? "" : " down") + '">' + icon(up ? I.up : I.down) + " " + (up ? "+" : "") + Number(delta).toFixed(1) + "%</span>";
  }

  // Operations link: today's trips from the same schedule feed the Operations page uses.
  function loadOpsToday() {
    if (!company || !canView) return Promise.resolve();
    var n = new Date(), a = new Date(n.getFullYear(), n.getMonth(), n.getDate()), b = new Date(a.getTime() + 864e5);
    return Promise.resolve(db.rpc("schedule_trips", { p_company: company.id, p_from: a.toISOString(), p_to: b.toISOString() })).then(function (r) {
      if (r.error) { opsToday = null; return; }
      var list = ((r.data || {}).trips || []).filter(function (t) { return t.status !== "Cancelled"; }), all = (r.data || {}).trips || [];
      var o = { trips: all.length, live: 0, delayed: 0, cancelled: 0, done: 0, booked: 0, seats: 0, routes: {} };
      all.forEach(function (t) {
        if (t.status === "Cancelled") { o.cancelled++; return; }
        if (t.status === "Delayed") o.delayed++;
        if (/Boarding|Departed|In transit|En Route/.test(t.status)) o.live++;
        if (/Arrived|Completed/.test(t.status)) o.done++;
        o.booked += Number(t.seats_booked) || 0; o.seats += Number(t.seats_total) || 0;
      });
      void list; opsToday = o;
    }).catch(function () { opsToday = null; });
  }

  function emptyRefundBoard() {
    return { waiting: [], ops: [], records: [], rejected: [], waiting_total: 0, waiting_count: 0, ops_count: 0, paid_total: 0, paid_count: 0, needs_approval_count: 0, ready_count: 0, threshold: 2000 };
  }
  function normalizeRefundBoard(raw) {
    var b = raw && typeof raw === "object" ? raw : emptyRefundBoard();
    ["waiting", "ops", "records", "rejected"].forEach(function (k) {
      if (!Array.isArray(b[k])) b[k] = [];
    });
    return b;
  }
  function loadRefunds() {
    return db.rpc("finance_refund_board", { p_company: company.id }).then(function (r) {
      refundBoard = normalizeRefundBoard((!r.error && r.data) ? r.data : null);
    }, function () { refundBoard = emptyRefundBoard(); });
  }

  var refundLive = null, refundRefreshTimer = null, refundsUi = null, refundPoll = null, refundLiveRetry = null;
  function flashRefundCards() {
    var root = $("fin"); if (!root) return;
    root.classList.add("fr-quiet");
    root.classList.remove("fr-live-tick");
    void root.offsetWidth;
    root.classList.add("fr-live-tick");
  }
  function softRefreshRefunds() {
    if (!company || !canView) return;
    if (refundRefreshTimer) clearTimeout(refundRefreshTimer);
    refundRefreshTimer = setTimeout(function () {
      refundRefreshTimer = null;
      var tab = (refundsUi && refundsUi.api && refundsUi.api.tab) || (refundBoard && refundBoard._tab) || "waiting";
      var q = (refundsUi && refundsUi.api && refundsUi.api.q != null) ? refundsUi.api.q : (refundBoard && refundBoard._q) || "";
      var wfilt = refundsUi && refundsUi.api ? refundsUi.api.waitFilter : null;
      loadRefunds().then(function () {
        refundBoard._tab = tab;
        refundBoard._q = q;
        var view = route().view;
        if (view === "refunds") {
          if (refundsUi && refundsUi.api && refundsUi.draw) {
            refundsUi.api.board = refundBoard;
            refundsUi.api.tab = tab;
            refundsUi.api.q = q;
            if (wfilt) refundsUi.api.waitFilter = wfilt;
            refundsUi.draw(true);
            flashRefundCards();
          } else {
            renderRefundsPage();
          }
        } else if (view === "overview" || !view) {
          renderOverview();
        }
      });
    }, 180);
  }
  function watchRefundsLive() {
    if (!db || !company || !canView) return;
    if (refundLiveRetry) { clearTimeout(refundLiveRetry); refundLiveRetry = null; }
    if (refundLive) {
      try { db.removeChannel(refundLive); } catch (e) {}
      refundLive = null;
    }
    if (refundPoll) { clearInterval(refundPoll); refundPoll = null; }
    var ch = db.channel("finance-refunds-" + company.id);
    refundLive = ch;
    ch.on("postgres_changes", {
      event: "*", schema: "public", table: "booking_cancellations",
      filter: "company_id=eq." + company.id
    }, softRefreshRefunds).subscribe(function (status) {
      if (status === "SUBSCRIBED") return;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (refundLive === ch) refundLive = null;
        if (!refundLiveRetry) {
          refundLiveRetry = setTimeout(function () { refundLiveRetry = null; watchRefundsLive(); }, 2500);
        }
      }
    });
    refundPoll = setInterval(function () {
      if (document.hidden) return;
      if (route().view === "refunds" || route().view === "overview" || !route().view) softRefreshRefunds();
    }, 10000);
  }

  function moneyOf(n) { return money(Number(n) || 0); }

  function refundTeaser() {
    var wait = refundBoard.waiting || [];
    var total = Number(refundBoard.waiting_total);
    if (!isFinite(total)) {
      total = wait.reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
    }
    var n = Number(refundBoard.waiting_count);
    if (!isFinite(n)) n = wait.length;
    if (!n && !(refundBoard.records || []).length && !(refundBoard.ops || []).length) return "";
    return '<section class="fin-card fin-refunds"><div class="fr-teaser">' +
      '<div><h2 style="margin:0 0 4px">Refunds</h2><p class="note" style="margin:0">' +
      (n ? (n + ' waiting · ' + esc(money(total)) + ' ready for Finance to confirm.') : 'No payouts waiting. Open Refunds for history and the Operations queue.') +
      '</p></div>' +
      '<a class="save" href="#refunds">' + (n ? "Manage refunds" : "Open refunds") + '</a>' +
      '</div></section>';
  }

  function renderRefundsPage() {
    if (!window.VeyoraFinRefunds) {
      $("fin").innerHTML = '<section class="dash-card"><h2>Refunds</h2><p class="note">Refunds module failed to load.</p></section>';
      refundsUi = null;
      return;
    }
    $("finActions").innerHTML = "";
    var api = {
      db: db,
      company: company,
      money: money,
      board: refundBoard,
      tab: (refundBoard._tab || "waiting"),
      q: refundBoard._q || "",
      waitFilter: (refundBoard._wfilt || "all"),
      openModal: openModal,
      closeModal: closeModal,
      onChanged: function () { loadSummary(); softRefreshRefunds(); }
    };
    function draw(live) {
      if (route().view !== "refunds") return;
      refundBoard._tab = api.tab;
      refundBoard._q = api.q;
      refundBoard._wfilt = api.waitFilter;
      var quiet = !!live || ($("fin") && $("fin").classList.contains("fr-quiet"));
      $("fin").innerHTML = window.VeyoraFinRefunds.render(api);
      if (quiet) $("fin").classList.add("fr-quiet");
      else $("fin").classList.remove("fr-quiet", "fr-live-tick");
      window.VeyoraFinRefunds.bind(api, function () { draw(true); });
    }
    refundsUi = { api: api, draw: draw };
    draw(false);
    window.VeyoraFinRefunds.load(api).then(function (board) {
      refundBoard = board || refundBoard;
      api.board = refundBoard;
      draw(!!$("fin") && $("fin").classList.contains("fr-quiet"));
    }, function (e) {
      refundsUi = null;
      $("fin").innerHTML = '<section class="dash-card"><h2>Refunds</h2><p class="note">' + esc(e.message || "Could not load refunds.") + '</p></section>';
    });
  }

  function renderOverview() {
    $("finActions").innerHTML = canView
      ? '<button type="button" class="primary-btn export" id="finExport">' + icon(I.download) + ' Export report</button>'
      : "";
    var st = { kpis: kpis, prev: prevK, chart: chart, routes: routes, cats: cats, tx: tx, series: series, period: period, loading: summaryLoading,
      revDelta: kpis.revDelta, profitDelta: kpis.profitDelta, esc: esc, money: money, ops: opsToday };
    $("fin").innerHTML = refundTeaser() + window.VeyoraFinOv.render(st);
    window.VeyoraFinOv.bind(st, {
      setPeriod: function (p) { period = p; summaryLoading = true; renderOverview(); loadSummary().then(renderOverview); },
      setSeries: function (v) { series = v; renderOverview(); },
      rerender: renderOverview
    });
    if ($("finExport")) $("finExport").addEventListener("click", exportReport);
  }

  function statusChip(st) {
    var cls = "st-draft";
    if (st === "Paid") cls = "st-paid";
    else if (st === "Sent" || st === "Partly paid") cls = "st-sent";
    else if (st === "Void") cls = "st-void";
    return '<span class="fin-chip ' + cls + '">' + esc(st) + '</span>';
  }

  function bindInvoicePdfButtons(root) {
    [].forEach.call((root || document).querySelectorAll("[data-pdf-inv]"), function (b) {
      b.addEventListener("click", function () { downloadInvoicePdf(b.getAttribute("data-pdf-inv"), "invoice"); });
    });
    [].forEach.call((root || document).querySelectorAll("[data-pdf-rct]"), function (b) {
      b.addEventListener("click", function () { downloadInvoicePdf(b.getAttribute("data-pdf-rct"), "receipt"); });
    });
    [].forEach.call((root || document).querySelectorAll("[data-pay]"), function (b) {
      b.addEventListener("click", function () { openPayModal(b.getAttribute("data-pay")); });
    });
  }

  function renderInvoices() {
    var id = route().id;
    if (id) { renderInvoiceDoc(id); return; }

    $("finActions").innerHTML = canEdit
      ? '<button type="button" class="primary-btn" id="invNew">' + icon(I.plus) + ' New invoice</button>'
      : "";

    $("fin").innerHTML =
      '<section class="fin-card" style="padding:16px">' +
        '<div class="fin-card-head"><div><h2>Invoices</h2><p class="note">Open an invoice to see the same drag-and-place layout used for the PDF. Edit the layout under PDF Layouts.</p></div>' +
          '<a class="ghost" href="pdf-layouts.html">PDF layouts</a></div>' +
        (invoices.length
          ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Due</th><th>Total</th><th>Paid</th><th>Status</th><th></th></tr></thead><tbody>' +
            invoices.map(function (inv) {
              return '<tr><td><a href="#invoices/' + esc(inv.id) + '"><strong>' + esc(inv.code || "View") + '</strong></a></td><td>' + esc(inv.customer_name) + '</td><td>' + esc(inv.issue_date || "") + '</td><td>' + esc(inv.due_on || "—") + '</td>' +
                '<td>' + esc(money(inv.total)) + '</td><td>' + esc(money(inv.amount_paid)) + '</td><td>' + statusChip(inv.status) + '</td>' +
                '<td class="fin-inv-acts">' +
                  '<a class="ghost manage-btn" href="#invoices/' + esc(inv.id) + '">View layout</a>' +
                  '<button type="button" class="ghost manage-btn" data-pdf-inv="' + esc(inv.id) + '">Invoice PDF</button>' +
                  (Number(inv.amount_paid) > 0 ? '<button type="button" class="ghost manage-btn" data-pdf-rct="' + esc(inv.id) + '">Receipt PDF</button>' : "") +
                  (canEdit && inv.status !== "Paid" && inv.status !== "Void" ? '<button type="button" class="ghost manage-btn" data-pay="' + esc(inv.id) + '">Record payment</button>' : "") +
                '</td></tr>';
            }).join("") +
            '</tbody></table></div>'
          : '<div class="fin-empty-side">No invoices yet.' + (canEdit ? ' Create one to bill a customer.' : "") + '</div>') +
      '</section>';

    if ($("invNew")) $("invNew").onclick = openNewInvoice;
    bindInvoicePdfButtons();
  }

  function renderInvoiceDoc(id) {
    $("finActions").innerHTML = '<a class="ghost" href="#invoices">← All invoices</a>';
    $("fin").innerHTML = '<section class="fin-card" style="padding:18px"><p class="msg">Loading layout…</p></section>';
    var api = window.VeyoraPdfApi, Fields = window.VeyoraPdfFields, Render = window.VeyoraPdfRender;
    if (!api || !Fields || !Render) {
      $("fin").innerHTML = '<section class="fin-card" style="padding:18px"><h2>PDF layout unavailable</h2><p class="note">Refresh the page, then open the invoice again.</p></section>';
      return;
    }
    Promise.all([
      db.from("invoices").select("*").eq("id", id).single(),
      api.loadCompany(company.id),
      api.getPublishedConfig(company.id, "invoice")
    ]).then(function (pair) {
      if (pair[0].error) throw new Error(pair[0].error.message);
      var inv = pair[0].data;
      if (!inv) throw new Error("Invoice not found.");
      var companyRow = pair[1];
      var pack = pair[2];
      var data = Fields.buildData("invoice", companyRow, inv, {});
      var node = Render.renderPreviewNode(pack.config, data);
      var layoutName = (pack.template && pack.template.name) || "Default invoice layout";
      var draftNote = pack.template && pack.template.status !== "Published"
        ? '<p class="note">This is the canvas layout from PDF Layouts (not published yet). Publish it to lock the version.</p>'
        : '<p class="note">Same canvas as Finance → PDF Layouts · ' + esc(layoutName) + "</p>";
      $("finActions").innerHTML =
        '<a class="ghost" href="#invoices">← All invoices</a>' +
        '<button type="button" class="ghost" data-pdf-inv="' + esc(inv.id) + '">Download PDF</button>' +
        (Number(inv.amount_paid) > 0 ? '<button type="button" class="ghost" data-pdf-rct="' + esc(inv.id) + '">Receipt PDF</button>' : "") +
        (canEdit && inv.status !== "Paid" && inv.status !== "Void" ? '<button type="button" class="ghost" data-pay="' + esc(inv.id) + '">Record payment</button>' : "") +
        '<a class="ghost" href="pdf-layouts.html">Edit layout</a>';
      $("fin").innerHTML =
        '<section class="fin-card fin-inv-doc">' +
          '<div class="fin-card-head"><div><h2>' + esc(inv.code || "Invoice") + " · " + esc(inv.customer_name || "") + "</h2>" +
          draftNote + "</div>" + statusChip(inv.status) + "</div>" +
          '<div class="fin-paper-stage" id="invPaperStage">' +
            '<div class="fin-paper-sizer" id="invPaperSizer">' +
              '<div class="fin-paper-world" id="invPaperWorld"></div>' +
            "</div>" +
          "</div>" +
        "</section>";
      var world = $("invPaperWorld");
      var root = world.attachShadow({ mode: "open" });
      root.innerHTML = node.html;
      bindInvoicePdfButtons();
      requestAnimationFrame(function () { scaleInvoicePaper(node.widthMm, node.heightMm); });
      window.addEventListener("resize", function onR() {
        if (!$("invPaperWorld")) { window.removeEventListener("resize", onR); return; }
        scaleInvoicePaper(node.widthMm, node.heightMm);
      });
    }).catch(function (e) {
      $("fin").innerHTML = '<section class="fin-card" style="padding:18px"><h2>Could not open invoice</h2><p class="note">' + esc(e.message) + '</p><p><a href="#invoices">Back to invoices</a></p></section>';
    });
  }

  function scaleInvoicePaper(wMm, hMm) {
    var stage = $("invPaperStage"), world = $("invPaperWorld"), sizer = $("invPaperSizer");
    if (!stage || !world || !sizer) return;
    var avail = Math.max(280, stage.clientWidth - 24);
    var zoom = Math.min(1, avail / (wMm * 3.7795));
    sizer.style.width = Math.round(wMm * 3.7795 * zoom) + "px";
    sizer.style.height = Math.round(hMm * 3.7795 * zoom) + "px";
    world.style.width = wMm + "mm";
    world.style.height = hMm + "mm";
    world.style.transform = "scale(" + zoom + ")";
  }

  function downloadInvoicePdf(id, kind) {
    if (!window.VeyoraPdfApi) {
      openModal('<h2>PDF unavailable</h2><p class="note">PDF engine failed to load. Refresh the page.</p><div class="modal-actions"><button type="button" class="save" data-close>OK</button></div>');
      return;
    }
    db.from("invoices").select("*").eq("id", id).single().then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var inv = r.data;
      var source = inv;
      var docType = "invoice";
      var filename = (inv.code || "invoice") + ".pdf";
      if (kind === "receipt") {
        docType = "receipt";
        source = {
          number: inv.code,
          date: inv.issue_date,
          payer: inv.customer_name,
          amount: inv.amount_paid || inv.total,
          paymentMethod: inv.payment_method || "",
          reference: "",
          bookingRef: inv.booking_id || "",
          note: inv.note || ""
        };
        filename = (inv.code || "receipt") + "-receipt.pdf";
      }
      return window.VeyoraPdfApi.generate({
        companyId: company.id,
        documentType: docType,
        source: source,
        sourceId: inv.id,
        filename: filename,
        forceA5: docType === "invoice" && !!(inv.booking_id || (inv.meta && (inv.meta.paper === "A5" || inv.meta.from_booking)))
      });
    }).then(function () {
      /* toast via brief modal */
    }).catch(function (e) {
      openModal('<h2>Could not generate PDF</h2><p class="note">' + esc(e.message) + '</p><div class="modal-actions"><button type="button" class="save" data-close>OK</button></div>');
    });
  }

  function openNewInvoice() {
    var today = new Date().toISOString().slice(0, 10);
    openModal('<h2>New invoice</h2><p class="note">Totals and tax are calculated on save. Publish a layout under PDF Layouts to download a branded PDF.</p>' +
      '<div class="cards">' +
        '<div class="fld full"><label for="iCust">Customer name</label><input id="iCust" maxlength="160" required></div>' +
        '<div class="fld"><label for="iEmail">Email</label><input id="iEmail" type="email" maxlength="200"></div>' +
        '<div class="fld"><label for="iPhone">Phone</label><input id="iPhone" maxlength="40"></div>' +
        '<div class="fld"><label for="iIssue">Issue date</label><input id="iIssue" type="date" value="' + today + '"></div>' +
        '<div class="fld"><label for="iDue">Due date</label><input id="iDue" type="date"></div>' +
        '<div class="fld full"><label for="iDesc">Line description</label><input id="iDesc" value="Services" maxlength="200"></div>' +
        '<div class="fld"><label for="iQty">Qty</label><input id="iQty" type="number" min="1" step="1" value="1"></div>' +
        '<div class="fld"><label for="iUnit">Unit price</label><input id="iUnit" type="number" min="0" step="0.01" value="0"></div>' +
        '<div class="fld full"><label for="iNote">Note</label><textarea id="iNote" maxlength="1000"></textarea></div>' +
      '</div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="iGo">Create draft</button></div>');
    $("iGo").onclick = function () {
      var name = ($("iCust").value || "").trim();
      if (!name) { say("Enter a customer name.", "err"); return; }
      var qty = Number($("iQty").value) || 1;
      var unit = Number($("iUnit").value) || 0;
      var lineTotal = Math.round(qty * unit * 100) / 100;
      // Cursor 2026-10-24: invoices_before totals from qty * unit_price.
      var items = [{ description: ($("iDesc").value || "Services").trim(), qty: qty, unit_price: unit, unit: unit, tax: 0, total: lineTotal }];
      say("Saving…");
      db.from("invoices").insert({
        company_id: company.id,
        customer_name: name,
        customer_email: ($("iEmail").value || "").trim() || null,
        customer_phone: ($("iPhone").value || "").trim() || null,
        issue_date: $("iIssue").value || today,
        due_on: $("iDue").value || null,
        items: items,
        subtotal: lineTotal,
        tax: 0,
        total: lineTotal,
        amount_paid: 0,
        currency: baseCfg().code,
        status: "Draft",
        note: ($("iNote").value || "").trim() || null
      }).select("id").single().then(function (r) {
        if (r.error) throw new Error(r.error.message);
        closeModal();
        location.hash = "#invoices/" + r.data.id;
      }).catch(function (e) { say(e.message, "err"); });
    };
  }

  function openPayModal(id) {
    var inv = invoices.filter(function (x) { return x.id === id; })[0];
    if (!inv) return;
    var due = Math.max(0, Number(inv.total) - Number(inv.amount_paid));
    openModal('<h2>Record payment</h2><p class="note">' + esc(inv.code || "") + ' · balance ' + esc(money(due)) + '</p>' +
      '<div class="cards"><div class="fld"><label for="pAmt">Amount</label><input id="pAmt" type="number" min="0.01" step="0.01" value="' + due + '"></div>' +
      '<div class="fld"><label for="pMethod">Method</label><input id="pMethod" maxlength="60" placeholder="Cash, Card…"></div></div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="pGo">Save</button></div>');
    $("pGo").onclick = function () {
      var amt = Number($("pAmt").value);
      if (!(amt > 0)) { say("Enter an amount.", "err"); return; }
      say("Saving…");
      db.rpc("record_invoice_payment", { p_id: id, p_amount: amt, p_method: ($("pMethod").value || "").trim() || null })
        .then(function (r) {
          if (r.error) throw new Error(r.error.message);
          closeModal();
          return loadInvoices().then(renderInvoices);
        }).catch(function (e) { say(e.message, "err"); });
    };
  }

  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }

  function expPeriodRange() {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    var from, to = now;
    if (expFilter.period === "quarter") {
      var q = Math.floor(m / 3) * 3;
      from = new Date(y, q, 1);
    } else if (expFilter.period === "year") {
      from = new Date(y, 0, 1);
    } else if (expFilter.period === "all") {
      from = new Date(y - 5, 0, 1);
    } else {
      from = new Date(y, m, 1);
    }
    function iso(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    return { from: iso(from), to: iso(to) };
  }

  function loadExpenses() {
    var range = expPeriodRange();
    var q = db.from("finance_entries")
      .select("id,entry_date,kind,amount,currency,category,description,payment_method,source,source_ref,vessel_id,route_id,created_at,updated_at")
      .eq("company_id", company.id)
      .eq("kind", "Expense")
      .gte("entry_date", range.from)
      .lte("entry_date", range.to)
      .order("entry_date", { ascending: false })
      .limit(200);
    return q.then(function (r) {
      if (r.error) throw new Error(r.error.message);
      expenses = r.data || [];
    });
  }

  function filteredExpenses() {
    return expenses.filter(function (e) {
      if (expFilter.category && e.category !== expFilter.category) return false;
      if (expFilter.source && e.source !== expFilter.source) return false;
      if (expFilter.q) {
        var hay = ((e.description || "") + " " + (e.category || "") + " " + (e.payment_method || "")).toLowerCase();
        if (hay.indexOf(expFilter.q.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  function renderExpenses() {
    var catsCfg = expenseCategories();
    var rows = filteredExpenses();
    var total = rows.reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
    var byCat = {};
    rows.forEach(function (e) {
      var k = e.category || "Other";
      byCat[k] = (byCat[k] || 0) + (Number(e.amount) || 0);
    });
    var catKeys = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });

    $("finActions").innerHTML = canEdit
      ? '<button type="button" class="primary-btn" id="expNew">' + icon(I.plus) + ' Add expense</button>'
      : "";

    $("fin").innerHTML =
      '<div class="fin-exp-kpis">' +
        '<div class="fin-kpi"><span class="tile tone-amber">' + icon(I.card) + '</span><div><small>Total (filtered)</small><strong>' + esc(money(total)) + '</strong><span class="sub">' + rows.length + ' entr' + (rows.length === 1 ? "y" : "ies") + '</span></div></div>' +
        '<div class="fin-kpi"><span class="tile tone-blue">' + icon(I.cash) + '</span><div><small>Categories used</small><strong>' + String(catKeys.length).padStart(2, "0") + '</strong><span class="sub"><a href="#settings/categories">Manage categories</a></span></div></div>' +
      '</div>' +
      '<section class="fin-card" style="padding:16px;margin-bottom:14px">' +
        '<div class="fin-exp-bar">' +
          '<input type="search" id="expQ" class="grow" placeholder="Search description or category" value="' + esc(expFilter.q) + '">' +
          '<select id="expPeriod">' +
            '<option value="month"' + (expFilter.period === "month" ? " selected" : "") + '>This month</option>' +
            '<option value="quarter"' + (expFilter.period === "quarter" ? " selected" : "") + '>This quarter</option>' +
            '<option value="year"' + (expFilter.period === "year" ? " selected" : "") + '>This year</option>' +
            '<option value="all"' + (expFilter.period === "all" ? " selected" : "") + '>Last 5 years</option>' +
          '</select>' +
          '<select id="expCat"><option value="">All categories</option>' +
            catsCfg.names.map(function (n) { return '<option value="' + esc(n) + '"' + (expFilter.category === n ? " selected" : "") + '>' + esc(n) + '</option>'; }).join("") +
          '</select>' +
          '<select id="expSrc"><option value="">All sources</option>' +
            ["Manual", "Payroll", "Maintenance", "Booking", "Invoice", "Refund"].map(function (s) {
              return '<option value="' + s + '"' + (expFilter.source === s ? " selected" : "") + '>' + s + '</option>';
            }).join("") +
          '</select>' +
        '</div>' +
      '</section>' +
      (catKeys.length
        ? '<section class="fin-card" style="padding:16px;margin-bottom:14px"><h2 style="margin:0 0 10px;font-size:15px">By category</h2><div class="fin-exp-cats">' +
          catKeys.map(function (k) {
            var pct = total ? Math.round((byCat[k] / total) * 100) : 0;
            return '<div class="fin-exp-cat"><div class="lab"><strong>' + esc(k) + '</strong><span>' + esc(money(byCat[k])) + ' · ' + pct + '%</span></div>' +
              '<div class="fin-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div></div>';
          }).join("") + '</div></section>'
        : "") +
      '<section class="fin-card" style="padding:16px">' +
        '<div class="fin-card-head"><div><h2>Expense entries</h2><p class="note">Manual lines you can edit. Payroll and Maintenance post automatically and stay read-only here.</p></div></div>' +
        (rows.length
          ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Source</th><th>Amount</th><th></th></tr></thead><tbody>' +
            rows.map(function (e) {
              var manual = e.source === "Manual";
              return '<tr><td>' + esc(e.entry_date || "") + '</td><td>' + esc(e.category || "—") + '</td>' +
                '<td>' + esc(e.description || "—") + '</td><td>' + esc(e.payment_method || "—") + '</td>' +
                '<td><span class="fin-chip ' + (manual ? "st-draft" : "st-sent") + '">' + esc(e.source || "—") + '</span></td>' +
                '<td><strong>' + esc(money(e.amount)) + '</strong></td>' +
                '<td class="fin-inv-acts">' +
                  (canEdit && manual
                    ? '<button type="button" class="ghost manage-btn" data-exp-edit="' + esc(e.id) + '">Edit</button>' +
                      '<button type="button" class="ghost manage-btn" data-exp-del="' + esc(e.id) + '">Delete</button>'
                    : '<span class="muted-cell">' + (manual ? "" : "Auto") + '</span>') +
                '</td></tr>';
            }).join("") +
            '</tbody></table></div>'
          : '<div class="fin-empty-side">No expenses in this filter.' + (canEdit ? ' Add one, or widen the date range.' : "") + '</div>') +
      '</section>';

    if ($("expNew")) $("expNew").onclick = function () { openExpenseModal(null); };
    function refreshFilters(reload) {
      expFilter.q = ($("expQ") && $("expQ").value) || "";
      expFilter.category = ($("expCat") && $("expCat").value) || "";
      expFilter.source = ($("expSrc") && $("expSrc").value) || "";
      var nextPeriod = ($("expPeriod") && $("expPeriod").value) || "month";
      if (reload || nextPeriod !== expFilter.period) {
        expFilter.period = nextPeriod;
        loadExpenses().then(renderExpenses).catch(function (e) {
          $("fin").innerHTML = '<section class="dash-card"><h2>Expenses</h2><p class="note">' + esc(e.message) + '</p></section>';
        });
      } else renderExpenses();
    }
    if ($("expQ")) $("expQ").oninput = function () {
      expFilter.q = $("expQ").value;
      var pos = $("expQ").selectionStart;
      renderExpenses();
      if ($("expQ")) { $("expQ").focus(); try { $("expQ").setSelectionRange(pos, pos); } catch (e) {} }
    };
    if ($("expPeriod")) $("expPeriod").onchange = function () { refreshFilters(true); };
    if ($("expCat")) $("expCat").onchange = function () { refreshFilters(false); };
    if ($("expSrc")) $("expSrc").onchange = function () { refreshFilters(false); };
    [].forEach.call(document.querySelectorAll("[data-exp-edit]"), function (b) {
      b.addEventListener("click", function () {
        var row = expenses.filter(function (x) { return x.id === b.getAttribute("data-exp-edit"); })[0];
        if (row) openExpenseModal(row);
      });
    });
    [].forEach.call(document.querySelectorAll("[data-exp-del]"), function (b) {
      b.addEventListener("click", function () { deleteExpense(b.getAttribute("data-exp-del")); });
    });
  }

  function openExpenseModal(row) {
    var catsCfg = expenseCategories();
    var methods = paymentMethods();
    var today = new Date().toISOString().slice(0, 10);
    var isEdit = !!(row && row.id);
    openModal('<h2>' + (isEdit ? "Edit expense" : "Add expense") + '</h2><p class="note">Posted to the finance ledger as a Manual expense. Categories come from Finance Settings.</p>' +
      '<div class="cards">' +
        '<div class="fld"><label for="eDate">Date</label><input id="eDate" type="date" value="' + esc((row && row.entry_date) || today) + '"></div>' +
        '<div class="fld"><label for="eAmt">Amount</label><input id="eAmt" type="number" min="0.01" step="0.01" value="' + esc(row ? String(row.amount) : "") + '"></div>' +
        '<div class="fld"><label for="eCat">Category</label><select id="eCat">' +
          catsCfg.names.map(function (n) {
            var sel = (row && row.category === n) || (!row && n === catsCfg.def);
            return '<option value="' + esc(n) + '"' + (sel ? " selected" : "") + '>' + esc(n) + '</option>';
          }).join("") +
        '</select></div>' +
        '<div class="fld"><label for="eMethod">Payment method</label><select id="eMethod"><option value="">—</option>' +
          methods.map(function (m) {
            return '<option value="' + esc(m) + '"' + (row && row.payment_method === m ? " selected" : "") + '>' + esc(m) + '</option>';
          }).join("") +
        '</select></div>' +
        '<div class="fld full"><label for="eDesc">Description</label><input id="eDesc" maxlength="300" value="' + esc((row && row.description) || "") + '" placeholder="e.g. Fuel for MV Island Star"></div>' +
      '</div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="eGo">' + (isEdit ? "Save" : "Add expense") + '</button></div>');
    $("eGo").onclick = function () {
      var amt = Number($("eAmt").value);
      if (!(amt > 0)) { say("Enter an amount greater than zero.", "err"); return; }
      var cat = ($("eCat").value || "").trim();
      if (!cat) { say("Pick a category.", "err"); return; }
      var payload = {
        company_id: company.id,
        entry_date: $("eDate").value || today,
        kind: "Expense",
        amount: amt,
        currency: baseCfg().code,
        category: cat,
        description: ($("eDesc").value || "").trim() || null,
        payment_method: ($("eMethod").value || "").trim() || null,
        source: "Manual"
      };
      say("Saving…");
      var req = isEdit
        ? db.from("finance_entries").update({
            entry_date: payload.entry_date,
            amount: payload.amount,
            currency: payload.currency,
            category: payload.category,
            description: payload.description,
            payment_method: payload.payment_method
          }).eq("id", row.id).eq("source", "Manual")
        : db.from("finance_entries").insert(payload);
      req.then(function (r) {
        if (r.error) throw new Error(r.error.message);
        closeModal();
        return loadExpenses().then(renderExpenses);
      }).catch(function (e) { say(e.message, "err"); });
    };
  }

  function deleteExpense(id) {
    if (!confirm("Delete this manual expense? This cannot be undone.")) return;
    db.from("finance_entries").delete().eq("id", id).eq("source", "Manual").then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return loadExpenses().then(renderExpenses);
    }).catch(function (e) {
      openModal('<h2>Could not delete</h2><p class="note">' + esc(e.message) + '</p><div class="modal-actions"><button type="button" class="save" data-close>OK</button></div>');
    });
  }

  function renderFares() {
    $("finActions").innerHTML = "";
    if (window.VeyoraTip) window.VeyoraTip("fin-fares", [
      "Pick a **route**. **1** is the one-way ticket. **2** is two-way if they come back the same day (one price for both trips).",
      "**3** is two-way on a different day — set a **going ticket** price and a **return ticket** price. Type every amount in your **base currency**.",
      "Use **Check a ticket** to see which price will be charged."
    ]);
    if (!window.VeyoraFinanceFares) {
      $("fin").innerHTML = '<section class="dash-card"><h2>Ticket fares</h2><p class="note">Fare editor failed to load. Refresh the page.</p></section>';
      return;
    }
    window.VeyoraFinanceFares.render({
      db: db,
      company: company,
      canEdit: canEdit,
      money: money,
      host: $("fin"),
      routeId: route().id
    });
  }

  function renderSettings(section) {
    $("finActions").innerHTML = "";
    if (!window.VeyoraFinanceSettings) {
      $("fin").innerHTML = '<section class="dash-card"><h2>Finance Settings</h2><p class="note">Settings module failed to load.</p></section>';
      return;
    }
    var ctx = {
      db: db,
      company: company,
      canEdit: canEdit,
      section: section || "general",
      rerender: function () { render(); }
    };
    $("fin").innerHTML = window.VeyoraFinanceSettings.render(ctx);
  }

  function render() {
    if (!company) return;
    var r = route();
    setHead(r.view);
    if (!canView) {
      $("finActions").innerHTML = "";
      $("fin").innerHTML = '<section class="dash-card"><h2>Finance</h2><p class="note">You do not have access to Finance for this company.</p></section>';
      return;
    }
    if (r.view === "settings") {
      if (location.hash === "#settings") location.replace("#settings/general");
      else renderSettings(r.section);
    } else if (r.view === "refunds") {
      renderRefundsPage();
    } else if (r.view === "tickets") {
      $("finActions").innerHTML = "";
      var tApi = { db: db, company: company, money: money };
      var tDraw = function () { if (route().view !== "tickets") return; $("fin").innerHTML = window.VeyoraFinTickets.render(tApi); window.VeyoraFinTickets.bind(tApi, tDraw); };
      tDraw();
      window.VeyoraFinTickets.load(tApi).then(tDraw, tDraw);
    } else if (r.view === "invoices") {
      loadInvoices().then(renderInvoices).catch(function (e) {
        $("fin").innerHTML = '<section class="dash-card"><h2>Invoices</h2><p class="note">' + esc(e.message) + '</p></section>';
      });
    } else if (r.view === "expenses") {
      loadExpenses().then(renderExpenses).catch(function (e) {
        $("fin").innerHTML = '<section class="dash-card"><h2>Expenses</h2><p class="note">' + esc(e.message) + '</p></section>';
      });
    } else if (r.view === "fares") {
      renderFares();
    } else {
      loadSummary().then(renderOverview);
      loadRefunds().then(function () { if (route().view === "overview") renderOverview(); });
      loadOpsToday().then(function () { if (route().view === "overview") renderOverview(); });
    }
  }

  function exportReport() {
    if (!window.VeyoraPdfApi) {
      openModal('<h2>Export</h2><p class="note">PDF engine not loaded.</p><div class="modal-actions"><button type="button" class="save" data-close>OK</button></div>');
      return;
    }
    var range = periodRange();
    openModal('<h2>Export report</h2><p class="note">Generating PDF from your published financial report layout…</p><p class="msg" id="mMsg">Working…</p>');
    loadSummary().then(function () {
      var rows = [];
      rows.push({ label: "Revenue", value: money(kpis.revenue) });
      rows.push({ label: "Expenses", value: money(kpis.expenses) });
      rows.push({ label: "Refunds", value: money(kpis.refunds) });
      rows.push({ label: "Net", value: money(kpis.profit) });
      rows.push({ label: "Outstanding invoices", value: String(kpis.invoices) + " · " + money(kpis.invoicesAmt) });
      cats.forEach(function (c) { rows.push({ label: "Expense · " + c.name, value: money(c.amount) }); });
      routes.slice(0, 12).forEach(function (r) { rows.push({ label: "Route · " + r.name, value: money(r.amount) }); });
      var payload = window.VeyoraPdfApi.mapReportPayload(
        { title: "Revenue & expense report", from_date: range.from, to_date: range.to },
        [{ key: "label" }, { key: "value" }],
        rows,
        { revenue: kpis.revenue, expenses: kpis.expenses, net: kpis.profit }
      );
      return window.VeyoraPdfApi.generate({
        companyId: company.id,
        documentType: "financial_report",
        source: payload,
        filename: "finance-" + range.from + "-to-" + range.to + ".pdf",
        allowMissing: true
      });
    }).then(function () {
      closeModal();
    }).catch(function (e) {
      say(e.message, "err");
    });
  }

  function openModal(html, cls) {
    $("modalCard").className = "modal-card" + (cls ? " " + cls : "");
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;
  }
  function closeModal() {
    $("modal").hidden = true; $("modalCard").innerHTML = "";
  }

  function bindOverview() {
    [].forEach.call(document.querySelectorAll("[data-series]"), function (b) {
      b.addEventListener("click", function () { series = b.dataset.series; renderOverview(); });
    });
    if ($("finPeriod")) $("finPeriod").addEventListener("change", function () {
      period = $("finPeriod").value;
      loadSummary().then(renderOverview);
    });
    if ($("finExport")) $("finExport").addEventListener("click", exportReport);
  }

  $("modal").addEventListener("click", function (e) {
    if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("modal").hidden) closeModal();
  });
  window.addEventListener("hashchange", function () {
    if (!$("modal").hidden) closeModal();
    render();
    window.scrollTo(0, 0);
    if (window.VeyoraShell && window.VeyoraShell.nav) window.VeyoraShell.nav("Finance");
  });

  window.VeyoraShell.start({
    active: "Finance",
    onCompany: function (c, info) {
      company = c;
      canView = !!(info.canAll || info.canFinance || info.isPlatform || info.isAdmin || info.myRole === "operations" || info.myRole === "owner");
      canEdit = !!(info.canAll || info.isPlatform || info.isAdmin || info.myRole === "owner" || info.myRole === "operations");
      kpis = { revenue: 0, expenses: 0, refunds: 0, profit: 0, invoices: 0, invoicesAmt: 0, overdue: 0, revDelta: null, profitDelta: null };
      chart = []; routes = []; tx = []; cats = []; invoices = []; expenses = [];
      if (!location.hash) location.replace("#overview");
      else render();
      watchRefundsLive();
      if (!window.__veyoraRefundNoticeBound) {
        window.__veyoraRefundNoticeBound = true;
        window.addEventListener("veyora:notice", function (ev) {
          var n = ev && ev.detail;
          if (n && n.kind === "refund_finance") softRefreshRefunds();
        });
      }
      if (window.VeyoraTip && (location.hash || "").indexOf("#fares") !== 0) {
        window.VeyoraTip("fin1", [
          "**Finance** summarises revenue, expenses, route mix and recent transactions from the ledger.",
          "**Refunds** is where Finance confirms payouts. Totals change only after a refund is marked paid.",
          "Use **Invoices** to bill customers, and **Expenses** to record spend (Manual) or review auto Payroll/Maintenance lines.",
          "**Ticket fares** set the one-way price, the same-day two-way price, and different-day going and return ticket prices.",
          "Open **Finance Settings** for currency, categories, payments, tax and approvals."
        ]);
      }
    },
    onNone: function () { $("fin").innerHTML = '<section class="dash-card"><h2>No company yet</h2><p class="note">Ask your administrator for an invite.</p></section>'; },
    onError: function (err) { $("fin").innerHTML = '<section class="dash-card"><h2>Could not load Finance</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
