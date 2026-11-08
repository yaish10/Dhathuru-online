/* Cursor 2026-10-26: HR page — Allowances (hr.html#allowances).
   Catalog lives in company setting 8_allowance_catalog.
   Who receives one is stored on member_pay.allowances so pay runs include it. */
(function () {
  var KEY = "8_allowance_catalog";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + "</svg>"; }
  var I = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 9.5c.6-.8 1.4-1.2 2.5-1.2 1.6 0 2.6.8 2.6 2s-1 1.8-2.6 2.1c-1.6.3-2.6.9-2.6 2.1 0 1.2 1 2 2.6 2 1.1 0 1.9-.4 2.5-1.2"/>',
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>'
  };
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Ramadan moves about 11 days earlier each year (moon sighting decides the exact day), so these are only a starting point.
  var RAMADAN = [["2026-02-18", "2026-03-19"], ["2027-02-08", "2027-03-09"], ["2028-01-28", "2028-02-26"], ["2029-01-16", "2029-02-14"]];
  function fmtD(d) { var p = String(d || "").split("-"); return p.length === 3 ? (+p[2]) + " " + MONTHS[+p[1] - 1] + " " + p[0] : ""; }
  function schedKind(a) { return a && (a.schedule === "months" && Array.isArray(a.months) && a.months.length ? "months" : a && a.schedule === "range" && a.from && a.to ? "range" : "always"); }
  function schedText(a) {
    var k = schedKind(a);
    if (k === "months") return a.months.slice().sort(function (x, y) { return x - y; }).map(function (m) { return MONTHS[m - 1]; }).join(", ");
    if (k === "range") return fmtD(a.from) + " – " + fmtD(a.to);
    return "Every month";
  }
  // Is it paid in the pay period [from, to]? Months: the month the period ends in. Dates: the run that covers the last day (so it is not paid twice).
  function dueIn(a, from, to) {
    var k = schedKind(a);
    if (k === "always") return true;
    if (k === "months") return a.months.indexOf(+to.slice(5, 7)) > -1;
    return a.to >= from && a.to <= to;
  }
  function thisMonth() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1, pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return [y + "-" + pad(m) + "-01", y + "-" + pad(m) + "-" + pad(new Date(y, m, 0).getDate())];
  }
  function nid() { return "alw_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function moneyOf(api, n) {
    if (api.money) return api.money(n);
    return "MVR " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  window.VeyoraHrAllowances = {
    render: function (api) {
      var model = api.model, ctx = api.ctx, company = api.company;
      var state = api.alwState || (api.alwState = { q: "", msg: "", msgKind: "" });
      var canEdit = !!(ctx && (ctx.canHr || ctx.canAll || ctx.isAdmin || ctx.isPlatform));
      var catalog = (company.settings && company.settings[KEY]) || [];
      if (!Array.isArray(catalog)) catalog = [];
      var staff = (model.staff || []).filter(function (s) { return s.active || s.pendingInvite; });
      var q = (state.q || "").toLowerCase();

      function peopleOf(alw) {
        var n = norm(alw.name);
        return staff.filter(function (s) {
          return (s.allowances || []).some(function (a) { return norm(a.name) === n; });
        });
      }
      function tone(i) { return "org-tone-" + (i % 6); }
      function initials(name) {
        var p = String(name || "").trim().split(/\s+/).slice(0, 2);
        return (p.map(function (x) { return x.charAt(0); }).join("") || "A").toUpperCase();
      }

      var list = catalog.filter(function (a) {
        if (!a || !a.name) return false;
        if (!q) return true;
        if (a.name.toLowerCase().indexOf(q) >= 0) return true;
        return peopleOf(a).some(function (s) { return (s.name || "").toLowerCase().indexOf(q) >= 0; });
      });
      var covered = {};
      catalog.forEach(function (a) { peopleOf(a).forEach(function (s) { covered[s.uid] = true; }); });
      var pm = thisMonth();
      var monthly = catalog.reduce(function (t, a) { return t + (dueIn(a, pm[0], pm[1]) ? peopleOf(a).length * (Number(a.amount) || 0) : 0); }, 0);

      function chip(alw, s) {
        var pend = !!s.pendingInvite;
        var who = s.uid && !pend ? '<a href="#employee/' + esc(s.uid) + '">' + esc(s.name) + "</a>" : esc(s.name);
        var off = canEdit
          ? '<button type="button" data-alw-off="' + esc(alw.id) + '" data-uid="' + esc(s.uid) + '" aria-label="Remove ' + esc(s.name) + ' from ' + esc(alw.name) + '">×</button>'
          : "";
        return '<span class="alw-chip' + (pend ? " pend" : "") + '">' + who +
          (pend ? '<small>Invite</small>' : "") + off + "</span>";
      }
      function addSelect(alw, have) {
        if (!canEdit) return "";
        var ids = {};
        have.forEach(function (s) { ids[s.uid] = true; });
        var opts = staff.filter(function (s) { return s.active && !s.pendingInvite && !ids[s.uid]; }).map(function (s) {
          return '<option value="' + esc(s.uid) + '">' + esc(s.name + (s.position ? " · " + s.position : "")) + "</option>";
        }).join("");
        return '<div class="alw-add"><select data-alw-add="' + esc(alw.id) + '" aria-label="Add staff to ' + esc(alw.name) + '">' +
          '<option value="">Add staff</option>' + opts + "</select></div>";
      }
      function card(alw, i) {
        var have = peopleOf(alw), amt = Number(alw.amount) || 0, due = dueIn(alw, pm[0], pm[1]), cost = due ? have.length * amt : 0, kind = schedKind(alw);
        var share = monthly ? Math.round(cost * 100 / monthly) : 0;
        var stack = have.slice(0, 4).map(function (s) { return '<i title="' + esc(s.name) + '">' + esc(initials(s.name)) + '</i>'; }).join("") + (have.length > 4 ? '<i class="more">+' + (have.length - 4) + '</i>' : "");
        return '<article class="alw-card alw2-card" style="--i:' + Math.min(i, 14) + '">' +
          '<div class="alw2-row">' +
            '<span class="alw2-ic ' + tone(i) + '">' + icon(I.coin) + "</span>" +
            '<div class="alw2-nm"><strong>' + esc(alw.name) + '</strong><small>' + have.length + ' staff receive this</small>' +
              '<span class="alw2-when ' + kind + (due ? "" : " off") + '">' + icon(I.cal) + esc(schedText(alw)) + (kind !== "always" ? (due ? " · paid this month" : " · not paid this month") : "") + '</span></div>' +
            '<div class="alw2-amt"><b>' + esc(moneyOf(api, amt)) + '</b><span>per person / month</span></div>' +
            '<div class="alw2-cost"><span>' + (kind === "always" ? "Monthly cost" : (due ? "Due this month" : "Next due: " + esc(schedText(alw)))) + '</span><b>' + esc(moneyOf(api, cost)) + '</b><span class="bar"><i style="width:' + share + '%"></i></span><em>' + share + '% of all allowances</em></div>' +
            (have.length ? '<span class="alw2-stack">' + stack + '</span>' : "") +
            (canEdit ? '<button type="button" class="org-edit" data-alw-edit="' + esc(alw.id) + '">Edit</button>' : "") +
          "</div>" +
          '<div class="alw-people">' +
            (have.length ? '<div class="alw-chips">' + have.map(function (s) { return chip(alw, s); }).join("") + "</div>" : '<p class="alw-none">No staff on this allowance yet.</p>') +
            addSelect(alw, have) +
          "</div></article>";
      }

      return '<div class="alw-board alw2">' +
        '<header class="alw2-hero"><div class="alw2-hero-l"><small>Pay</small><h2>Allowances</h2>' +
          '<p>Add each allowance once, then put the staff who receive it underneath. The monthly amount is saved on their pay and included in pay runs.</p>' +
          (canEdit ? '<div class="org-hero-acts"><button type="button" class="primary-btn" id="alwAdd">' + icon(I.plus) + " Add allowance</button></div>" : "") + '</div>' +
        '<div class="alw2-tiles">' +
          '<div class="alw2-tile"><span class="ic">' + icon(I.coin) + '</span><strong>' + catalog.length + '</strong><small>Allowances</small></div>' +
          '<div class="alw2-tile"><span class="ic">' + icon(I.people) + '</span><strong>' + Object.keys(covered).length + '</strong><small>Staff covered</small></div>' +
          '<div class="alw2-tile wide"><span class="ic">' + icon(I.coin) + '</span><strong>' + esc(moneyOf(api, monthly)) + '</strong><small>Due this month</small></div>' +
        "</div></header>" +
        '<div class="org-bar"><label class="fsearch"><span class="sr" style="position:absolute;width:1px;height:1px;overflow:hidden">Search allowances</span>' +
          icon(I.search) + '<input id="alwQ" placeholder="Search allowances or staff" value="' + esc(state.q || "") + '"></label></div>' +
        (state.msg ? '<p class="msg ' + esc(state.msgKind || "") + '" role="status">' + esc(state.msg) + "</p>" : "") +
        (list.length
          ? '<div class="alw-list">' + list.map(card).join("") + "</div>"
          : '<div class="org-empty"><h3>' + (catalog.length ? "No matches" : "No allowances yet") + "</h3><p>" +
            (catalog.length ? "Try another name." : "Add Food allowance, Sea allowance, and the rest. Then choose who receives each one.") +
            "</p>" + (canEdit && !catalog.length ? '<button type="button" class="primary-btn" id="alwAdd2">' + icon(I.plus) + " Add allowance</button>" : "") + "</div>") +
        "</div>";
    },

    bind: function (api) {
      var $ = api.$, company = api.company, model = api.model, db = api.db, rpc = api.rpc;
      var state = api.alwState || (api.alwState = { q: "", msg: "", msgKind: "" });
      var openModal = api.openModal, closeModal = api.closeModal;

      function catalog() {
        var raw = company.settings && company.settings[KEY];
        return Array.isArray(raw) ? raw.filter(function (a) { return a && a.id && a.name; }) : [];
      }
      function byId(id) { return catalog().filter(function (a) { return a.id === id; })[0]; }
      function flash(t, k) { state.msg = t || ""; state.msgKind = k || ""; }
      function saveCatalog(list) {
        return rpc("set_company_setting", { p_company: company.id, p_key: KEY, p_value: list }).then(function () {
          company.settings = company.settings || {};
          company.settings[KEY] = list;
        });
      }
      function person(uid) {
        return (model.staff || []).filter(function (s) { return s.uid === uid; })[0];
      }
      function reload() {
        var job = api.reload ? api.reload() : Promise.resolve();
        return job;
      }
      function payList(person, next) {
        return rpc("set_member_pay", {
          p_company: company.id,
          p_user: person.uid,
          p_basic: Number(person.basic) || 0,
          p_allowances: next,
          p_pension: person.pension !== false,
          p_method: person.payMethod || "Bank transfer"
        });
      }
      function patchPending(person, next) {
        var pkey = "8_pending_employee_invites";
        var rows = ((company.settings && company.settings[pkey]) || []).slice();
        if (!Array.isArray(rows)) rows = [];
        var email = String(person.email || "").toLowerCase();
        var hit = null;
        rows.forEach(function (x) { if (x && String(x.email || "").toLowerCase() === email) hit = x; });
        if (!hit) {
          hit = { invite_id: person.inviteId || null, email: email, created_at: new Date().toISOString(), profile: Object.assign({}, person.draft || {}) };
          rows.push(hit);
        }
        hit.profile = Object.assign({}, hit.profile || {}, { allowances: next });
        return rpc("set_company_setting", { p_company: company.id, p_key: pkey, p_value: rows }).then(function () {
          company.settings[pkey] = rows;
        });
      }
      function patchPerson(person, mutator) {
        var cur = (person.allowances || []).map(function (a) { return { name: a.name, amount: Number(a.amount) || 0 }; });
        var next = mutator(cur).filter(function (a) { return a && String(a.name || "").trim(); }).map(function (a) {
          return { name: String(a.name).trim(), amount: Math.round((Number(a.amount) || 0) * 100) / 100 };
        });
        if (person.pendingInvite) return patchPending(person, next);
        return payList(person, next);
      }
      function eachOn(alw, mutator) {
        var n = norm(alw.name);
        var people = (model.staff || []).filter(function (s) {
          return (s.active || s.pendingInvite) && (s.allowances || []).some(function (a) { return norm(a.name) === n; });
        });
        return people.reduce(function (p, s) { return p.then(function () { return patchPerson(s, mutator); }); }, Promise.resolve());
      }

      function openEditor(row) {
        openModal(
          "<h2>" + (row ? "Edit allowance" : "Add allowance") + "</h2>" +
          '<p class="note">A fixed monthly amount. Everyone you add under it receives this on their pay.</p>' +
          '<div class="cards">' +
            '<div class="fld"><label for="aName">Name</label><input id="aName" maxlength="60" value="' + esc(row ? row.name : "") + '" placeholder="e.g. Food allowance"></div>' +
            '<div class="fld"><label for="aAmt">Monthly amount</label><input id="aAmt" type="number" min="0" step="0.01" value="' + esc(row ? row.amount : "") + '" placeholder="1000"></div>' +
          "</div>" +
          '<div class="alw-when"><p class="alw-when-t">When is it paid?</p>' +
            '<div class="alw-modes" role="group" aria-label="When is it paid">' +
              '<button type="button" data-wmode="always">Every month</button><button type="button" data-wmode="months">Specific months</button><button type="button" data-wmode="range">Date range (e.g. Ramadan)</button></div>' +
            '<div class="alw-wpane" data-wpane="months" hidden><div class="alw-mchips">' + MONTHS.map(function (m, i) { return '<label><input type="checkbox" value="' + (i + 1) + '"><span>' + m + '</span></label>'; }).join("") + '</div>' +
              '<p class="hint">Paid in the pay run for each ticked month.</p></div>' +
            '<div class="alw-wpane" data-wpane="range" hidden><div class="cards"><div class="fld"><label for="aFrom">From</label><input id="aFrom" type="date"></div><div class="fld"><label for="aTo">To</label><input id="aTo" type="date"></div></div>' +
              '<div class="alw-presets"><button type="button" class="ghost" id="aRam">Fill in Ramadan</button><span id="aRamNote"></span></div>' +
              '<p class="hint">Paid once, in the pay run that covers the last day. Dates that move each year (like Ramadan) are set here, so update them for next year.</p></div>' +
          '</div>' +
          '<p class="msg" id="mMsg" role="status"></p>' +
          '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button>' +
          (row ? '<button type="button" class="ghost" id="aDel" style="margin-right:auto;color:#c0293b">Delete</button>' : "") +
          '<button type="button" class="save" id="aGo">Save</button></div>',
          true
        );
        function mSay(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
        var wmode = schedKind(row);
        function paintWhen() {
          [].forEach.call(document.querySelectorAll("[data-wmode]"), function (b) { b.classList.toggle("on", b.getAttribute("data-wmode") === wmode); });
          [].forEach.call(document.querySelectorAll("[data-wpane]"), function (p) { p.hidden = p.getAttribute("data-wpane") !== wmode; });
        }
        if (row && schedKind(row) === "months") row.months.forEach(function (m) { var c = document.querySelector('.alw-mchips input[value="' + m + '"]'); if (c) c.checked = true; });
        if (row && schedKind(row) === "range") { $("aFrom").value = row.from; $("aTo").value = row.to; }
        [].forEach.call(document.querySelectorAll("[data-wmode]"), function (b) { b.addEventListener("click", function () { wmode = b.getAttribute("data-wmode"); paintWhen(); }); });
        $("aRam").addEventListener("click", function () {
          var t = new Date().toISOString().slice(0, 10), hit = RAMADAN.filter(function (r) { return r[1] >= t; })[0] || RAMADAN[RAMADAN.length - 1];
          $("aFrom").value = hit[0]; $("aTo").value = hit[1];
          $("aRamNote").textContent = "Approximate. Confirm with the announced start date and adjust if needed.";
        });
        paintWhen();
        function readWhen() {
          if (wmode === "months") {
            var ms = [].map.call(document.querySelectorAll(".alw-mchips input:checked"), function (c) { return Number(c.value); });
            if (!ms.length) return { err: "Tick at least one month, or choose Every month." };
            return { schedule: "months", months: ms };
          }
          if (wmode === "range") {
            var f = $("aFrom").value, t = $("aTo").value;
            if (!f || !t) return { err: "Choose the first and last date." };
            if (t < f) return { err: "The last date must be on or after the first date." };
            return { schedule: "range", from: f, to: t };
          }
          return { schedule: "always" };
        }
        function read() {
          var name = $("aName").value.trim();
          var amt = Number($("aAmt").value);
          if (name.length < 2) return { err: "Enter a name." };
          if (!isFinite(amt) || amt < 0) return { err: "Enter an amount of 0 or more." };
          if (catalog().some(function (a) { return norm(a.name) === norm(name) && (!row || a.id !== row.id); })) return { err: "That allowance already exists." };
          var w = readWhen(); if (w.err) return w;
          return Object.assign({ name: name, amount: Math.round(amt * 100) / 100 }, w);
        }
        function entry(id, got) {
          var e = { id: id, name: got.name, amount: got.amount };
          if (got.schedule === "months") { e.schedule = "months"; e.months = got.months; }
          else if (got.schedule === "range") { e.schedule = "range"; e.from = got.from; e.to = got.to; }
          return e;
        }
        $("aGo").addEventListener("click", function () {
          var got = read();
          if (got.err) { mSay(got.err, "err"); return; }
          mSay("Saving…");
          var list = catalog().slice();
          var job;
          if (row) {
            list = list.map(function (a) { return a.id === row.id ? entry(a.id, got) : a; });
            job = saveCatalog(list).then(function () {
              if (norm(row.name) === norm(got.name) && Number(row.amount) === got.amount) return;
              return eachOn(row, function (cur) {
                return cur.map(function (a) {
                  return norm(a.name) === norm(row.name) ? { name: got.name, amount: got.amount } : a;
                });
              });
            });
          } else {
            list.push(entry(nid(), got));
            job = saveCatalog(list);
          }
          job.then(function () {
            closeModal();
            flash(row ? "Allowance saved." : "Allowance added.", "ok");
            return reload();
          }).catch(function (e) { mSay(e.message || String(e), "err"); });
        });
        if ($("aDel") && row) $("aDel").addEventListener("click", function () {
          if (!window.confirm("Delete “" + row.name + "”? It will be removed from everyone who has it.")) return;
          mSay("Deleting…");
          var list = catalog().filter(function (a) { return a.id !== row.id; });
          eachOn(row, function (cur) {
            return cur.filter(function (a) { return norm(a.name) !== norm(row.name); });
          }).then(function () { return saveCatalog(list); }).then(function () {
            closeModal();
            flash("Allowance deleted.", "ok");
            return reload();
          }).catch(function (e) { mSay(e.message || String(e), "err"); });
        });
      }

      function addClick(b) { b.addEventListener("click", function () { flash(""); openEditor(null); }); }
      if ($("alwAdd")) addClick($("alwAdd"));
      if ($("alwAdd2")) addClick($("alwAdd2"));
      [].forEach.call(document.querySelectorAll("[data-alw-edit]"), function (b) {
        b.addEventListener("click", function () {
          var row = byId(b.getAttribute("data-alw-edit"));
          if (row) { flash(""); openEditor(row); }
        });
      });
      var q = $("alwQ");
      if (q) q.addEventListener("input", function () {
        state.q = q.value;
        var pos = q.selectionStart;
        flash("");
        api.render();
        var n = $("alwQ");
        if (n) { n.focus(); if (pos != null) n.setSelectionRange(pos, pos); }
      });
      [].forEach.call(document.querySelectorAll("[data-alw-add]"), function (sel) {
        sel.addEventListener("change", function () {
          var uid = sel.value;
          var alw = byId(sel.getAttribute("data-alw-add"));
          var s = person(uid);
          if (!uid || !alw || !s) return;
          flash("Adding " + s.name + "…");
          api.render();
          patchPerson(s, function (cur) {
            return cur.filter(function (a) { return norm(a.name) !== norm(alw.name); }).concat([{ name: alw.name, amount: Number(alw.amount) || 0 }]);
          }).then(function () {
            flash(s.name + " added to " + alw.name + ".", "ok");
            return reload();
          }).catch(function (e) { flash(e.message || String(e), "err"); api.render(); });
        });
      });
      [].forEach.call(document.querySelectorAll("[data-alw-off]"), function (b) {
        b.addEventListener("click", function () {
          var alw = byId(b.getAttribute("data-alw-off"));
          var s = person(b.getAttribute("data-uid"));
          if (!alw || !s) return;
          flash("Removing " + s.name + "…");
          api.render();
          patchPerson(s, function (cur) {
            return cur.filter(function (a) { return norm(a.name) !== norm(alw.name); });
          }).then(function () {
            flash(s.name + " removed from " + alw.name + ".", "ok");
            return reload();
          }).catch(function (e) { flash(e.message || String(e), "err"); api.render(); });
        });
      });
      void db;
    }
  };
})();
