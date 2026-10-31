(function () {
  var db = window.veyoraDb;
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  $("burger").addEventListener("click", function () { $("side").classList.toggle("open"); });
  $("me").addEventListener("click", function (e) { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; });
  document.addEventListener("click", function () { $("menu").hidden = true; });
  $("signOut").addEventListener("click", function () { db.auth.signOut().then(function () { location.replace("index.html"); }); });

  function load() {
    return Promise.all([
      db.rpc("platform_stats"), db.rpc("platform_overview"),
      db.from("platform_settings").select("approval_required").single(),
      db.from("platform_audit").select("action, detail, created_at, company_id").order("created_at", { ascending: false }).limit(15),
      db.rpc("platform_company_subs")
    ]).then(function (r) {
      var s = (r[0].data || [])[0] || {};
      var subs = {};
      (r[4].error ? [] : (r[4].data || [])).forEach(function (row) { subs[row.id] = row; });
      $("stats").innerHTML = [["Companies", s.companies], ["Pending approval", s.pending], ["Users", s.users], ["Memberships", s.memberships]].map(function (x) {
        return '<div class="stat"><small>' + x[0] + '</small><strong>' + (x[1] == null ? "–" : x[1]) + '</strong></div>';
      }).join("");
      $("companies").innerHTML = (r[1].data || []).map(function (c) {
        var sub = subs[c.id] || {};
        var btns = c.status === "Pending" ? '<button class="ghost" data-set="Active" data-id="' + c.id + '">Approve</button>' :
          c.status === "Active" ? '<button class="ghost danger" data-set="Suspended" data-id="' + c.id + '">Suspend</button>' :
          '<button class="ghost" data-set="Active" data-id="' + c.id + '">Reactivate</button>';
        return '<li class="row"><span class="grow"><strong>' + esc(c.name) + ' <small>' + esc(c.code) + '</small></strong><small>' + esc(c.type) + ' · ' + esc(c.owner_email || "no owner") + ' · ' + c.members + ' member(s)</small></span>' +
          '<span class="tag">' + esc(c.status) + '</span>' +
          (sub.sub_status ? '<span class="tag">' + esc(sub.sub_status) + '</span>' : '') +
          '<input class="trial-in" data-trial="' + c.id + '" type="number" min="0" max="3650" placeholder="Trial days" aria-label="Trial days for ' + esc(c.name) + '" value="' + (sub.trial_override == null ? "" : sub.trial_override) + '">' +
          '<button type="button" class="ghost" data-trial-save="' + c.id + '">Set trial</button>' +
          '<button type="button" class="ghost" data-trial-clear="' + c.id + '">Use overall</button>' +
          '<button type="button" class="ghost" data-open="' + c.id + '">Open</button>' +
          btns + '</li>';
      }).join("") || '<li class="row"><small>No companies yet.</small></li>';
      $("approval").setAttribute("aria-checked", !!(r[2].data && r[2].data.approval_required));
      $("audit").innerHTML = (r[3].data || []).map(function (a) {
        return '<li class="row"><span class="grow"><strong>' + esc(a.action.replace(/_/g, " ")) + '</strong><small>' + esc(a.detail || "") + ' · ' + new Date(a.created_at).toLocaleString() + '</small></span></li>';
      }).join("") || '<li class="row"><small>No activity yet.</small></li>';
      if (window.VeyoraSub) window.VeyoraSub.mountPlatform(db);
    });
  }

  $("companies").addEventListener("click", function (e) {
    var open = e.target.closest("[data-open]");
    if (open) { try { localStorage.setItem("veyora-view-company", open.dataset.open); } catch (x) {} location.href = "settings.html"; return; }
    var trialSave = e.target.closest("[data-trial-save]");
    var trialClear = e.target.closest("[data-trial-clear]");
    if (trialSave || trialClear) {
      var id = (trialSave || trialClear).dataset.trialSave || (trialSave || trialClear).dataset.trialClear;
      var input = document.querySelector('[data-trial="' + id + '"]');
      var days = trialClear ? null : Number(input.value);
      if (!trialClear && (input.value === "" || isNaN(days))) { alert("Enter the trial days, or choose Use overall."); return; }
      db.rpc("platform_set_company_trial", { p_company: id, p_days: days }).then(function (r) {
        if (r.error) alert(r.error.message); else load();
      });
      return;
    }
    var b = e.target.closest("[data-set]"); if (!b) return;
    if (b.dataset.set === "Suspended" && !confirm("Suspend this company? Its staff lose access.")) return;
    db.rpc("platform_set_status", { p_company: b.dataset.id, p_status: b.dataset.set }).then(function (r) { if (r.error) alert(r.error.message); else load(); });
  });
  $("approval").addEventListener("click", function () {
    var on = $("approval").getAttribute("aria-checked") !== "true";
    db.rpc("platform_set_approval", { p_required: on }).then(function (r) { if (r.error) alert(r.error.message); else load(); });
  });


  /* ---- Platform settings (10 items) ---- */
  var cfg = {};
  var pset = $("pset");
  function itemList() {
    pset.innerHTML = '<h2>Platform owner settings</h2><p class="note">Rules and defaults that apply across all companies</p><ul class="items">' +
      window.VEYORA_PLATFORM_ITEMS.map(function (t, n) {
        var k = "p_" + window.VeyoraEngine.slug(t);
        var help = (window.VEYORA_HELP || {})[t];
        return '<li class="live" data-p="' + n + '" tabindex="0" role="button"><span class="n">' + (n + 1) + '</span><span class="grow"><strong>' + esc(t) + '</strong>' + (help ? '<small>' + esc(help) + '</small>' : "") + '</span><span class="tag">' + (cfg[k] !== undefined ? "Changed" : "Not changed") + '</span></li>';
      }).join("") + '</ul>';
  }
  var phooks = {
    "platform-approval": function (el, ctx, header) {
      el.innerHTML = header(ctx) + '<p class="note">Turn "Require approval" on in the Onboarding card above to hold new companies as Pending. Approve or reactivate them from the Companies list.</p>';
    },
    "platform-audit": function (el, ctx, header) {
      el.innerHTML = header(ctx) + '<p class="msg">Loading…</p>';
      db.from("platform_audit").select("action, detail, created_at").order("created_at", { ascending: false }).limit(50).then(function (r) {
        el.innerHTML = header(ctx) + '<ul class="rows">' + ((r.data || []).map(function (a) { return '<li class="row"><span class="grow"><strong>' + esc(a.action.replace(/_/g, " ")) + '</strong><small>' + esc(a.detail || "") + ' · ' + new Date(a.created_at).toLocaleString() + '</small></span></li>'; }).join("") || '<li class="row"><small>No activity yet.</small></li>') + '</ul>';
        el.querySelector("[data-back]").addEventListener("click", itemList);
      });
    },
    "platform-health": function (el, ctx, header) {
      el.innerHTML = header(ctx) + '<p class="msg">Checking…</p>';
      var t0 = performance.now();
      Promise.all([db.rpc("platform_stats"), db.from("platform_settings").select("approval_required").single()]).then(function (r) {
        var ms = Math.round(performance.now() - t0), s = (r[0].data || [])[0] || {};
        el.innerHTML = header(ctx) + '<div class="stats">' + [["Database", r[0].error ? "Error" : "Online"], ["Response", ms + " ms"], ["Companies", s.companies], ["Users", s.users]].map(function (x) { return '<div class="stat"><small>' + x[0] + '</small><strong>' + x[1] + '</strong></div>'; }).join("") + '</div><p class="note">Checked ' + new Date().toLocaleTimeString() + '</p>';
        el.querySelector("[data-back]").addEventListener("click", itemList);
      });
    }
  };
  function openItem(n) {
    var title = window.VEYORA_PLATFORM_ITEMS[n], spec = window.VEYORA_PLATFORM_DEFS[title], key = "p_" + window.VeyoraEngine.slug(title);
    window.VeyoraEngine.render(pset, {
      title: title, hint: "Platform setting", help: (window.VEYORA_HELP || {})[title], spec: spec, key: key, canEdit: true, db: db, backLabel: "Platform owner settings", hooks: phooks,
      value: cfg[key], onBack: itemList,
      save: function (val) { return db.rpc("platform_set_config", { p_key: key, p_value: val }).then(function (r) { if (r.error) throw new Error(r.error.message); cfg[key] = val; }); }
    });
  }
  pset.addEventListener("click", function (e) { var li = e.target.closest("[data-p]"); if (li) openItem(Number(li.dataset.p)); });
  pset.addEventListener("keydown", function (e) { if (e.key === "Enter") { var li = e.target.closest("[data-p]"); if (li) li.click(); } });

  db.auth.getSession().then(function (r) {
    var session = r.data.session;
    if (!session) { location.replace("index.html"); return; }
    var nm = (session.user.email || "").split("@")[0];
    $("userName").textContent = nm; $("avatar").textContent = nm.slice(0, 2).toUpperCase();
    return db.from("platform_admins").select("user_id").then(function (a) {
      if (!a.data || !a.data.length) { $("denied").hidden = false; return; }
      $("content").hidden = false;
      return db.from("platform_settings").select("config").single().then(function (c) { cfg = (c.data && c.data.config) || {}; itemList(); return load(); });
    });
  });
})();
