/* Finance → Tickets: every passenger ticket (booking) as a ticket. Opens on payments still pending; Completed shows paid ones. */
(function () {
  var st = { tab: "pending", period: "all", view: (function () { try { return localStorage.getItem("veyora-tk-view") || "cards"; } catch (e) { return "cards"; } })(), q: "", sort: "new", rows: [], loaded: false, loading: false, error: "", capped: false };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ic(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
  var P = { pin: '<path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>', arrow: '<path d="M3 12h18M15 6l6 6-6 6"/>', cal: '<path d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', boat: '<path d="M3 17l2 3h14l2-3M5 17V11l7-3 7 3v6M12 8V4"/>', seat: '<path d="M6 4h12v9H6zM6 13v5h12v-5"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', ppl: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>', phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>' };
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  var WAVE = '<svg viewBox="0 0 64 40"><path d="M2 32C14 8 34 4 58 8 46 12 38 22 30 30 22 38 10 40 2 32Z" fill="#2d8cf0"/><path d="M20 36c10-8 22-8 34-14-4 9-14 16-34 14Z" fill="#0b5ed7"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function qr(text) {
    try {
      if (!window.qrcode) return "";
      var q = window.qrcode(0, "M"); q.addData(String(text)); q.make();
      var n = q.getModuleCount(), d = "", r, c;
      for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
      return '<svg viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges"><path d="' + d + '" fill="#0b1f44"/></svg>';
    } catch (e) { return ""; }
  }
  function logoUrl(api) {
    try { var lp = api.company && api.company.logo_path; if (lp && window.veyoraDb) return window.veyoraDb.storage.from("company-logos").getPublicUrl(lp).data.publicUrl || ""; } catch (e) {}
    return "";
  }
  function range() {
    var n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate(), from = null;
    if (st.period === "today") from = new Date(y, m, d); else if (st.period === "7d") from = new Date(y, m, d - 6); else if (st.period === "30d") from = new Date(y, m, d - 29);
    else if (st.period === "month") from = new Date(y, m, 1); else if (st.period === "year") from = new Date(y, 0, 1);
    return from ? { from: from, to: new Date(y, m, d + 1) } : null;
  }
  function load(api) {
    st.loading = true; st.error = "";
    var r = range(), q = api.db.from("booking_passengers")
      .select("id,full_name,seat_no,status,fare,booking_id,bookings(reference,payment_status,status,contact_name,contact_phone,paid_amount,fare_total,payment_method,created_at),trips!inner(code,depart_at,status,routes(origin,destination),vessels(name,code))")
      .eq("company_id", api.company.id);
    if (r) q = q.gte("trips.depart_at", r.from.toISOString()).lt("trips.depart_at", r.to.toISOString());
    return Promise.resolve(q.order("created_at", { ascending: false }).limit(2000)).then(function (res) {
      st.loading = false; st.loaded = true;
      if (res.error) { st.error = res.error.message; st.rows = []; return; }
      var by = {}, order = [];
      (res.data || []).forEach(function (p) {
        var b = p.bookings || {}, t = p.trips || {}, rt = t.routes || {}, k = p.booking_id || p.id;
        if (!by[k]) {
          var dep = t.depart_at ? new Date(t.depart_at) : null, cancelled = /cancel/i.test(b.status || "") || /refund/i.test(b.payment_status || "");
          by[k] = { id: k, ref: b.reference || "—", name: b.contact_name || p.full_name || "", phone: b.contact_phone || "", pay: b.payment_status || "Unpaid", cancelled: cancelled, total: Number(b.fare_total) || 0, paid: Number(b.paid_amount) || 0, method: b.payment_method || "", at: b.created_at || "", seats: [], pax: 0, trip: t.code || "", from: rt.origin || "", to: rt.destination || "", dep: dep, vessel: (t.vessels && (t.vessels.name || t.vessels.code)) || "" };
          order.push(k);
        }
        by[k].pax++; if (p.seat_no) by[k].seats.push(p.seat_no);
      });
      st.rows = order.map(function (k) { var t = by[k]; t.due = t.cancelled ? 0 : Math.max(0, t.total - t.paid); t.kind = t.cancelled ? "ref" : /^paid$/i.test(t.pay) || (t.total > 0 && t.paid >= t.total) ? "paid" : /part/i.test(t.pay) || t.paid > 0 ? "part" : "unpaid"; return t; });
      st.capped = (res.data || []).length >= 2000;
    }, function (e) { st.loading = false; st.error = (e && e.message) || "Could not load tickets."; });
  }
  function inTab(t) { return st.tab === "all" || (st.tab === "pending" ? (t.kind === "unpaid" || t.kind === "part") : st.tab === "paid" ? t.kind === "paid" : t.kind === "ref"); }
  function filtered() {
    var q = st.q.toLowerCase(), list = st.rows.filter(function (t) { return inTab(t) && (!q || (t.ref + " " + t.name + " " + t.phone + " " + t.trip + " " + t.from + " " + t.to + " " + t.seats.join(" ")).toLowerCase().indexOf(q) > -1); });
    list.sort(function (a, b) { return st.sort === "due" ? b.due - a.due : st.sort === "old" ? String(a.at).localeCompare(String(b.at)) : String(b.at).localeCompare(String(a.at)); });
    return list;
  }
  var LABEL = { paid: "PAID", part: "PARTLY PAID", unpaid: "UNPAID", ref: "CANCELLED" };
  function tile(cls, icon, label, value) { return '<div class="pk-tile ' + cls + '"><span>' + ic(icon) + '</span><div><small>' + label + '</small><b>' + esc(value) + '</b></div></div>'; }
  function card(t, i, money, api) {
    var lg = logoUrl(api), co = (api.company && api.company.name) || "Transport Service", q = qr("TICKET:" + t.ref), d = t.dep;
    var init = String(t.name || "?").trim().split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
    return '<article class="ft ft2 pk" style="--i:' + Math.min(i, 12) + '"><div class="ft-main"><svg class="ft-wave" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30C80 55 200 0 400 6V0H0Z" fill="#1677e8" opacity=".1"/></svg>' +
      '<div class="ft-top2"><span class="ft-brand">' + (lg ? '<img src="' + esc(lg) + '" alt="">' : WAVE) + '<b>' + esc(co) + '</b></span><i class="ft-sep"></i><span class="ft-kind">Passenger Ticket</span>' + (late(t) ? '<span class="pk-flag">Trip departed</span>' : "") + '<span class="ft-badge pay-' + t.kind + '">' + (t.kind === "paid" ? CHECK : "") + LABEL[t.kind] + '</span></div>' +
      '<div class="pk-route"><div class="pk-city"><small>From</small><b>' + esc(t.from || "—") + '</b></div><div class="pk-city r"><small>To</small><b>' + esc(t.to || "—") + '</b></div></div>' +
      '<div class="pk-tiles">' + tile("blue", P.cal, "Trip date", d ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—") + tile("violet", P.clock, "Departure", d ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : "—") + tile("teal", P.boat, "Vessel", t.vessel || "—") + tile("amber", P.seat, "Seats booked", String(t.pax)) + '</div>' +
      '<div class="pk-panel"><div class="pk-who"><span class="tkc-av">' + esc(init) + '</span><div><small>Customer</small><strong>' + esc(t.name || "—") + '</strong><em>' + ic(P.phone) + esc(t.phone || "No phone") + '</em></div></div>' +
        '<div class="pk-seatbox"><small>Seats</small>' + (t.seats.length ? '<span class="tkc-seats">' + t.seats.map(function (x) { return '<i>' + esc(x) + '</i>'; }).join("") + '</span>' : '<span class="pk-noseat">Not assigned</span>') + '<span class="pk-pax">' + ic(P.ppl) + t.pax + (t.pax === 1 ? " passenger" : " passengers") + '</span></div>' +
        '<div class="pk-pay"><small>Payment' + (t.method ? " · " + esc(t.method) : "") + '</small><div class="pk-amts">' + (t.paid > 0 && t.kind !== "ref" ? '<div class="pk-box paid">' + CHECK + '<div><span>Paid</span><b>' + esc(money(t.paid)) + '</b></div></div>' : "") + (t.due > 0 ? '<div class="pk-box due">' + ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v1"/>') + '<div><span>Due</span><b>' + esc(money(t.due)) + '</b></div></div>' : t.kind === "ref" ? '<div class="pk-box ref">' + ic('<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/>') + '<div><span>Status</span><b>Cancelled</b></div></div>' : "") + '</div><span class="pk-fare">Fare ' + esc(money(t.total)) + '</span></div></div>' + actions(t, api) + '</div>' +
      '<div class="ft-stub"><i class="ft-n t"></i><i class="ft-n b"></i><small>Booking ID</small><div class="ft-id">' + esc(t.ref) + '</div><div class="ft-qr' + (q ? "" : " ph") + '">' + (q || "QR") + '</div><div class="ft-scan">Trip ' + esc(t.trip || "—") + '</div>' +
      '<div class="ft-paybox pk-' + t.kind + '">' + (t.kind === "paid" ? CHECK : ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v1"/>')) + '<div><small>' + (t.due > 0 ? "Amount due" : "Payment Status") + '</small><b>' + (t.due > 0 ? esc(money(t.due)) : t.kind === "ref" ? "Cancelled" : "Paid") + '</b>' + (t.total ? '<small>' + (t.kind === "paid" ? esc(money(t.total)) + " settled" : "of " + esc(money(t.total)) + (t.paid ? " · paid " + esc(money(t.paid)) : "")) + '</small>' : "") + '</div></div>' +
      '<div class="ft-print-row"><button type="button" class="tkc-print" data-print="' + esc(t.id) + '">Print ticket</button>' +
      '<button type="button" class="tkc-print ghost" data-invoice="' + esc(t.id) + '">A5 invoice</button></div></div></article>';
  }
  function dayKey(t) { return t.dep ? iso(t.dep) : "none"; }
  function dayLabel(k) {
    if (k === "none") return "No trip date";
    var d = new Date(k + "T00:00:00"), t0 = new Date(); t0.setHours(0, 0, 0, 0); var diff = Math.round((d - t0) / 864e5);
    var nice = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    return diff === 0 ? "Today · " + nice : diff === 1 ? "Tomorrow · " + nice : diff === -1 ? "Yesterday · " + nice : nice;
  }
  function late(t) { return t.dep && t.dep.getTime() < Date.now() && (t.kind === "unpaid" || t.kind === "part"); }
  function phoneIntl(t) { var d = String(t.phone || "").replace(/\D/g, ""); if (!d) return ""; if (d.length === 7) d = "960" + d; return d; }
  var KEY = "9_ticket_reminder_msg";
  var DEFAULT_MSG = "Hello {name}, there is an unpaid payment of {amount} for your ticket {ref}. Please clear the payment. Trip date: {date}, route: {route}. Thank you, {company}.";
  function tmpl(api) { var v = api.company && api.company.settings && api.company.settings[KEY]; return typeof v === "string" && v.trim() ? v : DEFAULT_MSG; }
  function fill(tpl, t, api) {
    var map = { name: t.name || "", ref: t.ref, route: (t.from || "") + " to " + (t.to || ""), date: t.dep ? t.dep.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "", time: t.dep ? pad(t.dep.getHours()) + ":" + pad(t.dep.getMinutes()) : "", amount: api.money(t.due), company: (api.company && api.company.name) || "" };
    return tpl.replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; });
  }
  function remindMsg(t, api) { return fill(tmpl(api), t, api); }
  function enc(x) { return encodeURIComponent(x).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); }); }
  function waLink(t, api) { var d = phoneIntl(t); return d ? "https://api.whatsapp.com/send?phone=" + d + "&text=" + enc(remindMsg(t, api)) : ""; }
  function actions(t, api) {
    if (!(t.kind === "unpaid" || t.kind === "part")) return "";
    var wa = waLink(t, api), tel = String(t.phone || "").replace(/[^\d+]/g, "");
    return '<div class="pk-acts">' + (wa ? '<a class="pk-a wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + ic('<path d="M21 12a9 9 0 0 1-13.4 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12z"/>') + 'Remind on WhatsApp</a>' : "") +
      (phoneIntl(t) ? '<button type="button" class="pk-a vb" data-viber="' + esc(phoneIntl(t)) + '" data-msg="' + esc(remindMsg(t, api)) + '">' + ic('<path d="M12 3C7 3 4 5.5 4 10c0 2.4.8 4 2.5 5.2V20l3.2-2.4c.7.1 1.5.2 2.3.2 5 0 8-2.5 8-7s-3-7.8-8-7.8z"/><path d="M9.5 8.5c.5 3 2.5 5 5.5 5.5"/>') + '<span>Remind on Viber</span></button>' : "") + (tel ? '<a class="pk-a" href="tel:' + esc(tel) + '">' + ic(P.phone) + 'Call</a>' : "") + '<button type="button" class="pk-a" data-copy="' + esc(t.ref) + '">' + ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>') + 'Copy ID</button></div>';
  }
  function ring(pct) {
    var C = 2 * Math.PI * 44, off = C * (1 - pct / 100);
    return '<svg class="ft-ring" viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="44" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="12"/><circle class="arc" cx="55" cy="55" r="44" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 55 55)"/><text x="55" y="53" text-anchor="middle" class="r1">' + pct + '%</text><text x="55" y="71" text-anchor="middle" class="r2">collected</text></svg>';
  }
  function mini(t, money) {
    return '<div class="bd-card ' + t.kind + '"><div class="bd-top"><b>' + esc(t.ref) + '</b>' + (late(t) ? '<em>Departed</em>' : "") + '</div><strong>' + esc(t.name || "—") + '</strong><small>' + esc(t.from) + ' → ' + esc(t.to) + (t.dep ? " · " + t.dep.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "") + '</small><div class="bd-amt"><span>' + t.pax + ' pax</span><b>' + esc(money(t.due > 0 ? t.due : t.total)) + '</b></div></div>';
  }
  function boardView(list, money) {
    var cols = [["unpaid", "Unpaid"], ["part", "Partly paid"], ["paid", "Paid"]];
    return '<div class="bd">' + cols.map(function (c) {
      var items = list.filter(function (t) { return t.kind === c[0]; }), sum = items.reduce(function (a, t) { return a + (c[0] === "paid" ? t.paid : t.due); }, 0);
      return '<section class="bd-col ' + c[0] + '"><header><span>' + c[1] + '</span><b>' + items.length + '</b><small>' + esc(money(sum)) + (c[0] === "paid" ? " collected" : " due") + '</small></header><div class="bd-list">' + (items.map(function (t) { return mini(t, money); }).join("") || '<p class="bd-none">Nothing here</p>') + '</div></section>';
    }).join("") + '</div>';
  }
  function listView(list, money) {
    return '<div class="tl-wrap"><table class="tl"><thead><tr><th>Ticket</th><th>Customer</th><th>Trip</th><th>Seats</th><th class="r">Fare</th><th class="r">Paid</th><th class="r">Due</th><th>Status</th></tr></thead><tbody>' + list.map(function (t) {
      return '<tr class="' + t.kind + '"><td><b>' + esc(t.ref) + '</b></td><td>' + esc(t.name || "—") + '<small>' + esc(t.phone || "") + '</small></td><td>' + esc(t.from) + ' → ' + esc(t.to) + '<small>' + (t.dep ? esc(t.dep.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })) + " · " + pad(t.dep.getHours()) + ":" + pad(t.dep.getMinutes()) : "") + '</small></td><td>' + esc(t.seats.join(", ") || t.pax + " pax") + '</td><td class="r">' + esc(money(t.total)) + '</td><td class="r">' + esc(money(t.paid)) + '</td><td class="r due">' + esc(money(t.due)) + '</td><td><span class="tl-st ' + t.kind + '">' + LABEL[t.kind] + '</span></td></tr>';
    }).join("") + '</tbody></table></div>';
  }
  function cardsView(list, money, api) {
    var groups = [], idx = {};
    list.forEach(function (t) { var k = dayKey(t); if (idx[k] == null) { idx[k] = groups.length; groups.push({ k: k, items: [] }); } groups[idx[k]].items.push(t); });
    if (st.sort === "new" || st.sort === "old") groups.sort(function (a, b) { return st.sort === "old" ? a.k.localeCompare(b.k) : b.k.localeCompare(a.k); });
    var n = 0;
    return '<div class="ft-list grouped">' + groups.map(function (g) {
      var due = g.items.reduce(function (a, t) { return a + t.due; }, 0);
      return '<section class="dg"><header class="dg-h"><h3>' + esc(dayLabel(g.k)) + '</h3><span>' + g.items.length + (g.items.length === 1 ? " ticket" : " tickets") + (due ? " · " + esc(money(due)) + " due" : "") + '</span></header>' + g.items.map(function (t) { return card(t, n++, money, api); }).join("") + '</section>';
    }).join("") + '</div>';
  }
  function render(api) {
    var money = api.money, all = st.rows, pend = all.filter(function (t) { return t.kind === "unpaid" || t.kind === "part"; }), paidL = all.filter(function (t) { return t.kind === "paid"; }), refL = all.filter(function (t) { return t.kind === "ref"; });
    var due = pend.reduce(function (a, t) { return a + t.due; }, 0), got = all.filter(function (t) { return !t.cancelled; }).reduce(function (a, t) { return a + t.paid; }, 0), lateN = pend.filter(late).length;
    var pct = got + due ? Math.round(got / (got + due) * 100) : 0, list = filtered();
    var tabs = [["pending", "Pending payments", pend.length], ["paid", "Payments completed", paidL.length], ["ref", "Cancelled", refL.length], ["all", "All tickets", all.length]];
    var periods = [["all", "All time"], ["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["month", "Month"], ["year", "Year"]];
    var views = [["cards", "Tickets", '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 6v12" stroke-dasharray="2 2"/>'], ["board", "Board", '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>'], ["list", "List", '<path d="M4 6h16M4 12h16M4 18h16"/>']];
    var body = st.error ? '<div class="fo-empty">' + esc(st.error) + '</div>' : !list.length ? '<div class="fo-empty">' + (!st.loaded ? "Loading tickets…" : st.tab === "pending" ? "Nothing is waiting for payment. Every ticket is settled." : "No tickets match.") + '</div>'
      : st.view === "board" ? boardView(st.tab === "all" ? list : list, money) : st.view === "list" ? listView(list, money) : cardsView(list, money, api);
    return '<div class="ftw"><section class="ft-hero tk-hero"><div class="tk-hl"><small>Finance · Tickets</small><h2>' + (st.loaded ? (pend.length ? pend.length + (pend.length === 1 ? " ticket awaits" : " tickets await") + " payment" : "All tickets are paid") : "Loading tickets…") + '</h2>' +
        '<div class="tk-big"><strong>' + esc(money(due)) + '</strong><span>still to collect</span></div>' +
        '<div class="tk-pills"><span><b>' + esc(money(got)) + '</b> collected</span><span><b>' + paidL.length + '</b> paid</span><span><b>' + all.length + '</b> tickets</span>' + (lateN ? '<span class="late"><b>' + lateN + '</b> already departed unpaid</span>' : "") + '</div></div>' +
        '<div class="tk-hr">' + ring(pct) + '<div class="fo-periods" role="group" aria-label="Trip date">' + periods.map(function (p) { return '<button type="button" data-tp="' + p[0] + '" class="' + (st.period === p[0] ? "on" : "") + '">' + p[1] + '</button>'; }).join("") + '</div></div></section>' +
      '<div class="ft-tool"><div class="ft-chips pk-tabs">' + tabs.map(function (c) { return '<button type="button" data-tt="' + c[0] + '" class="' + (st.tab === c[0] ? "on" : "") + '">' + c[1] + ' <b>' + c[2] + '</b></button>'; }).join("") + '</div>' +
        '<label class="ft-search">' + ic(P.search) + '<input id="ftQ" type="search" placeholder="Search name, phone, booking or seat  ( / )" value="' + esc(st.q) + '" aria-label="Search tickets"></label>' +
        '<select id="ftSort" aria-label="Sort"><option value="new"' + (st.sort === "new" ? " selected" : "") + '>Newest trips</option><option value="old"' + (st.sort === "old" ? " selected" : "") + '>Oldest trips</option><option value="due"' + (st.sort === "due" ? " selected" : "") + '>Highest amount due</option></select>' +
        '<button type="button" class="pk-a" id="tkMsg" title="Edit the reminder message">' + ic('<path d="M4 20h4L19 9l-4-4L4 16z"/>') + 'Reminder message</button><div class="tk-views" role="group" aria-label="View">' + views.map(function (v) { return '<button type="button" data-tv="' + v[0] + '" class="' + (st.view === v[0] ? "on" : "") + '" title="' + v[1] + '">' + ic(v[2]) + '<span>' + v[1] + '</span></button>'; }).join("") + '</div></div>' +
      (st.loading ? '<div class="fo-loading"></div>' : "") + body +
      (st.capped ? '<p class="note" style="text-align:center">Showing the latest 2,000 tickets. Narrow the trip date to see older ones.</p>' : "") + '</div>';
  }
  function editMsg(api, redraw) {
    var sample = st.rows.filter(function (t) { return t.due > 0; })[0] || { name: "Aisha Ali", ref: "BK-2026-000123", from: "Thulusdhoo", to: "Male'", dep: new Date(), due: 350 };
    var ov = document.createElement("div"); ov.className = "tkm"; ov.innerHTML = '<div class="tkm-card" role="dialog" aria-modal="true" aria-label="Reminder message"><h3>Reminder message</h3><p>Sent with Remind on WhatsApp and Remind on Viber. Placeholders: <code>{name}</code> <code>{ref}</code> <code>{amount}</code> <code>{route}</code> <code>{date}</code> <code>{time}</code> <code>{company}</code></p>' +
      '<textarea id="tkmT" rows="5" maxlength="600">' + esc(tmpl(api)) + '</textarea><div class="tkm-prev"><small>Preview</small><p id="tkmP"></p></div><p class="msg" id="tkmM"></p><div class="tkm-act"><button type="button" class="pk-a" id="tkmR">Use the standard wording</button><span></span><button type="button" class="pk-a" id="tkmC">Cancel</button><button type="button" class="tkc-print" id="tkmS" style="margin:0;padding:9px 18px">Save</button></div></div>';
    document.body.appendChild(ov);
    var T = ov.querySelector("#tkmT"), pv = function () { ov.querySelector("#tkmP").textContent = fill(T.value || DEFAULT_MSG, sample, api); }; pv(); T.addEventListener("input", pv); T.focus();
    function close() { ov.remove(); }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelector("#tkmC").addEventListener("click", close);
    ov.querySelector("#tkmR").addEventListener("click", function () { T.value = DEFAULT_MSG; pv(); });
    ov.querySelector("#tkmS").addEventListener("click", function () {
      var v = T.value.trim() || DEFAULT_MSG, m = ov.querySelector("#tkmM"); m.textContent = "Saving…";
      Promise.resolve(api.db.rpc("set_company_setting", { p_company: api.company.id, p_key: KEY, p_value: v })).then(function (r) {
        if (r.error) { m.textContent = r.error.message; m.className = "msg err"; return; }
        api.company.settings = api.company.settings || {}; api.company.settings[KEY] = v; close(); redraw();
      }, function (e) { m.textContent = (e && e.message) || "Could not save."; m.className = "msg err"; });
    });
  }
  function printTicket(api, t, btn) {
    if (!t || !window.VeyoraPdfApi) return;
    btn.disabled = true; var orig = btn.textContent; btn.textContent = "Making PDF…";
    window.VeyoraPdfApi.generate({ companyId: api.company.id, documentType: "ticket", sourceId: t.id, filename: "ticket-" + (t.ref || "booking") + ".pdf", source: { reference: t.ref, from: t.from, to: t.to, date: t.dep ? iso(t.dep) : "", time: t.dep ? pad(t.dep.getHours()) + ":" + pad(t.dep.getMinutes()) : "", vessel: t.vessel, seats: t.seats, customerName: t.name, customerPhone: t.phone, passengers: t.pax, seatsBooked: t.pax, paymentStatus: t.cancelled ? "Cancelled" : /^paid$/i.test(t.pay) ? "Paid" : t.pay } })
      .catch(function (e) { window.alert(e && e.message ? e.message : "Could not make the ticket."); }).then(function () { btn.disabled = false; btn.textContent = orig; });
  }
  function printInvoice(api, t, btn) {
    if (!t || !t.id || !window.VeyoraPdfApi) return;
    btn.disabled = true; var orig = btn.textContent; btn.textContent = "Invoice…";
    Promise.resolve(api.db.rpc("ensure_booking_invoice", { p_booking: t.id })).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var invId = r.data;
      if (!invId) throw new Error("Could not create the ticket invoice.");
      return api.db.from("invoices").select("*").eq("id", invId).single();
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var inv = r.data;
      return window.VeyoraPdfApi.generate({
        companyId: api.company.id,
        documentType: "invoice",
        sourceId: inv.id,
        source: inv,
        forceA5: true,
        filename: (inv.code || ("invoice-" + (t.ref || "ticket"))) + ".pdf"
      });
    }).catch(function (e) {
      window.alert(e && e.message ? e.message : "Could not make the invoice.");
    }).then(function () { btn.disabled = false; btn.textContent = orig; });
  }
  function mapBookingRows(rows) {
    var by = {}, order = [];
    (rows || []).forEach(function (p) {
      var b = p.bookings || {}, t = p.trips || {}, rt = t.routes || {}, k = p.booking_id || p.id;
      if (!by[k]) {
        var dep = t.depart_at ? new Date(t.depart_at) : null, cancelled = /cancel/i.test(b.status || "") || /refund/i.test(b.payment_status || "");
        by[k] = { id: k, ref: b.reference || "—", name: b.contact_name || p.full_name || "", phone: b.contact_phone || "", pay: b.payment_status || "Unpaid", cancelled: cancelled, total: Number(b.fare_total) || 0, paid: Number(b.paid_amount) || 0, method: b.payment_method || "", at: b.created_at || "", seats: [], pax: 0, trip: t.code || "", from: rt.origin || "", to: rt.destination || "", dep: dep, vessel: (t.vessels && (t.vessels.name || t.vessels.code)) || "" };
        order.push(k);
      }
      by[k].pax++; if (p.seat_no) by[k].seats.push(p.seat_no);
    });
    return order.map(function (k) {
      var t = by[k];
      t.due = t.cancelled ? 0 : Math.max(0, t.total - t.paid);
      t.kind = t.cancelled ? "ref" : /^paid$/i.test(t.pay) || (t.total > 0 && t.paid >= t.total) ? "paid" : /part/i.test(t.pay) || t.paid > 0 ? "part" : "unpaid";
      return t;
    });
  }
  function loadOne(api, bookingId) {
    return Promise.resolve(api.db.from("booking_passengers")
      .select("id,full_name,seat_no,status,fare,booking_id,bookings(reference,payment_status,status,contact_name,contact_phone,paid_amount,fare_total,payment_method,created_at),trips(code,depart_at,status,routes(origin,destination),vessels(name,code))")
      .eq("company_id", api.company.id)
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true })).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      var rows = mapBookingRows(res.data || []);
      if (!rows.length) throw new Error("Ticket not found.");
      return rows[0];
    });
  }
  function bindTicketActions(root, api, t) {
    [].forEach.call(root.querySelectorAll("[data-print]"), function (b) {
      b.addEventListener("click", function () { printTicket(api, t, b); });
    });
    [].forEach.call(root.querySelectorAll("[data-copy]"), function (b) {
      b.addEventListener("click", function () {
        var v = b.dataset.copy, done = function () {
          var o = b.lastChild; b.classList.add("ok"); o.textContent = "Copied";
          setTimeout(function () { b.classList.remove("ok"); o.textContent = "Copy ID"; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () {});
        else done();
      });
    });
    [].forEach.call(root.querySelectorAll("[data-viber]"), function (b) {
      b.addEventListener("click", function () {
        var lab = b.querySelector("span"), msg = b.dataset.msg, num = b.dataset.viber;
        function opened() {
          if (lab) lab.textContent = "Full message copied. Paste it in Viber";
          b.classList.add("ok");
          setTimeout(function () { if (lab) lab.textContent = "Remind on Viber"; b.classList.remove("ok"); }, 5000);
          window.location.href = "viber://chat?number=%2B" + num;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(msg).then(opened, function () { window.prompt("Copy this message, then paste it in Viber:", msg); opened(); });
        else { window.prompt("Copy this message, then paste it in Viber:", msg); opened(); }
      });
    });
  }
  /** Open the Finance Tickets card for one booking in an overlay (used by Refunds and elsewhere). */
  function openTicket(api, bookingId, opts) {
    opts = opts || {};
    if (!bookingId) return Promise.reject(new Error("Missing booking."));
    var existing = document.getElementById("frTicketOv");
    if (existing) existing.remove();
    var ov = document.createElement("div");
    ov.id = "frTicketOv";
    ov.className = "fr-ticket-ov";
    ov.innerHTML = '<div class="fr-ticket-card" role="dialog" aria-modal="true" aria-label="Passenger ticket">' +
      '<div class="fr-ticket-head"><div><small>Finance · Ticket</small><strong>Loading ticket…</strong></div>' +
      '<button type="button" class="ghost" data-fr-ticket-close>Close</button></div>' +
      '<div class="fr-ticket-body"><div class="fo-loading"></div></div></div>';
    document.body.appendChild(ov);
    function close() { ov.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    ov.addEventListener("click", function (e) {
      if (e.target === ov || e.target.closest("[data-fr-ticket-close]")) close();
    });
    return loadOne(api, bookingId).then(function (t) {
      var head = ov.querySelector(".fr-ticket-head strong");
      if (head) head.textContent = t.ref || "Passenger ticket";
      var body = ov.querySelector(".fr-ticket-body");
      body.innerHTML = '<div class="fr-ticket-wrap">' + card(t, 0, api.money, api) + '</div>';
      bindTicketActions(body, api, t);
      return t;
    }, function (e) {
      var body = ov.querySelector(".fr-ticket-body");
      body.innerHTML = '<div class="fo-empty">' + esc((e && e.message) || "Could not load ticket.") + '</div>';
      throw e;
    });
  }
  function bind(api, redraw) {
    [].forEach.call(document.querySelectorAll("[data-tp]"), function (b) { b.addEventListener("click", function () { st.period = b.dataset.tp; st.loading = true; redraw(); load(api).then(redraw, redraw); }); });
    [].forEach.call(document.querySelectorAll("[data-tt]"), function (b) { b.addEventListener("click", function () { st.tab = b.dataset.tt; redraw(); }); });
    var q = document.getElementById("ftQ"); if (q) q.addEventListener("input", function () { st.q = q.value; var p = q.selectionStart; redraw(); var n = document.getElementById("ftQ"); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    var s = document.getElementById("ftSort"); if (s) s.addEventListener("change", function () { st.sort = s.value; redraw(); });
    var mb = document.getElementById("tkMsg"); if (mb) mb.addEventListener("click", function () { editMsg(api, redraw); });
    [].forEach.call(document.querySelectorAll("[data-tv]"), function (b) { b.addEventListener("click", function () { st.view = b.dataset.tv; try { localStorage.setItem("veyora-tk-view", st.view); } catch (e) {} redraw(); }); });
    [].forEach.call(document.querySelectorAll("[data-viber]"), function (b) {
      b.addEventListener("click", function () {
        var lab = b.querySelector("span"), msg = b.dataset.msg, num = b.dataset.viber;
        // Viber cuts a message passed in the link, so the full reminder is copied and the chat is opened for you to paste it.
        function opened() { lab.textContent = "Full message copied. Paste it in Viber"; b.classList.add("ok"); setTimeout(function () { lab.textContent = "Remind on Viber"; b.classList.remove("ok"); }, 5000); window.location.href = "viber://chat?number=%2B" + num; }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(msg).then(opened, function () { window.prompt("Copy this message, then paste it in Viber:", msg); opened(); });
        else { window.prompt("Copy this message, then paste it in Viber:", msg); opened(); }
      });
    });
    [].forEach.call(document.querySelectorAll("[data-copy]"), function (b) { b.addEventListener("click", function () { var v = b.dataset.copy, done = function () { var o = b.lastChild; b.classList.add("ok"); o.textContent = "Copied"; setTimeout(function () { b.classList.remove("ok"); o.textContent = "Copy ID"; }, 1400); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () {}); else done(); }); });
    [].forEach.call(document.querySelectorAll("[data-print]"), function (b) { b.addEventListener("click", function () { printTicket(api, st.rows.filter(function (x) { return String(x.id) === b.dataset.print; })[0], b); }); });
    [].forEach.call(document.querySelectorAll("[data-invoice]"), function (b) {
      b.addEventListener("click", function () {
        printInvoice(api, st.rows.filter(function (x) { return String(x.id) === b.dataset.invoice; })[0], b);
      });
    });
  }
  if (!window.__tkSlash) { window.__tkSlash = true; document.addEventListener("keydown", function (e) { var q = document.getElementById("ftQ"); if (q && e.key === "/" && !/input|textarea|select/i.test((document.activeElement || {}).tagName || "")) { e.preventDefault(); q.focus(); } }); }
  window.VeyoraFinTickets = { st: st, load: load, render: render, bind: bind, openTicket: openTicket, loadOne: loadOne, card: card };
})();
