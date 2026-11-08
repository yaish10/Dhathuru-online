(function () {
  var db = window.veyoraDb;
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  $("burger").addEventListener("click", function () { $("side").classList.toggle("open"); });
  $("me").addEventListener("click", function (e) { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; });
  document.addEventListener("click", function () { $("menu").hidden = true; });
  $("signOut").addEventListener("click", function () { db.auth.signOut().then(function () { location.replace("index.html"); }); });

  var companiesHtml = '<li class="row"><small>No companies yet.</small></li>';
  var approvalOn = false;
  function load() {
    return Promise.all([
      db.rpc("platform_stats"), db.rpc("platform_overview"),
      db.from("platform_settings").select("approval_required").single(),
      db.rpc("platform_company_subs")
    ]).then(function (r) {
      var s = (r[0].data || [])[0] || {};
      var subs = {};
      (r[3].error ? [] : (r[3].data || [])).forEach(function (row) { subs[row.id] = row; });
      $("stats").innerHTML = [["Companies", s.companies], ["Pending approval", s.pending], ["Users", s.users], ["Memberships", s.memberships]].map(function (x) {
        return '<div class="stat"><small>' + x[0] + '</small><strong>' + (x[1] == null ? "–" : x[1]) + '</strong></div>';
      }).join("");
      companiesHtml = (r[1].data || []).map(function (c) {
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
      approvalOn = !!(r[2].data && r[2].data.approval_required);
      var list = $("companies");
      if (list) list.innerHTML = companiesHtml;
      var sw = $("approval");
      if (sw) sw.setAttribute("aria-checked", approvalOn ? "true" : "false");
      if (window.VeyoraSub && $("billing")) window.VeyoraSub.mountPlatform(db);
    });
  }

  /* One screen. Each section keeps the same stored key as the old list. */
  var cfg = {};
  var TABS = [
    ["companies", "Companies"],
    ["onboarding", "Onboarding"],
    ["suspension", "Suspension"],
    ["plans", "Plans"],
    ["limits", "Limits"],
    ["subscriptions", "Subscriptions"],
    ["roles", "Roles"],
    ["security", "Security"],
    ["integrations", "Integrations"],
    ["sms", "SMS"],
    ["audit", "Audit"],
    ["health", "Health"]
  ];
  var FORMS = {
    onboarding: "Company Registration & Onboarding",
    suspension: "Company Suspension & Reactivation",
    plans: "Company Subscription Plans",
    limits: "Subscription Limits",
    roles: "Platform-Wide Roles & Permissions",
    security: "Platform Security Policies",
    integrations: "Global Integrations",
    audit: "Platform Audit Logs",
    health: "System Health & Monitoring"
  };
  var phooks = {
    "platform-approval": function (el, ctx, header) {
      el.innerHTML = header(ctx) + '<p class="note">Require approval is on the Onboarding section. Approve or reactivate a company from Companies.</p>';
    },
    "platform-audit": function (el, ctx, header) {
      el.innerHTML = header(ctx) + '<p class="msg">Loading…</p>';
      db.from("platform_audit").select("action, detail, created_at").order("created_at", { ascending: false }).limit(50).then(function (r) {
        el.innerHTML = header(ctx) + '<ul class="rows">' + ((r.data || []).map(function (a) { return '<li class="row"><span class="grow"><strong>' + esc(a.action.replace(/_/g, " ")) + '</strong><small>' + esc(a.detail || "") + ' · ' + new Date(a.created_at).toLocaleString() + '</small></span></li>'; }).join("") || '<li class="row"><small>No activity yet.</small></li>') + '</ul>';
      });
    },
    "platform-health": function (el, ctx, header) {
      el.innerHTML = header(ctx) + '<p class="msg">Checking…</p>';
      var t0 = performance.now();
      Promise.all([db.rpc("platform_stats"), db.from("platform_settings").select("approval_required").single()]).then(function (r) {
        var ms = Math.round(performance.now() - t0), s = (r[0].data || [])[0] || {};
        el.innerHTML = header(ctx) + '<div class="stats">' + [["Database", r[0].error ? "Error" : "Online"], ["Response", ms + " ms"], ["Companies", s.companies], ["Users", s.users]].map(function (x) { return '<div class="stat"><small>' + x[0] + '</small><strong>' + x[1] + '</strong></div>'; }).join("") + '</div><p class="note">Checked ' + new Date().toLocaleTimeString() + '</p>';
      });
    }
  };
  function tabFromHash() {
    var id = (location.hash || "").replace(/^#/, "");
    return TABS.some(function (t) { return t[0] === id; }) ? id : "companies";
  }
  function openForm(title) {
    var spec = window.VEYORA_PLATFORM_DEFS[title], key = "p_" + window.VeyoraEngine.slug(title);
    window.VeyoraEngine.render($("pform"), {
      title: title, hint: "Platform setting", help: (window.VEYORA_HELP || {})[title], spec: spec, key: key, canEdit: true, db: db, embed: true, hooks: phooks,
      value: cfg[key],
      save: function (val) { return db.rpc("platform_set_config", { p_key: key, p_value: val }).then(function (r) { if (r.error) throw new Error(r.error.message); cfg[key] = val; }); }
    });
  }
  function show(id) {
    var root = $("platform");
    root.innerHTML = '<div class="pt-tabs" role="tablist">' + TABS.map(function (t) {
      return '<button type="button" data-ptab="' + t[0] + '"' + (t[0] === id ? ' class="on" aria-current="page"' : "") + '>' + esc(t[1]) + '</button>';
    }).join("") + '</div><div id="pbody"></div>';
    var body = $("pbody");
    if (id === "companies") {
      body.innerHTML = '<h2>Companies</h2><p class="note">Approve, suspend, reactivate and set a trial. Open a company to work inside it.</p><ul class="rows" id="companies">' + companiesHtml + '</ul>';
    } else if (id === "onboarding") {
      body.innerHTML = '<h2>Onboarding</h2><ul class="pref-list"><li><span><strong>Require approval</strong><small>New companies wait as Pending until you approve them on Companies.</small></span><button type="button" class="sw" id="approval" role="switch" aria-checked="' + (approvalOn ? "true" : "false") + '" aria-label="Require approval"></button></li></ul><div id="pform"></div><div id="obProg"></div>';
      openForm("Company Registration & Onboarding");
      if (window.VeyoraOnboarding && $("obProg")) $("obProg").innerHTML = window.VeyoraOnboarding.editorHtml(cfg.onboarding_progress);
    } else if (id === "subscriptions") {
      body.innerHTML = '<div id="billing"></div>';
      if (window.VeyoraSub) window.VeyoraSub.mountPlatform(db);
    } else if (id === "sms") {
      body.innerHTML = '<div id="smsCfg"></div>';
      if (window.VeyoraPlatformSms) window.VeyoraPlatformSms.mount();
    } else if (FORMS[id]) {
      body.innerHTML = '<div id="pform"></div>';
      openForm(FORMS[id]);
    }
  }
  $("platform").addEventListener("change", function (e) {
    if (!e.target.closest || !e.target.closest("[data-ob-on]")) return;
    var preview = $("obPreview");
    if (preview && window.VeyoraOnboarding) preview.textContent = "Companies will see: " + window.VeyoraOnboarding.resolve(window.VeyoraOnboarding.read($("obProg"))).map(function (s) { return s.label; }).join(" → ");
  });
  $("platform").addEventListener("click", function (e) {
    var tab = e.target.closest("[data-ptab]");
    if (tab) {
      var id = tab.getAttribute("data-ptab");
      if (("#" + id) === location.hash) show(id);
      else location.hash = id;
      return;
    }
    if (e.target.closest("#obAddBtn")) {
      var box = $("obAdd");
      var opt = box && box.selectedOptions && box.selectedOptions[0];
      if (!opt || !opt.value) { var need = $("obProgMsg"); if (need) { need.textContent = "Choose a setting to add."; need.className = "msg err"; } return; }
      var draft = window.VeyoraOnboarding.read($("obProg"));
      draft.extra.push({ title: opt.getAttribute("data-title"), key: opt.value });
      cfg.onboarding_progress = draft;
      $("obProg").innerHTML = window.VeyoraOnboarding.editorHtml(draft);
      return;
    }
    if (e.target.closest("[data-ob-rm]")) {
      var drop = e.target.closest("[data-ob-rm]").getAttribute("data-ob-rm");
      var kept = window.VeyoraOnboarding.read($("obProg"));
      kept.extra = kept.extra.filter(function (row) { return row.key !== drop; });
      cfg.onboarding_progress = kept;
      $("obProg").innerHTML = window.VeyoraOnboarding.editorHtml(kept);
      return;
    }
    if (e.target.closest("#obSaveProg")) {
      var prog = window.VeyoraOnboarding.read($("obProg"));
      var note = $("obProgMsg");
      if (note) { note.textContent = "Saving…"; note.className = "msg"; }
      db.rpc("platform_set_config", { p_key: "onboarding_progress", p_value: prog }).then(function (r) {
        if (r.error) { if (note) { note.textContent = r.error.message; note.className = "msg err"; } return; }
        cfg.onboarding_progress = prog;
        if (note) { note.textContent = "Saved."; note.className = "msg ok"; }
      });
      return;
    }
    if (e.target.closest("#approval")) {
      var on = $("approval").getAttribute("aria-checked") !== "true";
      db.rpc("platform_set_approval", { p_required: on }).then(function (r) { if (r.error) alert(r.error.message); else load(); });
      return;
    }
    var open = e.target.closest("[data-open]");
    if (open) { try { localStorage.setItem("veyora-view-company", open.dataset.open); } catch (x) {} location.href = "settings.html"; return; }
    var trialSave = e.target.closest("[data-trial-save]");
    var trialClear = e.target.closest("[data-trial-clear]");
    if (trialSave || trialClear) {
      var cid = (trialSave || trialClear).dataset.trialSave || (trialSave || trialClear).dataset.trialClear;
      var input = document.querySelector('[data-trial="' + cid + '"]');
      var days = trialClear ? null : Number(input.value);
      if (!trialClear && (input.value === "" || isNaN(days))) { alert("Enter the trial days, or choose Use overall."); return; }
      db.rpc("platform_set_company_trial", { p_company: cid, p_days: days }).then(function (r) {
        if (r.error) alert(r.error.message); else load();
      });
      return;
    }
    var b = e.target.closest("[data-set]"); if (!b) return;
    if (b.dataset.set === "Suspended" && !confirm("Suspend this company? Its staff lose access.")) return;
    db.rpc("platform_set_status", { p_company: b.dataset.id, p_status: b.dataset.set }).then(function (r) { if (r.error) alert(r.error.message); else load(); });
  });
  window.addEventListener("hashchange", function () { if (!$("content").hidden) show(tabFromHash()); });

  db.auth.getSession().then(function (r) {
    var session = r.data.session;
    if (!session) { location.replace("index.html"); return; }
    var nm = (session.user.email || "").split("@")[0];
    $("userName").textContent = nm; $("avatar").textContent = nm.slice(0, 2).toUpperCase();
    return db.from("platform_admins").select("user_id").then(function (a) {
      if (!a.data || !a.data.length) { $("denied").hidden = false; return; }
      $("content").hidden = false;
      return db.from("platform_settings").select("config").single().then(function (c) { cfg = (c.data && c.data.config) || {}; return load(); }).then(function () { show(tabFromHash()); });
    });
  });
})();
