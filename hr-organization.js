/* Cursor 2026-10-23: HR page — Departments & Designations (hr.html#organization).
   Cursor 2026-10-23: no crew groups — organise by department only. */
(function () {
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + "</svg>"; }
  var I = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    building: '<path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6"/>',
    badge: '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/>',
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    check: '<path d="m5 12 5 5 9-10"/>'
  };
  function defNames(title) {
    var spec = window.VEYORA_DEFS && window.VEYORA_DEFS[title];
    if (!spec) return [];
    var base = spec.base || spec, def = base.def || [];
    return def.map(function (r) { return typeof r === "string" ? r : (r && (r.name || r.title)); }).filter(Boolean);
  }
  function options(list, cur, blank) {
    return (blank != null ? '<option value="">' + esc(blank) + "</option>" : "") +
      list.map(function (p) {
        var v = Array.isArray(p) ? p[0] : p, t = Array.isArray(p) ? p[1] : p;
        return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + ">" + esc(t) + "</option>";
      }).join("");
  }

  window.VeyoraHrOrganization = {
    render: function (api) {
      var model = api.model, ctx = api.ctx, state = api.orgState || (api.orgState = { tab: "depts", q: "", showInactive: false });
      var depts = model.orgDepts || model.depts || [];
      var titles = model.orgTitles || model.titles || [];
      var staff = model.staff || [];
      /* Cursor 2026-10-23: owners (canAll) edit departments and designations. */
      var canEditDept = !!(ctx && (ctx.canAll || ctx.isAdmin || ctx.isPlatform));
      var canEditTitle = !!(ctx && (ctx.canAll || ctx.isAdmin || ctx.canHr || ctx.isPlatform));
      var canEdit = canEditDept || canEditTitle;
      var q = (state.q || "").toLowerCase();

      function countDept(id) {
        return staff.filter(function (s) { return s.deptId === id && s.active; }).length;
      }
      function countTitle(id) {
        return staff.filter(function (s) { return s.titleId === id && s.active; }).length;
      }
      function headName(uid) {
        if (!uid) return "";
        var s = staff.filter(function (x) { return x.uid === uid; })[0];
        return s ? s.name : "";
      }
      function deptById(id) {
        return depts.filter(function (x) { return x.id === id; })[0];
      }
      function headOptions() {
        return staff.filter(function (s) { return s.active; }).map(function (s) {
          return [s.uid, s.name + (s.position ? " · " + s.position : "")];
        });
      }
      function headSelect(deptId) {
        var d = deptById(deptId);
        if (!d) return '<span class="org-muted">Set a department first</span>';
        if (!canEditDept) return esc(headName(d.head_user_id) || "—");
        return '<select class="org-head" data-dept-head="' + esc(d.id) + '" aria-label="Department head for ' + esc(d.name) + '">' +
          options(headOptions(), d.head_user_id || "", "No head") + "</select>";
      }
      function deptName(id) {
        var d = depts.filter(function (x) { return x.id === id; })[0];
        return d ? d.name : "";
      }

      var dList = depts.filter(function (d) {
        if (!state.showInactive && d.active === false) return false;
        if (q && d.name.toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      var tList = titles.filter(function (t) {
        if (!state.showInactive && t.active === false) return false;
        if (!q) return true;
        var hay = (t.title + " " + deptName(t.department_id)).toLowerCase();
        return hay.indexOf(q) >= 0;
      });

      function tone(name) {
        var n = 0, t = String(name || "");
        for (var i = 0; i < t.length; i++) n = (n + t.charCodeAt(i)) % 6;
        return n;
      }
      function mark(name) {
        var parts = String(name || "").split(/\s+/).filter(Boolean);
        return ((parts[0] || "?").charAt(0) + (parts[1] ? parts[1].charAt(0) : "")).toUpperCase();
      }
      var deptN = depts.filter(function (d) { return d.active !== false; }).length;
      var titleN = titles.filter(function (t) { return t.active !== false; }).length;
      var linkedN = staff.filter(function (s) { return s.active && (s.deptId || s.titleId); }).length;
      var kpis =
        '<div class="org2-tiles">' +
          '<button type="button" class="org2-tile' + (state.tab === "depts" ? " on" : "") + '" data-org-tab="depts"><span class="ic">' + icon(I.building) + '</span><strong>' + deptN + '</strong><small>Departments</small></button>' +
          '<button type="button" class="org2-tile' + (state.tab === "titles" ? " on" : "") + '" data-org-tab="titles"><span class="ic">' + icon(I.badge) + '</span><strong>' + titleN + '</strong><small>Designations</small></button>' +
          '<div class="org2-tile static"><span class="ic">' + icon(I.people) + '</span><strong>' + linkedN + '</strong><small>Staff linked</small></div>' +
        "</div>";

      var tabs =
        '<div class="org-tabs" role="tablist">' +
          '<button type="button" role="tab" class="' + (state.tab === "depts" ? "on" : "") + '" data-org-tab="depts" aria-selected="' + (state.tab === "depts") + '">Departments <b>' + dList.length + '</b></button>' +
          '<button type="button" role="tab" class="' + (state.tab === "titles" ? "on" : "") + '" data-org-tab="titles" aria-selected="' + (state.tab === "titles") + '">Designations <b>' + tList.length + '</b></button>' +
        "</div>";

      var actions =
        (state.tab === "depts" && canEditDept
          ? '<button type="button" class="primary-btn" id="orgAddDept">' + icon(I.plus) + " Add department</button>"
          : "") +
        (state.tab === "titles" && canEditTitle
          ? '<button type="button" class="primary-btn" id="orgAddTitle">' + icon(I.plus) + " Add designation</button>"
          : "") +
        (canEdit ? '<button type="button" class="btn-soft" id="orgSeed">Load defaults</button>' : "");

      var toolbar =
        '<div class="org-bar">' +
          '<label class="fsearch">' + icon(I.search) + '<input type="search" id="orgQ" placeholder="' + (state.tab === "depts" ? "Search departments" : "Search designations or departments") + '" value="' + esc(state.q) + '" aria-label="Search"></label>' +
          '<label class="org-chk"><input type="checkbox" id="orgInactive"' + (state.showInactive ? " checked" : "") + "> Show inactive</label>" +
        "</div>";

      function titlesOf(deptId) {
        return titles.filter(function (t) { return t.department_id === deptId && (state.showInactive || t.active !== false); });
      }
      function stack(deptId) {
        var mine = staff.filter(function (x) { return x.deptId === deptId && x.active; }), show = mine.slice(0, 4);
        return '<span class="org2-stack">' + show.map(function (x) { return '<i title="' + esc(x.name) + '">' + esc(mark(x.name)) + '</i>'; }).join("") + (mine.length > 4 ? '<i class="more">+' + (mine.length - 4) + '</i>' : "") + '</span>';
      }
      function titleTile(t) {
        return '<div class="org2-title' + (t.active === false ? " dim" : "") + '"><span class="ic">' + icon(I.badge) + '</span><div class="tx"><strong>' + esc(t.title) + '</strong><small>' + countTitle(t.id) + ' staff' + (t.active === false ? " · inactive" : "") + '</small></div>' +
          (canEditTitle ? '<button type="button" class="org-edit" data-edit-title="' + esc(t.id) + '">Edit</button>' : "") + '</div>';
      }
      var body;
      if (state.tab === "depts") {
        body = !dList.length
          ? '<div class="org-empty"><h3>No departments yet</h3><p>Add Operations, Fleet, HR, or load the company defaults.' +
            (!canEditDept ? " Ask an admin to create departments." : "") + "</p>" +
            (canEditDept ? '<button type="button" class="primary-btn" id="orgAddDept2">' + icon(I.plus) + " Add department</button>" : "") + "</div>"
          : '<div class="org2-grid">' + dList.map(function (d, i) {
            var ts = titlesOf(d.id), n = countDept(d.id), dim = d.active === false;
            return '<article class="org2-dept' + (dim ? " dim" : "") + '" style="--i:' + Math.min(i, 14) + '">' +
              '<header><span class="org-av org-tone-' + tone(d.name) + '" aria-hidden="true">' + esc(mark(d.name)) + '</span><div class="nm"><strong>' + esc(d.name) + '</strong><small>' + ts.length + ' designation' + (ts.length === 1 ? "" : "s") + '</small></div>' +
              '<span class="chip ' + (dim ? "st-inactive" : "st-active") + '">' + (dim ? "Inactive" : "Active") + '</span></header>' +
              '<div class="org2-count"><b>' + n + '</b><span>staff</span>' + stack(d.id) + '</div>' +
              '<div class="org2-roles">' + (ts.length ? ts.slice(0, 6).map(function (t) { return '<span>' + esc(t.title) + '</span>'; }).join("") + (ts.length > 6 ? '<span class="more">+' + (ts.length - 6) + '</span>' : "") : '<em>No designations yet</em>') + '</div>' +
              '<div class="org2-head"><small>Department head</small>' + headSelect(d.id) + '</div>' +
              (canEditDept ? '<footer><button type="button" class="org-edit" data-edit-dept="' + esc(d.id) + '">Edit department</button></footer>' : "") + '</article>';
          }).join("") + "</div>";
      } else {
        var groups = [], seen = {};
        tList.forEach(function (t) { var k = t.department_id || ""; if (!seen[k]) { seen[k] = { id: k, items: [] }; groups.push(seen[k]); } seen[k].items.push(t); });
        groups.sort(function (a, b) { return !a.id ? 1 : !b.id ? -1 : deptName(a.id).localeCompare(deptName(b.id)); });
        body = !tList.length
          ? '<div class="org-empty"><h3>No designations yet</h3><p>Add Captain, Deckhand, Engineer, or load defaults.</p>' +
            (canEditTitle ? '<button type="button" class="primary-btn" id="orgAddTitle2">' + icon(I.plus) + " Add designation</button>" : "") + "</div>"
          : '<div class="org2-groups">' + groups.map(function (g) {
            var dn = g.id ? deptName(g.id) : "";
            return '<section class="org2-group"><header><span class="org-av org-tone-' + tone(dn || "none") + '" aria-hidden="true">' + esc(mark(dn || "No dept")) + '</span><div class="nm"><strong>' + esc(dn || "No department") + '</strong><small>' + g.items.length + ' designation' + (g.items.length === 1 ? "" : "s") + '</small></div>' +
              (g.id ? '<div class="org2-head inline"><small>Head</small>' + headSelect(g.id) + '</div>' : "") + '</header>' +
              '<div class="org2-titles">' + g.items.map(titleTile).join("") + '</div></section>';
          }).join("") + "</div>";
      }

      return '<div class="org-board org2">' +
        '<header class="org2-hero"><div class="org2-hero-l"><small>Organization</small><h2>Departments &amp; Designations</h2>' +
        '<p>' + (state.tab === "depts" ? "Each department has one head. Every designation inside it shares that person." : "Designations grouped by department. Heads belong to the department.") + '</p>' +
        '<div class="org-hero-acts">' + actions + "</div></div>" + kpis + "</header>" +
        tabs + toolbar + body +
        '<p class="msg" id="orgMsg" role="status"></p></div>';
    },

    bind: function (api) {
      var $ = api.$, db = api.db, company = api.company, model = api.model, ctx = api.ctx;
      var state = api.orgState || (api.orgState = { tab: "depts", q: "", showInactive: false });
      var openModal = api.openModal, closeModal = api.closeModal, say = api.sayInline || api.say;
      var optionsFn = api.options || options;
      var canEdit = !!(ctx && (ctx.isAdmin || ctx.canHr || ctx.isPlatform));

      function flash(t, k) {
        var m = $("orgMsg");
        if (m) { m.textContent = t; m.className = "msg " + (k || ""); }
        if (api.say) api.say(t, k);
      }
      function reloadOrg() {
        return Promise.all([
          db.from("departments").select("id, name, head_user_id, active").eq("company_id", company.id).order("name"),
          db.from("job_titles").select("id, title, department_id, crew_group, active").eq("company_id", company.id).order("title")
        ]).then(function (r) {
          if (r[0].error) throw new Error(r[0].error.message);
          if (r[1].error) throw new Error(r[1].error.message);
          model.orgDepts = r[0].data || [];
          model.orgTitles = r[1].data || [];
          model.depts = model.orgDepts.filter(function (d) { return d.active !== false; });
          model.titles = model.orgTitles.filter(function (t) { return t.active !== false; });
          if (api.render) api.render();
        });
      }
      api.reloadOrg = reloadOrg;

      [].forEach.call(document.querySelectorAll("[data-org-tab]"), function (b) {
        b.addEventListener("click", function () { state.tab = b.getAttribute("data-org-tab"); if (api.render) api.render(); });
      });
      if ($("orgQ")) $("orgQ").addEventListener("input", function () {
        state.q = $("orgQ").value.trim();
        var pos = $("orgQ").selectionStart;
        if (api.render) api.render();
        var n = $("orgQ"); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
      });
      if ($("orgInactive")) $("orgInactive").addEventListener("change", function () {
        state.showInactive = $("orgInactive").checked;
        if (api.render) api.render();
      });

      function openDeptModal(row) {
        var staff = (model.staff || []).filter(function (s) { return s.active; });
        var heads = staff.map(function (s) { return [s.uid, s.name + (s.position ? " · " + s.position : "")]; });
        openModal(
          "<h2>" + (row ? "Edit department" : "Add department") + "</h2>" +
          '<p class="note">Shown on employee records and in filters.</p>' +
          '<div class="cards">' +
            '<div class="fld wide"><label for="oName">Name</label><input id="oName" maxlength="80" value="' + esc(row ? row.name : "") + '" placeholder="e.g. Operations"></div>' +
            '<div class="fld"><label for="oHead">Department head</label><select id="oHead">' + optionsFn(heads, row && row.head_user_id || "", "No head") + "</select></div>" +
            (row ? '<div class="fld"><label for="oActive">Status</label><select id="oActive">' + optionsFn([["1", "Active"], ["0", "Inactive"]], row.active === false ? "0" : "1") + "</select></div>" : "") +
          "</div>" +
          '<p class="msg" id="mMsg" role="status"></p>' +
          '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button>' +
          (row ? '<button type="button" class="ghost" id="oDel" style="margin-right:auto;color:#c0293b">Delete</button>' : "") +
          '<button type="button" class="save" id="oGo">Save</button></div>',
          true
        );
        function mSay(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
        $("oGo").addEventListener("click", function () {
          var name = $("oName").value.trim();
          if (name.length < 1) { mSay("Enter a name.", "err"); return; }
          var patch = { name: name, head_user_id: $("oHead").value || null };
          if (row && $("oActive")) patch.active = $("oActive").value === "1";
          mSay("Saving…");
          var job = row
            ? db.from("departments").update(patch).eq("id", row.id).eq("company_id", company.id)
            : db.from("departments").insert({ company_id: company.id, name: patch.name, head_user_id: patch.head_user_id });
          job.then(function (r) {
            if (r.error) { mSay(r.error.message, "err"); return; }
            closeModal();
            reloadOrg().catch(function (e) { flash(e.message, "err"); });
          });
        });
        if ($("oDel")) $("oDel").addEventListener("click", function () {
          if (!window.confirm("Delete department “" + row.name + "”? Staff keep their records; the link is cleared.")) return;
          db.from("departments").delete().eq("id", row.id).eq("company_id", company.id).then(function (r) {
            if (r.error) { mSay(r.error.message, "err"); return; }
            closeModal();
            reloadOrg().catch(function (e) { flash(e.message, "err"); });
          });
        });
      }

      function saveDeptHead(deptId, userId) {
        return db.from("departments").update({ head_user_id: userId || null }).eq("id", deptId).eq("company_id", company.id).then(function (r) {
          if (r.error) throw new Error(r.error.message);
        });
      }
      [].forEach.call(document.querySelectorAll("[data-dept-head]"), function (sel) {
        sel.addEventListener("change", function () {
          flash("Saving department head…");
          saveDeptHead(sel.getAttribute("data-dept-head"), sel.value).then(function () {
            return reloadOrg();
          }).then(function () { flash("Department head saved.", "ok"); })
            .catch(function (e) { flash(e.message || String(e), "err"); });
        });
      });

      function openTitleModal(row) {
        var depts = (model.orgDepts || model.depts || []).filter(function (d) { return d.active !== false; });
        var heads = (model.staff || []).filter(function (s) { return s.active; }).map(function (s) {
          return [s.uid, s.name + (s.position ? " · " + s.position : "")];
        });
        var canHead = !!(ctx && (ctx.canAll || ctx.isAdmin || ctx.isPlatform));
        var startDept = row && row.department_id || "";
        var startHead = (depts.filter(function (d) { return d.id === startDept; })[0] || {}).head_user_id || "";
        openModal(
          "<h2>" + (row ? "Edit designation" : "Add designation") + "</h2>" +
          '<p class="note">Link each designation to a department, then choose who leads that department.</p>' +
          '<div class="cards">' +
            '<div class="fld"><label for="tName">Title</label><input id="tName" maxlength="80" value="' + esc(row ? row.title : "") + '" placeholder="e.g. Captain"></div>' +
            '<div class="fld"><label for="tDept">Department</label><select id="tDept">' + optionsFn(depts.map(function (d) { return [d.id, d.name]; }), startDept, "Select department") + "</select></div>" +
            '<div class="fld"><label for="tHead">Department head</label><select id="tHead"' + (canHead ? "" : " disabled") + '>' + optionsFn(heads, startHead, "No head") + "</select>" +
            '<small class="hint">Saved on the department, so every designation in it shares this head.</small></div>' +
            (row ? '<div class="fld"><label for="tActive">Status</label><select id="tActive">' + optionsFn([["1", "Active"], ["0", "Inactive"]], row.active === false ? "0" : "1") + "</select></div>" : "") +
          "</div>" +
          '<p class="msg" id="mMsg" role="status"></p>' +
          '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button>' +
          (row ? '<button type="button" class="ghost" id="tDel" style="margin-right:auto;color:#c0293b">Delete</button>' : "") +
          '<button type="button" class="save" id="tGo">Save</button></div>',
          true
        );
        function mSay(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
        if ($("tDept")) $("tDept").addEventListener("change", function () {
          var d = depts.filter(function (x) { return x.id === $("tDept").value; })[0];
          if ($("tHead")) { $("tHead").value = d && d.head_user_id || ""; $("tHead").dispatchEvent(new Event("change", { bubbles: true })); }
        });
        $("tGo").addEventListener("click", function () {
          var title = $("tName").value.trim();
          if (title.length < 1) { mSay("Enter a title.", "err"); return; }
          var patch = {
            title: title,
            department_id: $("tDept").value || null
          };
          if (row && $("tActive")) patch.active = $("tActive").value === "1";
          mSay("Saving…");
          var job = row
            ? db.from("job_titles").update(patch).eq("id", row.id).eq("company_id", company.id)
            : db.from("job_titles").insert({
              company_id: company.id,
              title: patch.title,
              department_id: patch.department_id
            });
          var deptId = patch.department_id;
          var headId = $("tHead") ? ($("tHead").value || null) : null;
          job.then(function (r) {
            if (r.error) { mSay(r.error.message, "err"); return; }
            var next = deptId && canHead ? saveDeptHead(deptId, headId) : Promise.resolve();
            next.then(function () {
              closeModal();
              return reloadOrg();
            }).catch(function (e) { mSay(e.message || String(e), "err"); });
          });
        });
        if ($("tDel")) $("tDel").addEventListener("click", function () {
          if (!window.confirm("Delete designation “" + row.title + "”?")) return;
          db.from("job_titles").delete().eq("id", row.id).eq("company_id", company.id).then(function (r) {
            if (r.error) { mSay(r.error.message, "err"); return; }
            closeModal();
            reloadOrg().catch(function (e) { flash(e.message, "err"); });
          });
        });
      }

      function seedDefaults() {
        flash("Loading defaults…");
        var deptNames = defNames("Department Management");
        if (!deptNames.length) deptNames = ["Operations", "Fleet", "Passenger Services", "HR", "IT", "Finance", "Maintenance"];
        var titleNames = defNames("Job Titles & Positions");
        if (!titleNames.length) {
          titleNames = ["General Manager", "Operations Manager", "Dispatcher", "Captain", "First Mate", "Deckhand", "Engineer", "Ticketing Officer", "Accountant", "HR Officer"];
        }
        var haveD = {};
        (model.orgDepts || model.depts || []).forEach(function (d) { haveD[d.name.toLowerCase()] = true; });
        var haveT = {};
        (model.orgTitles || model.titles || []).forEach(function (t) { haveT[t.title.toLowerCase()] = true; });
        var newD = deptNames.filter(function (n) { return !haveD[n.toLowerCase()]; });
        var newT = titleNames.filter(function (n) { return !haveT[n.toLowerCase()]; });
        var jobs = [];
        if (newD.length) {
          jobs.push(db.from("departments").insert(newD.map(function (n) { return { company_id: company.id, name: n }; }))
            .then(function (r) { if (r.error) throw new Error(r.error.message); }));
        }
        if (newT.length) {
          jobs.push(db.from("job_titles").insert(newT.map(function (n) {
            return { company_id: company.id, title: n };
          })).then(function (r) { if (r.error) throw new Error(r.error.message); }));
        }
        if (!jobs.length) { flash("Defaults already loaded.", "ok"); return; }
        Promise.all(jobs).then(function () { return reloadOrg(); })
          .then(function () { flash("Defaults added.", "ok"); })
          .catch(function (e) { flash(e.message || String(e), "err"); });
      }

      if ($("orgAddDept") || $("orgAddDept2")) {
        [$("orgAddDept"), $("orgAddDept2")].forEach(function (b) {
          if (b) b.addEventListener("click", function () { openDeptModal(null); });
        });
      }
      if ($("orgAddTitle") || $("orgAddTitle2")) {
        [$("orgAddTitle"), $("orgAddTitle2")].forEach(function (b) {
          if (b) b.addEventListener("click", function () { openTitleModal(null); });
        });
      }
      if ($("orgSeed") && canEdit) $("orgSeed").addEventListener("click", seedDefaults);

      [].forEach.call(document.querySelectorAll("[data-edit-dept]"), function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-edit-dept");
          var row = (model.orgDepts || model.depts || []).filter(function (d) { return d.id === id; })[0];
          if (row) openDeptModal(row);
        });
      });
      [].forEach.call(document.querySelectorAll("[data-edit-title]"), function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-edit-title");
          var row = (model.orgTitles || model.titles || []).filter(function (t) { return t.id === id; })[0];
          if (row) openTitleModal(row);
        });
      });
    },

    ensureLoaded: function (api) {
      var model = api.model;
      if (model.orgDepts && model.orgTitles) return Promise.resolve();
      return api.reloadOrg ? api.reloadOrg() : Promise.resolve();
    }
  };
})();
