/* HR > Leave & Absence > Settings: every leave setting in one place.
   Leave types, approval workflow, who approves (routing), leave notifications, weekend and roster display.
   Reuses the Settings editors (settings-engine.js, approvers-ui.js) and saves the same setting keys, so nothing else changes. */
(function () {
  var PILLS = [["types", "Leave types", "Entitlements, paid or unpaid, certificate rules"], ["workflow", "Approval workflow", "Is approval needed, who, reminders"],
    ["approvers", "Approvers & routing", "Who decides which requests"], ["notify", "Notifications", "How leave decisions are announced"], ["roster", "Weekend & roster", "Working days and the roster"]];
  var KEYS = { types: "8_leave_types_and_policies", workflow: "8_leave_approval_workflow", approvers: "8_approvers_and_responsibilities", notify: "11_leave_approval_notifications", roster: "8_duty_roster" };
  var TITLES = { types: "Leave Types & Policies", workflow: "Leave Approval Workflow", notify: "Leave Approval Notifications", roster: "Duty Roster" };

  function render(el, env) {
    var esc = env.esc, company = env.company(), pill = KEYS[env.pill] ? env.pill : "types";
    var edit = env.canHr, admin = env.canAdmin;
    function save(key, val) {
      return env.rpc("set_company_setting", { p_company: company.id, p_key: key, p_value: val }).then(function () {
        company.settings = company.settings || {}; company.settings[key] = val;
      });
    }
    el.innerHTML = '<div class="ls"><nav class="ls-nav" aria-label="Leave settings">' + PILLS.map(function (p) {
      return '<a href="#leave/settings/' + p[0] + '" class="ls-pill' + (p[0] === pill ? " on" : "") + '"' + (p[0] === pill ? ' aria-current="page"' : "") + '><strong>' + esc(p[1]) + '</strong><small>' + esc(p[2]) + '</small></a>';
    }).join("") + '</nav><div class="ls-body" id="lsBody"></div></div>';
    var body = document.getElementById("lsBody");
    var VE = window.VeyoraEngine, defs = window.VEYORA_DEFS || {};
    function engine(key, title, canEdit, help) {
      VE.render(body, { title: title, spec: defs[title], key: key, canEdit: canEdit, embed: true, help: help, value: company.settings ? company.settings[key] : undefined,
        company: company, db: env.db, save: function (v) { return save(key, v); } });
    }
    if (pill === "types") types();
    else if (pill === "workflow") engine(KEYS.workflow, TITLES.workflow, edit, "");
    else if (pill === "notify") {
      engine(KEYS.notify, TITLES.notify, admin, "");
      if (!admin) body.insertAdjacentHTML("afterbegin", '<p class="msg">Only owners and admins can change notification settings. You can see them here.</p>');
    } else if (pill === "approvers") {
      window.VeyoraApprovers.render(body, { ctx: { key: KEYS.approvers }, header: function () { return ""; }, mode: "leave", edit: edit, company: env.company, orgLoad: env.orgLoad,
        memberName: env.memberName, optList: env.optList, esc: esc, crewGroups: ["Captain", "Deck", "Engineering", "Shore", "Other"], save: save });
    } else roster();


    /* Leave types as cards: the same fields and saved shape as the Settings table, laid out so each type reads on its own. */
    function types() {
      var spec = defs[TITLES.types], saved = company.settings && company.settings[KEYS.types];
      var rows = (Array.isArray(saved) ? saved : spec.def || []).map(function (r) { return JSON.parse(JSON.stringify(r)); });
      var dis = edit ? "" : " disabled";
      function num(v) { return v == null || v === "" ? 0 : v; }
      function draw() {
        body.innerHTML = '<div class="lt-head"><div><h3>Leave types</h3><p class="note">What staff can request. Days per year is the yearly entitlement (0 = no limit). The database enforces these rules on the website and in the apps.</p></div></div>' +
          '<div class="lt-grid">' + rows.map(function (r, i) {
            var cert = r.cert || "Not applicable";
            return '<div class="lt-card"><div class="lt-top"><input class="lt-name" data-i="' + i + '" data-k="name" value="' + esc(r.name || "") + '" maxlength="80" placeholder="Leave type" aria-label="Leave type"' + dis + '>' +
              (edit ? '<button type="button" class="ap-ib danger" data-del="' + i + '" aria-label="Remove ' + esc(r.name || "type") + '"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12"/></svg></button>' : "") + '</div>' +
              '<div class="lt-row"><label class="lt-f"><span>Days per year</span><input type="number" min="0" step="1" data-i="' + i + '" data-k="days" value="' + esc(num(r.days)) + '"' + dis + '></label>' +
              '<div class="lt-f"><span>Paid</span><button type="button" class="sw" role="switch" data-i="' + i + '" data-k="paid" aria-checked="' + (r.paid !== false) + '" aria-label="Paid"' + dis + '></button></div>' +
              '<div class="lt-f"><span>Note required</span><button type="button" class="sw" role="switch" data-i="' + i + '" data-k="note" aria-checked="' + !!r.note + '" aria-label="Note required"' + dis + '></button></div></div>' +
              '<div class="lt-cert"><span class="lt-lab">Medical certificate</span><div class="lt-seg" role="radiogroup" aria-label="Medical certificate">' + ["Not applicable", "Optional", "Required"].map(function (o) {
                return '<button type="button" role="radio" aria-checked="' + (cert === o) + '" data-i="' + i + '" data-cert="' + o + '"' + dis + '>' + o + '</button>'; }).join("") + '</div>' +
              (cert === "Optional" ? '<div class="lt-row"><label class="lt-f"><span>Days a year without one</span><input type="number" min="0" data-i="' + i + '" data-k="nocert" value="' + esc(num(r.nocert)) + '"' + dis + '></label>' +
                '<label class="lt-f"><span>Longest stretch without one</span><input type="number" min="0" data-i="' + i + '" data-k="nocertRun" value="' + esc(num(r.nocertRun)) + '"' + dis + '></label></div>' : "") +
              (cert !== "Not applicable" ? '<div class="lt-f lt-inline"><span>Staff must attach the certificate file</span><button type="button" class="sw" role="switch" data-i="' + i + '" data-k="certFile" aria-checked="' + !!r.certFile + '" aria-label="Certificate file required"' + dis + '></button></div>' : "") +
              '</div></div>';
          }).join("") + '</div>' +
          (edit ? '<button type="button" class="ap-new" id="ltAdd"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add leave type</button>' +
            '<div class="ed-foot actions"><span class="msg" id="ltMsg" role="status"></span><button class="save" type="button" id="ltSave"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>Save changes</button></div>' : '<p class="msg">Only owners, admins and HR can change leave types.</p>');
        if (!edit) return;
        [].forEach.call(body.querySelectorAll("input[data-k]"), function (e) { e.addEventListener("input", function () { var r = rows[Number(e.dataset.i)]; r[e.dataset.k] = e.type === "number" ? (e.value === "" ? "" : parseFloat(e.value)) : e.value; }); });
        [].forEach.call(body.querySelectorAll(".sw[data-k]"), function (b) { b.addEventListener("click", function () { var r = rows[Number(b.dataset.i)], on = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", on); r[b.dataset.k] = on; }); });
        [].forEach.call(body.querySelectorAll("[data-cert]"), function (b) { b.addEventListener("click", function () { rows[Number(b.dataset.i)].cert = b.dataset.cert; draw(); }); });
        [].forEach.call(body.querySelectorAll("[data-del]"), function (b) { b.addEventListener("click", function () { rows.splice(Number(b.dataset.del), 1); draw(); }); });
        document.getElementById("ltAdd").addEventListener("click", function () {
          if (rows.length >= 50) return; rows.push({ name: "", days: 0, paid: true, note: false, cert: "Not applicable", nocert: 0, nocertRun: 0, certFile: false }); draw();
          var n = body.querySelectorAll(".lt-name"); if (n.length) n[n.length - 1].focus();
        });
        document.getElementById("ltSave").addEventListener("click", function () {
          var m = document.getElementById("ltMsg"), seen = {}, out;
          try {
            out = rows.map(function (r, i) {
              var name = String(r.name || "").trim(); if (!name) throw new Error("Leave type is required on card " + (i + 1) + ".");
              if (seen[name.toLowerCase()]) throw new Error('"' + name + '" appears twice.'); seen[name.toLowerCase()] = true;
              function n(v, l) { var x = parseFloat(v); if (v === "" || v == null) x = 0; if (isNaN(x) || x < 0) throw new Error(l + " for " + name + " must be 0 or more."); return x; }
              return { name: name, days: n(r.days, "Days per year"), paid: r.paid !== false, note: !!r.note, cert: r.cert || "Not applicable", nocert: n(r.nocert, "Days without certificate"), nocertRun: n(r.nocertRun, "Longest stretch"), certFile: !!r.certFile };
            });
          } catch (e) { m.textContent = e.message; m.className = "msg err"; return; }
          m.textContent = "Saving…"; m.className = "msg";
          save(KEYS.types, out).then(function () { rows = out; m.textContent = "Saved."; m.className = "msg ok"; if (env.onSaved) env.onSaved(); }).catch(function (e) { m.textContent = e.message; m.className = "msg err"; });
        });
      }
      draw();
    }

    /* Weekend and "show approved leave on the roster": two fields of the Duty Roster setting, saved without touching the rest of it. */
    function roster() {
      var spec = defs["Duty Roster"], cur = {};
      (spec.fields || []).forEach(function (f) { cur[f.k] = f.d; });
      var saved = company.settings && company.settings[KEYS.roster];
      if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { cur[k] = saved[k]; });
      var wk = (spec.fields || []).filter(function (f) { return f.k === "weekend"; })[0];
      body.innerHTML = '<h3>Weekend &amp; roster</h3><p class="note">The weekend decides which days count as working days when leave is requested and used. These are the same two fields as on Duty Roster settings.</p>' +
        '<div class="cards"><div class="fld"><label for="lsWeekend">Weekend days</label><select id="lsWeekend">' + wk.o.map(function (o) { return '<option' + (o === cur.weekend ? " selected" : "") + '>' + esc(o) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld tog"><span>Show approved leave as L on the roster automatically</span><button type="button" class="sw" role="switch" id="lsShow" aria-checked="' + !!cur.showLeave + '" aria-label="Show approved leave on the roster"></button></div></div>' +
        (edit ? '<div class="ed-foot actions"><span class="msg" id="lsMsg" role="status"></span><button class="save" type="button" id="lsSave"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>Save changes</button></div>' : '<p class="msg">Only owners, admins and HR can change this.</p>');
      var sw = document.getElementById("lsShow");
      sw.addEventListener("click", function () { if (edit) sw.setAttribute("aria-checked", sw.getAttribute("aria-checked") !== "true"); });
      if (!edit) { document.getElementById("lsWeekend").disabled = true; return; }
      document.getElementById("lsSave").addEventListener("click", function () {
        var m = document.getElementById("lsMsg"); m.textContent = "Saving…"; m.className = "msg";
        var val = Object.assign({}, cur, { weekend: document.getElementById("lsWeekend").value, showLeave: sw.getAttribute("aria-checked") === "true" });
        save(KEYS.roster, val).then(function () { m.textContent = "Saved."; m.className = "msg ok"; if (env.onSaved) env.onSaved(); }).catch(function (e) { m.textContent = e.message; m.className = "msg err"; });
      });
    }
  }
  window.HrLeaveSettings = { render: render };
})();
