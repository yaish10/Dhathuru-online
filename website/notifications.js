/* In-app notification bell. Pages include this and call VeyoraBell.watch(db, companyId, settings). */
(function () {
  var db = null, companyId = null, me = null, keepDays = 30, enabled = true, items = [], open = false;
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
  function hrefOf(n) {
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

  function panelHtml() {
    if (!enabled) return '<p class="bell-empty">In-app notifications are switched off in Settings.</p>';
    if (!items.length) return '<p class="bell-empty">No notifications yet.</p>';
    return '<ul class="bell-list">' + items.map(function (n) {
      return '<li class="' + (n.read_at ? "" : "unread") + '"><a href="' + hrefOf(n) + '" data-nid="' + n.id + '"><strong>' + esc(n.title) + '</strong><small>' + esc(n.body || "") + '</small><span>' + ago(n.created_at) + '</span></a></li>';
    }).join("") + '</ul>';
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
    [].forEach.call(p.querySelectorAll("[data-nid]"), function (a) {
      a.addEventListener("click", function () { mark([a.dataset.nid]); });
    });
  }

  function mark(ids) {
    if (!ids.length || !db) return;
    db.rpc("mark_notifications_read", { p_ids: ids }).then(function () {
      items.forEach(function (n) { if (ids.indexOf(n.id) > -1) n.read_at = n.read_at || new Date().toISOString(); });
      drawBadge(); if (open) renderPanel();
    });
  }

  function load() {
    if (!db || !companyId || !enabled) { items = []; drawBadge(); return Promise.resolve(); }
    var since = new Date(); since.setDate(since.getDate() - keepDays);
    var q = db.from("notifications").select("id, kind, stage, title, body, read_at, created_at, subject_type, subject_id")
      .eq("company_id", companyId).gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }).limit(50);
    if (me) q = q.eq("user_id", me);
    return q.then(function (r) {
        if (r.error) { items = []; drawBadge(); return; }
        items = r.data || [];
        drawBadge();
        if (open) renderPanel();
      });
  }

  function scanThenLoad() {
    if (!db || !companyId) return Promise.resolve();
    return db.rpc("scan_hr_notifications", { p_company: companyId }).then(load, load);
  }

  function toggle(e) {
    e.preventDefault(); e.stopPropagation();
    open = !open;
    var p = ensurePanel(); if (!p) return;
    p.hidden = !open;
    btn().setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { renderPanel(); scanThenLoad(); }
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
      return scanThenLoad();
    });
  }

  window.VeyoraBell = { watch: watch };
})();
