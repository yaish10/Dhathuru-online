/* Subscription state, the expired-app lock, and platform billing. All amounts come from the database. */
(function () {
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(amount, currency) {
    var n = Number(amount);
    if (isNaN(n)) return "";
    return currency + " " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function every(plan) {
    if (plan.interval_unit === "lifetime") return "one time";
    var n = Number(plan.interval_count) || 1;
    var unit = plan.interval_unit === "year" ? "year" : "month";
    return n === 1 ? "per " + unit : "every " + n + " " + unit + "s";
  }
  function when(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function daysLeft(iso) {
    if (!iso) return 0;
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
  }
  function plansHtml(sub, renew) {
    var plans = sub.plans || [];
    if (!plans.length) return '<p class="note">No plans are published yet.</p>';
    return plans.map(function (p) {
      var btn = renew ? '<button type="button" class="ghost" data-renew="' + esc(p.id) + '">Renew</button>' : "";
      return '<div class="sub-plan"><span><strong>' + esc(p.name) + '</strong><small>' + esc(money(p.amount, sub.currency)) + " " + esc(every(p)) + '</small></span>' + btn + '</div>';
    }).join("");
  }
  function statusLine(sub) {
    if (sub.status === "lifetime") return "Lifetime";
    if (sub.status === "active") return (sub.plan_name || "Paid") + " · until " + when(sub.period_end);
    if (sub.status === "trial") return "Free trial · " + daysLeft(sub.trial_ends_at) + " days left";
    return "Subscription expired";
  }

  function paintStatus(sub) {
    var el = document.getElementById("appStatusText");
    if (el && sub) el.textContent = sub.locked ? "Subscription expired" : statusLine(sub);
  }

  function fillLock(sub, admin, platform) {
    var box = document.getElementById("subLock");
    if (!box) return;
    box.innerHTML =
      '<div class="sub-card" role="dialog" aria-modal="true" aria-labelledby="subTitle">' +
      '<h2 id="subTitle">Subscription expired</h2>' +
      '<p class="note">Renew to continue using VEYORA. The app stays locked until a plan is active.</p>' +
      '<div class="sub-plans">' + plansHtml(sub, admin) + '</div>' +
      (admin
        ? '<form id="redeemForm" class="inv"><input id="redeemCode" maxlength="64" placeholder="Redeem code" aria-label="Redeem code" autocomplete="off"><button class="save" type="submit">Redeem</button></form><p class="msg" id="subMsg" role="status"></p>'
        : '<p class="note">Ask a company owner or admin to renew or redeem a code.</p>') +
      '<div class="actions">' +
      (platform ? '<a class="ghost" href="platform.html">Platform owner</a>' : "") +
      '<button type="button" class="ghost" id="subOut">Sign out</button></div></div>';
    box.hidden = false;
    var side = document.querySelector(".side");
    var main = document.querySelector(".main");
    if (side) side.inert = true;
    if (main) main.inert = true;
  }

  function clearLock() {
    var box = document.getElementById("subLock");
    if (box) box.hidden = true;
    var side = document.querySelector(".side");
    var main = document.querySelector(".main");
    if (side) side.inert = false;
    if (main) main.inert = false;
  }

  function watch(db, companyId, admin) {
    var platform = false;
    function say(t, k) {
      var m = document.getElementById("subMsg");
      if (m) { m.textContent = t; m.className = "msg " + (k || ""); }
    }
    function draw(sub) {
      paintStatus(sub);
      if (!sub.locked || platform) { clearLock(); return; }
      fillLock(sub, admin, platform);
      var form = document.getElementById("redeemForm");
      if (form) form.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = document.getElementById("redeemCode").value.trim();
        if (code.length < 6) { say("Enter the code.", "err"); return; }
        say("Checking…");
        db.rpc("redeem_code", { p_company: companyId, p_code: code }).then(function (r) {
          if (r.error || (r.data && r.data.error)) { say(r.error ? r.error.message : r.data.error, "err"); return; }
          location.reload();
        });
      });
      var out = document.getElementById("subOut");
      if (out) out.addEventListener("click", function () { db.auth.signOut().then(function () { location.replace("index.html"); }); });
      var card = boxCard();
      if (card) card.addEventListener("click", function (e) {
        var b = e.target.closest("[data-renew]");
        if (!b) return;
        db.rpc("request_renewal", { p_company: companyId, p_plan: b.dataset.renew }).then(function (r) {
          say(r.error ? r.error.message : "Renewal requested. VEYORA will activate it after payment.", r.error ? "err" : "ok");
        });
      });
    }
    function boxCard() { var b = document.getElementById("subLock"); return b ? b.querySelector(".sub-card") : null; }
    db.rpc("company_subscription", { p_company: companyId }).then(function (r) {
      if (r.error || !r.data) return;
      db.from("platform_admins").select("user_id").then(function (a) {
        platform = !!(a.data && a.data.length);
        draw(r.data);
      });
    });
  }

  function renderPanel(el, headerHtml, db, companyId, admin, onBack) {
    el.innerHTML = headerHtml + '<p class="msg">Loading…</p>';
    db.rpc("company_subscription", { p_company: companyId }).then(function (r) {
      if (r.error) { el.innerHTML = headerHtml + '<p class="msg err">' + esc(r.error.message) + '</p>'; }
      else {
        var sub = r.data;
        el.innerHTML = headerHtml +
          '<ul class="rows"><li class="row"><span class="grow"><strong>' + esc(statusLine(sub)) + '</strong><small>Trial length ' + esc(sub.trial_days) + ' days' + (sub.trial_override == null ? " (overall)" : " (this company)") + '</small></span><span class="tag">' + esc(sub.status) + '</span></li></ul>' +
          '<h3>Plans</h3><div class="sub-plans">' + plansHtml(sub, false) + '</div>' +
          (admin ? '<form id="panelRedeem" class="inv"><input id="panelCode" maxlength="64" placeholder="Redeem code" aria-label="Redeem code" autocomplete="off"><button class="save" type="submit">Redeem</button></form><p class="msg" id="panelSubMsg"></p>' : "");
        var form = document.getElementById("panelRedeem");
        if (form) form.addEventListener("submit", function (e) {
          e.preventDefault();
          var msg = document.getElementById("panelSubMsg");
          var code = document.getElementById("panelCode").value.trim();
          db.rpc("redeem_code", { p_company: companyId, p_code: code }).then(function (res) {
            var failed = res.error || (res.data && res.data.error);
            msg.textContent = failed ? (res.error ? res.error.message : res.data.error) : "Lifetime access is on.";
            msg.className = "msg " + (failed ? "err" : "ok");
            if (!failed) location.reload();
          });
        });
      }
      var back = el.querySelector("[data-back]");
      if (back && onBack) back.addEventListener("click", onBack);
    });
  }

  function mountPlatform(db) {
    var root = document.getElementById("billing");
    if (!root) return;
    root.innerHTML = '<h2>Subscriptions</h2><p class="msg">Loading…</p>';
    Promise.all([db.rpc("platform_billing"), db.rpc("platform_renewals")]).then(function (r) {
      if (r[0].error) { root.innerHTML = '<h2>Subscriptions</h2><p class="msg err">' + esc(r[0].error.message) + '</p>'; return; }
      var b = r[0].data, reqs = r[1].data || [];
      root.innerHTML =
        '<h2>Subscriptions</h2><p class="note">Prices, the overall trial and the lifetime code are stored in the database. A company uses the overall trial unless you set one for that company.</p>' +
        '<form id="billForm" class="cards">' +
        '<div class="fld"><label for="trialDays">Overall free trial (days)</label><input id="trialDays" type="number" min="0" max="3650" value="' + esc(b.trial_days) + '"></div>' +
        '<div class="fld"><label for="billCur">Currency</label><input id="billCur" maxlength="3" value="' + esc(b.currency) + '"></div>' +
        '<div class="fld wide"><label for="lifeCode">Lifetime unlock code</label><input id="lifeCode" maxlength="64" value="' + esc(b.lifetime_code) + '" autocomplete="off"></div>' +
        '</form><div class="actions"><span class="msg" id="billMsg"></span><button type="button" class="save" id="billSave">Save subscription settings</button></div>' +
        '<h3>Plans</h3><div id="planRows"></div>' +
        '<div class="inv" style="margin-top:12px"><input id="newPlanName" placeholder="New plan name" maxlength="60" aria-label="New plan name"><input id="newPlanAmount" type="number" min="0" step="0.01" placeholder="Amount" aria-label="Amount"><select id="newPlanEvery" aria-label="Interval"><option value="month">per month</option><option value="year">per year</option><option value="lifetime">lifetime</option></select><button type="button" class="ghost" id="addPlan">Add plan</button></div>' +
        '<h3>Renewal requests</h3><ul class="rows" id="renewals"></ul>';
      document.getElementById("planRows").innerHTML = (b.plans || []).map(function (p) {
        return '<div class="inv" data-plan="' + esc(p.id) + '" style="margin-bottom:8px"><strong style="min-width:88px">' + esc(p.name) + '</strong>' +
          '<input data-f="amount" type="number" min="0" step="0.01" value="' + esc(p.amount) + '" aria-label="Amount">' +
          '<select data-f="interval" aria-label="Interval"><option value="month"' + (p.interval_unit === "month" ? " selected" : "") + '>month</option><option value="year"' + (p.interval_unit === "year" ? " selected" : "") + '>year</option><option value="lifetime"' + (p.interval_unit === "lifetime" ? " selected" : "") + '>lifetime</option></select>' +
          '<button type="button" class="ghost" data-save-plan="' + esc(p.id) + '" data-count="' + esc(p.interval_count) + '" data-active="' + (p.active ? 1 : 0) + '">Save</button></div>';
      }).join("");
      document.getElementById("renewals").innerHTML = reqs.length ? reqs.map(function (q) {
        return '<li class="row"><span class="grow"><strong>' + esc(q.company_name) + '</strong><small>' + esc(q.plan_name) + " · " + esc(money(q.amount, q.currency)) + " · " + esc(when(q.created_at)) + '</small></span>' +
          '<button type="button" class="ghost" data-grant="' + q.id + '">Grant</button><button type="button" class="ghost danger" data-deny="' + q.id + '">Dismiss</button></li>';
      }).join("") : '<li class="row"><small>No open renewal requests.</small></li>';

      function note(t, k) { var m = document.getElementById("billMsg"); m.textContent = t; m.className = "msg " + (k || ""); }
      document.getElementById("billSave").addEventListener("click", function () {
        db.rpc("platform_set_billing", {
          p_trial_days: Number(document.getElementById("trialDays").value),
          p_currency: document.getElementById("billCur").value.trim().toUpperCase(),
          p_lifetime_code: document.getElementById("lifeCode").value.trim()
        }).then(function (res) { note(res.error ? res.error.message : "Saved.", res.error ? "err" : "ok"); });
      });
      root.onclick = function (e) {
        var save = e.target.closest("[data-save-plan]");
        var grant = e.target.closest("[data-grant]");
        var deny = e.target.closest("[data-deny]");
        if (save) {
          var row = save.closest("[data-plan]");
          db.rpc("platform_save_plan", {
            p_id: save.dataset.savePlan, p_name: row.querySelector("strong").textContent,
            p_amount: Number(row.querySelector('[data-f="amount"]').value),
            p_interval: row.querySelector('[data-f="interval"]').value, p_count: Number(save.dataset.count) || 1, p_active: save.dataset.active !== "0"
          }).then(function (res) { if (res.error) alert(res.error.message); else note("Plan saved.", "ok"); });
        }
        if (grant || deny) {
          db.rpc("platform_resolve_renewal", { p_request: (grant || deny).dataset.grant || (grant || deny).dataset.deny, p_grant: !!grant })
            .then(function (res) { if (res.error) alert(res.error.message); else mountPlatform(db); });
        }
      };
      document.getElementById("addPlan").addEventListener("click", function () {
        var name = document.getElementById("newPlanName").value.trim();
        var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
        db.rpc("platform_save_plan", {
          p_id: id, p_name: name, p_amount: Number(document.getElementById("newPlanAmount").value),
          p_interval: document.getElementById("newPlanEvery").value, p_count: 1, p_active: true
        }).then(function (res) { if (res.error) alert(res.error.message); else mountPlatform(db); });
      });
    });
  }

  window.VeyoraSub = { watch: watch, renderPanel: renderPanel, mountPlatform: mountPlatform, statusLine: statusLine };
})();
