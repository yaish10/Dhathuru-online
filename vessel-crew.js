/* "Vessel crew needs": how many of each role every vessel needs on a trip (e.g. 1 Captain, 2 Crew, 1 Cashier).
   Shared by Operations (Crew management) and HR (Crew Management). Saved with set_vessel_crew_mix (Operations or HR);
   the database then fills each trip's crew from the people on duty in the Duty Roster, by role, and keeps it in step
   when the roster changes (auto_assign_crew, every minute). Changes save by themselves a moment after you stop clicking.
   Uses the page's #modal / #modalCard. Styles: vessel-crew.css.
   Usage: VeyoraVesselCrew.open({ db, company, onSaved }) */
(function () {
  var esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var BASE = ["Captain", "Crew", "Cashier"];
  var TONES = ["blue", "teal", "amber", "violet", "rose", "slate"];
  var PRESETS = [
    { name: "Speedboat", mix: { Captain: 1, Crew: 2, Cashier: 1 } },
    { name: "Ferry", mix: { Captain: 1, Crew: 4, Cashier: 2 } },
    { name: "Dhoni", mix: { Captain: 1, Crew: 2, Cashier: 0 } }
  ];
  var ICON = {
    boat: '<path d="M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4"/>',
    Captain: '<path d="M4 10h16M6 10l1-4h10l1 4M12 10v2M8 14a4 4 0 0 0 8 0"/><circle cx="12" cy="4.5" r="1"/>',
    Crew: '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3 3-5 6-5s6 2 6 5M17 6a3 3 0 0 1 0 6M21 20c0-2-1-4-3-4.6"/>',
    Cashier: '<path d="M4 7h16v12H4zM4 11h16M8 15h2M14 15h2M9 7V4h6v3"/>',
    other: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    check: '<path d="m5 12 5 5 9-10"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', sync: '<path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4"/>'
  };
  function svg(p, cls) { return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : "") + '>' + p + '</svg>'; }
  function key(r) { return String(r).trim().toLowerCase().replace(/s$/, ""); }

  function open(o) {
    var db = o.db, company = o.company, modal = document.getElementById("modal"), card = document.getElementById("modalCard");
    card.className = "modal-card vcx-card"; card.innerHTML = '<div class="vcx-loading"><span class="vcx-spin"></span>Loading your fleet…</div>'; modal.hidden = false;
    Promise.all([
      db.from("vessels").select("id, name, code, status, standby, passenger_capacity, crew_capacity, meta").eq("company_id", company.id).order("name"),
      db.from("company_members").select("user_id, job_title_id, role_label, active, employment_status").eq("company_id", company.id).eq("active", true),
      db.from("job_titles").select("id, title, crew_group").eq("company_id", company.id)
    ]).then(function (r) {
      for (var i = 0; i < 3; i++) if (r[i].error) throw new Error(r[i].error.message);
      var vessels = r[0].data || [], titles = {};
      (r[2].data || []).forEach(function (t) { titles[t.id] = t; });
      var people = (r[1].data || []).filter(function (m) { return !m.employment_status || m.employment_status === "Active"; }).map(function (m) {
        var t = titles[m.job_title_id]; return { pos: (t ? t.title : m.role_label || "").toLowerCase(), grp: (t && t.crew_group || "").toLowerCase() };
      });
      var roles = BASE.slice();
      vessels.forEach(function (v) { ((v.meta && v.meta.crew_mix) || []).forEach(function (x) { if (roles.map(key).indexOf(key(x.role)) < 0) roles.push(x.role); }); });
      var state = {}; // vessel id → {role: n}
      vessels.forEach(function (v) { var m = {}; ((v.meta && v.meta.crew_mix) || []).forEach(function (x) { m[x.role] = x.n; }); state[v.id] = m; });
      var q = "", timers = {}, syncTimer = null;

      // How many people have each role (same matching as the database: designation, crew group, "Crew" = deck/engineering).
      function staffWith(role) {
        var k = key(role);
        return people.filter(function (p) {
          if (key(p.pos) === k || p.grp === k) return true;
          return k === "crew" && (p.pos.indexOf("crew") > -1 || ((p.grp === "deck" || p.grp === "engineering") && p.pos.indexOf("captain") < 0));
        }).length;
      }
      function n(vid, role) { var m = state[vid]; for (var r in m) if (key(r) === key(role)) return m[r]; return 0; }
      function setN(vid, role, val) { var m = state[vid]; for (var r in m) if (key(r) === key(role)) delete m[r]; m[role] = Math.max(0, Math.min(20, val)); }
      function total(vid) { return roles.reduce(function (s, ro) { return s + n(vid, ro); }, 0); }
      function tone(i) { return TONES[i % TONES.length]; }
      function biggest(role) { return vessels.reduce(function (mx, v) { return Math.max(mx, n(v.id, role)); }, 0); }
      function statusPill(v) {
        var s = v.status === "Operational" && v.standby ? "Standby" : v.status || "Operational";
        return '<span class="vcx-pill ' + (s === "Operational" ? "ok" : s === "Standby" ? "idle" : "warn") + '">' + esc(s) + '</span>';
      }

      function summary() {
        return '<div class="vcx-summary">' + roles.map(function (ro, i) {
          var have = staffWith(ro), need = biggest(ro), short = need > have;
          return '<div class="vcx-stat tone-' + tone(i) + (short ? " short" : "") + '"><span class="vcx-stat-ic">' + svg(ICON[ro] || ICON.other) + '</span><span><strong>' + have + '</strong><small>' + esc(ro) + (have === 1 ? "" : "s") + ' on staff</small>' +
            (short ? '<em>One boat needs ' + need + '</em>' : "") + '</span></div>';
        }).join("") + '</div>';
      }
      function seats(vid) {
        var out = ""; roles.forEach(function (ro, i) { for (var k = 0; k < n(vid, ro); k++) out += '<span class="vcx-seat tone-' + tone(i) + '" title="' + esc(ro) + '"></span>'; });
        return out || '<span class="vcx-seats-empty">No crew set yet</span>';
      }
      function vesselCard(v) {
        var t = total(v.id);
        return '<article class="vcx-vessel" data-v="' + v.id + '">' +
          '<header><span class="vcx-boat">' + svg(ICON.boat) + '</span><div class="vcx-title"><strong>' + esc(v.code || v.name) + '</strong><small>' + esc(v.code && v.name !== v.code ? v.name : "") +
            (v.passenger_capacity != null || v.crew_capacity != null
              ? ((v.code && v.name !== v.code ? " · " : "") + (Number(v.passenger_capacity) || 0) + " pax" + (v.crew_capacity != null ? " + " + Number(v.crew_capacity) + " crew" : ""))
              : (v.code && v.name !== v.code ? "" : "Vessel")) + '</small></div>' +
          statusPill(v) + '<span class="vcx-total" data-total><b>' + t + '</b><small>per trip</small></span></header>' +
          '<div class="vcx-seats" data-seats>' + seats(v.id) + '</div>' +
          '<div class="vcx-roles">' + roles.map(function (ro, i) {
            var val = n(v.id, ro), have = staffWith(ro);
            return '<div class="vcx-role tone-' + tone(i) + (val ? " on" : "") + '"><span class="vcx-role-ic">' + svg(ICON[ro] || ICON.other) + '</span><span class="vcx-role-name">' + esc(ro) + (val > have ? '<small class="warn">only ' + have + ' on staff</small>' : '<small>' + have + ' on staff</small>') + '</span>' +
              '<span class="vcx-step"><button type="button" data-step="-1" data-role="' + esc(ro) + '" aria-label="Fewer ' + esc(ro) + '"' + (val ? "" : " disabled") + '>' + svg(ICON.minus) + '</button><output>' + val + '</output><button type="button" data-step="1" data-role="' + esc(ro) + '" aria-label="More ' + esc(ro) + '">' + svg(ICON.plus) + '</button></span></div>';
          }).join("") + '</div>' +
          '<footer><span class="vcx-presets">' + PRESETS.map(function (p, i) { return '<button type="button" data-preset="' + i + '">' + esc(p.name) + ' <small>' + BASE.map(function (b) { return p.mix[b] || 0; }).join("·") + '</small></button>'; }).join("") + '<button type="button" data-preset="clear">Clear</button></span>' +
          '<span class="vcx-save" data-save-state>' + (t ? svg(ICON.check) + 'Saved' : "") + '</span></footer></article>';
      }
      function draw() {
        var list = vessels.filter(function (v) { return !q || (v.code + " " + v.name + " " + v.status).toLowerCase().indexOf(q) > -1; });
        card.innerHTML =
          '<div class="vcx-head"><div><span class="vcx-kicker">Fleet · crew planning</span><h2>Vessel crew needs</h2><p>Set who every trip on each boat needs. Trips are crewed from the Duty Roster by role, and update by themselves when the roster changes. People you put on a trip by hand are never moved.</p></div>' +
          '<button type="button" class="vcx-x" data-close aria-label="Close">×</button></div>' +
          summary() +
          '<div class="vcx-tools"><label class="vcx-search">' + svg(ICON.search) + '<input type="search" id="vcxQ" placeholder="Find a boat" value="' + esc(q) + '" aria-label="Find a boat"></label>' +
          '<span class="vcx-apply">Apply to all boats:' + PRESETS.map(function (p, i) { return '<button type="button" data-all="' + i + '">' + esc(p.name) + '</button>'; }).join("") + '</span>' +
          '<span class="vcx-addrole"><input id="vcxRole" maxlength="40" placeholder="Add a role, e.g. Engineer" aria-label="New role"><button type="button" id="vcxAddRole">' + svg(ICON.plus) + 'Add</button></span></div>' +
          (list.length ? '<div class="vcx-grid">' + list.map(vesselCard).join("") + '</div>' : '<div class="vcx-empty">' + (vessels.length ? "No boats match “" + esc(q) + "”." : "No vessels yet. Add them under Fleet.") + '</div>') +
          '<div class="vcx-foot"><span id="vcxStatus" class="vcx-status" role="status">' + svg(ICON.sync) + 'Changes save automatically</span><button type="button" class="save" data-close>Done</button></div>';
        bind();
      }
      function status(text, kind) { var s = document.getElementById("vcxStatus"); if (s) { s.className = "vcx-status " + (kind || ""); s.innerHTML = svg(kind === "err" ? ICON.minus : kind === "ok" ? ICON.check : ICON.sync) + esc(text); } }
      function refreshCard(vid) {
        var el = card.querySelector('[data-v="' + vid + '"]'); if (!el) return;
        var fresh = document.createElement("div"); fresh.innerHTML = vesselCard(vessels.filter(function (v) { return v.id === vid; })[0]);
        el.replaceWith(fresh.firstChild); bindCard(card.querySelector('[data-v="' + vid + '"]'));
        var sum = card.querySelector(".vcx-summary"); if (sum) { var s2 = document.createElement("div"); s2.innerHTML = summary(); sum.replaceWith(s2.firstChild); }
      }
      // Save a boat a moment after the last click; then ask the database to crew trips now (Operations only).
      function queueSave(vid) {
        var el = card.querySelector('[data-v="' + vid + '"] [data-save-state]'); if (el) { el.className = "vcx-save busy"; el.innerHTML = '<span class="vcx-spin"></span>Saving…'; }
        status("Saving…");
        clearTimeout(timers[vid]);
        timers[vid] = setTimeout(function () {
          var mix = roles.map(function (ro) { return { role: ro, n: n(vid, ro) }; });
          db.rpc("set_vessel_crew_mix", { p_vessel: vid, p_mix: mix }).then(function (res) {
            var st = card.querySelector('[data-v="' + vid + '"] [data-save-state]');
            if (res.error) { if (st) { st.className = "vcx-save err"; st.textContent = "Not saved"; } status(res.error.message, "err"); return; }
            if (st) { st.className = "vcx-save ok pop"; st.innerHTML = svg(ICON.check) + "Saved"; }
            clearTimeout(syncTimer);
            syncTimer = setTimeout(function () {
              db.rpc("assign_trip_crew", { p_company: company.id }).then(function (a) {
                status(a.error ? "Saved. Trips pick this up within a minute." : "Saved · trips updated from the roster" + (a.data ? " (" + a.data + " places filled)" : ""), "ok");
                if (o.onSaved) o.onSaved();
              });
            }, 600);
          });
        }, 650);
      }
      function bindCard(el) {
        var vid = el.dataset.v;
        [].forEach.call(el.querySelectorAll("[data-step]"), function (b) {
          b.addEventListener("click", function () { setN(vid, b.dataset.role, n(vid, b.dataset.role) + Number(b.dataset.step)); refreshCard(vid); queueSave(vid); });
        });
        [].forEach.call(el.querySelectorAll("[data-preset]"), function (b) {
          b.addEventListener("click", function () {
            var p = b.dataset.preset === "clear" ? null : PRESETS[+b.dataset.preset];
            roles.forEach(function (ro) { setN(vid, ro, p ? (p.mix[ro] || 0) : 0); });
            refreshCard(vid); queueSave(vid);
          });
        });
      }
      function bind() {
        [].forEach.call(card.querySelectorAll(".vcx-vessel"), bindCard);
        var qi = document.getElementById("vcxQ");
        qi.addEventListener("input", function () { q = qi.value.trim().toLowerCase(); var pos = qi.selectionStart; draw(); var n2 = document.getElementById("vcxQ"); n2.focus(); n2.setSelectionRange(pos, pos); });
        [].forEach.call(card.querySelectorAll("[data-all]"), function (b) {
          b.addEventListener("click", function () {
            var p = PRESETS[+b.dataset.all];
            vessels.forEach(function (v) { roles.forEach(function (ro) { setN(v.id, ro, p.mix[ro] || 0); }); });
            draw(); vessels.forEach(function (v) { queueSave(v.id); });
          });
        });
        document.getElementById("vcxAddRole").addEventListener("click", function () {
          var name = document.getElementById("vcxRole").value.trim();
          if (name.length < 2) { status("Type the role name first.", "err"); return; }
          if (roles.map(key).indexOf(key(name)) > -1) { status(name + " is already there.", "err"); return; }
          roles.push(name); draw(); status(name + " added. Use + on a boat to need one.", "ok");
        });
      }
      draw();
    }).catch(function (e) { card.innerHTML = '<p class="msg err">' + esc(e.message) + '</p><div class="modal-actions"><button type="button" class="ghost" data-close>Close</button></div>'; });
  }
  window.VeyoraVesselCrew = { open: open };
})();
