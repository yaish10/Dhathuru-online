/* Approvers & Responsibilities editor, shared by Settings (duties) and HR > Leave & Absence > Settings (leave routing). */
(function () {
  /* HR & Crew > Approvers & Responsibilities (redesigned 2026-10-29). Same saved shape as before:
     { leave: { useManager, routes: [{ applies, approvers: [uuid] }], fallback: [uuid] }, duties: { key: { people, backup } } }.
     Adds a live "who approves this person?" tester that follows the same rules as the database (leave_approver_ids). */
  function render(el, env) {
    var ctx = env.ctx, header = env.header, edit = env.edit, mode = env.mode || "all";
    var esc = env.esc, optList = env.optList, memberName = env.memberName, CREW_GROUPS = env.crewGroups, saveSetting = env.save;
    function $(id) { return document.getElementById(id); }
    var company = env.company();
    var saved = company.settings && company.settings[ctx.key];
    var cfg = saved && typeof saved === "object" ? JSON.parse(JSON.stringify(saved)) : {};
    cfg.leave = cfg.leave || { useManager: false, routes: [], fallback: [] };
    cfg.leave.routes = cfg.leave.routes || []; cfg.leave.fallback = cfg.leave.fallback || [];
    cfg.duties = cfg.duties || {};
    var base = JSON.stringify(cfg), openPop = null, who = null, showAllDuties = false;
    el.innerHTML = header(ctx) + '<p class="msg">Loading people…</p>';
    env.orgLoad().then(function (d) {
      var titleOf = {}; d.titles.forEach(function (t) { titleOf[t.id] = t; });
      var deptOf = {}; d.depts.forEach(function (x) { deptOf[x.id] = x.name; });
      var people = d.members.filter(function (m) { return m.active; }).map(function (m) {
        var t = titleOf[m.job_title_id];
        return { id: m.user_id, name: memberName(m, d.by), m: m, role: (t && t.title) || (m.role.charAt(0).toUpperCase() + m.role.slice(1)), group: t && t.crew_group || null };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      var P = {}; people.forEach(function (p) { P[p.id] = p; });
      var applies = [["All staff", "All staff"]].concat([],
        d.depts.map(function (x) { return ["Dept:" + x.id, "Department: " + x.name]; }));
      var appliesText = {}; applies.forEach(function (a) { appliesText[a[0]] = a[1]; });
      var wf = (env.company().settings && company.settings["8_leave_approval_workflow"]) || {};
      var roleName = wf.approver || "HR";
      var HUES = [["#2f9bff", "#1677e8"], ["#7c5cff", "#5a3de0"], ["#18b26b", "#0e8a50"], ["#ff9f43", "#e8750f"], ["#ec5b8d", "#c93670"], ["#14b8c4", "#0b8e99"]];
      function hue(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return HUES[h % HUES.length]; }
      function initials(n) { var w = n.trim().split(/\s+/); return ((w[0] || "?").charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : "")).toUpperCase(); }
      function av(id, size) {
        var p = P[id], c = hue(id || "x");
        return '<span class="ap-av" style="--s:' + (size || 34) + 'px;background:linear-gradient(135deg,' + c[0] + ',' + c[1] + ')" title="' + esc(p ? p.name : "Former member") + '">' + esc(p ? initials(p.name) : "?") + '</span>';
      }
      function matches(a, p) {
        if (a === "All staff") return true;
        if (a.indexOf("Dept:") === 0) return p.m.department_id === a.slice(5);
        return false;
      }
      /* The same order of decisions as leave_approver_ids in the database. */
      function resolve(p) {
        var out = [], steps = [], mgr = p.m.manager_id;
        if (cfg.leave.useManager && mgr && P[mgr]) { out.push(mgr); steps.push({ k: "mgr", title: "Reporting manager", ids: [mgr] }); }
        var hit = -1;
        for (var i = 0; i < cfg.leave.routes.length; i++) if (matches(cfg.leave.routes[i].applies, p)) { hit = i; break; }
        if (hit >= 0) { var ids = cfg.leave.routes[hit].approvers || []; out = out.concat(ids); steps.push({ k: "rule", title: "Rule " + (hit + 1) + " · " + (appliesText[cfg.leave.routes[hit].applies] || "Rule"), ids: ids }); }
        else if (cfg.leave.fallback.length) { out = out.concat(cfg.leave.fallback); steps.push({ k: "fallback", title: "No rule matches, so the fallback people", ids: cfg.leave.fallback }); }
        var seen = {}; out = out.filter(function (u) { if (u === p.id || !P[u] || seen[u]) return false; return (seen[u] = true); });
        return { ids: out, steps: steps, hit: hit };
      }
      function dirty() { return JSON.stringify(cfg) !== base; }
      function listAt(path) {
        var s = path.split(".");
        if (s[0] === "route") return cfg.leave.routes[Number(s[1])].approvers = cfg.leave.routes[Number(s[1])].approvers || [];
        if (s[0] === "fallback") return cfg.leave.fallback;
        var dt = cfg.duties[s[1]] = cfg.duties[s[1]] || { people: [], backup: null }; dt.people = dt.people || []; return dt.people;
      }
      function stack(path, list) {
        var pop = "";
        if (edit && openPop === path) {
          var free = people.filter(function (p) { return list.indexOf(p.id) < 0; });
          pop = '<div class="ap-pop" role="dialog" aria-label="Add a person"><input type="search" class="ap-q" placeholder="Search people…" aria-label="Search people" autocomplete="off">' +
            '<ul>' + (free.length ? free.map(function (p) { return '<li><button type="button" data-pick="' + esc(p.id) + '" data-path="' + path + '" data-name="' + esc(p.name.toLowerCase() + " " + p.role.toLowerCase()) + '">' + av(p.id, 30) + '<span><strong>' + esc(p.name) + '</strong><small>' + esc(p.role) + '</small></span></button></li>'; }).join("") : '<li class="ap-none">Everyone is already added.</li>') + '</ul></div>';
        }
        return '<div class="ap-ppl">' + list.map(function (u, i) {
          var p = P[u];
          return '<span class="ap-person">' + av(u, 34) + '<span class="ap-pn"><strong>' + esc(p ? p.name : "Former member") + '</strong><small>' + esc(p ? p.role : "No longer active") + '</small></span>' +
            (edit ? '<button type="button" class="ap-x" data-x="' + path + '" data-i="' + i + '" aria-label="Remove ' + esc(p ? p.name : "person") + '">×</button>' : "") + '</span>';
        }).join("") + (edit ? '<span class="ap-addwrap"><button type="button" class="ap-add" data-pop="' + path + '"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add person</button>' + pop + '</span>' : (!list.length ? '<small class="note">Nobody yet</small>' : "")) + '</div>';
      }
      function count(a) { return people.filter(function (p) { return matches(a, p); }).length; }
      function coverage() {
        var gaps = people.filter(function (p) { return p.m.role !== "owner" && !resolve(p).ids.length; });
        return gaps;
      }
      function tester() {
        if (!who || !P[who]) who = people.length ? people[0].id : null;
        if (!who) return '<p class="note">No staff yet.</p>';
        var p = P[who], r = resolve(p);
        var opts = people.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === who ? " selected" : "") + '>' + esc(x.name) + '</option>'; }).join("");
        var steps = r.steps.map(function (s) {
          return '<li class="ap-step ap-' + s.k + '"><span class="ap-dot"></span><div><strong>' + esc(s.title) + '</strong><div class="ap-mini">' + (s.ids.length ? s.ids.map(function (u) { return '<span class="ap-pill">' + av(u, 22) + esc(P[u] ? P[u].name : "Former member") + '</span>'; }).join("") : '<small class="note">Nobody named</small>') + '</div></div></li>';
        }).join("");
        if (!r.ids.length) steps += '<li class="ap-step ap-role"><span class="ap-dot"></span><div><strong>No named approver</strong><small class="note">The ' + esc(roleName) + ' role in Leave Approval Workflow decides.</small></div></li>';
        return '<div class="ap-t1"><h4>Who approves?</h4><div class="ap-lab">If this person asks for leave…</div><div class="ap-whoRow">' + av(who, 40) + '<select id="apWho" aria-label="Person">' + opts + '</select></div>' +
          '<p class="ap-meta">' + esc(p.role) + (p.group ? " · " + esc(p.group) : "") + (p.m.department_id && deptOf[p.m.department_id] ? " · " + esc(deptOf[p.m.department_id]) : "") + '</p>' +
          '</div><ol class="ap-steps">' + steps + '</ol>' +
          '<div class="ap-result ' + (r.ids.length ? "ok" : "warn") + '">' + (r.ids.length ? '<strong>' + r.ids.length + (r.ids.length === 1 ? " person can" : " people can") + ' approve.</strong> Any one of them is enough' + (r.ids.length > 1 ? "; the first decision settles it." : ".") : '<strong>Nobody is named for this person.</strong> The role rule applies.') + ' The owner can always step in.</div>';
      }
      function draw() {
        var gaps = coverage(), ruleCount = cfg.leave.routes.length;
        var namedAll = {}; cfg.leave.routes.forEach(function (r) { (r.approvers || []).forEach(function (u) { namedAll[u] = 1; }); }); cfg.leave.fallback.forEach(function (u) { namedAll[u] = 1; });
        var dis = edit ? "" : " disabled";
        var duties = window.VEYORA_DUTIES.filter(function (du) { return showAllDuties || du.live === true || ((cfg.duties[du.k] || {}).people || []).length; });
        el.innerHTML = header(ctx) + '<div class="ap">' +
          (mode === "duties" ? '<div class="ap-moved"><div class="ap-ico"><svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></div><div class="grow"><strong>Leave approvals moved</strong><small>Leave types, the approval workflow, who approves and leave notifications are now together in HR → Leave &amp; Absence → Settings.</small></div><a class="ap-new" href="hr.html#leave/settings">Open leave settings</a></div>' : ('<section class="ap-hero"><div><h3>Leave approvals</h3><p>A request goes to the reporting manager (if on), then the first rule that matches the person, otherwise the fallback people. <strong>Any one</strong> of them can decide it. The owner can always step in.</p></div>' +
            '<div class="ap-flow" aria-hidden="true"><span>Request</span><i></i><span>Manager</span><i></i><span>Rule or fallback</span><i></i><span class="end">Decision</span></div>' +
            '<div class="ap-kpis"><span class="ap-kpi"><b>' + ruleCount + '</b> rule' + (ruleCount === 1 ? "" : "s") + '</span><span class="ap-kpi"><b>' + Object.keys(namedAll).length + '</b> approver' + (Object.keys(namedAll).length === 1 ? "" : "s") + '</span>' +
            '<span class="ap-kpi ' + (gaps.length ? "warn" : "ok") + '">' + (gaps.length ? '<b>' + gaps.length + '</b> staff with no named approver' : "Everyone has an approver") + '</span></div></section>')) +
          '<div class="ap-cols' + (mode === "all" || mode === "leave" ? "" : " one") + '"><div class="ap-main">' +
          (mode === "duties" ? "" : (
            '<div class="ap-pair">' + '<div class="ap-card ap-mgr"><div class="ap-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/></svg></div><div class="grow"><strong>Include the reporting manager</strong><small>' + people.filter(function (p) { return p.m.manager_id; }).length + ' of ' + people.length + ' staff have a manager set.</small></div>' +
              '<button type="button" class="sw" role="switch" id="apMgr" aria-checked="' + !!cfg.leave.useManager + '"' + dis + ' aria-label="Include reporting manager"></button></div>' + '<div class="ap-card ap-fb"><div class="ap-rt"><span class="ap-n fb">↓</span><strong>Fallback</strong><small class="note">Used when no rule matches the person.</small></div>' + stack("fallback", cfg.leave.fallback) + '</div>' + '</div>' +
            '<div class="ap-head"><h4>Rules</h4><small>The first matching rule wins. Drag order with the arrows.</small></div>' +
            '<div class="ap-rules">' + (cfg.leave.routes.length ? cfg.leave.routes.map(function (r, i) {
              r.approvers = r.approvers || [];
              return '<div class="ap-card ap-rule"><div class="ap-rt"><span class="ap-n">' + (i + 1) + '</span>' +
                '<select data-route="' + i + '" aria-label="Applies to"' + dis + '>' + applies.map(function (a) { return '<option value="' + esc(a[0]) + '"' + (a[0] === r.applies ? " selected" : "") + '>' + esc(a[1]) + '</option>'; }).join("") + '</select>' +
                '<span class="ap-count">' + count(r.applies) + ' staff</span>' +
                (edit ? '<span class="ap-acts"><button type="button" class="ap-ib" data-up="' + i + '" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '><svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg></button><button type="button" class="ap-ib" data-down="' + i + '" aria-label="Move down"' + (i === ruleCount - 1 ? " disabled" : "") + '><svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6"/></svg></button><button type="button" class="ap-ib danger" data-delroute="' + i + '" aria-label="Delete rule"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12"/></svg></button></span>' : "") + '</div>' +
                stack("route." + i, r.approvers) + '</div>';
            }).join("") : '<div class="ap-empty">No rules yet. Everyone uses the fallback people below.</div>') + '</div>' +
            (edit ? '<button type="button" class="ap-new" id="apAddRule"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New rule</button>' : ""))) +
          (mode === "leave" ? "" : ('<div class="ap-head"><h4>Responsibilities</h4><small>Named people for other duties. Crew assignments, Maintenance and Payroll are in use.</small></div>' +
            '<div class="ap-duties">' + duties.map(function (du) {
              var dt = cfg.duties[du.k] || { people: [], backup: null }, live = du.live === true;
              return '<div class="ap-card ap-duty"><div class="ap-rt"><strong>' + esc(du.l) + '</strong><span class="tag tag-' + (live ? "changed" : "soon") + '">' + (live ? "Active" : "Later") + '</span></div><small class="note">' + esc(du.d) + '</small>' +
                stack("duty." + du.k, dt.people || []) +
                '<label class="ap-bk">Backup<select data-backup="' + du.k + '" aria-label="Backup for ' + esc(du.l) + '"' + dis + '>' + optList(people.map(function (p) { return [p.id, p.name]; }), dt.backup, "No backup") + '</select></label></div>';
            }).join("") + '</div>' +
            '<button type="button" class="ap-link" id="apMore">' + (showAllDuties ? "Show only active duties" : "Show all " + window.VEYORA_DUTIES.length + " duties") + '</button>')) + '</div>' +
          (mode === "duties" ? "" : ('<aside class="ap-side"><div class="ap-card ap-test">' + tester() + '</div>' +
            (gaps.length ? '<div class="ap-card ap-gaps"><strong>Not covered by a named approver</strong><small class="note">The ' + esc(roleName) + ' role decides for these people. Add a rule or fallback to cover them.</small><div class="ap-mini">' + gaps.slice(0, 8).map(function (p) { return '<span class="ap-pill">' + av(p.id, 22) + esc(p.name) + '</span>'; }).join("") + (gaps.length > 8 ? '<small class="note">+' + (gaps.length - 8) + ' more</small>' : "") + '</div></div>' : "") +
          '</aside>')) + '</div></div>' +
          (edit ? '<div class="ap-bar' + (dirty() ? " on" : "") + '" role="status"><span id="apMsg" class="msg">Unsaved changes</span><button type="button" class="ghost" id="apDiscard">Discard</button><button class="save" type="button" id="apSave"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>Save changes</button></div>' : '<p class="msg">Only owners, admins and HR can change approvers.</p>');
        wire();
      }
      function wire() {
        var back = el.querySelector("[data-back]"); if (back) back.addEventListener("click", ctx.onBack);
        var wsel = $("apWho"); if (wsel) wsel.addEventListener("change", function () { who = wsel.value; openPop = null; draw(); });
        var more = $("apMore"); if (more) more.addEventListener("click", function () { showAllDuties = !showAllDuties; draw(); });
        if (!edit) return;
        if ($("apMgr")) $("apMgr").addEventListener("click", function () { cfg.leave.useManager = !cfg.leave.useManager; draw(); });
        if ($("apAddRule")) $("apAddRule").addEventListener("click", function () { cfg.leave.routes.push({ applies: "All staff", approvers: [] }); openPop = "route." + (cfg.leave.routes.length - 1); draw(); });
        [].forEach.call(el.querySelectorAll("[data-route]"), function (s) { s.addEventListener("change", function () { cfg.leave.routes[Number(s.dataset.route)].applies = s.value; draw(); }); });
        [].forEach.call(el.querySelectorAll("[data-delroute]"), function (b) { b.addEventListener("click", function () { cfg.leave.routes.splice(Number(b.dataset.delroute), 1); openPop = null; draw(); }); });
        [].forEach.call(el.querySelectorAll("[data-up]"), function (b) { b.addEventListener("click", function () { var i = Number(b.dataset.up), r = cfg.leave.routes; var t = r[i - 1]; r[i - 1] = r[i]; r[i] = t; openPop = null; draw(); }); });
        [].forEach.call(el.querySelectorAll("[data-down]"), function (b) { b.addEventListener("click", function () { var i = Number(b.dataset.down), r = cfg.leave.routes; var t = r[i + 1]; r[i + 1] = r[i]; r[i] = t; openPop = null; draw(); }); });
        [].forEach.call(el.querySelectorAll("[data-pop]"), function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); openPop = openPop === b.dataset.pop ? null : b.dataset.pop; draw(); }); });
        [].forEach.call(el.querySelectorAll("[data-pick]"), function (b) { b.addEventListener("click", function () { listAt(b.dataset.path).push(b.dataset.pick); draw(); }); });
        [].forEach.call(el.querySelectorAll("[data-x]"), function (b) { b.addEventListener("click", function () { listAt(b.dataset.x).splice(Number(b.dataset.i), 1); draw(); }); });
        [].forEach.call(el.querySelectorAll("[data-backup]"), function (s) { s.addEventListener("change", function () { var dt = cfg.duties[s.dataset.backup] = cfg.duties[s.dataset.backup] || { people: [] }; dt.backup = s.value || null; draw(); }); });
        var q = el.querySelector(".ap-q");
        if (q) {
          q.focus();
          q.addEventListener("input", function () { var t = q.value.trim().toLowerCase(); [].forEach.call(el.querySelectorAll(".ap-pop [data-name]"), function (b) { b.parentNode.hidden = !!t && b.dataset.name.indexOf(t) < 0; }); });
          q.addEventListener("keydown", function (e) { if (e.key === "Escape") { openPop = null; draw(); } });
          el.querySelector(".ap-pop").addEventListener("click", function (e) { e.stopPropagation(); });
        }
        $("apDiscard").addEventListener("click", function () { cfg = JSON.parse(base); openPop = null; draw(); });
        $("apSave").addEventListener("click", function () {
          var m = $("apMsg"); m.textContent = "Saving…"; m.className = "msg";
          cfg.leave.routes = cfg.leave.routes.filter(function (r) { return r.approvers && r.approvers.length; });
          saveSetting(ctx.key, cfg).then(function () { base = JSON.stringify(cfg); draw(); var m2 = $("apMsg"); m2.textContent = "Saved."; m2.className = "msg ok"; el.querySelector(".ap-bar").classList.add("on"); setTimeout(function () { var b = el.querySelector(".ap-bar"); if (b && !dirty()) b.classList.remove("on"); }, 1800); })
            .catch(function (e) { m.textContent = e.message; m.className = "msg err"; });
        });
      }
      if (el._apDoc) document.removeEventListener("click", el._apDoc);
      el._apDoc = function () { if (!el.isConnected) { document.removeEventListener("click", el._apDoc); return; } if (openPop) { openPop = null; draw(); } };
      document.addEventListener("click", el._apDoc);
      draw();
    }).catch(function (e) { el.innerHTML = header(ctx) + '<p class="msg err">' + esc(e.message) + '</p>'; });
  }
  window.VeyoraApprovers = { render: render };
})();
