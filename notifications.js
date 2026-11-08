/* In-app notification bell. Pages include this and call VeyoraBell.watch(db, companyId, settings).
   Badge and panel update live via Supabase Realtime; a short poll is only a backup. */
(function () {
  var db = null, companyId = null, me = null, keepDays = 30, enabled = true, items = [], open = false, filter = "all", limit = 50;
  var timer = null, channel = null, retryTimer = null, loading = false, lastFetch = 0;
  var $ = function (id) { return document.getElementById(id); };

  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function btn() { return document.querySelector(".bell"); }
  function ago(iso) {
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }
  var ICON = {
    booking: '<path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V8Z"/>',
    money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    cancel: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    trip: '<path d="M3 17l2 3h14l2-3-9-3-9 3ZM12 14V4l5 6h-5"/>',
    people: '<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 3-5.5 6-5.5s6 2.2 6 5.5"/>',
    tool: '<path d="M14 6a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 0-2-2Z"/>',
    it: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'
  };
  function metaOf(k) {
    if (k === "payment_received") return ["Payments", "money", "green"];
    if (k === "booking_refunded" || k === "refund_approval" || k === "refund_finance" || k === "cash_approval") return ["Payments", "money", "amber"];
    if (k === "trip_changed") return ["Bookings", "swap", "blue"];
    if (k === "booking_cancelled") return ["Bookings", "cancel", "red"];
    if (k === "new_booking" || k === "passenger_added") return ["Bookings", "booking", "blue"];
    if (k === "trip" || k === "ops_advisory") return ["Trips", "trip", "amber"];
    if (/^(leave|attendance|swap|cert|document|payslip)/.test(k)) return ["Staff", "people", "violet"];
    if (/^(work_order|maint|defect|vessel_status|low_stock|purchase)/.test(k)) return ["Maintenance", "tool", "amber"];
    if (/^it_/.test(k)) return ["IT", "it", "violet"];
    return ["Other", "bell", "blue"];
  }
  function dayLabel(iso) {
    var d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function hrefOf(n) {
    if (n.kind === "refund_approval") return "operations.html#board";
    if (n.kind === "refund_finance") return "finance.html#refunds";
    if (/^(new_booking|passenger_added|booking_cancelled|trip_changed|payment_received|booking_refunded|cash_approval|trip|ops_advisory)$/.test(n.kind)) return "operations.html#board";
    if (n.kind === "leave_request" || n.kind === "leave_reminder" || n.kind === "leave_decision") return "hr.html#leave";
    if (n.kind === "cert_expiry") return "hr.html#crew";
    if (n.kind === "payslip") return "hr.html#employee/me/pay";
    if (n.kind === "it_device") return "it.html#devices";
    if (n.kind === "it_warranty" || n.kind === "it_licence") return "it.html#assets";
    if (n.kind === "defect") return "maintenance.html#defects/" + n.subject_id;
    if (n.kind === "work_order") return "maintenance.html#workorders/" + n.subject_id;
    if (n.kind === "maint_due") return "maintenance.html#schedules";
    if (n.kind === "vessel_status") return "maintenance.html#vessel/" + n.subject_id;
    if (n.kind === "low_stock") return "maintenance.html#part/" + n.subject_id;
    if (n.kind === "purchase_request") return "maintenance.html#pr/" + n.subject_id;
    if (n.kind === "purchase_order") return "maintenance.html#po/" + n.subject_id;
    if (n.kind === "it_alert") return "it.html#log";
    if (n.kind.indexOf("it_ticket") === 0) return "it.html#tickets/" + n.subject_id;
    if (n.kind === "document_expiry") return "hr.html#employees";
    return "hr.html#overview";
  }
  function unread() { return items.filter(function (n) { return !n.read_at; }).length; }

  function pingBell() {
    var b = btn(); if (!b) return;
    b.classList.remove("bell-ping");
    void b.offsetWidth;
    b.classList.add("bell-ping");
    setTimeout(function () { b.classList.remove("bell-ping"); }, 900);
  }

  function drawBadge() {
    var b = btn(); if (!b) return;
    var n = unread(), dot = b.querySelector("b");
    b.setAttribute("data-count", n);
    b.setAttribute("aria-label", n ? (n + " unread notifications") : "Notifications");
    if (dot) {
      if (!n) { dot.hidden = true; dot.textContent = ""; }
      else { dot.hidden = false; dot.textContent = n > 9 ? "9+" : String(n); }
    }
  }

  function paint() {
    drawBadge();
    if (open) renderPanel();
  }

  function visible() {
    return items.filter(function (n) {
      if (filter === "all") return true;
      if (filter === "unread") return !n.read_at;
      return metaOf(n.kind)[0] === filter;
    });
  }
  function chipsHtml() {
    var groups = [];
    items.forEach(function (n) { var g = metaOf(n.kind)[0]; if (groups.indexOf(g) < 0) groups.push(g); });
    var list = [["all", "All"], ["unread", "Unread" + (unread() ? " " + unread() : "")]].concat(groups.map(function (g) { return [g, g]; }));
    return '<div class="bell-chips">' + list.map(function (c) {
      return '<button type="button" class="bell-chip' + (filter === c[0] ? " on" : "") + '" data-bf="' + esc(c[0]) + '">' + esc(c[1]) + '</button>';
    }).join("") + '</div>';
  }
  function panelHtml() {
    if (!enabled) return '<p class="bell-empty">In-app notifications are switched off in Settings.</p>';
    if (!items.length) return '<p class="bell-empty">No notifications yet. New bookings, payments, trip changes and cancellations show up here.</p>';
    var rows = visible();
    if (!rows.length) return chipsHtml() + '<p class="bell-empty">Nothing here.</p>';
    var out = chipsHtml() + '<ul class="bell-list">', last = "";
    rows.forEach(function (n) {
      var day = dayLabel(n.created_at), m = metaOf(n.kind);
      if (day !== last) { out += '<li class="bell-day">' + esc(day) + '</li>'; last = day; }
      out += '<li class="' + (n.read_at ? "" : "unread") + '"><a href="' + hrefOf(n) + '" data-nid="' + n.id + '"><i class="bell-ic t-' + m[2] + '"><svg viewBox="0 0 24 24">' + ICON[m[1]] + '</svg></i>' +
        '<span class="bell-tx"><strong>' + esc(n.title) + '</strong><small>' + esc(n.body || "") + '</small><em>' + ago(n.created_at) + ' · ' + esc(m[0]) + '</em></span>' + (n.read_at ? "" : '<u aria-hidden="true"></u>') + '</a></li>';
    });
    out += '</ul>';
    if (items.length >= limit) out += '<button type="button" class="ghost bell-more" id="bellMore">Show older</button>';
    return out;
  }

  function ensurePanel() {
    var b = btn(); if (!b) return null;
    var p = $("bellPanel");
    if (!p) {
      p = document.createElement("div");
      p.id = "bellPanel"; p.className = "bell-panel"; p.hidden = true; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Notifications");
      b.parentNode.insertBefore(p, b.nextSibling);
    }
    return p;
  }

  function renderPanel() {
    var p = ensurePanel(); if (!p) return;
    p.innerHTML = '<div class="bell-head"><strong>Notifications</strong>' +
      (unread() ? '<button type="button" class="ghost" id="bellRead">Mark all read</button>' : "") + '</div>' + panelHtml();
    var r = $("bellRead");
    if (r) r.addEventListener("click", function (e) {
      e.stopPropagation();
      var ids = items.filter(function (n) { return !n.read_at; }).map(function (n) { return n.id; });
      mark(ids);
    });
    [].forEach.call(p.querySelectorAll("[data-bf]"), function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); filter = b.dataset.bf; renderPanel(); });
    });
    var more = $("bellMore");
    if (more) more.addEventListener("click", function (e) { e.stopPropagation(); limit += 50; load(true); });
    [].forEach.call(p.querySelectorAll("[data-nid]"), function (a) {
      a.addEventListener("click", function () { mark([a.dataset.nid]); });
    });
  }

  function mark(ids) {
    if (!ids.length || !db) return;
    db.rpc("mark_notifications_read", { p_ids: ids }).then(function () {
      items.forEach(function (n) { if (ids.indexOf(n.id) > -1) n.read_at = n.read_at || new Date().toISOString(); });
      paint();
    });
  }

  function rowFrom(payload) {
    var row = payload && payload.new;
    if (!row || !row.id) return null;
    if (companyId && row.company_id && row.company_id !== companyId) return null;
    return {
      id: row.id,
      kind: row.kind,
      stage: row.stage,
      title: row.title,
      body: row.body,
      read_at: row.read_at || null,
      created_at: row.created_at,
      subject_type: row.subject_type,
      subject_id: row.subject_id
    };
  }

  function onInsert(payload) {
    var row = rowFrom(payload); if (!row) return;
    if (items.some(function (n) { return n.id === row.id; })) return;
    items.unshift(row);
    if (items.length > limit + 20) items = items.slice(0, limit);
    paint();
    if (!row.read_at) pingBell();
    try { window.dispatchEvent(new CustomEvent("veyora:notice", { detail: row })); } catch (e) {}
  }

  function onUpdate(payload) {
    var row = rowFrom(payload); if (!row) return;
    var found = false;
    items.forEach(function (n) {
      if (n.id === row.id) {
        n.read_at = row.read_at;
        n.title = row.title || n.title;
        n.body = row.body != null ? row.body : n.body;
        found = true;
      }
    });
    if (!found && !row.read_at) items.unshift(row);
    paint();
  }

  function load(force) {
    if (!db || !companyId || !enabled) { items = []; paint(); return Promise.resolve(); }
    if (loading && !force) return Promise.resolve();
    var now = Date.now();
    if (!force && now - lastFetch < 1200) return Promise.resolve();
    loading = true; lastFetch = now;
    var since = new Date(); since.setDate(since.getDate() - keepDays);
    var q = db.from("notifications").select("id, kind, stage, title, body, read_at, created_at, subject_type, subject_id")
      .eq("company_id", companyId).gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }).limit(limit);
    if (me) q = q.eq("user_id", me);
    return q.then(function (r) {
        loading = false;
        if (r.error) return;
        var prev = unread();
        items = r.data || [];
        paint();
        if (unread() > prev) pingBell();
      }, function () { loading = false; });
  }

  function scanThenLoad() {
    if (!db || !companyId) return Promise.resolve();
    return db.rpc("scan_hr_notifications", { p_company: companyId }).then(function () { return load(true); }, function () { return load(true); });
  }

  function clearChannel() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (channel && db) {
      try { db.removeChannel(channel); } catch (e) {}
    }
    channel = null;
  }

  function listen() {
    if (!db || !me || !enabled) return;
    clearChannel();
    var ch = db.channel("bell-" + me);
    channel = ch;
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + me }, onInsert)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: "user_id=eq." + me }, onUpdate)
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (channel === ch) channel = null;
          if (!retryTimer) retryTimer = setTimeout(function () { retryTimer = null; listen(); }, 2500);
        }
      });
  }

  function toggle(e) {
    e.preventDefault(); e.stopPropagation();
    open = !open;
    var p = ensurePanel(); if (!p) return;
    p.hidden = !open;
    btn().setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { renderPanel(); load(true); }
  }

  function bind() {
    var b = btn(); if (!b || b.dataset.bellBound) return;
    b.dataset.bellBound = "1";
    b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", toggle);
    document.addEventListener("click", function (e) {
      if (!open) return;
      if (e.target.closest(".bell") || e.target.closest("#bellPanel")) return;
      open = false; var p = $("bellPanel"); if (p) p.hidden = true; b.setAttribute("aria-expanded", "false");
    });
  }

  function inApp(settings) {
    var s = settings && settings["11_in_app_notifications"];
    enabled = !(s && s.enabled === false);
    keepDays = Math.max(1, Number(s && s.keep) || 30);
  }

  function watch(client, cid, settings) {
    db = client; companyId = cid; inApp(settings || {});
    bind();
    drawBadge();
    return db.auth.getSession().then(function (r) {
      me = r.data.session && r.data.session.user && r.data.session.user.id;
      if (!timer) {
        // Backup only — Realtime should keep the badge current.
        timer = setInterval(function () { if (!document.hidden) load(false); }, 12000);
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden) { listen(); load(true); }
        });
      }
      listen();
      return scanThenLoad();
    });
  }

  window.VeyoraBell = { watch: watch, refresh: function () { return load(true); } };
})();
