/* Finance overview — hero, KPI tiles with sparklines, interactive revenue/expense chart, expense donut, routes, insights, transactions.
   Pure view: finance.js hands it the data it already loads from finance_summary. */
(function () {
  var COLORS = ["#6366f1", "#06b6d4", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#ef4444", "#64748b"];
  var ui = { mode: "daily" };   // daily | cumulative

  function ic(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var P = {
    up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', dl: '<path d="M12 4v12M8 12l4 4 4-4M4 20h16"/>',
    wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V6a2 2 0 0 1 2-2h10M16 14h2"/>', card: '<path d="M3 7h18v11H3zM3 11h18"/>',
    trend: '<path d="M4 16l5-5 4 4 7-8"/><path d="M14 7h6v6"/>', doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
    pie: '<path d="M21 12a9 9 0 1 1-9-9v9zM15 3.5A9 9 0 0 1 20.5 9H15z"/>', cal: '<path d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"/>',
    arrow: '<path d="m9 6 6 6-6 6"/>', alert: '<path d="M12 4 2.5 20h19zM12 10v5M12 17.5v.5"/>',
    sale: '<path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V8Z"/>', cost: '<path d="M7 4h8v16H7zM15 8h3a2 2 0 0 1 2 2v8"/>', refund: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/>'
  };
  function compact(n, money) {
    var a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(0) + "k";
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(Math.round(n));
  }
  function dayLabel(iso) {
    var p = String(iso || "").split("-"); if (p.length < 3) return iso || "";
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function delta(cur, prev) { cur = Number(cur) || 0; prev = Number(prev) || 0; return prev ? ((cur - prev) / Math.abs(prev)) * 100 : null; }
  function chip(d, invert) {
    if (d == null || !isFinite(d)) return "";
    var good = invert ? d <= 0 : d >= 0;
    return '<span class="fo-chip ' + (good ? "good" : "bad") + '">' + ic(d >= 0 ? P.up : P.down) + (d >= 0 ? "+" : "") + Number(d).toFixed(1) + '%</span>';
  }
  function spark(vals, color) {
    if (!vals || vals.length < 2 || !vals.some(function (v) { return v; })) return '<svg class="fo-spark" viewBox="0 0 100 28" aria-hidden="true"><line x1="0" y1="24" x2="100" y2="24" stroke="#e3e9f6" stroke-width="2"/></svg>';
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals), rng = max - min || 1;
    var pts = vals.map(function (v, i) { return [(i / (vals.length - 1)) * 100, 24 - ((v - min) / rng) * 20]; });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    return '<svg class="fo-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + ' L100 28 L0 28Z" fill="' + color + '" opacity=".12"/><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  }
  function smooth(pts) {
    if (pts.length < 2) return "";
    var d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18;
      d += " C" + (p1[0] + (p2[0] - p0[0]) * t).toFixed(1) + " " + (p1[1] + (p2[1] - p0[1]) * t).toFixed(1) + "," + (p2[0] - (p3[0] - p1[0]) * t).toFixed(1) + " " + (p2[1] - (p3[1] - p1[1]) * t).toFixed(1) + "," + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    return d;
  }

  /* ---- main interactive chart ---- */
  function seriesData(s) {
    var rev = 0, exp = 0;
    return (s.chart || []).map(function (d) {
      rev += d.revenue; exp += d.expenses;
      return { day: d.day, r: ui.mode === "cumulative" ? rev : d.revenue, e: ui.mode === "cumulative" ? exp : d.expenses };
    });
  }
  var G = null;   // chart geometry for hover
  function chartSvg(s) {
    var host = document.getElementById("fin"), cw = host ? host.clientWidth : 800, data = seriesData(s), W = Math.max(330, Math.min(900, cw - 44)), H = W < 500 ? 250 : 270, L = 46, R = 12, T = 14, B = 28;
    if (!data.length) return '<div class="fo-empty">No data for this period yet.<br>Figures appear when ticket sales and expenses are recorded.</div>';
    var show = s.series;   // revenue | expenses | both
    var max = 1;
    data.forEach(function (d) { if (show !== "expenses") max = Math.max(max, d.r); if (show !== "revenue") max = Math.max(max, d.e); });
    var pow = Math.pow(10, Math.floor(Math.log10(max))), step = pow * (max / pow > 5 ? 2 : max / pow > 2 ? 1 : 0.5); max = Math.ceil(max / step) * step;
    var x = function (i) { return L + (data.length === 1 ? (W - L - R) / 2 : (i / (data.length - 1)) * (W - L - R)); };
    var y = function (v) { return T + (1 - v / max) * (H - T - B); };
    G = { data: data, x: x, y: y, W: W, H: H, L: L, R: R, T: T, B: B, show: show };
    var grid = "", v;
    for (v = 0; v <= max + 1e-6; v += step) grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="g"/><text x="' + (L - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + compact(v) + '</text>';
    var labels = "", every = Math.max(1, Math.ceil(data.length / 8));
    data.forEach(function (d, i) { if (i % every === 0) labels += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + dayLabel(d.day) + '</text>'; });
    function layer(key, col, id) {
      var pts = data.map(function (d, i) { return [x(i), y(d[key])]; }), line = smooth(pts);
      return '<path d="' + line + ' L' + x(data.length - 1).toFixed(1) + ' ' + y(0) + ' L' + x(0).toFixed(1) + ' ' + y(0) + 'Z" fill="url(#' + id + ')"/><path d="' + line + '" fill="none" stroke="' + col + '" stroke-width="2.6" stroke-linecap="round" class="ln"/>';
    }
    return '<div class="fo-chartwrap" id="foChart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Revenue and expenses"><defs>' +
      '<linearGradient id="foGr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366f1" stop-opacity=".35"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="foGe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity=".32"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="ax">' + grid + labels + '</g>' + (show !== "revenue" ? layer("e", "#f59e0b", "foGe") : "") + (show !== "expenses" ? layer("r", "#6366f1", "foGr") : "") +
      '<g id="foHover" style="display:none"><line id="foVl" y1="' + T + '" y2="' + (H - B) + '"/><circle id="foDr" r="5" fill="#6366f1"/><circle id="foDe" r="5" fill="#f59e0b"/></g></svg>' +
      '<div class="fo-tip" id="foTip" hidden></div></div>';
  }

  /* ---- donut ---- */
  function donut(cats, money) {
    var total = cats.reduce(function (a, c) { return a + c.amount; }, 0);
    if (!cats.length || !total) return '<div class="fo-empty sm">No expense categories this period.</div>';
    var R = 52, C = 2 * Math.PI * R, off = 0;
    var segs = cats.map(function (c, i) {
      var len = (c.amount / total) * C, el = '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + COLORS[i % COLORS.length] + '" stroke-width="18" stroke-dasharray="' + Math.max(0, len - 2).toFixed(2) + ' ' + (C - Math.max(0, len - 2)).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"><title>' + c.name + '</title></circle>';
      off += len; return el;
    }).join("");
    return '<div class="fo-donut"><svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="' + R + '" fill="none" stroke="#eef2fb" stroke-width="18"/>' + segs +
      '<text x="70" y="66" text-anchor="middle" class="t1">' + compact(total) + '</text><text x="70" y="83" text-anchor="middle" class="t2">spent</text></svg>' +
      '<ul>' + cats.slice(0, 6).map(function (c, i) { return '<li><i style="background:' + COLORS[i % COLORS.length] + '"></i><span>' + c.esc + '</span><b>' + Math.round(c.amount / total * 100) + '%</b></li>'; }).join("") + '</ul></div>';
  }

  function render(s) {
    var esc = s.esc, money = s.money, k = s.kpis, prev = s.prev || {};
    var days = (s.chart || []).length, margin = k.revenue ? (k.profit / k.revenue) * 100 : null;
    var netSeries = (s.chart || []).map(function (d) { return d.revenue - d.expenses; });
    var revSeries = (s.chart || []).map(function (d) { return d.revenue; }), expSeries = (s.chart || []).map(function (d) { return d.expenses; });
    var periodName = { "30d": "Last 30 days", month: "This month", quarter: "This quarter", year: "This year" }[s.period] || "This month";
    var periods = [["30d", "30 days"], ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]];
    var cats = (s.cats || []).map(function (c) { return { name: c.name, amount: c.amount, esc: esc(c.name) }; });
    var routeMax = (s.routes || []).reduce(function (m, r) { return Math.max(m, r.amount); }, 1), routeTotal = (s.routes || []).reduce(function (m, r) { return m + r.amount; }, 0) || 1;
    var bestDay = (s.chart || []).slice().sort(function (a, b) { return b.revenue - a.revenue; })[0];
    var avg = days ? k.revenue / days : 0, topCat = cats.slice().sort(function (a, b) { return b.amount - a.amount; })[0], topRoute = (s.routes || [])[0];
    var insights = [];
    if (bestDay && bestDay.revenue) insights.push([P.star, "Best day", dayLabel(bestDay.day) + " · " + money(bestDay.revenue)]);
    if (avg) insights.push([P.cal, "Daily average", money(avg) + " revenue"]);
    if (topRoute) insights.push([P.route, "Top route", topRoute.name + " · " + Math.round(topRoute.amount / routeTotal * 100) + "% of sales"]);
    if (topCat) insights.push([P.pie, "Biggest cost", topCat.name + " · " + money(topCat.amount)]);
    var tone = k.profit >= 0 ? "pos" : "neg";

    return (s.loading ? '<div class="fo-loading"></div>' : "") +
      '<section class="fo-hero ' + tone + '"><div class="fo-hero-l"><small>Finance · ' + esc(periodName) + '</small>' +
        '<div class="fo-net"><span>' + esc(k.profit < 0 ? "Net loss" : "Net profit") + '</span><strong>' + esc(money(k.profit)) + '</strong>' + chip(s.profitDelta) + '</div>' +
        '<div class="fo-hero-m"><div><small>Revenue</small><b>' + esc(money(k.revenue)) + '</b></div><div><small>Expenses</small><b>' + esc(money(k.expenses)) + '</b></div>' +
          '<div><small>Refunds</small><b>' + esc(money(k.refunds || 0)) + '</b></div>' +
          '<div><small>Margin</small><b>' + (margin == null ? "—" : margin.toFixed(1) + "%") + '</b></div></div></div>' +
        '<div class="fo-hero-r"><div class="fo-periods" role="group" aria-label="Period">' + periods.map(function (p) { return '<button type="button" data-period="' + p[0] + '" class="' + (s.period === p[0] ? "on" : "") + '">' + p[1] + '</button>'; }).join("") + '</div>' +
        '<div class="fo-hero-spark">' + spark(netSeries, "#ffffff").replace('opacity=".12"', 'opacity=".2"') + '</div></div></section>' +

      '<div class="fo-kpis">' +
        kpi("Revenue", money(k.revenue), P.wallet, "#6366f1", chip(s.revDelta), revSeries, "ticket sales stay until a refund is confirmed") +
        kpi("Expenses", money(k.expenses), P.card, "#f59e0b", chip(delta(k.expenses, prev.expenses), true), expSeries, "operating spend") +
        kpi("Refunds", money(k.refunds || 0), P.refund, "#ef4444", chip(delta(k.refunds || 0, prev.refunds || 0), true), (s.chart || []).map(function (d) { return d.refunds || 0; }), "only after Finance confirms") +
        kpi("Net profit", money(k.profit), P.trend, k.profit >= 0 ? "#10b981" : "#ef4444", chip(s.profitDelta), netSeries, margin == null ? "" : margin.toFixed(1) + "% margin") +
        '<a class="fo-kpi link' + (k.overdue ? " warn" : "") + '" href="#invoices"><span class="fo-ic" style="--c:#ec4899">' + ic(P.doc) + '</span><div><small>Outstanding invoices</small><strong>' + esc(money(k.invoicesAmt)) + '</strong>' +
          '<em>' + k.invoices + ' pending' + (k.overdue ? ' · <b>' + k.overdue + ' overdue</b>' : "") + '</em></div><span class="fo-go">' + ic(P.arrow) + '</span></a>' +
      '</div>' +

      opsCard(s.ops, esc) +
      (insights.length ? '<div class="fo-ins">' + insights.map(function (i) { return '<div><span>' + ic(i[0]) + '</span><div><small>' + esc(i[1]) + '</small><b>' + esc(i[2]) + '</b></div></div>'; }).join("") + '</div>' : "") +

      '<div class="fo-grid"><section class="fo-card fo-main"><div class="fo-ch"><div><h2>Revenue &amp; expenses</h2><p>' + esc(periodName) + ' · ' + (ui.mode === "cumulative" ? "running total" : "per day") + '</p></div>' +
        '<div class="fo-ctl"><div class="fo-seg" id="foSeries">' + [["both", "Both"], ["revenue", "Revenue"], ["expenses", "Expenses"]].map(function (o) { return '<button type="button" data-series="' + o[0] + '" class="' + (s.series === o[0] ? "on" : "") + '">' + o[1] + '</button>'; }).join("") + '</div>' +
        '<div class="fo-seg" id="foMode">' + [["daily", "Daily"], ["cumulative", "Total"]].map(function (o) { return '<button type="button" data-mode="' + o[0] + '" class="' + (ui.mode === o[0] ? "on" : "") + '">' + o[1] + '</button>'; }).join("") + '</div></div></div>' +
        '<div class="fo-legend"><span><i style="background:#6366f1"></i>Revenue</span><span><i style="background:#f59e0b"></i>Expenses</span></div>' + chartSvg(s) + '</section>' +
      '<section class="fo-card"><div class="fo-ch"><div><h2>Where the money goes</h2><p>Expenses by category</p></div></div>' + donut(cats, money) + '</section>' +
      '<section class="fo-card"><div class="fo-ch"><div><h2>Revenue by route</h2><p>Ticket income this period</p></div></div>' + ((s.routes || []).length ?
        '<div class="fo-routes">' + s.routes.slice(0, 8).map(function (r, i) { return '<div class="fo-route"><div><a href="operations.html#board" title="See this route in Operations"><strong>' + esc(r.name) + '</strong></a><span>' + esc(money(r.amount)) + ' <em>' + Math.round(r.amount / routeTotal * 100) + '%</em></span></div><div class="fo-rbar"><i style="width:' + Math.round(r.amount / routeMax * 100) + '%;--i:' + i + '"></i></div></div>'; }).join("") + '</div>'
        : '<div class="fo-empty sm">No route revenue yet. Ticket sales by route will list here.</div>') + '</section>' +
      '<section class="fo-card fo-tx"><div class="fo-ch"><div><h2>Recent activity</h2><p>Latest sales and costs</p></div></div>' + ((s.tx || []).length ?
        '<div class="fo-txl">' + s.tx.map(function (t) {
          var tn = t.kind === "in" ? "in" : t.kind === "refund" ? "ref" : "out", ico = t.kind === "in" ? P.sale : t.kind === "refund" ? P.refund : P.cost;
          return '<div class="fo-trow"><span class="fo-ti ' + tn + '">' + ic(ico) + '</span><div><strong>' + esc(t.title) + '</strong><small>' + esc(t.sub || "") + '</small></div><b class="' + tn + '">' + (t.kind === "in" ? "+" : "−") + ' ' + esc(money(Math.abs(t.amount))) + '</b></div>';
        }).join("") + '</div>' : '<div class="fo-empty sm">No recent transactions.</div>') + '</section></div>';
  }
  function opsCard(o, esc) {
    if (!o) return "";
    var occ = o.seats ? Math.round(o.booked / o.seats * 100) : 0;
    function t(n, l, cls) { return '<div class="' + (cls || "") + '"><strong>' + n + '</strong><small>' + l + '</small></div>'; }
    return '<a class="fo-ops" href="operations.html#board"><div class="fo-ops-h"><span>' + ic(P.route) + '</span><div><small>Operations · today</small><b>' + (o.trips ? o.trips + (o.trips === 1 ? " trip" : " trips") + " scheduled" : "No trips scheduled") + '</b></div></div>' +
      '<div class="fo-ops-t">' + t(o.live, "On the water") + t(o.done, "Completed") + t(o.delayed, "Delayed", o.delayed ? "warn" : "") + t(o.cancelled, "Cancelled", o.cancelled ? "bad" : "") + '</div>' +
      '<div class="fo-ops-occ"><div><small>Seats booked</small><b>' + o.booked + ' of ' + o.seats + '</b></div><div class="fo-rbar"><i style="width:' + occ + '%;--i:0"></i></div><em>' + occ + '% full</em></div>' +
      '<span class="fo-ops-go">Open Operations ' + ic(P.arrow) + '</span></a>';
  }
  function kpi(label, value, ico, col, ch, series, sub) {
    return '<div class="fo-kpi"><span class="fo-ic" style="--c:' + col + '">' + ic(ico) + '</span><div><small>' + label + '</small><strong>' + value + '</strong><em>' + (ch || "") + ' ' + (sub || "") + '</em></div>' + spark(series, col) + '</div>';
  }

  function bind(s, api) {
    [].forEach.call(document.querySelectorAll("[data-period]"), function (b) { b.addEventListener("click", function () { api.setPeriod(b.dataset.period); }); });
    [].forEach.call(document.querySelectorAll("#foSeries [data-series]"), function (b) { b.addEventListener("click", function () { api.setSeries(b.dataset.series); }); });
    [].forEach.call(document.querySelectorAll("#foMode [data-mode]"), function (b) { b.addEventListener("click", function () { ui.mode = b.dataset.mode; api.rerender(); }); });
    var box = document.getElementById("foChart"); if (!box || !G) return;
    var svg = box.querySelector("svg"), tip = document.getElementById("foTip"), hv = document.getElementById("foHover");
    function move(e) {
      var rect = svg.getBoundingClientRect(), px = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) / rect.width * G.W, n = G.data.length, best = 0, bd = 1e9, i;
      for (i = 0; i < n; i++) { var dd = Math.abs(G.x(i) - px); if (dd < bd) { bd = dd; best = i; } }
      var d = G.data[best], xx = G.x(best);
      hv.style.display = ""; document.getElementById("foVl").setAttribute("x1", xx); document.getElementById("foVl").setAttribute("x2", xx);
      var dr = document.getElementById("foDr"), de = document.getElementById("foDe");
      dr.setAttribute("cx", xx); dr.setAttribute("cy", G.y(d.r)); de.setAttribute("cx", xx); de.setAttribute("cy", G.y(d.e));
      dr.style.display = G.show === "expenses" ? "none" : ""; de.style.display = G.show === "revenue" ? "none" : "";
      tip.hidden = false;
      tip.innerHTML = '<b>' + dayLabel(d.day) + '</b>' + (G.show !== "expenses" ? '<span><i style="background:#6366f1"></i>' + s.esc(s.money(d.r)) + '</span>' : "") + (G.show !== "revenue" ? '<span><i style="background:#f59e0b"></i>' + s.esc(s.money(d.e)) + '</span>' : "");
      var left = xx / G.W * rect.width; tip.style.left = Math.min(Math.max(left, 70), rect.width - 70) + "px";
    }
    svg.addEventListener("mousemove", move); svg.addEventListener("touchmove", move, { passive: true }); svg.addEventListener("touchstart", move, { passive: true });
    svg.addEventListener("mouseleave", function () { hv.style.display = "none"; tip.hidden = true; });
  }

  window.VeyoraFinOv = { render: render, bind: bind };
})();
